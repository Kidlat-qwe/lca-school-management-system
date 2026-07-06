/**
 * Maryam S. Tawfik — remove premature phase 2; queue July 25 / August 1.
 *
 * Profile 441 | Phase 1 INV 1454 Paid stays.
 * Delete phase 2 INV 1891; generated_count = 1.
 *
 * Run:
 *   node backend/scripts/repairMaryamTawfikRemovePhase2.js
 *   node backend/scripts/repairMaryamTawfikRemovePhase2.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_EMAIL = 'salvadormarygracesd@gmail.com';
const STUDENT_ID = 622;
const PROFILE_ID = 441;
const PHASE1_INVOICE_ID = 1454;
const QUEUE_GEN = '2026-07-25';
const QUEUE_MONTH = '2026-08-01';

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
       WHERE ip.installmentinvoiceprofiles_id = $1`,
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

  return { profile, invoices };
}

async function main() {
  console.log(
    `\nMaryam Tawfik remove phase 2${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
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
        `  INV ${inv.invoice_id} phase=${tp ?? 'dp'} ${inv.issue_ymd}/${inv.due_ymd} ${inv.status}`
      );
    }

    const phase2Invoices = before.invoices.filter(
      (inv) => parseTargetPhase(inv.remarks) != null && parseTargetPhase(inv.remarks) >= 2
    );

    console.log('\nPlanned:');
    for (const inv of phase2Invoices) {
      console.log(`  - DELETE INV ${inv.invoice_id} (phase ${parseTargetPhase(inv.remarks)})`);
    }
    console.log('  - generated_count → 1');
    console.log(`  - queue → ${QUEUE_GEN} / ${QUEUE_MONTH}`);

    if (!isApply) {
      console.log('\nDRY RUN — re-run with --apply');
      return;
    }

    await client.query('BEGIN');

    for (const inv of phase2Invoices) {
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
       WHERE installmentinvoiceprofiles_id = $3`,
      [QUEUE_GEN, QUEUE_MONTH, PROFILE_ID]
    );
    console.log('✅ Profile generated_count=1, queue July 25 / August 1');

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
