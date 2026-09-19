/**
 * Repair Active classes where class teacher != session assigned/original teacher.
 * Caused by older turnover that updated classteacherstbl but not classsessionstbl.
 */
import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { syncClassSessionTeachersFromClass } from '../utils/classSessionTeacherSync.js';

const client = await getClient();
try {
  await client.query('BEGIN');

  const mismatches = await client.query(`
    SELECT DISTINCT c.class_id, c.class_name, c.teacher_id, u.full_name AS teacher_name,
           COUNT(cs.classsession_id) FILTER (
             WHERE cs.assigned_teacher_id IS DISTINCT FROM c.teacher_id
                OR cs.original_teacher_id IS DISTINCT FROM c.teacher_id
           )::int AS mismatched_sessions
    FROM classestbl c
    INNER JOIN classsessionstbl cs ON cs.class_id = c.class_id
    LEFT JOIN userstbl u ON u.user_id = c.teacher_id
    WHERE COALESCE(c.status, 'Active') = 'Active'
      AND c.teacher_id IS NOT NULL
      AND cs.substitute_teacher_id IS NULL
      AND (
        cs.assigned_teacher_id IS DISTINCT FROM c.teacher_id
        OR cs.original_teacher_id IS DISTINCT FROM c.teacher_id
      )
    GROUP BY c.class_id, c.class_name, c.teacher_id, u.full_name
    ORDER BY c.class_name
  `);

  console.log(`Found ${mismatches.rows.length} class(es) with session teacher mismatch`);
  let totalUpdated = 0;
  for (const row of mismatches.rows) {
    const result = await syncClassSessionTeachersFromClass(
      client,
      row.class_id,
      row.teacher_id
    );
    totalUpdated += result.updated;
    console.log(
      `  class ${row.class_id} "${row.class_name}" -> ${row.teacher_name}: updated ${result.updated} session(s)`
    );
  }

  await client.query('COMMIT');
  console.log(`Done. Updated ${totalUpdated} session row(s).`);
} catch (err) {
  await client.query('ROLLBACK');
  console.error(err);
  process.exitCode = 1;
} finally {
  client.release();
  process.exit(process.exitCode || 0);
}
