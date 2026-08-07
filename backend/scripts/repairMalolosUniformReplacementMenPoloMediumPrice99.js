/**
 * Malolos only — set School Uniform_Replacement Men Top Medium price to 99.
 *
 * Bypasses merchandise edit / inventory request flow. Direct CMS price update
 * on the existing stock row (Vista Mall Malolos, branch_id 1).
 *
 * Target (production as of 2026-08-05):
 *   merchandise_id 183 — Men / Top / Medium — price 400.00 → 99.00
 *
 * Run:
 *   node backend/scripts/repairMalolosUniformReplacementMenPoloMediumPrice99.js --production
 *   node backend/scripts/repairMalolosUniformReplacementMenPoloMediumPrice99.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const BRANCH_ID = 1;
const BRANCH_NAME_FRAGMENT = 'Malolos';
const MERCHANDISE_NAME = 'School Uniform_Replacement';
const MERCHANDISE_ID = 183;
const EXPECTED_GENDER = 'Men';
const EXPECTED_TYPE = 'Top';
const EXPECTED_SIZE = 'Medium';
const EXPECTED_OLD_PRICE = 400;
const NEW_PRICE = 99;

const REPAIR_NOTE =
  'Ops repair 2026-08-05 — Malolos Men Polo Medium price 400 → 99 (bypass merchandise UI)';

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
              price, branch_id, remarks
       FROM merchandisestbl
       WHERE merchandise_id = $1`,
      [MERCHANDISE_ID]
    )
  ).rows[0];

  return { branch, row };
}

function money(value) {
  return Number(value);
}

async function main() {
  console.log(
    `\nMalolos ${MERCHANDISE_NAME} Men Polo Medium price → ${NEW_PRICE}` +
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
        `Branch ${BRANCH_ID} name mismatch: ${branch.branch_name} (expected Malolos)`
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
        `Name mismatch: "${row.merchandise_name}" (expected "${MERCHANDISE_NAME}")`
      );
    }
    if (String(row.gender || '').trim() !== EXPECTED_GENDER) {
      throw new Error(`Gender mismatch: "${row.gender}" (expected ${EXPECTED_GENDER})`);
    }
    if (String(row.type || '').trim() !== EXPECTED_TYPE) {
      throw new Error(`Type mismatch: "${row.type}" (expected ${EXPECTED_TYPE})`);
    }
    if (String(row.size || '').trim() !== EXPECTED_SIZE) {
      throw new Error(`Size mismatch: "${row.size}" (expected ${EXPECTED_SIZE})`);
    }

    const beforePrice = money(row.price);
    if (beforePrice !== EXPECTED_OLD_PRICE) {
      throw new Error(
        `Current price is ${beforePrice}, expected ${EXPECTED_OLD_PRICE}. Aborting.`
      );
    }

    console.log('Branch:', branch.branch_id, branch.branch_name);
    console.log('\nBEFORE:');
    console.table([
      {
        merchandise_id: row.merchandise_id,
        gender: row.gender,
        type: row.type,
        size: row.size,
        quantity: Number(row.quantity ?? 0),
        price: beforePrice,
      },
    ]);

    console.log('\nPlanned:');
    console.log(
      `  UPDATE merchandisestbl SET price = ${NEW_PRICE}` +
        ` WHERE merchandise_id = ${MERCHANDISE_ID} AND branch_id = ${BRANCH_ID}`
    );
    console.log('  (No merchandise UI / RHET inventory sync — CMS price only)');
    console.log(`  Append remarks note: ${REPAIR_NOTE}`);

    if (!isApply) {
      console.log('\nDry run complete. Re-run with --apply to commit.');
      return;
    }

    await client.query('BEGIN');

    const updated = (
      await client.query(
        `UPDATE merchandisestbl
         SET price = $1,
             remarks = CASE
               WHEN remarks IS NULL OR TRIM(remarks) = '' THEN $2
               WHEN remarks ILIKE '%' || $2 || '%' THEN remarks
               ELSE remarks || ' | ' || $2
             END
         WHERE merchandise_id = $3
           AND branch_id = $4
           AND LOWER(TRIM(merchandise_name)) = LOWER(TRIM($5))
           AND LOWER(TRIM(gender)) = LOWER(TRIM($6))
           AND LOWER(TRIM(type)) = LOWER(TRIM($7))
           AND LOWER(TRIM(size)) = LOWER(TRIM($8))
           AND price::numeric = $9::numeric
         RETURNING merchandise_id, gender, type, size, quantity, price, branch_id`,
        [
          NEW_PRICE,
          REPAIR_NOTE,
          MERCHANDISE_ID,
          BRANCH_ID,
          MERCHANDISE_NAME,
          EXPECTED_GENDER,
          EXPECTED_TYPE,
          EXPECTED_SIZE,
          EXPECTED_OLD_PRICE,
        ]
      )
    ).rows[0];

    if (!updated) {
      throw new Error('UPDATE matched 0 rows — abort');
    }
    if (money(updated.price) !== NEW_PRICE) {
      throw new Error(`Price after update is ${updated.price}, expected ${NEW_PRICE}`);
    }

    await client.query('COMMIT');

    console.log('\nAFTER:');
    console.table([
      {
        merchandise_id: updated.merchandise_id,
        gender: updated.gender,
        type: updated.type,
        size: updated.size,
        quantity: Number(updated.quantity ?? 0),
        price: money(updated.price),
      },
    ]);
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
