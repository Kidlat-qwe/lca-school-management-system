/**
 * Aadam June Cawili — align installment to phase_start 2; paids on phases 2–3.
 *
 * Student started at class phase 2. Move paid billing from phases 1–2 → 2–3.
 *
 * Fixes:
 *   - phase_start = 2
 *   - Remap paid: INV 340 → TARGET_PHASE:2, INV 574 → TARGET_PHASE:3
 *   - Remap unpaid: INV 1015 → TARGET_PHASE:4; keep INV 1777 → TARGET_PHASE:5
 *   - Delete duplicate INV 1527 (erroneous phase 4 duplicate)
 *   - Enrollments: phase 2=new, phase 3=re_enrolled; remove phase 1 + dropped rows
 *   - generated_count = 4
 *
 * Run:
 *   node backend/scripts/repairAadamCawiliInstallmentPhases.js
 *   node backend/scripts/repairAadamCawiliInstallmentPhases.js --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';
import { PROGRAM_ENROLLMENT_STATUS } from '../utils/enrollmentStatus.js';
import { rewriteTargetPhaseInRemarks } from '../utils/installmentPhaseBillingSync.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';
import { buildPhaseInstallmentSchedule } from '../utils/phaseInstallmentUtils.js';
import { loadInstallmentProfilePhaseChains } from '../lib/installmentPaymentEligibility.js';
import { mapPhaseChainsToLocalSlots } from '../utils/installmentPhaseRowMapping.js';
import { resolveProfilePhaseStart } from '../utils/phaseInstallmentUtils.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';

const STUDENT_EMAIL = 'may778848@gmail.com';
const STUDENT_ID = 293;
const PROFILE_ID = 142;
const CLASS_ID = 40;
const TARGET_PHASE_START = 2;
const GENERATED_COUNT = 4;

const PAID_INVOICE_TARGET = {
  340: 2,
  574: 3,
};

const UNPAID_INVOICE_TARGET = {
  1015: 4,
  1777: 5,
};

const DELETE_INVOICE_IDS = [1527];
const ENROLLMENT_DELETE_IDS = [1617, 1659]; // dropped phases 3–4

const REPAIR_NOTE = 'Ops repair — Aadam Cawili phase_start 2; paids aligned to phases 2–3';

const isApply = process.argv.includes('--apply');

async function deleteInvoiceCascade(client, invoiceId) {
  await client.query(`DELETE FROM program_payment_statustbl WHERE invoice_id = $1`, [invoiceId]);
  await client.query(`DELETE FROM paymenttbl WHERE invoice_id = $1`, [invoiceId]);
  await client.query(`DELETE FROM promousagetbl WHERE invoice_id = $1`, [invoiceId]);
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
      paid: chain.paid_amount,
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
    `\nAadam Cawili — phase_start 2 repair${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
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

    const enrollments = await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status, removed_at
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2
       ORDER BY phase_number`,
      [STUDENT_ID, CLASS_ID]
    );

    console.log('Before enrollments:', enrollments.rows);
    console.log('Before plan mapping:');
    console.table(await loadPlanMapping(client, profile));
    console.log('Before matrix:');
    console.table(await previewMatrix());

    const schedule = await buildPhaseInstallmentSchedule({
      db: client,
      profile: { ...profile, phase_start: TARGET_PHASE_START },
      generatedCountOverride: GENERATED_COUNT,
    });

    console.log('\nNext billing schedule:');
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
      console.log('  • Remap paid invoices:', PAID_INVOICE_TARGET);
      console.log('  • Remap unpaid invoices:', UNPAID_INVOICE_TARGET);
      console.log('  • Delete duplicate invoice:', DELETE_INVOICE_IDS.join(', '));
      console.log('  • Enrollments: phase 2=new, phase 3=re_enrolled');
      console.log('  • Delete dropped enrollments:', ENROLLMENT_DELETE_IDS.join(', '));
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
      let nextDpRemarks = String(dp.remarks);
      if (/PHASE_START:\d+/i.test(nextDpRemarks)) {
        nextDpRemarks = nextDpRemarks.replace(/PHASE_START:\d+/i, `PHASE_START:${TARGET_PHASE_START}`);
      } else {
        nextDpRemarks = `${nextDpRemarks};PHASE_START:${TARGET_PHASE_START}`;
      }
      await client.query(`UPDATE invoicestbl SET remarks = $1 WHERE invoice_id = $2`, [
        nextDpRemarks,
        profile.downpayment_invoice_id,
      ]);
    }

    for (const [invoiceId, absolutePhase] of Object.entries({
      ...PAID_INVOICE_TARGET,
      ...UNPAID_INVOICE_TARGET,
    })) {
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

    // Phase 1 enrollment → phase 2 new (first enrolled)
    await client.query(
      `UPDATE classstudentstbl
       SET phase_number = $1,
           program_enrollment_status = $2,
           removed_at = NULL,
           removed_reason = NULL,
           removed_by = NULL,
           enrolled_by = COALESCE(enrolled_by, $5)
       WHERE classstudent_id = 530
         AND student_id = $3
         AND class_id = $4`,
      [
        TARGET_PHASE_START,
        PROGRAM_ENROLLMENT_STATUS.NEW,
        STUDENT_ID,
        CLASS_ID,
        REPAIR_NOTE,
      ]
    );

    // Phase 2 enrollment → phase 3 re_enrolled
    await client.query(
      `UPDATE classstudentstbl
       SET phase_number = $1,
           program_enrollment_status = $2,
           removed_at = NULL,
           removed_reason = NULL,
           removed_by = NULL,
           enrolled_by = COALESCE(enrolled_by, $5)
       WHERE classstudent_id = 1269
         AND student_id = $3
         AND class_id = $4`,
      [
        TARGET_PHASE_START + 1,
        PROGRAM_ENROLLMENT_STATUS.RE_ENROLLED,
        STUDENT_ID,
        CLASS_ID,
        REPAIR_NOTE,
      ]
    );

    await client.query(
      `UPDATE installmentinvoicestbl
       SET next_generation_date = $1::date,
           next_invoice_month = $2::date,
           scheduled_date = COALESCE($3::date, scheduled_date)
       WHERE installmentinvoiceprofiles_id = $4`,
      [
        schedule?.current_generation_date || '2026-07-24',
        schedule?.current_invoice_month || '2026-08-01',
        schedule?.current_due_date || '2026-08-05',
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

    const enrollAfter = await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status, removed_at
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2
       ORDER BY phase_number`,
      [STUDENT_ID, CLASS_ID]
    );

    console.log('\n✅ Repair applied.');
    console.log('After enrollments:', enrollAfter.rows);
    console.log('After plan mapping:');
    console.table(await loadPlanMapping(client, profileAfter));
    console.log('After matrix:');
    console.table(await previewMatrix());
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
