import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const SUMMARY_ID = 121;
const prefix = process.env.NODE_ENV === 'production' ? 'PRODUCTION' : 'DEVELOPMENT';

const pool = new pg.Pool({
  host: process.env[`DB_HOST_${prefix}`],
  port: process.env[`DB_PORT_${prefix}`],
  database: process.env[`DB_NAME_${prefix}`],
  user: process.env[`DB_USER_${prefix}`],
  password: process.env[`DB_PASSWORD_${prefix}`],
  ssl: process.env[`DB_SSL_${prefix}`] === 'true' ? { rejectUnauthorized: false } : false,
});

try {
  const cols = await pool.query(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_name = 'cash_deposit_summarytbl'
     ORDER BY ordinal_position`
  );
  console.log('COLUMNS:', cols.rows.map((r) => r.column_name).join(', '));

  const row = await pool.query(
    `SELECT * FROM cash_deposit_summarytbl WHERE cash_deposit_summary_id = $1`,
    [SUMMARY_ID]
  );
  console.log('SUMMARY 121:', JSON.stringify(row.rows[0], null, 2));

  // Test UPDATE shape used by resubmit (dry rollback)
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE cash_deposit_summarytbl
       SET deposit_attachment_url_2 = $1,
           submission_remarks = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE cash_deposit_summary_id = $3`,
      [null, 'test', SUMMARY_ID]
    );
    await client.query('ROLLBACK');
    console.log('UPDATE test: PASS');
  } catch (e) {
    await client.query('ROLLBACK');
    console.log('UPDATE test FAIL:', e.code, e.message);
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
