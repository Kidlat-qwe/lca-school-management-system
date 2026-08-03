/**
 * Clear all branch merchandise catalog/stock rows from merchandisestbl.
 *
 * DEVELOPMENT DATABASE ONLY — refuses production / --production.
 *
 * Destructive and irreversible when run with --apply.
 * Default mode is dry-run (no writes).
 *
 * Also removes FK blockers that would prevent DELETE:
 *   1) packagedetailstbl rows that include that merchandise (package freebies)
 *   2) promomerchandisetbl rows pointing at merchandise
 *   3) merchandise_release_logtbl rows (ON DELETE RESTRICT)
 * Request log rows are kept; merchandise_id is SET NULL by FK.
 * Acknowledgement receipt merchandise JSON snapshots are not touched.
 * Package headers (packagestbl) are kept; only merchandise detail lines are removed.
 *
 * Usage (from backend/):
 *   node scripts/clearAllMerchandise.js --development
 *   node scripts/clearAllMerchandise.js --development --dry-run
 *   node scripts/clearAllMerchandise.js --development --apply
 *   node scripts/clearAllMerchandise.js --development --dry-run --branch-id=3
 *   node scripts/clearAllMerchandise.js --development --apply --branch-id=3
 *
 * Safety:
 *   - Requires explicit --development
 *   - Rejects --production
 *   - Rejects NODE_ENV=production / DB_NAME containing "production"
 *   - Verifies live PostgreSQL current_database() is a known development name
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

/** Known development database names (Neon / local). Expand if you add another staging DB. */
const ALLOWED_DEV_DB_NAMES = new Set(['psms_db', 'test_psms_db']);

/** Names that must never be targeted by this script. */
const BLOCKED_DB_NAME_SUBSTRINGS = ['production', 'prod_psms', 'psms_prod'];

function argValue(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

const wantsDevelopment = process.argv.includes('--development');
const wantsProduction = process.argv.includes('--production');
const dryRun = process.argv.includes('--dry-run') || !process.argv.includes('--apply');
const apply = process.argv.includes('--apply');
const branchIdArg = argValue('branch-id');
const branchId = branchIdArg ? Number(branchIdArg) : null;

function fail(message) {
  console.error(`\n❌ ABORTED: ${message}\n`);
  process.exit(1);
}

if (wantsProduction) {
  fail(
    'This script refuses --production. Merchandise wipe is development-only.\n' +
      '   Use: node scripts/clearAllMerchandise.js --development [--dry-run|--apply]'
  );
}

if (!wantsDevelopment) {
  fail(
    'You must pass --development explicitly so this never runs against production by accident.\n' +
      '   Dry-run:  node scripts/clearAllMerchandise.js --development --dry-run\n' +
      '   Apply:    node scripts/clearAllMerchandise.js --development --apply'
  );
}

if (apply && process.argv.includes('--dry-run')) {
  fail('Use either --dry-run or --apply, not both.');
}

if (branchIdArg && (!Number.isInteger(branchId) || branchId <= 0)) {
  fail('Invalid --branch-id= (must be a positive integer).');
}

const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
const configuredDbName = String(process.env.DB_NAME || '').trim();

if (nodeEnv === 'production') {
  fail(
    `NODE_ENV is "${process.env.NODE_ENV}" after loadEnv. Refusing to continue.\n` +
      '   Ensure backend/.env has NODE_ENV=development, or pass --development only (never --production).'
  );
}

if (!configuredDbName) {
  fail('DB_NAME is empty after loadEnv — cannot verify target database.');
}

const configuredLower = configuredDbName.toLowerCase();
if (BLOCKED_DB_NAME_SUBSTRINGS.some((s) => configuredLower.includes(s))) {
  fail(
    `Configured DB_NAME="${configuredDbName}" looks like production. Refusing.\n` +
      `   Expected a development DB such as: ${[...ALLOWED_DEV_DB_NAMES].join(', ')}`
  );
}

if (!ALLOWED_DEV_DB_NAMES.has(configuredDbName)) {
  fail(
    `Configured DB_NAME="${configuredDbName}" is not in the allow-list for this script.\n` +
      `   Allowed: ${[...ALLOWED_DEV_DB_NAMES].join(', ')}\n` +
      '   If this is intentional staging, add the name to ALLOWED_DEV_DB_NAMES in the script first.'
  );
}

async function assertLiveDatabaseIsDevelopment(client) {
  const result = await client.query(
    `SELECT current_database() AS db_name, inet_server_addr()::text AS server_addr`
  );
  const liveName = String(result.rows[0]?.db_name || '').trim();
  const liveLower = liveName.toLowerCase();

  console.log('------------------------------------------------------------');
  console.log(`NODE_ENV:              ${process.env.NODE_ENV}`);
  console.log(`Configured DB_NAME:    ${configuredDbName}`);
  console.log(`Live current_database: ${liveName}`);
  console.log(`Host (env):            ${process.env.DB_HOST || '(not set)'}`);
  console.log('------------------------------------------------------------');

  if (!liveName) {
    throw new Error('Could not read current_database() from PostgreSQL.');
  }

  if (BLOCKED_DB_NAME_SUBSTRINGS.some((s) => liveLower.includes(s))) {
    throw new Error(
      `Live database "${liveName}" looks like production. Refusing all writes/reads for wipe.`
    );
  }

  if (!ALLOWED_DEV_DB_NAMES.has(liveName)) {
    throw new Error(
      `Live database "${liveName}" is not in the development allow-list ` +
        `(${[...ALLOWED_DEV_DB_NAMES].join(', ')}). Refusing.`
    );
  }

  if (liveName !== configuredDbName) {
    throw new Error(
      `Mismatch: configured DB_NAME="${configuredDbName}" but live current_database()="${liveName}". Refusing.`
    );
  }

  return liveName;
}

async function count(client, sql, params = []) {
  const res = await client.query(sql, params);
  return Number(res.rows[0]?.n ?? 0);
}

async function run() {
  const client = await getClient();
  try {
    await assertLiveDatabaseIsDevelopment(client);

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

    const byType = await client.query(
      `SELECT merchandise_name, COUNT(*)::int AS n, COALESCE(SUM(quantity), 0)::int AS total_qty
       FROM merchandisestbl
       ${branchFilter}
       GROUP BY merchandise_name
       ORDER BY merchandise_name`,
      branchParams
    );

    const packageDetailSql =
      branchId != null
        ? `SELECT COUNT(*)::int AS n
           FROM packagedetailstbl pd
           JOIN merchandisestbl m ON m.merchandise_id = pd.merchandise_id
           WHERE m.branch_id = $1`
        : `SELECT COUNT(*)::int AS n
           FROM packagedetailstbl pd
           JOIN merchandisestbl m ON m.merchandise_id = pd.merchandise_id`;

    const packageDetailSampleSql =
      branchId != null
        ? `SELECT pd.packagedtl_id, pd.package_id, p.package_name, pd.merchandise_id, m.merchandise_name
           FROM packagedetailstbl pd
           JOIN merchandisestbl m ON m.merchandise_id = pd.merchandise_id
           LEFT JOIN packagestbl p ON p.package_id = pd.package_id
           WHERE m.branch_id = $1
           ORDER BY pd.package_id, pd.packagedtl_id
           LIMIT 20`
        : `SELECT pd.packagedtl_id, pd.package_id, p.package_name, pd.merchandise_id, m.merchandise_name
           FROM packagedetailstbl pd
           JOIN merchandisestbl m ON m.merchandise_id = pd.merchandise_id
           LEFT JOIN packagestbl p ON p.package_id = pd.package_id
           ORDER BY pd.package_id, pd.packagedtl_id
           LIMIT 20`;

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

    const packageDetailCount = await count(client, packageDetailSql, branchParams);
    const packageDetailSample = await client.query(packageDetailSampleSql, branchParams);
    const promoLinkCount = await count(client, promoLinkSql, branchParams);
    const releaseLogCount = await count(client, releaseLogSql, branchParams);
    const requestLinkCount = await count(client, requestLinkSql, branchParams);

    console.log(dryRun ? '\n=== DRY RUN (no writes) ===' : '\n=== APPLY (will delete) ===');
    console.log('Target: DEVELOPMENT only');
    if (branchId != null) console.log(`Scope: branch_id=${branchId}`);
    else console.log('Scope: ALL branches');
    console.log(`merchandisestbl rows: ${merchandiseCount}`);
    for (const row of byBranch.rows) {
      console.log(`  branch ${row.branch_id}: ${row.n} item(s), total qty ${row.total_qty}`);
    }
    if (byType.rows.length > 0 && byType.rows.length <= 40) {
      console.log('By merchandise type:');
      for (const row of byType.rows) {
        console.log(`  ${row.merchandise_name}: ${row.n} row(s), total qty ${row.total_qty}`);
      }
    } else if (byType.rows.length > 40) {
      console.log(`By merchandise type: ${byType.rows.length} distinct names (omitting list)`);
    }
    console.log(`packagedetailstbl merchandise lines to delete: ${packageDetailCount}`);
    for (const row of packageDetailSample.rows) {
      console.log(
        `  package ${row.package_id} (${row.package_name || 'unnamed'}) → merchandise_id=${row.merchandise_id} (${row.merchandise_name})`
      );
    }
    console.log(`promomerchandisetbl links to delete: ${promoLinkCount}`);
    console.log(`merchandise_release_logtbl rows to delete: ${releaseLogCount}`);
    console.log(
      `merchandiserequestlogtbl.merchandise_id to NULL (rows kept): ${requestLinkCount}`
    );

    if (merchandiseCount === 0) {
      await client.query('ROLLBACK');
      console.log('\nNothing to delete.');
      return;
    }

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('\nDry run complete — no changes written.');
      console.log('To delete for real (you run this):');
      console.log('  node scripts/clearAllMerchandise.js --development --apply');
      if (branchId != null) {
        console.log(
          `  (scoped) node scripts/clearAllMerchandise.js --development --apply --branch-id=${branchId}`
        );
      }
      return;
    }

    // 1) Package free-merchandise detail lines (ON DELETE NO ACTION)
    if (branchId != null) {
      await client.query(
        `DELETE FROM packagedetailstbl
         WHERE merchandise_id IN (SELECT merchandise_id FROM merchandisestbl WHERE branch_id = $1)`,
        [branchId]
      );
    } else {
      await client.query(
        `DELETE FROM packagedetailstbl
         WHERE merchandise_id IN (SELECT merchandise_id FROM merchandisestbl)`
      );
    }

    // 2) Promo free-item links (ON DELETE NO ACTION)
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

    // 3) Release audit log (ON DELETE RESTRICT)
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

    // 4) Catalog/stock rows (request log FK SET NULL)
    const deleted = await client.query(
      `DELETE FROM merchandisestbl ${branchFilter} RETURNING merchandise_id`,
      branchParams
    );

    await client.query('COMMIT');
    console.log(`\nDeleted ${deleted.rowCount} merchandisestbl row(s).`);
    console.log('Done.');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    console.error('clearAllMerchandise failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

run();
