/**
 * Apply migration 121 (cash deposit second attachment + submission remarks).
 * Usage: node scripts/applyCashDepositSummaryMigration121.js
 */
import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(
  path.join(__dirname, '../migrations/121_add_cash_deposit_second_attachment_and_submission_remarks.sql'),
  'utf8'
);

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
  await pool.query(sql);
  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'cash_deposit_summarytbl'
       AND column_name IN ('deposit_attachment_url_2', 'submission_remarks')`
  );
  console.log('Migration 121 applied. Columns present:', cols.rows.map((r) => r.column_name).join(', '));
} finally {
  await pool.end();
}
