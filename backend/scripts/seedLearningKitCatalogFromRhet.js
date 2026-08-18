/**
 * Seed CMS branch stock rows for RHET Learning Kit catalog items (qty 0).
 *
 * Pulls kit itemName + sku from RHET GET /catalog (same data as Inventory admin).
 * Does NOT write to RHET — only inserts missing rows in merchandisestbl.
 *
 * Each row:
 *   merchandise_name = Learning Kit
 *   item_name, sku    = RHET kit identity
 *   quantity = 0, price = 0
 *   gender, type, size = NULL
 *
 * Usage (from backend/):
 *   node scripts/seedLearningKitCatalogFromRhet.js --dry-run --branch-id=1
 *   node scripts/seedLearningKitCatalogFromRhet.js --apply --branch-id=1
 *   node scripts/seedLearningKitCatalogFromRhet.js --dry-run --all-branches
 *   node scripts/seedLearningKitCatalogFromRhet.js --apply --all-branches
 *
 * Requires INVENTORY_API_URL + INVENTORY_INTEGRATION_KEY in backend/.env
 */

import '../config/loadEnv.js';
import { query, getClient } from '../config/database.js';
import { getCatalog, isInventoryIntegrationEnabled } from '../services/inventory/inventoryClient.js';
import { mapCategoryNameToLocal } from '../services/inventory/inventoryFieldMapping.js';

const LEARNING_KIT_CATEGORY = 'Learning Kit';
const LEARNING_KIT_KIND = 'LEARNING_KIT';

function argValue(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

const dryRun = process.argv.includes('--dry-run') || !process.argv.includes('--apply');
const apply = process.argv.includes('--apply');
const allBranches = process.argv.includes('--all-branches');
const branchIdArg = argValue('branch-id');
const branchId = branchIdArg ? Number(branchIdArg) : null;

if (apply && process.argv.includes('--dry-run')) {
  console.error('Use either --dry-run or --apply, not both.');
  process.exit(1);
}

if (!allBranches && (branchIdArg == null || !Number.isInteger(branchId) || branchId < 1)) {
  console.error(
    'Specify --branch-id=N or --all-branches.\n' +
      '  node scripts/seedLearningKitCatalogFromRhet.js --dry-run --branch-id=1'
  );
  process.exit(1);
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function unwrapCatalogItems(payload) {
  const root = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  return Array.isArray(root?.items) ? root.items : [];
}

function isLearningKitCatalogItem(item) {
  const kind = String(item?.categoryKind || item?.category_kind || '')
    .trim()
    .toUpperCase();
  if (kind === LEARNING_KIT_KIND) return true;
  const category = String(item?.categoryName || item?.category_name || '')
    .trim()
    .toLowerCase();
  return category.includes('learning kit');
}

function pickLearningKitRows(catalogPayload) {
  const items = unwrapCatalogItems(catalogPayload);
  const seen = new Set();
  const rows = [];

  for (const item of items) {
    if (!isLearningKitCatalogItem(item)) continue;
    const itemName = String(item.itemName || item.item_name || '').trim();
    const sku = String(item.sku || '').trim();
    if (!itemName && !sku) continue;
    const dedupeKey = `${normalizeKey(itemName)}|${normalizeKey(sku)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    rows.push({
      itemName: itemName || sku,
      sku: sku || null,
      variation: String(item.variation || '').trim() || null,
      rhetStocks: item.stocks ?? item.stock ?? null,
      inventoryId: item.inventoryId || item.inventory_id || null,
    });
  }

  rows.sort((a, b) => a.itemName.localeCompare(b.itemName));
  return rows;
}

async function listTargetBranchIds() {
  if (!allBranches) return [branchId];
  const result = await query(
    `SELECT branch_id, branch_name FROM branchestbl ORDER BY branch_id`
  );
  return result.rows.map((r) => r.branch_id);
}

async function findExistingRow(client, { branch_id, itemName, sku }) {
  const result = await client.query(
    `SELECT merchandise_id, quantity, price, item_name, sku
     FROM merchandisestbl
     WHERE branch_id = $1
       AND LOWER(TRIM(merchandise_name)) = LOWER(TRIM($2))
       AND LOWER(TRIM(COALESCE(item_name, ''))) = LOWER(TRIM($3))
       AND LOWER(TRIM(COALESCE(sku, ''))) = LOWER(TRIM(COALESCE($4, '')))
     ORDER BY merchandise_id
     LIMIT 1`,
    [branch_id, LEARNING_KIT_CATEGORY, itemName, sku || '']
  );
  return result.rows[0] || null;
}

async function run() {
  if (!isInventoryIntegrationEnabled()) {
    console.error(
      'RHET Inventory is not configured. Set INVENTORY_API_URL and INVENTORY_INTEGRATION_KEY in backend/.env'
    );
    process.exit(1);
  }

  const branchIds = await listTargetBranchIds();
  if (!branchIds.length) {
    console.error('No target branches.');
    process.exit(1);
  }

  console.log('Fetching RHET /catalog …');
  const catalog = await getCatalog();
  const kitRows = pickLearningKitRows(catalog);

  if (!kitRows.length) {
    console.error('No Learning Kit items returned from RHET catalog.');
    process.exit(1);
  }

  const localCategoryName = mapCategoryNameToLocal(LEARNING_KIT_CATEGORY) || LEARNING_KIT_CATEGORY;

  console.log(dryRun ? '\n=== DRY RUN ===' : '\n=== APPLY ===');
  console.log(
    `RHET Learning Kit variants: ${kitRows.length} · Branches: ${branchIds.join(', ')}\n`
  );

  for (const kit of kitRows) {
    console.log(
      `  ${kit.itemName}${kit.sku ? ` · ${kit.sku}` : ''}` +
        (kit.variation ? ` (${kit.variation})` : '') +
        (kit.rhetStocks != null ? ` — RHET stock ${kit.rhetStocks}` : '')
    );
  }

  const client = await getClient();
  let insertCount = 0;
  let skipCount = 0;

  try {
    await client.query('BEGIN');

    for (const targetBranchId of branchIds) {
      console.log(`\n--- branch_id=${targetBranchId} ---`);
      for (const kit of kitRows) {
        const existing = await findExistingRow(client, {
          branch_id: targetBranchId,
          itemName: kit.itemName,
          sku: kit.sku,
        });

        if (existing) {
          skipCount += 1;
          console.log(
            `[skip] already exists id=${existing.merchandise_id} ${kit.itemName} · ${kit.sku || '(no sku)'} qty=${existing.quantity}`
          );
          continue;
        }

        if (dryRun) {
          insertCount += 1;
          console.log(
            `[dry-run] would insert ${localCategoryName} | ${kit.itemName} | ${kit.sku || '(no sku)'} qty=0`
          );
          continue;
        }

        const inserted = await client.query(
          `INSERT INTO merchandisestbl
             (merchandise_name, size, quantity, price, branch_id, gender, type, item_name, sku, remarks)
           VALUES ($1, NULL, 0, 0, $2, NULL, NULL, $3, $4, $5)
           RETURNING merchandise_id`,
          [
            localCategoryName,
            targetBranchId,
            kit.itemName,
            kit.sku,
            `RHET Learning Kit seed (${kit.sku || kit.itemName})`,
          ]
        );
        insertCount += 1;
        console.log(
          `[insert] id=${inserted.rows[0].merchandise_id} ${kit.itemName} · ${kit.sku || '(no sku)'} qty=0`
        );
      }
    }

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log(
        `\nDry run complete — would insert ${insertCount} row(s), skip ${skipCount} existing.`
      );
      console.log(
        allBranches
          ? 'To apply all branches: node scripts/seedLearningKitCatalogFromRhet.js --apply --all-branches'
          : `To apply: node scripts/seedLearningKitCatalogFromRhet.js --apply --branch-id=${branchId}`
      );
    } else {
      await client.query('COMMIT');
      console.log(`\nDone — inserted ${insertCount} row(s), skipped ${skipCount} existing.`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

run();
