/**
 * Remove "Uniform Replacement" merchandise type (and its stock rows) for one branch.
 *
 * Scope:
 *   - Branch resolved by --branch-name= (default: Guiguinto) or --branch-id=
 *   - merchandise_name matching Uniform Replacement variants only
 *     (exact UI label + known legacy CMS names)
 *
 * Does NOT touch other branches or other merchandise types (e.g. School Uniform).
 *
 * FK cleanup before DELETE (same pattern as clearAllMerchandise / mergeMistakenMerchandiseTypes):
 *   1) packagedetailstbl lines for target ids
 *   2) promomerchandisetbl links
 *   3) merchandise_release_logtbl rows
 *   4) merchandiserequestlogtbl.merchandise_id → NULL (request history kept)
 *   5) DELETE merchandisestbl rows
 *
 * Acknowledgement receipt / invoice JSON snapshots are not rewritten.
 *
 * Usage (from backend/):
 *   node scripts/removeGuiguintoUniformReplacementMerch.js --production
 *   node scripts/removeGuiguintoUniformReplacementMerch.js --production --apply
 *   node scripts/removeGuiguintoUniformReplacementMerch.js --production --branch-name=Cavite
 *   node scripts/removeGuiguintoUniformReplacementMerch.js --production --branch-name=Cavite --apply
 *
 * Optional:
 *   --branch-name=Guiguinto|Cavite|…   (default Guiguinto)
 *   --branch-id=3                      force id (must still match --branch-name)
 *
 * Default is dry-run unless --apply is passed.
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

/**
 * CMS type names that should disappear from Merchandise cards.
 * UI card label: "Uniform Replacement".
 * Legacy RHET-era catalog also used School Uniform_Replacement / PE Uniform_Replacement.
 */
const TARGET_MERCHANDISE_NAMES = [
  'Uniform Replacement',
  'School Uniform_Replacement',
  'PE Uniform_Replacement',
];

function argValue(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

const isApply = process.argv.includes('--apply');
const isDryRun = !isApply || process.argv.includes('--dry-run');
const branchNameFragment = String(argValue('branch-name') || 'Guiguinto').trim();
const branchIdArg = argValue('branch-id');
const forcedBranchId = branchIdArg ? Number(branchIdArg) : null;

if (isApply && process.argv.includes('--dry-run')) {
  console.error('Use either --dry-run (default) or --apply, not both.');
  process.exit(1);
}

if (!branchNameFragment) {
  console.error('Invalid --branch-name= (must be a non-empty string, e.g. Cavite).');
  process.exit(1);
}

if (branchIdArg && (!Number.isInteger(forcedBranchId) || forcedBranchId <= 0)) {
  console.error('Invalid --branch-id= (must be a positive integer).');
  process.exit(1);
}

function normalizeName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ');
}

/** Extra safety: name must look like Uniform Replacement (not plain School Uniform). */
function isUniformReplacementName(name) {
  const n = normalizeName(name);
  if (!n.includes('replacement')) return false;
  if (!n.includes('uniform')) return false;
  return true;
}

async function resolveBranch(client) {
  if (forcedBranchId != null) {
    const row = (
      await client.query(
        `SELECT branch_id, branch_name, branch_nickname
         FROM branchestbl
         WHERE branch_id = $1`,
        [forcedBranchId]
      )
    ).rows[0];
    if (!row) {
      throw new Error(`Branch ${forcedBranchId} not found`);
    }
    const haystack = `${row.branch_name || ''} ${row.branch_nickname || ''}`;
    if (!haystack.toLowerCase().includes(branchNameFragment.toLowerCase())) {
      throw new Error(
        `Branch ${forcedBranchId} name mismatch: "${row.branch_name}" (expected to include ${branchNameFragment})`
      );
    }
    return row;
  }

  const matches = (
    await client.query(
      `
      SELECT branch_id, branch_name, branch_nickname
      FROM branchestbl
      WHERE branch_name ILIKE '%' || $1 || '%'
         OR COALESCE(branch_nickname, '') ILIKE '%' || $1 || '%'
      ORDER BY branch_id
      `,
      [branchNameFragment]
    )
  ).rows;

  if (matches.length === 0) {
    throw new Error(`No branch found matching "${branchNameFragment}"`);
  }
  if (matches.length > 1) {
    console.log(`Multiple "${branchNameFragment}"-like branches found:`);
    for (const b of matches) {
      console.log(`  ${b.branch_id} — ${b.branch_name}`);
    }
    throw new Error(
      `Ambiguous branch. Re-run with --branch-id=<id> (e.g. --branch-id=${matches[0].branch_id})`
    );
  }
  return matches[0];
}

async function main() {
  console.log(
    `\n${branchNameFragment} Uniform Replacement merchandise removal` +
      `${isDryRun ? ' (DRY-RUN — no deletes)' : ' (APPLY — will DELETE)'}\n`
  );
  console.log(
    `DB_NAME=${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV || '(not set)'}`
  );
  console.log(`Target names: ${TARGET_MERCHANDISE_NAMES.join(' | ')}`);
  console.log('');

  const client = await getClient();
  try {
    const dbInfo = await client.query(
      `SELECT current_database() AS db, current_user AS db_user`
    );
    console.log('Connected:', dbInfo.rows[0]);
    console.log('');

    const branch = await resolveBranch(client);
    const branchId = Number(branch.branch_id);
    console.log(`Branch: ${branchId} — ${branch.branch_name}`);

    const nameKeys = TARGET_MERCHANDISE_NAMES.map((n) => normalizeName(n));

    const rowsRes = await client.query(
      `
      SELECT
        merchandise_id,
        merchandise_name,
        quantity,
        size,
        gender,
        type,
        price,
        branch_id,
        item_name,
        sku,
        image_url,
        remarks
      FROM merchandisestbl
      WHERE branch_id = $1
        AND (
          LOWER(TRIM(REPLACE(merchandise_name, '_', ' '))) = ANY($2::text[])
          OR (
            LOWER(merchandise_name) LIKE '%uniform%'
            AND LOWER(merchandise_name) LIKE '%replacement%'
          )
        )
      ORDER BY merchandise_name, merchandise_id
      `,
      [branchId, nameKeys]
    );

    const rows = rowsRes.rows.filter((r) => isUniformReplacementName(r.merchandise_name));
    const ids = rows.map((r) => Number(r.merchandise_id));

    if (rows.length === 0) {
      console.log(
        `\nNo matching Uniform Replacement rows on ${branchNameFragment}. Nothing to do.`
      );
      return;
    }

    console.log(`\n=== Matched merchandisestbl rows: ${rows.length} ===`);
    console.table(
      rows.map((r) => ({
        merchandise_id: r.merchandise_id,
        merchandise_name: r.merchandise_name,
        gender: r.gender || '',
        type: r.type || '',
        size: r.size || '',
        quantity: Number(r.quantity ?? 0),
        price: r.price,
        item_name: r.item_name || '',
        sku: r.sku || '',
      }))
    );

    const byType = new Map();
    for (const r of rows) {
      const key = r.merchandise_name;
      byType.set(key, (byType.get(key) || 0) + 1);
    }
    console.log('By type card:');
    for (const [name, count] of byType) {
      console.log(`  "${name}": ${count} stock row(s)`);
    }

    const packageDetails = await client.query(
      `
      SELECT pd.packagedtl_id, pd.package_id, p.package_name, pd.merchandise_id, m.merchandise_name
      FROM packagedetailstbl pd
      JOIN merchandisestbl m ON m.merchandise_id = pd.merchandise_id
      LEFT JOIN packagestbl p ON p.package_id = pd.package_id
      WHERE pd.merchandise_id = ANY($1::int[])
      ORDER BY pd.package_id, pd.packagedtl_id
      `,
      [ids]
    );

    const promoLinks = await client.query(
      `
      SELECT pm.promomerchandise_id, pm.promo_id, pm.merchandise_id, pm.quantity
      FROM promomerchandisetbl pm
      WHERE pm.merchandise_id = ANY($1::int[])
      ORDER BY pm.promo_id, pm.promomerchandise_id
      `,
      [ids]
    );

    const releaseLogs = await client.query(
      `
      SELECT release_log_id, merchandise_id, branch_id, quantity, released_at
      FROM merchandise_release_logtbl
      WHERE merchandise_id = ANY($1::int[])
      ORDER BY release_log_id
      `,
      [ids]
    );

    const requestLinks = await client.query(
      `
      SELECT request_id, merchandise_id, merchandise_name, status, requested_branch_id
      FROM merchandiserequestlogtbl
      WHERE merchandise_id = ANY($1::int[])
      ORDER BY request_id
      `,
      [ids]
    );

    console.log(`\nFK blockers / related:`);
    console.log(`  packagedetailstbl to DELETE: ${packageDetails.rows.length}`);
    for (const r of packageDetails.rows.slice(0, 20)) {
      console.log(
        `    package ${r.package_id} (${r.package_name || 'unnamed'}) → merch ${r.merchandise_id} (${r.merchandise_name})`
      );
    }
    if (packageDetails.rows.length > 20) {
      console.log(`    … and ${packageDetails.rows.length - 20} more`);
    }
    console.log(`  promomerchandisetbl to DELETE: ${promoLinks.rows.length}`);
    console.log(`  merchandise_release_logtbl to DELETE: ${releaseLogs.rows.length}`);
    console.log(
      `  merchandiserequestlogtbl.merchandise_id → NULL (keep rows): ${requestLinks.rows.length}`
    );

    if (isDryRun) {
      console.log('\nDry-run complete — no changes written.');
      console.log('To delete for real:');
      console.log(
        `  node scripts/removeGuiguintoUniformReplacementMerch.js --production --branch-name=${branchNameFragment} --apply`
      );
      return;
    }

    await client.query('BEGIN');

    const pkgDel = await client.query(
      `DELETE FROM packagedetailstbl WHERE merchandise_id = ANY($1::int[])`,
      [ids]
    );
    const promoDel = await client.query(
      `DELETE FROM promomerchandisetbl WHERE merchandise_id = ANY($1::int[])`,
      [ids]
    );
    const releaseDel = await client.query(
      `DELETE FROM merchandise_release_logtbl WHERE merchandise_id = ANY($1::int[])`,
      [ids]
    );
    const reqNull = await client.query(
      `UPDATE merchandiserequestlogtbl SET merchandise_id = NULL WHERE merchandise_id = ANY($1::int[])`,
      [ids]
    );
    const merchDel = await client.query(
      `
      DELETE FROM merchandisestbl
      WHERE branch_id = $1
        AND merchandise_id = ANY($2::int[])
      `,
      [branchId, ids]
    );

    await client.query('COMMIT');

    console.log('\n=== APPLY complete ===');
    console.log(`  packagedetailstbl deleted: ${pkgDel.rowCount}`);
    console.log(`  promomerchandisetbl deleted: ${promoDel.rowCount}`);
    console.log(`  merchandise_release_logtbl deleted: ${releaseDel.rowCount}`);
    console.log(`  merchandiserequestlogtbl nulled: ${reqNull.rowCount}`);
    console.log(`  merchandisestbl deleted: ${merchDel.rowCount}`);
    console.log(
      `\nRefresh Merchandise for ${branchNameFragment} — "Uniform Replacement" card should be gone.`
    );
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('\nremoveGuiguintoUniformReplacementMerch failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main();
