/**
 * Matteo Joaquin Fajardo — insert missing phase 2 enrollment row (paid phase 2, only phases 1 + 3 enrolled).
 *
 * Run:
 *   node backend/scripts/repairMatteoFajardoPhase2Enrollment.js
 *   node backend/scripts/repairMatteoFajardoPhase2Enrollment.js --apply
 */
import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';
import { PROGRAM_ENROLLMENT_STATUS } from '../utils/enrollmentStatus.js';

const STUDENT_ID = 231;
const CLASS_ID = 75;
const PHASE_NUMBER = 2;
const REPAIR_NOTE = 'Ops repair — Matteo Fajardo missing phase 2 enrollment backfill';

const isApply = process.argv.includes('--apply');

async function previewMatrix() {
  const matrix = await loadStudentMonthEnrollmentMatrix(query, { year: 2026 });
  const track = matrix.students.find(
    (s) => s.student_id === STUDENT_ID && s.class_id === CLASS_ID
  );
  if (!track) return [];
  return Object.entries(track.months || {})
    .filter(
      ([, c]) =>
        c?.mark === '1' || c?.mark === '✓' || c?.mark === 'X' || c?.status === 'dropped'
    )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, c]) => ({
      month,
      label: c.label,
      phase: c.phase_number,
    }));
}

async function main() {
  console.log(
    `\nMatteo Fajardo — phase 2 enrollment backfill${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );

  const client = await getClient();
  try {
    const existing = await client.query(
      `SELECT classstudent_id FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2 AND phase_number = $3 AND removed_at IS NULL`,
      [STUDENT_ID, CLASS_ID, PHASE_NUMBER]
    );
    if (existing.rows.length) {
      console.log('Phase 2 active row already exists — nothing to do.');
      return;
    }

    const phase1 = (
      await client.query(
        `SELECT enrolled_at FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2 AND phase_number = 1 AND removed_at IS NULL
         LIMIT 1`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows[0];

    const targetEnrolledAt = '2026-06-01T00:00:00+08:00';

    console.log('Before matrix:');
    console.table(await previewMatrix());
    console.log(`\nPlanned: INSERT phase ${PHASE_NUMBER} re_enrolled, enrolled_at ${targetEnrolledAt}`);

    if (!isApply) {
      console.log('\nRe-run with --apply to insert row.');
      return;
    }

    await client.query('BEGIN');
    await client.query(
      `INSERT INTO classstudentstbl (
         student_id, class_id, phase_number, program_enrollment_status, enrolled_by, enrolled_at
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        STUDENT_ID,
        CLASS_ID,
        PHASE_NUMBER,
        PROGRAM_ENROLLMENT_STATUS.RE_ENROLLED,
        REPAIR_NOTE,
        targetEnrolledAt,
      ]
    );
    await client.query('COMMIT');
    console.log('\n✅ Inserted phase 2 enrollment row.');
    console.log('\nAfter matrix:');
    console.table(await previewMatrix());
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
    console.error(err);
    process.exit(1);
  });
