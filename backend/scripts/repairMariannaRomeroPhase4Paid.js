/**
 * Marianna Agatha Romero — phase 4 = new + paid; phase 5 not yet paid.
 *
 * The installment payment (formerly on INV-1354 / TARGET_PHASE:5) belongs on
 * phase 4 as the student's first enrolled phase. Phase 5 remains unbilled.
 *
 * Fixes:
 *   - Delete duplicate unpaid INV-1349 (erroneous phase-4 slot)
 *   - Remap paid INV-1354 → TARGET_PHASE:4
 *   - Restore payment 1147 on INV-1354 (removed by prior mistaken repair)
 *   - Phase 4 enrollment → new (active)
 *   - Remove phase 5 enrollment rows
 *   - generated_count = 1; queue aligned to phase 5 generation
 *
 * Run:
 *   node backend/scripts/repairMariannaRomeroPhase4Paid.js
 *   node backend/scripts/repairMariannaRomeroPhase4Paid.js --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';
import { PROGRAM_ENROLLMENT_STATUS } from '../utils/enrollmentStatus.js';
import { rewriteTargetPhaseInRemarks } from '../utils/installmentPhaseBillingSync.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';
import { syncInstallmentEnrollmentForPaidInvoice } from '../utils/installmentEnrollmentSync.js';
import { deriveInvoiceStatusForInvoice } from '../utils/invoicePaymentStatus.js';
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
const ABSOLUTE_PHASE_PAID = 4;
const GENERATED_COUNT = 1;

const DELETE_INVOICE_ID = 1349;
const PAID_INVOICE_ID = 1354;
const RESTORE_PAYMENT_ID = 1147;
const RESTORE_PAYMENT_AMOUNT = 5146.0;
const RESTORE_PAYMENT_ISSUE_DATE = '2026-06-08';

const REPAIR_NOTE = 'Ops repair — Marianna Romero phase 4=new+paid; phase 5 not yet billed';

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

async function restorePaymentOnInvoice(client) {
  const existing = await client.query(`SELECT payment_id FROM paymenttbl WHERE payment_id = $1`, [
    RESTORE_PAYMENT_ID,
  ]);
  if (existing.rows.length > 0) {
    return existing.rows[0].payment_id;
  }

  const inv = (
    await client.query(`SELECT amount, branch_id FROM invoicestbl WHERE invoice_id = $1`, [
      PAID_INVOICE_ID,
    ])
  ).rows[0];

  const insert = await client.query(
    `INSERT INTO paymenttbl (
       payment_id, invoice_id, student_id, branch_id, payment_method, payment_type,
       payable_amount, discount_amount, tip_amount, issue_date, status, reference_number,
       remarks, created_by, approval_status, approved_by, approved_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, 0, 0, $8::date, $9, $10,
       $11, $12, $13, $14, CURRENT_TIMESTAMP
     )
     RETURNING payment_id`,
    [
      RESTORE_PAYMENT_ID,
      PAID_INVOICE_ID,
      STUDENT_ID,
      inv?.branch_id ?? 5,
      'Cash',
      'Full Payment',
      RESTORE_PAYMENT_AMOUNT,
      RESTORE_PAYMENT_ISSUE_DATE,
      'Completed',
      'REPAIR-1147',
      REPAIR_NOTE,
      6,
      'Approved',
      519,
    ]
  );
  return insert.rows[0]?.payment_id;
}

async function main() {
  console.log(
    `\nMarianna Romero — phase 4 paid / phase 5 unbilled repair${
      isApply ? ' (APPLY)' : ' (DRY RUN)'
    }\n`
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

    console.log('Current enrollments:', enrollments.rows);
    console.log('Before plan mapping:');
    console.table(await loadPlanMapping(client, profile));
    console.log('Before matrix:');
    console.table(await previewMatrix());

    const schedule = await buildPhaseInstallmentSchedule({
      db: client,
      profile: { ...profile, phase_start: TARGET_PHASE_START, generated_count: GENERATED_COUNT },
      generatedCountOverride: GENERATED_COUNT,
    });

    console.log('\nQueue after repair (next = phase 5):');
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
      console.log(`  • Delete duplicate unpaid INV-${DELETE_INVOICE_ID}`);
      console.log(`  • Remap INV-${PAID_INVOICE_ID} → TARGET_PHASE:${ABSOLUTE_PHASE_PAID}`);
      console.log(`  • Restore payment ${RESTORE_PAYMENT_ID} on INV-${PAID_INVOICE_ID}`);
      console.log(`  • Phase 4 enrollment → new (active)`);
      console.log('  • Remove phase 5 enrollment rows');
      console.log(`  • generated_count → ${GENERATED_COUNT}`);
      console.log('\nRe-run with --apply to execute.');
      return;
    }

    await client.query('BEGIN');

    await deleteInvoiceCascade(client, DELETE_INVOICE_ID);

    const paidInv = (
      await client.query(`SELECT remarks, amount FROM invoicestbl WHERE invoice_id = $1`, [
        PAID_INVOICE_ID,
      ])
    ).rows[0];
    const nextRemarks = rewriteTargetPhaseInRemarks(paidInv?.remarks, ABSOLUTE_PHASE_PAID);
    await client.query(`UPDATE invoicestbl SET remarks = $1 WHERE invoice_id = $2`, [
      nextRemarks,
      PAID_INVOICE_ID,
    ]);

    await restorePaymentOnInvoice(client);

    const invAmount = Number(paidInv?.amount || RESTORE_PAYMENT_AMOUNT);
    const nextStatus = await deriveInvoiceStatusForInvoice(client, PAID_INVOICE_ID, {
      totalSettled: RESTORE_PAYMENT_AMOUNT,
      originalInvoiceAmount: invAmount,
      previousStatus: 'Unpaid',
    });
    await client.query(
      `UPDATE invoicestbl
       SET status = $1,
           late_penalty_applied_for_due_date = NULL
       WHERE invoice_id = $2`,
      [nextStatus, PAID_INVOICE_ID]
    );

    await syncProgramPaymentStatusForInvoice(client, PAID_INVOICE_ID);

    await client.query(
      `DELETE FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2 AND phase_number = 5`,
      [STUDENT_ID, CLASS_ID]
    );

    const phase4 = await client.query(
      `SELECT classstudent_id FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2 AND phase_number = $3
       ORDER BY classstudent_id DESC LIMIT 1`,
      [STUDENT_ID, CLASS_ID, ABSOLUTE_PHASE_PAID]
    );

    if (phase4.rows.length > 0) {
      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = $1,
             removed_at = NULL,
             removed_reason = NULL,
             removed_by = NULL,
             enrolled_by = COALESCE(enrolled_by, $4),
             enrolled_at = COALESCE(enrolled_at, $5::timestamptz)
         WHERE classstudent_id = $2
           AND student_id = $3
           AND class_id = $6`,
        [
          PROGRAM_ENROLLMENT_STATUS.NEW,
          phase4.rows[0].classstudent_id,
          STUDENT_ID,
          REPAIR_NOTE,
          `${RESTORE_PAYMENT_ISSUE_DATE}T00:00:00+08:00`,
          CLASS_ID,
        ]
      );
    } else {
      await client.query(
        `INSERT INTO classstudentstbl (
           student_id, class_id, phase_number, program_enrollment_status, enrolled_by, enrolled_at
         ) VALUES ($1, $2, $3, $4, $5, $6::timestamptz)`,
        [
          STUDENT_ID,
          CLASS_ID,
          ABSOLUTE_PHASE_PAID,
          PROGRAM_ENROLLMENT_STATUS.NEW,
          REPAIR_NOTE,
          `${RESTORE_PAYMENT_ISSUE_DATE}T00:00:00+08:00`,
        ]
      );
    }

    const profileAfterRemarks = (
      await client.query(
        `SELECT * FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];

    const paidInvoiceRow = (
      await client.query(`SELECT * FROM invoicestbl WHERE invoice_id = $1`, [PAID_INVOICE_ID])
    ).rows[0];

    await syncInstallmentEnrollmentForPaidInvoice({
      client,
      profileId: PROFILE_ID,
      profile: profileAfterRemarks,
      studentId: STUDENT_ID,
      sourceLabel: REPAIR_NOTE,
      invoice: paidInvoiceRow,
    });

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET phase_start = $1,
           generated_count = $2,
           is_active = true
       WHERE installmentinvoiceprofiles_id = $3`,
      [TARGET_PHASE_START, GENERATED_COUNT, PROFILE_ID]
    );

    await client.query(
      `UPDATE installmentinvoicestbl
       SET next_generation_date = $1::date,
           next_invoice_month = $2::date,
           scheduled_date = COALESCE($3::date, scheduled_date)
       WHERE installmentinvoiceprofiles_id = $4`,
      [
        schedule?.current_generation_date || '2026-06-24',
        schedule?.current_invoice_month || '2026-07-01',
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

    const enrollAfter = await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status, removed_at
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2
       ORDER BY phase_number`,
      [STUDENT_ID, CLASS_ID]
    );

    console.log('\n✅ Repair applied.');
    console.log('Enrollments:', enrollAfter.rows);
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
