import '../config/loadEnv.js';
import { query } from '../config/database.js';
import { getCanonicalInstallmentPhaseCounts } from '../utils/balanceInvoice.js';

const sid = process.argv[2] ? parseInt(process.argv[2], 10) : null;

const users = sid
  ? await query('SELECT user_id, full_name, email FROM userstbl WHERE user_id = $1', [sid])
  : await query(
      `SELECT user_id, full_name, email FROM userstbl
       WHERE LOWER(full_name) LIKE '%bronny%' OR LOWER(email) LIKE '%bronny%'`
    );

console.log('USER:', users.rows);
const studentId = users.rows[0]?.user_id;
if (!studentId) {
  console.log('No student found');
  process.exit(0);
}

const cs = await query(
  `SELECT classstudent_id, class_id, phase_number, program_enrollment_status, enrolled_by, enrolled_at, removed_at
   FROM classstudentstbl WHERE student_id = $1 ORDER BY classstudent_id`,
  [studentId]
);
console.log('CLASSSTUDENT:', cs.rows);

const inv = await query(
  `SELECT i.invoice_id, i.invoice_description, i.status, i.amount, i.ack_receipt_id,
          i.installmentinvoiceprofiles_id, i.invoice_ar_number, i.remarks
   FROM invoicestbl i
   JOIN invoicestudentstbl ist ON ist.invoice_id = i.invoice_id
   WHERE ist.student_id = $1 ORDER BY i.invoice_id`,
  [studentId]
);
console.log('INVOICES:', inv.rows);

const pay = await query(
  `SELECT payment_id, invoice_id, payable_amount, status, approval_status, payment_type
   FROM paymenttbl WHERE student_id = $1 ORDER BY payment_id`,
  [studentId]
);
console.log('PAYMENTS:', pay.rows);

const ip = await query(
  `SELECT installmentinvoiceprofiles_id, class_id, student_id, downpayment_paid, downpayment_invoice_id,
          generated_count, total_phases, phase_start, is_active, amount
   FROM installmentinvoiceprofilestbl WHERE student_id = $1 ORDER BY installmentinvoiceprofiles_id DESC`,
  [studentId]
);
console.log('PROFILES:', ip.rows);

for (const p of ip.rows) {
  const counts = await getCanonicalInstallmentPhaseCounts(
    { query },
    p.installmentinvoiceprofiles_id,
    p.downpayment_invoice_id
  );
  console.log(`COUNTS profile ${p.installmentinvoiceprofiles_id}:`, counts);
}

const ar = await query(
  `SELECT ack_receipt_id, ack_receipt_number, status, invoice_id, payment_id,
          installment_option, paired_ack_receipt_id, student_id, payment_amount, prospect_student_name
   FROM acknowledgement_receiptstbl
   WHERE student_id = $1 OR prospect_student_name ILIKE '%bronny%'
      OR invoice_id IN (497, 498) OR ack_receipt_number IN ('260356', '260357')
   ORDER BY ack_receipt_id`,
  [studentId]
);
console.log('AR:', ar.rows);

const ii = await query(
  `SELECT * FROM installmentinvoicestbl ii
   JOIN installmentinvoiceprofilestbl ip ON ip.installmentinvoiceprofiles_id = ii.installmentinvoiceprofiles_id
   WHERE ip.student_id = $1 OR ip.class_id = 34`,
  [studentId]
);
console.log('INSTALLMENT RECORDS:', ii.rows);

const profileByInv = await query(
  `SELECT * FROM installmentinvoiceprofilestbl
   WHERE downpayment_invoice_id IN (497, 498) OR description ILIKE '%Bronny%'`
);
console.log('PROFILE BY INV/DESC:', profileByInv.rows);

const ar2 = await query(
  `SELECT * FROM acknowledgement_receiptstbl
   WHERE ack_receipt_number::text IN ('260356', '260357') OR payment_id IN (387, 388)`
);
console.log('AR BY NUM/PAYMENT:', ar2.rows);

const iiBronny = await query(
  `SELECT ii.*, ip.student_id, ip.description, ip.installmentinvoiceprofiles_id AS profile_exists
   FROM installmentinvoicestbl ii
   LEFT JOIN installmentinvoiceprofilestbl ip ON ip.installmentinvoiceprofiles_id = ii.installmentinvoiceprofiles_id
   WHERE ii.student_name ILIKE '%Bronny%' OR ip.description ILIKE '%Bronny%'`
);
console.log('II BRONNY:', iiBronny.rows);

process.exit(0);
