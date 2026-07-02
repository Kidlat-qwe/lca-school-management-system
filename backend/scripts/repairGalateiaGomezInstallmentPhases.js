/**
 * Galateia Luna D. Gomez — revert erroneous phase 2/3 invoices and dropped enrollment.
 *
 * Target:
 *   - Phase 1 only (INV-521 paid) — keep as-is
 *   - Remove erroneous phase 2 invoice INV-658 and phase 3 invoice INV-1107
 *   - Remove erroneous phase 2 dropped enrollment row
 *   - generated_count = 1
 *   - Queue: next_generation_date = 2026-07-25, next_invoice_month = 2026-08-01
 *
 * Run:
 *   node backend/scripts/repairGalateiaGomezInstallmentPhases.js
 *   node backend/scripts/repairGalateiaGomezInstallmentPhases.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { loadInstallmentProfilePhaseChains } from '../lib/installmentPaymentEligibility.js';
import { mapPhaseChainsToLocalSlots } from '../utils/installmentPhaseRowMapping.js';
import { resolveProfilePhaseStart } from '../utils/phaseInstallmentUtils.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_EMAIL = 'noelladecendario@yahoo.com';
const STUDENT_ID = 493;
const PROFILE_ID = 267;
const CLASS_ID = 88;
const PHASE1_INVOICE_ID = 521;
const ORPHAN_INVOICE_IDS = [658, 1107];
const DROPPED_ENROLLMENT_ID = 1384;
const NEXT_GENERATION = '2026-07-25';
const NEXT_INVOICE_MONTH = '2026-08-01';
const SCHEDULED_DATE = '2026-08-05';
const REPAIR_NOTE = 'Ops repair 2026-07-01 — revert erroneous phase 2/3 billing';

const isApply = process.argv.includes('--apply');

async function deleteInvoiceCascade(client, invoiceId) {
  await client.query(`DELETE FROM program_payment_statustbl WHERE invoice_id = $1`, [invoiceId]);
  await client.query(`DELETE FROM invoicestudentstbl WHERE invoice_id = $1`, [invoiceId]);
  await client.query(`DELETE FROM invoiceitemstbl WHERE invoice_id = $1`, [invoiceId]);
  await client.query(`DELETE FROM invoicestbl WHERE invoice_id = $1`, [invoiceId]);
}

async function loadPhaseMapping(client, profile) {
  const { phaseChains } = await loadInstallmentProfilePhaseChains(client, PROFILE_ID);
  const mapped = mapPhaseChainsToLocalSlots(phaseChains, profile);
  const phaseStart = resolveProfilePhaseStart(profile);
  const rows = [];
  for (const [local, chain] of [...mapped.entries()].sort((a, b) => a[0] - b[0])) {
    const rep = chain.representative;
    rows.push({
      display_phase: local + phaseStart - 1,
      invoice_id: rep.invoice_id,
      status: rep.status,
      ar: rep.invoice_ar_number,
      target: parseTargetPhase(rep.remarks),
      issue: rep.issue_date,
      due: rep.due_date,
    });
  }
  return rows;
}

async function main() {
  console.log(
    `\nGalateia Gomez installment repair${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );

  const client = await getClient();
  try {
    const student = (
      await client.query(
        `SELECT user_id, full_name, email FROM userstbl
         WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))`,
        [STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student || Number(student.user_id) !== STUDENT_ID) {
      throw new Error(`Student ${STUDENT_EMAIL} not found`);
    }

    const profile = (
      await client.query(`SELECT * FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`, [
        PROFILE_ID,
      ])
    ).rows[0];
    if (!profile || Number(profile.student_id) !== STUDENT_ID) {
      throw new Error(`Profile ${PROFILE_ID} not found`);
    }
    if (Number(profile.class_id) !== CLASS_ID) {
      throw new Error(`Expected class_id ${CLASS_ID}, got ${profile.class_id}`);
    }

    const queue = (
      await client.query(`SELECT * FROM installmentinvoicestbl WHERE installmentinvoiceprofiles_id = $1`, [
        PROFILE_ID,
      ])
    ).rows[0];

    const dropped = (
      await client.query(`SELECT * FROM classstudentstbl WHERE classstudent_id = $1`, [DROPPED_ENROLLMENT_ID])
    ).rows[0];

    console.log('Student:', student.full_name);
    console.log('Before profile:', {
      generated_count: profile.generated_count,
      downpayment_paid: profile.downpayment_paid,
      is_active: profile.is_active,
    });
    console.log('Before queue:', {
      next_generation_date: queue?.next_generation_date,
      next_invoice_month: queue?.next_invoice_month,
      scheduled_date: queue?.scheduled_date,
    });
    console.log('Before phase mapping:', await loadPhaseMapping(client, profile));
    console.log('Dropped enrollment row:', dropped || 'none');

    for (const invoiceId of ORPHAN_INVOICE_IDS) {
      const inv = (
        await client.query(`SELECT invoice_id, status FROM invoicestbl WHERE invoice_id = $1`, [invoiceId])
      ).rows[0];
      if (!inv) throw new Error(`Invoice ${invoiceId} not found`);
      if (inv.status === 'Paid') {
        throw new Error(`Invoice ${invoiceId} is Paid — aborting`);
      }
      const pay = await client.query(
        `SELECT COUNT(*)::int AS c FROM paymenttbl WHERE invoice_id = $1`,
        [invoiceId]
      );
      if (pay.rows[0].c > 0) {
        throw new Error(`Invoice ${invoiceId} has payments — aborting`);
      }
    }

    const phase1 = (
      await client.query(
        `SELECT invoice_id, status,
                TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue_ymd,
                TO_CHAR(due_date, 'YYYY-MM-DD') AS due_ymd
         FROM invoicestbl WHERE invoice_id = $1`,
        [PHASE1_INVOICE_ID]
      )
    ).rows[0];
    if (!phase1 || phase1.status !== 'Paid') {
      throw new Error(`Phase 1 invoice ${PHASE1_INVOICE_ID} must be Paid`);
    }
    console.log('Phase 1 invoice (unchanged):', phase1);

    console.log('\nPlanned changes:');
    console.log(`  • Delete invoices: ${ORPHAN_INVOICE_IDS.join(', ')}`);
    console.log(`  • generated_count: ${profile.generated_count} → 1`);
    console.log(`  • next_generation_date → ${NEXT_GENERATION}`);
    console.log(`  • next_invoice_month → ${NEXT_INVOICE_MONTH}`);
    console.log(`  • scheduled_date → ${SCHEDULED_DATE}`);
    if (dropped) {
      console.log(`  • DELETE dropped enrollment classstudent_id ${DROPPED_ENROLLMENT_ID} (phase ${dropped.phase_number})`);
    }

    if (!isApply) {
      console.log('\nDRY RUN — re-run with --apply to write.');
      return;
    }

    await client.query('BEGIN');

    for (const invoiceId of ORPHAN_INVOICE_IDS) {
      await deleteInvoiceCascade(client, invoiceId);
      console.log(`✅ Deleted invoice ${invoiceId}`);
    }

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET generated_count = 1,
           is_active = true
       WHERE installmentinvoiceprofiles_id = $1`,
      [PROFILE_ID]
    );

    await client.query(
      `UPDATE installmentinvoicestbl
       SET status = NULL,
           scheduled_date = $1::date,
           next_generation_date = $2::date,
           next_invoice_month = $3::date
       WHERE installmentinvoiceprofiles_id = $4`,
      [SCHEDULED_DATE, NEXT_GENERATION, NEXT_INVOICE_MONTH, PROFILE_ID]
    );

    if (dropped) {
      await client.query(`DELETE FROM classstudentstbl WHERE classstudent_id = $1`, [
        DROPPED_ENROLLMENT_ID,
      ]);
      console.log(`✅ Removed erroneous phase ${dropped.phase_number} dropped enrollment`);
    }

    await syncProgramPaymentStatusForInvoice(client, PHASE1_INVOICE_ID);
    await syncProgramPaymentStatusForInvoice(client, profile.downpayment_invoice_id);

    await client.query('COMMIT');
    console.log('\n✅ Applied successfully.');

    const afterProfile = (
      await client.query(`SELECT * FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`, [
        PROFILE_ID,
      ])
    ).rows[0];
    const afterQueue = (
      await client.query(
        `SELECT TO_CHAR(next_generation_date, 'YYYY-MM-DD') AS next_generation_date,
                TO_CHAR(next_invoice_month, 'YYYY-MM-DD') AS next_invoice_month,
                TO_CHAR(scheduled_date, 'YYYY-MM-DD') AS scheduled_date
         FROM installmentinvoicestbl WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];

    console.log('\nAfter profile:', {
      generated_count: afterProfile.generated_count,
      is_active: afterProfile.is_active,
    });
    console.log('After queue:', afterQueue);
    console.log('After phase mapping:', await loadPhaseMapping(client, afterProfile));

    const enroll = await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status, removed_at
       FROM classstudentstbl WHERE student_id = $1 AND class_id = $2 ORDER BY phase_number`,
      [STUDENT_ID, CLASS_ID]
    );
    console.log('Enrollment:', enroll.rows);
  } catch (error) {
    if (isApply) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
