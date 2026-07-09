/**
 * Diagnose Cailem R. Marcos installment profiles (duplicate Plan 2).
 */
import '../config/loadEnv.js';
import { query } from '../config/database.js';

const EMAIL = 'lhezly17@gmail.com';

const student = await query(
  `SELECT user_id, full_name, email, branch_id FROM userstbl WHERE email ILIKE $1`,
  [EMAIL]
);
console.log('STUDENT:', JSON.stringify(student.rows, null, 2));
const sid = student.rows[0]?.user_id;
if (!sid) process.exit(1);

const profiles = await query(
  `SELECT ip.installmentinvoiceprofiles_id, ip.class_id, ip.package_id, ip.is_active,
          ip.phase_start, ip.total_phases, ip.generated_count, ip.downpayment_paid,
          ip.downpayment_invoice_id, ip.description, ip.created_at, ip.created_by,
          c.class_name, pkg.package_name
   FROM installmentinvoiceprofilestbl ip
   LEFT JOIN classestbl c ON ip.class_id = c.class_id
   LEFT JOIN packagestbl pkg ON ip.package_id = pkg.package_id
   WHERE ip.student_id = $1
   ORDER BY ip.installmentinvoiceprofiles_id`,
  [sid]
);
console.log('PROFILES:', JSON.stringify(profiles.rows, null, 2));

for (const p of profiles.rows) {
  const invoices = await query(
    `SELECT i.invoice_id, i.status, i.amount, i.invoice_description, i.invoice_ar_number,
            TO_CHAR(i.issue_date, 'YYYY-MM-DD') AS issue_date,
            TO_CHAR(i.due_date, 'YYYY-MM-DD') AS due_date,
            i.remarks
     FROM invoicestbl i
     WHERE i.installmentinvoiceprofiles_id = $1
     ORDER BY i.invoice_id`,
    [p.installmentinvoiceprofiles_id]
  );
  console.log(`\nInvoices for profile ${p.installmentinvoiceprofiles_id}:`);
  console.table(invoices.rows);

  const sched = await query(
    `SELECT installmentinvoicedtl_id, status, scheduled_date::text
     FROM installmentinvoicestbl
     WHERE installmentinvoiceprofiles_id = $1`,
    [p.installmentinvoiceprofiles_id]
  );
  console.log(`Schedule rows for profile ${p.installmentinvoiceprofiles_id}:`, sched.rows);
}

const enrollments = await query(
  `SELECT classstudent_id, class_id, phase_number, program_enrollment_status, removed_at,
          TO_CHAR(enrolled_at, 'YYYY-MM-DD') AS enrolled_at
   FROM classstudentstbl
   WHERE student_id = $1
   ORDER BY class_id, phase_number`,
  [sid]
);
console.log('\nENROLLMENTS:', JSON.stringify(enrollments.rows, null, 2));
