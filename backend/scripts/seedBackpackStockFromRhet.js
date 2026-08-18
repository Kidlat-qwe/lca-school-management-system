/**
 * Add CMS LCA Bag / Backpack stock on a branch (bypasses Merchandise UI + Request Stock).
 *
 * Default (--legacy-blank): bumps quantity on the existing blank type shell only.
 * Does NOT set item_name or sku — keeps legacy merchandise page behavior.
 *
 * Optional (--from-rhet): backfill RHET itemName/sku from GET /catalog (new flow).
 *
 * Usage (from backend/):
 *   node scripts/seedBackpackStockFromRhet.js --dry-run --branch-id=6 --qty=50
 *   node scripts/seedBackpackStockFromRhet.js --apply --branch-id=6 --qty=50
 *   node scripts/seedBackpackStockFromRhet.js --dry-run --branch-name=Pampanga --qty=50
 *
 * Options:
 *   --legacy-blank   Default. Qty only on bag shell; never sets item_name/sku (no RHET call).
 *   --from-rhet      Use RHET /catalog identity (item_name + sku).
 *   --clear-item-identity  Set item_name and sku to NULL on branch bag row(s) (revert RHET backfill).
 *   --qty=N          Quantity to add (default 50). Skipped when only clearing identity.
 *   --set-qty=N      Set absolute quantity instead of adding.
 *   --sku=...        With --from-rhet only: force RHET sku.
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { getCatalog, isInventoryIntegrationEnabled } from '../services/inventory/inventoryClient.js';
import { mapCategoryNameToLocal } from '../services/inventory/inventoryFieldMapping.js';

const BAG_TYPE_NAMES = ['LCA Bag', 'Backpack', 'Bag'];
const RHET_CATEGORY = 'Backpack';

function argValue(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

const dryRun = process.argv.includes('--dry-run') || !process.argv.includes('--apply');
const apply = process.argv.includes('--apply');
const fromRhet = process.argv.includes('--from-rhet');
const legacyBlank = !fromRhet;
const clearItemIdentity = process.argv.includes('--clear-item-identity');
const branchIdArg = argValue('branch-id');
const branchNameArg = argValue('branch-name');
const skuArg = argValue('sku');
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

function unwrapCatalogItems(payload) {
  const root = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  return Array.isArray(root?.items) ? root.items : [];
}

function pickBackpackCatalogItem(items, forcedSku) {
  const backpacks = items.filter((item) => {
    const cat = String(item.categoryName || item.category_name || '')
      .trim()
      .toLowerCase();
    return cat === 'backpack' || cat === 'lca bag' || cat === 'bag';
  });
  if (!backpacks.length) return null;
  if (forcedSku) {
    const key = String(forcedSku).trim().toLowerCase();
    return (
      backpacks.find((i) => String(i.sku || '').trim().toLowerCase() === key) ||
      null
    );
  }
  return backpacks[0];
}

async function resolveBranchId(client) {
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
  throw new Error('Specify --branch-id=N or --branch-name=Fragment (e.g. Pampanga)');
}

async function listBagRows(client, branchId) {
  const result = await client.query(
    `SELECT merchandise_id, merchandise_name, quantity, price, item_name, sku, gender, type, size, remarks
     FROM merchandisestbl
     WHERE branch_id = $1
       AND LOWER(TRIM(merchandise_name)) = ANY($2::text[])
     ORDER BY merchandise_id`,
    [branchId, BAG_TYPE_NAMES.map((n) => n.toLowerCase())]
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

function matchesIdentity(row, itemName, sku) {
  const rowName = String(row.item_name || '').trim().toLowerCase();
  const rowSku = String(row.sku || '').trim().toLowerCase();
  const targetName = String(itemName || '').trim().toLowerCase();
  const targetSku = String(sku || '').trim().toLowerCase();
  if (targetSku && rowSku === targetSku) return true;
  if (targetName && rowName === targetName) return true;
  return false;
}

async function runLegacyBlank(client, branch) {
  const bagRows = await listBagRows(client, branch.branch_id);
  const blankShell = bagRows.find(isBlankShell);
  const targetRow = blankShell || (bagRows.length === 1 ? bagRows[0] : null);

  const repairNote = `Ops repair ${new Date().toISOString().slice(0, 10)} — LCA Bag${
    clearItemIdentity ? ' clear item_name/sku (legacy)' : ` +${setQty != null ? `set ${setQty}` : addQty}`
  } (CMS qty only; legacy shell)`;

  console.log(dryRun ? '=== DRY RUN (legacy blank shell) ===' : '=== APPLY (legacy blank shell) ===');
  console.log(`Branch: ${branch.branch_id} — ${branch.branch_name}`);
  if (!skipQtyChange) {
    console.log(
      setQty != null ? `Planned quantity: set to ${setQty}` : `Planned quantity: add ${addQty}`
    );
  }
  if (clearItemIdentity) {
    console.log('Will clear item_name and sku → NULL');
  } else {
    console.log('item_name / sku: unchanged');
  }
  console.log('');

  if (bagRows.length) {
    console.log('Existing bag rows on branch:');
    for (const row of bagRows) {
      console.log(
        `  id=${row.merchandise_id} name="${row.merchandise_name}" qty=${row.quantity} item_name=${row.item_name || '(blank)'} sku=${row.sku || '(blank)'}`
      );
    }
  }

  if (!targetRow) {
    throw new Error(
      bagRows.length > 1
        ? 'Multiple bag rows and none blank — pass --from-rhet or clear manually.'
        : 'No LCA Bag / Backpack row on this branch.'
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
    const qtyFlag =
      skipQtyChange ? '' : ` --qty=${addQty ?? setQty ?? 50}`;
    const clearFlag = clearItemIdentity ? ' --clear-item-identity' : '';
    console.log(
      `To apply: node scripts/seedBackpackStockFromRhet.js --apply --branch-id=${branch.branch_id}${qtyFlag}${clearFlag}`
    );
  } else {
    await client.query('COMMIT');
    console.log('\nCommitted. Refresh Merchandise → LCA Bag (legacy type qty updated).');
  }
}

async function runFromRhet(client, branch) {
  if (!isInventoryIntegrationEnabled()) {
    throw new Error('RHET Inventory not configured. Use default legacy mode without --from-rhet.');
  }

  const catalog = await getCatalog();
  const backpackItem = pickBackpackCatalogItem(unwrapCatalogItems(catalog), skuArg);
  if (!backpackItem) {
    throw new Error(
      skuArg ? `No Backpack catalog item with sku=${skuArg}` : 'No Backpack items in RHET catalog.'
    );
  }

  const rhetItemName = String(backpackItem.itemName || backpackItem.item_name || '').trim();
  const rhetSku = String(backpackItem.sku || '').trim();
  const localTypeName = mapCategoryNameToLocal(RHET_CATEGORY) || 'Backpack';
  const repairNote = `Ops seed ${new Date().toISOString().slice(0, 10)} — Backpack +${
    setQty != null ? `set ${setQty}` : addQty
  } (from RHET ${rhetSku})`;

  const bagRows = await listBagRows(client, branch.branch_id);

  console.log(dryRun ? '=== DRY RUN (--from-rhet) ===' : '=== APPLY (--from-rhet) ===');
  console.log(`Branch: ${branch.branch_id} — ${branch.branch_name}`);
  console.log(`RHET Backpack: ${rhetItemName} · ${rhetSku}\n`);

  const blankShell = bagRows.find(isBlankShell);
  const identityRow = bagRows.find((row) => matchesIdentity(row, rhetItemName, rhetSku));

  let action;
  let targetRow = null;

  if (identityRow) {
    action = setQty != null ? 'update_identity_set' : 'update_identity_add';
    targetRow = identityRow;
  } else if (blankShell) {
    action = setQty != null ? 'upgrade_shell_set' : 'upgrade_shell_add';
    targetRow = blankShell;
  } else {
    action = 'insert';
  }

  console.log('Planned action:', action);
  await client.query('BEGIN');

  if (action === 'insert') {
    const newQty = setQty != null ? setQty : addQty;
    if (!dryRun) {
      await client.query(
        `INSERT INTO merchandisestbl
           (merchandise_name, size, quantity, price, branch_id, gender, type, item_name, sku, remarks)
         VALUES ($1, NULL, $2, 0, $3, NULL, NULL, $4, $5, $6)`,
        [localTypeName, newQty, branch.branch_id, rhetItemName, rhetSku, repairNote]
      );
    }
  } else if (action.startsWith('upgrade_shell')) {
    const beforeQty = Number(targetRow.quantity ?? 0);
    const afterQty = setQty != null ? setQty : beforeQty + addQty;
    if (!dryRun) {
      await client.query(
        `UPDATE merchandisestbl
         SET item_name = $1, sku = $2, quantity = $3,
             remarks = CASE WHEN remarks IS NULL OR TRIM(remarks) = '' THEN $4 ELSE remarks || '; ' || $4 END
         WHERE merchandise_id = $5 AND branch_id = $6`,
        [rhetItemName, rhetSku, afterQty, repairNote, targetRow.merchandise_id, branch.branch_id]
      );
    }
  } else {
    const beforeQty = Number(targetRow.quantity ?? 0);
    const afterQty = setQty != null ? setQty : beforeQty + addQty;
    if (!dryRun) {
      await client.query(
        `UPDATE merchandisestbl
         SET quantity = $1,
             item_name = COALESCE(NULLIF(TRIM(item_name), ''), $2),
             sku = COALESCE(NULLIF(TRIM(sku), ''), $3),
             remarks = CASE WHEN remarks IS NULL OR TRIM(remarks) = '' THEN $4 ELSE remarks || '; ' || $4 END
         WHERE merchandise_id = $5 AND branch_id = $6`,
        [afterQty, rhetItemName, rhetSku, repairNote, targetRow.merchandise_id, branch.branch_id]
      );
    }
  }

  if (dryRun) {
    await client.query('ROLLBACK');
    console.log('\nDry run complete (--from-rhet).');
  } else {
    await client.query('COMMIT');
    console.log('\nCommitted (--from-rhet).');
  }
}

async function run() {
  const client = await getClient();
  try {
    const branch = await resolveBranchId(client);
    if (legacyBlank) {
      await runLegacyBlank(client, branch);
    } else {
      await runFromRhet(client, branch);
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
