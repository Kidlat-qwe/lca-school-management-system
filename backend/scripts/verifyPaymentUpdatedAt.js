/**
 * Verify paymenttbl.updated_at column, triggers, and sample row accuracy.
 * Read-only unless --repair is passed (runs NULL-safe backfill + ensures triggers).
 *
 * Usage:
 *   node scripts/verifyPaymentUpdatedAt.js
 *   node scripts/verifyPaymentUpdatedAt.js --repair
 *   node scripts/verifyPaymentUpdatedAt.js --repair --production
 */
import '../config/loadEnv.js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import pool from '../config/database.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repairMode = process.argv.includes('--repair');

async function main() {
  const client = await pool.connect();
  try {
    const col = await client.query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'paymenttbl'
         AND column_name = 'updated_at'
       LIMIT 1`
    );
    if (col.rows.length === 0) {
      console.error('❌ paymenttbl.updated_at column is missing. Run migration 119 first.');
      process.exit(1);
    }
    console.log('✅ paymenttbl.updated_at column exists');

    const triggers = await client.query(
      `SELECT tgname
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       WHERE c.relname = 'paymenttbl'
         AND NOT t.tgisinternal
         AND tgname LIKE '%updated_at%'`
    );
    console.log('Triggers:', triggers.rows.map((r) => r.tgname).join(', ') || '(none)');

    const stats = await client.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE updated_at IS NULL)::int AS null_updated_at,
         COUNT(*) FILTER (
           WHERE updated_at IS NOT NULL
             AND approved_at IS NOT NULL
             AND updated_at < approved_at
         )::int AS updated_before_approval,
         COUNT(*) FILTER (
           WHERE issue_date IS NOT NULL
             AND updated_at::date <> issue_date::date
         )::int AS updated_at_differs_from_payment_date
       FROM paymenttbl`
    );
    console.log('\nStats:', stats.rows[0]);

    const samples = await client.query(
      `SELECT payment_id,
              TO_CHAR(issue_date, 'YYYY-MM-DD') AS payment_date,
              TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at,
              TO_CHAR(updated_at, 'YYYY-MM-DD HH24:MI:SS') AS updated_at,
              TO_CHAR(approved_at, 'YYYY-MM-DD HH24:MI:SS') AS approved_at
       FROM paymenttbl
       WHERE issue_date IS NOT NULL
         AND updated_at::date <> issue_date::date
       ORDER BY payment_id DESC
       LIMIT 5`
    );
    console.log('\nSample backdated payment dates (payment_date ≠ updated_at day):');
    console.table(samples.rows);

    if (repairMode) {
      const repairSql = readFileSync(
        join(__dirname, '..', 'migrations', '120_repair_paymenttbl_updated_at_accuracy.sql'),
        'utf8'
      );
      console.log('\nRunning repair backfill + trigger ensure...');
      await client.query(repairSql);
      console.log('✅ Repair complete');
    } else if (Number(stats.rows[0]?.null_updated_at) > 0) {
      console.log('\n⚠️  Some rows have NULL updated_at. Run: node scripts/verifyPaymentUpdatedAt.js --repair');
    } else if (Number(stats.rows[0]?.updated_before_approval) > 0) {
      console.log(
        '\n⚠️  Some rows have updated_at before approved_at (bad backfill). Run: node scripts/verifyPaymentUpdatedAt.js --repair'
      );
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Verify failed:', err.message);
  process.exit(1);
});
