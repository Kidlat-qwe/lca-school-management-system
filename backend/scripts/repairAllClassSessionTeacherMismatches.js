/**
 * General repair: sync session teachers to class primary teacher for all mismatched classes.
 * Usage: node scripts/repairAllClassSessionTeacherMismatches.js [--dry-run] [--class-id=89]
 */
import pg from 'pg';
import dotenv from 'dotenv';
import { syncClassSessionTeachersFromClass } from '../utils/classSessionTeacherSync.js';

dotenv.config();

const dryRun = process.argv.includes('--dry-run');
const classIdArg = process.argv.find((a) => a.startsWith('--class-id='));
const onlyClassId = classIdArg ? parseInt(classIdArg.split('=')[1], 10) : null;

const env = process.env.NODE_ENV || 'development';
const prefix = env === 'production' ? 'PRODUCTION' : 'DEVELOPMENT';

const pool = new pg.Pool({
  host: process.env[`DB_HOST_${prefix}`],
  port: process.env[`DB_PORT_${prefix}`],
  database: process.env[`DB_NAME_${prefix}`],
  user: process.env[`DB_USER_${prefix}`],
  password: process.env[`DB_PASSWORD_${prefix}`],
  ssl: process.env[`DB_SSL_${prefix}`] === 'true' ? { rejectUnauthorized: false } : false,
});

const client = await pool.connect();

try {
  const mismatches = await client.query(
    `SELECT c.class_id, c.class_name, c.teacher_id, u.full_name AS teacher_name,
            COUNT(cs.classsession_id)::int AS mismatched_sessions
     FROM classestbl c
     JOIN classsessionstbl cs ON cs.class_id = c.class_id
     JOIN userstbl u ON c.teacher_id = u.user_id
     WHERE cs.substitute_teacher_id IS NULL
       AND cs.assigned_teacher_id IS NOT NULL
       AND cs.assigned_teacher_id <> c.teacher_id
       AND c.teacher_id IS NOT NULL
       ${onlyClassId ? 'AND c.class_id = $1' : ''}
     GROUP BY c.class_id, c.class_name, c.teacher_id, u.full_name
     ORDER BY mismatched_sessions DESC`,
    onlyClassId ? [onlyClassId] : []
  );

  console.log(`Found ${mismatches.rows.length} class(es) with mismatched session teachers:`);
  for (const row of mismatches.rows) {
    console.log(
      `  - Class ${row.class_id} (${row.class_name}): ${row.mismatched_sessions} sessions, teacher=${row.teacher_name} (${row.teacher_id})`
    );
  }

  if (dryRun || mismatches.rows.length === 0) {
    console.log(dryRun ? 'Dry run — no changes applied.' : 'Nothing to repair.');
    process.exit(0);
  }

  await client.query('BEGIN');
  let totalUpdated = 0;
  for (const row of mismatches.rows) {
    const { updated } = await syncClassSessionTeachersFromClass(
      client,
      row.class_id,
      row.teacher_id
    );
    totalUpdated += updated;
    console.log(`  Class ${row.class_id}: updated ${updated} session(s)`);
  }
  await client.query('COMMIT');
  console.log(`Done. Total sessions updated: ${totalUpdated}`);
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
