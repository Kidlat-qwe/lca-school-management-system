/**
 * Miguel Achilles Bulaong (gbulaong1994@icloud.com, user 522) —
 * VMM Playgroup TTh 1:00 PM (class 94) · Profile 305 · Branch 1 (Malolos)
 *
 * Phase 5 INV-2216 → INV-2442: ₱5,146 paid + ₱514.60 late penalty (10%) left
 * Partially Paid UI; delinquency drop on Phase 5 (CS 2255). Phase 6 INV-2620
 * includes penalty and stays locked until Phase 5 is fully settled.
 *
 * Target:
 *   - Waive late penalty on Phase 5 chain; delete balance leaf INV-2442
 *   - INV-2216 → Paid (PAY-2006 ₱5,146)
 *   - Phase 5 CS 2255: dropped → re_enrolled (clear removed_*)
 *   - Clear penalty on Phase 6 INV-2620 → Unpaid ₱5,146
 *   - Reactivate installment profile if inactive
 *
 * Run (from backend/):
 *   node scripts/repairMiguelBulaongPhase5PenaltyUndrop.js --production
 *   node scripts/repairMiguelBulaongPhase5PenaltyUndrop.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { getChainFinancialSummary, parseTargetPhase } from '../utils/balanceInvoice.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';
import { syncInstallmentEnrollmentForPaidInvoice } from '../utils/installmentEnrollmentSync.js';

const STUDENT_ID = 522;
const STUDENT_EMAIL = 'gbulaong1994@icloud.com';
const PROFILE_ID = 305;
const CLASS_ID = 94;
const BRANCH_ID = 1;

const PHASE5_PARENT_INVOICE_ID = 2216;
const PHASE5_LEAF_INVOICE_ID = 2442;
const PHASE5_CLASSSTUDENT_ID = 2255;
const PHASE5_PAYMENT_ID = 2006;

const PHASE6_INVOICE_ID = 2620;

const PHASE_FEE = 5146;
const EXPECTED_PENALTY = 514.6;
const PAYMENT_AR = '261881';

const REPAIR_NOTE =
  'Ops repair 2026-09-16 — Miguel Bulaong P5 waive late penalty; Paid; undrop re_enrolled';

const isApply = process.argv.includes('--apply');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function appendNote(existing, note, maxLen = 255) {
  const cur = String(existing || '').trim();
  const add = String(note || '').trim();
  if (!add) return cur || null;
  if (cur.toLowerCase().includes(add.toLowerCase())) return cur;
  if (!cur) return add.length <= maxLen ? add : add.slice(0, maxLen);
  const joined = `${cur} | ${add}`;
  return joined.length <= maxLen ? joined : joined.slice(0, maxLen);
}

async function sumItemsGrand(client, invoiceId) {
  const r = await client.query(
    `SELECT COALESCE(SUM(COALESCE(amount, 0) - COALESCE(discount_amount, 0) + COALESCE(penalty_amount, 0)), 0) AS grand
     FROM invoiceitemstbl WHERE invoice_id = $1`,
    [invoiceId]
  );
  return round2(r.rows[0]?.grand);
}

async function waiveLatePenaltyAlignBase(client, invoiceId, baseAmount) {
  const items = await client.query(
    `SELECT invoice_item_id, amount, discount_amount, penalty_amount
     FROM invoiceitemstbl WHERE invoice_id = $1 ORDER BY invoice_item_id`,
    [invoiceId]
  );
  if (!items.rows.length) throw new Error(`INV-${invoiceId} has no invoice items`);

  for (const item of items.rows) {
    if (round2(item.penalty_amount) > 0) {
      await client.query(
        `UPDATE invoiceitemstbl SET penalty_amount = 0 WHERE invoice_item_id = $1`,
        [item.invoice_item_id]
      );
    }
  }

  let grand = await sumItemsGrand(client, invoiceId);
  if (Math.abs(grand - baseAmount) > 0.01) {
    const primary = items.rows[0];
    await client.query(
      `UPDATE invoiceitemstbl
       SET amount = $1, discount_amount = 0, penalty_amount = 0
       WHERE invoice_item_id = $2`,
      [baseAmount, primary.invoice_item_id]
    );
    for (const item of items.rows.slice(1)) {
      await client.query(
        `UPDATE invoiceitemstbl
         SET amount = 0, discount_amount = 0, penalty_amount = 0
         WHERE invoice_item_id = $1`,
        [item.invoice_item_id]
      );
    }
    grand = await sumItemsGrand(client, invoiceId);
  }

  await client.query(
    `UPDATE invoicestbl
     SET amount = $1, late_penalty_applied_for_due_date = NULL
     WHERE invoice_id = $2`,
    [grand, invoiceId]
  );
  return grand;
}

async function deleteBalanceLeaf(client, leafInvoiceId) {
  const payments = await client.query(
    `SELECT payment_id, status, approval_status FROM paymenttbl WHERE invoice_id = $1`,
    [leafInvoiceId]
  );
  const blocking = payments.rows.filter(
    (p) =>
      String(p.status) === 'Completed' && String(p.approval_status || '') !== 'Rejected'
  );
  if (blocking.length) {
    throw new Error(
      `Leaf INV-${leafInvoiceId} has ${blocking.length} completed payment(s); refuse delete`
    );
  }

  await client.query(`DELETE FROM program_payment_statustbl WHERE invoice_id = $1`, [
    leafInvoiceId,
  ]);
  await client.query(`DELETE FROM invoicestudentstbl WHERE invoice_id = $1`, [leafInvoiceId]);
  await client.query(`DELETE FROM invoiceitemstbl WHERE invoice_id = $1`, [leafInvoiceId]);
  await client.query(
    `UPDATE invoicestbl SET balance_invoice_id = NULL WHERE balance_invoice_id = $1`,
    [leafInvoiceId]
  );
  await client.query(`DELETE FROM invoicestbl WHERE invoice_id = $1`, [leafInvoiceId]);
}

async function clearPenaltyOnInvoice(client, invoiceId, baseAmount) {
  const penaltyItems = (
    await client.query(
      `SELECT invoice_item_id FROM invoiceitemstbl
       WHERE invoice_id = $1 AND COALESCE(penalty_amount, 0) > 0`,
      [invoiceId]
    )
  ).rows;
  for (const row of penaltyItems) {
    await client.query(
      `UPDATE invoiceitemstbl SET amount = 0, penalty_amount = 0 WHERE invoice_item_id = $1`,
      [row.invoice_item_id]
    );
  }
  const grand = await waiveLatePenaltyAlignBase(client, invoiceId, baseAmount);
  await client.query(
    `UPDATE invoicestbl
     SET status = 'Unpaid',
         amount = $1,
         late_penalty_applied_for_due_date = NULL
     WHERE invoice_id = $2`,
    [grand, invoiceId]
  );
  return grand;
}

async function loadInvoiceSnapshot(client, invoiceId) {
  const r = await client.query(
    `SELECT invoice_id, status, amount::float AS amount, balance_invoice_id,
            invoice_ar_number, remarks,
            TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue,
            TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due
     FROM invoicestbl WHERE invoice_id = $1`,
    [invoiceId]
  );
  const row = r.rows[0];
  if (row) row.phase = parseTargetPhase(row.remarks);
  return row;
}

async function main() {
  console.log(
    `\nMiguel Bulaong — Phase 5 penalty waive + undrop re_enrolled${
      isApply ? ' (APPLY)' : ' (DRY RUN)'
    }\n`
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
        `SELECT user_id, full_name, email FROM userstbl
         WHERE user_id = $1 AND LOWER(TRIM(email)) = LOWER(TRIM($2)) AND user_type = 'Student'`,
        [STUDENT_ID, STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student) throw new Error('Student not found');

    const profile = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id, student_id, class_id, is_active, generated_count,
                phase_start, total_phases
         FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1 AND student_id = $2 AND class_id = $3`,
        [PROFILE_ID, STUDENT_ID, CLASS_ID]
      )
    ).rows[0];
    if (!profile) throw new Error(`Profile ${PROFILE_ID} not found`);

    const parentBefore = await loadInvoiceSnapshot(client, PHASE5_PARENT_INVOICE_ID);
    const leafBefore = await loadInvoiceSnapshot(client, PHASE5_LEAF_INVOICE_ID);
    const phase6Before = await loadInvoiceSnapshot(client, PHASE6_INVOICE_ID);

    if (!parentBefore) throw new Error(`INV-${PHASE5_PARENT_INVOICE_ID} missing`);
    if (!leafBefore) throw new Error(`INV-${PHASE5_LEAF_INVOICE_ID} missing`);
    if (Number(parentBefore.balance_invoice_id) !== PHASE5_LEAF_INVOICE_ID) {
      throw new Error(
        `Expected parent balance_invoice_id=${PHASE5_LEAF_INVOICE_ID}, got ${parentBefore.balance_invoice_id}`
      );
    }
    if (parentBefore.phase !== 5) {
      throw new Error(`Parent phase ${parentBefore.phase} ≠ 5`);
    }

    const payment = (
      await client.query(
        `SELECT payment_id, invoice_id, payable_amount::float AS payable_amount, status, approval_status
         FROM paymenttbl WHERE payment_id = $1`,
        [PHASE5_PAYMENT_ID]
      )
    ).rows[0];
    if (!payment || Number(payment.invoice_id) !== PHASE5_PARENT_INVOICE_ID) {
      throw new Error(`PAY-${PHASE5_PAYMENT_ID} not on INV-${PHASE5_PARENT_INVOICE_ID}`);
    }
    if (Math.abs(round2(payment.payable_amount) - PHASE_FEE) > 0.01) {
      throw new Error(`Payment amount ${payment.payable_amount} ≠ ${PHASE_FEE}`);
    }

    const csBefore = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status AS status,
                TO_CHAR(TIMEZONE('Asia/Manila', removed_at), 'YYYY-MM-DD') AS removed,
                LEFT(COALESCE(removed_reason, ''), 80) AS removed_reason
         FROM classstudentstbl WHERE classstudent_id = $1 AND student_id = $2`,
        [PHASE5_CLASSSTUDENT_ID, STUDENT_ID]
      )
    ).rows[0];
    if (!csBefore || Number(csBefore.phase_number) !== 5) {
      throw new Error(`CS ${PHASE5_CLASSSTUDENT_ID} missing or not phase 5`);
    }
    if (String(csBefore.status) !== 'dropped') {
      console.warn(`⚠️ Phase 5 enrollment status is "${csBefore.status}", expected dropped`);
    }

    const chainBefore = await getChainFinancialSummary(client, PHASE5_PARENT_INVOICE_ID);
    console.log('Student:', student.full_name, student.email);
    console.log('Profile is_active:', profile.is_active, '| generated_count:', profile.generated_count);
    console.log('\nBEFORE — Phase 5 chain:');
    console.table([parentBefore, leafBefore]);
    console.log('Chain financial:', chainBefore);
    console.log('Phase 5 enrollment:', csBefore);
    if (phase6Before) {
      console.log('Phase 6 invoice BEFORE:', phase6Before);
    }

    const parentGrandBefore = await sumItemsGrand(client, PHASE5_PARENT_INVOICE_ID);
    const leafGrandBefore = await sumItemsGrand(client, PHASE5_LEAF_INVOICE_ID);
    if (Math.abs(parentGrandBefore + leafGrandBefore - (PHASE_FEE + EXPECTED_PENALTY)) > 0.05) {
      console.warn(
        `⚠️ Combined obligation ${parentGrandBefore + leafGrandBefore} ≠ ${PHASE_FEE + EXPECTED_PENALTY}`
      );
    }

    // --- Repairs ---
    const alignedParent = await waiveLatePenaltyAlignBase(
      client,
      PHASE5_PARENT_INVOICE_ID,
      PHASE_FEE
    );
    if (Math.abs(alignedParent - PHASE_FEE) > 0.01) {
      throw new Error(`Parent grand ${alignedParent} ≠ ${PHASE_FEE}`);
    }
    console.log(`→ INV-${PHASE5_PARENT_INVOICE_ID} penalty waived; items grand ₱${alignedParent}`);

    await client.query(
      `UPDATE invoicestbl SET balance_invoice_id = NULL WHERE invoice_id = $1`,
      [PHASE5_PARENT_INVOICE_ID]
    );
    await deleteBalanceLeaf(client, PHASE5_LEAF_INVOICE_ID);
    console.log(`→ Deleted balance leaf INV-${PHASE5_LEAF_INVOICE_ID}`);

    await client.query(
      `UPDATE invoicestbl
       SET status = 'Paid',
           amount = 0,
           invoice_ar_number = COALESCE(invoice_ar_number, $2),
           late_penalty_applied_for_due_date = NULL,
           remarks = CASE
             WHEN remarks IS NULL OR BTRIM(remarks) = '' THEN $3
             WHEN remarks LIKE '%' || $3 || '%' THEN remarks
             ELSE LEFT(remarks || ';' || $3, 2000)
           END
       WHERE invoice_id = $1`,
      [PHASE5_PARENT_INVOICE_ID, PAYMENT_AR, REPAIR_NOTE]
    );
    console.log(`→ INV-${PHASE5_PARENT_INVOICE_ID} → Paid`);

    await syncProgramPaymentStatusForInvoice(client, PHASE5_PARENT_INVOICE_ID);

    const csRow = (
      await client.query(
        `SELECT classstudent_id, program_enrollment_status, enrolled_by
         FROM classstudentstbl WHERE classstudent_id = $1`,
        [PHASE5_CLASSSTUDENT_ID]
      )
    ).rows[0];
    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 're_enrolled',
           enrolled_by = $1,
           removed_at = NULL,
           removed_reason = NULL,
           removed_by = NULL
       WHERE classstudent_id = $2`,
      [appendNote(csRow?.enrolled_by, REPAIR_NOTE), PHASE5_CLASSSTUDENT_ID]
    );
    console.log(`→ CS ${PHASE5_CLASSSTUDENT_ID} Phase 5: dropped → re_enrolled`);

    const parentInvRow = (
      await client.query(`SELECT * FROM invoicestbl WHERE invoice_id = $1`, [
        PHASE5_PARENT_INVOICE_ID,
      ])
    ).rows[0];
    await syncInstallmentEnrollmentForPaidInvoice({
      client,
      profileId: PROFILE_ID,
      profile,
      studentId: STUDENT_ID,
      sourceLabel: REPAIR_NOTE,
      invoice: parentInvRow,
    });

    if (phase6Before && phase6Before.phase === 6) {
      const p6Grand = await clearPenaltyOnInvoice(client, PHASE6_INVOICE_ID, PHASE_FEE);
      await syncProgramPaymentStatusForInvoice(client, PHASE6_INVOICE_ID);
      console.log(`→ INV-${PHASE6_INVOICE_ID} penalty cleared → Unpaid ₱${p6Grand}`);
    }

    if (!profile.is_active) {
      await client.query(
        `UPDATE installmentinvoiceprofilestbl SET is_active = true WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      );
      console.log(`→ Profile ${PROFILE_ID} is_active → true`);
    }

    const chainAfter = await getChainFinancialSummary(client, PHASE5_PARENT_INVOICE_ID);
    const parentAfter = await loadInvoiceSnapshot(client, PHASE5_PARENT_INVOICE_ID);
    const leafAfter = await loadInvoiceSnapshot(client, PHASE5_LEAF_INVOICE_ID);
    const phase6After = await loadInvoiceSnapshot(client, PHASE6_INVOICE_ID);
    const csAfter = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status AS status, removed_at
         FROM classstudentstbl WHERE classstudent_id = $1`,
        [PHASE5_CLASSSTUDENT_ID]
      )
    ).rows[0];

    console.log('\nAFTER — Phase 5 parent:', parentAfter);
    console.log('AFTER — Phase 5 leaf exists:', Boolean(leafAfter));
    console.log('Chain financial AFTER:', chainAfter);
    console.log('Phase 5 enrollment AFTER:', csAfter);
    if (phase6After) console.log('Phase 6 invoice AFTER:', phase6After);

    if (round2(chainAfter.remaining_on_leaf) > 0.01) {
      throw new Error(`Chain still has remaining ${chainAfter.remaining_on_leaf}`);
    }
    if (String(parentAfter?.status) !== 'Paid') {
      throw new Error(`Parent status ${parentAfter?.status} ≠ Paid`);
    }
    if (String(csAfter?.status) !== 're_enrolled') {
      throw new Error(`Phase 5 status ${csAfter?.status} ≠ re_enrolled`);
    }

    if (isApply) {
      await client.query('COMMIT');
      console.log('\n✅ Applied. Phase 5 is Paid; enrollment re_enrolled; partial penalty removed.');
    } else {
      await client.query('ROLLBACK');
      console.log('\nDry run only (rolled back). Re-run with --production --apply to commit.');
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
