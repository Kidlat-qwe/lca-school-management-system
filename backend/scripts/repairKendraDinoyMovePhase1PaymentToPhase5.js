/**
 * Kendra Rafferty Dinoy — map mistaken Phase-1-looking payment onto Phase 5,
 * then hide Phase 1 again (late-start at Phase 2).
 *
 * Background (after prior late-start repair):
 *   INV-2301 TARGET_PHASE:5 Unpaid (canonical Phase 5)
 *   INV-2402 TARGET_PHASE:5 Paid AR 262068 (duplicate) — UI maps it into Phase 1 slot
 *   PAY-1854 (₱5,146, 2026-08-02) sits on INV-2402
 *
 * Fix:
 *   1. Move PAY-1854 → INV-2301; stamp AR 262068; mark Phase 5 Paid
 *   2. Cancel + detach INV-2402 (so Phase 1 has no invoice → late_start_gap / hidden)
 *   3. Keep Phase 2 new / Phase 3 re_enrolled / Phase 4 dropped / Phase 5 rejoin
 *   4. generated_count 5 → 4
 *
 * Run:
 *   node backend/scripts/repairKendraDinoyMovePhase1PaymentToPhase5.js --production
 *   node backend/scripts/repairKendraDinoyMovePhase1PaymentToPhase5.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { rewriteTargetPhaseInRemarks } from '../utils/installmentPhaseBillingSync.js';
import { deriveInvoiceStatusForInvoice } from '../utils/invoicePaymentStatus.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_EMAIL = 'keel.arcee@gmail.com';
const STUDENT_ID = 536;
const CLASS_ID = 92;
const PROFILE_ID = 325;

const SOURCE_INVOICE_ID = 2402; // duplicate paid (shows as Phase 1 in UI)
const TARGET_INVOICE_ID = 2301; // Phase 5 unpaid
const TARGET_PHASE = 5;
const PAYMENT_ID = 1854;
const PAYMENT_AMOUNT = 5146.0;
const PAYMENT_AR_NUMBER = '262068';
const TARGET_EXISTING_AR = '261966';
const PAYMENT_ISSUE_DATE = '2026-08-02';

const REPAIR_NOTE =
  'Ops repair 2026-08-03 — Kendra Dinoy move PAY-1854 INV-2402 → Phase5 INV-2301; cancel duplicate so Phase1 stays hidden';

const isApply = process.argv.includes('--apply');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function loadInvoice(client, invoiceId) {
  const r = await client.query(
    `SELECT invoice_id, status, amount, invoice_ar_number, remarks,
            installmentinvoiceprofiles_id AS profile_id,
            TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
            TO_CHAR(due_date, 'YYYY-MM-DD') AS due
     FROM invoicestbl WHERE invoice_id = $1`,
    [invoiceId]
  );
  return r.rows[0] || null;
}

async function loadPayment(client, paymentId) {
  const r = await client.query(
    `SELECT payment_id, invoice_id, payable_amount, discount_amount, status, approval_status,
            TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue, reference_number, remarks
     FROM paymenttbl WHERE payment_id = $1`,
    [paymentId]
  );
  return r.rows[0] || null;
}

async function sumCompletedSettlement(client, invoiceId) {
  const r = await client.query(
    `SELECT COALESCE(SUM(COALESCE(payable_amount, 0) + COALESCE(discount_amount, 0)), 0)::numeric AS settled
     FROM paymenttbl
     WHERE invoice_id = $1
       AND status = 'Completed'
       AND COALESCE(approval_status, 'Pending') <> 'Rejected'`,
    [invoiceId]
  );
  return round2(r.rows[0]?.settled);
}

async function main() {
  console.log(
    `\nKendra Dinoy — move INV-2402 payment → Phase 5 INV-2301` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`DB: ${process.env.DB_NAME} | NODE_ENV=${process.env.NODE_ENV}`);

  const client = await getClient();
  try {
    const student = (
      await client.query(
        `SELECT user_id, full_name, email FROM userstbl
         WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))`,
        [STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student || Number(student.user_id) !== STUDENT_ID) {
      throw new Error(`Student ${STUDENT_EMAIL} not found`);
    }
    console.log('Student:', student.full_name, student.email);

    const sourceInv = await loadInvoice(client, SOURCE_INVOICE_ID);
    const targetInv = await loadInvoice(client, TARGET_INVOICE_ID);
    const payment = await loadPayment(client, PAYMENT_ID);
    if (!sourceInv || !targetInv || !payment) {
      throw new Error('Missing source/target invoice or payment');
    }
    if (Number(sourceInv.profile_id) !== PROFILE_ID || Number(targetInv.profile_id) !== PROFILE_ID) {
      throw new Error('Invoice not on profile 325');
    }
    if (Number(payment.invoice_id) !== SOURCE_INVOICE_ID) {
      throw new Error(`PAY-${PAYMENT_ID} is on INV-${payment.invoice_id}, expected ${SOURCE_INVOICE_ID}`);
    }
    if (payment.status !== 'Completed') {
      throw new Error(`Payment status ${payment.status}, expected Completed`);
    }

    const sourcePhase = parseTargetPhase(sourceInv.remarks);
    const targetPhase = parseTargetPhase(targetInv.remarks);
    console.log('\nBEFORE source INV-2402:', {
      status: sourceInv.status,
      ar: sourceInv.invoice_ar_number,
      phase: sourcePhase,
      issue: sourceInv.issue,
    });
    console.log('BEFORE target INV-2301:', {
      status: targetInv.status,
      ar: targetInv.invoice_ar_number,
      phase: targetPhase,
      issue: targetInv.issue,
    });
    console.log('BEFORE payment:', payment);

    const enrollments = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status,
                TO_CHAR(enrolled_at, 'YYYY-MM-DD HH24:MI') AS enrolled,
                TO_CHAR(removed_at, 'YYYY-MM-DD HH24:MI') AS removed
         FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2
         ORDER BY phase_number, classstudent_id`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows;
    console.log('\nEnrollments BEFORE:');
    console.table(enrollments);

    const profile = (
      await client.query(
        `SELECT generated_count, is_active FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];
    console.log('Profile BEFORE:', profile);

    console.log('\nPlanned:');
    console.log(
      `  1. Move PAY-${PAYMENT_ID} (₱${PAYMENT_AMOUNT}, AR ${PAYMENT_AR_NUMBER}) ` +
        `INV-${SOURCE_INVOICE_ID} → INV-${TARGET_INVOICE_ID}`
    );
    console.log(
      `  2. Mark INV-${TARGET_INVOICE_ID} Paid / AR ${PAYMENT_AR_NUMBER} / TARGET_PHASE:${TARGET_PHASE}`
    );
    console.log(
      `  3. Cancel + detach INV-${SOURCE_INVOICE_ID} (removes Phase 1 duplicate display)`
    );
    console.log(`  4. profile.generated_count ${profile.generated_count} → 4`);
    console.log('  5. Keep Phase 2 new / Phase 3 re_enrolled / Phase 4 dropped / Phase 5 rejoin');

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

    // Clear ARs first (unique)
    await client.query(
      `UPDATE invoicestbl SET invoice_ar_number = NULL WHERE invoice_id = $1`,
      [SOURCE_INVOICE_ID]
    );
    if (String(targetInv.invoice_ar_number || '') === TARGET_EXISTING_AR) {
      await client.query(
        `UPDATE invoicestbl SET invoice_ar_number = NULL WHERE invoice_id = $1`,
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
      console.log(`ℹ️ No acknowledgement_receiptstbl row for AR ${PAYMENT_AR_NUMBER}`);
    }

    const targetRemarks = rewriteTargetPhaseInRemarks(
      targetInv.remarks || '',
      TARGET_PHASE
    );
    const targetRemarksNoted = targetRemarks.includes(REPAIR_NOTE)
      ? targetRemarks
      : `${targetRemarks};${REPAIR_NOTE}`;

    await client.query(
      `UPDATE invoicestbl
       SET status = 'Paid',
           amount = 0,
           invoice_ar_number = $1,
           remarks = $2
       WHERE invoice_id = $3`,
      [PAYMENT_AR_NUMBER, targetRemarksNoted, TARGET_INVOICE_ID]
    );
    console.log(
      `✅ INV-${TARGET_INVOICE_ID} → Paid / AR ${PAYMENT_AR_NUMBER} / TARGET_PHASE:${TARGET_PHASE}`
    );

    const sourceRemarks = [sourceInv.remarks, REPAIR_NOTE, 'ORPHAN_DUPLICATE_PHASE5'].filter(Boolean).join(';');
    await client.query(
      `UPDATE invoicestbl
       SET status = 'Cancelled',
           installmentinvoiceprofiles_id = NULL,
           invoice_ar_number = NULL,
           remarks = $1
       WHERE invoice_id = $2`,
      [sourceRemarks, SOURCE_INVOICE_ID]
    );
    console.log(`✅ INV-${SOURCE_INVOICE_ID} cancelled + detached from profile`);

    // Ensure Phase 1 enrollment stays soft-removed (not dropped) for late_start hide
    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 'new',
           removed_at = COALESCE(removed_at, $1::timestamp),
           removed_reason = COALESCE(removed_reason, $2::text),
           removed_by = NULL
       WHERE student_id = $3
         AND class_id = $4
         AND phase_number = 1`,
      [`${PAYMENT_ISSUE_DATE} 12:00:00`, REPAIR_NOTE, STUDENT_ID, CLASS_ID]
    );

    // Phase 5 stays rejoin (first active after Phase 4 drop)
    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 'rejoin',
           removed_at = NULL,
           removed_reason = NULL,
           removed_by = NULL,
           enrolled_by = CASE
             WHEN enrolled_by IS NULL OR TRIM(enrolled_by) = '' THEN $1::text
             WHEN enrolled_by ILIKE '%' || $1::text || '%' THEN enrolled_by
             ELSE enrolled_by || ' | ' || $1::text
           END
       WHERE student_id = $2
         AND class_id = $3
         AND phase_number = 5
         AND removed_at IS NULL`,
      [REPAIR_NOTE, STUDENT_ID, CLASS_ID]
    );

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET generated_count = 4
       WHERE installmentinvoiceprofiles_id = $1`,
      [PROFILE_ID]
    );
    console.log('✅ generated_count → 4');

    const targetSettled = await sumCompletedSettlement(client, TARGET_INVOICE_ID);
    const targetStatus = await deriveInvoiceStatusForInvoice(client, TARGET_INVOICE_ID, {
      totalSettled: targetSettled,
      originalInvoiceAmount: PAYMENT_AMOUNT,
      previousStatus: 'Paid',
    });
    await client.query(
      `UPDATE invoicestbl
       SET status = $1::text,
           amount = $2::numeric
       WHERE invoice_id = $3`,
      [targetStatus, targetStatus === 'Paid' ? 0 : PAYMENT_AMOUNT, TARGET_INVOICE_ID]
    );

    await syncProgramPaymentStatusForInvoice(client, TARGET_INVOICE_ID);
    console.log('✅ Synced program_payment_status for INV-2301');

    const afterTarget = await loadInvoice(client, TARGET_INVOICE_ID);
    const afterSource = await loadInvoice(client, SOURCE_INVOICE_ID);
    const afterPay = await loadPayment(client, PAYMENT_ID);
    const afterPhases = (
      await client.query(
        `SELECT invoice_id, status, invoice_ar_number,
                SUBSTRING(remarks FROM 'TARGET_PHASE:([0-9]+)') AS phase
         FROM invoicestbl
         WHERE installmentinvoiceprofiles_id = $1
           AND COALESCE(status, '') NOT IN ('Cancelled', 'Canceled')
         ORDER BY SUBSTRING(remarks FROM 'TARGET_PHASE:([0-9]+)')::int NULLS FIRST, invoice_id`,
        [PROFILE_ID]
      )
    ).rows;

    console.log('\nAFTER INV-2301:', afterTarget);
    console.log('AFTER INV-2402:', afterSource);
    console.log('AFTER payment:', afterPay);
    console.log('Remaining profile phase invoices:');
    console.table(afterPhases);

    if (Number(afterPay.invoice_id) !== TARGET_INVOICE_ID) {
      throw new Error('Payment not on target invoice');
    }
    if (afterTarget.status !== 'Paid' || afterTarget.invoice_ar_number !== PAYMENT_AR_NUMBER) {
      throw new Error('Target invoice not Paid with expected AR');
    }
    if (afterSource.profile_id != null || afterSource.status !== 'Cancelled') {
      throw new Error('Source invoice not cancelled/detached');
    }
    if (afterPhases.some((r) => Number(r.phase) === 1)) {
      throw new Error('Phase 1 invoice still on profile');
    }
    if (!afterPhases.some((r) => Number(r.invoice_id) === TARGET_INVOICE_ID && Number(r.phase) === 5)) {
      throw new Error('Phase 5 INV-2301 missing on profile');
    }

    await client.query('COMMIT');
    console.log('\nCommitted.');
    console.log('✅ Refresh Student History: Phase 1 hidden; Phase 5 Paid (AR 262068).');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('\n❌ Repair failed:', err?.message || err);
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
