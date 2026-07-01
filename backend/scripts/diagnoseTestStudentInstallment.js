import '../config/loadEnv.js';
import { query } from '../config/database.js';

const res = await query(
  `SELECT u.user_id, u.full_name, ip.*,
          ii.installmentinvoicedtl_id, ii.next_generation_date, ii.status AS ii_status,
          TO_CHAR(ii.next_generation_date, 'YYYY-MM-DD') AS next_gen_ymd
   FROM userstbl u
   JOIN installmentinvoiceprofilestbl ip ON ip.student_id = u.user_id
   LEFT JOIN installmentinvoicestbl ii ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
   WHERE u.full_name ILIKE '%test test test%'
   ORDER BY ip.installmentinvoiceprofiles_id DESC
   LIMIT 3`
);
console.log('Profiles:', JSON.stringify(res.rows, null, 2));

for (const p of res.rows) {
  const inv = await query(
    `SELECT invoice_id, invoice_ar_number, issue_date::text, due_date::text, status, amount,
            installmentinvoiceprofiles_id, remarks
     FROM invoicestbl
     WHERE installmentinvoiceprofiles_id = $1 OR invoice_id = $2
     ORDER BY invoice_id`,
    [p.installmentinvoiceprofiles_id, p.downpayment_invoice_id]
  );
  console.log('\nInvoices for profile', p.installmentinvoiceprofiles_id, inv.rows);

  const pay = await query(
    `SELECT p.payment_id, p.invoice_id, p.status, p.payable_amount, p.issue_date::text
     FROM paymenttbl p
     JOIN invoicestbl i ON i.invoice_id = p.invoice_id
     WHERE i.installmentinvoiceprofiles_id = $1 OR i.invoice_id = $2
     ORDER BY p.payment_id`,
    [p.installmentinvoiceprofiles_id, p.downpayment_invoice_id]
  );
  console.log('Payments:', pay.rows);
}

process.exit(0);
