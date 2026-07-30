/**
 * Apply migration 132 (class archive columns) — required for GET /classes
 * which filters WHERE archived_at IS NULL.
 *
 *   node scripts/applyMigration132ClassArchive.js --production
 */
import '../config/loadEnv.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getClient, query } from '../config/database.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = resolve(__dirname, '../migrations/132_add_class_archive_columns.sql');

async function main() {
  const before = (
    await query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'classestbl' AND column_name LIKE 'archive%'`
    )
  ).rows;
  console.log('Before columns:', before.map((r) => r.column_name));

  if (before.some((r) => r.column_name === 'archived_at')) {
    console.log('Migration 132 already applied. Nothing to do.');
    process.exit(0);
  }

  const sql = readFileSync(sqlPath, 'utf8');
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('✅ Applied 132_add_class_archive_columns.sql');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const after = (
    await query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'classestbl' AND column_name LIKE 'archive%'`
    )
  ).rows;
  const visible = (
    await query(`SELECT COUNT(*)::int AS n FROM classestbl WHERE archived_at IS NULL`)
  ).rows[0];
  console.log('After columns:', after.map((r) => r.column_name));
  console.log(`Classes visible on main list: ${visible.n}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
