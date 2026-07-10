/**
 * Kiev Zion Z. Serrano — remove premature phase 2+ after class start June → July.
 *
 * Profile 384 | Phase 1 INV 1213 Paid stays.
 * Delete unpaid phase 2 INV 1509 and phase 3 INV 1795.
 * generated_count → 1; queue July 25 / August 1.
 * Restore phase 2 delinquency drop (classstudent 1656) since phase 1 is paid.
 *
 * Run:
 *   node backend/scripts/repairKievZionSerranoInstallmentJulyShift.js
 *   node backend/scripts/repairKievZionSerranoInstallmentJulyShift.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_EMAIL = 'juliepearlserrano01@gmail.com';
const STUDENT_ID = 581;
const PROFILE_ID = 384;
const PHASE1_INVOICE_ID = 1213;
const PHASE2_CLASSSTUDENT_ID = 1656;
const QUEUE_GEN = '2026-07-25';
const QUEUE_MONTH = '2026-08-01';
const REPAIR_NOTE = 'Ops repair — class start June→July; remove premature phase 2+ invoices';

const isApply = process.argv.includes('--apply');

async function deleteInvoiceCascade(client, invoiceId) {
  const payments = await client.query(
    `SELECT payment_id FROM paymenttbl WHERE invoice_id = $1`,
    [invoiceId]
  );
  if (payments.rows.length) {
    throw new Error(
      `Invoice ${invoiceId} has ${payments.rows.length} payment(s); refuse to delete`
    );
  }
  await client.query(`DELETE FROM program_payment_statustbl WHERE invoice_id = $1`, [invoiceId]);
  await client.query(`DELETE FROM invoicestudentstbl WHERE invoice_id = $1`, [invoiceId]);
  await client.query(`DELETE FROM invoiceitemstbl WHERE invoice_id = $1`, [invoiceId]);
  await client.query(
    `UPDATE invoicestbl SET balance_invoice_id = NULL WHERE balance_invoice_id = $1`,
    [invoiceId]
  );
  await client.query(`DELETE FROM invoicestbl WHERE invoice_id = $1`, [invoiceId]);
}

async function loadSnapshot(client) {
  const profile = (
    await client.query(
      `SELECT ip.installmentinvoiceprofiles_id, ip.student_id, ip.generated_count, ip.is_active,
              TO_CHAR(TIMEZONE('Asia/Manila', ii.next_generation_date), 'YYYY-MM-DD') AS next_gen,
              TO_CHAR(TIMEZONE('Asia/Manila', ii.next_invoice_month), 'YYYY-MM-DD') AS next_month,
              u.full_name, u.email
       FROM installmentinvoiceprofilestbl ip
       INNER JOIN installmentinvoicestbl ii
         ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
       INNER JOIN userstbl u ON u.user_id = ip.student_id
       WHERE ip.installmentinvoiceprofiles_id = $1
         AND COALESCE(ii.status, '') != 'Generated'`,
      [PROFILE_ID]
    )
  ).rows[0];

  const invoices = (
    await client.query(
      `SELECT invoice_id, status, invoice_ar_number, amount, remarks,
              TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue_ymd,
              TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due_ymd
       FROM invoicestbl
       WHERE installmentinvoiceprofiles_id = $1
       ORDER BY invoice_id`,
      [PROFILE_ID]
    )
  ).rows;

  const phase2Enrollment = (
    await client.query(
      `SELECT classstudent_id, program_enrollment_status, removed_reason
       FROM classstudentstbl WHERE classstudent_id = $1`,
      [PHASE2_CLASSSTUDENT_ID]
    )
  ).rows[0];

  return { profile, invoices, phase2Enrollment };
}

async function main() {
  console.log(
    `\nKiev Zion Serrano — July shift installment repair${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );

  const client = await getClient();
  try {
    const before = await loadSnapshot(client);
    if (!before.profile || Number(before.profile.student_id) !== STUDENT_ID) {
      throw new Error(`Profile ${PROFILE_ID} not found`);
    }
    if (String(before.profile.email).toLowerCase() !== STUDENT_EMAIL) {
      throw new Error(`Email mismatch: ${before.profile.email}`);
    }

    console.log('Student:', before.profile.full_name);
    console.log('Before profile:', {
      generated_count: before.profile.generated_count,
      next_gen: before.profile.next_gen,
      next_month: before.profile.next_month,
    });
    console.log('Before invoices:');
    for (const inv of before.invoices) {
      const tp = parseTargetPhase(inv.remarks);
      console.log(
        `  INV ${inv.invoice_id} (${inv.invoice_ar_number}) phase=${tp ?? 'dp'} ${inv.issue_ymd}/${inv.due_ymd} ${inv.status}`
      );
    }
    console.log('Phase 2 enrollment:', before.phase2Enrollment);

    const phase2PlusInvoices = before.invoices.filter((inv) => {
      const phase = parseTargetPhase(inv.remarks);
      return phase != null && phase >= 2 && inv.status !== 'Paid' && inv.status !== 'Partially Paid';
    });

    console.log('\nPlanned:');
    for (const inv of phase2PlusInvoices) {
      console.log(`  - DELETE INV ${inv.invoice_id} (phase ${parseTargetPhase(inv.remarks)})`);
    }
    console.log('  - generated_count → 1');
    console.log(`  - queue → ${QUEUE_GEN} / ${QUEUE_MONTH}`);
    if (
      before.phase2Enrollment?.program_enrollment_status === 'dropped' &&
      String(before.phase2Enrollment.removed_reason || '').toLowerCase().includes('delinquency')
    ) {
      console.log(`  - RESTORE classstudent ${PHASE2_CLASSSTUDENT_ID} → new (clear delinquency drop)`);
    }

    if (!isApply) {
      console.log('\nDRY RUN — re-run with --apply');
      return;
    }

    await client.query('BEGIN');

    for (const inv of phase2PlusInvoices) {
      await deleteInvoiceCascade(client, inv.invoice_id);
      console.log(`✅ Deleted INV ${inv.invoice_id}`);
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
           next_generation_date = $1::date,
           next_invoice_month = $2::date
       WHERE installmentinvoiceprofiles_id = $3
         AND COALESCE(status, '') != 'Generated'`,
      [QUEUE_GEN, QUEUE_MONTH, PROFILE_ID]
    );
    console.log('✅ Profile generated_count=1, queue July 25 / August 1');

    if (
      before.phase2Enrollment?.program_enrollment_status === 'dropped' &&
      String(before.phase2Enrollment.removed_reason || '').toLowerCase().includes('delinquency')
    ) {
      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = 'new',
             removed_at = NULL,
             removed_reason = NULL,
             removed_by = NULL
         WHERE classstudent_id = $1`,
        [PHASE2_CLASSSTUDENT_ID]
      );
      console.log(`✅ Restored enrollment classstudent ${PHASE2_CLASSSTUDENT_ID}`);
    }

    await syncProgramPaymentStatusForInvoice(client, PHASE1_INVOICE_ID);

    await client.query('COMMIT');

    const after = await loadSnapshot(client);
    console.log('\n--- AFTER ---');
    console.log('Profile:', {
      generated_count: after.profile.generated_count,
      next_gen: after.profile.next_gen,
      next_month: after.profile.next_month,
    });
    for (const inv of after.invoices) {
      const tp = parseTargetPhase(inv.remarks);
      console.log(
        `  INV ${inv.invoice_id} phase=${tp ?? 'dp'} ${inv.issue_ymd}/${inv.due_ymd} ${inv.status}`
      );
    }
    console.log('Phase 2 enrollment:', after.phase2Enrollment);
    console.log('\n✅ Applied successfully.');
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
