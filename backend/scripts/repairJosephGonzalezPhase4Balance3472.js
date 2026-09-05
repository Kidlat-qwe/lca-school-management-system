/**
 * Joseph Lee Mykael G. Gonzalez (gergontrucking@gmail.com, user 602) —
 * Phase 4 amount/balance repair (clear compounded late penalties on balance invoice).
 *
 * Profile 449 · TARGET_PHASE:4
 * Chain: INV-2170 (parent, partial) → INV-2412 (leaf balance)
 *
 * Expected UI:
 *   Amount ₱4,236 · Paid ₱764 · Balance ₱3,472 · Partially Paid
 *
 * Current bad leaf: amount ₱45,517.97 from stacked Late Payment Penalty rows
 * on top of the original remaining-balance line (₱3,472).
 *
 * Run (from backend/):
 *   node scripts/repairJosephGonzalezPhase4Balance3472.js --production
 *   node scripts/repairJosephGonzalezPhase4Balance3472.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { getChainFinancialSummary } from '../utils/balanceInvoice.js';

const STUDENT_ID = 602;
const STUDENT_EMAIL = 'gergontrucking@gmail.com';
const PARENT_INVOICE_ID = 2170;
const BALANCE_INVOICE_ID = 2412;
const PHASE_FEE = 4236;
const EXPECTED_PAID = 764;
const TARGET_LEAF_BALANCE = 3472; // 4236 - 764

const REPAIR_NOTE =
  'Ops repair 2026-09-05 — Joseph Gonzalez Phase 4: clear penalty stack on INV-2412; balance 3472 (4236-764)';

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
    `SELECT payment_id, payable_amount, discount_amount, status, approval_status,
            TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue_date
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
      `SELECT invoice_id, invoice_ar_number, amount::text AS amount, status, remarks,
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
      .filter((p) => String(p.status) === 'Completed')
      .reduce(
        (s, p) => s + Number(p.payable_amount || 0) + Number(p.discount_amount || 0),
        0
      )
  );
  return { inv, items, payments, itemTotal, paid };
}

async function main() {
  console.log(
    `\nJoseph Gonzalez Phase 4 → fee ${PHASE_FEE}, paid ${EXPECTED_PAID}, balance ${TARGET_LEAF_BALANCE}` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`Note: ${REPAIR_NOTE}`);
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);
  if (process.env.DB_NAME !== 'psms_production') {
    console.warn('⚠️ Expected psms_production. Pass --production.');
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const student = (
      await client.query(
        `SELECT user_id, full_name, email
         FROM userstbl
         WHERE user_id = $1 AND LOWER(TRIM(email)) = LOWER(TRIM($2))`,
        [STUDENT_ID, STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student) throw new Error(`Student ${STUDENT_ID} / ${STUDENT_EMAIL} not found`);
    console.log('Student:', student.full_name, student.email);

    for (const id of [PARENT_INVOICE_ID, BALANCE_INVOICE_ID]) {
      const linked = (
        await client.query(
          `SELECT 1 FROM invoicestudentstbl WHERE invoice_id = $1 AND student_id = $2`,
          [id, STUDENT_ID]
        )
      ).rows[0];
      if (!linked) throw new Error(`INV-${id} not linked to student ${STUDENT_ID}`);
    }

    const parentSnap = await invoiceSnapshot(client, PARENT_INVOICE_ID);
    const leafSnap = await invoiceSnapshot(client, BALANCE_INVOICE_ID);
    if (!parentSnap) throw new Error(`INV-${PARENT_INVOICE_ID} not found`);
    if (!leafSnap) throw new Error(`INV-${BALANCE_INVOICE_ID} not found`);

    console.log('\n=== PARENT INV-2170 ===');
    console.log(parentSnap.inv);
    console.table(
      parentSnap.items.map((it) => ({
        id: it.invoice_item_id,
        description: it.description,
        amount: it.amount,
        penalty: it.penalty_amount,
      }))
    );
    console.table(parentSnap.payments);
    console.log(`itemTotal=${parentSnap.itemTotal} paid=${parentSnap.paid}`);

    console.log('\n=== LEAF INV-2412 ===');
    console.log(leafSnap.inv);
    console.log(`Leaf line items: ${leafSnap.items.length}`);
    console.table(
      leafSnap.items.map((it) => ({
        id: it.invoice_item_id,
        description: String(it.description || '').slice(0, 50),
        amount: it.amount,
        penalty: it.penalty_amount,
      }))
    );
    console.table(leafSnap.payments.length ? leafSnap.payments : [{ note: '(none)' }]);
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

    if (Math.abs(Number(parentSnap.itemTotal) - PHASE_FEE) > 0.05) {
      throw new Error(
        `Parent item total ${parentSnap.itemTotal} != phase fee ${PHASE_FEE}`
      );
    }

    console.log('\nPlanned:');
    console.log(
      `  1. DELETE all line items on INV-${BALANCE_INVOICE_ID} (${leafSnap.items.length} rows, incl. penalty stack)`
    );
    console.log(
      `  2. INSERT single remaining-balance item ₱${TARGET_LEAF_BALANCE} on INV-${BALANCE_INVOICE_ID}`
    );
    console.log(
      `  3. SET INV-${BALANCE_INVOICE_ID} amount=${TARGET_LEAF_BALANCE}, status=Unpaid (or Partially Paid leaf)`
    );
    console.log(`  4. Keep INV-${PARENT_INVOICE_ID} Partially Paid; payment ₱${EXPECTED_PAID} unchanged`);
    console.log(
      `  5. Expect UI: Amount ₱${PHASE_FEE}, Paid ₱${EXPECTED_PAID}, Balance ₱${TARGET_LEAF_BALANCE}`
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
           status = 'Unpaid',
           late_penalty_applied_for_due_date = NULL,
           remarks = CASE
             WHEN remarks IS NULL OR BTRIM(remarks) = '' THEN $3
             WHEN remarks LIKE '%' || $3 || '%' THEN remarks
             ELSE LEFT(remarks || ';' || $3, 2000)
           END
       WHERE invoice_id = $2`,
      [TARGET_LEAF_BALANCE, BALANCE_INVOICE_ID, REPAIR_NOTE]
    );

    await client.query(
      `UPDATE invoicestbl
       SET amount = 0,
           status = 'Partially Paid',
           late_penalty_applied_for_due_date = NULL
       WHERE invoice_id = $1`,
      [PARENT_INVOICE_ID]
    );

    const chainAfter = await getChainFinancialSummary(client, PARENT_INVOICE_ID);
    console.log('\n=== Chain summary AFTER (in transaction) ===');
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
      `\nPhase 4 UI should show: Amount ₱${PHASE_FEE.toLocaleString()}, Paid ₱${EXPECTED_PAID}, Balance ₱${TARGET_LEAF_BALANCE.toLocaleString()}`
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
