/**
 * Apply migration 149 (FIUU token billing snapshot) and backfill active tokens.
 *
 * Usage:
 *   node backend/scripts/applyFiuuTokenBillingSnapshotMigration.js
 *   node backend/scripts/applyFiuuTokenBillingSnapshotMigration.js --billing-mobile=55218438
 *
 * Optional --billing-mobile= fills empty billing_mobile on active tokens (use the
 * mobile shown on FIUU portal for the tokenization txn when HPP bill_mobile was empty).
 */
import '../config/loadEnv.js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import pool from '../config/database.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const mobileArg = args.find((a) => a.startsWith('--billing-mobile='));
const billingMobileOverride = mobileArg
  ? String(mobileArg.split('=').slice(1).join('=') || '').trim()
  : '';

async function main() {
  const client = await pool.connect();
  try {
    const sqlPath = join(
      __dirname,
      '..',
      'migrations',
      '149_add_fiuu_token_billing_snapshot.sql'
    );
    const sql = readFileSync(sqlPath, 'utf8');
    console.log('Applying 149_add_fiuu_token_billing_snapshot.sql...');
    await client.query(sql);
    console.log('✅ Migration applied');

    if (billingMobileOverride) {
      const updated = await client.query(
        `UPDATE fiuu_payment_tokenstbl
         SET billing_mobile = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE status = 'active'
           AND (billing_mobile IS NULL OR TRIM(billing_mobile) = '')
         RETURNING fiuu_payment_token_id, source_orderid, billing_name, billing_email, billing_mobile`,
        [billingMobileOverride]
      );
      console.log(
        `✅ Backfilled billing_mobile on ${updated.rowCount} active token(s)`,
        updated.rows
      );
    }

    // Fill empty name/email from student if still missing after HPP backfill.
    await client.query(
      `UPDATE fiuu_payment_tokenstbl t
       SET billing_name = COALESCE(NULLIF(TRIM(t.billing_name), ''), NULLIF(TRIM(u.full_name), '')),
           billing_email = COALESCE(NULLIF(TRIM(t.billing_email), ''), NULLIF(TRIM(u.email), '')),
           updated_at = CURRENT_TIMESTAMP
       FROM userstbl u
       WHERE u.user_id = t.student_id
         AND t.status = 'active'
         AND (
           t.billing_name IS NULL OR TRIM(t.billing_name) = ''
           OR t.billing_email IS NULL OR TRIM(t.billing_email) = ''
         )`
    );

    const sample = await client.query(
      `SELECT fiuu_payment_token_id, student_id, source_orderid, status,
              billing_name, billing_email, billing_mobile
       FROM fiuu_payment_tokenstbl
       WHERE status = 'active'
       ORDER BY fiuu_payment_token_id DESC
       LIMIT 5`
    );
    console.log('\nActive token billing snapshots:');
    console.table(sample.rows);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
