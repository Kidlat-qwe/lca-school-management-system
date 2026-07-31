/**
 * Repair blank / "Unspecified piece" Shirt (and other uniform) stock rows that
 * absorbed RHET fulfills instead of the Unisex·Logo·Size (or gender·type·size) row.
 *
 * Finds blank shells even when request.merchandise_id is NULL (common after
 * webhook fulfill credited the wrong row without relinking).
 *
 * Strategy:
 * 1) Find blank uniform shells (null gender/type/size) with quantity > 0
 * 2) Find Approved requests on same branch + category with gender/type/size
 *    (merchandise_id NULL, pointing at blank, or any Shirt request for that branch)
 * 3) FIFO-allocate blank qty into identified rows per request variant
 * 4) Zero remaining blank qty
 *
 * Dry-run by default. Pass --apply to write.
 *
 *   node scripts/repairBlankUniformStockFromRequests.js
 *   node scripts/repairBlankUniformStockFromRequests.js --apply
 *   node scripts/repairBlankUniformStockFromRequests.js --branch-id=1 --apply
 *   node scripts/repairBlankUniformStockFromRequests.js --production --apply
 */
import '../config/loadEnv.js';
import { query } from '../config/database.js';
import {
  isUniformLikeCategory,
  mapGenderToInventory,
  mapTypeToInventory,
  mapSizeToLocal,
} from '../services/inventory/inventoryFieldMapping.js';

function argValue(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

const apply = process.argv.includes('--apply');
const branchIdArg = argValue('branch-id');

const blankParams = [];
let blankBranchFilter = '';
if (branchIdArg) {
  blankParams.push(parseInt(branchIdArg, 10));
  blankBranchFilter = ` AND branch_id = $${blankParams.length}`;
}

const blanksRes = await query(
  `SELECT merchandise_id, branch_id, merchandise_name, quantity, price
   FROM merchandisestbl
   WHERE COALESCE(NULLIF(TRIM(gender), ''), '') = ''
     AND COALESCE(NULLIF(TRIM(type), ''), '') = ''
     AND (
       size IS NULL
       OR NULLIF(TRIM(size), '') IS NULL
       OR LOWER(TRIM(size)) IN ('n/a', 'na')
     )
     AND COALESCE(quantity, 0) > 0
     ${blankBranchFilter}
   ORDER BY branch_id, merchandise_id`,
  blankParams
);

const blanks = blanksRes.rows.filter((row) =>
  isUniformLikeCategory(row.merchandise_name)
);

console.log(
  `Mode: ${apply ? 'APPLY' : 'DRY-RUN'} | blank uniform shells with qty>0: ${blanks.length}`
);

if (blanks.length === 0) {
  process.exit(0);
}

for (const blank of blanks) {
  const reqRes = await query(
    `SELECT request_id, merchandise_id, gender, type, size, requested_quantity,
            inventory_category_name, merchandise_name
     FROM merchandiserequestlogtbl
     WHERE status = 'Approved'
       AND requested_branch_id = $1
       AND (
         LOWER(TRIM(COALESCE(inventory_category_name, ''))) = LOWER(TRIM($2))
         OR LOWER(TRIM(COALESCE(merchandise_name, ''))) = LOWER(TRIM($2))
       )
       AND COALESCE(NULLIF(TRIM(gender), ''), '') <> ''
       AND COALESCE(NULLIF(TRIM(type), ''), '') <> ''
       AND COALESCE(NULLIF(TRIM(size), ''), '') <> ''
       AND (
         merchandise_id IS NULL
         OR merchandise_id = $3
       )
     ORDER BY request_id ASC`,
    [blank.branch_id, blank.merchandise_name, blank.merchandise_id]
  );

  const requests = reqRes.rows.map((r) => {
    const category =
      String(r.inventory_category_name || r.merchandise_name || blank.merchandise_name).trim();
    return {
      request_id: r.request_id,
      gender: mapGenderToInventory(r.gender) || r.gender,
      type: mapTypeToInventory(r.type, category) || r.type,
      size: mapSizeToLocal(r.size) || r.size,
      qty: Number(r.requested_quantity) || 0,
    };
  });

  console.log(
    `\nBlank merch_id=${blank.merchandise_id} branch=${blank.branch_id} ` +
      `${blank.merchandise_name} qty=${blank.quantity} | matching requests=${requests.length}`
  );

  if (requests.length === 0) {
    console.log('  (no Approved identity requests for this blank — skipped)');
    continue;
  }

  let remaining = Number(blank.quantity) || 0;
  const allocations = [];

  for (const req of requests) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, req.qty > 0 ? req.qty : remaining);
    if (take <= 0) continue;

    const targetRes = await query(
      `SELECT merchandise_id, quantity
       FROM merchandisestbl
       WHERE branch_id = $1
         AND LOWER(TRIM(merchandise_name)) = LOWER(TRIM($2))
         AND merchandise_id <> $3
         AND LOWER(TRIM(COALESCE(gender, ''))) = LOWER(TRIM($4))
         AND LOWER(TRIM(COALESCE(type, ''))) = LOWER(TRIM($5))
         AND LOWER(TRIM(COALESCE(size, ''))) = LOWER(TRIM($6))
       ORDER BY merchandise_id DESC
       LIMIT 1`,
      [
        blank.branch_id,
        blank.merchandise_name,
        blank.merchandise_id,
        req.gender,
        req.type,
        req.size,
      ]
    );
    const target = targetRes.rows[0] || null;
    allocations.push({
      request_id: req.request_id,
      gender: req.gender,
      type: req.type,
      size: req.size,
      take,
      target_id: target?.merchandise_id || null,
      target_qty: target ? Number(target.quantity) || 0 : 0,
      action: target ? 'add_to_existing' : 'create_identified',
    });
    remaining -= take;
  }

  // Any leftover blank qty with no more requests → attach to last allocation variant
  if (remaining > 0 && allocations.length > 0) {
    allocations[allocations.length - 1].take += remaining;
    remaining = 0;
  }

  for (const a of allocations) {
    console.log(
      `  request=${a.request_id} +${a.take} → ${a.gender} · ${a.type} · ${a.size} ` +
        `[${a.action}${a.target_id ? ` id=${a.target_id} was ${a.target_qty}` : ''}]`
    );
  }
  if (remaining > 0) {
    console.log(`  leftover on blank after allocation: ${remaining} (will remain)`);
  }

  if (!apply) continue;

  for (const a of allocations) {
    let targetId = a.target_id;
    if (!targetId) {
      const inserted = await query(
        `INSERT INTO merchandisestbl
           (merchandise_name, size, quantity, price, branch_id, gender, type, remarks)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)
         RETURNING merchandise_id`,
        [
          blank.merchandise_name,
          a.size,
          a.take,
          blank.price,
          blank.branch_id,
          a.gender,
          a.type,
        ]
      );
      targetId = inserted.rows[0].merchandise_id;
    } else {
      await query(
        `UPDATE merchandisestbl
         SET quantity = COALESCE(quantity, 0) + $1,
             price = COALESCE(price, $2),
             gender = COALESCE(NULLIF(TRIM(COALESCE(gender, '')), ''), $3),
             type = COALESCE(NULLIF(TRIM(COALESCE(type, '')), ''), $4),
             size = COALESCE(NULLIF(TRIM(COALESCE(size, '')), ''), $5)
         WHERE merchandise_id = $6`,
        [a.take, blank.price, a.gender, a.type, a.size, targetId]
      );
    }

    await query(
      `UPDATE merchandiserequestlogtbl
       SET merchandise_id = $1
       WHERE request_id = $2`,
      [targetId, a.request_id]
    );
  }

  const allocated = allocations.reduce((sum, a) => sum + a.take, 0);
  const newBlankQty = Math.max(0, (Number(blank.quantity) || 0) - allocated);
  await query(`UPDATE merchandisestbl SET quantity = $1 WHERE merchandise_id = $2`, [
    newBlankQty,
    blank.merchandise_id,
  ]);
  console.log(`  blank ${blank.merchandise_id} qty set to ${newBlankQty}`);
}

// Ensure every Approved identity has an identified stock row (recreate missing S/XL/etc.)
const ensureParams = [];
let ensureBranch = '';
if (branchIdArg) {
  ensureParams.push(parseInt(branchIdArg, 10));
  ensureBranch = ` AND requested_branch_id = $${ensureParams.length}`;
}
const ensureReqs = await query(
  `SELECT requested_branch_id, merchandise_name, inventory_category_name,
          gender, type, size, SUM(requested_quantity)::int AS total_qty
   FROM merchandiserequestlogtbl
   WHERE status = 'Approved'
     AND COALESCE(NULLIF(TRIM(gender), ''), '') <> ''
     AND COALESCE(NULLIF(TRIM(type), ''), '') <> ''
     AND COALESCE(NULLIF(TRIM(size), ''), '') <> ''
     ${ensureBranch}
   GROUP BY requested_branch_id, merchandise_name, inventory_category_name, gender, type, size
   ORDER BY requested_branch_id, merchandise_name, gender, type, size`,
  ensureParams
);

const ensurePlans = [];
for (const row of ensureReqs.rows) {
  const category = String(row.inventory_category_name || row.merchandise_name || '').trim();
  const typeName = String(row.merchandise_name || category).trim();
  if (!isUniformLikeCategory(category) && !isUniformLikeCategory(typeName)) continue;
  const gender = mapGenderToInventory(row.gender) || row.gender;
  const type = mapTypeToInventory(row.type, category) || row.type;
  const size = mapSizeToLocal(row.size) || row.size;
  const existing = await query(
    `SELECT merchandise_id, quantity
     FROM merchandisestbl
     WHERE branch_id = $1
       AND LOWER(TRIM(merchandise_name)) = LOWER(TRIM($2))
       AND LOWER(TRIM(COALESCE(gender, ''))) = LOWER(TRIM($3))
       AND LOWER(TRIM(COALESCE(type, ''))) = LOWER(TRIM($4))
       AND LOWER(TRIM(COALESCE(size, ''))) = LOWER(TRIM($5))
     LIMIT 1`,
    [row.requested_branch_id, typeName, gender, type, size]
  );
  if (existing.rows.length > 0) continue;
  ensurePlans.push({
    branch_id: row.requested_branch_id,
    merchandise_name: typeName,
    gender,
    type,
    size,
    quantity: Number(row.total_qty) || 0,
  });
}

console.log(`\nMissing identified rows to create: ${ensurePlans.length}`);
for (const p of ensurePlans) {
  console.log(
    `  create ${p.merchandise_name} branch=${p.branch_id} ${p.gender} · ${p.type} · ${p.size} qty=${p.quantity}`
  );
  if (!apply) continue;
  await query(
    `INSERT INTO merchandisestbl
       (merchandise_name, size, quantity, price, branch_id, gender, type, remarks)
     VALUES ($1, $2, $3, 0, $4, $5, $6, NULL)`,
    [p.merchandise_name, p.size, p.quantity, p.branch_id, p.gender, p.type]
  );
}

// Purge empty blank shells (qty 0, no gender/type) — leftover Unspecified chips
const purgeParams = [];
let purgeBranch = '';
if (branchIdArg) {
  purgeParams.push(parseInt(branchIdArg, 10));
  purgeBranch = ` AND branch_id = $${purgeParams.length}`;
}
const purgeRes = await query(
  `SELECT merchandise_id, branch_id, merchandise_name, quantity
   FROM merchandisestbl
   WHERE COALESCE(NULLIF(TRIM(gender), ''), '') = ''
     AND COALESCE(NULLIF(TRIM(type), ''), '') = ''
     AND (
       size IS NULL
       OR NULLIF(TRIM(size), '') IS NULL
       OR LOWER(TRIM(size)) IN ('n/a', 'na')
     )
     AND COALESCE(quantity, 0) <= 0
     ${purgeBranch}
   ORDER BY merchandise_id`,
  purgeParams
);
const purgeRows = purgeRes.rows.filter((r) => isUniformLikeCategory(r.merchandise_name));
console.log(`\nEmpty blank shells to delete: ${purgeRows.length}`);
for (const row of purgeRows) {
  console.log(
    `  delete merch_id=${row.merchandise_id} branch=${row.branch_id} ${row.merchandise_name}`
  );
  if (!apply) continue;
  await query(`UPDATE merchandiserequestlogtbl SET merchandise_id = NULL WHERE merchandise_id = $1`, [
    row.merchandise_id,
  ]);
  await query(`DELETE FROM merchandisestbl WHERE merchandise_id = $1`, [row.merchandise_id]);
}

console.log(apply ? '\nApply complete.' : '\nDry-run only. Re-run with --apply to write.');
