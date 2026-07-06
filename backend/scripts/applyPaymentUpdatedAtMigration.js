/**
 * Apply paymenttbl updated_at migrations (119 + 120 repair) as a single script.
 * Uses backend .env (respects NODE_ENV / production DB when configured).
 *
 * Usage: node scripts/applyPaymentUpdatedAtMigration.js
 */
import '../config/loadEnv.js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import pool from '../config/database.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function applySqlFile(client, filename) {
  const path = join(__dirname, '..', 'migrations', filename);
  const sql = readFileSync(path, 'utf8');
  console.log(`Applying ${filename}...`);
  await client.query(sql);
  console.log(`✅ ${filename} applied`);
}

async function main() {
  const client = await pool.connect();
  try {
    await applySqlFile(client, '119_add_updated_at_to_paymenttbl.sql');
    await applySqlFile(client, '120_repair_paymenttbl_updated_at_accuracy.sql');

    const sample = await client.query(
      `SELECT payment_id,
              TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue_date,
              TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at,
              TO_CHAR(updated_at, 'YYYY-MM-DD HH24:MI:SS') AS updated_at
       FROM paymenttbl
       ORDER BY payment_id DESC
       LIMIT 3`
    );
    console.log('\nSample rows (latest 3 payments):');
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
