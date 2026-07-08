/**
 * Repair session teacher assignments for class 151 (VMM_Playgroup_TTh 11:00 AM).
 * Sessions had assigned_teacher_id = Darla while class teacher is Rainalyn.
 *
 * Usage: node scripts/repairClass151SessionTeachers.js [--dry-run]
 */
import pg from 'pg';
import dotenv from 'dotenv';
import { syncClassSessionTeachersFromClass } from '../utils/classSessionTeacherSync.js';

dotenv.config();

const CLASS_ID = 151;
const dryRun = process.argv.includes('--dry-run');

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
  const classRow = await client.query(
    `SELECT c.class_id, c.class_name, c.teacher_id, u.full_name AS teacher_name
     FROM classestbl c
     LEFT JOIN userstbl u ON c.teacher_id = u.user_id
     WHERE c.class_id = $1`,
    [CLASS_ID]
  );

  if (classRow.rows.length === 0) {
    console.error(`Class ${CLASS_ID} not found`);
    process.exit(1);
  }

  const { teacher_id: primaryTeacherId, teacher_name: teacherName, class_name: className } =
    classRow.rows[0];

  const before = await client.query(
    `SELECT COUNT(*)::int AS cnt
     FROM classsessionstbl
     WHERE class_id = $1
       AND substitute_teacher_id IS NULL
       AND assigned_teacher_id IS DISTINCT FROM $2`,
    [CLASS_ID, primaryTeacherId]
  );

  console.log(`Class ${CLASS_ID}: ${className}`);
  console.log(`Primary teacher: ${teacherName} (${primaryTeacherId})`);
  console.log(`Sessions to fix: ${before.rows[0].cnt}`);

  if (dryRun) {
    console.log('Dry run — no changes applied.');
    process.exit(0);
  }

  await client.query('BEGIN');
  const { updated } = await syncClassSessionTeachersFromClass(
    client,
    CLASS_ID,
    primaryTeacherId
  );
  await client.query('COMMIT');

  console.log(`Updated ${updated} session(s).`);
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
