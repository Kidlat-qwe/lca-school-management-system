/**
 * Repair installment phase alignment when TARGET_PHASE / generated_count drifted
 * ahead of actual billed phases (e.g. Phase 3 "Not Generated" but Phase 4 invoiced
 * without a drop/rejoin).
 *
 * Usage (from backend/):
 *   node scripts/repairInstallmentPhaseAlignment.js --dry-run
 *   node scripts/repairInstallmentPhaseAlignment.js --email "student@example.com" --dry-run
 *   node scripts/repairInstallmentPhaseAlignment.js --email "student@example.com" --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { loadInstallmentProfilePhaseChains } from '../lib/installmentPaymentEligibility.js';
import {
  hasUnintentionalPhaseGap,
  loadDroppedAbsolutePhasesForProfile,
  repairProfileTargetPhaseAlignment,
} from '../utils/installmentPhaseBillingSync.js';
import { mapPhaseChainsToLocalSlots } from '../utils/installmentPhaseRowMapping.js';

function parseArgs() {
  const argv = process.argv.slice(2);
  let email = null;
  let profileId = null;
  let apply = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') apply = true;
    else if (a === '--dry-run') apply = false;
    else if (a === '--email' && argv[i + 1]) email = String(argv[++i]).trim();
    else if (a === '--profile' && argv[i + 1]) profileId = parseInt(argv[++i], 10);
    else if (a === '--help' || a === '-h') {
      console.log(`
Usage: node scripts/repairInstallmentPhaseAlignment.js [options]

  --dry-run          Preview only (default)
  --apply            Commit TARGET_PHASE + generated_count fixes
  --email <email>    Limit to one student
  --profile <id>     Limit to one installment profile
`);
      process.exit(0);
    }
  }

  return { email, profileId, dryRun: !apply };
}

async function main() {
  const { email, profileId, dryRun } = parseArgs();
  console.log(`\nRepair installment phase alignment${dryRun ? ' (DRY RUN)' : ' (APPLY)'}\n`);

  const client = await getClient();
  try {
    const params = [];
    const filters = ['ip.class_id IS NOT NULL'];

    if (profileId) {
      params.push(profileId);
      filters.push(`ip.installmentinvoiceprofiles_id = $${params.length}`);
    } else if (email) {
      params.push(email);
      filters.push(
        `ip.student_id = (SELECT user_id FROM userstbl WHERE LOWER(TRIM(email)) = LOWER(TRIM($${params.length})) LIMIT 1)`
      );
    }

    const profilesRes = await client.query(
      `SELECT ip.*, u.full_name, u.email
       FROM installmentinvoiceprofilestbl ip
       JOIN userstbl u ON u.user_id = ip.student_id
       WHERE ${filters.join(' AND ')}
       ORDER BY ip.installmentinvoiceprofiles_id`,
      params
    );

    let repaired = 0;

    for (const profile of profilesRes.rows) {
      const dropped = await loadDroppedAbsolutePhasesForProfile(
        client,
        profile.student_id,
        profile.class_id
      );
      const { phaseChains } = await loadInstallmentProfilePhaseChains(
        client,
        profile.installmentinvoiceprofiles_id
      );
      const targetMapped = mapPhaseChainsToLocalSlots(phaseChains, profile);

      if (!hasUnintentionalPhaseGap(targetMapped, profile, dropped)) {
        continue;
      }

      console.log(
        `\n[${profile.full_name}] profile #${profile.installmentinvoiceprofiles_id} — phase gap detected`
      );

      if (!dryRun) {
        await client.query('BEGIN');
      }

      try {
        const result = await repairProfileTargetPhaseAlignment(client, profile, phaseChains, {
          dryRun,
          droppedAbsolutePhases: dropped,
        });

        for (const row of result.details) {
          console.log(
            `  invoice ${row.invoice_id}: TARGET_PHASE ${row.from_absolute ?? '?'} → ${row.to_absolute} (slot ${row.local_slot})`
          );
        }
        if (result.synced_generated_count != null) {
          console.log(
            `  generated_count → ${result.synced_generated_count} (was ${profile.generated_count})`
          );
        }

        if (!dryRun) {
          await client.query('COMMIT');
        }
        repaired += 1;
      } catch (err) {
        if (!dryRun) {
          await client.query('ROLLBACK');
        }
        console.error(`  FAILED: ${err.message}`);
      }
    }

    console.log(`\nDone. ${repaired} profile(s) ${dryRun ? 'would be' : ''} repaired.`);
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
