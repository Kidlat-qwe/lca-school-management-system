/**
 * Scan and repair installment auto-generation queue rows for class-linked plans.
 *
 * Fixes profiles where:
 * - installmentinvoicestbl.status = 'Generated' but more phases remain (blocks scheduler), OR
 * - next_generation_date / next_invoice_month do not match buildPhaseInstallmentSchedule
 *
 * Usage (from repo root or backend/):
 *
 *   # Preview ALL active class-linked students (recommended first)
 *   node backend/scripts/repairInstallmentGenerationSchedule.js --dry-run
 *
 *   # Apply fixes for ALL active class-linked students
 *   node backend/scripts/repairInstallmentGenerationSchedule.js --apply
 *
 *   # Single profile
 *   node backend/scripts/repairInstallmentGenerationSchedule.js 154 --dry-run
 *   node backend/scripts/repairInstallmentGenerationSchedule.js 154 --apply
 *
 *   # Include inactive profiles that still have an open queue row
 *   node backend/scripts/repairInstallmentGenerationSchedule.js --apply --include-inactive
 *
 *   # Show profiles that are already correct
 *   node backend/scripts/repairInstallmentGenerationSchedule.js --dry-run --verbose
 */
import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { buildPhaseInstallmentSchedule, isPhaseInstallmentProfile } from '../utils/phaseInstallmentUtils.js';
import { formatYmdLocal } from '../utils/dateUtils.js';

function parseArgs() {
  const argv = process.argv.slice(2);
  let profileId = null;
  let dryRun = true;
  let apply = false;
  let includeInactive = false;
  let verbose = false;

  for (const arg of argv) {
    if (arg === '--apply') {
      apply = true;
      dryRun = false;
    } else if (arg === '--dry-run') {
      dryRun = true;
      apply = false;
    } else if (arg === '--include-inactive') {
      includeInactive = true;
    } else if (arg === '--verbose') {
      verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Repair installment generation schedule (all students or one profile)

  --dry-run            Preview only (default)
  --apply              Write fixes to the database
  --include-inactive   Also scan inactive profiles with a queue row
  --verbose            Log profiles that are already correct
  <profileId>          Limit to one installmentinvoiceprofiles_id

Examples:
  node backend/scripts/repairInstallmentGenerationSchedule.js --dry-run
  node backend/scripts/repairInstallmentGenerationSchedule.js --apply
  node backend/scripts/repairInstallmentGenerationSchedule.js 154 --apply
`);
      process.exit(0);
    } else if (/^\d+$/.test(arg)) {
      profileId = Number(arg);
    }
  }

  return { profileId, dryRun: dryRun && !apply, apply, includeInactive, verbose };
}

const ymd = (value) => {
  if (!value) return null;
  return formatYmdLocal(value).slice(0, 10);
};

async function assessProfile(client, row) {
  const profile = {
    installmentinvoiceprofiles_id: row.installmentinvoiceprofiles_id,
    class_id: row.class_id,
    phase_start: row.phase_start,
    total_phases: row.total_phases,
    generated_count: row.generated_count,
  };

  if (!isPhaseInstallmentProfile(profile)) {
    return { skipped: true, reason: 'not class-linked' };
  }

  const totalPhases = row.total_phases != null ? parseInt(row.total_phases, 10) : null;
  const generatedCount = parseInt(row.generated_count || 0, 10);
  const hasMorePhases = totalPhases == null || generatedCount < totalPhases;

  let sched;
  try {
    sched = await buildPhaseInstallmentSchedule({
      db: client,
      profile,
      generatedCountOverride: generatedCount,
    });
  } catch (error) {
    return {
      skipped: true,
      reason: 'schedule_error',
      error: error.message,
    };
  }

  const storedGen = ymd(row.next_generation_date);
  const storedMonth = ymd(row.next_invoice_month);

  if (!sched || sched.is_last_phase) {
    const needsComplete =
      row.ii_status !== 'Generated' ||
      row.next_generation_date != null ||
      row.next_invoice_month != null;
    return {
      action: needsComplete ? 'mark_complete' : 'ok_complete',
      profileId: row.installmentinvoiceprofiles_id,
      student_id: row.student_id,
      student_name: row.student_name,
      student_email: row.student_email,
      class_name: row.class_name,
      generated_count: generatedCount,
      total_phases: totalPhases,
      was_status: row.ii_status,
      storedGen,
      storedMonth,
      expectedGen: null,
      expectedMonth: null,
      next_phase: null,
      needsRepair: needsComplete,
    };
  }

  const expectedGen = sched.current_generation_date;
  const expectedMonth = sched.current_invoice_month;
  const needsStatusFix = hasMorePhases && row.ii_status === 'Generated';
  const needsGenFix = Boolean(expectedGen && storedGen !== expectedGen);
  const needsMonthFix = Boolean(expectedMonth && storedMonth !== expectedMonth);
  const needsRepair = needsStatusFix || needsGenFix || needsMonthFix;

  if (!needsRepair) {
    return {
      skipped: true,
      reason: 'already correct',
      profileId: row.installmentinvoiceprofiles_id,
      student_name: row.student_name,
      expectedGen,
      storedGen,
    };
  }

  return {
    action: 'repaired',
    profileId: row.installmentinvoiceprofiles_id,
    student_id: row.student_id,
    student_name: row.student_name,
    student_email: row.student_email,
    class_name: row.class_name,
    generated_count: generatedCount,
    total_phases: totalPhases,
    was_status: row.ii_status,
    storedGen,
    storedMonth,
    expectedGen,
    expectedMonth,
    next_phase: sched.current_phase_number,
    billing_mode: sched.billing_mode,
    needsStatusFix,
    needsGenFix,
    needsMonthFix,
    needsRepair: true,
    installmentinvoicedtl_id: row.installmentinvoicedtl_id,
    sched,
  };
}

async function applyRepair(client, assessment, dryRun) {
  if (assessment.skipped || !assessment.needsRepair) {
    return assessment;
  }

  if (assessment.action === 'mark_complete') {
    if (!dryRun) {
      await client.query(
        `UPDATE installmentinvoicestbl
         SET status = 'Generated', next_generation_date = NULL, next_invoice_month = NULL
         WHERE installmentinvoicedtl_id = $1`,
        [assessment.installmentinvoicedtl_id]
      );
    }
    return { ...assessment, applied: !dryRun };
  }

  if (assessment.action === 'repaired') {
    if (!dryRun) {
      await client.query(
        `UPDATE installmentinvoicestbl
         SET status = NULL, next_generation_date = $1, next_invoice_month = $2
         WHERE installmentinvoicedtl_id = $3`,
        [
          assessment.expectedGen,
          assessment.expectedMonth,
          assessment.installmentinvoicedtl_id,
        ]
      );
    }
    return { ...assessment, applied: !dryRun };
  }

  return assessment;
}

async function fetchProfiles(client, { profileId, includeInactive }) {
  const params = [];
  const conditions = [
    'ip.class_id IS NOT NULL',
    'ii.installmentinvoicedtl_id IS NOT NULL',
  ];

  if (!includeInactive) {
    conditions.push('ip.is_active = true');
  }

  if (profileId != null) {
    params.push(profileId);
    conditions.push(`ip.installmentinvoiceprofiles_id = $${params.length}`);
  }

  const res = await client.query(
    `SELECT ip.installmentinvoiceprofiles_id, ip.student_id, ip.class_id, ip.phase_start,
            ip.total_phases, ip.generated_count, ip.is_active,
            ii.installmentinvoicedtl_id, ii.next_generation_date, ii.next_invoice_month,
            ii.status AS ii_status,
            u.full_name AS student_name,
            u.email AS student_email,
            COALESCE(c.class_name, CONCAT('Class #', ip.class_id::text)) AS class_name
     FROM installmentinvoiceprofilestbl ip
     INNER JOIN installmentinvoicestbl ii
       ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
     LEFT JOIN userstbl u ON u.user_id = ip.student_id
     LEFT JOIN classestbl c ON c.class_id = ip.class_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY u.full_name NULLS LAST, ip.installmentinvoiceprofiles_id`,
    params
  );

  return res.rows;
}

function printRow(assessment) {
  const label =
    assessment.action === 'repaired'
      ? 'REPAIR'
      : assessment.action === 'mark_complete'
        ? 'COMPLETE'
        : assessment.action?.toUpperCase() || 'INFO';

  console.log(
    [
      `[${label}]`,
      `profile=${assessment.profileId}`,
      assessment.student_name ? `student="${assessment.student_name}"` : null,
      assessment.student_email ? `email=${assessment.student_email}` : null,
      assessment.class_name ? `class="${assessment.class_name}"` : null,
      `generated=${assessment.generated_count}/${assessment.total_phases ?? '?'}`,
      assessment.next_phase != null ? `next_phase=${assessment.next_phase}` : null,
      assessment.was_status != null ? `was_status=${assessment.was_status}` : null,
      assessment.storedGen != null ? `storedGen=${assessment.storedGen}` : null,
      assessment.expectedGen != null ? `expectedGen=${assessment.expectedGen}` : null,
      assessment.storedMonth != null ? `storedMonth=${assessment.storedMonth}` : null,
      assessment.expectedMonth != null ? `expectedMonth=${assessment.expectedMonth}` : null,
      assessment.billing_mode ? `mode=${assessment.billing_mode}` : null,
      assessment.reason ? `reason=${assessment.reason}` : null,
      assessment.error ? `error=${assessment.error}` : null,
    ]
      .filter(Boolean)
      .join(' | ')
  );
}

async function main() {
  const { profileId, dryRun, apply, includeInactive, verbose } = parseArgs();
  const client = await getClient();

  try {
    const rows = await fetchProfiles(client, { profileId, includeInactive });
    const scope =
      profileId != null
        ? `profile ${profileId}`
        : includeInactive
          ? 'all class-linked profiles (including inactive)'
          : 'all active class-linked profiles';

    console.log(`\n${dryRun ? '[DRY RUN] ' : '[APPLY] '}Scanning ${rows.length} row(s) — ${scope}\n`);

    if (!rows.length) {
      console.log('No matching installment profiles found.\n');
      return;
    }

    if (!dryRun) await client.query('BEGIN');

    const assessments = [];
    for (const row of rows) {
      const assessment = await assessProfile(client, row);
      if (assessment.skipped) {
        if (verbose) {
          printRow({
            action: 'skip',
            profileId: row.installmentinvoiceprofiles_id,
            student_name: row.student_name,
            reason: assessment.reason,
            error: assessment.error,
            expectedGen: assessment.expectedGen,
            storedGen: assessment.storedGen,
          });
        }
        assessments.push(assessment);
        continue;
      }

      const withMeta = {
        ...assessment,
        installmentinvoicedtl_id: row.installmentinvoicedtl_id,
      };
      const result = await applyRepair(client, withMeta, dryRun);
      if (result.needsRepair || result.action === 'mark_complete') {
        printRow(result);
      } else if (verbose) {
        printRow({ ...result, action: 'ok' });
      }
      assessments.push(result);
    }

    if (!dryRun) await client.query('COMMIT');

    const repaired = assessments.filter((a) => a.action === 'repaired').length;
    const completed = assessments.filter((a) => a.action === 'mark_complete').length;
    const skipped = assessments.filter((a) => a.skipped).length;
    const errors = assessments.filter((a) => a.reason === 'schedule_error').length;
    const ok = assessments.filter((a) => a.skipped && a.reason === 'already correct').length;

    console.log('\n--- Summary ---');
    console.log(`Scanned:   ${rows.length}`);
    console.log(`Repaired:  ${repaired}`);
    console.log(`Completed: ${completed} (last phase — queue closed)`);
    console.log(`OK:        ${ok}`);
    console.log(`Skipped:   ${skipped}`);
    if (errors) console.log(`Errors:    ${errors}`);
    console.log(`Mode:      ${dryRun ? 'dry-run (no changes written)' : 'apply (changes committed)'}`);

    if (dryRun && (repaired > 0 || completed > 0)) {
      console.log(`\nTo fix ${repaired + completed} profile(s), re-run with --apply`);
    }
    console.log('');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error('Repair failed:', err.message);
  process.exit(1);
});
