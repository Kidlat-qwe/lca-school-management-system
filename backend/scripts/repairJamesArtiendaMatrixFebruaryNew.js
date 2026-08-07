/**
 * JAMES MIKHAIL M. ARTIENDA — month matrix: Phase 1 "new" in February.
 *
 * Student: 119 · menalie_artienda28@yahoo.com
 * Class: 56 NC_Nursery_MWF_11:00-12:00PM · Profile: 82 · Branch: NC (5)
 * Class start: 2026-02-04 · Phase 1 invoice INV-247 due 2026-02-04
 *
 * Current: Phase 1 enrolled_at 2026-03-26 + first_billing_month 2026-03-01
 *   → March new → Apr–Jul re-enrolled → Aug dropped → Sep Inactive
 *
 * Expected: February new (class start / Phase 1 due month)
 *   → Mar–Jul re-enrolled → Aug dropped → Sep Inactive
 *
 * Also: Phase 2–3 stored as "new" (doubled new) → re_enrolled
 *
 * Plan:
 *  1. Phase 1 CS 213 enrolled_at → 2026-02-04
 *  2. Profile 82 first_billing_month → 2026-02-01
 *  3. Phase 2 CS 287 + Phase 3 CS 709 status new → re_enrolled
 *
 * Run:
 *   node backend/scripts/repairJamesArtiendaMatrixFebruaryNew.js
 *   node backend/scripts/repairJamesArtiendaMatrixFebruaryNew.js --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

const STUDENT_ID = 119;
const STUDENT_EMAIL = 'menalie_artienda28@yahoo.com';
const CLASS_ID = 56;
const BRANCH_ID = 5;
const PROFILE_ID = 82;
const PHASE1_CLASSSTUDENT_ID = 213;
const PHASE2_CLASSSTUDENT_ID = 287;
const PHASE3_CLASSSTUDENT_ID = 709;

const PHASE1_ENROLLED_AT = '2026-02-04 12:00:00';
const FIRST_BILLING_MONTH = '2026-02-01';

const REPAIR_NOTE =
  'Ops repair 2026-08-07 — James Artienda matrix new month March→February + Phase 2–3 re_enrolled';

const isApply = process.argv.includes('--apply');

const EXPECTED_MATRIX = [
  ['2026-02', 'new'],
  ['2026-03', 're-enrolled'],
  ['2026-04', 're-enrolled'],
  ['2026-05', 're-enrolled'],
  ['2026-06', 're-enrolled'],
  // Phase 6 unpaid due 2026-07-05 → dropped lands in July (was Aug when
  // first_billing was March — that mismatched the invoice due month).
  ['2026-07', 'dropped'],
  // Phase 7 unpaid due 2026-08-05 → Aug Inactive under grace.
  ['2026-08', 'Inactive'],
];

async function previewMatrix(queryFn) {
  const matrix = await loadStudentMonthEnrollmentMatrix(queryFn, {
    year: 2026,
    branchId: BRANCH_ID,
    classId: CLASS_ID,
  });
  const track = (matrix.students || []).find(
    (s) => Number(s.student_id) === STUDENT_ID && Number(s.class_id) === CLASS_ID
  );
  if (!track) return [];
  const cells = [];
  for (const m of matrix.months || []) {
    const c = track.months?.[m.key];
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
              TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2
       ORDER BY phase_number, classstudent_id`,
      [STUDENT_ID, CLASS_ID]
    )
  ).rows;

  const profile = (
    await client.query(
      `SELECT installmentinvoiceprofiles_id, generated_count, is_active,
              TO_CHAR(first_billing_month, 'YYYY-MM-DD') AS first_billing
       FROM installmentinvoiceprofilestbl
       WHERE installmentinvoiceprofiles_id = $1`,
      [PROFILE_ID]
    )
  ).rows[0];

  return { student, enrollments, profile };
}

function assertMatrix(cells) {
  const byMonth = Object.fromEntries(cells.map((c) => [c.month, c]));
  const problems = [];
  for (const [month, label] of EXPECTED_MATRIX) {
    const cell = byMonth[month];
    if (!cell || cell.label !== label) {
      problems.push(
        `${month}: expected ${label}, got ${cell ? `${cell.label} (phase ${cell.phase})` : 'missing'}`
      );
    }
  }
  if (byMonth['2026-03']?.label === 'new') {
    problems.push('2026-03: still shows new (expected re-enrolled)');
  }
  return problems;
}

async function main() {
  console.log(
    `\nJames Artienda — matrix February new${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`Note: ${REPAIR_NOTE}\n`);

  const client = await getClient();
  try {
    const before = await loadState(client);
    if (!before.student) throw new Error(`Student ${STUDENT_ID} not found`);
    if (String(before.student.email || '').toLowerCase() !== STUDENT_EMAIL) {
      throw new Error(
        `Email mismatch: expected ${STUDENT_EMAIL}, got ${before.student.email}`
      );
    }

    console.log('Student:', before.student.full_name, before.student.email);
    console.log('\nEnrollments BEFORE:');
    for (const e of before.enrollments) {
      console.log(
        `  P${e.phase_number} cs=${e.classstudent_id} ${e.program_enrollment_status} enrolled=${e.enrolled}`
      );
    }
    console.log('Profile first_billing BEFORE:', before.profile?.first_billing);

    console.log('\nMatrix BEFORE:');
    console.log(await previewMatrix(query));

    console.log('\nPlanned changes:');
    console.log(
      `  1. classstudent ${PHASE1_CLASSSTUDENT_ID} (P1) enrolled_at → ${PHASE1_ENROLLED_AT}`
    );
    console.log(`  2. profile ${PROFILE_ID} first_billing_month → ${FIRST_BILLING_MONTH}`);
    console.log(
      `  3. classstudent ${PHASE2_CLASSSTUDENT_ID} (P2) + ${PHASE3_CLASSSTUDENT_ID} (P3): new → re_enrolled`
    );

    if (!isApply) {
      console.log('\nDry run only. Re-run with --apply to write.');
      return;
    }

    await client.query('BEGIN');

    await client.query(
      `UPDATE classstudentstbl
       SET enrolled_at = ($1::timestamp AT TIME ZONE 'Asia/Manila'),
           enrolled_by = LEFT(CONCAT(COALESCE(enrolled_by, ''), ' | ', $2::text), 500)
       WHERE classstudent_id = $3::int
         AND student_id = $4::int
         AND class_id = $5::int
         AND phase_number = 1`,
      [PHASE1_ENROLLED_AT, REPAIR_NOTE, PHASE1_CLASSSTUDENT_ID, STUDENT_ID, CLASS_ID]
    );

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET first_billing_month = $1::date
       WHERE installmentinvoiceprofiles_id = $2::int
         AND student_id = $3::int
         AND class_id = $4::int`,
      [FIRST_BILLING_MONTH, PROFILE_ID, STUDENT_ID, CLASS_ID]
    );

    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 're_enrolled',
           enrolled_by = LEFT(CONCAT(COALESCE(enrolled_by, ''), ' | ', $1::text), 500)
       WHERE classstudent_id = ANY($2::int[])
         AND student_id = $3::int
         AND class_id = $4::int
         AND program_enrollment_status = 'new'`,
      [
        REPAIR_NOTE,
        [PHASE2_CLASSSTUDENT_ID, PHASE3_CLASSSTUDENT_ID],
        STUDENT_ID,
        CLASS_ID,
      ]
    );

    await client.query('COMMIT');

    const after = await loadState(client);
    const cells = await previewMatrix(query);
    console.log('\n✅ Applied.');
    console.log('\nEnrollments AFTER:');
    for (const e of after.enrollments) {
      console.log(
        `  P${e.phase_number} cs=${e.classstudent_id} ${e.program_enrollment_status} enrolled=${e.enrolled}`
      );
    }
    console.log('Profile first_billing AFTER:', after.profile?.first_billing);
    console.log('\nMatrix AFTER:');
    console.log(cells);

    const problems = assertMatrix(cells);
    if (problems.length) {
      console.warn('\n⚠ Matrix check:');
      for (const p of problems) console.warn(`  - ${p}`);
    } else {
      console.log('\n✅ Matrix matches expected February new → … → Sep Inactive.');
    }
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
