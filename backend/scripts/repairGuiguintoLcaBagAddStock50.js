/**
 * Guiguinto only — add 50 stock to existing LCA Bag merchandise type.
 *
 * Bypasses Request Stock / inventory fulfillment. Direct CMS quantity bump on
 * the existing type row (merchandise_id 76, branch_id 5).
 *
 * Target (production as of 2026-08-04):
 *   branch_id 5 — Little Champions Academy Inc. - North Centrum, Guiguinto Bulacan
 *   merchandise_id 76 — "LCA Bag" (qty 0 → 50)
 *
 * Run:
 *   node backend/scripts/repairGuiguintoLcaBagAddStock50.js --production
 *   node backend/scripts/repairGuiguintoLcaBagAddStock50.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const BRANCH_ID = 5;
const BRANCH_NAME_FRAGMENT = 'Guiguinto';
const MERCHANDISE_ID = 76;
const MERCHANDISE_NAME = 'LCA Bag';
const ADD_QTY = 50;

const REPAIR_NOTE =
  'Ops repair 2026-08-04 — Guiguinto LCA Bag +50 stock (bypass request flow)';

const isApply = process.argv.includes('--apply');

async function loadTarget(client) {
  const branch = (
    await client.query(
      `SELECT branch_id, branch_name, branch_nickname
       FROM branchestbl
       WHERE branch_id = $1`,
      [BRANCH_ID]
    )
  ).rows[0];

  const row = (
    await client.query(
      `SELECT merchandise_id, merchandise_name, quantity, size, gender, type,
              price, branch_id, item_name, sku, remarks
       FROM merchandisestbl
       WHERE merchandise_id = $1`,
      [MERCHANDISE_ID]
    )
  ).rows[0];

  return { branch, row };
}

async function main() {
  console.log(
    `\nGuiguinto LCA Bag +${ADD_QTY} stock` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);

  if (process.env.DB_NAME !== 'psms_production') {
    console.warn('⚠️ Expected psms_production. Pass --production.');
  }

  const client = await getClient();
  try {
    const { branch, row } = await loadTarget(client);

    if (!branch) {
      throw new Error(`Branch ${BRANCH_ID} not found`);
    }
    if (!String(branch.branch_name || '').includes(BRANCH_NAME_FRAGMENT)) {
      throw new Error(
        `Branch ${BRANCH_ID} name mismatch: ${branch.branch_name} (expected Guiguinto)`
      );
    }
    if (!row) {
      throw new Error(`Merchandise ${MERCHANDISE_ID} not found`);
    }
    if (Number(row.branch_id) !== BRANCH_ID) {
      throw new Error(
        `Merchandise ${MERCHANDISE_ID} is branch ${row.branch_id}, expected ${BRANCH_ID}`
      );
    }
    if (String(row.merchandise_name || '').trim() !== MERCHANDISE_NAME) {
      throw new Error(
        `Merchandise name mismatch: "${row.merchandise_name}" (expected "${MERCHANDISE_NAME}")`
      );
    }

    const beforeQty = Number(row.quantity ?? 0);
    const afterQty = beforeQty + ADD_QTY;

    console.log('Branch:', branch.branch_id, branch.branch_name);
    console.log('\nBEFORE:');
    console.table([
      {
        merchandise_id: row.merchandise_id,
        merchandise_name: row.merchandise_name,
        quantity: beforeQty,
        size: row.size,
        gender: row.gender,
        type: row.type,
        item_name: row.item_name,
        sku: row.sku,
        price: row.price,
      },
    ]);

    console.log('\nPlanned:');
    console.log(
      `  UPDATE merchandisestbl SET quantity = ${beforeQty} + ${ADD_QTY} = ${afterQty}`
    );
    console.log(`  WHERE merchandise_id = ${MERCHANDISE_ID} AND branch_id = ${BRANCH_ID}`);
    console.log('  (No merchandise request / RHET inventory sync — CMS quantity only)');
    console.log(`  Append remarks note: ${REPAIR_NOTE}`);

    if (!isApply) {
      console.log('\nDry run complete. Re-run with --apply to commit.');
      return;
    }

    await client.query('BEGIN');

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
         RETURNING merchandise_id, merchandise_name, quantity, branch_id, remarks`,
        [ADD_QTY, REPAIR_NOTE, MERCHANDISE_ID, BRANCH_ID, MERCHANDISE_NAME]
      )
    ).rows[0];

    if (!updated) {
      throw new Error('UPDATE matched 0 rows — abort');
    }
    if (Number(updated.quantity) !== afterQty) {
      throw new Error(
        `Quantity after update is ${updated.quantity}, expected ${afterQty}`
      );
    }

    await client.query('COMMIT');

    console.log('\nAFTER:');
    console.table([
      {
        merchandise_id: updated.merchandise_id,
        merchandise_name: updated.merchandise_name,
        quantity: updated.quantity,
        branch_id: updated.branch_id,
      },
    ]);
    console.log('\nCommitted. Refresh Merchandise → View Stocks for Guiguinto LCA Bag.');
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
