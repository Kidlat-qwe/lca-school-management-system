/**
 * Diagnose why AR search 260878 / INV-1213 cross-link returns no rows.
 * Usage: node scripts/diagnoseAr260878.js
 */
import '../config/loadEnv.js';
import { query } from '../config/database.js';

async function main() {
  const inv = await query(
    `SELECT invoice_id, invoice_ar_number, ack_receipt_id, invoice_description, status, branch_id
     FROM invoicestbl WHERE invoice_id = 1213 OR invoice_ar_number = '260878'`
  );
  console.log('Invoices:', JSON.stringify(inv.rows, null, 2));

  const arByNum = await query(
    `SELECT ack_receipt_id, ack_receipt_number, invoice_id, payment_id, status, prospect_student_name, paired_ack_receipt_id
     FROM acknowledgement_receiptstbl
     WHERE ack_receipt_number ILIKE '%260878%' OR ack_receipt_number = '260878'`
  );
  console.log('AR by ack_receipt_number:', JSON.stringify(arByNum.rows, null, 2));

  const arByInv = await query(
    `SELECT ar.ack_receipt_id, ar.ack_receipt_number, ar.invoice_id, ar.payment_id, ar.status,
            ar.prospect_student_name, ar.paired_ack_receipt_id, i.invoice_ar_number
     FROM acknowledgement_receiptstbl ar
     LEFT JOIN invoicestbl i ON i.ack_receipt_id = ar.ack_receipt_id OR i.invoice_id = ar.invoice_id
     WHERE i.invoice_id = 1213 OR i.invoice_ar_number = '260878'`
  );
  console.log('AR linked to invoice 1213:', JSON.stringify(arByInv.rows, null, 2));

  const pay = await query(
    `SELECT p.payment_id, p.invoice_id, p.payment_method, ar.ack_receipt_id, ar.ack_receipt_number
     FROM paymenttbl p
     LEFT JOIN acknowledgement_receiptstbl ar ON ar.payment_id = p.payment_id
     WHERE p.invoice_id = 1213`
  );
  console.log('Payments for invoice 1213:', JSON.stringify(pay.rows, null, 2));

  const hiddenCheck = await query(
    `SELECT ar.ack_receipt_id, ar.ack_receipt_number,
            EXISTS (
              SELECT 1 FROM acknowledgement_receiptstbl ar_parent
              WHERE ar_parent.paired_ack_receipt_id = ar.ack_receipt_id
            ) AS is_hidden_paired_parent
     FROM acknowledgement_receiptstbl ar
     WHERE ar.ack_receipt_id IN (
       SELECT ack_receipt_id FROM invoicestbl WHERE invoice_id = 1213
       UNION
       SELECT ack_receipt_id FROM invoicestbl WHERE invoice_ar_number = '260878' AND ack_receipt_id IS NOT NULL
     ) OR ar.invoice_id = 1213`
  );
  console.log('Hidden paired check:', JSON.stringify(hiddenCheck.rows, null, 2));

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
