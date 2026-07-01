/**
 * Backfill missing intermediate classstudent phase rows when a later phase
 * is active but a gap exists (e.g. Phase 3 paid before Phase 2 invoice).
 *
 * Usage:
 *   node scripts/repairMissingIntermediatePhaseEnrollments.js
 *   node scripts/repairMissingIntermediatePhaseEnrollments.js --student-id=33 --class-id=34
 *   node scripts/repairMissingIntermediatePhaseEnrollments.js --dry-run
 */
import '../config/loadEnv.js';
import { query, getClient } from '../config/database.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const studentIdArg = args.find((a) => a.startsWith('--student-id='));
const classIdArg = args.find((a) => a.startsWith('--class-id='));
const filterStudentId = studentIdArg ? parseInt(studentIdArg.split('=')[1], 10) : null;
const filterClassId = classIdArg ? parseInt(classIdArg.split('=')[1], 10) : null;

const ACTIVE_STATUSES = ['new', 're_enrolled', 'upsell', 'rejoin', 'completed', 'pending_enrollment'];

const gapsResult = await query(
  `
    WITH active_phases AS (
      SELECT
        cs.student_id,
        cs.class_id,
        cs.phase_number,
        cs.program_enrollment_status
      FROM classstudentstbl cs
      WHERE cs.removed_at IS NULL
        AND cs.program_enrollment_status = ANY($1::text[])
        AND COALESCE(cs.phase_number, 0) > 0
        ${filterStudentId ? 'AND cs.student_id = $2' : ''}
        ${filterClassId ? `AND cs.class_id = $${filterStudentId ? 3 : 2}` : ''}
    ),
    bounds AS (
      SELECT
        student_id,
        class_id,
        MIN(phase_number)::int AS min_phase,
        MAX(phase_number)::int AS max_phase
      FROM active_phases
      GROUP BY student_id, class_id
      HAVING MAX(phase_number) > MIN(phase_number) + 1
    )
    SELECT
      b.student_id,
      u.full_name,
      b.class_id,
      c.class_name,
      b.min_phase,
      b.max_phase,
      gs.phase_number AS missing_phase
    FROM bounds b
    CROSS JOIN LATERAL generate_series(b.min_phase + 1, b.max_phase - 1) AS gs(phase_number)
    LEFT JOIN active_phases ap
      ON ap.student_id = b.student_id
     AND ap.class_id = b.class_id
     AND ap.phase_number = gs.phase_number
    INNER JOIN userstbl u ON u.user_id = b.student_id
    INNER JOIN classestbl c ON c.class_id = b.class_id
    WHERE ap.phase_number IS NULL
    ORDER BY b.student_id, b.class_id, gs.phase_number
  `,
  [
    ACTIVE_STATUSES,
    ...(filterStudentId ? [filterStudentId] : []),
    ...(filterClassId ? [filterClassId] : []),
  ]
);

if (gapsResult.rows.length === 0) {
  console.log('No missing intermediate phase enrollments found.');
  process.exit(0);
}

console.log(`Found ${gapsResult.rows.length} gap(s):`);
for (const row of gapsResult.rows) {
  console.log(
    `  ${row.full_name} (student ${row.student_id}) class ${row.class_id} (${row.class_name}): missing Phase ${row.missing_phase} between ${row.min_phase} and ${row.max_phase}`
  );
}

if (dryRun) {
  console.log('Dry run — no changes written.');
  process.exit(0);
}

const client = await getClient();
try {
  await client.query('BEGIN');
  for (const row of gapsResult.rows) {
    await client.query(
      `INSERT INTO classstudentstbl (student_id, class_id, enrolled_by, phase_number, program_enrollment_status)
       VALUES ($1, $2, $3, $4, 're_enrolled')`,
      [
        row.student_id,
        row.class_id,
        'System (Repair — backfilled missing intermediate phase enrollment)',
        row.missing_phase,
      ]
    );
    console.log(
      `✅ Inserted Phase ${row.missing_phase} re_enrolled for ${row.full_name} class ${row.class_id}`
    );
  }
  await client.query('COMMIT');
  console.log('Repair complete.');
} catch (err) {
  await client.query('ROLLBACK');
  console.error('Repair failed:', err);
  process.exit(1);
} finally {
  client.release();
}

process.exit(0);
