/**
 * Debug script: list database tables for the active env DB.
 *
 * Uses backend/config/loadEnv.js + backend/config/database.js, so it follows:
 * - NODE_ENV from backend/.env
 * - DB_*_DEVELOPMENT or DB_*_PRODUCTION automatically
 *
 * Run from project root:
 *   node backend/scripts/listDatabaseTables.js
 *
 * Optional checks:
 *   node backend/scripts/listDatabaseTables.js userstbl classestbl invoicestbl
 */

import '../config/loadEnv.js';
import { query } from '../config/database.js';

async function main() {
  const dbName =
    process.env.NODE_ENV === 'production'
      ? process.env.DB_NAME_PRODUCTION
      : process.env.DB_NAME_DEVELOPMENT;

  console.log(`\nInspecting tables for DB: ${dbName} (NODE_ENV=${process.env.NODE_ENV})\n`);

  const tablesRes = await query(
    `SELECT table_schema, table_name
     FROM information_schema.tables
     WHERE table_type = 'BASE TABLE'
       AND table_schema NOT IN ('pg_catalog', 'information_schema')
     ORDER BY table_schema, table_name`
  );

  if (tablesRes.rows.length === 0) {
    console.log('No base tables found in this database.');
  } else {
    console.log(`Found ${tablesRes.rows.length} table(s):`);
    for (const row of tablesRes.rows) {
      console.log(`- ${row.table_schema}.${row.table_name}`);
    }
  }

  const requestedTables = process.argv.slice(2).map((v) => String(v).trim()).filter(Boolean);
  if (requestedTables.length > 0) {
    console.log('\nSpecific table checks:');
    const existsSet = new Set(
      tablesRes.rows.map((r) => `${r.table_schema}.${r.table_name}`.toLowerCase())
    );

    for (const t of requestedTables) {
      const lower = t.toLowerCase();
      const directPublic = `public.${lower}`;
      const exists =
        existsSet.has(lower) ||
        existsSet.has(directPublic) ||
        tablesRes.rows.some((r) => String(r.table_name).toLowerCase() === lower);
      console.log(`- ${t}: ${exists ? 'EXISTS' : 'MISSING'}`);
    }
  }

  console.log('');
}

main().catch((err) => {
  console.error('Failed to list tables:', err.message);
  process.exitCode = 1;
});
