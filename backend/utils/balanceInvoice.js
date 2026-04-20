/**
 * Balance invoice chain: partial payments move remaining balance to a new invoice.
 * @module utils/balanceInvoice
 */

import { insertInvoiceWithArNumber } from './invoiceArNumber.js';

const INV_DESCRIPTION_PATTERN = /^INV-\d+$/i;

const parseTargetPhase = (remarks) => {
  const match = String(remarks || '').match(/TARGET_PHASE:(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
};

const isMeaningfulInvoiceDescription = (invoiceRow) => {
  const value = String(invoiceRow?.invoice_description || '').trim();
  return Boolean(value) && value !== 'TEMP' && !INV_DESCRIPTION_PATTERN.test(value);
};

const buildInstallmentDisplayDescription = ({
  baseDescription,
  targetPhase,
  isDownpayment,
}) => {
  const cleanBase = String(baseDescription || 'Installment payment').trim();
  if (isDownpayment) {
    return cleanBase.toLowerCase().startsWith('downpayment')
      ? cleanBase
      : `Downpayment - ${cleanBase}`;
  }
  if (targetPhase) {
    return `Phase ${targetPhase} - ${cleanBase}`;
  }
  return cleanBase || null;
};

export async function resolveInvoiceDisplayDescription(client, invoiceRow) {
  if (!invoiceRow) {
    return null;
  }

  if (isMeaningfulInvoiceDescription(invoiceRow)) {
    return String(invoiceRow.invoice_description).trim();
  }

  if (!invoiceRow.installmentinvoiceprofiles_id) {
    return null;
  }

  const profileResult = await client.query(
    `SELECT description, downpayment_invoice_id
     FROM installmentinvoiceprofilestbl
     WHERE installmentinvoiceprofiles_id = $1`,
    [invoiceRow.installmentinvoiceprofiles_id]
  );
  const profile = profileResult.rows[0];
  if (!profile) {
    return null;
  }

  return buildInstallmentDisplayDescription({
    baseDescription: profile.description,
    targetPhase: parseTargetPhase(invoiceRow.remarks),
    isDownpayment: Number(profile.downpayment_invoice_id) === Number(invoiceRow.invoice_id),
  });
}

/**
 * Sum itemized original total from line items (0 if no rows).
 */
export async function sumInvoiceLineOriginal(client, invoiceId) {
  const cntR = await client.query(`SELECT COUNT(*)::int AS c FROM invoiceitemstbl WHERE invoice_id = $1`, [invoiceId]);
  const itemLineCount = parseInt(cntR.rows[0]?.c, 10) || 0;
  const invoiceItemsResult = await client.query(
    `SELECT
      COALESCE(SUM(amount), 0) AS item_amount,
      COALESCE(SUM(discount_amount), 0) AS total_discount,
      COALESCE(SUM(penalty_amount), 0) AS total_penalty,
      COALESCE(SUM(amount * COALESCE(tax_percentage, 0) / 100), 0) AS total_tax
     FROM invoiceitemstbl
     WHERE invoice_id = $1`,
    [invoiceId]
  );
  const row = invoiceItemsResult.rows[0];
  const itemAmount = parseFloat(row.item_amount) || 0;
  const totalDiscount = parseFloat(row.total_discount) || 0;
  const totalPenalty = parseFloat(row.total_penalty) || 0;
  const totalTax = parseFloat(row.total_tax) || 0;
  return {
    itemLineCount,
    originalFromItems: itemAmount - totalDiscount + totalPenalty + totalTax,
  };
}

/**
 * Original obligation and completed payment total for an invoice row.
 * Uses line items when present; otherwise remaining + payments (non-itemized).
 *
 * @param {import('pg').PoolClient} client
 * @param {number|string} invoiceId
 * @param {object} invoiceRow - row from invoicestbl (amount = remaining at read time before current payment when used in POST)
 * @param {number} totalPaidAfterCurrentPayment - sum payable_amount Completed including current insert
 * @param {number} currentPayableAmount - this payment amount
 */
export async function computeOriginalInvoiceAmount(
  client,
  invoiceId,
  invoiceRow,
  totalPaidAfterCurrentPayment,
  currentPayableAmount
) {
  const { itemLineCount, originalFromItems } = await sumInvoiceLineOriginal(client, invoiceId);
  if (itemLineCount > 0 && originalFromItems > 0) {
    return {
      originalInvoiceAmount: originalFromItems,
      usedItems: true,
    };
  }
  const preReadRemaining = parseFloat(invoiceRow?.amount) || 0;
  const paidBefore = Math.max(0, totalPaidAfterCurrentPayment - (parseFloat(currentPayableAmount) || 0));
  const nonItemizedOriginal = Math.max(0, preReadRemaining + paidBefore);
  return {
    originalInvoiceAmount: nonItemizedOriginal,
    usedItems: false,
  };
}

/**
 * Original obligation after a completed payment row was removed (non-itemized uses snapshot + sums).
 */
export async function computeOriginalAfterDeletingPayment(
  client,
  invoiceId,
  invoiceSnapshotBeforeDelete,
  totalPaidAfterDelete,
  deletedPayableAmount
) {
  const { itemLineCount, originalFromItems } = await sumInvoiceLineOriginal(client, invoiceId);
  if (itemLineCount > 0 && originalFromItems > 0) {
    return { originalInvoiceAmount: originalFromItems };
  }
  const d = parseFloat(deletedPayableAmount) || 0;
  const rem = parseFloat(invoiceSnapshotBeforeDelete?.amount) || 0;
  const tp = parseFloat(totalPaidAfterDelete) || 0;
  return { originalInvoiceAmount: Math.max(0, rem + tp + d) };
}

/**
 * Recalculate original when invoicestbl.amount is current remaining and totalPaid is completed sum (PUT / sync).
 */
export async function computeInvoiceOriginalForRecalc(client, invoiceId, invoiceRow) {
  const { itemLineCount, originalFromItems } = await sumInvoiceLineOriginal(client, invoiceId);
  if (itemLineCount > 0 && originalFromItems > 0) {
    return { originalInvoiceAmount: originalFromItems };
  }
  const totalPaidR = await client.query(
    `SELECT COALESCE(SUM(payable_amount), 0) AS t FROM paymenttbl WHERE invoice_id = $1 AND status = 'Completed'`,
    [invoiceId]
  );
  const tp = parseFloat(totalPaidR.rows[0].t) || 0;
  const rem = parseFloat(invoiceRow?.amount) || 0;
  return { originalInvoiceAmount: Math.max(0, rem + tp) };
}

/**
 * Walk parent_invoice_id up to the root.
 */
export async function getChainRootInvoiceId(client, invoiceId) {
  let id = parseInt(invoiceId, 10);
  for (let i = 0; i < 64; i++) {
    const r = await client.query(`SELECT parent_invoice_id FROM invoicestbl WHERE invoice_id = $1`, [id]);
    if (!r.rows.length) return id;
    const p = r.rows[0].parent_invoice_id;
    if (!p) return id;
    id = parseInt(p, 10);
  }
  return id;
}

/**
 * Ordered chain from root: [root, ..., leaf] following balance_invoice_id.
 */
export async function getInvoiceChainIdsFromRoot(client, rootId) {
  const ids = [];
  let id = parseInt(rootId, 10);
  const seen = new Set();
  for (let i = 0; i < 64; i++) {
    if (seen.has(id)) break;
    seen.add(id);
    ids.push(id);
    const r = await client.query(`SELECT balance_invoice_id FROM invoicestbl WHERE invoice_id = $1`, [id]);
    const next = r.rows[0]?.balance_invoice_id;
    if (!next) break;
    id = parseInt(next, 10);
  }
  return ids;
}

/**
 * @returns {Promise<{ chain_invoice_ids: number[], root_invoice_id: number, leaf_invoice_id: number, total_paid_in_chain: number, remaining_on_leaf: number, total_obligation: number, payable_invoice_id: number }>}
 */
export async function getChainFinancialSummary(client, invoiceId) {
  const rootId = await getChainRootInvoiceId(client, invoiceId);
  const chainIds = await getInvoiceChainIdsFromRoot(client, rootId);
  const leafId = chainIds[chainIds.length - 1];

  const paidRes = await client.query(
    `SELECT COALESCE(SUM(payable_amount), 0) AS t
     FROM paymenttbl
     WHERE invoice_id = ANY($1::int[]) AND status = 'Completed'`,
    [chainIds]
  );
  const totalPaidInChain = parseFloat(paidRes.rows[0]?.t) || 0;

  const leafRow = await client.query(`SELECT * FROM invoicestbl WHERE invoice_id = $1`, [leafId]);
  const leaf = leafRow.rows[0];
  const itemsResult = await client.query(`SELECT * FROM invoiceitemstbl WHERE invoice_id = $1`, [leafId]);
  const items = itemsResult.rows || [];
  const baseAmountFromItems =
    items.length > 0
      ? Math.max(
          0,
          items.reduce(
            (sum, it) =>
              sum +
              (Number(it.amount) || 0) -
              (Number(it.discount_amount) || 0) +
              (Number(it.penalty_amount) || 0),
            0
          )
        )
      : null;

  const leafPayments = await client.query(
    `SELECT COALESCE(SUM(payable_amount), 0) AS t FROM paymenttbl WHERE invoice_id = $1 AND status = 'Completed'`,
    [leafId]
  );
  const paidOnLeaf = parseFloat(leafPayments.rows[0]?.t) || 0;

  const leafRemaining =
    baseAmountFromItems !== null ? Math.max(0, baseAmountFromItems - paidOnLeaf) : Math.max(0, parseFloat(leaf.amount) || 0);

  const totalObligation = totalPaidInChain + leafRemaining;

  return {
    chain_invoice_ids: chainIds,
    root_invoice_id: rootId,
    leaf_invoice_id: leafId,
    total_paid_in_chain: totalPaidInChain,
    remaining_on_leaf: leafRemaining,
    total_obligation: totalObligation,
    payable_invoice_id: leafId,
  };
}

/**
 * Installment phase counts should treat a balance-invoice chain as one canonical phase.
 * Downpayment chains are excluded entirely from phase progress.
 */
export async function getCanonicalInstallmentPhaseCounts(
  client,
  installmentInvoiceProfileId,
  downpaymentInvoiceId = null
) {
  const result = await client.query(
    `SELECT
       COUNT(DISTINCT CASE
         WHEN i.status = 'Paid' THEN COALESCE(i.invoice_chain_root_id, i.invoice_id)
         ELSE NULL
       END) AS paid_phase_count,
       COUNT(DISTINCT COALESCE(i.invoice_chain_root_id, i.invoice_id)) AS generated_phase_count
     FROM invoicestbl i
     WHERE i.installmentinvoiceprofiles_id = $1
       AND (
         $2::INTEGER IS NULL OR
         COALESCE(i.invoice_chain_root_id, i.invoice_id) != $2::INTEGER
       )`,
    [installmentInvoiceProfileId, downpaymentInvoiceId || null]
  );

  return {
    paidPhaseCount: parseInt(result.rows[0]?.paid_phase_count || 0, 10),
    generatedPhaseCount: parseInt(result.rows[0]?.generated_phase_count || 0, 10),
  };
}

/**
 * Delete hollow balance invoice (no payments) and unlink parent.
 */
export async function removeUnusedBalanceInvoice(client, childInvoiceId) {
  const payCount = await client.query(
    `SELECT COUNT(*)::int AS c FROM paymenttbl WHERE invoice_id = $1 AND status = 'Completed'`,
    [childInvoiceId]
  );
  if (parseInt(payCount.rows[0]?.c || 0, 10) > 0) {
    return { ok: false, reason: 'child_has_payments' };
  }
  const par = await client.query(
    `SELECT invoice_id FROM invoicestbl WHERE balance_invoice_id = $1`,
    [childInvoiceId]
  );
  await client.query(`DELETE FROM invoiceitemstbl WHERE invoice_id = $1`, [childInvoiceId]);
  await client.query(`DELETE FROM invoicestudentstbl WHERE invoice_id = $1`, [childInvoiceId]);
  await client.query(`DELETE FROM invoicestbl WHERE invoice_id = $1`, [childInvoiceId]);
  if (par.rows.length) {
    const parentId = par.rows[0].invoice_id;
    await client.query(
      `UPDATE invoicestbl SET balance_invoice_id = NULL WHERE invoice_id = $1`,
      [parentId]
    );
  }
  return { ok: true, parent_invoice_id: par.rows[0]?.invoice_id || null };
}

/**
 * Create balance continuation invoice and mark parent non-payable.
 * @returns {Promise<{ balance_invoice_id: number }>}
 */
export async function createBalanceInvoiceFromPartial({
  client,
  parentInvoice,
  remainingBalance,
  createdBy,
  issueDateYmd,
}) {
  const parent = parentInvoice;
  const rb = Math.max(0, Number(remainingBalance) || 0);
  if (rb < 0.005) {
    throw new Error('remainingBalance must be positive');
  }

  const chainRoot = parent.invoice_chain_root_id || parent.invoice_id;
  const continuationDescription =
    (await resolveInvoiceDisplayDescription(client, parent)) || null;

  const newInv = await insertInvoiceWithArNumber(
    client,
    `INSERT INTO invoicestbl (
      invoice_description, branch_id, amount, status, remarks, issue_date, due_date, created_by,
      package_id, promo_id, installmentinvoiceprofiles_id, ack_receipt_id,
      parent_invoice_id, invoice_chain_root_id, invoice_ar_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING *`,
    [
      continuationDescription,
      parent.branch_id || null,
      rb,
      'Partially Paid',
      parent.remarks || null,
      issueDateYmd || parent.issue_date,
      parent.due_date || null,
      createdBy,
      parent.package_id || null,
      parent.promo_id || null,
      parent.installmentinvoiceprofiles_id || null,
      parent.ack_receipt_id || null,
      parent.invoice_id,
      chainRoot,
    ]
  );

  await client.query(
    `INSERT INTO invoiceitemstbl (invoice_id, description, amount, tax_item, tax_percentage, discount_amount, penalty_amount)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      newInv.invoice_id,
      `Remaining balance (from invoice INV-${parent.invoice_id})`,
      rb,
      null,
      0,
      0,
      0,
    ]
  );

  const studs = await client.query(`SELECT student_id FROM invoicestudentstbl WHERE invoice_id = $1`, [
    parent.invoice_id,
  ]);
  for (const s of studs.rows) {
    await client.query(`INSERT INTO invoicestudentstbl (invoice_id, student_id) VALUES ($1, $2)`, [
      newInv.invoice_id,
      s.student_id,
    ]);
  }

  await client.query(
    `UPDATE invoicestbl SET balance_invoice_id = $1, status = 'Balance Invoiced', amount = 0 WHERE invoice_id = $2`,
    [newInv.invoice_id, parent.invoice_id]
  );

  if (parent.installmentinvoiceprofiles_id) {
    const prof = await client.query(
      `SELECT installmentinvoiceprofiles_id, downpayment_invoice_id FROM installmentinvoiceprofilestbl
       WHERE installmentinvoiceprofiles_id = $1`,
      [parent.installmentinvoiceprofiles_id]
    );
    if (prof.rows[0] && Number(prof.rows[0].downpayment_invoice_id) === Number(parent.invoice_id)) {
      await client.query(
        `UPDATE installmentinvoiceprofilestbl SET downpayment_invoice_id = $1 WHERE installmentinvoiceprofiles_id = $2`,
        [newInv.invoice_id, parent.installmentinvoiceprofiles_id]
      );
    }
  }

  return { balance_invoice_id: newInv.invoice_id };
}
