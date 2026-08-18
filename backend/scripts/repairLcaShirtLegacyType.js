/**
 * Set legacy LCA Shirt stock rows to type = 'Shirt' (not RHET logo labels).
 *
 * For pilot branches still on the legacy merchandise page where Shirt category
 * stock uses piece type "Shirt" instead of ACC / Beeli / LCA / Logo 1 / Logo 2.
 *
 * Usage (from backend/):
 *   node scripts/repairLcaShirtLegacyType.js --dry-run --branch-id=1
 *   node scripts/repairLcaShirtLegacyType.js --apply --branch-id=1
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const SHIRT_CATEGORY_NAMES = [
  'Shirt',
  'Active Champs (T-Shirt)',
  'LCA T-Shirt',
  'LCA Tshirt',
  'LCA Shirt',
];

/** RHET LCA_SHIRT logo labels — replaced with legacy "Shirt" when --apply. */
const RHET_LOGO_TYPES = ['ACC', 'Beeli', 'LCA', 'Logo 1', 'Logo 2', 'Top'];

function argValue(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

const dryRun = process.argv.includes('--dry-run') || !process.argv.includes('--apply');
const apply = process.argv.includes('--apply');
const branchIdArg = argValue('branch-id');
const branchNameArg = argValue('branch-name');

if (apply && process.argv.includes('--dry-run')) {
  console.error('Use either --dry-run or --apply, not both.');
  process.exit(1);
}

async function resolveBranch(client) {
  if (branchIdArg) {
    const id = Number(branchIdArg);
    if (!Number.isInteger(id) || id < 1) throw new Error('Invalid --branch-id=');
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
  throw new Error('Specify --branch-id=N or --branch-name=Fragment (e.g. Malolos)');
}

async function run() {
  const client = await getClient();
  try {
    const branch = await resolveBranch(client);
    const preview = await client.query(
      `SELECT merchandise_id, merchandise_name, gender, type, size, quantity, price
       FROM merchandisestbl
       WHERE branch_id = $1
         AND merchandise_name = ANY($2::text[])
         AND type IS DISTINCT FROM 'Shirt'
         AND (type IS NULL OR type = ANY($3::text[]))
       ORDER BY size, merchandise_id`,
      [branch.branch_id, SHIRT_CATEGORY_NAMES, RHET_LOGO_TYPES]
    );

    console.log(dryRun ? '=== DRY RUN (LCA Shirt legacy type) ===' : '=== APPLY (LCA Shirt legacy type) ===');
    console.log(`Branch: ${branch.branch_id} — ${branch.branch_name}`);
    console.log('Will set type → "Shirt"\n');

    if (!preview.rows.length) {
      console.log('No Shirt rows need type correction.');
      process.exit(0);
    }

    for (const row of preview.rows) {
      console.log(
        `  id=${row.merchandise_id} ${row.gender || '-'} · ${row.type || '(null)'} · ${row.size || '-'} qty=${row.quantity} → type Shirt`
      );
    }

    await client.query('BEGIN');

    if (!dryRun) {
      const updated = await client.query(
        `UPDATE merchandisestbl
         SET type = 'Shirt'
         WHERE branch_id = $1
           AND merchandise_name = ANY($2::text[])
           AND type IS DISTINCT FROM 'Shirt'
           AND (type IS NULL OR type = ANY($3::text[]))
         RETURNING merchandise_id, merchandise_name, gender, type, size, quantity`,
        [branch.branch_id, SHIRT_CATEGORY_NAMES, RHET_LOGO_TYPES]
      );
      console.log(`\nUpdated ${updated.rowCount} row(s).`);
    }

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('\nDry run complete — no changes written.');
      console.log(
        `To apply: node scripts/repairLcaShirtLegacyType.js --apply --branch-id=${branch.branch_id}`
      );
    } else {
      await client.query('COMMIT');
      console.log('\nCommitted. Refresh Merchandise → Shirt stocks.');
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
