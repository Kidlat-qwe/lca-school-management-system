/**
 * Daelan Alaistair Shun Cordova — permanently delete cancelled INV-2367.
 *
 * Context: Wrong Plan 1 (class 167 / profile 499) was already removed via
 * repairDaelanCordovaRemoveWrongPlan1.js. INV-2367 was Cancelled + detached but
 * still appears in Invoices with payment 1774 / AR# 262032.
 *
 * Scope (--apply):
 *   1. DELETE merchandise_release_logtbl rows for payment 1774 (class 167 package)
 *   2. DELETE acknowledgement_receiptstbl linked to invoice 2367 or payment 1774
 *   3. DELETE payment 1774
 *   4. DELETE program_payment_statustbl / invoicestudentstbl / invoiceitemstbl
 *   5. Clear balance_invoice_id / downpayment_invoice_id refs
 *   6. DELETE invoicestbl 2367
 *
 * Does NOT touch profile 498 / class 121 / INV-2365 / INV-2366.
 *
 * Run:
 *   node backend/scripts/repairDaelanCordovaDeleteInvoice2367.js --production
 *   node backend/scripts/repairDaelanCordovaDeleteInvoice2367.js --production --apply
 */
import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const STUDENT_ID = 673;
const STUDENT_EMAIL = 'gwenthampal14@gmail.com';
const INVOICE_ID = 2367;
const EXPECTED_PAYMENT_ID = 1774;
const EXPECTED_AR_NUMBER = '262032';

const isApply = process.argv.includes('--apply');

async function main() {
  console.log(
    `\nDaelan Cordova — delete cancelled INV-${INVOICE_ID}` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`DB: ${process.env.DB_NAME} | NODE_ENV=${process.env.NODE_ENV}`);

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const student = (
      await client.query(
        `SELECT user_id, full_name, email FROM userstbl
         WHERE user_id = $1 AND LOWER(TRIM(email)) = LOWER(TRIM($2))`,
        [STUDENT_ID, STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student) throw new Error('Student not found');
    console.log('Student:', student.full_name, student.email);

    const invoice = (
      await client.query(
        `SELECT invoice_id, status, amount, invoice_ar_number,
                installmentinvoiceprofiles_id, ack_receipt_id
         FROM invoicestbl WHERE invoice_id = $1`,
        [INVOICE_ID]
      )
    ).rows[0];
    if (!invoice) {
      console.log(`INV-${INVOICE_ID} already gone — nothing to do.`);
      await client.query('ROLLBACK');
      return;
    }
    if (!['cancelled', 'canceled'].includes(String(invoice.status || '').toLowerCase())) {
      throw new Error(
        `INV-${INVOICE_ID} status is "${invoice.status}" (expected Cancelled) — abort`
      );
    }
    if (
      invoice.invoice_ar_number &&
      String(invoice.invoice_ar_number) !== EXPECTED_AR_NUMBER
    ) {
      throw new Error(
        `INV-${INVOICE_ID} AR# ${invoice.invoice_ar_number} ≠ expected ${EXPECTED_AR_NUMBER}`
      );
    }
    console.log('\nInvoice:');
    console.table([invoice]);

    const payments = (
      await client.query(
        `SELECT payment_id, payable_amount, status, approval_status, reference_number
         FROM paymenttbl WHERE invoice_id = $1`,
        [INVOICE_ID]
      )
    ).rows;
    console.log('\nPayments:');
    console.table(payments);
    if (payments.length !== 1 || Number(payments[0].payment_id) !== EXPECTED_PAYMENT_ID) {
      throw new Error(
        `Expected exactly payment ${EXPECTED_PAYMENT_ID} on INV-${INVOICE_ID}; got: ${JSON.stringify(payments)}`
      );
    }
    const paymentId = EXPECTED_PAYMENT_ID;

    const items = (
      await client.query(
        `SELECT invoice_item_id, description, amount FROM invoiceitemstbl WHERE invoice_id = $1`,
        [INVOICE_ID]
      )
    ).rows;
    const students = (
      await client.query(
        `SELECT invoice_student_id, student_id FROM invoicestudentstbl WHERE invoice_id = $1`,
        [INVOICE_ID]
      )
    ).rows;
    const ars = (
      await client.query(
        `SELECT ack_receipt_id, ack_receipt_number, invoice_id, payment_id, status
         FROM acknowledgement_receiptstbl
         WHERE invoice_id = $1 OR payment_id = $2`,
        [INVOICE_ID, paymentId]
      )
    ).rows;
    const merchLogs = (
      await client.query(
        `SELECT release_log_id, merchandise_name, class_id, quantity, payment_id
         FROM merchandise_release_logtbl WHERE payment_id = $1`,
        [paymentId]
      )
    ).rows;
    const pps = (
      await client.query(
        `SELECT program_payment_status_id FROM program_payment_statustbl WHERE invoice_id = $1`,
        [INVOICE_ID]
      )
    ).rows;

    console.log('\nWill delete:');
    console.log(`  merchandise_release_logtbl: ${merchLogs.length} row(s)`);
    console.table(merchLogs);
    console.log(`  acknowledgement_receiptstbl: ${ars.length} row(s)`);
    console.table(ars);
    console.log(`  paymenttbl: payment ${paymentId}`);
    console.log(`  program_payment_statustbl: ${pps.length} row(s)`);
    console.log(`  invoicestudentstbl: ${students.length} row(s)`);
    console.log(`  invoiceitemstbl: ${items.length} row(s)`);
    console.log(`  invoicestbl: INV-${INVOICE_ID}`);

    if (!isApply) {
      await client.query('ROLLBACK');
      console.log('\nDry run only — no changes written.');
      console.log('Re-run with --apply to delete.');
      return;
    }

    const delMerch = await client.query(
      `DELETE FROM merchandise_release_logtbl WHERE payment_id = $1`,
      [paymentId]
    );
    console.log(`✅ Deleted ${delMerch.rowCount} merchandise_release_log row(s)`);

    const delAr = await client.query(
      `DELETE FROM acknowledgement_receiptstbl
       WHERE invoice_id = $1 OR payment_id = $2`,
      [INVOICE_ID, paymentId]
    );
    console.log(`✅ Deleted ${delAr.rowCount} acknowledgement_receipt row(s)`);

    const delPay = await client.query(
      `DELETE FROM paymenttbl WHERE payment_id = $1 AND invoice_id = $2`,
      [paymentId, INVOICE_ID]
    );
    if (delPay.rowCount !== 1) {
      throw new Error(`Expected to delete 1 payment; deleted ${delPay.rowCount}`);
    }
    console.log(`✅ Deleted payment ${paymentId}`);

    await client.query(`DELETE FROM program_payment_statustbl WHERE invoice_id = $1`, [
      INVOICE_ID,
    ]);
    await client.query(`DELETE FROM invoicestudentstbl WHERE invoice_id = $1`, [INVOICE_ID]);
    await client.query(`DELETE FROM invoiceitemstbl WHERE invoice_id = $1`, [INVOICE_ID]);
    await client.query(
      `UPDATE invoicestbl SET balance_invoice_id = NULL WHERE balance_invoice_id = $1`,
      [INVOICE_ID]
    );
    await client.query(
      `UPDATE invoicestbl SET parent_invoice_id = NULL WHERE parent_invoice_id = $1`,
      [INVOICE_ID]
    );
    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET downpayment_invoice_id = NULL WHERE downpayment_invoice_id = $1`,
      [INVOICE_ID]
    );

    const delInv = await client.query(
      `DELETE FROM invoicestbl WHERE invoice_id = $1`,
      [INVOICE_ID]
    );
    if (delInv.rowCount !== 1) {
      throw new Error(`Expected to delete INV-${INVOICE_ID}; deleted ${delInv.rowCount}`);
    }
    console.log(`✅ Deleted INV-${INVOICE_ID}`);

    await client.query('COMMIT');
    console.log('\nCommitted.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('\nFAILED — rolled back:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main();
