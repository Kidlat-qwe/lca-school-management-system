import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

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

const classNamePattern = process.argv[2] || '%VMM_Playgroup_TTh 11:00 AM%';

try {
  const classResult = await pool.query(
    `SELECT c.class_id, c.class_name, c.teacher_id AS class_teacher_id, u1.full_name AS class_teacher_name
     FROM classestbl c
     LEFT JOIN userstbl u1 ON c.teacher_id = u1.user_id
     WHERE c.class_name ILIKE $1`,
    [classNamePattern]
  );

  console.log('CLASS:', JSON.stringify(classResult.rows, null, 2));

  for (const row of classResult.rows) {
    const classId = row.class_id;
    const teachersResult = await pool.query(
      `SELECT ct.teacher_id, u.full_name
       FROM classteacherstbl ct
       JOIN userstbl u ON ct.teacher_id = u.user_id
       WHERE ct.class_id = $1
       ORDER BY ct.created_at`,
      [classId]
    );
    console.log(`CLASSTEACHERS (class ${classId}):`, JSON.stringify(teachersResult.rows, null, 2));

    const sessionsResult = await pool.query(
      `SELECT cs.classsession_id, cs.phase_number, cs.phase_session_number,
              cs.original_teacher_id, uo.full_name AS original_name,
              cs.assigned_teacher_id, ua.full_name AS assigned_name,
              cs.substitute_teacher_id, us.full_name AS substitute_name,
              cs.status, cs.scheduled_date
       FROM classsessionstbl cs
       LEFT JOIN userstbl uo ON cs.original_teacher_id = uo.user_id
       LEFT JOIN userstbl ua ON cs.assigned_teacher_id = ua.user_id
       LEFT JOIN userstbl us ON cs.substitute_teacher_id = us.user_id
       WHERE cs.class_id = $1
       ORDER BY cs.phase_number, cs.phase_session_number
       LIMIT 12`,
      [classId]
    );
    console.log(`SESSIONS (class ${classId}):`, JSON.stringify(sessionsResult.rows, null, 2));
  }
} finally {
  await pool.end();
}
