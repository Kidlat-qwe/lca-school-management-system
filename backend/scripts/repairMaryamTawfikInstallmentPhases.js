/**
 * Maryam S. Tawfik — align downpayment vs phase payments.
 *
 * Student: salvadormarygracesd@gmail.com (user_id 622)
 * Profile 441 | NC_Pre-Kinder_MWF_9:30AM
 *
 * Current:
 *   - DP chain INV 1452/1453: ₱15,000 paid (shown wrongly as Phase 1 in UI)
 *   - INV 1454 TARGET_PHASE:2 Paid ₱4,236 (should be Phase 1)
 *   - No TARGET_PHASE:1 invoice
 *
 * Target:
 *   - Downpayment stays 1452/1453 (₱15,000)
 *   - INV 1454 → Phase 1 Paid (keep payment 1235)
 *   - New Phase 2 unpaid: issue 2026-06-25, due 2026-07-05, ₱4,236
 *   - generated_count = 2; queue July 25 / August 1
 *   - Phase 1 enrollment active; remove phase 2 enrollment until paid
 *
 * Run:
 *   node backend/scripts/repairMaryamTawfikInstallmentPhases.js
 *   node backend/scripts/repairMaryamTawfikInstallmentPhases.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';
import { insertInvoiceWithArNumber } from '../utils/invoiceArNumber.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';

const STUDENT_EMAIL = 'salvadormarygracesd@gmail.com';
const STUDENT_ID = 622;
const PROFILE_ID = 441;
const CLASS_ID = 128;
const DP_ROOT_ID = 1452;
const DP_LEAF_ID = 1453;
const PHASE1_INVOICE_ID = 1454;
const PHASE1_PAYMENT_ID = 1235;
const PHASE2_ISSUE = '2026-06-25';
const PHASE2_DUE = '2026-07-05';
const PHASE_AMOUNT = 4236;
const QUEUE_GEN = '2026-07-25';
const QUEUE_MONTH = '2026-08-01';
const REPAIR_NOTE =
  'Ops repair 2026-07-04 — Maryam Tawfik DP vs phase 1 payment alignment';

const args = new Set(process.argv.slice(2));
const isApply = args.has('--apply');

async function loadSnapshot(client) {
  const profile = (
    await client.query(
      `SELECT ip.*, ii.installmentinvoicedtl_id,
              TO_CHAR(TIMEZONE('Asia/Manila', ii.next_generation_date), 'YYYY-MM-DD') AS next_gen,
              TO_CHAR(TIMEZONE('Asia/Manila', ii.next_invoice_month), 'YYYY-MM-DD') AS next_month,
              u.full_name, u.email, c.class_name
       FROM installmentinvoiceprofilestbl ip
       INNER JOIN installmentinvoicestbl ii
         ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
       INNER JOIN userstbl u ON u.user_id = ip.student_id
       LEFT JOIN classestbl c ON c.class_id = ip.class_id
       WHERE ip.installmentinvoiceprofiles_id = $1`,
      [PROFILE_ID]
    )
  ).rows[0];

  const invoices = (
    await client.query(
      `SELECT invoice_id, status, invoice_ar_number, amount, remarks,
              invoice_chain_root_id,
              TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue_ymd,
              TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due_ymd
       FROM invoicestbl
       WHERE installmentinvoiceprofiles_id = $1
          OR invoice_id IN ($2, $3)
          OR invoice_chain_root_id = $2
       ORDER BY invoice_id`,
      [PROFILE_ID, DP_ROOT_ID, DP_LEAF_ID]
    )
  ).rows;

  const payments = (
    await client.query(
      `SELECT payment_id, invoice_id, payable_amount, status, approval_status,
              TO_CHAR(issue_date, 'YYYY-MM-DD') AS payment_ymd
       FROM paymenttbl
       WHERE invoice_id = ANY($1::int[])
       ORDER BY payment_id`,
      [invoices.map((i) => i.invoice_id)]
    )
  ).rows;

  const enrollments = (
    await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status, removed_reason
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2
       ORDER BY phase_number`,
      [STUDENT_ID, CLASS_ID]
    )
  ).rows;

  return { profile, invoices, payments, enrollments };
}

async function main() {
  console.log(`\nMaryam Tawfik installment repair${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`);

  const client = await getClient();
  try {
    const before = await loadSnapshot(client);
    if (!before.profile || Number(before.profile.student_id) !== STUDENT_ID) {
      throw new Error(`Profile ${PROFILE_ID} not found for student ${STUDENT_ID}`);
    }
    if (String(before.profile.email).toLowerCase() !== STUDENT_EMAIL) {
      throw new Error(`Email mismatch: expected ${STUDENT_EMAIL}, got ${before.profile.email}`);
    }

    console.log(
      'Student:',
      before.profile.full_name,
      `| Profile ${PROFILE_ID} | ${before.profile.class_name}`
    );
    console.log('Before profile:', {
      generated_count: before.profile.generated_count,
      is_active: before.profile.is_active,
      downpayment_invoice_id: before.profile.downpayment_invoice_id,
      downpayment_paid: before.profile.downpayment_paid,
      next_gen: before.profile.next_gen,
      next_month: before.profile.next_month,
    });
    console.log('Before invoices:');
    for (const inv of before.invoices) {
      const tp = parseTargetPhase(inv.remarks);
      console.log(
        `  INV ${inv.invoice_id} AR ${inv.invoice_ar_number} phase=${tp ?? 'dp'} ${inv.issue_ymd}/${inv.due_ymd} amt=${inv.amount} ${inv.status}`
      );
    }
    console.log('Before payments:', before.payments);
    console.log('Before enrollments:', before.enrollments);

    const phase1Pay = before.payments.find((p) => p.payment_id === PHASE1_PAYMENT_ID);
    if (!phase1Pay || Number(phase1Pay.invoice_id) !== PHASE1_INVOICE_ID) {
      throw new Error(
        `Expected payment ${PHASE1_PAYMENT_ID} on INV ${PHASE1_INVOICE_ID}, got ${JSON.stringify(phase1Pay)}`
      );
    }

    const existingPhase2 = before.invoices.find(
      (inv) => parseTargetPhase(inv.remarks) === 2 && inv.invoice_id !== PHASE1_INVOICE_ID
    );

    console.log('\nPlanned changes:');
    console.log('  - Keep DP chain 1452/1453 as downpayment (₱15,000 already paid)');
    console.log(`  - Retag INV ${PHASE1_INVOICE_ID} → TARGET_PHASE:1 (Paid, payment stays)`);
    console.log(
      existingPhase2
        ? `  - Reset INV ${existingPhase2.invoice_id} as unpaid phase 2 ${PHASE2_ISSUE}/${PHASE2_DUE}`
        : `  - Create unpaid phase 2 ${PHASE2_ISSUE}/${PHASE2_DUE}`
    );
    console.log('  - generated_count=2, queue July 25 / August 1');
    console.log('  - Phase 1 enrollment=new; remove phase 2 enrollment');

    if (!isApply) {
      console.log('\nDRY RUN — no changes written. Re-run with --apply');
      return;
    }

    await client.query('BEGIN');

    // Ensure profile points at DP root and paid flag
    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET downpayment_invoice_id = $1,
           downpayment_paid = true
       WHERE installmentinvoiceprofiles_id = $2`,
      [DP_ROOT_ID, PROFILE_ID]
    );
    console.log(`✅ Profile downpayment_invoice_id=${DP_ROOT_ID}, downpayment_paid=true`);

    // Retag 1454 as Phase 1 (payment already on it)
    const phase1Remarks =
      `Auto-generated from installment invoice: Installment plan for ${before.profile.full_name} - Pre-Kindergarten;TARGET_PHASE:1;${REPAIR_NOTE}`;

    await client.query(
      `UPDATE invoicestbl
       SET remarks = $1,
           status = 'Paid',
           amount = 0,
           late_penalty_applied_for_due_date = NULL
       WHERE invoice_id = $2`,
      [phase1Remarks, PHASE1_INVOICE_ID]
    );
    console.log(`✅ INV ${PHASE1_INVOICE_ID} retagged as Phase 1 Paid`);

    // Phase 2 unpaid
    let phase2InvoiceId = existingPhase2?.invoice_id || null;

    if (phase2InvoiceId) {
      const stray = await client.query(
        `SELECT payment_id FROM paymenttbl WHERE invoice_id = $1`,
        [phase2InvoiceId]
      );
      if (stray.rows.length) {
        throw new Error(`Phase 2 INV ${phase2InvoiceId} has payments; refuse to reset`);
      }
      await client.query(
        `UPDATE invoiceitemstbl
         SET amount = $1, discount_amount = 0, penalty_amount = 0
         WHERE invoice_id = $2`,
        [PHASE_AMOUNT, phase2InvoiceId]
      );
      await client.query(
        `UPDATE invoicestbl
         SET issue_date = $1::date,
             due_date = $2::date,
             amount = $3,
             status = 'Unpaid',
             late_penalty_applied_for_due_date = NULL,
             remarks = $4
         WHERE invoice_id = $5`,
        [
          PHASE2_ISSUE,
          PHASE2_DUE,
          PHASE_AMOUNT,
          `Auto-generated from installment invoice: Installment plan for ${before.profile.full_name} - Pre-Kindergarten;TARGET_PHASE:2;${REPAIR_NOTE}`,
          phase2InvoiceId,
        ]
      );
      console.log(
        `✅ Phase 2 INV ${phase2InvoiceId} unpaid ${PHASE2_ISSUE}/${PHASE2_DUE}`
      );
    } else {
      const template = (
        await client.query(`SELECT * FROM invoicestbl WHERE invoice_id = $1`, [
          PHASE1_INVOICE_ID,
        ])
      ).rows[0];

      const phase2Remarks =
        `Auto-generated from installment invoice: Installment plan for ${before.profile.full_name} - Pre-Kindergarten;TARGET_PHASE:2;${REPAIR_NOTE}`;

      const created = await insertInvoiceWithArNumber(
        client,
        `INSERT INTO invoicestbl (
           invoice_description, branch_id, amount, status, remarks, issue_date, due_date,
           created_by, installmentinvoiceprofiles_id, invoice_ar_number
         ) VALUES ($1, $2, $3, 'Unpaid', $4, $5::date, $6::date, $7, $8, $9)
         RETURNING invoice_id, invoice_ar_number`,
        [
          'TEMP',
          template.branch_id,
          PHASE_AMOUNT,
          phase2Remarks,
          PHASE2_ISSUE,
          PHASE2_DUE,
          template.created_by,
          PROFILE_ID,
        ]
      );
      phase2InvoiceId = created.invoice_id;

      await client.query(
        `UPDATE invoicestbl SET invoice_description = $1 WHERE invoice_id = $2`,
        [`INV-${phase2InvoiceId}`, phase2InvoiceId]
      );

      const templateItem = (
        await client.query(
          `SELECT description, tax_item, tax_percentage
           FROM invoiceitemstbl
           WHERE invoice_id = $1
           ORDER BY invoice_item_id
           LIMIT 1`,
          [PHASE1_INVOICE_ID]
        )
      ).rows[0];

      await client.query(
        `INSERT INTO invoiceitemstbl (
           invoice_id, description, amount, tax_item, tax_percentage,
           discount_amount, penalty_amount
         ) VALUES ($1, $2, $3, $4, $5, 0, 0)`,
        [
          phase2InvoiceId,
          templateItem?.description || 'Installment phase payment',
          PHASE_AMOUNT,
          templateItem?.tax_item ?? null,
          templateItem?.tax_percentage ?? 0,
        ]
      );

      const linkedStudents = await client.query(
        `SELECT student_id FROM invoicestudentstbl WHERE invoice_id = $1`,
        [PHASE1_INVOICE_ID]
      );
      for (const row of linkedStudents.rows) {
        const exists = await client.query(
          `SELECT 1 FROM invoicestudentstbl WHERE invoice_id = $1 AND student_id = $2`,
          [phase2InvoiceId, row.student_id]
        );
        if (!exists.rows.length) {
          await client.query(
            `INSERT INTO invoicestudentstbl (invoice_id, student_id) VALUES ($1, $2)`,
            [phase2InvoiceId, row.student_id]
          );
        }
      }

      console.log(
        `✅ Created Phase 2 INV ${phase2InvoiceId} AR ${created.invoice_ar_number} unpaid ${PHASE2_ISSUE}/${PHASE2_DUE}`
      );
    }

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET generated_count = 2,
           is_active = true,
           downpayment_paid = true,
           downpayment_invoice_id = $1
       WHERE installmentinvoiceprofiles_id = $2`,
      [DP_ROOT_ID, PROFILE_ID]
    );

    await client.query(
      `UPDATE installmentinvoicestbl
       SET status = NULL,
           next_generation_date = $1::date,
           next_invoice_month = $2::date
       WHERE installmentinvoiceprofiles_id = $3`,
      [QUEUE_GEN, QUEUE_MONTH, PROFILE_ID]
    );
    console.log('✅ Profile generated_count=2, queue July 25 / August 1');

    // Phase 1 enrollment active (paid)
    const phase1Enroll = await client.query(
      `SELECT classstudent_id FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2 AND COALESCE(phase_number, 1) = 1`,
      [STUDENT_ID, CLASS_ID]
    );
    if (phase1Enroll.rows.length) {
      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = 'new',
             removed_at = NULL,
             removed_reason = NULL,
             removed_by = NULL,
             enrolled_by = COALESCE(enrolled_by, $1)
         WHERE classstudent_id = $2`,
        [REPAIR_NOTE, phase1Enroll.rows[0].classstudent_id]
      );
    } else {
      await client.query(
        `INSERT INTO classstudentstbl (
           student_id, class_id, enrolled_by, phase_number,
           program_enrollment_status, enrolled_at
         ) VALUES ($1, $2, $3, 1, 'new', CURRENT_TIMESTAMP)`,
        [STUDENT_ID, CLASS_ID, REPAIR_NOTE]
      );
    }
    console.log('✅ Phase 1 enrollment = new');

    // Remove phase 2+ enrollments (phase 2 not paid)
    const removed = await client.query(
      `DELETE FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2 AND COALESCE(phase_number, 1) >= 2
       RETURNING classstudent_id, phase_number`,
      [STUDENT_ID, CLASS_ID]
    );
    for (const row of removed.rows) {
      console.log(`✅ Removed phase ${row.phase_number} enrollment ${row.classstudent_id}`);
    }

    await syncProgramPaymentStatusForInvoice(client, DP_ROOT_ID);
    await syncProgramPaymentStatusForInvoice(client, DP_LEAF_ID);
    await syncProgramPaymentStatusForInvoice(client, PHASE1_INVOICE_ID);
    await syncProgramPaymentStatusForInvoice(client, phase2InvoiceId);

    await client.query('COMMIT');

    const after = await loadSnapshot(client);
    console.log('\n--- AFTER ---');
    console.log('Profile:', {
      generated_count: after.profile.generated_count,
      is_active: after.profile.is_active,
      downpayment_invoice_id: after.profile.downpayment_invoice_id,
      downpayment_paid: after.profile.downpayment_paid,
      next_gen: after.profile.next_gen,
      next_month: after.profile.next_month,
    });
    console.log('Invoices:');
    for (const inv of after.invoices) {
      const tp = parseTargetPhase(inv.remarks);
      console.log(
        `  INV ${inv.invoice_id} AR ${inv.invoice_ar_number} phase=${tp ?? 'dp'} ${inv.issue_ymd}/${inv.due_ymd} amt=${inv.amount} ${inv.status}`
      );
    }
    console.log('Payments:', after.payments);
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
