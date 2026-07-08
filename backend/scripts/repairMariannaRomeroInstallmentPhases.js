/**
 * Marianna Agatha Romero — align installment to phase_start 4 (plan begins at class phase 4).
 *
 * Fixes:
 *   - Remove erroneous phases 1–3 invoices and enrollment rows
 *   - Keep billing on absolute phases 4–6 (1 paid at phase 5 rejoin)
 *   - Profile phase_start=4, generated_count=3, queue dates for phase 7
 *
 * Run:
 *   node backend/scripts/repairMariannaRomeroInstallmentPhases.js
 *   node backend/scripts/repairMariannaRomeroInstallmentPhases.js --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';
import { rewriteTargetPhaseInRemarks } from '../utils/installmentPhaseBillingSync.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';
import { buildPhaseInstallmentSchedule } from '../utils/phaseInstallmentUtils.js';
import { loadInstallmentProfilePhaseChains } from '../lib/installmentPaymentEligibility.js';
import { mapPhaseChainsToLocalSlots } from '../utils/installmentPhaseRowMapping.js';
import { resolveProfilePhaseStart } from '../utils/phaseInstallmentUtils.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';

const STUDENT_EMAIL = 'amgromero1987@gmail.com';
const STUDENT_ID = 560;
const PROFILE_ID = 400;
const CLASS_ID = 56;
const TARGET_PHASE_START = 4;
const GENERATED_COUNT = 3;

const DELETE_INVOICE_IDS = [1278, 1312, 1333];
const ENROLLMENT_DELETE_IDS = [1093, 1206, 1207];

const KEEP_INVOICES = {
  1349: 4,
  1354: 5,
  1735: 6,
};

const REPAIR_NOTE = 'Ops repair — Marianna Romero phase_start 4; plan slots 4–6';

const isApply = process.argv.includes('--apply');

async function deleteInvoiceCascade(client, invoiceId) {
  await client.query(`DELETE FROM program_payment_statustbl WHERE invoice_id = $1`, [invoiceId]);
  await client.query(`DELETE FROM invoicestudentstbl WHERE invoice_id = $1`, [invoiceId]);
  await client.query(`DELETE FROM invoiceitemstbl WHERE invoice_id = $1`, [invoiceId]);
  await client.query(`DELETE FROM invoicestbl WHERE invoice_id = $1`, [invoiceId]);
}

async function loadPlanMapping(client, profile) {
  const { phaseChains } = await loadInstallmentProfilePhaseChains(client, PROFILE_ID);
  const mapped = mapPhaseChainsToLocalSlots(phaseChains, profile);
  const phaseStart = resolveProfilePhaseStart(profile);
  const rows = [];
  for (const [local, chain] of [...mapped.entries()].sort((a, b) => a[0] - b[0])) {
    const rep = chain.representative;
    rows.push({
      local_slot: local,
      display_phase: local + phaseStart - 1,
      invoice_id: rep.invoice_id,
      status: rep.status,
      ar: rep.invoice_ar_number,
      target_phase: parseTargetPhase(rep.remarks),
    });
  }
  return rows;
}

async function previewMatrix() {
  const matrix = await loadStudentMonthEnrollmentMatrix(query, { year: 2026 });
  const track = matrix.students.find(
    (s) => s.student_id === STUDENT_ID && s.class_id === CLASS_ID
  );
  if (!track) return [];
  return Object.entries(track.months || {})
    .filter(
      ([, c]) =>
        c?.mark === '1' || c?.mark === '✓' || c?.mark === 'X' || c?.status === 'dropped'
    )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, c]) => ({
      month,
      label: c.label,
      phase: c.phase_number,
    }));
}

async function main() {
  console.log(
    `\nMarianna Romero — installment phase_start 4 repair${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );

  const client = await getClient();
  try {
    const profile = (
      await client.query(
        `SELECT * FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];
    if (!profile || Number(profile.student_id) !== STUDENT_ID) {
      throw new Error(`Profile ${PROFILE_ID} not found`);
    }

    console.log('Before plan mapping:');
    console.table(await loadPlanMapping(client, profile));
    console.log('Before matrix:');
    console.table(await previewMatrix());

    const schedule = await buildPhaseInstallmentSchedule({
      db: client,
      profile: { ...profile, phase_start: TARGET_PHASE_START },
      generatedCountOverride: GENERATED_COUNT,
    });

    console.log('\nNext billing (phase 7) schedule:');
    console.table([
      {
        current_phase: schedule?.current_phase_number,
        current_gen: schedule?.current_generation_date,
        current_month: schedule?.current_invoice_month,
        current_due: schedule?.current_due_date,
        next_phase: schedule?.next_phase_number,
        next_gen: schedule?.next_generation_date,
      },
    ]);

    if (!isApply) {
      console.log('\nPlanned changes:');
      console.log(`  • phase_start → ${TARGET_PHASE_START}`);
      console.log(`  • generated_count → ${GENERATED_COUNT}`);
      console.log('  • Delete pre-plan invoices:', DELETE_INVOICE_IDS.join(', '));
      console.log('  • Delete enrollments phases 1–3:', ENROLLMENT_DELETE_IDS.join(', '));
      console.log('  • Keep invoices on absolute phases 4–6');
      console.log('\nRe-run with --apply to execute.');
      return;
    }

    await client.query('BEGIN');

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET phase_start = $1,
           generated_count = $2,
           is_active = true
       WHERE installmentinvoiceprofiles_id = $3`,
      [TARGET_PHASE_START, GENERATED_COUNT, PROFILE_ID]
    );

    const dp = (
      await client.query(`SELECT remarks FROM invoicestbl WHERE invoice_id = $1`, [
        profile.downpayment_invoice_id,
      ])
    ).rows[0];
    if (dp?.remarks) {
      const nextDpRemarks = String(dp.remarks).replace(
        /PHASE_START:\d+/i,
        `PHASE_START:${TARGET_PHASE_START}`
      );
      await client.query(`UPDATE invoicestbl SET remarks = $1 WHERE invoice_id = $2`, [
        nextDpRemarks,
        profile.downpayment_invoice_id,
      ]);
    }

    for (const [invoiceId, absolutePhase] of Object.entries(KEEP_INVOICES)) {
      const inv = (
        await client.query(`SELECT remarks FROM invoicestbl WHERE invoice_id = $1`, [invoiceId])
      ).rows[0];
      const nextRemarks = rewriteTargetPhaseInRemarks(inv?.remarks, absolutePhase);
      await client.query(`UPDATE invoicestbl SET remarks = $1 WHERE invoice_id = $2`, [
        nextRemarks,
        invoiceId,
      ]);
      await syncProgramPaymentStatusForInvoice(client, Number(invoiceId));
    }

    for (const invoiceId of DELETE_INVOICE_IDS) {
      await deleteInvoiceCascade(client, invoiceId);
    }

    for (const id of ENROLLMENT_DELETE_IDS) {
      await client.query(`DELETE FROM classstudentstbl WHERE classstudent_id = $1`, [id]);
    }

    await client.query(
      `UPDATE installmentinvoicestbl
       SET next_generation_date = $1::date,
           next_invoice_month = $2::date,
           scheduled_date = COALESCE($3::date, scheduled_date)
       WHERE installmentinvoiceprofiles_id = $4`,
      [
        schedule?.current_generation_date || '2026-07-24',
        schedule?.current_invoice_month || '2026-08-01',
        schedule?.current_due_date || '2026-07-05',
        PROFILE_ID,
      ]
    );

    await client.query('COMMIT');

    const profileAfter = (
      await client.query(
        `SELECT * FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];

    console.log('\n✅ Repair applied.');
    console.log('After plan mapping:');
    console.table(await loadPlanMapping(client, profileAfter));
    console.log('After matrix:');
    console.table(await previewMatrix());

    const queue = await client.query(
      `SELECT next_generation_date, next_invoice_month FROM installmentinvoicestbl
       WHERE installmentinvoiceprofiles_id = $1`,
      [PROFILE_ID]
    );
    console.log('Queue row:', queue.rows[0]);
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
    console.error(err);
    process.exit(1);
  });
