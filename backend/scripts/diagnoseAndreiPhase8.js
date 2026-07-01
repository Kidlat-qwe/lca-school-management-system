import '../config/loadEnv.js';
import { query } from '../config/database.js';

const studentId = 247;
const classId = 58;

const cs = await query(
  `SELECT classstudent_id, phase_number, program_enrollment_status, enrolled_at, removed_at
   FROM classstudentstbl WHERE student_id = $1 AND class_id = $2 ORDER BY phase_number`,
  [studentId, classId]
);
console.log('=== classstudent ===');
console.log(cs.rows);

const inv = await query(
  `SELECT i.invoice_id, i.invoice_description, i.status, i.amount, i.remarks,
          i.installmentinvoiceprofiles_id, i.invoice_ar_number, i.balance_invoice_id
   FROM invoicestbl i
   JOIN invoicestudentstbl ist ON ist.invoice_id = i.invoice_id
   WHERE ist.student_id = $1
   ORDER BY i.invoice_id`,
  [studentId]
);
console.log('\n=== invoices ===');
for (const r of inv.rows) console.log(r);

const pay773 = await query(
  `SELECT payment_id, invoice_id, payable_amount, status, approval_status, created_at
   FROM paymenttbl WHERE invoice_id = 773 OR student_id = $1 ORDER BY payment_id`,
  [studentId]
);
console.log('\n=== payments (773) ===');
for (const r of pay773.rows) console.log(r);

const profile = await query(
  `SELECT * FROM installmentinvoiceprofilestbl WHERE student_id = $1 AND class_id = $2`,
  [studentId, classId]
);
console.log('\n=== profile ===');
console.log(profile.rows[0]);

process.exit(0);
