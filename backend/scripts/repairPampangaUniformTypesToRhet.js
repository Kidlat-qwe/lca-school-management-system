/**
 * Branch School Uniform + PE Uniform piece labels → RHET (default: Guiguinto).
 *
 * PE Uniform / LCA PE Uniform:
 *   type Top    → Shirt
 *   type Bottom → Pants
 *
 * School Uniform / LCA Uniform / School Uniform_Replacement:
 *   gender Men/Boys/…  → Male
 *   gender Women/Girls/… → Female
 *   Male Top    → Polo
 *   Male Bottom → Short
 *   Female Top  → Blouse
 *   Female Bottom → Skirt
 *
 * Gender is updated first so type steps can match both legacy and canonical gender.
 * Does not rename categories or sizes (use migrateMerchandiseLabelsToRhet.js for that).
 *
 * Usage (from repo root or backend/):
 *   node backend/scripts/repairPampangaUniformTypesToRhet.js
 *   node backend/scripts/repairPampangaUniformTypesToRhet.js --dry-run
 *   node backend/scripts/repairPampangaUniformTypesToRhet.js --apply
 *   node backend/scripts/repairPampangaUniformTypesToRhet.js --dry-run --branch-name=Cavite
 *   node backend/scripts/repairPampangaUniformTypesToRhet.js --apply --branch-id=N
 *
 * Default branch fragment: Malolos. Default mode: dry-run (no writes).
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const DEFAULT_BRANCH_NAME_FRAGMENT = 'Malolos';

const PE_CATEGORY_NAMES = ['PE Uniform', 'LCA PE Uniform'];
const SCHOOL_CATEGORY_NAMES = [
  'School Uniform',
  'LCA Uniform',
  'School Uniform_Replacement',
];

const MALE_GENDERS = ['Male', 'Men', 'Man', 'Boys', 'Boy'];
const FEMALE_GENDERS = ['Female', 'Women', 'Woman', 'Girls', 'Girl'];

function argValue(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

const apply = process.argv.includes('--apply');
const dryRun = !apply;
const branchIdArg = argValue('branch-id');
const branchNameFragment =
  String(argValue('branch-name') || DEFAULT_BRANCH_NAME_FRAGMENT).trim() ||
  DEFAULT_BRANCH_NAME_FRAGMENT;

if (apply && process.argv.includes('--dry-run')) {
  console.error('Use either --dry-run (default) or --apply, not both.');
  process.exit(1);
}

function fail(message) {
  console.error(`\n❌ ABORTED: ${message}\n`);
  process.exit(1);
}

async function resolveBranch(client) {
  if (branchIdArg) {
    const id = Number(branchIdArg);
    if (!Number.isInteger(id) || id < 1) fail('Invalid --branch-id= (positive integer required)');
    const row = (
      await client.query(
        `SELECT branch_id, branch_name, branch_nickname
         FROM branchestbl WHERE branch_id = $1`,
        [id]
      )
    ).rows[0];
    if (!row) fail(`branch_id=${id} not found`);
    const blob = `${row.branch_name || ''} ${row.branch_nickname || ''}`.toLowerCase();
    if (!blob.includes(branchNameFragment.toLowerCase())) {
      fail(
        `branch_id=${id} is "${row.branch_name}" — does not match --branch-name=${branchNameFragment}. ` +
          `Omit --branch-id to auto-resolve, or pass the correct id.`
      );
    }
    return row;
  }

  const result = await client.query(
    `SELECT branch_id, branch_name, branch_nickname
     FROM branchestbl
     WHERE LOWER(branch_name) LIKE LOWER('%' || $1 || '%')
        OR LOWER(COALESCE(branch_nickname, '')) LIKE LOWER('%' || $1 || '%')
     ORDER BY branch_id`,
    [branchNameFragment]
  );
  if (result.rows.length === 0) {
    fail(`No branch matching "${branchNameFragment}" found`);
  }
  if (result.rows.length > 1) {
    console.warn(`Multiple "${branchNameFragment}" matches — using first:`);
    console.table(result.rows);
  }
  return result.rows[0];
}

function buildSteps(branchId) {
  const steps = [];

  steps.push({
    label: 'School Uniform gender Men/Boys → Male',
    previewSql: `
      SELECT merchandise_id, merchandise_name, gender, type, size, quantity
      FROM merchandisestbl
      WHERE branch_id = $1
        AND merchandise_name = ANY($2::text[])
        AND gender = ANY($3::text[])
      ORDER BY merchandise_name, gender, type, size, merchandise_id`,
    previewParams: [branchId, SCHOOL_CATEGORY_NAMES, ['Men', 'Boys', 'Man', 'Boy']],
    updateSql: `
      UPDATE merchandisestbl
      SET gender = 'Male'
      WHERE branch_id = $1
        AND merchandise_name = ANY($2::text[])
        AND gender = ANY($3::text[])`,
    updateParams: [branchId, SCHOOL_CATEGORY_NAMES, ['Men', 'Boys', 'Man', 'Boy']],
  });

  steps.push({
    label: 'School Uniform gender Women/Girls → Female',
    previewSql: `
      SELECT merchandise_id, merchandise_name, gender, type, size, quantity
      FROM merchandisestbl
      WHERE branch_id = $1
        AND merchandise_name = ANY($2::text[])
        AND gender = ANY($3::text[])
      ORDER BY merchandise_name, gender, type, size, merchandise_id`,
    previewParams: [branchId, SCHOOL_CATEGORY_NAMES, ['Women', 'Girls', 'Woman', 'Girl']],
    updateSql: `
      UPDATE merchandisestbl
      SET gender = 'Female'
      WHERE branch_id = $1
        AND merchandise_name = ANY($2::text[])
        AND gender = ANY($3::text[])`,
    updateParams: [branchId, SCHOOL_CATEGORY_NAMES, ['Women', 'Girls', 'Woman', 'Girl']],
  });

  steps.push({
    label: 'PE Uniform type Top → Shirt',
    previewSql: `
      SELECT merchandise_id, merchandise_name, gender, type, size, quantity
      FROM merchandisestbl
      WHERE branch_id = $1
        AND merchandise_name = ANY($2::text[])
        AND type = 'Top'
      ORDER BY merchandise_name, gender, size, merchandise_id`,
    previewParams: [branchId, PE_CATEGORY_NAMES],
    updateSql: `
      UPDATE merchandisestbl
      SET type = 'Shirt'
      WHERE branch_id = $1
        AND merchandise_name = ANY($2::text[])
        AND type = 'Top'`,
    updateParams: [branchId, PE_CATEGORY_NAMES],
  });

  steps.push({
    label: 'PE Uniform type Bottom → Pants',
    previewSql: `
      SELECT merchandise_id, merchandise_name, gender, type, size, quantity
      FROM merchandisestbl
      WHERE branch_id = $1
        AND merchandise_name = ANY($2::text[])
        AND type = 'Bottom'
      ORDER BY merchandise_name, gender, size, merchandise_id`,
    previewParams: [branchId, PE_CATEGORY_NAMES],
    updateSql: `
      UPDATE merchandisestbl
      SET type = 'Pants'
      WHERE branch_id = $1
        AND merchandise_name = ANY($2::text[])
        AND type = 'Bottom'`,
    updateParams: [branchId, PE_CATEGORY_NAMES],
  });

  const schoolTypeSteps = [
    {
      label: 'School Uniform Male Top → Polo',
      genders: MALE_GENDERS,
      fromType: 'Top',
      toType: 'Polo',
    },
    {
      label: 'School Uniform Male Bottom → Short',
      genders: MALE_GENDERS,
      fromType: 'Bottom',
      toType: 'Short',
    },
    {
      label: 'School Uniform Female Top → Blouse',
      genders: FEMALE_GENDERS,
      fromType: 'Top',
      toType: 'Blouse',
    },
    {
      label: 'School Uniform Female Bottom → Skirt',
      genders: FEMALE_GENDERS,
      fromType: 'Bottom',
      toType: 'Skirt',
    },
  ];

  for (const s of schoolTypeSteps) {
    steps.push({
      label: s.label,
      previewSql: `
        SELECT merchandise_id, merchandise_name, gender, type, size, quantity
        FROM merchandisestbl
        WHERE branch_id = $1
          AND merchandise_name = ANY($2::text[])
          AND gender = ANY($3::text[])
          AND type = $4
        ORDER BY merchandise_name, gender, size, merchandise_id`,
      previewParams: [branchId, SCHOOL_CATEGORY_NAMES, s.genders, s.fromType],
      updateSql: `
        UPDATE merchandisestbl
        SET type = $5
        WHERE branch_id = $1
          AND merchandise_name = ANY($2::text[])
          AND gender = ANY($3::text[])
          AND type = $4`,
      updateParams: [branchId, SCHOOL_CATEGORY_NAMES, s.genders, s.fromType, s.toType],
    });
  }

  return steps;
}

async function main() {
  console.log(
    `\n${branchNameFragment} School Uniform + PE Uniform → RHET labels` +
      `${apply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);

  const client = await getClient();
  try {
    const branch = await resolveBranch(client);
    console.log(
      `Branch: ${branch.branch_id} — ${branch.branch_name}` +
        (branch.branch_nickname ? ` (${branch.branch_nickname})` : '')
    );

    const steps = buildSteps(branch.branch_id);
    let totalPreview = 0;

    await client.query('BEGIN');

    for (const step of steps) {
      const preview = await client.query(step.previewSql, step.previewParams);
      const n = preview.rows.length;
      totalPreview += n;
      console.log(`\n--- ${step.label}: ${n} row(s) ---`);
      if (n > 0) {
        console.table(
          preview.rows.map((r) => ({
            merchandise_id: r.merchandise_id,
            merchandise_name: r.merchandise_name,
            gender: r.gender,
            type: r.type,
            size: r.size,
            quantity: r.quantity,
          }))
        );
      }

      if (apply && n > 0) {
        const updated = await client.query(step.updateSql, step.updateParams);
        console.log(`  → updated ${updated.rowCount} row(s)`);
      }
    }

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('\n------------------------------------------------------------');
      console.log(`Dry run complete — ${totalPreview} row(s) would be touched. No changes written.`);
      console.log(
        `To apply: node backend/scripts/repairPampangaUniformTypesToRhet.js --apply --branch-name=${branchNameFragment}`
      );
      if (branchIdArg) {
        console.log(`         (or --apply --branch-id=${branch.branch_id})`);
      }
    } else {
      await client.query('COMMIT');
      console.log('\n------------------------------------------------------------');
      console.log(`Committed. ${totalPreview} row(s) matched preview; updates applied above.`);
      console.log(
        `Refresh Merchandise → View Stocks for ${branchNameFragment} School Uniform / PE Uniform.`
      );
    }
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('\n❌ Failed:', err?.message || err);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main()
  .then(() => process.exit(process.exitCode || 0))
  .catch(() => process.exit(1));
