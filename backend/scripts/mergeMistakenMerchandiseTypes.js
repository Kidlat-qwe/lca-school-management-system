/**
 * Merge mistaken CMS merchandise types created from RHET itemName
 * (e.g. lca-backpack) into the real category type (Backpack).
 *
 * Moves quantity onto the target type row, then deletes the mistaken row
 * when safe (repoints request/release FKs first).
 *
 * Usage (from backend/):
 *   node scripts/mergeMistakenMerchandiseTypes.js --dry-run
 *   node scripts/mergeMistakenMerchandiseTypes.js --apply
 *   node scripts/mergeMistakenMerchandiseTypes.js --dry-run --branch-id=1
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

/** Known mistaken RHET itemName types → preferred CMS category type */
const FIXED_MERGES = [
  { from: 'lca-backpack', to: 'Backpack' },
  { from: 'lca-bag', to: 'Backpack' },
];

const ID_LACE_TARGETS = ['ID Lace', 'Id Lace', 'Accessory', 'Accessories', 'LCA ID Lace'];

async function findTarget(client, branch, preferredNames) {
  for (const name of preferredNames) {
    const res = await client.query(
      `SELECT merchandise_id, merchandise_name, quantity, branch_id
       FROM merchandisestbl
       WHERE branch_id = $1
         AND LOWER(TRIM(merchandise_name)) = LOWER(TRIM($2))
       ORDER BY merchandise_id ASC
       LIMIT 1`,
      [branch, name]
    );
    if (res.rows[0]) return res.rows[0];
  }
  return null;
}

async function run() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const params = [FIXED_MERGES.map((m) => m.from.toLowerCase())];
    let sql = `SELECT merchandise_id, merchandise_name, quantity, branch_id, size, gender, type, price
       FROM merchandisestbl
       WHERE (
         LOWER(TRIM(merchandise_name)) LIKE 'lca-%'
         OR LOWER(TRIM(merchandise_name)) = ANY($1::text[])
       )`;
    if (branchId != null) {
      params.push(branchId);
      sql += ` AND branch_id = $2`;
    }
    sql += ` ORDER BY branch_id, merchandise_name`;

    const mistaken = await client.query(sql, params);

    console.log(dryRun ? '=== DRY RUN ===' : '=== APPLY ===');
    console.log(`Mistaken-looking rows: ${mistaken.rows.length}`);

    let merged = 0;
    let skipped = 0;

    for (const row of mistaken.rows) {
      const nameKey = String(row.merchandise_name || '').trim().toLowerCase();
      const fixed = FIXED_MERGES.find((m) => m.from.toLowerCase() === nameKey);
      let targetNames = fixed ? [fixed.to] : null;

      if (!targetNames && nameKey.includes('id-lace')) {
        targetNames = ID_LACE_TARGETS;
      }
      if (!targetNames) {
        console.log(
          `  skip merchandise_id=${row.merchandise_id} "${row.merchandise_name}" (no known target type)`
        );
        skipped += 1;
        continue;
      }

      const target = await findTarget(client, row.branch_id, targetNames);
      if (!target) {
        console.log(
          `  skip merchandise_id=${row.merchandise_id} "${row.merchandise_name}" — no target ${targetNames.join('/')} on branch ${row.branch_id}`
        );
        skipped += 1;
        continue;
      }

      if (target.merchandise_id === row.merchandise_id) {
        skipped += 1;
        continue;
      }

      const qty = Number(row.quantity) || 0;
      console.log(
        `  merge branch ${row.branch_id}: "${row.merchandise_name}" (id=${row.merchandise_id}, qty=${qty}) → "${target.merchandise_name}" (id=${target.merchandise_id}, qty=${target.quantity})`
      );

      if (!dryRun) {
        if (qty > 0) {
          await client.query(
            `UPDATE merchandisestbl SET quantity = COALESCE(quantity, 0) + $1 WHERE merchandise_id = $2`,
            [qty, target.merchandise_id]
          );
        }

        await client.query(
          `UPDATE merchandiserequestlogtbl SET merchandise_id = $1 WHERE merchandise_id = $2`,
          [target.merchandise_id, row.merchandise_id]
        );
        await client.query(`DELETE FROM promomerchandisetbl WHERE merchandise_id = $1`, [
          row.merchandise_id,
        ]);
        await client.query(
          `UPDATE merchandise_release_logtbl SET merchandise_id = $1 WHERE merchandise_id = $2`,
          [target.merchandise_id, row.merchandise_id]
        );
        await client.query(`DELETE FROM merchandisestbl WHERE merchandise_id = $1`, [
          row.merchandise_id,
        ]);
      }

      merged += 1;
    }

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log(`Dry run: would merge ${merged}, skip ${skipped}.`);
      console.log('To apply: node scripts/mergeMistakenMerchandiseTypes.js --apply');
    } else {
      await client.query('COMMIT');
      console.log(`Merged ${merged}, skipped ${skipped}.`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('mergeMistakenMerchandiseTypes failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

run();
