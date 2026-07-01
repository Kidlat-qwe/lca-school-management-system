/**
 * Repair classstudent rows flagged by auditEnrollmentDataQuality.js:
 * - Higher-program phase 1 still "new"/"re_enrolled" when a lower program is completed → upsell
 *
 * Usage:
 *   node scripts/repairEnrollmentAuditFindings.js --dry-run
 *   node scripts/repairEnrollmentAuditFindings.js --apply
 *   node scripts/repairEnrollmentAuditFindings.js --apply --student-id=336
 */
import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const dryRun = !process.argv.includes('--apply');
const studentIdArg = process.argv.find((a) => a.startsWith('--student-id='));
const studentIdFilter = studentIdArg ? parseInt(studentIdArg.split('=')[1], 10) : null;

const PROGRAM_LEVEL_ORDER_SQL = `ARRAY['Playgroup','Nursery','Pre-Kindergarten','Kindergarten','Grade School']::text[]`;

const client = await getClient();

try {
  const params = [];
  let studentSql = '';
  if (Number.isFinite(studentIdFilter)) {
    params.push(studentIdFilter);
    studentSql = `AND higher_cs.student_id = $${params.length}`;
  }

  const candidates = await client.query(
    `
      SELECT
        higher_cs.classstudent_id,
        higher_cs.student_id,
        u.full_name,
        u.email,
        higher_cs.class_id AS higher_class_id,
        higher_c.class_name AS higher_class_name,
        higher_c.level_tag AS higher_level_tag,
        higher_cs.program_enrollment_status AS current_status,
        lower_cs.classstudent_id AS lower_classstudent_id,
        lower_c.class_name AS lower_class_name,
        lower_c.level_tag AS lower_level_tag
      FROM classstudentstbl higher_cs
      INNER JOIN userstbl u ON u.user_id = higher_cs.student_id
      INNER JOIN classestbl higher_c ON higher_c.class_id = higher_cs.class_id
      INNER JOIN classstudentstbl lower_cs ON lower_cs.student_id = higher_cs.student_id
      INNER JOIN classestbl lower_c ON lower_c.class_id = lower_cs.class_id
      WHERE higher_cs.phase_number = 1
        AND higher_cs.removed_at IS NULL
        AND higher_cs.program_enrollment_status IN ('new', 're_enrolled')
        AND lower_cs.program_enrollment_status = 'completed'
        AND lower_cs.removed_at IS NULL
        AND higher_cs.class_id != lower_cs.class_id
        AND array_position(${PROGRAM_LEVEL_ORDER_SQL}, TRIM(lower_c.level_tag)) IS NOT NULL
        AND array_position(${PROGRAM_LEVEL_ORDER_SQL}, TRIM(higher_c.level_tag)) IS NOT NULL
        AND array_position(${PROGRAM_LEVEL_ORDER_SQL}, TRIM(lower_c.level_tag))
            < array_position(${PROGRAM_LEVEL_ORDER_SQL}, TRIM(higher_c.level_tag))
        ${studentSql}
      ORDER BY u.full_name, higher_cs.classstudent_id
    `,
    params
  );

  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLY'}`);
  console.log(`Upsell status candidates: ${candidates.rows.length}`);

  if (!candidates.rows.length) {
    console.log('Nothing to repair.');
    process.exit(0);
  }

  for (const row of candidates.rows) {
    console.log(
      `  ${row.full_name} (${row.student_id}) | ${row.lower_class_name} (${row.lower_level_tag}) completed → ` +
        `${row.higher_class_name} (${row.higher_level_tag}) cs ${row.classstudent_id}: ` +
        `${row.current_status} → upsell`
    );
  }

  if (dryRun) {
    console.log('\nRe-run with --apply to write changes.');
    process.exit(0);
  }

  const classstudentIds = candidates.rows.map((row) => row.classstudent_id);

  await client.query('BEGIN');
  const updateResult = await client.query(
    `UPDATE classstudentstbl
     SET program_enrollment_status = 'upsell'
     WHERE classstudent_id = ANY($1::int[])
       AND program_enrollment_status IN ('new', 're_enrolled')`,
    [classstudentIds]
  );
  await client.query('COMMIT');
  console.log(`\nUpdated ${updateResult.rowCount} row(s) to upsell.`);
} catch (error) {
  await client.query('ROLLBACK');
  console.error('Repair failed:', error);
  process.exit(1);
} finally {
  client.release();
}

process.exit(0);
