/**
 * Kirsten Celesse J. Mahinay — drop leftover Phase 1 so August is Inactive.
 *
 * Student: 109 · cherryjaodmd@gmail.com
 * Profile: 123 · class 47 SOMO_Playgroup_TTh_9:30-10:30AM · branch 3
 *
 * Student History starts at Phase 2 (late-start). CS 251 Phase 1 `new` is still
 * on the month matrix, so paid Phase 5 lands on August (report Active /
 * re-enrolled) and Phase 6 overdue Inactive overlays September.
 *
 * After removing Phase 1: Apr P2 new → Jul P5 re-enrolled → Aug Inactive.
 * Does not change invoices, payments, phase_start, or generated_count.
 *
 * Run:
 *   node backend/scripts/repairKirstenMahinayRemovePhase1AugustInactive.js --production
 *   node backend/scripts/repairKirstenMahinayRemovePhase1AugustInactive.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import {
  isMonthMatrixCellActiveForOperationalDashboard,
  loadStudentMonthEnrollmentMatrix,
} from '../lib/enrollmentRateMetrics.js';

const STUDENT_ID = 109;
const STUDENT_EMAIL = 'cherryjaodmd@gmail.com';
const CLASS_ID = 47;
const BRANCH_ID = 3;
const PHASE1_CLASSSTUDENT_ID = 251;
const PROFILE_ID = 123;

const REPAIR_NOTE =
  'Ops repair 2026-08-14 — Kirsten Mahinay remove leftover Phase 1 so August Inactive matches overdue Phase 6';

const EXPECTED_MATRIX = [
  ['2026-04', 'new'],
  ['2026-05', 're-enrolled'],
  ['2026-06', 're-enrolled'],
  ['2026-07', 're-enrolled'],
  ['2026-08', 'Inactive'],
];

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
  if (!track) return { cells: [], augustActive: null };
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
        report_active: isMonthMatrixCellActiveForOperationalDashboard(c, track, m.key),
      });
    }
  }
  const aug = track.months?.['2026-08'];
  return {
    cells,
    augustActive: isMonthMatrixCellActiveForOperationalDashboard(aug, track, '2026-08'),
  };
}

function assertExpected(cells) {
  const byMonth = Object.fromEntries(cells.map((c) => [c.month, c]));
  const problems = [];
  for (const [month, label] of EXPECTED_MATRIX) {
    const got = String(byMonth[month]?.label || '').trim().toLowerCase();
    const want = String(label).toLowerCase();
    if (got !== want) {
      problems.push(`${month}: expected ${label}, got ${byMonth[month]?.label || '—'}`);
    }
  }
  if (byMonth['2026-08']?.report_active) {
    problems.push('2026-08: report still counts Active');
  }
  return problems;
}

async function main() {
  console.log(
    `\nKirsten Mahinay — remove Phase 1 so August Inactive` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`Note: ${REPAIR_NOTE}`);
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const student = (
      await client.query(
        `SELECT user_id, full_name, email FROM userstbl
         WHERE user_id = $1 AND LOWER(TRIM(email)) = LOWER(TRIM($2))`,
        [STUDENT_ID, STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student) throw new Error('Student not found');
    console.log('Student:', student.full_name, student.email);

    const profile = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id, phase_start, generated_count, is_active
         FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1 AND student_id = $2`,
        [PROFILE_ID, STUDENT_ID]
      )
    ).rows[0];
    if (!profile) throw new Error(`Profile ${PROFILE_ID} not found`);
    console.log('Profile (unchanged):', profile);

    const enrollments = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status AS status,
                TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD') AS enrolled,
                TO_CHAR(TIMEZONE('Asia/Manila', removed_at), 'YYYY-MM-DD') AS removed
         FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2
         ORDER BY phase_number, classstudent_id`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows;
    console.log('\nBEFORE enrollments:');
    console.table(enrollments);

    const phase1 = enrollments.find(
      (e) => Number(e.classstudent_id) === PHASE1_CLASSSTUDENT_ID
    );
    if (!phase1) throw new Error(`CS ${PHASE1_CLASSSTUDENT_ID} not found`);
    if (Number(phase1.phase_number) !== 1) {
      throw new Error(`CS ${PHASE1_CLASSSTUDENT_ID} is phase ${phase1.phase_number}`);
    }

    console.log('\nBEFORE matrix:');
    const before = await previewMatrix(query);
    console.table(before.cells);
    console.log('August report_active BEFORE:', before.augustActive);

    await client.query(
      `DELETE FROM classstudentstbl
       WHERE classstudent_id = $1
         AND student_id = $2
         AND class_id = $3
         AND phase_number = 1`,
      [PHASE1_CLASSSTUDENT_ID, STUDENT_ID, CLASS_ID]
    );
    console.log(`✅ Deleted leftover Phase 1 CS ${PHASE1_CLASSSTUDENT_ID}`);

    console.log('\nAFTER matrix:');
    const after = await previewMatrix((text, params) => client.query(text, params));
    console.table(after.cells);
    console.log('August report_active AFTER:', after.augustActive);
    const problems = assertExpected(after.cells);
    if (problems.length) {
      console.warn('Matrix not fully aligned:');
      problems.forEach((p) => console.warn('  -', p));
    } else {
      console.log('Matrix matches Apr–Jul enrolled, Aug Inactive (report inactive).');
    }

    if (isApply) {
      await client.query('COMMIT');
      console.log('\n✅ Applied.');
    } else {
      await client.query('ROLLBACK');
      console.log('\nDry run only — re-run with --apply to commit.');
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
