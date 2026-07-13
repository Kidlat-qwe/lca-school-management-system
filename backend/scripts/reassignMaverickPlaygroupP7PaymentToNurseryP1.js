/**
 * Maverick Raziel Viola Manzanal (student 171) — payment posted to wrong class.
 *
 * Mis-posted:
 *   Playgroup Plan 1 Phase 7 (INV-1812, profile 94) — Payment 1460 ₱5,146
 * Correct target:
 *   Nursery Plan 1 Phase 1 (INV-1113, profile 357) — currently Unpaid
 *
 * After:
 *   Playgroup Phase 7 → Unpaid; remove Phase 7 rejoin enrollment
 *   Nursery Phase 1 → Paid; promote pending_enrollment → enrolled
 *
 * Run:
 *   node backend/scripts/reassignMaverickPlaygroupP7PaymentToNurseryP1.js
 *   node backend/scripts/reassignMaverickPlaygroupP7PaymentToNurseryP1.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { deriveInvoiceStatusForInvoice } from '../utils/invoicePaymentStatus.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';
import {
  syncInstallmentEnrollmentForPaidInvoice,
  voidInstallmentEnrollmentForRejectedInvoice,
} from '../utils/installmentEnrollmentSync.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';

const STUDENT_ID = 171;
const STUDENT_EMAIL = 'shaimanzanal@icloud.com';
const PAYMENT_ID = 1460;

const PLAYGROUP_INVOICE_ID = 1812;
const PLAYGROUP_PROFILE_ID = 94;
const PLAYGROUP_CLASS_ID = 57;
const PLAYGROUP_PHASE = 7;

const NURSERY_INVOICE_ID = 1113;
const NURSERY_PROFILE_ID = 357;
const NURSERY_CLASS_ID = 129;
const NURSERY_PHASE = 1;

const REPAIR_NOTE =
  'Ops repair 2026-07-13 — reassigned payment from Playgroup Phase 7 (INV-1812) to Nursery Phase 1 (INV-1113)';

const isApply = process.argv.includes('--apply');
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

async function clearZeroPenaltyLines(client, invoiceId) {
  await client.query(
    `DELETE FROM invoiceitemstbl
     WHERE invoice_id = $1
       AND description ILIKE '%Late Payment Penalty%'
       AND COALESCE(penalty_amount, 0) = 0
       AND COALESCE(amount, 0) = 0`,
    [invoiceId]
  );
  await client.query(
    `UPDATE invoicestbl SET late_penalty_applied_for_due_date = NULL WHERE invoice_id = $1`,
    [invoiceId]
  );
}

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

async function loadEnrollmentSnapshot(client) {
  const r = await client.query(
    `SELECT cs.classstudent_id, cs.class_id, c.class_name, cs.phase_number,
            cs.program_enrollment_status,
            cs.removed_at IS NOT NULL AS removed
     FROM classstudentstbl cs
     LEFT JOIN classestbl c ON c.class_id = cs.class_id
     WHERE cs.student_id = $1
       AND cs.class_id IN ($2, $3)
       AND COALESCE(cs.phase_number, 1) IN ($4, $5)
     ORDER BY cs.class_id, cs.phase_number, cs.classstudent_id`,
    [STUDENT_ID, PLAYGROUP_CLASS_ID, NURSERY_CLASS_ID, PLAYGROUP_PHASE, NURSERY_PHASE]
  );
  return r.rows;
}

async function main() {
  console.log(
    `\nMaverick — reassign Playgroup P7 payment → Nursery P1${
      isApply ? ' (APPLY)' : ' (DRY RUN)'
    }\n`
  );

  const client = await getClient();
  try {
    const student = (
      await client.query(
        `SELECT user_id, full_name, email FROM userstbl
         WHERE user_id = $1 AND LOWER(TRIM(email)) = LOWER(TRIM($2))`,
        [STUDENT_ID, STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student) throw new Error(`Student ${STUDENT_ID} / ${STUDENT_EMAIL} not found`);
    console.log('Student:', student.full_name, student.email);

    const payment = (
      await client.query(
        `SELECT payment_id, invoice_id, student_id, payable_amount, discount_amount,
                status, approval_status, issue_date::text AS issue_date
         FROM paymenttbl WHERE payment_id = $1`,
        [PAYMENT_ID]
      )
    ).rows[0];
    if (!payment) throw new Error(`Payment ${PAYMENT_ID} not found`);
    if (Number(payment.student_id) !== STUDENT_ID) {
      throw new Error(`Payment student_id mismatch`);
    }
    if (Number(payment.invoice_id) !== PLAYGROUP_INVOICE_ID) {
      throw new Error(
        `Payment ${PAYMENT_ID} is on INV-${payment.invoice_id}, expected INV-${PLAYGROUP_INVOICE_ID}`
      );
    }
    if (payment.status !== 'Completed' || payment.approval_status !== 'Approved') {
      throw new Error(
        `Payment ${PAYMENT_ID} must be Completed/Approved (got ${payment.status}/${payment.approval_status})`
      );
    }
    console.log('Payment:', payment);

    const playgroupInv = (
      await client.query(
        `SELECT invoice_id, status, amount, remarks, installmentinvoiceprofiles_id
         FROM invoicestbl WHERE invoice_id = $1`,
        [PLAYGROUP_INVOICE_ID]
      )
    ).rows[0];
    const nurseryInv = (
      await client.query(
        `SELECT invoice_id, status, amount, remarks, installmentinvoiceprofiles_id
         FROM invoicestbl WHERE invoice_id = $1`,
        [NURSERY_INVOICE_ID]
      )
    ).rows[0];

    if (Number(playgroupInv.installmentinvoiceprofiles_id) !== PLAYGROUP_PROFILE_ID) {
      throw new Error(`INV-${PLAYGROUP_INVOICE_ID} not on profile ${PLAYGROUP_PROFILE_ID}`);
    }
    if (Number(nurseryInv.installmentinvoiceprofiles_id) !== NURSERY_PROFILE_ID) {
      throw new Error(`INV-${NURSERY_INVOICE_ID} not on profile ${NURSERY_PROFILE_ID}`);
    }
    if (parseTargetPhase(playgroupInv.remarks) !== PLAYGROUP_PHASE) {
      throw new Error(
        `INV-${PLAYGROUP_INVOICE_ID} TARGET_PHASE=${parseTargetPhase(playgroupInv.remarks)}, expected ${PLAYGROUP_PHASE}`
      );
    }
    if (parseTargetPhase(nurseryInv.remarks) !== NURSERY_PHASE) {
      throw new Error(
        `INV-${NURSERY_INVOICE_ID} TARGET_PHASE=${parseTargetPhase(nurseryInv.remarks)}, expected ${NURSERY_PHASE}`
      );
    }

    console.log('\nBefore invoices:');
    console.table([
      {
        invoice_id: playgroupInv.invoice_id,
        label: 'Playgroup P7',
        status: playgroupInv.status,
        amount: playgroupInv.amount,
      },
      {
        invoice_id: nurseryInv.invoice_id,
        label: 'Nursery P1',
        status: nurseryInv.status,
        amount: nurseryInv.amount,
      },
    ]);

    console.log('\nBefore enrollments (P7 / Nursery P1):');
    console.table(await loadEnrollmentSnapshot(client));

    const nurseryProfile = (
      await client.query(
        `SELECT * FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`,
        [NURSERY_PROFILE_ID]
      )
    ).rows[0];

    console.log('\nPlanned:');
    console.log(`  • UPDATE payment ${PAYMENT_ID}: invoice ${PLAYGROUP_INVOICE_ID} → ${NURSERY_INVOICE_ID}`);
    console.log(`  • Refresh INV-${PLAYGROUP_INVOICE_ID} → Unpaid`);
    console.log(`  • Refresh INV-${NURSERY_INVOICE_ID} → Paid`);
    console.log(`  • Void Playgroup Phase ${PLAYGROUP_PHASE} rejoin enrollment`);
    console.log(`  • Sync Nursery Phase ${NURSERY_PHASE} enrollment from paid invoice`);

    if (!isApply) {
      console.log('\nDry run complete. Re-run with --apply to write changes.');
      return;
    }

    await client.query('BEGIN');

    await client.query(
      `UPDATE paymenttbl
       SET invoice_id = $1,
           remarks = COALESCE(NULLIF(TRIM(remarks), ''), '') ||
             CASE WHEN remarks IS NULL OR TRIM(remarks) = '' THEN '' ELSE ' | ' END ||
             $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE payment_id = $3`,
      [NURSERY_INVOICE_ID, REPAIR_NOTE, PAYMENT_ID]
    );

    await clearZeroPenaltyLines(client, NURSERY_INVOICE_ID);

    const playgroupAfter = await refreshInvoiceAfterPaymentChange(client, PLAYGROUP_INVOICE_ID);
    const nurseryAfter = await refreshInvoiceAfterPaymentChange(client, NURSERY_INVOICE_ID);

    const voided = await voidInstallmentEnrollmentForRejectedInvoice({
      client,
      studentId: STUDENT_ID,
      invoice: {
        invoice_id: PLAYGROUP_INVOICE_ID,
        installmentinvoiceprofiles_id: PLAYGROUP_PROFILE_ID,
        remarks: playgroupInv.remarks,
        status: playgroupAfter.newStatus,
      },
      reason: REPAIR_NOTE,
    });

    const nurseryInvFresh = (
      await client.query(`SELECT * FROM invoicestbl WHERE invoice_id = $1`, [NURSERY_INVOICE_ID])
    ).rows[0];

    await syncInstallmentEnrollmentForPaidInvoice({
      client,
      profileId: NURSERY_PROFILE_ID,
      profile: nurseryProfile,
      studentId: STUDENT_ID,
      sourceLabel: REPAIR_NOTE,
      invoice: nurseryInvFresh,
    });

    await client.query('COMMIT');

    console.log('\n✅ Payment reassigned.');
    console.log('Playgroup INV-1812 after:', playgroupAfter);
    console.log('Nursery INV-1113 after:', nurseryAfter);
    console.log('Playgroup P7 enrollment void:', voided);

    const verifyPay = (
      await client.query(
        `SELECT payment_id, invoice_id, payable_amount, status, approval_status, remarks
         FROM paymenttbl WHERE payment_id = $1`,
        [PAYMENT_ID]
      )
    ).rows[0];
    console.log('\nPayment after:', verifyPay);

    const verifyInv = await client.query(
      `SELECT invoice_id, status, amount FROM invoicestbl WHERE invoice_id IN ($1, $2) ORDER BY invoice_id`,
      [NURSERY_INVOICE_ID, PLAYGROUP_INVOICE_ID]
    );
    console.log('\nInvoices after:');
    console.table(verifyInv.rows);

    console.log('\nEnrollments after (P7 / Nursery P1):');
    console.table(await loadEnrollmentSnapshot(client));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error('Repair failed:', err.message || err);
  process.exit(1);
});
