/**
 * Isaac Cade Guintu — matrix May new → … → Sep Active; Phase 5 enrollment re_enrolled.
 *
 * Student: 359 · jershey_decenanuguid@yahoo.com
 * Class: 67 VMP_Playgroup_TTh_11:00AM · Profile: 159 · Branch: VMP (6)
 * phase_start=4 · Phases 4–7 paid
 *
 * Student History enrollment today: new, new, re_enrolled, re_enrolled
 * Expected: new, re_enrolled, re_enrolled, re_enrolled
 *
 * Matrix today: Apr new → May–Jul re-enrolled → Aug Active
 * Expected: May new → Jun–Aug re-enrolled → Sep Active
 *
 * Plan:
 *  1. Phase 4 CS 368 enrolled_at → 2026-05-04 (shifts billing anchor Apr→May)
 *  2. Phase 5 CS 695 status new → re_enrolled
 *  3. first_billing_month already 2026-05-01 (keep)
 *
 * Run:
 *   node backend/scripts/repairIsaacCadeGuintuMayNewSepActive.js --production
 *   node backend/scripts/repairIsaacCadeGuintuMayNewSepActive.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

const STUDENT_ID = 359;
const STUDENT_EMAIL = 'jershey_decenanuguid@yahoo.com';
const CLASS_ID = 67;
const BRANCH_ID = 6;
const PROFILE_ID = 159;
const PHASE4_CLASSSTUDENT_ID = 368;
const PHASE5_CLASSSTUDENT_ID = 695;

const PHASE4_ENROLLED_AT = '2026-05-04 12:00:00';

const REPAIR_NOTE =
  'Ops repair 2026-08-07 — Isaac Cade Guintu May new / Sep Active + Phase 5 re_enrolled';

const isApply = process.argv.includes('--apply');

const EXPECTED_MATRIX = [
  ['2026-05', 'new'],
  ['2026-06', 're-enrolled'],
  ['2026-07', 're-enrolled'],
  ['2026-08', 're-enrolled'],
  ['2026-09', 'Active'],
];

const EXPECTED_ENROLLMENT = [
  [4, 'new'],
  [5, 're_enrolled'],
  [6, 're_enrolled'],
  [7, 're_enrolled'],
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

async function loadEnrollments(client) {
  const res = await client.query(
    `SELECT classstudent_id, phase_number, program_enrollment_status,
            TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled
     FROM classstudentstbl
     WHERE student_id = $1 AND class_id = $2
     ORDER BY phase_number`,
    [STUDENT_ID, CLASS_ID]
  );
  return res.rows;
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
  if (byMonth['2026-04']?.label === 'new') {
    problems.push('2026-04: still shows new (expected blank)');
  }
  if (byMonth['2026-08']?.label === 'Active') {
    problems.push('2026-08: still Active (expected re-enrolled)');
  }
  return problems;
}

async function main() {
  console.log(
    `\nIsaac Cade Guintu — May new / Sep Active${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
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
    if (!student) throw new Error('Student not found');
    console.log('Student:', student.full_name, student.email);

    const beforeEnroll = await loadEnrollments(client);
    console.log('BEFORE enrollments:');
    console.table(beforeEnroll);
    console.log('BEFORE matrix:');
    console.table(await previewMatrix(query));

    const p4 = beforeEnroll.find((e) => Number(e.classstudent_id) === PHASE4_CLASSSTUDENT_ID);
    const p5 = beforeEnroll.find((e) => Number(e.classstudent_id) === PHASE5_CLASSSTUDENT_ID);
    if (!p4 || Number(p4.phase_number) !== 4 || String(p4.program_enrollment_status) !== 'new') {
      throw new Error(`Phase 4 CS ${PHASE4_CLASSSTUDENT_ID} unexpected: ${JSON.stringify(p4)}`);
    }
    if (!p5 || Number(p5.phase_number) !== 5 || String(p5.program_enrollment_status) !== 'new') {
      throw new Error(`Phase 5 CS ${PHASE5_CLASSSTUDENT_ID} unexpected: ${JSON.stringify(p5)}`);
    }

    console.log('\nPlanned:');
    console.log(
      `  1. CS ${PHASE4_CLASSSTUDENT_ID} (phase 4) enrolled_at ${p4.enrolled} → ${PHASE4_ENROLLED_AT}`
    );
    console.log(
      `  2. CS ${PHASE5_CLASSSTUDENT_ID} (phase 5) status new → re_enrolled`
    );
    console.log('  3. Student History enrollment: new, re_enrolled, re_enrolled, re_enrolled');
    console.log('  4. Matrix: May new → Jun–Aug re-enrolled → Sep Active');

    await client.query('BEGIN');

    await client.query(
      `UPDATE classstudentstbl
       SET enrolled_at = $1::timestamp,
           enrolled_by = CASE
             WHEN enrolled_by IS NULL OR TRIM(enrolled_by) = '' THEN $2
             WHEN enrolled_by ILIKE '%' || $2 || '%' THEN enrolled_by
             ELSE enrolled_by || ' | ' || $2
           END
       WHERE classstudent_id = $3
         AND student_id = $4
         AND class_id = $5
         AND phase_number = 4`,
      [PHASE4_ENROLLED_AT, REPAIR_NOTE, PHASE4_CLASSSTUDENT_ID, STUDENT_ID, CLASS_ID]
    );

    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 're_enrolled',
           enrolled_by = CASE
             WHEN enrolled_by IS NULL OR TRIM(enrolled_by) = '' THEN $1
             WHEN enrolled_by ILIKE '%' || $1 || '%' THEN enrolled_by
             ELSE enrolled_by || ' | ' || $1
           END
       WHERE classstudent_id = $2
         AND student_id = $3
         AND class_id = $4
         AND phase_number = 5`,
      [REPAIR_NOTE, PHASE5_CLASSSTUDENT_ID, STUDENT_ID, CLASS_ID]
    );

    const txQuery = (text, params) => client.query(text, params);
    const afterEnroll = await loadEnrollments(client);
    const afterMatrix = await previewMatrix(txQuery);

    console.log('\nAFTER enrollments (in-transaction):');
    console.table(afterEnroll);
    console.log('AFTER matrix (in-transaction):');
    console.table(afterMatrix);

    for (const [phase, status] of EXPECTED_ENROLLMENT) {
      const row = afterEnroll.find((e) => Number(e.phase_number) === phase);
      if (!row || String(row.program_enrollment_status) !== status) {
        throw new Error(
          `Enrollment phase ${phase}: expected ${status}, got ${row?.program_enrollment_status}`
        );
      }
    }

    const problems = assertMatrix(afterMatrix);
    if (problems.length) {
      console.warn('\n⚠ Matrix not fully aligned:');
      problems.forEach((p) => console.warn('  -', p));
    } else {
      console.log('\n✅ Matrix: May new … Sep Active');
    }

    if (!isApply) {
      await client.query('ROLLBACK');
      console.log('\nRolled back (dry run). Re-run with --apply to commit.');
      return;
    }

    await client.query('COMMIT');
    console.log('\nCommitted. Refresh Student History + re-enrollment month matrix.');
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
