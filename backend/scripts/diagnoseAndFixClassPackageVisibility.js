/**
 * Diagnose why packages do not appear in Classes → Enroll → Select Package,
 * using the same rules as frontend Classes.jsx / adminClasses.jsx.
 *
 * Default: dry-run (read-only). Pass --apply to write safe fixes.
 *
 * Usage (from project root):
 *   node backend/scripts/diagnoseAndFixClassPackageVisibility.js --class-name=VMP_NURSERY
 *   node backend/scripts/diagnoseAndFixClassPackageVisibility.js --class-id=53
 *   node backend/scripts/diagnoseAndFixClassPackageVisibility.js --class-name=VMP_NURSERY --package-names "Nursery Plan 3,PreK Plan 3"
 *   node backend/scripts/diagnoseAndFixClassPackageVisibility.js --class-id=53 --min-package-id=200 --package-names "Nursery Plan 3,PreK Plan 3"
 *   node backend/scripts/diagnoseAndFixClassPackageVisibility.js --class-id=53 --package-ids=101,102 --apply --fix=branch,level-tag,status
 *
 * Fix flags (--fix= comma-separated, only with --apply):
 *   branch     — set package.branch_id to class.branch_id when mismatched
 *   level-tag  — set package.level_tag to class.level_tag when mismatched
 *   status     — set status = 'Active' when Inactive
 *
 * Note: package_type = 'Phase' packages never appear under standard "Package" enrollment.
 * Use enrollment option "Per Phase" in the UI, or create a Fullpayment/Installment package.
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import {
  getInstallmentEnrollmentFloorPhase,
  loadClassPhaseScheduleContext,
} from '../utils/classActivePhase.js';

const ENROLLMENT_OPTIONS = ['package', 'per-phase', 'reservation'];

function printHelp() {
  console.log(`
Diagnose / fix class enrollment package visibility (Classes.jsx rules).

Required (one of):
  --class-id <n>
  --class-name <substring>     Case-insensitive partial match on class_name

Package scope (optional — default: all branch-scoped packages for the class):
  --package-ids <id,id,...>
  --package-names <sub,sub,...>  Comma-separated partial name matches
  --min-package-id <n>             Only packages with package_id >= n (use for recently created)

Apply:
  --apply                        Write fixes (default is dry-run)
  --fix <branch,level-tag,status|all>

Examples:
  node backend/scripts/diagnoseAndFixClassPackageVisibility.js --class-name=VMP_NURSERY
  node backend/scripts/diagnoseAndFixClassPackageVisibility.js --class-id=53 --package-names "Nursery Plan 3" --apply --fix=branch,level-tag,status
`);
}

function parseArgs() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  let classId = null;
  let className = null;
  let packageIds = [];
  let packageNameParts = [];
  let minPackageId = null;
  let apply = false;
  let fixFlags = new Set();

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') apply = true;
    else if (a === '--class-id' && argv[i + 1]) classId = parseInt(argv[++i], 10);
    else if (a.startsWith('--class-id=')) classId = parseInt(a.split('=')[1], 10);
    else if (a === '--class-name' && argv[i + 1]) className = argv[++i];
    else if (a.startsWith('--class-name=')) className = a.slice('--class-name='.length);
    else if (a === '--package-ids' && argv[i + 1]) {
      packageIds = argv[++i].split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => n > 0);
    } else if (a.startsWith('--package-ids=')) {
      packageIds = a
        .slice('--package-ids='.length)
        .split(',')
        .map((x) => parseInt(x.trim(), 10))
        .filter((n) => n > 0);
    } else if (a === '--package-names' && argv[i + 1]) {
      packageNameParts = argv[++i].split(',').map((x) => x.trim()).filter(Boolean);
    } else if (a.startsWith('--package-names=')) {
      packageNameParts = a
        .slice('--package-names='.length)
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
    }     else if (a === '--min-package-id' && argv[i + 1]) minPackageId = parseInt(argv[++i], 10);
    else if (a.startsWith('--min-package-id=')) minPackageId = parseInt(a.split('=')[1], 10);
    else if (a === '--fix' && argv[i + 1]) {
      const raw = argv[++i];
      for (const part of raw.split(',').map((x) => x.trim().toLowerCase())) {
        if (part === 'all') {
          fixFlags = new Set(['branch', 'level-tag', 'status']);
        } else if (part) {
          fixFlags.add(part);
        }
      }
    } else if (a.startsWith('--fix=')) {
      for (const part of a
        .slice('--fix='.length)
        .split(',')
        .map((x) => x.trim().toLowerCase())) {
        if (part === 'all') {
          fixFlags = new Set(['branch', 'level-tag', 'status']);
        } else if (part) {
          fixFlags.add(part);
        }
      }
    }
  }

  if (!Number.isFinite(classId) && !className) {
    console.error('Provide --class-id or --class-name');
    printHelp();
    process.exit(1);
  }

  if (apply && fixFlags.size === 0) {
    fixFlags = new Set(['branch', 'level-tag', 'status']);
  }

  return {
    classId: Number.isFinite(classId) ? classId : null,
    className: className || null,
    packageIds,
    packageNameParts,
    minPackageId: Number.isFinite(minPackageId) ? minPackageId : null,
    apply,
    fixFlags,
  };
}

function packageTypesForOption(option) {
  if (option === 'reservation') return new Set(['Reserved']);
  if (option === 'per-phase') return new Set(['Phase', 'Installment']);
  return new Set(['Fullpayment', 'Installment', 'Promo']);
}

function passesPackageTypeFilter(pkg, option) {
  const type = String(pkg.package_type || '').trim();
  const paymentOption = String(pkg.payment_option || '').trim();
  if (option === 'reservation') return type === 'Reserved';
  if (option === 'per-phase') return type === 'Phase' || type === 'Installment';
  return (
    type === 'Fullpayment' ||
    type === 'Installment' ||
    type === 'Promo' ||
    (type === 'Phase' && paymentOption === 'Installment')
  );
}

function passesLevelTagFilter(pkg, classLevelTag) {
  if (!classLevelTag) return true;
  return String(pkg.level_tag || '') === String(classLevelTag);
}

function passesBranchApiFilter(pkg, classBranchId) {
  if (pkg.branch_id == null || pkg.branch_id === '') return true;
  return Number(pkg.branch_id) === Number(classBranchId);
}

function passesPerPhaseRangeFilter(pkg, { enrollmentFloor, classMaxPhase, targetPhase }) {
  if (String(pkg.package_type || '').trim() !== 'Phase') return true;

  const phaseStart = pkg.phase_start != null ? Number(pkg.phase_start) : null;
  const phaseEnd = pkg.phase_end != null ? Number(pkg.phase_end) : null;
  if (phaseStart == null || Number.isNaN(phaseStart)) {
    return { ok: false, reason: 'Phase package missing phase_start' };
  }

  const pkgMaxPhase = phaseEnd ?? phaseStart;
  if (pkgMaxPhase < enrollmentFloor) {
    return {
      ok: false,
      reason: `Package max phase ${pkgMaxPhase} is below enrollment floor ${enrollmentFloor}`,
    };
  }
  if (phaseStart < enrollmentFloor) {
    return {
      ok: false,
      reason: `Package phase_start ${phaseStart} is below enrollment floor ${enrollmentFloor}`,
    };
  }

  if (targetPhase != null) {
    if (phaseEnd == null) {
      return phaseStart === targetPhase
        ? { ok: true }
        : { ok: false, reason: `Single-phase package is phase ${phaseStart}, not target ${targetPhase}` };
    }
    const inRange = targetPhase >= phaseStart && targetPhase <= phaseEnd;
    return inRange
      ? { ok: true }
      : {
          ok: false,
          reason: `Target phase ${targetPhase} outside package range ${phaseStart}-${phaseEnd}`,
        };
  }

  if (classMaxPhase) {
    if (phaseEnd == null) {
      return phaseStart <= classMaxPhase
        ? { ok: true }
        : {
            ok: false,
            reason: `Single-phase package phase ${phaseStart} exceeds class max phase ${classMaxPhase}`,
          };
    }
    return phaseStart <= classMaxPhase
      ? { ok: true }
      : {
          ok: false,
          reason: `Package phase_start ${phaseStart} exceeds class max phase ${classMaxPhase}`,
        };
  }

  return { ok: true };
}

function evaluateVisibility(pkg, classRow, option, scheduleContext) {
  const blockers = [];

  if (!passesBranchApiFilter(pkg, classRow.branch_id)) {
    blockers.push({
      code: 'branch_mismatch',
      message: `Package branch_id=${pkg.branch_id ?? 'NULL'} does not match class branch_id=${classRow.branch_id} (and is not global)`,
      fixable: true,
      fix: 'branch',
    });
  }

  if (!passesPackageTypeFilter(pkg, option)) {
    const type = String(pkg.package_type || '').trim() || '(empty)';
    const paymentOption = String(pkg.payment_option || '').trim();
    if (option === 'package' && type === 'Phase' && paymentOption !== 'Installment') {
      blockers.push({
        code: 'phase_fullpayment_not_in_standard_package_flow',
        message:
          'package_type=Phase with Fullpayment is hidden in standard "Package" enrollment — use "Per Phase" option in the enroll modal',
        fixable: false,
      });
    } else if (option === 'package' && type === 'Phase' && paymentOption === 'Installment') {
      blockers.push({
        code: 'phase_installment_ui_bug',
        message:
          'Phase (Installment) packages should appear under standard "Package" enrollment after frontend fix — redeploy frontend if still hidden',
        fixable: false,
      });
    } else {
      blockers.push({
        code: 'package_type_mismatch',
        message: `package_type=${type}${paymentOption ? `/${paymentOption}` : ''} not allowed for enrollment option "${option}"`,
        fixable: false,
      });
    }
  }

  if (!passesLevelTagFilter(pkg, classRow.level_tag)) {
    blockers.push({
      code: 'level_tag_mismatch',
      message: `Package level_tag="${pkg.level_tag ?? ''}" !== class level_tag="${classRow.level_tag ?? ''}"`,
      fixable: true,
      fix: 'level-tag',
    });
  }

  if (String(pkg.status || '').trim() === 'Inactive') {
    blockers.push({
      code: 'inactive_status',
      message: 'Package status is Inactive (still shown in enroll modal, but may confuse staff)',
      fixable: true,
      fix: 'status',
    });
  }

  if (option === 'per-phase') {
    const range = passesPerPhaseRangeFilter(pkg, scheduleContext);
    if (range.ok === false) {
      blockers.push({
        code: 'phase_range',
        message: range.reason,
        fixable: false,
      });
    }
  }

  return {
    visible: blockers.length === 0,
    blockers,
  };
}

async function loadClass(client, { classId, className }) {
  const params = [];
  let where = 'WHERE c.archived_at IS NULL';
  if (classId) {
    params.push(classId);
    where += ` AND c.class_id = $${params.length}`;
  } else {
    params.push(`%${className}%`);
    where += ` AND c.class_name ILIKE $${params.length}`;
  }

  const result = await client.query(
    `
    SELECT
      c.class_id,
      c.class_name,
      c.branch_id,
      c.level_tag,
      c.program_id,
      c.status AS class_status,
      TO_CHAR(c.start_date, 'YYYY-MM-DD') AS start_date,
      b.branch_name,
      p.program_name,
      cu.curriculum_id,
      cu.number_of_phase,
      cu.number_of_session_per_phase
    FROM classestbl c
    LEFT JOIN branchestbl b ON b.branch_id = c.branch_id
    LEFT JOIN programstbl p ON p.program_id = c.program_id
    LEFT JOIN curriculumstbl cu ON cu.curriculum_id = p.curriculum_id
    ${where}
    ORDER BY c.class_id DESC
    `,
    params
  );

  if (result.rows.length === 0) {
    throw new Error('No class found for the given --class-id / --class-name');
  }
  if (result.rows.length > 1 && !classId) {
    console.log('\nMultiple classes matched — using the first. Pass --class-id to be exact:\n');
    for (const row of result.rows) {
      console.log(`  class_id=${row.class_id}  ${row.class_name}  branch=${row.branch_name}  level_tag=${row.level_tag}`);
    }
    console.log('');
  }
  return result.rows[0];
}

async function loadTargetPackages(client, classRow, { packageIds, packageNameParts, minPackageId }) {
  const params = [classRow.branch_id];
  let where = `(p.branch_id = $1 OR p.branch_id IS NULL)`;

  if (packageIds.length > 0) {
    params.push(packageIds);
    where += ` AND p.package_id = ANY($${params.length}::int[])`;
  }

  if (packageNameParts.length > 0) {
    const nameClauses = packageNameParts.map((part) => {
      params.push(`%${part}%`);
      return `p.package_name ILIKE $${params.length}`;
    });
    where += ` AND (${nameClauses.join(' OR ')})`;
  }

  if (minPackageId != null) {
    params.push(minPackageId);
    where += ` AND p.package_id >= $${params.length}`;
  }

  const result = await client.query(
    `
    SELECT
      p.package_id,
      p.package_name,
      p.branch_id,
      p.level_tag,
      p.status,
      p.package_type,
      p.payment_option,
      p.phase_start,
      p.phase_end,
      p.package_price,
      p.downpayment_amount,
      (SELECT COUNT(*)::int FROM invoicestbl i WHERE i.package_id = p.package_id) AS invoice_count,
      (SELECT COUNT(*)::int FROM reservationstbl r WHERE r.package_id = p.package_id) AS reservation_count
    FROM packagestbl p
    WHERE ${where}
    ORDER BY p.package_id DESC
    LIMIT 200
    `,
    params
  );

  return result.rows;
}

async function countBranchPackages(client, branchId) {
  const result = await client.query(
    `
    SELECT COUNT(*)::int AS total
    FROM packagestbl
    WHERE branch_id = $1 OR branch_id IS NULL
    `,
    [branchId]
  );
  return result.rows[0]?.total ?? 0;
}

function buildPlannedFixes(pkg, classRow, evaluations) {
  const fixes = [];
  const seen = new Set();

  for (const ev of Object.values(evaluations)) {
    for (const blocker of ev.blockers) {
      if (!blocker.fixable || !blocker.fix) continue;
      const key = `${blocker.fix}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (blocker.fix === 'branch' && Number(pkg.branch_id) !== Number(classRow.branch_id)) {
        fixes.push({
          field: 'branch_id',
          from: pkg.branch_id,
          to: classRow.branch_id,
          fixKey: 'branch',
        });
      }
      if (blocker.fix === 'level-tag' && pkg.level_tag !== classRow.level_tag) {
        fixes.push({
          field: 'level_tag',
          from: pkg.level_tag,
          to: classRow.level_tag,
          fixKey: 'level-tag',
        });
      }
      if (blocker.fix === 'status' && String(pkg.status || '').trim() === 'Inactive') {
        fixes.push({
          field: 'status',
          from: pkg.status,
          to: 'Active',
          fixKey: 'status',
        });
      }
    }
  }

  return fixes;
}

async function applyPackageFixes(client, packageId, fixes, fixFlags) {
  const sets = [];
  const params = [];
  for (const fix of fixes) {
    if (!fixFlags.has(fix.fixKey)) continue;
    params.push(fix.to);
    sets.push(`${fix.field} = $${params.length}`);
  }
  if (sets.length === 0) return false;

  params.push(packageId);
  await client.query(
    `UPDATE packagestbl SET ${sets.join(', ')} WHERE package_id = $${params.length}`,
    params
  );
  return true;
}

async function main() {
  const args = parseArgs();
  const client = await getClient();

  try {
    console.log(`\n=== Class package visibility ${args.apply ? 'APPLY' : 'DRY-RUN'} ===\n`);

    const classRow = await loadClass(client, args);
    const scheduleCtx = await loadClassPhaseScheduleContext(client, classRow);
    const enrollmentFloor = getInstallmentEnrollmentFloorPhase(
      scheduleCtx.classDetails,
      scheduleCtx.phaseSessions,
      scheduleCtx.classSessions
    );
    const scheduleContext = {
      enrollmentFloor,
      classMaxPhase: classRow.number_of_phase != null ? Number(classRow.number_of_phase) : null,
      targetPhase: null,
    };

    console.log('--- Class ---');
    console.log(
      JSON.stringify(
        {
          class_id: classRow.class_id,
          class_name: classRow.class_name,
          branch_id: classRow.branch_id,
          branch_name: classRow.branch_name,
          level_tag: classRow.level_tag,
          number_of_phase: classRow.number_of_phase,
          class_status: classRow.class_status,
          enrollment_floor: enrollmentFloor,
        },
        null,
        2
      )
    );

    const branchPackageTotal = await countBranchPackages(client, classRow.branch_id);
    if (branchPackageTotal > 100) {
      console.log(
        `\n⚠ Branch has ${branchPackageTotal} packages but UI loads limit=100 (newest first). Very old packages may not load in the modal.\n`
      );
    }

    const packages = await loadTargetPackages(client, classRow, args);
    if (packages.length === 0) {
      console.log('\nNo packages matched the scope for this class branch.');
      console.log('Check branch_id on the package vs class, or widen --package-names / --min-package-id.\n');
      return;
    }

    console.log(`\n--- Packages to evaluate (${packages.length}) ---\n`);

    const allFixes = [];

    for (const pkg of packages) {
      const evaluations = {};
      for (const option of ENROLLMENT_OPTIONS) {
        evaluations[option] = evaluateVisibility(pkg, classRow, option, scheduleContext);
      }

      const visibleAnywhere = ENROLLMENT_OPTIONS.some((opt) => evaluations[opt].visible);
      const plannedFixes = buildPlannedFixes(pkg, classRow, evaluations);

      console.log(`Package #${pkg.package_id} — ${pkg.package_name}`);
      console.log(
        `  branch_id=${pkg.branch_id ?? 'NULL'}  level_tag=${pkg.level_tag ?? '(empty)'}  status=${pkg.status}  type=${pkg.package_type}${pkg.payment_option ? `/${pkg.payment_option}` : ''}  phases=${pkg.phase_start ?? '—'}-${pkg.phase_end ?? '—'}`
      );
      console.log(
        `  usage: invoices=${pkg.invoice_count}  reservations=${pkg.reservation_count}`
      );

      for (const option of ENROLLMENT_OPTIONS) {
        const ev = evaluations[option];
        const label = option === 'package' ? 'Standard "Package"' : option === 'per-phase' ? 'Per Phase' : 'Reservation';
        console.log(`  [${label}] ${ev.visible ? 'VISIBLE' : 'HIDDEN'}`);
        if (!ev.visible) {
          for (const b of ev.blockers) {
            console.log(`      - ${b.message}${b.fixable ? ' (fixable)' : ''}`);
          }
        }
      }

      if (!visibleAnywhere) {
        console.log('  >> Not visible under any enrollment option with current data.');
      } else if (!evaluations.package.visible && evaluations['per-phase'].visible) {
        console.log('  >> Tip: Use "Per Phase" in the enroll modal (not standard "Package").');
      }

      if (plannedFixes.length > 0) {
        console.log('  Planned fixes:');
        for (const fix of plannedFixes) {
          const allowed = args.fixFlags.has(fix.fixKey);
          console.log(
            `      ${fix.field}: ${JSON.stringify(fix.from)} → ${JSON.stringify(fix.to)}${args.apply ? (allowed ? ' (will apply)' : ' (skipped — not in --fix)') : ''}`
          );
        }
        allFixes.push({ packageId: pkg.package_id, packageName: pkg.package_name, fixes: plannedFixes });
      }

      console.log('');
    }

    if (!args.apply) {
      console.log('Dry-run complete. No database changes were made.');
      console.log('To apply safe fixes:');
      console.log(
        `  node backend/scripts/diagnoseAndFixClassPackageVisibility.js --class-id=${classRow.class_id} --package-ids=${packages.map((p) => p.package_id).join(',')} --apply --fix=branch,level-tag,status`
      );
      console.log(
        '\nReminder: Phase packages require "Per Phase" enrollment in the UI — the script cannot change that without changing package_type (not recommended).\n'
      );
      return;
    }

    if (allFixes.length === 0) {
      console.log('Nothing fixable via --fix flags. Review blockers above.\n');
      return;
    }

    await client.query('BEGIN');
    let applied = 0;
    for (const item of allFixes) {
      const did = await applyPackageFixes(client, item.packageId, item.fixes, args.fixFlags);
      if (did) {
        applied += 1;
        console.log(`Applied fixes to package #${item.packageId} (${item.packageName})`);
      }
    }
    await client.query('COMMIT');
    console.log(`\nApplied updates to ${applied} package(s).\n`);
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('\nError:', err.message);
    process.exit(1);
  } finally {
    client.release();
  }
}

main();
