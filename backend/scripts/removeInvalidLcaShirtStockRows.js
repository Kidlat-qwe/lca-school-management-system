/**
 * Remove CMS-only Shirt stock rows where type = 'Shirt' (not a RHET LCA_SHIRT logo).
 *
 * RHET Shirt uses logo types: ACC, Beeli, LCA, Logo 1, Logo 2 — never plain "Shirt".
 * Legacy Malolos rows were wrongly migrated Top → Shirt; this deletes them so branch
 * stock matches inventory-fulfilled rows only.
 *
 * Usage (from backend/):
 *   node scripts/removeInvalidLcaShirtStockRows.js --dry-run --branch-id=1
 *   node scripts/removeInvalidLcaShirtStockRows.js --apply --branch-id=1
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

if (branchIdArg != null && (!Number.isInteger(branchId) || branchId < 1)) {
  console.error('Invalid --branch-id= (must be a positive integer).');
  process.exit(1);
}

const SHIRT_CATEGORY_NAMES = [
  'Shirt',
  'Active Champs (T-Shirt)',
  'LCA T-Shirt',
  'LCA Tshirt',
  'LCA Shirt',
];

/** CMS-only piece label — not sent/received from RHET for LCA_SHIRT. */
const INVALID_LCA_SHIRT_TYPES = ['Shirt'];

function buildTargetWhere(startIndex = 1) {
  const params = [...SHIRT_CATEGORY_NAMES, ...INVALID_LCA_SHIRT_TYPES];
  const catList = SHIRT_CATEGORY_NAMES.map((_, i) => `$${startIndex + i}`).join(', ');
  const typeStart = startIndex + SHIRT_CATEGORY_NAMES.length;
  const typeList = INVALID_LCA_SHIRT_TYPES.map(
    (_, i) => `$${typeStart + i}`
  ).join(', ');
  let where = `merchandise_name IN (${catList}) AND type IN (${typeList})`;
  if (branchId != null) {
    params.push(branchId);
    where += ` AND branch_id = $${params.length}`;
  }
  return { where, params };
}

async function run() {
  const client = await getClient();
  const scopeLabel = branchId != null ? `branch_id=${branchId}` : 'all branches';

  try {
    await client.query('BEGIN');
    const { where, params } = buildTargetWhere();

    const preview = await client.query(
      `SELECT merchandise_id, branch_id, merchandise_name, gender, type, size, quantity, price
       FROM merchandisestbl
       WHERE ${where}
       ORDER BY branch_id, size, merchandise_id`,
      params
    );

    console.log(dryRun ? '=== DRY RUN ===' : '=== APPLY ===');
    console.log(`Scope: ${scopeLabel}`);
    console.log(`Target: LCA Shirt rows with invalid type (${INVALID_LCA_SHIRT_TYPES.join(', ')})\n`);

    if (!preview.rows.length) {
      console.log('No matching rows — nothing to do.');
      await client.query('ROLLBACK');
      process.exit(0);
    }

    for (const row of preview.rows) {
      console.log(
        `  id=${row.merchandise_id} branch=${row.branch_id} ${row.gender || '-'} · ${row.type} · ${row.size || '-'} qty=${row.quantity} price=${row.price}`
      );
    }

    const ids = preview.rows.map((r) => r.merchandise_id);
    const idList = ids.map((_, i) => `$${i + 1}`).join(', ');

    const packageDetails = await client.query(
      `SELECT COUNT(*)::int AS n FROM packagedetailstbl WHERE merchandise_id IN (${idList})`,
      ids
    );
    const promoLinks = await client.query(
      `SELECT COUNT(*)::int AS n FROM promomerchandisetbl WHERE merchandise_id IN (${idList})`,
      ids
    );
    const releaseLogs = await client.query(
      `SELECT COUNT(*)::int AS n FROM merchandise_release_logtbl WHERE merchandise_id IN (${idList})`,
      ids
    );
    const requestLinks = await client.query(
      `SELECT COUNT(*)::int AS n FROM merchandiserequestlogtbl WHERE merchandise_id IN (${idList})`,
      ids
    );

    console.log('\nRelated rows:');
    console.log(`  packagedetailstbl lines to delete: ${packageDetails.rows[0]?.n ?? 0}`);
    console.log(`  promomerchandisetbl links to delete: ${promoLinks.rows[0]?.n ?? 0}`);
    console.log(`  merchandise_release_logtbl rows to delete: ${releaseLogs.rows[0]?.n ?? 0}`);
    console.log(`  merchandiserequestlogtbl links (merchandise_id → NULL): ${requestLinks.rows[0]?.n ?? 0}`);
    console.log(`\nmerchandisestbl rows to delete: ${ids.length}`);

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('\nDry run complete — no changes written.');
      console.log(
        branchId != null
          ? `To apply Malolos: node scripts/removeInvalidLcaShirtStockRows.js --apply --branch-id=${branchId}`
          : 'To apply all branches: node scripts/removeInvalidLcaShirtStockRows.js --apply'
      );
      process.exit(0);
    }

    await client.query(
      `DELETE FROM packagedetailstbl WHERE merchandise_id IN (${idList})`,
      ids
    );
    await client.query(
      `DELETE FROM promomerchandisetbl WHERE merchandise_id IN (${idList})`,
      ids
    );
    await client.query(
      `DELETE FROM merchandise_release_logtbl WHERE merchandise_id IN (${idList})`,
      ids
    );
    await client.query(
      `UPDATE merchandiserequestlogtbl SET merchandise_id = NULL WHERE merchandise_id IN (${idList})`,
      ids
    );
    const deleted = await client.query(
      `DELETE FROM merchandisestbl WHERE merchandise_id IN (${idList}) RETURNING merchandise_id`,
      ids
    );

    await client.query('COMMIT');
    console.log(`\nDeleted ${deleted.rowCount} invalid Shirt stock row(s).`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Cleanup failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

run();
