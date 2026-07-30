/**
 * Ryan Sebastian Quienday (user_id 225) — Malolos Pre-Kindergarten class 86.
 *
 * Class VMM_Pre-Kinder_MWF 11AM:
 *   start 2025-07-11 · end 2026-04-27 · status Inactive
 *
 * Problem:
 *   Late installment payments (May 20, 2026) auto-created phases 8–10 with
 *   enrolled_at in May 2026, so the 2026 month matrix wrongly shows:
 *     May=new, Jun=re-enrolled, Jul=completed
 *   on a class that already ended April 27. Report → Student Status then
 *   counts July `completed` as Active.
 *
 * Correct class-calendar billing (phase_start=8, total_phases=3):
 *   Phase 8  → 2026-02  new
 *   Phase 9  → 2026-03  re-enrolled
 *   Phase 10 → 2026-04  completed (class end month)
 *   May 2026  → Inactive (after completed; not Active)
 *   Jun 2026+ → blank
 *
 * Run (from backend/):
 *   node scripts/repairRyanQuiendayEndedClassMatrix.js --production
 *   node scripts/repairRyanQuiendayEndedClassMatrix.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

const STUDENT_ID = 225;
const STUDENT_EMAIL = 'geneveivgeronca@yahoo.com';
const CLASS_ID = 86;
const BRANCH_ID = 1;

/** phase_number → { enrolledWall, status } */
const PHASE_TARGETS = {
  8: { enrolledWall: '2026-02-15 12:00:00', status: 'new' },
  9: { enrolledWall: '2026-03-15 12:00:00', status: 're_enrolled' },
  10: { enrolledWall: '2026-04-15 12:00:00', status: 'completed' },
};

const REPAIR_NOTE =
  'Ops repair — Ryan Quienday align Pre-Kinder matrix to class calendar (new=Feb 2026; completed=Apr 2026; May Inactive)';

const isApply = process.argv.includes('--apply');

async function previewYear(queryFn, year) {
  const matrix = await loadStudentMonthEnrollmentMatrix(queryFn, {
    year,
    branchId: BRANCH_ID,
    classId: CLASS_ID,
  });
  const track = (matrix.students || []).find(
    (s) => Number(s.student_id) === STUDENT_ID && Number(s.class_id) === CLASS_ID
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
        phase: c.phase_number ?? null,
        mark: c.mark,
      });
    }
  }
  return cells;
}

async function main() {
  console.log(
    `\nRyan Quienday — ended-class matrix align${
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

    const klass = (
      await client.query(
        `SELECT class_id, class_name, status,
                TO_CHAR(start_date,'YYYY-MM-DD') AS start_ymd,
                TO_CHAR(end_date,'YYYY-MM-DD') AS end_ymd
         FROM classestbl WHERE class_id = $1`,
        [CLASS_ID]
      )
    ).rows[0];

    const rows = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status,
                TO_CHAR(enrolled_at, 'YYYY-MM-DD HH24:MI') AS enrolled_wall,
                TO_CHAR(removed_at, 'YYYY-MM-DD HH24:MI') AS removed_wall,
                enrolled_by
         FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2
         ORDER BY phase_number, classstudent_id`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows;

    console.log('Student:', student.full_name, student.email);
    console.log('Class:', klass);
    console.log('\nBEFORE classstudents:');
    console.table(rows);
    console.log('\nMatrix 2026 BEFORE:');
    console.table(await previewYear(query, 2026));

    console.log('\nPlanned:');
    console.log('  • new starts February 2026 (phase 8 / late-start plan)');
    console.log('  • phase 9 → March 2026 re-enrolled');
    console.log('  • phase 10 → April 2026 completed (class end month)');
    console.log('  • May 2026 → Inactive (after completed); Jun+ blank');

    if (!isApply) {
      console.log('\nDry run only. Re-run with --apply to write.');
      return;
    }

    await client.query('BEGIN');

    for (const row of rows) {
      const phase = Number(row.phase_number);
      const target = PHASE_TARGETS[phase];
      if (!target) continue;

      await client.query(
        `UPDATE classstudentstbl
         SET enrolled_at = TIMESTAMP '${target.enrolledWall}',
             program_enrollment_status = $1,
             removed_at = NULL,
             removed_reason = NULL
         WHERE classstudent_id = $2`,
        [target.status, row.classstudent_id]
      );
      console.log(
        `✅ ${row.classstudent_id} phase ${phase} → ${target.status} @ ${target.enrolledWall}`
      );
    }

    await client.query('COMMIT');

    const after = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status,
                TO_CHAR(enrolled_at, 'YYYY-MM-DD HH24:MI') AS enrolled_wall,
                TO_CHAR(removed_at, 'YYYY-MM-DD HH24:MI') AS removed_wall
         FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2
         ORDER BY phase_number, classstudent_id`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows;

    console.log('\nAFTER classstudents:');
    console.table(after);
    console.log('\nMatrix 2026 AFTER:');
    console.table(await previewYear(query, 2026));
    console.log(`\n${REPAIR_NOTE}`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nFailed:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
