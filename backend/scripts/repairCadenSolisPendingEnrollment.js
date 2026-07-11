/**
 * Caden Jacob Solis (student 650) — Phase 1 paid but enrollment stuck on pending_enrollment.
 *
 * Evidence:
 *   - INV-1900 (AR 261565) Phase 1 advance payment = Paid (2026-07-04)
 *   - classstudent 1603 still pending_enrollment ("awaiting Phase 1 payment")
 *   - Matrix July shows "pending enrollment" instead of "new"
 *
 * Fix: re-run installment enrollment sync for the paid Phase 1 invoice.
 *
 * Run:
 *   node backend/scripts/repairCadenSolisPendingEnrollment.js
 *   node backend/scripts/repairCadenSolisPendingEnrollment.js --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';
import { syncInstallmentEnrollmentForPaidInvoice } from '../utils/installmentEnrollmentSync.js';

const STUDENT_ID = 650;
const CLASS_ID = 123;
const PROFILE_ID = 475;
const PHASE1_INVOICE_ID = 1900;
const CLASSSTUDENT_ID = 1603;
const BRANCH_ID = 3;
const REPAIR_NOTE = 'Ops repair — promote pending_enrollment after Phase 1 paid (INV-1900)';

const isApply = process.argv.includes('--apply');

async function previewMatrix(queryFn) {
  const matrix = await loadStudentMonthEnrollmentMatrix(queryFn, {
    year: 2026,
    branchId: BRANCH_ID,
    classId: CLASS_ID,
  });
  const track = (matrix.students || []).find(
    (s) => s.student_id === STUDENT_ID && s.class_id === CLASS_ID
  );
  const cells = [];
  for (const m of matrix.months || []) {
    const c = track?.months?.[m.key];
    if (!c) continue;
    if (c.mark === '1' || c.mark === '✓' || c.mark === 'X' || c.label) {
      cells.push({
        month: m.key,
        label: c.label,
        status: c.status,
        phase: c.phase_number,
        mark: c.mark,
      });
    }
  }
  return cells;
}

async function main() {
  console.log(
    `\nCaden Solis — promote pending_enrollment after Phase 1 paid${
      isApply ? ' (APPLY)' : ' (DRY RUN)'
    }\n`
  );

  const client = await getClient();
  try {
    const enrollment = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status,
                TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled_manila,
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
    console.log('  • Expect pending_enrollment → new; July matrix → new');

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

    // Align phase 1 enrolled_at to class start month (July) for matrix anchor consistency
    const classStart = (
      await client.query(
        `SELECT TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date FROM classestbl WHERE class_id = $1`,
        [CLASS_ID]
      )
    ).rows[0]?.start_date;

    if (classStart) {
      await client.query(
        `UPDATE classstudentstbl
         SET enrolled_at = ($1::date)::timestamp AT TIME ZONE 'Asia/Manila',
             enrolled_by = COALESCE(enrolled_by, '') || ' | class-start enrolled_at'
         WHERE classstudent_id = $2
           AND program_enrollment_status = 'new'`,
        [classStart, CLASSSTUDENT_ID]
      );
    }

    await client.query('COMMIT');
    console.log('\n✅ Applied promotion.');

    const afterEnrollment = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status,
                TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled_manila,
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
  process.exit(1);
});
