/**
 * Diagnose Marianna Agatha Romero billing / enrollment.
 */
import '../config/loadEnv.js';
import { query } from '../config/database.js';

const EMAIL = 'amgromero1987@gmail.com';

const student = await query(
  `SELECT user_id, full_name, email, branch_id FROM userstbl WHERE email ILIKE $1`,
  [EMAIL]
);
console.log('STUDENT:', JSON.stringify(student.rows, null, 2));
const sid = student.rows[0]?.user_id;
if (!sid) process.exit(1);

const profiles = await query(
  `SELECT ip.*, c.class_name
   FROM installmentinvoiceprofilestbl ip
   LEFT JOIN classestbl c ON ip.class_id = c.class_id
   WHERE ip.student_id = $1
   ORDER BY ip.installmentinvoiceprofiles_id`,
  [sid]
);
console.log('PROFILES:', JSON.stringify(profiles.rows, null, 2));

const enrollments = await query(
  `SELECT classstudent_id, class_id, phase_number, program_enrollment_status, removed_at,
          TO_CHAR(enrolled_at, 'YYYY-MM-DD') AS enrolled_at
   FROM classstudentstbl
   WHERE student_id = $1
   ORDER BY class_id, phase_number`,
  [sid]
);
console.log('ENROLLMENTS:', JSON.stringify(enrollments.rows, null, 2));

const invoices = await query(
  `SELECT i.invoice_id, i.installmentinvoiceprofiles_id, i.invoice_description, i.amount, i.status,
          TO_CHAR(i.issue_date, 'YYYY-MM-DD') AS issue_date,
          TO_CHAR(i.due_date, 'YYYY-MM-DD') AS due_date,
          i.remarks, i.invoice_ar_number
   FROM invoicestbl i
   JOIN invoicestudentstbl ist ON ist.invoice_id = i.invoice_id
   WHERE ist.student_id = $1
   ORDER BY i.invoice_id`,
  [sid]
);
console.log('INVOICES:', JSON.stringify(invoices.rows, null, 2));

const schedule = await query(
  `SELECT * FROM installmentinvoicestbl
   WHERE installmentinvoiceprofiles_id IN (
     SELECT installmentinvoiceprofiles_id FROM installmentinvoiceprofilestbl WHERE student_id = $1
   )`,
  [sid]
);
console.log('SCHEDULE ROWS:', JSON.stringify(schedule.rows, null, 2));
