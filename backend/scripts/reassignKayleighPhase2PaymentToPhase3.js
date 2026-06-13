/**
 * One-off: Kayleigh Beatrix Jao (user_id 82) — payment on Phase 2 belongs to Phase 3.
 *
 * Before:
 *   Phase 1 (INV-143) — Paid
 *   Phase 2 (INV-806) — Paid (payment 693, ₱5,000)  ← mis-posted
 *   Phase 3 (INV-1206) — Unpaid/Overdue with ₱500 penalty
 *
 * After:
 *   Phase 1 — Paid
 *   Phase 2 — Unpaid (₱5,000, no penalty)
 *   Phase 3 — Paid (payment 693 reassigned, penalty removed)
 *
 * Run: node backend/scripts/reassignKayleighPhase2PaymentToPhase3.js
 * Dry: node backend/scripts/reassignKayleighPhase2PaymentToPhase3.js --dry-run
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { deriveInvoiceStatusForInvoice } from '../utils/invoicePaymentStatus.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_ID = 82;
const PAYMENT_ID = 693;
const PHASE2_INVOICE_ID = 806;
const PHASE3_INVOICE_ID = 1206;

const isDryRun = process.argv.includes('--dry-run');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function sumCompletedSettlement(client, invoiceId) {
  const r = await client.query(
    `SELECT COALESCE(SUM(COALESCE(payable_amount, 0) + COALESCE(discount_amount, 0)), 0) AS total
     FROM paymenttbl
     WHERE invoice_id = $1
       AND status = 'Completed'
       AND COALESCE(approval_status, 'Pending') <> 'Rejected'`,
    [invoiceId]
  );
  return parseFloat(r.rows[0]?.total) || 0;
}

async function recomputeInvoiceAmountFromItems(client, invoiceId) {
  const sumResult = await client.query(
    `SELECT
       COALESCE(SUM(amount), 0) AS item_amount,
       COALESCE(SUM(discount_amount), 0) AS total_discount,
       COALESCE(SUM(penalty_amount), 0) AS total_penalty,
       COALESCE(SUM(amount * COALESCE(tax_percentage, 0) / 100), 0) AS total_tax
     FROM invoiceitemstbl WHERE invoice_id = $1`,
    [invoiceId]
  );
  const row = sumResult.rows[0];
  const itemAmount = parseFloat(row?.item_amount) || 0;
  const totalDiscount = parseFloat(row?.total_discount) || 0;
  const totalPenalty = parseFloat(row?.total_penalty) || 0;
  const totalTax = parseFloat(row?.total_tax) || 0;
  return round2(itemAmount - totalDiscount + totalPenalty + totalTax);
}

async function removePenaltyFromInvoice(client, invoiceId) {
  const itemsResult = await client.query(
    `SELECT invoice_item_id, penalty_amount
     FROM invoiceitemstbl
     WHERE invoice_id = $1 AND COALESCE(penalty_amount, 0) > 0`,
    [invoiceId]
  );

  for (const item of itemsResult.rows) {
    await client.query(
      `UPDATE invoiceitemstbl SET amount = 0, penalty_amount = 0 WHERE invoice_item_id = $1`,
      [item.invoice_item_id]
    );
  }

  await client.query(
    `UPDATE invoicestbl SET late_penalty_applied_for_due_date = NULL WHERE invoice_id = $1`,
    [invoiceId]
  );

  return itemsResult.rows.length;
};

async function refreshInvoiceAfterPaymentChange(client, invoiceId) {
  const invRes = await client.query(`SELECT * FROM invoicestbl WHERE invoice_id = $1`, [invoiceId]);
  const invoice = invRes.rows[0];
  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);

  const originalFromItems = await recomputeInvoiceAmountFromItems(client, invoiceId);
  const totalSettled = await sumCompletedSettlement(client, invoiceId);
  const remaining = round2(Math.max(0, originalFromItems - totalSettled));

  const newStatus = await deriveInvoiceStatusForInvoice(client, invoiceId, {
    totalSettled,
    originalInvoiceAmount: originalFromItems,
    previousStatus: invoice.status,
  });

  await client.query(`UPDATE invoicestbl SET amount = $1, status = $2 WHERE invoice_id = $3`, [
    remaining,
    newStatus,
    invoiceId,
  ]);

  await syncProgramPaymentStatusForInvoice(client, invoiceId);

  return { invoiceId, originalFromItems, totalSettled, remaining, newStatus };
}

async function main() {
  const client = await getClient();

  try {
    const verify = await client.query(
      `SELECT p.payment_id, p.invoice_id, p.student_id, p.payable_amount, p.status,
              i.status AS invoice_status, i.remarks
       FROM paymenttbl p
       JOIN invoicestbl i ON i.invoice_id = p.invoice_id
       WHERE p.payment_id = $1`,
      [PAYMENT_ID]
    );

    if (verify.rows.length === 0) {
      console.log(`Payment ${PAYMENT_ID} not found.`);
      return;
    }

    const payment = verify.rows[0];
    if (Number(payment.student_id) !== STUDENT_ID) {
      throw new Error(`Payment ${PAYMENT_ID} student_id mismatch (expected ${STUDENT_ID})`);
    }
    if (Number(payment.invoice_id) !== PHASE2_INVOICE_ID) {
      throw new Error(
        `Payment ${PAYMENT_ID} is on invoice ${payment.invoice_id}, expected ${PHASE2_INVOICE_ID}`
      );
    }

    console.log('Current payment:', payment);
    console.log(isDryRun ? 'DRY RUN — no writes' : 'Applying changes...');

    await client.query('BEGIN');

    if (!isDryRun) {
      await client.query(
        `UPDATE paymenttbl
         SET invoice_id = $1,
             remarks = COALESCE(NULLIF(TRIM(remarks), ''), '') ||
               CASE WHEN remarks IS NULL OR TRIM(remarks) = '' THEN '' ELSE ' | ' END ||
               'Reassigned from Phase 2 (INV-806) to Phase 3 (INV-1206) — ops fix 2026-06-11'
         WHERE payment_id = $2`,
        [PHASE3_INVOICE_ID, PAYMENT_ID]
      );
    }

    const penaltyLinesRemoved = isDryRun
      ? (
          await client.query(
            `SELECT COUNT(*)::int AS c FROM invoiceitemstbl
             WHERE invoice_id = $1 AND COALESCE(penalty_amount, 0) > 0`,
            [PHASE3_INVOICE_ID]
          )
        ).rows[0].c
      : await removePenaltyFromInvoice(client, PHASE3_INVOICE_ID);

    console.log(`Penalty line items cleared on INV-${PHASE3_INVOICE_ID}: ${penaltyLinesRemoved}`);

    let phase2Result;
    let phase3Result;

    if (isDryRun) {
      const p2Items = await recomputeInvoiceAmountFromItems(client, PHASE2_INVOICE_ID);
      const p3Items = await recomputeInvoiceAmountFromItems(client, PHASE3_INVOICE_ID);
      phase2Result = {
        invoiceId: PHASE2_INVOICE_ID,
        originalFromItems: p2Items,
        totalSettled: 0,
        remaining: p2Items,
        newStatus: 'Unpaid',
      };
      phase3Result = {
        invoiceId: PHASE3_INVOICE_ID,
        originalFromItems: p3Items - 500,
        totalSettled: parseFloat(payment.payable_amount),
        remaining: 0,
        newStatus: 'Paid',
      };
    } else {
      phase2Result = await refreshInvoiceAfterPaymentChange(client, PHASE2_INVOICE_ID);
      phase3Result = await refreshInvoiceAfterPaymentChange(client, PHASE3_INVOICE_ID);
    }

    if (isDryRun) {
      await client.query('ROLLBACK');
      console.log('DRY RUN complete (rolled back).');
    } else {
      await client.query('COMMIT');
      console.log('Committed.');
    }

    console.log('Phase 2 (INV-806) after:', phase2Result);
    console.log('Phase 3 (INV-1206) after:', phase3Result);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
