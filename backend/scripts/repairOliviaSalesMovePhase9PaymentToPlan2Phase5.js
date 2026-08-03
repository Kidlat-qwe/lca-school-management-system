/**
 * Olivia Brie Sales (ladypipay24@gmail.com) — move mistaken payment.
 *
 * Wrong: Plan 1 (profile 128 / VMP_Nursery_TThS_9:30AM) Phase 9 INV-1804
 *        paid with PAY-1498 (₱5,146, AR 261470) on 2026-07-04.
 * Correct: Plan 2 (profile 413 / VMP_NURSERY_TThS_11:00 AM) Phase 5 INV-1744
 *          should be Paid with that payment; Plan 1 Phase 9 should be dropped.
 *
 * Notes:
 *   - INV-1744 currently shows ₱5,660.60 (base ₱5,146 + late penalty).
 *     Repair waives the late penalty so settlement matches PAY-1498 and status = Paid.
 *   - This student exists on **production** (`psms_production`), not development.
 *
 * Run:
 *   node backend/scripts/repairOliviaSalesMovePhase9PaymentToPlan2Phase5.js --production
 *   node backend/scripts/repairOliviaSalesMovePhase9PaymentToPlan2Phase5.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { deriveInvoiceStatusForInvoice } from '../utils/invoicePaymentStatus.js';
import { syncInstallmentEnrollmentForPaidInvoice } from '../utils/installmentEnrollmentSync.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_EMAIL = 'ladypipay24@gmail.com';
const STUDENT_ID = 272;

/** Plan 1 — wrong payment target (drop after move) */
const PLAN1_PROFILE_ID = 128;
const PLAN1_CLASS_ID = 63;
const SOURCE_INVOICE_ID = 1804; // Phase 9
const SOURCE_PHASE = 9;
const SOURCE_ENROLLMENT_ID = 1606;

/** Plan 2 — correct payment target */
const PLAN2_PROFILE_ID = 413;
const PLAN2_CLASS_ID = 53;
const TARGET_INVOICE_ID = 1744; // Phase 5
const TARGET_PHASE = 5;

const PAYMENT_ID = 1498;
const PAYMENT_AMOUNT = 5146.0;
const PAYMENT_AR_NUMBER = '261470';
const PAYMENT_ISSUE_DATE = '2026-07-04';

const REPAIR_NOTE =
  'Ops repair 2026-08-01 — Olivia Sales move PAY-1498 from Plan1 Phase9 INV-1804 → Plan2 Phase5 INV-1744; drop Plan1 Phase9';

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

async function sumItemsGrand(client, invoiceId) {
  const r = await client.query(
    `SELECT COALESCE(SUM(COALESCE(amount, 0) - COALESCE(discount_amount, 0) + COALESCE(penalty_amount, 0)), 0) AS grand
     FROM invoiceitemstbl
     WHERE invoice_id = $1`,
    [invoiceId]
  );
  return round2(r.rows[0]?.grand);
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

async function waiveLatePenaltyAlignBase(client, invoiceId, baseAmount) {
  const items = await client.query(
    `SELECT invoice_item_id, amount, discount_amount, penalty_amount
     FROM invoiceitemstbl
     WHERE invoice_id = $1
     ORDER BY invoice_item_id`,
    [invoiceId]
  );
  if (!items.rows.length) {
    throw new Error(`INV-${invoiceId} has no invoice items`);
  }

  // Zero all penalty lines / penalty fields
  for (const item of items.rows) {
    if (round2(item.penalty_amount) > 0) {
      await client.query(
        `UPDATE invoiceitemstbl
         SET penalty_amount = 0
         WHERE invoice_item_id = $1`,
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
     SET amount = $1,
         late_penalty_applied_for_due_date = NULL
     WHERE invoice_id = $2`,
    [grand, invoiceId]
  );
  return grand;
}

async function main() {
  console.log(
    `\nOlivia Sales — move Plan1 Phase9 payment → Plan2 Phase5` +
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

    if (!sourceInv) throw new Error(`Source INV-${SOURCE_INVOICE_ID} not found`);
    if (!targetInv) throw new Error(`Target INV-${TARGET_INVOICE_ID} not found`);
    if (!payment) throw new Error(`Payment ${PAYMENT_ID} not found`);

    const sourcePhase = parseTargetPhase(sourceInv.remarks);
    const targetPhase = parseTargetPhase(targetInv.remarks);

    console.log('\nBEFORE — source (Plan 1 Phase 9):');
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
    console.log('BEFORE — target (Plan 2 Phase 5):');
    console.table([
      {
        inv: targetInv.invoice_id,
        profile: targetInv.profile_id,
        phase: targetPhase,
        status: targetInv.status,
        amount: targetInv.amount,
        ar: targetInv.invoice_ar_number,
        issue: targetInv.issue,
        due: targetInv.due,
        items_grand: await sumItemsGrand(client, TARGET_INVOICE_ID),
      },
    ]);
    console.log('BEFORE — payment:');
    console.table([payment]);

    // Validations
    if (Number(sourceInv.profile_id) !== PLAN1_PROFILE_ID) {
      throw new Error(`Source invoice profile ${sourceInv.profile_id} ≠ ${PLAN1_PROFILE_ID}`);
    }
    if (Number(targetInv.profile_id) !== PLAN2_PROFILE_ID) {
      throw new Error(`Target invoice profile ${targetInv.profile_id} ≠ ${PLAN2_PROFILE_ID}`);
    }
    if (sourcePhase !== SOURCE_PHASE) {
      throw new Error(`Source phase ${sourcePhase} ≠ ${SOURCE_PHASE}`);
    }
    if (targetPhase !== TARGET_PHASE) {
      throw new Error(`Target phase ${targetPhase} ≠ ${TARGET_PHASE}`);
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

    const plan2Phase5Enroll = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status, removed_at
         FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2 AND phase_number = $3
         ORDER BY classstudent_id DESC
         LIMIT 1`,
        [STUDENT_ID, PLAN2_CLASS_ID, TARGET_PHASE]
      )
    ).rows[0];

    console.log('\nPlan 1 Phase 9 enrollment BEFORE:');
    console.table([enrollment]);
    console.log('Plan 2 Phase 5 enrollment BEFORE:');
    console.table(plan2Phase5Enroll ? [plan2Phase5Enroll] : [{ note: '(none yet)' }]);

    const targetGrandBefore = await sumItemsGrand(client, TARGET_INVOICE_ID);
    console.log('\nPlanned changes:');
    console.log(
      `  1. Waive late penalty on INV-${TARGET_INVOICE_ID} (items grand ${targetGrandBefore} → ${PAYMENT_AMOUNT})`
    );
    console.log(
      `  2. Move PAY-${PAYMENT_ID} (₱${PAYMENT_AMOUNT}, AR ${PAYMENT_AR_NUMBER}) ` +
        `INV-${SOURCE_INVOICE_ID} → INV-${TARGET_INVOICE_ID}`
    );
    console.log(
      `  3. Mark INV-${TARGET_INVOICE_ID} Paid (amount 0), stamp invoice_ar_number=${PAYMENT_AR_NUMBER}`
    );
    console.log(
      `  4. Restore INV-${SOURCE_INVOICE_ID} to Unpaid amount ${PAYMENT_AMOUNT}, clear AR`
    );
    console.log(
      `  5. Drop Plan1 Phase9 enrollment classstudent_id=${SOURCE_ENROLLMENT_ID}`
    );
    console.log(`  6. Sync program_payment_status + Plan2 installment enrollment for Phase 5`);
    console.log(`  7. Remap acknowledgement_receiptstbl rows for AR ${PAYMENT_AR_NUMBER} if any`);

    if (!isApply) {
      console.log('\nDry run only — no writes. Re-run with --apply to commit.');
      return;
    }

    await client.query('BEGIN');

    const alignedGrand = await waiveLatePenaltyAlignBase(
      client,
      TARGET_INVOICE_ID,
      PAYMENT_AMOUNT
    );
    if (Math.abs(alignedGrand - PAYMENT_AMOUNT) > 0.01) {
      throw new Error(
        `Failed to align INV-${TARGET_INVOICE_ID} to ${PAYMENT_AMOUNT} (got ${alignedGrand})`
      );
    }
    console.log(`✅ INV-${TARGET_INVOICE_ID} aligned to ₱${alignedGrand} (penalty waived)`);

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
           invoice_ar_number = $1
       WHERE invoice_id = $2`,
      [PAYMENT_AR_NUMBER, TARGET_INVOICE_ID]
    );
    console.log(`✅ INV-${TARGET_INVOICE_ID} → Paid / AR ${PAYMENT_AR_NUMBER}`);

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
    console.log(`✅ Dropped Plan1 Phase9 enrollment ${SOURCE_ENROLLMENT_ID}`);

    // Re-derive statuses from settlement (source unpaid, target paid)
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

    const plan2Profile = (
      await client.query(
        `SELECT * FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`,
        [PLAN2_PROFILE_ID]
      )
    ).rows[0];
    const targetAfter = await loadInvoice(client, TARGET_INVOICE_ID);
    await syncInstallmentEnrollmentForPaidInvoice({
      client,
      profileId: PLAN2_PROFILE_ID,
      profile: plan2Profile,
      studentId: STUDENT_ID,
      sourceLabel: REPAIR_NOTE,
      invoice: targetAfter,
    });
    console.log('✅ Synced Plan2 enrollment for paid Phase 5');

    await client.query('COMMIT');

    const afterSource = await loadInvoice(client, SOURCE_INVOICE_ID);
    const afterTarget = await loadInvoice(client, TARGET_INVOICE_ID);
    const afterPay = await loadPayment(client, PAYMENT_ID);
    const afterEnroll = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status,
                TO_CHAR(TIMEZONE('Asia/Manila', removed_at), 'YYYY-MM-DD') AS removed
         FROM classstudentstbl WHERE classstudent_id = $1`,
        [SOURCE_ENROLLMENT_ID]
      )
    ).rows[0];
    const afterPlan2Enroll = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status,
                TO_CHAR(TIMEZONE('Asia/Manila', removed_at), 'YYYY-MM-DD') AS removed
         FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2 AND phase_number = $3
         ORDER BY classstudent_id DESC LIMIT 1`,
        [STUDENT_ID, PLAN2_CLASS_ID, TARGET_PHASE]
      )
    ).rows[0];

    console.log('\nAFTER — source INV:');
    console.table([afterSource]);
    console.log('AFTER — target INV:');
    console.table([afterTarget]);
    console.log('AFTER — payment:');
    console.table([afterPay]);
    console.log('AFTER — Plan1 Phase9 enrollment:');
    console.table([afterEnroll]);
    console.log('AFTER — Plan2 Phase5 enrollment:');
    console.table(afterPlan2Enroll ? [afterPlan2Enroll] : [{ note: '(none)' }]);
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
