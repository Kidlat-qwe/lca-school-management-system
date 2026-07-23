/**
 * Clear all branch merchandise catalog/stock rows from merchandisestbl.
 *
 * Destructive and irreversible when run with --apply.
 * Default mode is --dry-run (no writes).
 *
 * Also removes FK blockers that would prevent DELETE:
 *   1) promomerchandisetbl rows pointing at merchandise
 *   2) merchandise_release_logtbl rows (ON DELETE RESTRICT)
 * Request log rows are kept; merchandise_id is SET NULL by FK.
 * Acknowledgement receipt merchandise JSON snapshots are not touched.
 *
 * Usage (from backend/):
 *   node scripts/clearAllMerchandise.js --dry-run
 *   node scripts/clearAllMerchandise.js --apply
 *   node scripts/clearAllMerchandise.js --dry-run --branch-id=3
 *   node scripts/clearAllMerchandise.js --apply --branch-id=3
 *
 * Uses the same DB env as the API (config/database.js + loadEnv).
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

function argValue(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

const dryRun = process.argv.includes('--dry-run') || !process.argv.includes('--apply');
const apply = process.argv.includes('--apply');
const branchIdArg = argValue('branch-id');
const branchId = branchIdArg ? Number(branchIdArg) : null;

if (apply && process.argv.includes('--dry-run')) {
  console.error('Use either --dry-run or --apply, not both.');
  process.exit(1);
}

if (branchIdArg && (!Number.isInteger(branchId) || branchId <= 0)) {
  console.error('Invalid --branch-id= (must be a positive integer).');
  process.exit(1);
}

async function count(client, sql, params = []) {
  const res = await client.query(sql, params);
  return Number(res.rows[0]?.n ?? 0);
}

async function run() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const branchFilter = branchId != null ? 'WHERE branch_id = $1' : '';
    const branchParams = branchId != null ? [branchId] : [];

    const merchandiseCount = await count(
      client,
      `SELECT COUNT(*)::int AS n FROM merchandisestbl ${branchFilter}`,
      branchParams
    );

    const byBranch = await client.query(
      `SELECT branch_id, COUNT(*)::int AS n, COALESCE(SUM(quantity), 0)::int AS total_qty
       FROM merchandisestbl
       ${branchFilter}
       GROUP BY branch_id
       ORDER BY branch_id`,
      branchParams
    );

    const promoLinkSql =
      branchId != null
        ? `SELECT COUNT(*)::int AS n
           FROM promomerchandisetbl pm
           JOIN merchandisestbl m ON m.merchandise_id = pm.merchandise_id
           WHERE m.branch_id = $1`
        : `SELECT COUNT(*)::int AS n
           FROM promomerchandisetbl pm
           JOIN merchandisestbl m ON m.merchandise_id = pm.merchandise_id`;

    const releaseLogSql =
      branchId != null
        ? `SELECT COUNT(*)::int AS n
           FROM merchandise_release_logtbl
           WHERE branch_id = $1
              OR merchandise_id IN (SELECT merchandise_id FROM merchandisestbl WHERE branch_id = $1)`
        : `SELECT COUNT(*)::int AS n
           FROM merchandise_release_logtbl r
           WHERE EXISTS (
             SELECT 1 FROM merchandisestbl m WHERE m.merchandise_id = r.merchandise_id
           )`;

    const requestLinkSql =
      branchId != null
        ? `SELECT COUNT(*)::int AS n
           FROM merchandiserequestlogtbl
           WHERE merchandise_id IN (SELECT merchandise_id FROM merchandisestbl WHERE branch_id = $1)`
        : `SELECT COUNT(*)::int AS n
           FROM merchandiserequestlogtbl
           WHERE merchandise_id IS NOT NULL`;

    const promoLinkCount = await count(client, promoLinkSql, branchParams);
    const releaseLogCount = await count(client, releaseLogSql, branchParams);
    const requestLinkCount = await count(client, requestLinkSql, branchParams);

    console.log(dryRun ? '=== DRY RUN (no writes) ===' : '=== APPLY (will delete) ===');
    if (branchId != null) console.log(`Scope: branch_id=${branchId}`);
    else console.log('Scope: ALL branches');
    console.log(`merchandisestbl rows: ${merchandiseCount}`);
    for (const row of byBranch.rows) {
      console.log(`  branch ${row.branch_id}: ${row.n} item(s), total qty ${row.total_qty}`);
    }
    console.log(`promomerchandisetbl links to delete: ${promoLinkCount}`);
    console.log(`merchandise_release_logtbl rows to delete: ${releaseLogCount}`);
    console.log(
      `merchandiserequestlogtbl.merchandise_id to NULL (rows kept): ${requestLinkCount}`
    );

    if (merchandiseCount === 0) {
      await client.query('ROLLBACK');
      console.log('Nothing to delete.');
      return;
    }

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('Dry run complete — no changes written.');
      console.log('To delete for real: node scripts/clearAllMerchandise.js --apply');
      if (branchId != null) {
        console.log(`  (scoped) node scripts/clearAllMerchandise.js --apply --branch-id=${branchId}`);
      }
      return;
    }

    // 1) Promo free-item links (ON DELETE NO ACTION)
    if (branchId != null) {
      await client.query(
        `DELETE FROM promomerchandisetbl
         WHERE merchandise_id IN (SELECT merchandise_id FROM merchandisestbl WHERE branch_id = $1)`,
        [branchId]
      );
    } else {
      await client.query(
        `DELETE FROM promomerchandisetbl
         WHERE merchandise_id IN (SELECT merchandise_id FROM merchandisestbl)`
      );
    }

    // 2) Release audit log (ON DELETE RESTRICT)
    if (branchId != null) {
      await client.query(
        `DELETE FROM merchandise_release_logtbl
         WHERE merchandise_id IN (SELECT merchandise_id FROM merchandisestbl WHERE branch_id = $1)`,
        [branchId]
      );
    } else {
      await client.query(
        `DELETE FROM merchandise_release_logtbl
         WHERE merchandise_id IN (SELECT merchandise_id FROM merchandisestbl)`
      );
    }

    // 3) Catalog/stock rows (request log FK SET NULL)
    const deleted = await client.query(
      `DELETE FROM merchandisestbl ${branchFilter} RETURNING merchandise_id`,
      branchParams
    );

    await client.query('COMMIT');
    console.log(`Deleted ${deleted.rowCount} merchandisestbl row(s).`);
    console.log('Done.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('clearAllMerchandise failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

run();
