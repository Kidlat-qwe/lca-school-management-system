/**
 * Yohan Teodoro Hipolito (student 413) — VMP_Playgroup_TTh_11:00AM (class 67).
 *
 * Issues:
 *  1. Phase 6 incorrectly stored as rejoin (Phase 5 is already the comeback after
 *     Phase 4 dropped). Phase 6+ should be re_enrolled (or completed on last phase).
 *  2. Phase 5–6 invoice issue/due dates are one month late vs paid cadence.
 *  3. Phase 7 unpaid under grace → Student History plan Status should be Inactive
 *     (profile.is_active + student_statustbl), not Active.
 *
 * Target:
 *  - Phase 5 enrollment: keep rejoin
 *  - Phase 6 enrollment: re_enrolled
 *  - Phase 5 INV-1769: issue 2026-05-25, due 2026-06-05 (paid Jul 3)
 *  - Phase 6 INV-2315: issue 2026-06-25, due 2026-07-05 (paid Aug 3)
 *  - Phase 7 INV-2341: keep issue/due (under grace → Inactive)
 *  - profile.is_active = false; student_statustbl = inactive
 *
 * Run:
 *   node backend/scripts/repairYohanHipolitoPhase56RejoinDates.js
 *   node backend/scripts/repairYohanHipolitoPhase56RejoinDates.js --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

const STUDENT_ID = 413;
const STUDENT_EMAIL = 'teodoroannabelled@gmail.com';
const CLASS_ID = 67;
const BRANCH_ID = 6;
const PROFILE_ID = 160;
const PHASE6_CLASSSTUDENT_ID = 2191;
const PHASE5_INVOICE_ID = 1769;
const PHASE6_INVOICE_ID = 2315;
const PHASE7_INVOICE_ID = 2341;

const PHASE5_ISSUE = '2026-05-25';
const PHASE5_DUE = '2026-06-05';
const PHASE6_ISSUE = '2026-06-25';
const PHASE6_DUE = '2026-07-05';

const REPAIR_NOTE =
  'Ops repair 2026-08-07 — Yohan P6 rejoin→re_enrolled; P5/P6 due back one month; Inactive under P7 grace';

const isApply = process.argv.includes('--apply');

async function loadState(client) {
  const student = (
    await client.query(
      `SELECT user_id, full_name, email FROM userstbl WHERE user_id = $1`,
      [STUDENT_ID]
    )
  ).rows[0];

  const enrollments = (
    await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status,
              TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD') AS enrolled,
              TO_CHAR(TIMEZONE('Asia/Manila', removed_at), 'YYYY-MM-DD') AS removed
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2
       ORDER BY phase_number, classstudent_id`,
      [STUDENT_ID, CLASS_ID]
    )
  ).rows;

  const invoices = (
    await client.query(
      `SELECT invoice_id, status, amount, remarks,
              TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
              TO_CHAR(due_date, 'YYYY-MM-DD') AS due
       FROM invoicestbl
       WHERE installmentinvoiceprofiles_id = $1
       ORDER BY invoice_id`,
      [PROFILE_ID]
    )
  ).rows.map((r) => ({ ...r, phase: parseTargetPhase(r.remarks) }));

  const profile = (
    await client.query(
      `SELECT installmentinvoiceprofiles_id, generated_count, is_active, total_phases
       FROM installmentinvoiceprofilestbl
       WHERE installmentinvoiceprofiles_id = $1`,
      [PROFILE_ID]
    )
  ).rows[0];

  const status = (
    await client.query(
      `SELECT status, updated_reason FROM student_statustbl WHERE student_id = $1`,
      [STUDENT_ID]
    )
  ).rows[0];

  return { student, enrollments, invoices, profile, status };
}

async function previewMatrix(queryFn) {
  const matrix = await loadStudentMonthEnrollmentMatrix(queryFn, {
    year: 2026,
    branchId: BRANCH_ID,
    classId: CLASS_ID,
  });
  const track = (matrix.students || []).find(
    (s) => s.student_id === STUDENT_ID && Number(s.class_id) === CLASS_ID
  );
  if (!track) return [];
  return (matrix.months || [])
    .map((m) => {
      const c = track.months?.[m.key];
      if (!c?.label && c?.mark !== '1' && c?.mark !== '✓' && c?.mark !== 'X') return null;
      return { month: m.key, label: c.label, status: c.status, mark: c.mark, phase: c.phase_number };
    })
    .filter(Boolean);
}

async function main() {
  console.log(
    `\nYohan Hipolito — P6 re_enrolled + P5/P6 dates + Inactive${
      isApply ? ' (APPLY)' : ' (DRY RUN)'
    }\n`
  );

  const client = await getClient();
  try {
    const before = await loadState(client);

    if (!before.student) throw new Error(`Student ${STUDENT_ID} not found`);
    if (String(before.student.email || '').toLowerCase() !== STUDENT_EMAIL) {
      throw new Error(
        `Email mismatch: expected ${STUDENT_EMAIL}, got ${before.student.email}`
      );
    }

    const p6 = before.enrollments.find((e) => e.classstudent_id === PHASE6_CLASSSTUDENT_ID);
    const inv5 = before.invoices.find((i) => i.invoice_id === PHASE5_INVOICE_ID);
    const inv6 = before.invoices.find((i) => i.invoice_id === PHASE6_INVOICE_ID);
    const inv7 = before.invoices.find((i) => i.invoice_id === PHASE7_INVOICE_ID);

    console.log('Student:', before.student.full_name, before.student.email);
    console.log('\nEnrollments:');
    for (const e of before.enrollments) {
      console.log(
        `  P${e.phase_number} cs=${e.classstudent_id} ${e.program_enrollment_status} enrolled=${e.enrolled} removed=${e.removed || '—'}`
      );
    }
    console.log('\nInvoices (phase):');
    for (const i of before.invoices) {
      console.log(
        `  INV-${i.invoice_id} phase=${i.phase ?? '?'} ${i.status} issue=${i.issue} due=${i.due}`
      );
    }
    console.log('\nProfile:', before.profile);
    console.log('student_statustbl:', before.status);

    if (!p6 || Number(p6.phase_number) !== 6) {
      throw new Error(`Phase 6 classstudent ${PHASE6_CLASSSTUDENT_ID} not found`);
    }
    if (!inv5 || inv5.phase !== 5) {
      throw new Error(`Phase 5 invoice ${PHASE5_INVOICE_ID} missing or wrong phase`);
    }
    if (!inv6 || inv6.phase !== 6) {
      throw new Error(`Phase 6 invoice ${PHASE6_INVOICE_ID} missing or wrong phase`);
    }
    if (!inv7 || inv7.phase !== 7) {
      throw new Error(`Phase 7 invoice ${PHASE7_INVOICE_ID} missing or wrong phase`);
    }

    console.log('\nPlanned changes:');
    console.log(
      `  1. classstudent ${PHASE6_CLASSSTUDENT_ID}: ${p6.program_enrollment_status} → re_enrolled`
    );
    console.log(
      `  2. INV-${PHASE5_INVOICE_ID}: issue ${inv5.issue}→${PHASE5_ISSUE}, due ${inv5.due}→${PHASE5_DUE}`
    );
    console.log(
      `  3. INV-${PHASE6_INVOICE_ID}: issue ${inv6.issue}→${PHASE6_ISSUE}, due ${inv6.due}→${PHASE6_DUE}`
    );
    console.log(`  4. INV-${PHASE7_INVOICE_ID}: keep issue=${inv7.issue} due=${inv7.due}`);
    console.log(
      `  5. profile ${PROFILE_ID} is_active ${before.profile?.is_active} → false (Inactive under grace)`
    );
    console.log(
      `  6. student_statustbl ${before.status?.status} → inactive`
    );

    console.log('\nMatrix BEFORE:');
    console.log(await previewMatrix(query));

    if (!isApply) {
      console.log('\nDry run only. Re-run with --apply to write.');
      return;
    }

    await client.query('BEGIN');

    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 're_enrolled',
           enrolled_by = LEFT(
             CONCAT(COALESCE(enrolled_by, ''), ' | ', $2::text),
             500
           )
       WHERE classstudent_id = $1::int
         AND student_id = $3::int
         AND class_id = $4::int
         AND phase_number = 6`,
      [PHASE6_CLASSSTUDENT_ID, REPAIR_NOTE, STUDENT_ID, CLASS_ID]
    );

    await client.query(
      `UPDATE invoicestbl
       SET issue_date = $2::date,
           due_date = $3::date,
           remarks = CASE
             WHEN remarks ILIKE '%Ops repair%' THEN remarks
             ELSE LEFT(
               CONCAT(COALESCE(remarks, ''), '; ', $4::text),
               1000
             )
           END
       WHERE invoice_id = $1::int
         AND installmentinvoiceprofiles_id = $5::int`,
      [PHASE5_INVOICE_ID, PHASE5_ISSUE, PHASE5_DUE, REPAIR_NOTE, PROFILE_ID]
    );

    await client.query(
      `UPDATE invoicestbl
       SET issue_date = $2::date,
           due_date = $3::date,
           remarks = CASE
             WHEN remarks ILIKE '%Ops repair%' THEN remarks
             ELSE LEFT(
               CONCAT(COALESCE(remarks, ''), '; ', $4::text),
               1000
             )
           END
       WHERE invoice_id = $1::int
         AND installmentinvoiceprofiles_id = $5::int`,
      [PHASE6_INVOICE_ID, PHASE6_ISSUE, PHASE6_DUE, REPAIR_NOTE, PROFILE_ID]
    );

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET is_active = false
       WHERE installmentinvoiceprofiles_id = $1::int
         AND student_id = $2::int
         AND class_id = $3::int`,
      [PROFILE_ID, STUDENT_ID, CLASS_ID]
    );

    await client.query(
      `UPDATE student_statustbl
       SET status = 'inactive',
           updated_at = NOW(),
           updated_reason = $2::text
       WHERE student_id = $1::int`,
      [STUDENT_ID, REPAIR_NOTE]
    );

    await client.query('COMMIT');

    const after = await loadState(client);
    console.log('\n✅ Applied.');
    console.log('\nEnrollments AFTER:');
    for (const e of after.enrollments) {
      console.log(
        `  P${e.phase_number} ${e.program_enrollment_status} enrolled=${e.enrolled}`
      );
    }
    console.log('\nInvoices AFTER:');
    for (const i of after.invoices.filter((x) => [5, 6, 7].includes(x.phase))) {
      console.log(`  INV-${i.invoice_id} P${i.phase} issue=${i.issue} due=${i.due} ${i.status}`);
    }
    console.log('Profile AFTER:', after.profile);
    console.log('student_statustbl AFTER:', after.status);
    console.log('\nMatrix AFTER:');
    console.log(await previewMatrix(query));
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('\n❌', err.message || err);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main();
