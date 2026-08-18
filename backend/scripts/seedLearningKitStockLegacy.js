/**
 * Add CMS Learning Kit stock on a branch (bypasses Merchandise UI + Request Stock).
 *
 * Legacy blank shell only: bumps quantity on the existing type row.
 * Does NOT set item_name or sku — keeps legacy merchandise page behavior.
 * No RHET /catalog call.
 *
 * Usage (from backend/):
 *   node scripts/seedLearningKitStockLegacy.js --dry-run --branch-id=5 --qty=50
 *   node scripts/seedLearningKitStockLegacy.js --apply --branch-id=5 --qty=50
 *   node scripts/seedLearningKitStockLegacy.js --dry-run --branch-name=Guiguinto --qty=50
 *
 * Malolos reset (remove RHET catalog rows + dedupe shells, then set qty 50):
 *   node scripts/seedLearningKitStockLegacy.js --dry-run --branch-id=1 --remove-rhet-seeds --dedupe-blank-shells --set-qty=50
 *
 * Options:
 *   --qty=N                Quantity to add (default 50)
 *   --set-qty=N            Set absolute quantity instead of adding
 *   --clear-item-identity  Set item_name and sku to NULL (revert RHET backfill)
 *   --remove-rhet-seeds    Delete Learning Kit rows that have item_name and/or sku (RHET catalog seeds)
 *   --dedupe-blank-shells  Delete extra blank type shells; keep one (prefers row with image_url)
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const LEARNING_KIT_TYPE_NAMES = ['Learning Kit', 'LCA Learning Kits', 'LCA Learning Kit'];

function argValue(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

const dryRun = process.argv.includes('--dry-run') || !process.argv.includes('--apply');
const apply = process.argv.includes('--apply');
const clearItemIdentity = process.argv.includes('--clear-item-identity');
const removeRhetSeeds = process.argv.includes('--remove-rhet-seeds');
const dedupeBlankShells = process.argv.includes('--dedupe-blank-shells');
const branchIdArg = argValue('branch-id');
const branchNameArg = argValue('branch-name');
const qtyAddArg = argValue('qty');
const setQtyArg = argValue('set-qty');

const addQty = setQtyArg != null ? null : Math.max(1, Number(qtyAddArg || 50) || 50);
const setQty = setQtyArg != null ? Math.max(0, Number(setQtyArg) || 0) : null;
const skipQtyChange = clearItemIdentity && setQtyArg == null && qtyAddArg == null;

if (apply && process.argv.includes('--dry-run')) {
  console.error('Use either --dry-run or --apply, not both.');
  process.exit(1);
}

if (setQtyArg != null && qtyAddArg != null) {
  console.error('Use --qty (add) OR --set-qty (absolute), not both.');
  process.exit(1);
}

async function resolveBranch(client) {
  if (branchIdArg) {
    const id = Number(branchIdArg);
    if (!Number.isInteger(id) || id < 1) {
      throw new Error('Invalid --branch-id=');
    }
    const row = (
      await client.query('SELECT branch_id, branch_name FROM branchestbl WHERE branch_id = $1', [
        id,
      ])
    ).rows[0];
    if (!row) throw new Error(`branch_id=${id} not found`);
    return row;
  }
  if (branchNameArg) {
    const row = (
      await client.query(
        `SELECT branch_id, branch_name FROM branchestbl
         WHERE branch_name ILIKE $1 OR branch_nickname ILIKE $1
         ORDER BY branch_id LIMIT 1`,
        [`%${branchNameArg}%`]
      )
    ).rows[0];
    if (!row) throw new Error(`No branch matching --branch-name=${branchNameArg}`);
    return row;
  }
  throw new Error('Specify --branch-id=N or --branch-name=Fragment (e.g. Guiguinto)');
}

async function listLearningKitRows(client, branchId) {
  const result = await client.query(
    `SELECT merchandise_id, merchandise_name, quantity, price, item_name, sku,
            gender, type, size, remarks, image_url
     FROM merchandisestbl
     WHERE branch_id = $1
       AND LOWER(TRIM(merchandise_name)) = ANY($2::text[])
     ORDER BY merchandise_id`,
    [branchId, LEARNING_KIT_TYPE_NAMES.map((n) => n.toLowerCase())]
  );
  return result.rows;
}

function isBlankShell(row) {
  return (
    !String(row.item_name || '').trim() &&
    !String(row.sku || '').trim() &&
    !row.gender &&
    !row.type &&
    (!row.size || row.size === 'N/A')
  );
}

function isRhetSeedRow(row) {
  return Boolean(String(row.item_name || '').trim() || String(row.sku || '').trim());
}

function pickPrimaryBlankShell(blankShells) {
  return [...blankShells].sort((a, b) => {
    const aImg = String(a.image_url || '').trim() ? 1 : 0;
    const bImg = String(b.image_url || '').trim() ? 1 : 0;
    if (bImg !== aImg) return bImg - aImg;
    return a.merchandise_id - b.merchandise_id;
  })[0];
}

async function deleteMerchandiseRows(client, ids) {
  if (!ids.length) return 0;
  const idList = ids.map((_, i) => `$${i + 1}`).join(', ');

  await client.query(`DELETE FROM packagedetailstbl WHERE merchandise_id IN (${idList})`, ids);
  await client.query(`DELETE FROM promomerchandisetbl WHERE merchandise_id IN (${idList})`, ids);
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
  return deleted.rowCount;
}

async function run() {
  const client = await getClient();
  try {
    const branch = await resolveBranch(client);
    let kitRows = await listLearningKitRows(client, branch.branch_id);

    const repairNote = `Ops repair ${new Date().toISOString().slice(0, 10)} — Learning Kit${
      clearItemIdentity ? ' clear item_name/sku (legacy)' : ` +${setQty != null ? `set ${setQty}` : addQty}`
    } (CMS qty only; legacy shell)`;

    console.log(dryRun ? '=== DRY RUN (legacy Learning Kit shell) ===' : '=== APPLY (legacy Learning Kit shell) ===');
    console.log(`Branch: ${branch.branch_id} — ${branch.branch_name}`);
    if (!skipQtyChange) {
      console.log(
        setQty != null ? `Planned quantity: set to ${setQty}` : `Planned quantity: add ${addQty}`
      );
    }
    console.log('item_name / sku: unchanged on kept shell (legacy blank)\n');

    if (kitRows.length) {
      console.log('Existing Learning Kit rows on branch:');
      for (const row of kitRows) {
        console.log(
          `  id=${row.merchandise_id} name="${row.merchandise_name}" qty=${row.quantity} item_name=${row.item_name || '(blank)'} sku=${row.sku || '(blank)'}`
        );
      }
    }

    const deleteIds = new Set();

    if (removeRhetSeeds) {
      for (const row of kitRows.filter(isRhetSeedRow)) {
        deleteIds.add(row.merchandise_id);
        console.log(`\n[remove-rhet-seeds] DELETE id=${row.merchandise_id} ${row.item_name} · ${row.sku}`);
      }
    }

    const blankShells = kitRows.filter(isBlankShell);
    let primaryBlank = pickPrimaryBlankShell(blankShells);

    if (dedupeBlankShells && blankShells.length > 1 && primaryBlank) {
      for (const row of blankShells) {
        if (row.merchandise_id === primaryBlank.merchandise_id) continue;
        deleteIds.add(row.merchandise_id);
        console.log(`\n[dedupe-blank-shells] DELETE duplicate shell id=${row.merchandise_id}`);
      }
    }

    if (deleteIds.size) {
      console.log(`\nTotal rows to delete: ${deleteIds.size}`);
    }

    kitRows = kitRows.filter((row) => !deleteIds.has(row.merchandise_id));
    blankShells.length = 0;
    blankShells.push(...kitRows.filter(isBlankShell));
    primaryBlank = pickPrimaryBlankShell(blankShells);

    const targetRow = primaryBlank || (kitRows.length === 1 ? kitRows[0] : null);

    if (!targetRow) {
      throw new Error(
        kitRows.length > 1
          ? 'Multiple Learning Kit rows and none blank — clear item_name/sku or use --remove-rhet-seeds.'
          : 'No Learning Kit row on this branch.'
      );
    }

    const beforeQty = Number(targetRow.quantity ?? 0);
    const afterQty = skipQtyChange
      ? beforeQty
      : setQty != null
        ? setQty
        : beforeQty + addQty;

    console.log(
      `\n[${dryRun ? 'dry-run' : 'apply'}] UPDATE id=${targetRow.merchandise_id} ` +
        `"${targetRow.merchandise_name}":` +
        (skipQtyChange ? '' : ` qty ${beforeQty} → ${afterQty};`) +
        (clearItemIdentity ? ' item_name/sku → NULL' : ' item_name/sku unchanged')
    );

    await client.query('BEGIN');

    if (!dryRun && deleteIds.size) {
      const n = await deleteMerchandiseRows(client, [...deleteIds]);
      console.log(`Deleted ${n} row(s).`);
    }

    if (!dryRun) {
      const updated = await client.query(
        `UPDATE merchandisestbl
         SET quantity = $1,
             item_name = CASE WHEN $2 THEN NULL ELSE item_name END,
             sku = CASE WHEN $2 THEN NULL ELSE sku END,
             remarks = CASE
               WHEN remarks IS NULL OR TRIM(remarks) = '' THEN $3
               WHEN remarks ILIKE '%' || $3 || '%' THEN remarks
               ELSE remarks || '; ' || $3
             END
         WHERE merchandise_id = $4
           AND branch_id = $5
         RETURNING merchandise_id, merchandise_name, quantity, item_name, sku, remarks`,
        [afterQty, clearItemIdentity, repairNote, targetRow.merchandise_id, branch.branch_id]
      );
      if (!updated.rows[0]) {
        throw new Error('UPDATE matched 0 rows');
      }
      console.log('Updated:', updated.rows[0]);
    }

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('\nDry run complete — no changes written.');
      const flags = [
        removeRhetSeeds ? ' --remove-rhet-seeds' : '',
        dedupeBlankShells ? ' --dedupe-blank-shells' : '',
        skipQtyChange ? '' : setQty != null ? ` --set-qty=${setQty}` : ` --qty=${addQty ?? 50}`,
        clearItemIdentity ? ' --clear-item-identity' : '',
      ].join('');
      console.log(
        `To apply: node scripts/seedLearningKitStockLegacy.js --apply --branch-id=${branch.branch_id}${flags}`
      );
    } else {
      await client.query('COMMIT');
      console.log('\nCommitted. Refresh Merchandise → Learning Kit (legacy type qty updated).');
    }
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('Failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

run();
