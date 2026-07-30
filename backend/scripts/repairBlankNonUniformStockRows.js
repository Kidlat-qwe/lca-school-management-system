/**
 * Split / quarantine blank non-uniform stock aggregator rows
 * (Workbooks, Backpack, Book, Accessory, … — any type with null item_name/sku
 * and piled qty) using Approved request history.
 *
 * Dry-run by default. Apply with --apply.
 *
 * Examples:
 *   node scripts/repairBlankNonUniformStockRows.js --branch-id=12 --type=Workbooks
 *   node scripts/repairBlankNonUniformStockRows.js --branch-id=12 --type=Backpack
 *   node scripts/repairBlankNonUniformStockRows.js --branch-id=12 --type=all
 *   node scripts/repairBlankNonUniformStockRows.js --branch-id=12 --type=all --apply
 */

import '../config/loadEnv.js';
import { query, getClient } from '../config/database.js';
import { isUniformLikeCategory } from '../services/inventory/inventoryFieldMapping.js';

/** Supports `--flag=value` and `--flag value`. */
function argValue(flag) {
  const argv = process.argv.slice(2);
  const eqPrefix = `${flag}=`;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === flag) {
      const next = argv[i + 1];
      if (next == null || next.startsWith('--')) return null;
      return next;
    }
    if (token.startsWith(eqPrefix)) {
      return token.slice(eqPrefix.length) || null;
    }
  }
  return null;
}

const apply = process.argv.includes('--apply');
const branchId = Number(argValue('--branch-id'));
const typeArg = String(argValue('--type') || 'all').trim();
const typeAll = typeArg.toLowerCase() === 'all';

if (!Number.isFinite(branchId) || branchId <= 0) {
  console.error(
    'Usage: node scripts/repairBlankNonUniformStockRows.js --branch-id=<id> [--type=Workbooks|Backpack|all] [--apply]\n' +
      '   or: node scripts/repairBlankNonUniformStockRows.js --branch-id <id> [--type Workbooks|Backpack|all] [--apply]\n' +
      'Default --type=all repairs every blank non-uniform aggregator on the branch.'
  );
  process.exit(1);
}

async function listBlankNonUniformTypes(branchId) {
  const result = await query(
    `SELECT DISTINCT merchandise_name
     FROM merchandisestbl
     WHERE branch_id = $1
       AND COALESCE(TRIM(item_name), '') = ''
       AND COALESCE(TRIM(sku), '') = ''
       AND gender IS NULL
       AND type IS NULL
       AND (size IS NULL OR TRIM(size) = '' OR size = 'N/A')
     ORDER BY merchandise_name`,
    [branchId]
  );
  return result.rows
    .map((r) => String(r.merchandise_name || '').trim())
    .filter((name) => name && !isUniformLikeCategory(name));
}

async function repairOneType(branchId, typeName, { apply, client }) {
  const blankRows = await query(
    `SELECT merchandise_id, merchandise_name, quantity, price, item_name, sku, remarks, branch_id
     FROM merchandisestbl
     WHERE branch_id = $1
       AND LOWER(TRIM(merchandise_name)) = LOWER(TRIM($2))
       AND COALESCE(TRIM(item_name), '') = ''
       AND COALESCE(TRIM(sku), '') = ''
       AND gender IS NULL
       AND type IS NULL
       AND (size IS NULL OR TRIM(size) = '' OR size = 'N/A')
     ORDER BY merchandise_id`,
    [branchId, typeName]
  );

  console.log(`\n=== Branch ${branchId} · type "${typeName}" ===`);
  console.log(`Blank rows: ${blankRows.rows.length}`);
  for (const row of blankRows.rows) {
    console.log(`  blank id=${row.merchandise_id} qty=${row.quantity} price=${row.price}`);
  }

  if (blankRows.rows.length === 0) {
    console.log('Nothing to repair for this type.');
    return { blankCount: 0, plannedKeys: 0 };
  }

  const approved = await query(
    `SELECT request_id, inventory_item_name, inventory_requested_sku, inventory_matched_sku,
            requested_quantity, status, inventory_status, merchandise_name, inventory_category_name
     FROM merchandiserequestlogtbl
     WHERE requested_branch_id = $1
       AND (
         LOWER(TRIM(COALESCE(inventory_category_name, ''))) = LOWER(TRIM($2))
         OR LOWER(TRIM(COALESCE(merchandise_name, ''))) = LOWER(TRIM($2))
         OR (
           LOWER(TRIM($2)) = 'backpack'
           AND LOWER(TRIM(COALESCE(merchandise_name, ''))) IN ('lca bag', 'backpack')
         )
       )
       AND status = 'Approved'
       AND (
         COALESCE(TRIM(inventory_item_name), '') <> ''
         OR COALESCE(TRIM(inventory_requested_sku), '') <> ''
         OR COALESCE(TRIM(inventory_matched_sku), '') <> ''
       )
     ORDER BY request_id`,
    [branchId, typeName]
  );

  console.log(`Approved identified requests: ${approved.rows.length}`);
  const byKey = new Map();
  for (const req of approved.rows) {
    const itemName = String(req.inventory_item_name || '').trim();
    const sku = String(
      req.inventory_matched_sku || req.inventory_requested_sku || ''
    ).trim();
    const key = `${itemName.toLowerCase()}|${sku.toLowerCase()}`;
    const prev = byKey.get(key) || { itemName, sku, qty: 0, requestIds: [] };
    prev.qty += Number(req.requested_quantity) || 0;
    prev.requestIds.push(req.request_id);
    byKey.set(key, prev);
  }

  for (const info of byKey.values()) {
    console.log(
      `  plan create/update ${info.itemName || '(no name)'} / ${info.sku || '(no sku)'} ` +
        `qty=${info.qty} from requests ${info.requestIds.join(',')}`
    );
  }

  if (!apply) {
    return { blankCount: blankRows.rows.length, plannedKeys: byKey.size };
  }

  if (!client) {
    throw new Error('apply requires a DB client');
  }

  for (const info of byKey.values()) {
    const existing = await client.query(
      `SELECT merchandise_id, quantity
       FROM merchandisestbl
       WHERE branch_id = $1
         AND LOWER(TRIM(merchandise_name)) = LOWER(TRIM($2))
         AND (
           ($3::text <> '' AND LOWER(TRIM(COALESCE(item_name, ''))) = LOWER(TRIM($3)))
           OR ($4::text <> '' AND LOWER(TRIM(COALESCE(sku, ''))) = LOWER(TRIM($4)))
         )
       ORDER BY merchandise_id DESC
       LIMIT 1`,
      [branchId, typeName, info.itemName || '', info.sku || '']
    );

    if (existing.rows[0]) {
      await client.query(
        `UPDATE merchandisestbl
         SET quantity = COALESCE(quantity, 0) + $1,
             item_name = COALESCE(NULLIF(TRIM(COALESCE(item_name, '')), ''), $2),
             sku = COALESCE(NULLIF(TRIM(COALESCE(sku, '')), ''), $3)
         WHERE merchandise_id = $4`,
        [info.qty, info.itemName || null, info.sku || null, existing.rows[0].merchandise_id]
      );
      console.log(`Updated merchandise_id=${existing.rows[0].merchandise_id} +${info.qty}`);
    } else {
      const priceRef = await client.query(
        `SELECT price FROM merchandisestbl
         WHERE branch_id = $1 AND LOWER(TRIM(merchandise_name)) = LOWER(TRIM($2))
         ORDER BY merchandise_id DESC LIMIT 1`,
        [branchId, typeName]
      );
      const price = priceRef.rows[0]?.price ?? 0;
      const inserted = await client.query(
        `INSERT INTO merchandisestbl
           (merchandise_name, quantity, price, branch_id, gender, type, size, item_name, sku)
         VALUES ($1, $2, $3, $4, NULL, NULL, NULL, $5, $6)
         RETURNING merchandise_id`,
        [typeName, info.qty, price, branchId, info.itemName || null, info.sku || null]
      );
      console.log(`Created merchandise_id=${inserted.rows[0].merchandise_id} qty=${info.qty}`);
    }
  }

  for (const row of blankRows.rows) {
    await client.query(
      `UPDATE merchandisestbl
       SET quantity = 0,
           remarks = COALESCE(remarks || ' ', '') || '[repaired blank aggregator zeroed ${new Date().toISOString().slice(0, 10)}]'
       WHERE merchandise_id = $1`,
      [row.merchandise_id]
    );
    console.log(`Zeroed blank aggregator merchandise_id=${row.merchandise_id}`);
  }

  return { blankCount: blankRows.rows.length, plannedKeys: byKey.size };
}

async function main() {
  const types = typeAll
    ? await listBlankNonUniformTypes(branchId)
    : [typeArg];

  if (types.length === 0) {
    console.log(
      typeAll
        ? `Branch ${branchId}: no blank non-uniform aggregator rows found.`
        : `Branch ${branchId}: no blank rows for type "${typeArg}".`
    );
    return;
  }

  console.log(
    `Branch ${branchId} · repairing type(s): ${types.join(', ')}` +
      (apply ? ' (--apply)' : ' (dry-run)')
  );

  if (!apply) {
    for (const typeName of types) {
      await repairOneType(branchId, typeName, { apply: false, client: null });
    }
    console.log(
      '\nDry-run only. Re-run with --apply to create identified rows and zero blank aggregators.'
    );
    console.log(
      'Note: planned qty is sum of Approved request history — it may exceed blank qty.'
    );
    return;
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    for (const typeName of types) {
      await repairOneType(branchId, typeName, { apply: true, client });
    }
    await client.query('COMMIT');
    console.log('\nRepair applied.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release?.();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
