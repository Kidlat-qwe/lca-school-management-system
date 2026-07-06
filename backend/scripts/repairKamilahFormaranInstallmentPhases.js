/**
 * Kamilah Formaran — fix phase 1 due date + installment queue.
 *
 * Student: krisquiachon@gmail.com
 * Target:
 *   - Phase 1 due 2026-07-05
 *   - Queue: next_generation_date 2026-07-25, next_invoice_month 2026-08-01
 *   - Phase 2 must not be generated yet (generated_count = 1)
 *   - Restore enrollment if dropped for wrong due date
 *
 * Run:
 *   node backend/scripts/repairKamilahFormaranInstallmentPhases.js
 *   node backend/scripts/repairKamilahFormaranInstallmentPhases.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';

const STUDENT_EMAIL = 'krisquiachon@gmail.com';
const PHASE1_DUE = '2026-07-05';
const QUEUE_GEN = '2026-07-25';
const QUEUE_MONTH = '2026-08-01';
const REPAIR_NOTE =
  'Ops repair 2026-07-04 — Kamilah Formaran phase 1 due + installment queue';

const args = new Set(process.argv.slice(2));
const isApply = args.has('--apply');

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

async function loadStudentContext(client) {
  const student = (
    await client.query(
      `SELECT user_id, full_name, email FROM userstbl WHERE email ILIKE $1`,
      [STUDENT_EMAIL]
    )
  ).rows[0];
  if (!student) throw new Error(`Student not found: ${STUDENT_EMAIL}`);

  const profile = (
    await client.query(
      `SELECT ip.*, ii.installmentinvoicedtl_id,
              TO_CHAR(TIMEZONE('Asia/Manila', ii.next_generation_date), 'YYYY-MM-DD') AS next_gen,
              TO_CHAR(TIMEZONE('Asia/Manila', ii.next_invoice_month), 'YYYY-MM-DD') AS next_month,
              ii.status AS ii_status,
              c.class_name
       FROM installmentinvoiceprofilestbl ip
       INNER JOIN installmentinvoicestbl ii
         ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
       LEFT JOIN classestbl c ON c.class_id = ip.class_id
       WHERE ip.student_id = $1
       ORDER BY ip.installmentinvoiceprofiles_id DESC
       LIMIT 1`,
      [student.user_id]
    )
  ).rows[0];
  if (!profile) throw new Error(`No installment profile for ${STUDENT_EMAIL}`);

  const invoices = (
    await client.query(
      `SELECT invoice_id, status, invoice_ar_number, amount,
              TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue_ymd,
              TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due_ymd,
              remarks
       FROM invoicestbl
       WHERE installmentinvoiceprofiles_id = $1
          OR invoice_id = $2
       ORDER BY invoice_id`,
      [profile.installmentinvoiceprofiles_id, profile.downpayment_invoice_id]
    )
  ).rows;

  const enrollments = (
    await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status, removed_reason
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2
       ORDER BY phase_number`,
      [student.user_id, profile.class_id]
    )
  ).rows;

  return { student, profile, invoices, enrollments };
}

async function main() {
  console.log(
    `\nKamilah Formaran installment repair${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );

  const client = await getClient();
  try {
    const before = await loadStudentContext(client);
    const { student, profile, invoices, enrollments } = before;

    console.log(
      'Student:',
      student.full_name,
      `| id ${student.user_id} | Profile ${profile.installmentinvoiceprofiles_id} | ${profile.class_name}`
    );
    console.log('Before profile:', {
      generated_count: profile.generated_count,
      is_active: profile.is_active,
      next_gen: profile.next_gen,
      next_month: profile.next_month,
      ii_status: profile.ii_status,
    });
    console.log('Before invoices:');
    for (const inv of invoices) {
      const tp = parseTargetPhase(inv.remarks);
      console.log(
        `  INV ${inv.invoice_id} AR ${inv.invoice_ar_number} phase=${tp ?? 'dp'} ${inv.issue_ymd} / ${inv.due_ymd} ${inv.status}`
      );
    }
    console.log('Before enrollments:', enrollments);

    const phaseInvoices = invoices.filter((inv) => parseTargetPhase(inv.remarks) != null);
    const phase1 = phaseInvoices.find((inv) => parseTargetPhase(inv.remarks) === 1);
    const prematurePhases = phaseInvoices.filter((inv) => {
      const tp = parseTargetPhase(inv.remarks);
      return tp != null && tp >= 2;
    });

    if (!phase1) throw new Error('Phase 1 invoice not found');

    console.log('\nPlanned changes:');
    console.log(`  - INV ${phase1.invoice_id} due_date: ${phase1.due_ymd} → ${PHASE1_DUE}`);
    for (const inv of prematurePhases) {
      console.log(
        `  - DELETE INV ${inv.invoice_id} (premature phase ${parseTargetPhase(inv.remarks)})`
      );
    }
    console.log(`  - generated_count: ${profile.generated_count} → 1`);
    console.log(`  - is_active: ${profile.is_active} → true`);
    console.log(
      `  - queue: ${profile.next_gen} / ${profile.next_month} → ${QUEUE_GEN} / ${QUEUE_MONTH}`
    );

    const droppedPhase1 = enrollments.filter(
      (e) =>
        Number(e.phase_number) === 1 &&
        String(e.program_enrollment_status) === 'dropped'
    );
    for (const e of droppedPhase1) {
      console.log(
        `  - enrollment ${e.classstudent_id}: dropped → pending_enrollment`
      );
    }

    if (!isApply) {
      console.log('\nDRY RUN — no changes written. Re-run with --apply');
      return;
    }

    await client.query('BEGIN');

    await client.query(
      `UPDATE invoicestbl
       SET due_date = $1::date,
           late_penalty_applied_for_due_date = NULL
       WHERE invoice_id = $2`,
      [PHASE1_DUE, phase1.invoice_id]
    );
    console.log(`✅ Phase 1 INV ${phase1.invoice_id} due_date → ${PHASE1_DUE}`);

    for (const inv of prematurePhases) {
      await deleteInvoiceCascade(client, inv.invoice_id);
      console.log(
        `✅ Deleted premature phase ${parseTargetPhase(inv.remarks)} INV ${inv.invoice_id}`
      );
    }

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET generated_count = 1,
           is_active = true
       WHERE installmentinvoiceprofiles_id = $1`,
      [profile.installmentinvoiceprofiles_id]
    );
    console.log('✅ Profile: generated_count=1, is_active=true');

    await client.query(
      `UPDATE installmentinvoicestbl
       SET status = NULL,
           next_generation_date = $1::date,
           next_invoice_month = $2::date
       WHERE installmentinvoiceprofiles_id = $3`,
      [QUEUE_GEN, QUEUE_MONTH, profile.installmentinvoiceprofiles_id]
    );
    console.log(`✅ Queue: next_generation_date=${QUEUE_GEN}, next_invoice_month=${QUEUE_MONTH}`);

    for (const e of droppedPhase1) {
      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = 'pending_enrollment',
             removed_at = NULL,
             removed_reason = NULL,
             removed_by = NULL,
             enrolled_by = COALESCE(enrolled_by, $1),
             enrolled_at = COALESCE(enrolled_at, CURRENT_TIMESTAMP)
         WHERE classstudent_id = $2`,
        [REPAIR_NOTE, e.classstudent_id]
      );
      console.log(`✅ Enrollment ${e.classstudent_id} → pending_enrollment`);
    }

    await syncProgramPaymentStatusForInvoice(client, phase1.invoice_id);

    await client.query('COMMIT');

    const after = await loadStudentContext(client);
    console.log('\n--- AFTER ---');
    console.log('Profile:', {
      generated_count: after.profile.generated_count,
      is_active: after.profile.is_active,
      next_gen: after.profile.next_gen,
      next_month: after.profile.next_month,
      ii_status: after.profile.ii_status,
    });
    console.log('Invoices:');
    for (const inv of after.invoices) {
      const tp = parseTargetPhase(inv.remarks);
      console.log(
        `  INV ${inv.invoice_id} AR ${inv.invoice_ar_number} phase=${tp ?? 'dp'} ${inv.issue_ymd} / ${inv.due_ymd} ${inv.status}`
      );
    }
    console.log('Enrollments:', after.enrollments);
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
