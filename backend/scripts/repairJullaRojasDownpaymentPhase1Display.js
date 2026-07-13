/**
 * Julla Santos Rojas (student 590) — downpayment mis-mapped as Phase 1 Paid.
 *
 * Root cause: balanceInvoice creation moved downpayment_invoice_id from chain
 * root INV-1773 to balance INV-1774, so Student History treated the DP chain
 * as Phase 1. INV-1775 was labeled TARGET_PHASE:2 (should be Phase 1 unpaid).
 *
 * After:
 *   - downpayment_invoice_id = 1773 (chain root); downpayment_paid = true
 *   - INV-1775 → TARGET_PHASE:1 (Unpaid first installment)
 *   - generated_count = 1
 *   - Enrollment phase 1 → pending_enrollment (awaiting Phase 1 payment)
 *
 * Run:
 *   node backend/scripts/repairJullaRojasDownpaymentPhase1Display.js
 *   node backend/scripts/repairJullaRojasDownpaymentPhase1Display.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { rewriteTargetPhaseInRemarks } from '../utils/installmentPhaseBillingSync.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { PROGRAM_ENROLLMENT_STATUS } from '../utils/enrollmentStatus.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_ID = 590;
const PROFILE_ID = 462;
const CLASS_ID = 83;
const DP_ROOT_INVOICE_ID = 1773;
const DP_BALANCE_INVOICE_ID = 1774;
const PHASE1_INVOICE_ID = 1775;
const REPAIR_NOTE =
  'Ops repair 2026-07-13 — Julla Rojas DP chain root + Phase 1 unpaid (not DP-as-phase-1)';

const isApply = process.argv.includes('--apply');

async function main() {
  console.log(
    `\nJulla Rojas — DP vs Phase 1 display repair${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );

  const client = await getClient();
  try {
    const student = (
      await client.query(`SELECT user_id, full_name, email FROM userstbl WHERE user_id = $1`, [
        STUDENT_ID,
      ])
    ).rows[0];
    if (!student) throw new Error(`Student ${STUDENT_ID} not found`);
    console.log('Student:', student.full_name, student.email);

    const profile = (
      await client.query(
        `SELECT * FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];
    if (!profile || Number(profile.student_id) !== STUDENT_ID) {
      throw new Error(`Profile ${PROFILE_ID} not found for student`);
    }

    const phase1 = (
      await client.query(
        `SELECT invoice_id, status, remarks, amount FROM invoicestbl WHERE invoice_id = $1`,
        [PHASE1_INVOICE_ID]
      )
    ).rows[0];
    if (!phase1) throw new Error(`INV-${PHASE1_INVOICE_ID} not found`);
    if (String(phase1.status).toLowerCase() === 'paid') {
      throw new Error(
        `INV-${PHASE1_INVOICE_ID} is Paid — refusing to treat as unpaid Phase 1 without review`
      );
    }

    const enroll = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status, removed_at
         FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2 AND phase_number = 1
         ORDER BY classstudent_id DESC LIMIT 1`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows[0];

    const curTp = parseTargetPhase(phase1.remarks);
    const nextRemarks = rewriteTargetPhaseInRemarks(phase1.remarks, 1);

    console.log('\nBefore:');
    console.table([
      {
        downpayment_invoice_id: profile.downpayment_invoice_id,
        downpayment_paid: profile.downpayment_paid,
        generated_count: profile.generated_count,
        inv_1775_status: phase1.status,
        inv_1775_target_phase: curTp,
        enrollment: enroll
          ? `${enroll.program_enrollment_status} (id ${enroll.classstudent_id})`
          : 'none',
      },
    ]);

    console.log('\nPlanned:');
    console.log(`  • Profile ${PROFILE_ID}: downpayment_invoice_id → ${DP_ROOT_INVOICE_ID}`);
    console.log(`  • INV-${PHASE1_INVOICE_ID}: TARGET_PHASE ${curTp ?? '—'} → 1 (stay Unpaid)`);
    console.log(`  • generated_count → 1`);
    console.log(`  • Enrollment phase 1 → pending_enrollment`);
    console.log(`  • DP invoices ${DP_ROOT_INVOICE_ID}/${DP_BALANCE_INVOICE_ID} unchanged (paid DP)`);

    if (!isApply) {
      console.log('\nDry run complete. Re-run with --apply to write changes.');
      return;
    }

    await client.query('BEGIN');

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET downpayment_invoice_id = $1,
           downpayment_paid = true,
           generated_count = 1
       WHERE installmentinvoiceprofiles_id = $2`,
      [DP_ROOT_INVOICE_ID, PROFILE_ID]
    );

    if (nextRemarks !== phase1.remarks) {
      await client.query(`UPDATE invoicestbl SET remarks = $1 WHERE invoice_id = $2`, [
        nextRemarks,
        PHASE1_INVOICE_ID,
      ]);
    }

    if (enroll && !enroll.removed_at) {
      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = $1,
             enrolled_by = COALESCE(enrolled_by, '') || ' | ' || $2
         WHERE classstudent_id = $3`,
        [
          PROGRAM_ENROLLMENT_STATUS.PENDING_ENROLLMENT,
          REPAIR_NOTE,
          enroll.classstudent_id,
        ]
      );
    } else if (!enroll) {
      await client.query(
        `INSERT INTO classstudentstbl
           (student_id, class_id, enrolled_by, phase_number, program_enrollment_status)
         VALUES ($1, $2, $3, 1, $4)`,
        [
          STUDENT_ID,
          CLASS_ID,
          `System (Downpayment paid — awaiting Phase 1 payment) | ${REPAIR_NOTE}`,
          PROGRAM_ENROLLMENT_STATUS.PENDING_ENROLLMENT,
        ]
      );
    }

    await syncProgramPaymentStatusForInvoice(client, PHASE1_INVOICE_ID);
    await client.query('COMMIT');

    const afterProfile = (
      await client.query(
        `SELECT downpayment_invoice_id, downpayment_paid, generated_count
         FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];
    const afterInv = (
      await client.query(
        `SELECT invoice_id, status, remarks FROM invoicestbl WHERE invoice_id = $1`,
        [PHASE1_INVOICE_ID]
      )
    ).rows[0];
    const afterEnroll = (
      await client.query(
        `SELECT classstudent_id, program_enrollment_status
         FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2 AND phase_number = 1 AND removed_at IS NULL
         ORDER BY classstudent_id DESC LIMIT 1`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows[0];

    console.log('\n✅ Applied.');
    console.log('Profile after:', afterProfile);
    console.log('INV-1775 after:', {
      status: afterInv.status,
      target_phase: parseTargetPhase(afterInv.remarks),
    });
    console.log('Enrollment after:', afterEnroll);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error('Repair failed:', err.message || err);
  process.exit(1);
});
