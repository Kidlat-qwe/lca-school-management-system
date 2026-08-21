/**
 * Create CMS-only "Toga Set" merchandise for Malolos (development DB).
 *
 * Not linked to RHET / inventory sync: item_name and sku stay NULL.
 * Inserts into merchandisestbl for the Malolos branch only.
 *
 * Defaults:
 *   name:     Toga Set
 *   quantity: 50
 *   price:    0
 *   gender:   Unisex
 *   size/type/item_name/sku: null
 *
 * Usage (from repo root or backend/):
 *   node backend/scripts/createMalolosTogaMerchandise.js --development
 *   node backend/scripts/createMalolosTogaMerchandise.js --development --apply
 *   node backend/scripts/createMalolosTogaMerchandise.js --development --apply --quantity=20 --price=1500
 *
 * Safety:
 *   - Requires --development
 *   - Rejects --production
 *   - Verifies configured + live DB is a known development name
 *   - Idempotent: skips insert if an active Toga Set row already exists for Malolos
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const MERCHANDISE_NAME = 'Toga Set';
const BRANCH_NAME_FRAGMENT = 'Malolos';
const DEFAULT_QUANTITY = 50;
const DEFAULT_PRICE = 0;
const DEFAULT_GENDER = 'Unisex';
const REMARKS =
  'Dev seed 2026-08-21 — CMS-only Toga Set (not linked to inventory / RHET)';

const ALLOWED_DEV_DB_NAMES = new Set(['psms_db', 'test_psms_db']);
const BLOCKED_DB_NAME_SUBSTRINGS = ['production', 'prod_psms', 'psms_prod'];

function argValue(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function fail(message) {
  console.error(`\n❌ ABORTED: ${message}\n`);
  process.exit(1);
}

const wantsDevelopment = process.argv.includes('--development');
const wantsProduction = process.argv.includes('--production');
const isApply = process.argv.includes('--apply');
const dryRun = !isApply;

if (wantsProduction) {
  fail('This script refuses --production. Use --development only.');
}
if (!wantsDevelopment) {
  fail(
    'Pass --development explicitly.\n' +
      '   Dry-run: node backend/scripts/createMalolosTogaMerchandise.js --development\n' +
      '   Apply:   node backend/scripts/createMalolosTogaMerchandise.js --development --apply'
  );
}

const quantityArg = argValue('quantity');
const priceArg = argValue('price');
const quantity = quantityArg != null ? Number(quantityArg) : DEFAULT_QUANTITY;
const price = priceArg != null ? Number(priceArg) : DEFAULT_PRICE;

if (!Number.isFinite(quantity) || quantity < 0 || !Number.isInteger(quantity)) {
  fail('--quantity= must be a non-negative integer');
}
if (!Number.isFinite(price) || price < 0) {
  fail('--price= must be a non-negative number');
}

const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
const configuredDbName = String(process.env.DB_NAME || '').trim();

if (nodeEnv === 'production') {
  fail(`NODE_ENV is production after loadEnv. Refusing.`);
}
if (!configuredDbName) {
  fail('DB_NAME is empty after loadEnv.');
}
if (BLOCKED_DB_NAME_SUBSTRINGS.some((s) => configuredDbName.toLowerCase().includes(s))) {
  fail(`Configured DB_NAME="${configuredDbName}" looks like production.`);
}
if (!ALLOWED_DEV_DB_NAMES.has(configuredDbName)) {
  fail(
    `Configured DB_NAME="${configuredDbName}" is not allow-listed.\n` +
      `   Allowed: ${[...ALLOWED_DEV_DB_NAMES].join(', ')}`
  );
}

async function assertLiveDatabaseIsDevelopment(client) {
  const result = await client.query(
    `SELECT current_database() AS db_name`
  );
  const liveName = String(result.rows[0]?.db_name || '').trim();
  console.log('------------------------------------------------------------');
  console.log(`NODE_ENV:           ${process.env.NODE_ENV}`);
  console.log(`Configured DB_NAME: ${configuredDbName}`);
  console.log(`Live database:      ${liveName}`);
  console.log('------------------------------------------------------------');

  if (!ALLOWED_DEV_DB_NAMES.has(liveName)) {
    fail(
      `Live database "${liveName}" is not allow-listed for this script.\n` +
        `   Allowed: ${[...ALLOWED_DEV_DB_NAMES].join(', ')}`
    );
  }
  if (BLOCKED_DB_NAME_SUBSTRINGS.some((s) => liveName.toLowerCase().includes(s))) {
    fail(`Live database "${liveName}" looks like production.`);
  }
}

async function findMalolosBranch(client) {
  const result = await client.query(
    `SELECT branch_id, branch_name, branch_nickname
     FROM branchestbl
     WHERE LOWER(branch_name) LIKE LOWER('%' || $1 || '%')
        OR LOWER(COALESCE(branch_nickname, '')) LIKE LOWER('%' || $1 || '%')
     ORDER BY branch_id`,
    [BRANCH_NAME_FRAGMENT]
  );
  if (result.rows.length === 0) {
    throw new Error(`No branch matching "${BRANCH_NAME_FRAGMENT}" found`);
  }
  if (result.rows.length > 1) {
    console.warn('Multiple Malolos matches — using first:');
    console.table(result.rows);
  }
  return result.rows[0];
}

async function findExistingToga(client, branchId) {
  const result = await client.query(
    `SELECT merchandise_id, merchandise_name, size, quantity, price,
            gender, type, item_name, sku, remarks, branch_id
     FROM merchandisestbl
     WHERE branch_id = $1
       AND LOWER(TRIM(merchandise_name)) = LOWER(TRIM($2))
     ORDER BY merchandise_id`,
    [branchId, MERCHANDISE_NAME]
  );
  return result.rows;
}

async function main() {
  console.log(
    `\nCreate Malolos "${MERCHANDISE_NAME}" (CMS-only)` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );

  const client = await getClient();
  try {
    await assertLiveDatabaseIsDevelopment(client);

    const branch = await findMalolosBranch(client);
    console.log('Branch:', branch.branch_id, branch.branch_name);

    const existing = await findExistingToga(client, branch.branch_id);
    if (existing.length > 0) {
      console.log('\nAlready exists — no insert needed:');
      console.table(
        existing.map((r) => ({
          merchandise_id: r.merchandise_id,
          merchandise_name: r.merchandise_name,
          quantity: r.quantity,
          price: r.price,
          gender: r.gender,
          item_name: r.item_name,
          sku: r.sku,
        }))
      );
      console.log('\nIdempotent exit. Delete the row first if you want a fresh insert.');
      return;
    }

    const planned = {
      merchandise_name: MERCHANDISE_NAME,
      size: null,
      quantity,
      price,
      branch_id: branch.branch_id,
      gender: DEFAULT_GENDER,
      type: null,
      image_url: null,
      remarks: REMARKS,
      item_name: null,
      sku: null,
    };

    console.log('\nPlanned INSERT (inventory fields intentionally null):');
    console.table([planned]);

    if (dryRun) {
      console.log('\nDry run complete. Re-run with --apply to commit.');
      return;
    }

    await client.query('BEGIN');
    const inserted = (
      await client.query(
        `INSERT INTO merchandisestbl
           (merchandise_name, size, quantity, price, branch_id, gender, type,
            image_url, remarks, item_name, sku)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING merchandise_id, merchandise_name, size, quantity, price,
                   branch_id, gender, type, item_name, sku, remarks`,
        [
          planned.merchandise_name,
          planned.size,
          planned.quantity,
          planned.price,
          planned.branch_id,
          planned.gender,
          planned.type,
          planned.image_url,
          planned.remarks,
          planned.item_name,
          planned.sku,
        ]
      )
    ).rows[0];

    await client.query('COMMIT');

    console.log('\nCREATED:');
    console.table([inserted]);
    console.log(
      '\nCommitted. Refresh Merchandise → View Stocks for Malolos → Toga Set.'
    );
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('\n❌ Failed:', err?.message || err);
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
