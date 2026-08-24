/**
 * Matteo Arvian Abenion — Phase 2 amount/balance repair.
 *
 * Expected: plan phase fee ₱9,890; partial ₱989; balance ₱8,901.
 * UI currently shows Amount ₱26,384.60 / Paid ₱989 / Balance ₱25,395.60
 * Inv chain: 2084 → 2439
 *
 * Run:
 *   node scripts/repairMatteoAbenionPhase2Balance8901.js --production
 *   node scripts/repairMatteoAbenionPhase2Balance8901.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { getChainFinancialSummary } from '../utils/balanceInvoice.js';

const STUDENT_NAME_ILIKE = '%Matteo%Abenion%';
const PARENT_INVOICE_ID = 2084;
const BALANCE_INVOICE_ID = 2439;
const PHASE_FEE = 9890;
const EXPECTED_PAID = 989;
const TARGET_LEAF_BALANCE = 8901; // 9890 - 989
const REPAIR_NOTE =
  'Ops repair 2026-08-24 — Matteo Abenion Phase 2: set balance INV-2439 to 8901 (9890-989)';

const isApply = process.argv.includes('--apply');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function listItems(client, invoiceId) {
  const r = await client.query(
    `SELECT invoice_item_id, description, amount, discount_amount, penalty_amount, tax_percentage
     FROM invoiceitemstbl
     WHERE invoice_id = $1
     ORDER BY invoice_item_id`,
    [invoiceId]
  );
  return r.rows;
}

async function listPayments(client, invoiceId) {
  const r = await client.query(
    `SELECT payment_id, payable_amount, discount_amount, status, payment_type, issue_date
     FROM paymenttbl
     WHERE invoice_id = $1
     ORDER BY payment_id`,
    [invoiceId]
  );
  return r.rows;
}

async function invoiceSnapshot(client, invoiceId) {
  const inv = (
    await client.query(
      `SELECT invoice_id, invoice_ar_number, amount, status, remarks,
              parent_invoice_id, balance_invoice_id, invoice_chain_root_id,
              installmentinvoiceprofiles_id,
              TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue_date,
              TO_CHAR(due_date, 'YYYY-MM-DD') AS due_date
       FROM invoicestbl WHERE invoice_id = $1`,
      [invoiceId]
    )
  ).rows[0];
  if (!inv) return null;
  const items = await listItems(client, invoiceId);
  const payments = await listPayments(client, invoiceId);
  const itemTotal = round2(
    items.reduce(
      (s, it) =>
        s +
        Number(it.amount || 0) -
        Number(it.discount_amount || 0) +
        Number(it.penalty_amount || 0),
      0
    )
  );
  const paid = round2(
    payments
      .filter((p) => p.status === 'Completed')
      .reduce(
        (s, p) => s + Number(p.payable_amount || 0) + Number(p.discount_amount || 0),
        0
      )
  );
  return { inv, items, payments, itemTotal, paid };
}

async function main() {
  console.log(
    `\nMatteo Abenion Phase 2 → fee ${PHASE_FEE}, paid ${EXPECTED_PAID}, balance ${TARGET_LEAF_BALANCE}` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);
  if (process.env.DB_NAME !== 'psms_production') {
    console.warn('⚠️ Expected psms_production. Pass --production.');
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const students = (
      await client.query(
        `SELECT user_id, full_name, email
         FROM userstbl
         WHERE user_type = 'Student'
           AND full_name ILIKE $1
         ORDER BY user_id`,
        [STUDENT_NAME_ILIKE]
      )
    ).rows;
    if (students.length === 0) throw new Error(`Student not found: ${STUDENT_NAME_ILIKE}`);
    console.log('Student match(es):');
    console.table(students);
    const student = students[0];
    const studentId = Number(student.user_id);

    for (const id of [PARENT_INVOICE_ID, BALANCE_INVOICE_ID]) {
      const linked = (
        await client.query(
          `SELECT 1 FROM invoicestudentstbl WHERE invoice_id = $1 AND student_id = $2`,
          [id, studentId]
        )
      ).rows[0];
      if (!linked) {
        throw new Error(`INV-${id} not linked to student ${studentId}`);
      }
    }

    const parentSnap = await invoiceSnapshot(client, PARENT_INVOICE_ID);
    const leafSnap = await invoiceSnapshot(client, BALANCE_INVOICE_ID);
    if (!parentSnap) throw new Error(`INV-${PARENT_INVOICE_ID} not found`);
    if (!leafSnap) throw new Error(`INV-${BALANCE_INVOICE_ID} not found`);

    console.log('\n=== PARENT INV-2084 ===');
    console.log(parentSnap.inv);
    console.table(parentSnap.items);
    console.table(parentSnap.payments);
    console.log(`itemTotal=${parentSnap.itemTotal} paid=${parentSnap.paid}`);

    console.log('\n=== LEAF INV-2439 ===');
    console.log(leafSnap.inv);
    console.table(leafSnap.items);
    console.table(leafSnap.payments);
    console.log(`itemTotal=${leafSnap.itemTotal} paid=${leafSnap.paid}`);

    if (Number(parentSnap.inv.balance_invoice_id) !== BALANCE_INVOICE_ID) {
      throw new Error(
        `Expected parent.balance_invoice_id=${BALANCE_INVOICE_ID}, got ${parentSnap.inv.balance_invoice_id}`
      );
    }

    const chainBefore = await getChainFinancialSummary(client, PARENT_INVOICE_ID);
    console.log('\n=== Chain summary BEFORE ===');
    console.log({
      root: chainBefore.root_invoice_id,
      leaf: chainBefore.leaf_invoice_id,
      chain_ids: chainBefore.chain_invoice_ids,
      total_paid: chainBefore.total_paid_in_chain,
      remaining_on_leaf: chainBefore.remaining_on_leaf,
      total_obligation: chainBefore.total_obligation,
    });

    const paidOnChain = round2(Number(chainBefore.total_paid_in_chain || 0));
    if (Math.abs(paidOnChain - EXPECTED_PAID) > 0.05) {
      throw new Error(
        `Chain paid ${paidOnChain} != expected ${EXPECTED_PAID} — abort (do not guess)`
      );
    }

    // Repair leaf to TARGET_LEAF_BALANCE: replace line items with a single remaining-balance row.
    console.log(
      `\nPlanned: set INV-${BALANCE_INVOICE_ID} amount + single line item to ${TARGET_LEAF_BALANCE}`
    );

    await client.query(`DELETE FROM invoiceitemstbl WHERE invoice_id = $1`, [
      BALANCE_INVOICE_ID,
    ]);
    await client.query(
      `INSERT INTO invoiceitemstbl (invoice_id, description, amount, tax_item, tax_percentage, discount_amount, penalty_amount)
       VALUES ($1, $2, $3, NULL, 0, 0, 0)`,
      [
        BALANCE_INVOICE_ID,
        `Remaining balance (from invoice INV-${PARENT_INVOICE_ID}) — corrected to phase fee ${PHASE_FEE} minus paid ${EXPECTED_PAID}`,
        TARGET_LEAF_BALANCE,
      ]
    );
    await client.query(
      `UPDATE invoicestbl
       SET amount = $1,
           status = 'Partially Paid',
           late_penalty_applied_for_due_date = NULL,
           remarks = CASE
             WHEN remarks IS NULL OR BTRIM(remarks) = '' THEN $3
             WHEN remarks LIKE '%' || $3 || '%' THEN remarks
             ELSE remarks || ';' || $3
           END
       WHERE invoice_id = $2`,
      [TARGET_LEAF_BALANCE, BALANCE_INVOICE_ID, REPAIR_NOTE]
    );

    // Parent should remain amount=0 / Partially Paid after partial (balance pointer intact)
    await client.query(
      `UPDATE invoicestbl
       SET amount = 0,
           status = 'Partially Paid',
           late_penalty_applied_for_due_date = NULL
       WHERE invoice_id = $1`,
      [PARENT_INVOICE_ID]
    );

    const chainAfter = await getChainFinancialSummary(client, PARENT_INVOICE_ID);
    console.log('\n=== Chain summary AFTER ===');
    console.log({
      root: chainAfter.root_invoice_id,
      leaf: chainAfter.leaf_invoice_id,
      chain_ids: chainAfter.chain_invoice_ids,
      total_paid: chainAfter.total_paid_in_chain,
      remaining_on_leaf: chainAfter.remaining_on_leaf,
      total_obligation: chainAfter.total_obligation,
    });

    const afterPaid = round2(Number(chainAfter.total_paid_in_chain || 0));
    const afterRemaining = round2(Number(chainAfter.remaining_on_leaf || 0));
    const afterObligation = round2(Number(chainAfter.total_obligation || 0));

    if (Math.abs(afterPaid - EXPECTED_PAID) > 0.05) {
      throw new Error(`After paid ${afterPaid} != ${EXPECTED_PAID}`);
    }
    if (Math.abs(afterRemaining - TARGET_LEAF_BALANCE) > 0.05) {
      throw new Error(`After remaining ${afterRemaining} != ${TARGET_LEAF_BALANCE}`);
    }
    if (Math.abs(afterObligation - PHASE_FEE) > 0.05) {
      throw new Error(`After obligation ${afterObligation} != phase fee ${PHASE_FEE}`);
    }

    console.log(
      `\nPhase 2 UI should show: Amount ₱${PHASE_FEE.toLocaleString()}, Paid ₱${EXPECTED_PAID}, Balance ₱${TARGET_LEAF_BALANCE.toLocaleString()}`
    );

    if (isApply) {
      await client.query('COMMIT');
      console.log('\n✅ Applied.');
    } else {
      await client.query('ROLLBACK');
      console.log('\nDry run only (rolled back). Re-run with --apply to commit.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\n❌ Failed:', err.message || err);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
