/**
 * Jacob Lewis Ramirez Datingaling — move paid installment to phase 1.
 *
 * Student: mitchrd8@yahoo.com (user_id 555)
 * Profile 349 | NC_Pre-Kinder_MWF_9:30AM
 *
 * Target:
 *   - Phase 1 INV 972: keep issue/due 2026-06-02, mark Paid (move payment 1167)
 *   - Phase 2 INV 977: unpaid, issue 2026-06-25, due 2026-07-05, amount 4236
 *   - Phase 3 INV 993: delete (not generated yet)
 *   - generated_count = 2; queue July 25 / August 1; profile active
 *   - Phase 1 enrollment restored (paid); phase 2 enrollment cleared until paid
 *
 * Run:
 *   node backend/scripts/repairJacobDatingalingInstallmentPhases.js
 *   node backend/scripts/repairJacobDatingalingInstallmentPhases.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';
import { deriveInvoiceStatusForInvoice } from '../utils/invoicePaymentStatus.js';

const STUDENT_EMAIL = 'mitchrd8@yahoo.com';
const STUDENT_ID = 555;
const PROFILE_ID = 349;
const CLASS_ID = 128;
const PHASE1_INVOICE_ID = 972;
const PHASE2_INVOICE_ID = 977;
const PHASE3_INVOICE_ID = 993;
const PAYMENT_ID = 1167;
const PHASE1_ISSUE = '2026-06-02';
const PHASE1_DUE = '2026-06-02';
const PHASE2_ISSUE = '2026-06-25';
const PHASE2_DUE = '2026-07-05';
const PHASE2_AMOUNT = 4236;
const QUEUE_GEN = '2026-07-25';
const QUEUE_MONTH = '2026-08-01';
const REPAIR_NOTE =
  'Ops repair 2026-07-04 — Jacob Datingaling payment on phase 1; phase 2 unpaid; remove phase 3';

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

async function clearInvoicePenalty(client, invoiceId) {
  const items = await client.query(
    `SELECT invoice_item_id, penalty_amount, amount
     FROM invoiceitemstbl
     WHERE invoice_id = $1 AND COALESCE(penalty_amount, 0) > 0`,
    [invoiceId]
  );
  for (const item of items.rows) {
    const penalty = Number(item.penalty_amount) || 0;
    const amount = Number(item.amount) || 0;
    await client.query(
      `UPDATE invoiceitemstbl
       SET amount = $1, penalty_amount = 0
       WHERE invoice_item_id = $2`,
      [Math.max(0, amount - penalty), item.invoice_item_id]
    );
  }
  if (items.rows.length) {
    await client.query(
      `UPDATE invoicestbl SET late_penalty_applied_for_due_date = NULL WHERE invoice_id = $1`,
      [invoiceId]
    );
  }
  return items.rows.length > 0;
}

async function recalcInvoiceAmountFromItems(client, invoiceId) {
  const totals = await client.query(
    `SELECT COALESCE(SUM(amount), 0) - COALESCE(SUM(discount_amount), 0)
            + COALESCE(SUM(penalty_amount), 0) AS grand
     FROM invoiceitemstbl WHERE invoice_id = $1`,
    [invoiceId]
  );
  const grand = Number(totals.rows[0]?.grand || 0);
  await client.query(`UPDATE invoicestbl SET amount = $1 WHERE invoice_id = $2`, [
    grand,
    invoiceId,
  ]);
  return grand;
}

async function refreshInvoiceStatus(client, invoiceId) {
  const inv = (
    await client.query(`SELECT invoice_id, amount, status FROM invoicestbl WHERE invoice_id = $1`, [
      invoiceId,
    ])
  ).rows[0];
  if (!inv) return;
  const settledRes = await client.query(
    `SELECT COALESCE(SUM(COALESCE(payable_amount, 0) + COALESCE(discount_amount, 0)), 0) AS total
     FROM paymenttbl
     WHERE invoice_id = $1
       AND status = 'Completed'
       AND COALESCE(approval_status, 'Pending') <> 'Rejected'`,
    [invoiceId]
  );
  const settled = parseFloat(settledRes.rows[0]?.total) || 0;
  const nextStatus = await deriveInvoiceStatusForInvoice(client, invoiceId, {
    totalSettled: settled,
    originalInvoiceAmount: inv.amount,
    previousStatus: inv.status,
  });
  // When fully settled, amount should be 0 and status Paid
  if (settled > 0 && settled + 0.01 >= Number(inv.amount) && Number(inv.amount) > 0) {
    await client.query(
      `UPDATE invoicestbl SET status = 'Paid', amount = 0 WHERE invoice_id = $1`,
      [invoiceId]
    );
    return;
  }
  if (settled > 0 && Number(inv.amount) === 0) {
    await client.query(`UPDATE invoicestbl SET status = 'Paid' WHERE invoice_id = $1`, [
      invoiceId,
    ]);
    return;
  }
  if (nextStatus !== inv.status) {
    await client.query(`UPDATE invoicestbl SET status = $1 WHERE invoice_id = $2`, [
      nextStatus,
      invoiceId,
    ]);
  }
}

async function loadSnapshot(client) {
  const profile = (
    await client.query(
      `SELECT ip.installmentinvoiceprofiles_id, ip.student_id, ip.generated_count, ip.is_active,
              ip.class_id,
              TO_CHAR(TIMEZONE('Asia/Manila', ii.next_generation_date), 'YYYY-MM-DD') AS next_gen,
              TO_CHAR(TIMEZONE('Asia/Manila', ii.next_invoice_month), 'YYYY-MM-DD') AS next_month,
              ii.status AS ii_status,
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
      `SELECT invoice_id, status, invoice_ar_number, amount,
              TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue_ymd,
              TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due_ymd,
              remarks
       FROM invoicestbl
       WHERE installmentinvoiceprofiles_id = $1
       ORDER BY invoice_id`,
      [PROFILE_ID]
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
  console.log(
    `\nJacob Datingaling installment repair${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );

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
      next_gen: before.profile.next_gen,
      next_month: before.profile.next_month,
    });
    console.log('Before invoices:');
    for (const inv of before.invoices) {
      console.log(
        `  INV ${inv.invoice_id} AR ${inv.invoice_ar_number} ${inv.issue_ymd}/${inv.due_ymd} amt=${inv.amount} ${inv.status}`
      );
    }
    console.log('Before payments:', before.payments);
    console.log('Before enrollments:', before.enrollments);

    const payment = (
      await client.query(`SELECT * FROM paymenttbl WHERE payment_id = $1`, [PAYMENT_ID])
    ).rows[0];
    if (!payment) throw new Error(`Payment ${PAYMENT_ID} not found`);
    if (Number(payment.invoice_id) !== PHASE2_INVOICE_ID) {
      console.log(
        `Note: payment ${PAYMENT_ID} currently on invoice ${payment.invoice_id} (expected ${PHASE2_INVOICE_ID})`
      );
    }

    const phase1Items = await client.query(
      `SELECT invoice_item_id, amount, discount_amount, penalty_amount
       FROM invoiceitemstbl WHERE invoice_id = $1`,
      [PHASE1_INVOICE_ID]
    );
    console.log('Phase 1 items:', phase1Items.rows);

    console.log('\nPlanned changes:');
    console.log(`  - Move payment ${PAYMENT_ID} → INV ${PHASE1_INVOICE_ID}`);
    console.log(
      `  - INV ${PHASE1_INVOICE_ID}: keep ${PHASE1_ISSUE}/${PHASE1_DUE}, clear penalty, Paid`
    );
    console.log(
      `  - INV ${PHASE2_INVOICE_ID}: unpaid, ${PHASE2_ISSUE}/${PHASE2_DUE}, amount ${PHASE2_AMOUNT}`
    );
    console.log(`  - DELETE INV ${PHASE3_INVOICE_ID}`);
    console.log('  - generated_count=2, queue July 25 / August 1, is_active=true');
    console.log('  - Phase 1 enrollment restored; remove phase 2 enrollment row');

    if (!isApply) {
      console.log('\nDRY RUN — no changes written. Re-run with --apply');
      return;
    }

    await client.query('BEGIN');

    // Clear phase 1 penalty so base amount matches the 4236 payment
    const clearedPenalty = await clearInvoicePenalty(client, PHASE1_INVOICE_ID);
    if (clearedPenalty) console.log('✅ Cleared penalty on phase 1');

    // Ensure phase 1 items total to payment amount (4236)
    const phase1Grand = await recalcInvoiceAmountFromItems(client, PHASE1_INVOICE_ID);
    const payAmount =
      (parseFloat(payment.payable_amount) || 0) + (parseFloat(payment.discount_amount) || 0);
    if (Math.abs(phase1Grand - payAmount) > 0.01 && phase1Items.rows.length > 0) {
      // Force base line to payment amount if still mismatched
      const firstItem = phase1Items.rows[0];
      await client.query(
        `UPDATE invoiceitemstbl
         SET amount = $1, discount_amount = 0, penalty_amount = 0
         WHERE invoice_item_id = $2`,
        [payAmount, firstItem.invoice_item_id]
      );
      // Zero out other items
      for (const item of phase1Items.rows.slice(1)) {
        await client.query(
          `UPDATE invoiceitemstbl
           SET amount = 0, discount_amount = 0, penalty_amount = 0
           WHERE invoice_item_id = $1`,
          [item.invoice_item_id]
        );
      }
      await recalcInvoiceAmountFromItems(client, PHASE1_INVOICE_ID);
      console.log(`✅ Phase 1 items aligned to payment amount ${payAmount}`);
    }

    await client.query(
      `UPDATE invoicestbl
       SET issue_date = $1::date,
           due_date = $2::date,
           late_penalty_applied_for_due_date = NULL
       WHERE invoice_id = $3`,
      [PHASE1_ISSUE, PHASE1_DUE, PHASE1_INVOICE_ID]
    );

    // Move payment to phase 1
    await client.query(`UPDATE paymenttbl SET invoice_id = $1 WHERE payment_id = $2`, [
      PHASE1_INVOICE_ID,
      PAYMENT_ID,
    ]);
    console.log(`✅ Payment ${PAYMENT_ID} moved to INV ${PHASE1_INVOICE_ID}`);

    // Phase 1 fully paid
    await client.query(
      `UPDATE invoicestbl SET status = 'Paid', amount = 0 WHERE invoice_id = $1`,
      [PHASE1_INVOICE_ID]
    );
    console.log(`✅ Phase 1 INV ${PHASE1_INVOICE_ID} marked Paid (dates kept)`);

    // Reset phase 2 to unpaid with correct dates
    const phase2Items = await client.query(
      `SELECT invoice_item_id FROM invoiceitemstbl WHERE invoice_id = $1 ORDER BY invoice_item_id`,
      [PHASE2_INVOICE_ID]
    );
    if (phase2Items.rows.length > 0) {
      await client.query(
        `UPDATE invoiceitemstbl
         SET amount = $1, discount_amount = 0, penalty_amount = 0
         WHERE invoice_item_id = $2`,
        [PHASE2_AMOUNT, phase2Items.rows[0].invoice_item_id]
      );
      for (const item of phase2Items.rows.slice(1)) {
        await client.query(
          `UPDATE invoiceitemstbl
           SET amount = 0, discount_amount = 0, penalty_amount = 0
           WHERE invoice_item_id = $1`,
          [item.invoice_item_id]
        );
      }
    }
    await client.query(
      `UPDATE invoicestbl
       SET issue_date = $1::date,
           due_date = $2::date,
           amount = $3,
           status = 'Unpaid',
           late_penalty_applied_for_due_date = NULL
       WHERE invoice_id = $4`,
      [PHASE2_ISSUE, PHASE2_DUE, PHASE2_AMOUNT, PHASE2_INVOICE_ID]
    );
    console.log(
      `✅ Phase 2 INV ${PHASE2_INVOICE_ID} unpaid ${PHASE2_ISSUE}/${PHASE2_DUE} amount ${PHASE2_AMOUNT}`
    );

    // Delete phase 3
    const phase3 = (
      await client.query(`SELECT invoice_id FROM invoicestbl WHERE invoice_id = $1`, [
        PHASE3_INVOICE_ID,
      ])
    ).rows[0];
    if (phase3) {
      await deleteInvoiceCascade(client, PHASE3_INVOICE_ID);
      console.log(`✅ Deleted phase 3 INV ${PHASE3_INVOICE_ID}`);
    }

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET generated_count = 2,
           is_active = true
       WHERE installmentinvoiceprofiles_id = $1`,
      [PROFILE_ID]
    );

    await client.query(
      `UPDATE installmentinvoicestbl
       SET status = NULL,
           next_generation_date = $1::date,
           next_invoice_month = $2::date
       WHERE installmentinvoiceprofiles_id = $3`,
      [QUEUE_GEN, QUEUE_MONTH, PROFILE_ID]
    );
    console.log('✅ Profile generated_count=2, active, queue July 25 / August 1');

    // Phase 1 enrollment: restore as enrolled (paid)
    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 'new',
           removed_at = NULL,
           removed_reason = NULL,
           removed_by = NULL,
           enrolled_by = COALESCE(enrolled_by, $1),
           enrolled_at = COALESCE(enrolled_at, CURRENT_TIMESTAMP)
       WHERE student_id = $2
         AND class_id = $3
         AND COALESCE(phase_number, 1) = 1`,
      [REPAIR_NOTE, STUDENT_ID, CLASS_ID]
    );
    console.log('✅ Phase 1 enrollment restored to new');

    // Phase 2 enrollment should not exist until phase 2 is paid
    const phase2Enroll = await client.query(
      `SELECT classstudent_id FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2 AND COALESCE(phase_number, 1) = 2`,
      [STUDENT_ID, CLASS_ID]
    );
    for (const row of phase2Enroll.rows) {
      await client.query(`DELETE FROM classstudentstbl WHERE classstudent_id = $1`, [
        row.classstudent_id,
      ]);
      console.log(`✅ Removed phase 2 enrollment ${row.classstudent_id}`);
    }

    await refreshInvoiceStatus(client, PHASE1_INVOICE_ID);
    await refreshInvoiceStatus(client, PHASE2_INVOICE_ID);
    await syncProgramPaymentStatusForInvoice(client, PHASE1_INVOICE_ID);
    await syncProgramPaymentStatusForInvoice(client, PHASE2_INVOICE_ID);

    await client.query('COMMIT');

    const after = await loadSnapshot(client);
    console.log('\n--- AFTER ---');
    console.log('Profile:', {
      generated_count: after.profile.generated_count,
      is_active: after.profile.is_active,
      next_gen: after.profile.next_gen,
      next_month: after.profile.next_month,
    });
    console.log('Invoices:');
    for (const inv of after.invoices) {
      console.log(
        `  INV ${inv.invoice_id} AR ${inv.invoice_ar_number} ${inv.issue_ymd}/${inv.due_ymd} amt=${inv.amount} ${inv.status}`
      );
    }
    console.log('Payments:', after.payments);
    console.log('Enrollments:', after.enrollments);

    const gone = (
      await client.query(`SELECT invoice_id FROM invoicestbl WHERE invoice_id = $1`, [
        PHASE3_INVOICE_ID,
      ])
    ).rows;
    console.log(`Phase 3 INV ${PHASE3_INVOICE_ID} exists:`, gone.length > 0);
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
