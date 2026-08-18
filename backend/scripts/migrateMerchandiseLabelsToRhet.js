/**
 * One-time (re-runnable) data migration: rewrite merchandisestbl labels to
 * RHET-canonical values used by Create Merchandise + Request Stock.
 *
 * Category renames (same merchandise_id — packages follow automatically):
 *   LCA Uniform / School Uniform_Replacement → School Uniform
 *   LCA PE Uniform / PE Uniform_Replacement   → PE Uniform
 *   LCA Bag / Bag                             → Backpack
 *   Active Champs (T-Shirt)                   → Shirt
 *   LCA Learning Kits / LCA Learning Kit      → Learning Kit
 *   Moving-up Kit                             → Moving Up Kit
 *   LCA Workbooks (legacy)                    → Workbooks
 *
 * Attribute normalization:
 *   Men/Women → Male/Female
 *   Extra Small… → XS/S/M/L/XL
 *   PE Uniform only: type Top → Shirt, Bottom → Pants (RHET inventory piece types)
 *   School Uniform (by gender): Male Top→Polo, Male Bottom→Short;
 *     Female Top→Blouse, Female Bottom→Skirt (RHET — not Pants; that is PE only)
 *
 * Usage (from backend/):
 *   node scripts/migrateMerchandiseLabelsToRhet.js --dry-run
 *   node scripts/migrateMerchandiseLabelsToRhet.js --dry-run --branch-id=1
 *   node scripts/migrateMerchandiseLabelsToRhet.js --apply --branch-id=1
 *
 * Requires migration 129 CHECK constraints first (Male/Female + Blouse/Skirt).
 * Uses the same DB env as the API (DB_HOST / DB_PASSWORD via config/database.js).
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

if (branchIdArg != null && (!Number.isInteger(branchId) || branchId < 1)) {
  console.error('Invalid --branch-id= (must be a positive integer).');
  process.exit(1);
}

const UPDATES = [
  {
    label: 'category LCA Uniform → School Uniform',
    fromNames: ['LCA Uniform', 'School Uniform_Replacement'],
    toName: 'School Uniform',
  },
  {
    label: 'category LCA PE Uniform → PE Uniform',
    fromNames: ['LCA PE Uniform', 'PE Uniform_Replacement'],
    toName: 'PE Uniform',
  },
  {
    label: 'category LCA Bag → Backpack',
    fromNames: ['LCA Bag', 'Bag'],
    toName: 'Backpack',
  },
  {
    label: 'category Active Champs (T-Shirt) → Shirt',
    fromNames: ['Active Champs (T-Shirt)', 'LCA T-Shirt', 'LCA Tshirt', 'LCA Shirt'],
    toName: 'Shirt',
  },
  {
    label: 'category LCA Learning Kits → Learning Kit',
    fromNames: ['LCA Learning Kits', 'LCA Learning Kit'],
    toName: 'Learning Kit',
  },
  {
    label: 'category Moving-up Kit → Moving Up Kit',
    fromNames: ['Moving-up Kit'],
    toName: 'Moving Up Kit',
  },
  {
    label: 'category LCA Workbooks → Workbooks',
    fromNames: ['LCA Workbooks'],
    toName: 'Workbooks',
  },
  {
    label: 'gender Men/Boys → Male',
    column: 'gender',
    fromValues: ['Men', 'Boys', 'Man', 'Boy'],
    toValue: 'Male',
  },
  {
    label: 'gender Women/Girls → Female',
    column: 'gender',
    fromValues: ['Women', 'Girls', 'Woman', 'Girl'],
    toValue: 'Female',
  },
  {
    label: 'size Extra Small → XS',
    column: 'size',
    fromValues: ['Extra Small'],
    toValue: 'XS',
  },
  {
    label: 'size Small → S',
    column: 'size',
    fromValues: ['Small'],
    toValue: 'S',
  },
  {
    label: 'size Medium → M',
    column: 'size',
    fromValues: ['Medium'],
    toValue: 'M',
  },
  {
    label: 'size Large → L',
    column: 'size',
    fromValues: ['Large'],
    toValue: 'L',
  },
  {
    label: 'size Extra Large → XL',
    column: 'size',
    fromValues: ['Extra Large'],
    toValue: 'XL',
  },
  {
    label: 'PE Uniform type Top → Shirt',
    column: 'type',
    fromValues: ['Top'],
    toValue: 'Shirt',
    categoryNames: ['PE Uniform', 'LCA PE Uniform'],
  },
  {
    label: 'PE Uniform type Bottom → Pants',
    column: 'type',
    fromValues: ['Bottom'],
    toValue: 'Pants',
    categoryNames: ['PE Uniform', 'LCA PE Uniform'],
  },
];

const SCHOOL_UNIFORM_CATEGORY_NAMES = [
  'School Uniform',
  'LCA Uniform',
  'School Uniform_Replacement',
];

/** Gender-aware School Uniform piece types (RHET SCHOOL_UNIFORM). */
const SCHOOL_UNIFORM_TYPE_UPDATES = [
  {
    label: 'School Uniform Male Top → Polo',
    genders: ['Male', 'Men', 'Man', 'Boys', 'Boy'],
    fromType: 'Top',
    toType: 'Polo',
  },
  {
    label: 'School Uniform Male Bottom → Short',
    genders: ['Male', 'Men', 'Man', 'Boys', 'Boy'],
    fromType: 'Bottom',
    toType: 'Short',
  },
  {
    label: 'School Uniform Female Top → Blouse',
    genders: ['Female', 'Women', 'Woman', 'Girls', 'Girl'],
    fromType: 'Top',
    toType: 'Blouse',
  },
  {
    label: 'School Uniform Female Bottom → Skirt',
    genders: ['Female', 'Women', 'Woman', 'Girls', 'Girl'],
    fromType: 'Bottom',
    toType: 'Skirt',
  },
];

/** @param {string[]} fromNames
 * @param {string} column
 * @param {string} toValue
 */
function buildInClauseStep({ label, fromNames, column, toValue, categoryNames = null }) {
  const params = [...fromNames];
  const inList = fromNames.map((_, i) => `$${i + 1}`).join(', ');
  let where = `${column} IN (${inList})`;
  if (categoryNames?.length) {
    const catStart = params.length + 1;
    params.push(...categoryNames);
    const catList = categoryNames.map((_, i) => `$${catStart + i}`).join(', ');
    where += ` AND merchandise_name IN (${catList})`;
  }
  if (branchId != null) {
    params.push(branchId);
    where += ` AND branch_id = $${params.length}`;
  }
  const toIndex = params.length + 1;
  return {
    label,
    countSql: `SELECT COUNT(*)::int AS n FROM merchandisestbl WHERE ${where}`,
    countParams: params,
    updateSql: `UPDATE merchandisestbl SET ${column} = $${toIndex} WHERE ${where}`,
    updateParams: [...params, toValue],
  };
}

function buildGenderCategoryTypeStep({
  label,
  categoryNames,
  genders,
  fromType,
  toType,
}) {
  const params = [fromType, ...categoryNames, ...genders];
  const catList = categoryNames.map((_, i) => `$${i + 2}`).join(', ');
  const genderStart = 2 + categoryNames.length;
  const genderList = genders.map((_, i) => `$${genderStart + i}`).join(', ');
  let where = `type = $1 AND merchandise_name IN (${catList}) AND gender IN (${genderList})`;
  if (branchId != null) {
    params.push(branchId);
    where += ` AND branch_id = $${params.length}`;
  }
  const toIndex = params.length + 1;
  return {
    label,
    countSql: `SELECT COUNT(*)::int AS n FROM merchandisestbl WHERE ${where}`,
    countParams: params,
    updateSql: `UPDATE merchandisestbl SET type = $${toIndex} WHERE ${where}`,
    updateParams: [...params, toType],
  };
}

function buildSteps() {
  const genericSteps = UPDATES.map((step) => {
    if (step.toName != null) {
      return buildInClauseStep({
        label: step.label,
        fromNames: step.fromNames,
        column: 'merchandise_name',
        toValue: step.toName,
      });
    }
    return buildInClauseStep({
      label: step.label,
      fromNames: step.fromValues,
      column: step.column,
      toValue: step.toValue,
      categoryNames: step.categoryNames || null,
    });
  });

  const schoolTypeSteps = SCHOOL_UNIFORM_TYPE_UPDATES.map((step) =>
    buildGenderCategoryTypeStep({
      ...step,
      categoryNames: SCHOOL_UNIFORM_CATEGORY_NAMES,
    })
  );

  return [...genericSteps, ...schoolTypeSteps];
}

async function run() {
  const client = await getClient();
  const steps = buildSteps();
  const scopeLabel =
    branchId != null ? `branch_id=${branchId}` : 'all branches';

  try {
    await client.query('BEGIN');
    console.log(dryRun ? '=== DRY RUN ===' : '=== APPLY ===');
    console.log(`Scope: ${scopeLabel}\n`);

    for (const step of steps) {
      const countRes = await client.query(step.countSql, step.countParams);
      const n = countRes.rows[0]?.n ?? 0;
      if (dryRun) {
        console.log(`[dry-run] ${step.label}: ${n} row(s)`);
      } else if (n > 0) {
        const result = await client.query(step.updateSql, step.updateParams);
        console.log(`${step.label}: ${result.rowCount} row(s)`);
      } else {
        console.log(`${step.label}: 0 row(s) (skipped)`);
      }
    }

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('\nDry run complete — no changes written.');
      console.log(
        branchId != null
          ? `To apply Malolos: node scripts/migrateMerchandiseLabelsToRhet.js --apply --branch-id=${branchId}`
          : 'To apply all branches: node scripts/migrateMerchandiseLabelsToRhet.js --apply'
      );
    } else {
      await client.query('COMMIT');
      console.log('\nMigration complete.');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

run();
