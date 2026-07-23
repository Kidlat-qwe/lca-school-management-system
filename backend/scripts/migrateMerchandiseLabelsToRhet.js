/**
 * One-time (re-runnable) data migration: rewrite merchandisestbl labels to
 * RHET-canonical values used by Create Merchandise + Request Stock.
 *
 *   LCA Uniform     → School Uniform
 *   LCA PE Uniform  → PE Uniform
 *   LCA Bag         → Backpack
 *   Men/Women       → Male/Female
 *   Extra Small…    → XS/S/M/L/XL
 *
 * Usage (from backend/):
 *   node scripts/migrateMerchandiseLabelsToRhet.js
 *   node scripts/migrateMerchandiseLabelsToRhet.js --dry-run
 *
 * Requires migration 129 CHECK constraints first (Male/Female + Blouse/Skirt).
 * Uses the same DB env as the API (DB_HOST / DB_PASSWORD via config/database.js).
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const dryRun = process.argv.includes('--dry-run');

const UPDATES = [
  {
    label: 'category LCA Uniform → School Uniform',
    sql: `UPDATE merchandisestbl SET merchandise_name = 'School Uniform'
           WHERE merchandise_name IN ('LCA Uniform', 'School Uniform_Replacement')`,
    countSql: `SELECT COUNT(*)::int AS n FROM merchandisestbl
               WHERE merchandise_name IN ('LCA Uniform', 'School Uniform_Replacement')`,
  },
  {
    label: 'category LCA PE Uniform → PE Uniform',
    sql: `UPDATE merchandisestbl SET merchandise_name = 'PE Uniform'
           WHERE merchandise_name IN ('LCA PE Uniform', 'PE Uniform_Replacement')`,
    countSql: `SELECT COUNT(*)::int AS n FROM merchandisestbl
               WHERE merchandise_name IN ('LCA PE Uniform', 'PE Uniform_Replacement')`,
  },
  {
    label: 'category LCA Bag → Backpack',
    sql: `UPDATE merchandisestbl SET merchandise_name = 'Backpack'
           WHERE merchandise_name IN ('LCA Bag', 'Bag')`,
    countSql: `SELECT COUNT(*)::int AS n FROM merchandisestbl
               WHERE merchandise_name IN ('LCA Bag', 'Bag')`,
  },
  {
    label: 'gender Men/Boys → Male',
    sql: `UPDATE merchandisestbl SET gender = 'Male'
           WHERE gender IN ('Men', 'Boys', 'Man', 'Boy')`,
    countSql: `SELECT COUNT(*)::int AS n FROM merchandisestbl
               WHERE gender IN ('Men', 'Boys', 'Man', 'Boy')`,
  },
  {
    label: 'gender Women/Girls → Female',
    sql: `UPDATE merchandisestbl SET gender = 'Female'
           WHERE gender IN ('Women', 'Girls', 'Woman', 'Girl')`,
    countSql: `SELECT COUNT(*)::int AS n FROM merchandisestbl
               WHERE gender IN ('Women', 'Girls', 'Woman', 'Girl')`,
  },
  {
    label: 'size Extra Small → XS',
    sql: `UPDATE merchandisestbl SET size = 'XS' WHERE size = 'Extra Small'`,
    countSql: `SELECT COUNT(*)::int AS n FROM merchandisestbl WHERE size = 'Extra Small'`,
  },
  {
    label: 'size Small → S',
    sql: `UPDATE merchandisestbl SET size = 'S' WHERE size = 'Small'`,
    countSql: `SELECT COUNT(*)::int AS n FROM merchandisestbl WHERE size = 'Small'`,
  },
  {
    label: 'size Medium → M',
    sql: `UPDATE merchandisestbl SET size = 'M' WHERE size = 'Medium'`,
    countSql: `SELECT COUNT(*)::int AS n FROM merchandisestbl WHERE size = 'Medium'`,
  },
  {
    label: 'size Large → L',
    sql: `UPDATE merchandisestbl SET size = 'L' WHERE size = 'Large'`,
    countSql: `SELECT COUNT(*)::int AS n FROM merchandisestbl WHERE size = 'Large'`,
  },
  {
    label: 'size Extra Large → XL',
    sql: `UPDATE merchandisestbl SET size = 'XL' WHERE size = 'Extra Large'`,
    countSql: `SELECT COUNT(*)::int AS n FROM merchandisestbl WHERE size = 'Extra Large'`,
  },
];

async function run() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    for (const step of UPDATES) {
      const countRes = await client.query(step.countSql);
      const n = countRes.rows[0]?.n ?? 0;
      if (dryRun) {
        console.log(`[dry-run] ${step.label}: ${n} row(s)`);
      } else {
        const result = await client.query(step.sql);
        console.log(`${step.label}: ${result.rowCount} row(s)`);
      }
    }

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('Dry run complete — no changes written.');
    } else {
      await client.query('COMMIT');
      console.log('Migration complete.');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

run();
