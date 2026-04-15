/**
 * Extend a Phase package's range (e.g. 6–9 → 6–10) and sync installment profiles so
 * total_phases matches: (phase_end - phase_start + 1). This allows one more phase invoice
 * to be generated when appropriate (generated_count < total_phases).
 *
 * Does NOT rewrite existing invoice rows; new phase invoices pick up from installment logic.
 *
 * Usage (from project root):
 *   node backend/scripts/extendPhasePackageAndSyncInstallmentProfiles.js --package-id 58 --new-phase-end 10
 *   node backend/scripts/extendPhasePackageAndSyncInstallmentProfiles.js --package-id 58 --new-phase-end 10 --apply
 *
 * Without --apply: preview only (no DB writes).
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

function parseArgs() {
  const argv = process.argv.slice(2);
  let packageId = null;
  let newPhaseEnd = null;
  let apply = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') apply = true;
    else if (a === '--package-id' && argv[i + 1]) packageId = parseInt(argv[++i], 10);
    else if (a === '--new-phase-end' && argv[i + 1]) newPhaseEnd = parseInt(argv[++i], 10);
    else if (a === '--help' || a === '-h') {
      console.log(`
Extend phase_end on packagestbl and recalc installmentinvoiceprofilestbl.total_phases.

  --package-id <n>      Required. packagestbl.package_id
  --new-phase-end <n>   Required. New phase_end (e.g. 10 for range 6–10)
  --apply               Commit changes (otherwise dry-run)

Example:
  node backend/scripts/extendPhasePackageAndSyncInstallmentProfiles.js --package-id 58 --new-phase-end 10
  node backend/scripts/extendPhasePackageAndSyncInstallmentProfiles.js --package-id 58 --new-phase-end 10 --apply
`);
      process.exit(0);
    }
  }

  if (!Number.isFinite(packageId) || packageId < 1) {
    console.error('Missing or invalid --package-id');
    process.exit(1);
  }
  if (!Number.isFinite(newPhaseEnd) || newPhaseEnd < 1) {
    console.error('Missing or invalid --new-phase-end');
    process.exit(1);
  }

  return { packageId, newPhaseEnd, apply };
}

async function main() {
  const { packageId, newPhaseEnd, apply } = parseArgs();

  const client = await getClient();
  try {
    const pkgRes = await client.query(
      `SELECT package_id, package_name, branch_id, package_type, phase_start, phase_end, payment_option, status
       FROM packagestbl
       WHERE package_id = $1`,
      [packageId]
    );

    if (pkgRes.rows.length === 0) {
      throw new Error(`No package with package_id=${packageId}`);
    }

    const pkg = pkgRes.rows[0];
    if (String(pkg.package_type || '').trim() !== 'Phase') {
      throw new Error(`Package ${packageId} is not package_type=Phase (got ${pkg.package_type}). Refusing.`);
    }

    const phaseStart = pkg.phase_start != null ? parseInt(pkg.phase_start, 10) : null;
    if (phaseStart == null || Number.isNaN(phaseStart)) {
      throw new Error('Package has no phase_start; cannot extend safely.');
    }

    const oldEnd = pkg.phase_end != null ? parseInt(pkg.phase_end, 10) : phaseStart;
    if (newPhaseEnd < oldEnd) {
      throw new Error(
        `Refusing to shrink range: current phase_end=${oldEnd}, requested new_phase_end=${newPhaseEnd}. Use a different tool or adjust manually.`
      );
    }
    if (newPhaseEnd === oldEnd) {
      console.log(`No change: phase_end already ${oldEnd}.`);
    }

    if (newPhaseEnd < phaseStart) {
      throw new Error('--new-phase-end must be >= phase_start');
    }

    const newTotalPhases = Math.max(1, newPhaseEnd - phaseStart + 1);

    const profilesRes = await client.query(
      `SELECT installmentinvoiceprofiles_id, student_id, class_id, package_id,
              phase_start, total_phases, generated_count, is_active
       FROM installmentinvoiceprofilestbl
       WHERE package_id = $1
       ORDER BY installmentinvoiceprofiles_id`,
      [packageId]
    );

    console.log('\n--- Package ---');
    console.log(JSON.stringify(pkg, null, 2));
    console.log('\n--- Computed ---');
    console.log(`phase_start=${phaseStart}, old phase_end=${oldEnd}, new phase_end=${newPhaseEnd}`);
    console.log(`total_phases per profile should become: ${newTotalPhases} (range length)`);

    console.log(`\n--- Installment profiles (${profilesRes.rows.length}) ---`);
    for (const row of profilesRes.rows) {
      const ps = row.phase_start != null ? parseInt(row.phase_start, 10) : phaseStart;
      const nextTotal = Math.max(1, newPhaseEnd - ps + 1);
      console.log(
        `  profile ${row.installmentinvoiceprofiles_id} student=${row.student_id} class=${row.class_id} ` +
          `phase_start=${row.phase_start} total_phases=${row.total_phases} generated_count=${row.generated_count} active=${row.is_active} ` +
          `→ total_phases will be ${nextTotal}`
      );
    }

    if (!apply) {
      console.log('\n[DRY RUN] No changes written. Pass --apply to execute.\n');
      return;
    }

    await client.query('BEGIN');

    const updPkg = await client.query(
      `UPDATE packagestbl
       SET phase_end = $1
       WHERE package_id = $2
       RETURNING package_id, package_name, phase_start, phase_end`,
      [newPhaseEnd, packageId]
    );

    const updProfiles = await client.query(
      `UPDATE installmentinvoiceprofilestbl ip
       SET total_phases = GREATEST(
         1,
         COALESCE(p.phase_end, p.phase_start) - COALESCE(ip.phase_start, p.phase_start) + 1
       )
       FROM packagestbl p
       WHERE p.package_id = ip.package_id
         AND ip.package_id = $1
       RETURNING ip.installmentinvoiceprofiles_id, ip.student_id, ip.total_phases, ip.phase_start, ip.generated_count`,
      [packageId]
    );

    await client.query('COMMIT');

    console.log('\n--- Updated package ---');
    console.log(JSON.stringify(updPkg.rows, null, 2));
    console.log('\n--- Updated profiles (returned rows) ---');
    console.log(JSON.stringify(updProfiles.rows, null, 2));
    console.log('\nDone.\n');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
