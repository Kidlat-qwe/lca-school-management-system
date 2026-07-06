/**
 * Marco Sebastian Lopez — fix premature phase 2 + wrong phase 1 due date.
 *
 * Student: cabuhatsarihana@gmail.com (user_id 569)
 * Profile 370 | SOMO_Pre-Kinder_MWF 1PM | phase_start 1 | 10 phases
 *
 * Current (wrong):
 *   - Phase 1 INV 1160 due 2026-06-02 (should be 2026-07-05)
 *   - Phase 2 INV 1731 auto-generated early (issue 2026-06-25)
 *   - generated_count = 2
 *   - Phase 1 enrollment dropped for delinquency on wrong due date
 *
 * Target:
 *   - Phase 1 INV 1160: due 2026-07-05 (keep issue 2026-06-02), unpaid
 *   - Remove phase 2 INV 1731
 *   - generated_count = 1; profile active
 *   - Queue: next_generation_date 2026-07-25, next_invoice_month 2026-08-01
 *   - Phase 1 enrollment restored to pending_enrollment
 *
 * Run:
 *   node backend/scripts/repairMarcoLopezInstallmentPhases.js
 *   node backend/scripts/repairMarcoLopezInstallmentPhases.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_EMAIL = 'cabuhatsarihana@gmail.com';
const STUDENT_ID = 569;
const PROFILE_ID = 370;
const CLASS_ID = 88;
const PHASE1_INVOICE_ID = 1160;
const PHASE2_INVOICE_ID = 1731;
const ENROLLMENT_ROW_ID = 965;
const PHASE1_DUE = '2026-07-05';
const QUEUE_GEN = '2026-07-25';
const QUEUE_MONTH = '2026-08-01';
const REPAIR_NOTE =
  'Ops repair 2026-07-04 — Marco Lopez phase 1 due + remove premature phase 2';

const args = new Set(process.argv.slice(2));
const isApply = args.has('--apply');

const ymd = (value) => (value == null ? '' : String(value).slice(0, 10));

async function deleteInvoiceCascade(client, invoiceId) {
  const payments = await client.query(
    `SELECT payment_id FROM paymenttbl WHERE invoice_id = $1`,
    [invoiceId]
  );
  if (payments.rows.length) {
    throw new Error(
      `Invoice ${invoiceId} has ${payments.rows.length} payment(s); refuse to delete`
    );
  }

  await client.query(`DELETE FROM program_payment_statustbl WHERE invoice_id = $1`, [invoiceId]);
  await client.query(`DELETE FROM invoicestudentstbl WHERE invoice_id = $1`, [invoiceId]);
  await client.query(`DELETE FROM invoiceitemstbl WHERE invoice_id = $1`, [invoiceId]);

  // Clear balance-invoice links if any child points at this invoice
  await client.query(
    `UPDATE invoicestbl SET balance_invoice_id = NULL WHERE balance_invoice_id = $1`,
    [invoiceId]
  );

  await client.query(`DELETE FROM invoicestbl WHERE invoice_id = $1`, [invoiceId]);
}

async function loadSnapshot(client) {
  const profile = (
    await client.query(
      `SELECT ip.installmentinvoiceprofiles_id, ip.student_id, ip.generated_count, ip.is_active,
              ip.downpayment_invoice_id, ip.class_id,
              ii.installmentinvoicedtl_id,
              TO_CHAR(TIMEZONE('Asia/Manila', ii.next_generation_date), 'YYYY-MM-DD') AS next_gen,
              TO_CHAR(TIMEZONE('Asia/Manila', ii.next_invoice_month), 'YYYY-MM-DD') AS next_month,
              ii.status AS ii_status,
              u.full_name, u.email, c.class_name
       FROM installmentinvoiceprofilestbl ip
       INNER JOIN installmentinvoicestbl ii
         ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
       INNER JOIN userstbl u ON u.user_id = ip.student_id
       LEFT JOIN classestbl c ON c.class_id = ip.class_id
       WHERE ip.installmentinvoiceprofiles_id = $1`,
      [PROFILE_ID]
    )
  ).rows[0];

  const invoices = (
    await client.query(
      `SELECT invoice_id, status, invoice_ar_number,
              TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue_ymd,
              TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due_ymd,
              remarks
       FROM invoicestbl
       WHERE installmentinvoiceprofiles_id = $1
       ORDER BY invoice_id`,
      [PROFILE_ID]
    )
  ).rows;

  const enrollment = (
    await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status, removed_reason
       FROM classstudentstbl
       WHERE classstudent_id = $1`,
      [ENROLLMENT_ROW_ID]
    )
  ).rows[0];

  return { profile, invoices, enrollment };
}

async function main() {
  console.log(
    `\nMarco Lopez installment repair${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );

  const client = await getClient();
  try {
    const before = await loadSnapshot(client);
    if (!before.profile || Number(before.profile.student_id) !== STUDENT_ID) {
      throw new Error(`Profile ${PROFILE_ID} not found for student ${STUDENT_ID}`);
    }
    if (String(before.profile.email).toLowerCase() !== STUDENT_EMAIL) {
      throw new Error(`Email mismatch: expected ${STUDENT_EMAIL}, got ${before.profile.email}`);
    }
    if (Number(before.profile.class_id) !== CLASS_ID) {
      throw new Error(`Class mismatch: expected ${CLASS_ID}, got ${before.profile.class_id}`);
    }

    console.log(
      'Student:',
      before.profile.full_name,
      `| Profile ${PROFILE_ID} | ${before.profile.class_name}`
    );
    console.log('Before profile:', {
      generated_count: before.profile.generated_count,
      is_active: before.profile.is_active,
      next_gen: before.profile.next_gen,
      next_month: before.profile.next_month,
      ii_status: before.profile.ii_status,
    });
    console.log('Before invoices:');
    for (const inv of before.invoices) {
      console.log(
        `  INV ${inv.invoice_id} AR ${inv.invoice_ar_number} ${inv.issue_ymd} / ${inv.due_ymd} ${inv.status} | ${inv.remarks?.slice(0, 80)}`
      );
    }
    console.log('Before enrollment:', before.enrollment);

    const phase1 = before.invoices.find((i) => i.invoice_id === PHASE1_INVOICE_ID);
    const phase2 = before.invoices.find((i) => i.invoice_id === PHASE2_INVOICE_ID);
    if (!phase1) throw new Error(`Phase 1 invoice ${PHASE1_INVOICE_ID} not found`);
    if (!phase2) {
      console.log(`Phase 2 invoice ${PHASE2_INVOICE_ID} already absent`);
    }

    console.log('\nPlanned changes:');
    console.log(`  - INV ${PHASE1_INVOICE_ID} due_date: ${phase1.due_ymd} → ${PHASE1_DUE}`);
    if (phase2) {
      console.log(`  - DELETE INV ${PHASE2_INVOICE_ID} (premature phase 2)`);
    }
    console.log(`  - generated_count: ${before.profile.generated_count} → 1`);
    console.log(`  - is_active: ${before.profile.is_active} → true`);
    console.log(
      `  - queue: ${before.profile.next_gen} / ${before.profile.next_month} → ${QUEUE_GEN} / ${QUEUE_MONTH}`
    );
    console.log(
      `  - enrollment ${ENROLLMENT_ROW_ID}: ${before.enrollment?.program_enrollment_status} → pending_enrollment`
    );

    if (!isApply) {
      console.log('\nDRY RUN — no changes written. Re-run with --apply');
      return;
    }

    await client.query('BEGIN');

    await client.query(
      `UPDATE invoicestbl
       SET due_date = $1::date,
           late_penalty_applied_for_due_date = NULL
       WHERE invoice_id = $2`,
      [PHASE1_DUE, PHASE1_INVOICE_ID]
    );
    console.log(`✅ Phase 1 INV ${PHASE1_INVOICE_ID} due_date → ${PHASE1_DUE}`);

    if (phase2) {
      await deleteInvoiceCascade(client, PHASE2_INVOICE_ID);
      console.log(`✅ Deleted premature phase 2 INV ${PHASE2_INVOICE_ID}`);
    }

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET generated_count = 1,
           is_active = true
       WHERE installmentinvoiceprofiles_id = $1`,
      [PROFILE_ID]
    );
    console.log('✅ Profile: generated_count=1, is_active=true');

    await client.query(
      `UPDATE installmentinvoicestbl
       SET status = NULL,
           next_generation_date = $1::date,
           next_invoice_month = $2::date
       WHERE installmentinvoiceprofiles_id = $3`,
      [QUEUE_GEN, QUEUE_MONTH, PROFILE_ID]
    );
    console.log(`✅ Queue: next_generation_date=${QUEUE_GEN}, next_invoice_month=${QUEUE_MONTH}`);

    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 'pending_enrollment',
           removed_at = NULL,
           removed_reason = NULL,
           removed_by = NULL,
           enrolled_by = COALESCE(enrolled_by, $1),
           enrolled_at = COALESCE(enrolled_at, CURRENT_TIMESTAMP)
       WHERE classstudent_id = $2`,
      [REPAIR_NOTE, ENROLLMENT_ROW_ID]
    );
    console.log('✅ Enrollment restored to pending_enrollment');

    await syncProgramPaymentStatusForInvoice(client, PHASE1_INVOICE_ID);

    await client.query('COMMIT');

    const after = await loadSnapshot(client);
    console.log('\n--- AFTER ---');
    console.log('Profile:', {
      generated_count: after.profile.generated_count,
      is_active: after.profile.is_active,
      next_gen: after.profile.next_gen,
      next_month: after.profile.next_month,
      ii_status: after.profile.ii_status,
    });
    console.log('Invoices:');
    for (const inv of after.invoices) {
      console.log(
        `  INV ${inv.invoice_id} AR ${inv.invoice_ar_number} ${inv.issue_ymd} / ${inv.due_ymd} ${inv.status}`
      );
    }
    const gone = (
      await client.query(`SELECT invoice_id FROM invoicestbl WHERE invoice_id = $1`, [
        PHASE2_INVOICE_ID,
      ])
    ).rows;
    console.log(`Phase 2 INV ${PHASE2_INVOICE_ID} exists:`, gone.length > 0);
    console.log('Enrollment:', after.enrollment);
    console.log('\n✅ Applied successfully.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error('Repair failed:', err.message);
  process.exit(1);
});
