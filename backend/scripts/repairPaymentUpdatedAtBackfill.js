/**
 * Backfill paymenttbl.updated_at from created_at / approved_at / returned_at / rejected_at.
 * Run when migration 119 stamped every row with the same timestamp.
 *
 * Usage:
 *   node scripts/repairPaymentUpdatedAtBackfill.js --production
 *   node scripts/repairPaymentUpdatedAtBackfill.js --dry-run
 */
import '../config/loadEnv.js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import pool from '../config/database.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dryRun = process.argv.includes('--dry-run');

const client = await pool.connect();
try {
  const before = await client.query(
    `SELECT COUNT(*)::int AS stamped
     FROM paymenttbl
     WHERE updated_at = (
       SELECT updated_at FROM paymenttbl
       GROUP BY updated_at ORDER BY COUNT(*) DESC LIMIT 1
     )`
  );

  const sampleBefore = await client.query(
    `SELECT invoice_id,
            TO_CHAR((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD HH24:MI:SS') AS created_manila,
            TO_CHAR((updated_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD HH24:MI:SS') AS updated_manila
     FROM paymenttbl
     WHERE issue_date >= '2026-06-01'::date AND issue_date < '2026-07-01'::date
     ORDER BY payment_id DESC
     LIMIT 3`
  );

  console.log('Rows sharing most common updated_at:', before.rows[0]?.stamped);
  console.log('June sample BEFORE:');
  console.table(sampleBefore.rows);

  if (dryRun) {
    console.log('\nDry run — no changes written.');
    process.exit(0);
  }

  const sql = readFileSync(
    join(__dirname, '..', 'migrations', '120_repair_paymenttbl_updated_at_accuracy.sql'),
    'utf8'
  );
  await client.query(sql);

  const sampleAfter = await client.query(
    `SELECT invoice_id,
            TO_CHAR((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD HH24:MI:SS') AS created_manila,
            TO_CHAR((updated_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD HH24:MI:SS') AS updated_manila
     FROM paymenttbl
     WHERE issue_date >= '2026-06-01'::date AND issue_date < '2026-07-01'::date
     ORDER BY payment_id DESC
     LIMIT 3`
  );

  console.log('\nJune sample AFTER:');
  console.table(sampleAfter.rows);
  console.log('\n✅ Backfill complete.');
} finally {
  client.release();
  await pool.end();
}
