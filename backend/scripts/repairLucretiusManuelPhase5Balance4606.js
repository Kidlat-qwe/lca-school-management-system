/**
 * Lucretius Theodore B Manuel — Phase 5 balance → ₱4,606 (remove late penalty).
 *
 * Student: krisstinamanuel729@gmail.com (user_id 469)
 * Phase 5: INV-1959 (parent, ₱197 paid) → INV-1960 (balance leaf)
 *
 * Issue: INV-1960 still has Late Payment Penalty ₱460.60, so Student History shows
 * Amount ₱5,263.60 / Balance ₱5,066.60 instead of Amount ₱4,803 / Balance ₱4,606.
 *
 * Run:
 *   node backend/scripts/repairLucretiusManuelPhase5Balance4606.js --production
 *   node backend/scripts/repairLucretiusManuelPhase5Balance4606.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const STUDENT_EMAIL = 'krisstinamanuel729@gmail.com';
const PHASE5_PARENT_INVOICE_ID = 1959;
const PHASE5_BALANCE_INVOICE_ID = 1960;
const TARGET_BALANCE = 4606;
const EXPECTED_PENALTY = 460.6;
const REPAIR_NOTE =
  'Ops repair 2026-08-20 — Lucretius Manuel Phase 5: remove late penalty on INV-1960 so balance = 4606';

const isApply = process.argv.includes('--apply');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function invoiceTotals(client, invoiceId) {
  const items = await client.query(
    `SELECT
       COALESCE(SUM(amount), 0) AS subtotal,
       COALESCE(SUM(discount_amount), 0) AS discount,
       COALESCE(SUM(penalty_amount), 0) AS penalty,
       COALESCE(SUM(
         (amount - COALESCE(discount_amount, 0) + COALESCE(penalty_amount, 0))
         * COALESCE(tax_percentage, 0) / 100
       ), 0) AS tax
     FROM invoiceitemstbl WHERE invoice_id = $1`,
    [invoiceId]
  );
  const t = items.rows[0];
  const grand = round2(
    Number(t.subtotal) - Number(t.discount) + Number(t.penalty) + Number(t.tax)
  );
  const paidRes = await client.query(
    `SELECT COALESCE(SUM(payable_amount), 0) AS paid
     FROM paymenttbl
     WHERE invoice_id = $1 AND status = 'Completed'`,
    [invoiceId]
  );
  const paid = round2(paidRes.rows[0]?.paid);
  return {
    subtotal: round2(t.subtotal),
    discount: round2(t.discount),
    penalty: round2(t.penalty),
    tax: round2(t.tax),
    grand,
    paid,
    balance: round2(grand - paid),
  };
}

async function main() {
  console.log(
    `\nLucretius Manuel — Phase 5 balance → ${TARGET_BALANCE}` +
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
         WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))
           AND user_type = 'Student'`,
        [STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student) throw new Error(`Student not found: ${STUDENT_EMAIL}`);
    const studentId = Number(student.user_id);
    console.log('Student:', student.full_name, student.email, `id=${studentId}`);

    const linked = (
      await client.query(
        `SELECT 1 FROM invoicestudentstbl WHERE invoice_id = $1 AND student_id = $2`,
        [PHASE5_PARENT_INVOICE_ID, studentId]
      )
    ).rows[0];
    if (!linked) {
      throw new Error(`INV-${PHASE5_PARENT_INVOICE_ID} not linked to student ${studentId}`);
    }

    const parent = (
      await client.query(
        `SELECT invoice_id, status, balance_invoice_id, amount,
                late_penalty_applied_for_due_date
         FROM invoicestbl WHERE invoice_id = $1`,
        [PHASE5_PARENT_INVOICE_ID]
      )
    ).rows[0];
    if (!parent) throw new Error(`INV-${PHASE5_PARENT_INVOICE_ID} not found`);
    if (Number(parent.balance_invoice_id) !== PHASE5_BALANCE_INVOICE_ID) {
      throw new Error(
        `Expected balance_invoice_id=${PHASE5_BALANCE_INVOICE_ID}, got ${parent.balance_invoice_id}`
      );
    }

    const beforeParent = await invoiceTotals(client, PHASE5_PARENT_INVOICE_ID);
    const beforeLeaf = await invoiceTotals(client, PHASE5_BALANCE_INVOICE_ID);
    const beforePhaseAmount = round2(beforeParent.grand + beforeLeaf.penalty);
    const beforePhaseBalance = round2(beforePhaseAmount - beforeParent.paid);

    console.log('\nBEFORE:');
    console.log(`  INV-${PHASE5_PARENT_INVOICE_ID}:`, beforeParent);
    console.log(`  INV-${PHASE5_BALANCE_INVOICE_ID}:`, beforeLeaf);
    console.log(
      `  Phase 5 UI-style: amount≈${beforePhaseAmount}, paid=${beforeParent.paid}, balance≈${beforePhaseBalance}`
    );

    if (beforeLeaf.penalty <= 0) {
      console.log('\nNo penalty on INV-1960 — nothing to change.');
      await client.query('ROLLBACK');
      return;
    }

    if (Math.abs(beforeLeaf.penalty - EXPECTED_PENALTY) > 0.01) {
      console.warn(
        `⚠️ Penalty is ${beforeLeaf.penalty}, expected ~${EXPECTED_PENALTY}. Continuing for this student only.`
      );
    }

    const penaltyItems = (
      await client.query(
        `SELECT invoice_item_id, description, amount, penalty_amount
         FROM invoiceitemstbl
         WHERE invoice_id = $1 AND COALESCE(penalty_amount, 0) > 0
         ORDER BY invoice_item_id`,
        [PHASE5_BALANCE_INVOICE_ID]
      )
    ).rows;
    console.log('\nPenalty line items to zero:', penaltyItems);

    for (const item of penaltyItems) {
      await client.query(
        `UPDATE invoiceitemstbl
         SET amount = 0, penalty_amount = 0
         WHERE invoice_item_id = $1 AND invoice_id = $2`,
        [item.invoice_item_id, PHASE5_BALANCE_INVOICE_ID]
      );
    }

    const afterLeaf = await invoiceTotals(client, PHASE5_BALANCE_INVOICE_ID);
    await client.query(
      `UPDATE invoicestbl
       SET amount = $1,
           late_penalty_applied_for_due_date = NULL,
           remarks = CASE
             WHEN remarks IS NULL OR BTRIM(remarks) = '' THEN $3
             WHEN remarks LIKE '%' || $3 || '%' THEN remarks
             ELSE remarks || ';' || $3
           END
       WHERE invoice_id = $2`,
      [afterLeaf.grand, PHASE5_BALANCE_INVOICE_ID, REPAIR_NOTE]
    );

    // Clear penalty marker on parent if present
    await client.query(
      `UPDATE invoicestbl
       SET late_penalty_applied_for_due_date = NULL
       WHERE invoice_id = $1`,
      [PHASE5_PARENT_INVOICE_ID]
    );

    const afterParent = await invoiceTotals(client, PHASE5_PARENT_INVOICE_ID);
    const afterPhaseAmount = round2(afterParent.grand + afterLeaf.penalty);
    const afterPhaseBalance = round2(afterPhaseAmount - afterParent.paid);

    console.log('\nAFTER:');
    console.log(`  INV-${PHASE5_PARENT_INVOICE_ID}:`, afterParent);
    console.log(`  INV-${PHASE5_BALANCE_INVOICE_ID}:`, afterLeaf);
    console.log(
      `  Phase 5 UI-style: amount≈${afterPhaseAmount}, paid=${afterParent.paid}, balance≈${afterPhaseBalance}`
    );

    if (Math.abs(afterLeaf.balance - TARGET_BALANCE) > 0.01) {
      throw new Error(
        `Leaf balance ${afterLeaf.balance} != target ${TARGET_BALANCE} — aborting`
      );
    }
    if (Math.abs(afterPhaseBalance - TARGET_BALANCE) > 0.01) {
      throw new Error(
        `Phase balance ${afterPhaseBalance} != target ${TARGET_BALANCE} — aborting`
      );
    }

    if (isApply) {
      await client.query('COMMIT');
      console.log('\n✅ Applied. Phase 5 balance is now ₱4,606.00');
    } else {
      await client.query('ROLLBACK');
      console.log('\nDry run only (rolled back). Re-run with --apply to commit.');
    }
  } catch (err) {
    await client.query('ROLLBACK');
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
