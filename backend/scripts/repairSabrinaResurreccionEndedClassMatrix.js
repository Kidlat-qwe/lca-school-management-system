/**
 * Sabrina M. Resurreccion (user_id 421) — Malolos Kindergarten class 84.
 *
 * Class VMM_Kindergarten_M-F 10:00 AM - 12:00 PM:
 *   start 2025-07-14 · end 2026-04-30 · status Inactive
 *
 * Problem:
 *   Phase enrollments were auto-created with enrolled_at in May/June 2026
 *   (when late invoices were paid), so the 2026 month matrix wrongly shows:
 *     May=new, Jun–Dec=re-enrolled
 *   on a class that already ended April 30.
 *
 * Correct class-calendar billing (phase_start=2, first paid INV-939 Aug 2025):
 *   Phase 2  → 2025-08  new
 *   Phase 3  → 2025-09  re-enrolled
 *   Phase 4  → 2025-10  re-enrolled
 *   Phase 5  → 2025-11  re-enrolled
 *   Phase 6  → 2025-12  re-enrolled
 *   Phase 7  → 2026-01  re-enrolled
 *   Phase 8  → 2026-02  re-enrolled
 *   Phase 9  → 2026-03  re-enrolled
 *   Phase 10 → 2026-04  completed (class end month)
 *   May 2026+ → blank (class ended)
 *
 * Run (from backend/):
 *   node scripts/repairSabrinaResurreccionEndedClassMatrix.js --production
 *   node scripts/repairSabrinaResurreccionEndedClassMatrix.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

const STUDENT_ID = 421;
const STUDENT_EMAIL = 'ryayo18@yahoo.com';
const CLASS_ID = 84;
const BRANCH_ID = 1;

/** phase_number → { enrolledWall, status, removedWall? } */
const PHASE_TARGETS = {
  2: { enrolledWall: '2025-08-15 12:00:00', status: 'new' },
  3: { enrolledWall: '2025-09-15 12:00:00', status: 're_enrolled' },
  4: { enrolledWall: '2025-10-15 12:00:00', status: 're_enrolled' },
  5: { enrolledWall: '2025-11-15 12:00:00', status: 're_enrolled' },
  6: { enrolledWall: '2025-12-15 12:00:00', status: 're_enrolled' },
  7: { enrolledWall: '2026-01-15 12:00:00', status: 're_enrolled' },
  8: { enrolledWall: '2026-02-15 12:00:00', status: 're_enrolled' },
  9: { enrolledWall: '2026-03-15 12:00:00', status: 're_enrolled' },
  10: {
    enrolledWall: '2026-04-15 12:00:00',
    status: 'completed',
    // Keep delinquency drop marker inside class-end month so it does not
    // invent post-end billing months.
    dropEnrolledWall: '2026-04-20 12:00:00',
    dropRemovedWall: '2026-04-30 12:00:00',
  },
};

const REPAIR_NOTE =
  'Ops repair — Sabrina Resurreccion align Kindergarten matrix to class calendar (new=Aug 2025; blank after Apr 2026 end)';

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
    `\nSabrina Resurreccion — ended-class matrix align${
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
    console.log('\nMatrix 2025 BEFORE:');
    console.table(await previewYear(query, 2025));
    console.log('\nMatrix 2026 BEFORE:');
    console.table(await previewYear(query, 2026));

    console.log('\nPlanned:');
    console.log('  • new starts August 2025 (phase 2 / INV-939)');
    console.log('  • phases 3–9 → Sep 2025 … Mar 2026 re-enrolled');
    console.log('  • phase 10 → April 2026 completed (class end month)');
    console.log('  • May 2026+ blank (class already ended / Inactive)');

    if (!isApply) {
      console.log('\nDry run only. Re-run with --apply to write.');
      return;
    }

    await client.query('BEGIN');

    for (const row of rows) {
      const phase = Number(row.phase_number);
      const target = PHASE_TARGETS[phase];
      if (!target) continue;

      const isDrop =
        String(row.program_enrollment_status).toLowerCase() === 'dropped' ||
        row.removed_wall != null;

      if (isDrop && phase === 10) {
        await client.query(
          `UPDATE classstudentstbl
           SET enrolled_at = TIMESTAMP '${target.dropEnrolledWall}',
               removed_at = TIMESTAMP '${target.dropRemovedWall}',
               program_enrollment_status = 'dropped'
           WHERE classstudent_id = $1`,
          [row.classstudent_id]
        );
        console.log(
          `✅ Drop marker ${row.classstudent_id} phase 10 → ${target.dropEnrolledWall} / removed ${target.dropRemovedWall}`
        );
        continue;
      }

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
    console.log('\nMatrix 2025 AFTER:');
    console.table(await previewYear(query, 2025));
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
