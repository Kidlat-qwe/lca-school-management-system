/**
 * Malolos only — add 50 stock to each existing School Uniform_Replacement row.
 *
 * Bypasses Request Stock / inventory fulfillment. Direct CMS quantity bump on
 * existing stock rows for Vista Mall Malolos (branch_id 1).
 *
 * Target (production as of 2026-08-05): 8 rows under "School Uniform_Replacement"
 *   159 Women Top Extra Small  0 → 50
 *   175 Men Top Small          1 → 51
 *   176 Men Bottom Small       1 → 51
 *   180 Women Top Small        0 → 50
 *   181 Women Top Extra Large  0 → 50
 *   183 Men Top Medium         0 → 50
 *   189 Women Bottom Medium    0 → 50
 *   190 Women Top Medium       0 → 50
 *
 * Run:
 *   node backend/scripts/repairMalolosUniformReplacementAddStock50.js --production
 *   node backend/scripts/repairMalolosUniformReplacementAddStock50.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const BRANCH_ID = 1;
const BRANCH_NAME_FRAGMENT = 'Malolos';
const MERCHANDISE_NAME = 'School Uniform_Replacement';
const ADD_QTY = 50;

/** Expected merchandise_ids (safety check — abort if set differs). */
const EXPECTED_IDS = [159, 175, 176, 180, 181, 183, 189, 190];

const REPAIR_NOTE =
  'Ops repair 2026-08-05 — Malolos School Uniform_Replacement +50 each (bypass request flow)';

const isApply = process.argv.includes('--apply');

async function loadTargets(client) {
  const branch = (
    await client.query(
      `SELECT branch_id, branch_name, branch_nickname
       FROM branchestbl
       WHERE branch_id = $1`,
      [BRANCH_ID]
    )
  ).rows[0];

  const rows = (
    await client.query(
      `SELECT merchandise_id, merchandise_name, quantity, size, gender, type,
              price, branch_id, item_name, sku, remarks
       FROM merchandisestbl
       WHERE branch_id = $1
         AND LOWER(TRIM(merchandise_name)) = LOWER(TRIM($2))
       ORDER BY merchandise_id`,
      [BRANCH_ID, MERCHANDISE_NAME]
    )
  ).rows;

  return { branch, rows };
}

function summarize(rows) {
  return rows.map((r) => ({
    merchandise_id: r.merchandise_id,
    gender: r.gender,
    type: r.type,
    size: r.size,
    quantity: Number(r.quantity ?? 0),
    price: r.price,
    remarks: r.remarks || '',
  }));
}

async function main() {
  console.log(
    `\nMalolos ${MERCHANDISE_NAME} +${ADD_QTY} each` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);

  if (process.env.DB_NAME !== 'psms_production') {
    console.warn('⚠️ Expected psms_production. Pass --production.');
  }

  const client = await getClient();
  try {
    const { branch, rows } = await loadTargets(client);

    if (!branch) {
      throw new Error(`Branch ${BRANCH_ID} not found`);
    }
    if (!String(branch.branch_name || '').includes(BRANCH_NAME_FRAGMENT)) {
      throw new Error(
        `Branch ${BRANCH_ID} name mismatch: ${branch.branch_name} (expected Malolos)`
      );
    }
    if (rows.length === 0) {
      throw new Error(`No "${MERCHANDISE_NAME}" rows on branch ${BRANCH_ID}`);
    }

    const ids = rows.map((r) => Number(r.merchandise_id)).sort((a, b) => a - b);
    const expected = [...EXPECTED_IDS].sort((a, b) => a - b);
    if (ids.length !== expected.length || ids.some((id, i) => id !== expected[i])) {
      throw new Error(
        `Merchandise ID set mismatch.\n` +
          `  Expected: ${expected.join(', ')}\n` +
          `  Found:    ${ids.join(', ')}\n` +
          `Aborting — review rows before applying.`
      );
    }

    console.log('Branch:', branch.branch_id, branch.branch_name);
    console.log(`\nBEFORE (${rows.length} rows):`);
    console.table(summarize(rows));

    const planned = rows.map((r) => {
      const before = Number(r.quantity ?? 0);
      return {
        merchandise_id: r.merchandise_id,
        gender: r.gender,
        type: r.type,
        size: r.size,
        before,
        after: before + ADD_QTY,
      };
    });

    console.log('\nPlanned:');
    console.table(planned);
    console.log('  (No merchandise request / RHET inventory sync — CMS quantity only)');
    console.log(`  Append remarks note: ${REPAIR_NOTE}`);

    if (!isApply) {
      console.log('\nDry run complete. Re-run with --apply to commit.');
      return;
    }

    await client.query('BEGIN');

    for (const row of rows) {
      const before = Number(row.quantity ?? 0);
      const after = before + ADD_QTY;
      const updated = (
        await client.query(
          `UPDATE merchandisestbl
           SET quantity = COALESCE(quantity, 0) + $1,
               remarks = CASE
                 WHEN remarks IS NULL OR TRIM(remarks) = '' THEN $2
                 WHEN remarks ILIKE '%' || $2 || '%' THEN remarks
                 ELSE remarks || ' | ' || $2
               END
           WHERE merchandise_id = $3
             AND branch_id = $4
             AND LOWER(TRIM(merchandise_name)) = LOWER(TRIM($5))
           RETURNING merchandise_id, quantity`,
          [ADD_QTY, REPAIR_NOTE, row.merchandise_id, BRANCH_ID, MERCHANDISE_NAME]
        )
      ).rows[0];

      if (!updated) {
        throw new Error(`UPDATE matched 0 rows for merchandise_id ${row.merchandise_id}`);
      }
      if (Number(updated.quantity) !== after) {
        throw new Error(
          `merchandise_id ${row.merchandise_id}: qty ${updated.quantity}, expected ${after}`
        );
      }
      console.log(
        `✅ id ${row.merchandise_id} (${row.gender} ${row.type} ${row.size}): ${before} → ${after}`
      );
    }

    const afterRows = (await loadTargets(client)).rows;
    console.log('\nAFTER:');
    console.table(summarize(afterRows));

    await client.query('COMMIT');
    console.log(
      `\nCommitted. Refresh Merchandise → Stocks: ${MERCHANDISE_NAME} (Malolos).`
    );
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('\n❌ Repair failed:', err?.message || err);
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
