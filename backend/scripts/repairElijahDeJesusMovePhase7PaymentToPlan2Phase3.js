/**
 * Elijah Mikael A. De Jesus (aquinomarielle221@gmail.com) — move mistaken payment.
 *
 * Wrong: Plan 1 (profile 130 / VMP_Nursery_TThS_9:30AM) Phase 7 INV-798
 *        paid with PAY-672 (₱4,999, AR 260455) on 2026-05-05.
 * Correct: Plan 2 (profile 412 / VMP_NURSERY_TThS_11:00 AM) Phase 3 INV-1342
 *          should be Paid with that payment; Plan 1 Phase 7 should be dropped.
 *
 * Notes:
 *   - INV-1342 is currently Rejected (PAY-1123 Rejected — "Double encode").
 *     That rejected payment stays for audit; PAY-672 becomes the settling payment.
 *   - INV-1342 remarks lack TARGET_PHASE; repair appends TARGET_PHASE:3.
 *   - Phase 3 enrollment stays dropped here; a follow-up enrollment script
 *     sets Plan2 Phase3–5 to new / re_enrolled / re_enrolled.
 *   - This student exists on **production** (`psms_production`), not development.
 *
 * Run:
 *   node backend/scripts/repairElijahDeJesusMovePhase7PaymentToPlan2Phase3.js --production
 *   node backend/scripts/repairElijahDeJesusMovePhase7PaymentToPlan2Phase3.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { deriveInvoiceStatusForInvoice } from '../utils/invoicePaymentStatus.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_EMAIL = 'aquinomarielle221@gmail.com';
const STUDENT_ID = 275;

/** Plan 1 (9:30AM) — wrong payment target (drop Phase 7 after move) */
const PLAN1_PROFILE_ID = 130;
const PLAN1_CLASS_ID = 63;
const SOURCE_INVOICE_ID = 798; // Phase 7
const SOURCE_PHASE = 7;
const SOURCE_ENROLLMENT_ID = 694;

/** Plan 2 (11:00AM) — correct payment target */
const PLAN2_PROFILE_ID = 412;
const TARGET_INVOICE_ID = 1342; // Phase 3 (phase_start of Plan 2)
const TARGET_PHASE = 3;
const TARGET_EXISTING_AR = '261005'; // clear before stamping payment AR

const PAYMENT_ID = 672;
const PAYMENT_AMOUNT = 4999.0;
const PAYMENT_AR_NUMBER = '260455';
const PAYMENT_ISSUE_DATE = '2026-05-05';

const REJECTED_PAYMENT_ID = 1123; // stays Rejected on INV-1342

const REPAIR_NOTE =
  'Ops repair 2026-08-01 — Elijah De Jesus move PAY-672 from Plan1 Phase7 INV-798 → Plan2 Phase3 INV-1342; drop Plan1 Phase7';
const isApply = process.argv.includes('--apply');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function loadInvoice(client, invoiceId) {
  const r = await client.query(
    `SELECT invoice_id, status, amount, invoice_ar_number, remarks, branch_id,
            installmentinvoiceprofiles_id AS profile_id,
            TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
            TO_CHAR(due_date, 'YYYY-MM-DD') AS due
     FROM invoicestbl
     WHERE invoice_id = $1`,
    [invoiceId]
  );
  return r.rows[0] || null;
}

async function loadPayment(client, paymentId) {
  const r = await client.query(
    `SELECT payment_id, invoice_id, payable_amount, discount_amount, tip_amount,
            status, approval_status, payment_method, payment_type,
            TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue, reference_number, remarks
     FROM paymenttbl
     WHERE payment_id = $1`,
    [paymentId]
  );
  return r.rows[0] || null;
}

async function sumCompletedSettlement(client, invoiceId) {
  const r = await client.query(
    `SELECT COALESCE(SUM(COALESCE(payable_amount, 0) + COALESCE(discount_amount, 0)), 0) AS total
     FROM paymenttbl
     WHERE invoice_id = $1
       AND status = 'Completed'
       AND COALESCE(approval_status, 'Pending') <> 'Rejected'`,
    [invoiceId]
  );
  return round2(r.rows[0]?.total);
}

function ensureTargetPhaseRemark(remarks, phase) {
  const text = remarks == null ? '' : String(remarks);
  if (parseTargetPhase(text) === phase) return text;
  const tag = `TARGET_PHASE:${phase}`;
  if (!text.trim()) return tag;
  if (/TARGET_PHASE:\d+/i.test(text)) {
    return text.replace(/TARGET_PHASE:\d+/i, tag);
  }
  return `${text};${tag}`;
}

async function main() {
  console.log(
    `\nElijah De Jesus — move Plan1 Phase7 payment → Plan2 Phase3` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);

  if (process.env.DB_NAME !== 'psms_production') {
    console.warn(
      '⚠️ Expected psms_production (this student is not on development). Pass --production.'
    );
  }

  let client;
  try {
    client = await getClient();
    const student = (
      await client.query(
        `SELECT user_id, full_name, email
         FROM userstbl
         WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))`,
        [STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student || Number(student.user_id) !== STUDENT_ID) {
      throw new Error(`Student ${STUDENT_EMAIL} (id ${STUDENT_ID}) not found`);
    }
    console.log('Student:', student.full_name, student.email, `(id ${student.user_id})`);

    const sourceInv = await loadInvoice(client, SOURCE_INVOICE_ID);
    const targetInv = await loadInvoice(client, TARGET_INVOICE_ID);
    const payment = await loadPayment(client, PAYMENT_ID);
    const rejectedPay = await loadPayment(client, REJECTED_PAYMENT_ID);

    if (!sourceInv) throw new Error(`Source INV-${SOURCE_INVOICE_ID} not found`);
    if (!targetInv) throw new Error(`Target INV-${TARGET_INVOICE_ID} not found`);
    if (!payment) throw new Error(`Payment ${PAYMENT_ID} not found`);

    const sourcePhase = parseTargetPhase(sourceInv.remarks);
    const targetPhaseParsed = parseTargetPhase(targetInv.remarks);

    console.log('\nBEFORE — source (Plan 1 Phase 7):');
    console.table([
      {
        inv: sourceInv.invoice_id,
        profile: sourceInv.profile_id,
        phase: sourcePhase,
        status: sourceInv.status,
        amount: sourceInv.amount,
        ar: sourceInv.invoice_ar_number,
        issue: sourceInv.issue,
        due: sourceInv.due,
      },
    ]);
    console.log('BEFORE — target (Plan 2 Phase 3):');
    console.table([
      {
        inv: targetInv.invoice_id,
        profile: targetInv.profile_id,
        phase: targetPhaseParsed,
        status: targetInv.status,
        amount: targetInv.amount,
        ar: targetInv.invoice_ar_number,
        issue: targetInv.issue,
        due: targetInv.due,
      },
    ]);
    console.log('BEFORE — payment to move:');
    console.table([payment]);
    console.log('BEFORE — rejected payment on target (kept):');
    console.table(rejectedPay ? [rejectedPay] : [{ note: '(none)' }]);

    if (Number(sourceInv.profile_id) !== PLAN1_PROFILE_ID) {
      throw new Error(`Source invoice profile ${sourceInv.profile_id} ≠ ${PLAN1_PROFILE_ID}`);
    }
    if (Number(targetInv.profile_id) !== PLAN2_PROFILE_ID) {
      throw new Error(`Target invoice profile ${targetInv.profile_id} ≠ ${PLAN2_PROFILE_ID}`);
    }
    if (sourcePhase !== SOURCE_PHASE) {
      throw new Error(`Source phase ${sourcePhase} ≠ ${SOURCE_PHASE}`);
    }
    // Target may lack TARGET_PHASE today; profile phase_start = 3 is authoritative
    if (targetPhaseParsed != null && targetPhaseParsed !== TARGET_PHASE) {
      throw new Error(`Target phase ${targetPhaseParsed} ≠ ${TARGET_PHASE}`);
    }
    if (Number(payment.invoice_id) !== SOURCE_INVOICE_ID) {
      throw new Error(
        `Payment ${PAYMENT_ID} is on INV-${payment.invoice_id}, expected INV-${SOURCE_INVOICE_ID}`
      );
    }
    if (round2(payment.payable_amount) !== PAYMENT_AMOUNT) {
      throw new Error(
        `Payment amount ${payment.payable_amount} ≠ expected ${PAYMENT_AMOUNT}`
      );
    }
    if (payment.status !== 'Completed' || payment.approval_status !== 'Approved') {
      throw new Error(
        `Payment not Completed/Approved (status=${payment.status}, approval=${payment.approval_status})`
      );
    }
    if (String(payment.issue) !== PAYMENT_ISSUE_DATE) {
      console.warn(
        `⚠️ Payment issue_date is ${payment.issue}, expected ${PAYMENT_ISSUE_DATE} (continuing)`
      );
    }
    if (String(sourceInv.invoice_ar_number || '') !== PAYMENT_AR_NUMBER) {
      throw new Error(
        `Source AR ${sourceInv.invoice_ar_number} ≠ expected ${PAYMENT_AR_NUMBER}`
      );
    }
    if (
      rejectedPay &&
      (Number(rejectedPay.invoice_id) !== TARGET_INVOICE_ID ||
        rejectedPay.status !== 'Rejected')
    ) {
      throw new Error(
        `Expected PAY-${REJECTED_PAYMENT_ID} Rejected on INV-${TARGET_INVOICE_ID}`
      );
    }

    const enrollment = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status,
                TO_CHAR(TIMEZONE('Asia/Manila', removed_at), 'YYYY-MM-DD') AS removed
         FROM classstudentstbl
         WHERE classstudent_id = $1`,
        [SOURCE_ENROLLMENT_ID]
      )
    ).rows[0];
    if (!enrollment) throw new Error(`Enrollment ${SOURCE_ENROLLMENT_ID} not found`);
    if (Number(enrollment.phase_number) !== SOURCE_PHASE) {
      throw new Error(
        `Enrollment phase ${enrollment.phase_number} ≠ ${SOURCE_PHASE}`
      );
    }

    const plan2Phase3Enroll = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status,
                TO_CHAR(TIMEZONE('Asia/Manila', removed_at), 'YYYY-MM-DD') AS removed
         FROM classstudentstbl
         WHERE student_id = $1 AND class_id = 53 AND phase_number = $2
         ORDER BY classstudent_id DESC
         LIMIT 1`,
        [STUDENT_ID, TARGET_PHASE]
      )
    ).rows[0];

    console.log('\nPlan 1 Phase 7 enrollment BEFORE:');
    console.table([enrollment]);
    console.log('Plan 2 Phase 3 enrollment BEFORE (left as-is):');
    console.table(plan2Phase3Enroll ? [plan2Phase3Enroll] : [{ note: '(none)' }]);

    const nextRemarks = ensureTargetPhaseRemark(targetInv.remarks, TARGET_PHASE);

    console.log('\nPlanned changes:');
    console.log(
      `  1. Move PAY-${PAYMENT_ID} (₱${PAYMENT_AMOUNT}, AR ${PAYMENT_AR_NUMBER}) ` +
        `INV-${SOURCE_INVOICE_ID} → INV-${TARGET_INVOICE_ID}`
    );
    console.log(
      `  2. Keep PAY-${REJECTED_PAYMENT_ID} Rejected on INV-${TARGET_INVOICE_ID} (audit)`
    );
    console.log(
      `  3. Clear source AR, restore INV-${SOURCE_INVOICE_ID} to Unpaid ₱${PAYMENT_AMOUNT}`
    );
    console.log(
      `  4. Clear target AR ${TARGET_EXISTING_AR}, mark INV-${TARGET_INVOICE_ID} Paid / AR ${PAYMENT_AR_NUMBER}`
    );
    console.log(`  5. Tag INV-${TARGET_INVOICE_ID} remarks with TARGET_PHASE:${TARGET_PHASE}`);
    console.log(
      `  6. Drop Plan1 Phase7 enrollment classstudent_id=${SOURCE_ENROLLMENT_ID}`
    );
    console.log(`  7. Sync program_payment_status for both invoices`);
    console.log(
      `  8. Do NOT re-activate Plan2 Phase3 enrollment (historical drop; later rejoined at Phase 4+)`
    );

    if (!isApply) {
      console.log('\nDry run only — no writes. Re-run with --apply to commit.');
      return;
    }

    await client.query('BEGIN');

    await client.query(
      `UPDATE paymenttbl
       SET invoice_id = $1,
           remarks = CASE
             WHEN remarks IS NULL OR TRIM(remarks) = '' THEN $2
             ELSE remarks || ' | ' || $2
           END
       WHERE payment_id = $3
         AND invoice_id = $4`,
      [TARGET_INVOICE_ID, REPAIR_NOTE, PAYMENT_ID, SOURCE_INVOICE_ID]
    );
    console.log(`✅ Moved PAY-${PAYMENT_ID} → INV-${TARGET_INVOICE_ID}`);

    // Clear AR on source FIRST — invoice_ar_number is globally unique
    await client.query(
      `UPDATE invoicestbl
       SET status = 'Unpaid',
           amount = $1,
           invoice_ar_number = NULL
       WHERE invoice_id = $2`,
      [PAYMENT_AMOUNT, SOURCE_INVOICE_ID]
    );
    console.log(`✅ INV-${SOURCE_INVOICE_ID} → Unpaid ₱${PAYMENT_AMOUNT}, AR cleared`);

    // Clear existing target AR before stamping payment AR
    if (String(targetInv.invoice_ar_number || '') === TARGET_EXISTING_AR) {
      await client.query(
        `UPDATE invoicestbl
         SET invoice_ar_number = NULL
         WHERE invoice_id = $1`,
        [TARGET_INVOICE_ID]
      );
      console.log(`✅ Cleared prior AR ${TARGET_EXISTING_AR} from INV-${TARGET_INVOICE_ID}`);
    }

    const arUpdate = await client.query(
      `UPDATE acknowledgement_receiptstbl
       SET invoice_id = $1,
           payment_id = COALESCE(payment_id, $2)
       WHERE ack_receipt_number = $3
       RETURNING ack_receipt_id, ack_receipt_number, invoice_id, payment_id`,
      [TARGET_INVOICE_ID, PAYMENT_ID, PAYMENT_AR_NUMBER]
    );
    if (arUpdate.rows.length) {
      console.log('✅ Updated AR row(s):');
      console.table(arUpdate.rows);
    } else {
      console.log(
        `ℹ️ No acknowledgement_receiptstbl row for AR ${PAYMENT_AR_NUMBER} (invoice_ar_number only)`
      );
    }

    await client.query(
      `UPDATE invoicestbl
       SET status = 'Paid',
           amount = 0,
           invoice_ar_number = $1,
           remarks = $2
       WHERE invoice_id = $3`,
      [PAYMENT_AR_NUMBER, nextRemarks, TARGET_INVOICE_ID]
    );
    console.log(
      `✅ INV-${TARGET_INVOICE_ID} → Paid / AR ${PAYMENT_AR_NUMBER} / TARGET_PHASE:${TARGET_PHASE}`
    );

    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 'dropped',
           removed_at = ($1::timestamp AT TIME ZONE 'Asia/Manila'),
           removed_reason = $2,
           removed_by = NULL
       WHERE classstudent_id = $3
         AND student_id = $4
         AND class_id = $5`,
      [
        `${PAYMENT_ISSUE_DATE} 12:00:00`,
        REPAIR_NOTE,
        SOURCE_ENROLLMENT_ID,
        STUDENT_ID,
        PLAN1_CLASS_ID,
      ]
    );
    console.log(`✅ Dropped Plan1 Phase7 enrollment ${SOURCE_ENROLLMENT_ID}`);

    const sourceSettled = await sumCompletedSettlement(client, SOURCE_INVOICE_ID);
    const sourceStatus = await deriveInvoiceStatusForInvoice(client, SOURCE_INVOICE_ID, {
      totalSettled: sourceSettled,
      originalInvoiceAmount: PAYMENT_AMOUNT,
      previousStatus: 'Unpaid',
    });
    await client.query(`UPDATE invoicestbl SET status = $1::text WHERE invoice_id = $2`, [
      sourceStatus,
      SOURCE_INVOICE_ID,
    ]);

    const targetSettled = await sumCompletedSettlement(client, TARGET_INVOICE_ID);
    const targetStatus = await deriveInvoiceStatusForInvoice(client, TARGET_INVOICE_ID, {
      totalSettled: targetSettled,
      originalInvoiceAmount: PAYMENT_AMOUNT,
      previousStatus: 'Paid',
    });
    const targetAmount = targetStatus === 'Paid' ? 0 : PAYMENT_AMOUNT;
    await client.query(
      `UPDATE invoicestbl
       SET status = $1::text,
           amount = $2::numeric
       WHERE invoice_id = $3`,
      [targetStatus, targetAmount, TARGET_INVOICE_ID]
    );
    console.log(
      `✅ Derived statuses: INV-${SOURCE_INVOICE_ID}=${sourceStatus}, INV-${TARGET_INVOICE_ID}=${targetStatus}`
    );

    await syncProgramPaymentStatusForInvoice(client, SOURCE_INVOICE_ID);
    await syncProgramPaymentStatusForInvoice(client, TARGET_INVOICE_ID);
    console.log('✅ Synced program_payment_status');

    await client.query('COMMIT');

    const afterSource = await loadInvoice(client, SOURCE_INVOICE_ID);
    const afterTarget = await loadInvoice(client, TARGET_INVOICE_ID);
    const afterPay = await loadPayment(client, PAYMENT_ID);
    const afterRejected = await loadPayment(client, REJECTED_PAYMENT_ID);
    const afterEnroll = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status,
                TO_CHAR(TIMEZONE('Asia/Manila', removed_at), 'YYYY-MM-DD') AS removed
         FROM classstudentstbl WHERE classstudent_id = $1`,
        [SOURCE_ENROLLMENT_ID]
      )
    ).rows[0];

    console.log('\nAFTER — source INV:');
    console.table([
      {
        ...afterSource,
        phase: parseTargetPhase(afterSource?.remarks),
      },
    ]);
    console.log('AFTER — target INV:');
    console.table([
      {
        ...afterTarget,
        phase: parseTargetPhase(afterTarget?.remarks),
      },
    ]);
    console.log('AFTER — moved payment:');
    console.table([afterPay]);
    console.log('AFTER — rejected payment (unchanged invoice):');
    console.table([afterRejected]);
    console.log('AFTER — Plan1 Phase7 enrollment:');
    console.table([afterEnroll]);
    console.log('\n✅ Apply complete.');
  } catch (err) {
    try {
      if (client) await client.query('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    console.error('\n❌ Repair failed:', err.message);
    throw err;
  } finally {
    if (client) client.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
