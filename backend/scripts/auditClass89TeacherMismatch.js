/**
 * Deep audit for class session teacher mismatch — class 89.
 */
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const CLASS_ID = 89;
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

try {
  const classInfo = await pool.query(
    `SELECT c.*, u.full_name AS teacher_name, p.program_code
     FROM classestbl c
     LEFT JOIN userstbl u ON c.teacher_id = u.user_id
     LEFT JOIN programstbl p ON c.program_id = p.program_id
     WHERE c.class_id = $1`,
    [CLASS_ID]
  );
  console.log('CLASS INFO:', JSON.stringify(classInfo.rows[0], null, 2));

  const sessionStats = await pool.query(
    `SELECT assigned_teacher_id, u.full_name, COUNT(*)::int AS cnt,
            MIN(TO_CHAR(cs.created_at, 'YYYY-MM-DD HH24:MI:SS')) AS first_created,
            MAX(TO_CHAR(cs.updated_at, 'YYYY-MM-DD HH24:MI:SS')) AS last_updated
     FROM classsessionstbl cs
     LEFT JOIN userstbl u ON cs.assigned_teacher_id = u.user_id
     WHERE cs.class_id = $1
     GROUP BY assigned_teacher_id, u.full_name
     ORDER BY cnt DESC`,
    [CLASS_ID]
  );
  console.log('SESSION TEACHER STATS:', JSON.stringify(sessionStats.rows, null, 2));

  const sampleSessions = await pool.query(
    `SELECT classsession_id, phase_number, phase_session_number,
            original_teacher_id, assigned_teacher_id, substitute_teacher_id,
            status, created_by,
            TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at,
            TO_CHAR(updated_at, 'YYYY-MM-DD HH24:MI:SS') AS updated_at
     FROM classsessionstbl
     WHERE class_id = $1
     ORDER BY phase_number, phase_session_number
     LIMIT 5`,
    [CLASS_ID]
  );
  console.log('SAMPLE SESSIONS:', JSON.stringify(sampleSessions.rows, null, 2));

  const creator = await pool.query(
    'SELECT user_id, full_name, user_type FROM userstbl WHERE user_id = $1',
    [sampleSessions.rows[0]?.created_by || 6]
  );
  console.log('SESSION CREATOR:', JSON.stringify(creator.rows[0], null, 2));

  const wrongTeacher = await pool.query(
    'SELECT user_id, full_name FROM userstbl WHERE user_id = 370'
  );
  console.log('WRONG ASSIGNED TEACHER:', JSON.stringify(wrongTeacher.rows[0], null, 2));

  const mergeHistory = await pool.query(
    `SELECT * FROM class_merge_historytbl
     WHERE merged_class_id = $1
     ORDER BY merged_at DESC LIMIT 5`,
    [CLASS_ID]
  );
  console.log('MERGE HISTORY:', JSON.stringify(mergeHistory.rows, null, 2));

  // Check if Buena (370) teaches other classes at same time slot
  const buenaClasses = await pool.query(
    `SELECT c.class_id, c.class_name, c.teacher_id, u.full_name
     FROM classestbl c
     JOIN userstbl u ON c.teacher_id = u.user_id
     WHERE c.teacher_id = 370 OR c.class_id IN (
       SELECT class_id FROM classteacherstbl WHERE teacher_id = 370
     )
     ORDER BY c.class_id`,
    []
  );
  console.log('BUENA (370) CLASSES:', JSON.stringify(buenaClasses.rows, null, 2));

  // System logs mentioning this class or session teacher updates
  try {
    const logs = await pool.query(
      `SELECT log_id, action, module, details, created_at
       FROM systemlogstbl
       WHERE details::text ILIKE '%class_id":89%'
          OR details::text ILIKE '%class_id": 89%'
          OR details::text ILIKE '%"class_id":89%'
          OR (details::text ILIKE '%assigned_teacher%' AND details::text ILIKE '%89%')
       ORDER BY created_at DESC
       LIMIT 20`,
      []
    );
    console.log('SYSTEM LOGS:', JSON.stringify(logs.rows, null, 2));
  } catch (e) {
    console.log('SYSTEM LOGS: table unavailable or query failed', e.message);
  }

  // Count all classes with same mismatch pattern
  const globalMismatch = await pool.query(
    `SELECT c.class_id, c.class_name, u.full_name AS class_teacher,
            COUNT(cs.classsession_id)::int AS mismatched_sessions
     FROM classestbl c
     JOIN classsessionstbl cs ON cs.class_id = c.class_id
     JOIN userstbl u ON c.teacher_id = u.user_id
     WHERE cs.substitute_teacher_id IS NULL
       AND cs.assigned_teacher_id IS NOT NULL
       AND cs.assigned_teacher_id <> c.teacher_id
       AND c.teacher_id IS NOT NULL
     GROUP BY c.class_id, c.class_name, u.full_name
     ORDER BY mismatched_sessions DESC
     LIMIT 20`
  );
  console.log('ALL MISMATCHED CLASSES:', JSON.stringify(globalMismatch.rows, null, 2));
} finally {
  await pool.end();
}
