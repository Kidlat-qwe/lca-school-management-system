/**
 * Margaux Emilia Nacar — Phase 1 paid but enrollment stuck on pending_enrollment.
 *
 * Evidence:
 *   - INV-1968 (AR 261634) Downpayment = Paid
 *   - INV-1995 (AR 261663) Phase 1 advance = Paid (2026-07-14)
 *   - classstudent 1812 still pending_enrollment
 *     ("Downpayment paid — awaiting Phase 1 payment")
 *   - Matrix: July = pending enrollment, August = Inactive (lifecycle after pending)
 *
 * Student History already shows Phase 1 enrollment badge "new" from invoice mapping;
 * Month Re-enrollment matrix reads classstudentstbl and was never promoted.
 *
 * Fix: re-run installment enrollment sync for the paid Phase 1 invoice.
 *
 * Run (from backend/):
 *   node scripts/repairMargauxNacarPendingEnrollment.js --production
 *   node scripts/repairMargauxNacarPendingEnrollment.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';
import { syncInstallmentEnrollmentForPaidInvoice } from '../utils/installmentEnrollmentSync.js';

const STUDENT_EMAIL = 'nepjuanillo@gmail.com';
const STUDENT_ID = 657;
const CLASS_ID = 154;
const PROFILE_ID = 483;
const PHASE1_INVOICE_ID = 1995;
const CLASSSTUDENT_ID = 1812;
const BRANCH_ID = 3;
const REPAIR_NOTE =
  'Ops repair — promote pending_enrollment after Phase 1 paid (INV-1995)';

const isApply = process.argv.includes('--apply');

async function previewMatrix(queryFn) {
  const matrix = await loadStudentMonthEnrollmentMatrix(queryFn, {
    year: 2026,
    branchId: BRANCH_ID,
    classId: CLASS_ID,
  });
  const track = (matrix.students || []).find(
    (s) => Number(s.student_id) === STUDENT_ID && Number(s.class_id) === CLASS_ID
  );
  const cells = [];
  for (const key of ['2026-06', '2026-07', '2026-08', '2026-09']) {
    const c = track?.months?.[key];
    if (!c) continue;
    if (c.mark === '1' || c.mark === '✓' || c.mark === 'X' || c.label) {
      cells.push({
        month: key,
        label: c.label,
        status: c.status,
        phase: c.phase_number ?? null,
        mark: c.mark,
        payment_lifecycle: Boolean(c.payment_lifecycle),
      });
    }
  }
  return cells;
}

async function main() {
  console.log(
    `\nMargaux Nacar — promote pending_enrollment after Phase 1 paid${
      isApply ? ' (APPLY)' : ' (DRY RUN)'
    }\n`
  );
  console.log(`Note: ${REPAIR_NOTE}\n`);

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

    const enrollment = (
      await client.query(
        `SELECT classstudent_id, class_id, phase_number, program_enrollment_status,
                TO_CHAR(enrolled_at, 'YYYY-MM-DD HH24:MI') AS enrolled_wall,
                enrolled_by
         FROM classstudentstbl
         WHERE classstudent_id = $1`,
        [CLASSSTUDENT_ID]
      )
    ).rows[0];

    const invoice = (
      await client.query(
        `SELECT invoice_id, invoice_ar_number, status, amount, remarks,
                invoice_description, invoice_chain_root_id, installmentinvoiceprofiles_id,
                TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue_date,
                TO_CHAR(due_date, 'YYYY-MM-DD') AS due_date
         FROM invoicestbl WHERE invoice_id = $1`,
        [PHASE1_INVOICE_ID]
      )
    ).rows[0];

    const profile = (
      await client.query(
        `SELECT * FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];

    const statusRow = (
      await client.query(
        `SELECT status, updated_reason FROM student_statustbl WHERE student_id = $1`,
        [STUDENT_ID]
      )
    ).rows[0];

    console.log('Student:', student.full_name, student.email);
    console.log('Enrollment:', enrollment);
    console.log('Phase 1 invoice:', {
      invoice_id: invoice?.invoice_id,
      ar: invoice?.invoice_ar_number,
      status: invoice?.status,
      issue: invoice?.issue_date,
      remarks: invoice?.remarks,
    });
    console.log('student_statustbl:', statusRow);
    console.log('\nMatrix BEFORE:');
    console.table(await previewMatrix(query));

    if (!invoice || String(invoice.status).toLowerCase() !== 'paid') {
      throw new Error(`Phase 1 invoice ${PHASE1_INVOICE_ID} is not Paid`);
    }
    if (Number(invoice.installmentinvoiceprofiles_id) !== PROFILE_ID) {
      throw new Error(`Invoice ${PHASE1_INVOICE_ID} not on profile ${PROFILE_ID}`);
    }
    if (Number(enrollment?.class_id) !== CLASS_ID) {
      throw new Error(`Enrollment ${CLASSSTUDENT_ID} not on class ${CLASS_ID}`);
    }
    if (enrollment?.program_enrollment_status !== 'pending_enrollment') {
      console.log(
        `\nEnrollment already ${enrollment?.program_enrollment_status} — nothing to promote.`
      );
      return;
    }

    console.log('\nPlanned:');
    console.log(
      `  • syncInstallmentEnrollmentForPaidInvoice(profile ${PROFILE_ID}, invoice ${PHASE1_INVOICE_ID})`
    );
    console.log('  • Expect pending_enrollment → new; July matrix → new; August → Active');

    if (!isApply) {
      console.log('\nDRY RUN — re-run with --apply');
      return;
    }

    await client.query('BEGIN');

    await syncInstallmentEnrollmentForPaidInvoice({
      client,
      profileId: PROFILE_ID,
      profile,
      studentId: STUDENT_ID,
      sourceLabel: REPAIR_NOTE,
      invoice,
    });

    await client.query('COMMIT');
    console.log('\n✅ Applied promotion.');

    const afterEnrollment = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status,
                TO_CHAR(enrolled_at, 'YYYY-MM-DD HH24:MI') AS enrolled_wall,
                enrolled_by
         FROM classstudentstbl WHERE classstudent_id = $1`,
        [CLASSSTUDENT_ID]
      )
    ).rows[0];
    const afterStatus = (
      await client.query(
        `SELECT status, updated_reason FROM student_statustbl WHERE student_id = $1`,
        [STUDENT_ID]
      )
    ).rows[0];

    console.log('Enrollment AFTER:', afterEnrollment);
    console.log('student_statustbl AFTER:', afterStatus);
    console.log('\nMatrix AFTER:');
    console.table(await previewMatrix(query));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error('Repair failed:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
