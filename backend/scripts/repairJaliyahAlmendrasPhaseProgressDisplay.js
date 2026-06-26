/**
 * Jaliyah Callie Almendras — align Installment Invoice Logs phase progress with
 * Kirsten Mahinay (same class 47): show 5 / 10 not 5 / 11.
 *
 * Cause: phase_start = 2 adds +1 to numerator and denominator in list API
 * (total_phases + phase_start - 1). Kirsten uses phase_start NULL (late-start).
 *
 * Fix (--apply):
 *   - phase_start → NULL
 *   - generated_count → 5 when phase 5 invoice exists (INV-1525)
 *
 * Run:
 *   node backend/scripts/repairJaliyahAlmendrasPhaseProgressDisplay.js
 *   node backend/scripts/repairJaliyahAlmendrasPhaseProgressDisplay.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { buildPhaseInstallmentSchedule } from '../utils/phaseInstallmentUtils.js';
import { coerceToManilaYmd } from '../utils/dateUtils.js';

const STUDENT_EMAIL = 'rinadeleon713@gmail.com';
const PROFILE_ID = 150;
const STUDENT_ID = 353;
const PHASE5_INVOICE_ID = 1525;

const isApply = process.argv.includes('--apply');

function calcDisplay(phaseStart, totalPhases, generatedCount) {
  const ps = phaseStart != null ? parseInt(phaseStart, 10) : 1;
  const offset = Math.max(0, ps - 1);
  const total = parseInt(totalPhases, 10);
  const gen = parseInt(generatedCount, 10);
  return { numerator: gen + offset, denominator: total + offset };
}

async function main() {
  console.log(
    `\nJaliyah — phase progress display repair${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );

  const client = await getClient();
  try {
    const profile = (
      await client.query(
        `SELECT ip.*, u.full_name
         FROM installmentinvoiceprofilestbl ip
         JOIN userstbl u ON u.user_id = ip.student_id
         WHERE ip.installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];

    if (!profile || Number(profile.student_id) !== STUDENT_ID) {
      throw new Error(`Profile ${PROFILE_ID} not found`);
    }

    const phase5 = (
      await client.query(`SELECT invoice_id FROM invoicestbl WHERE invoice_id = $1`, [
        PHASE5_INVOICE_ID,
      ])
    ).rows[0];

    const targetGeneratedCount = phase5 ? 5 : parseInt(profile.generated_count || 0, 10);

    console.log('Before:', {
      student: profile.full_name,
      phase_start: profile.phase_start,
      total_phases: profile.total_phases,
      generated_count: profile.generated_count,
      logs_display: calcDisplay(
        profile.phase_start,
        profile.total_phases,
        profile.generated_count
      ),
    });

    console.log('Target (match Kirsten):', {
      phase_start: null,
      generated_count: targetGeneratedCount,
      logs_display: calcDisplay(null, profile.total_phases, targetGeneratedCount),
    });

    const schedAfter = await buildPhaseInstallmentSchedule({
      db: client,
      profile: {
        installmentinvoiceprofiles_id: profile.installmentinvoiceprofiles_id,
        class_id: profile.class_id,
        phase_start: null,
        total_phases: profile.total_phases,
        generated_count: targetGeneratedCount,
      },
      generatedCountOverride: targetGeneratedCount,
    });

    console.log('Schedule after fix:', {
      billing_phase: schedAfter.current_phase_number,
      next_gen: schedAfter.current_generation_date,
      next_month: schedAfter.current_invoice_month,
    });

    if (!isApply) {
      console.log('\nRe-run with --apply to write phase_start NULL and sync generated_count.');
      return;
    }

    await client.query('BEGIN');
    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET phase_start = NULL, generated_count = $1
       WHERE installmentinvoiceprofiles_id = $2`,
      [targetGeneratedCount, PROFILE_ID]
    );
    await client.query('COMMIT');

    const after = (
      await client.query(`SELECT phase_start, total_phases, generated_count FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`, [
        PROFILE_ID,
      ])
    ).rows[0];

    const ii = (
      await client.query(`SELECT next_generation_date, next_invoice_month FROM installmentinvoicestbl WHERE installmentinvoiceprofiles_id = $1`, [
        PROFILE_ID,
      ])
    ).rows[0];

    console.log('\nAfter:', {
      phase_start: after.phase_start,
      generated_count: after.generated_count,
      logs_display: calcDisplay(after.phase_start, after.total_phases, after.generated_count),
      queue_gen: coerceToManilaYmd(ii?.next_generation_date),
      queue_month: coerceToManilaYmd(ii?.next_invoice_month),
    });

    console.log('\n✅ Refresh Installment Invoice Logs — expect 5 / 10 like Kirsten.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
