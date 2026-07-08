/**
 * Diagnose Mathiana Victoria Reyes Florendo billing / enrollment duplication.
 */
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const EMAIL = 'roannreyes1522@gmail.com';
const prefix = process.env.NODE_ENV === 'production' ? 'PRODUCTION' : 'DEVELOPMENT';

const pool = new pg.Pool({
  host: process.env[`DB_HOST_${prefix}`],
  port: process.env[`DB_PORT_${prefix}`],
  database: process.env[`DB_NAME_${prefix}`],
  user: process.env[`DB_USER_${prefix}`],
  password: process.env[`DB_PASSWORD_${prefix}`],
  ssl: process.env[`DB_SSL_${prefix}`] === 'true' ? { rejectUnauthorized: false } : false,
});

try {
  const student = await pool.query(
    `SELECT user_id, full_name, email, branch_id FROM userstbl WHERE email ILIKE $1`,
    [EMAIL]
  );
  console.log('STUDENT:', JSON.stringify(student.rows, null, 2));
  const sid = student.rows[0]?.user_id;
  if (!sid) process.exit(1);

  const profiles = await pool.query(
    `SELECT ip.*, c.class_name, c.class_id
     FROM installmentinvoiceprofilestbl ip
     LEFT JOIN classestbl c ON ip.class_id = c.class_id
     WHERE ip.student_id = $1
     ORDER BY ip.installmentinvoiceprofiles_id`,
    [sid]
  );
  console.log('INSTALLMENT PROFILES:', JSON.stringify(profiles.rows, null, 2));

  const enrollments = await pool.query(
    `SELECT cs.classstudent_id, cs.class_id, cs.student_id, cs.phase_number,
            cs.program_enrollment_status, cs.removed_at, cs.enrolled_at, c.class_name
     FROM classstudentstbl cs
     JOIN classestbl c ON cs.class_id = c.class_id
     WHERE cs.student_id = $1
     ORDER BY cs.class_id, cs.phase_number, cs.enrolled_at`,
    [sid]
  );
  console.log('CLASS ENROLLMENTS:', JSON.stringify(enrollments.rows, null, 2));

  const invoices = await pool.query(
    `SELECT i.invoice_id, i.invoice_description, i.amount, i.status,
            TO_CHAR(i.issue_date, 'YYYY-MM-DD') AS issue_date,
            TO_CHAR(i.due_date, 'YYYY-MM-DD') AS due_date,
            i.installmentinvoiceprofiles_id, i.remarks
     FROM invoicestbl i
     JOIN invoicestudentstbl ist ON ist.invoice_id = i.invoice_id
     WHERE ist.student_id = $1
     ORDER BY i.invoice_id`,
    [sid]
  );
  console.log('INVOICES:', JSON.stringify(invoices.rows, null, 2));

  const installmentInvoices = await pool.query(
    `SELECT installmentinvoices_id, installmentinvoiceprofiles_id, phase_number, invoice_id, status
     FROM installmentinvoicestbl
     WHERE installmentinvoiceprofiles_id IN (
       SELECT installmentinvoiceprofiles_id FROM installmentinvoiceprofilestbl WHERE student_id = $1
     )
     ORDER BY installmentinvoiceprofiles_id, phase_number`,
    [sid]
  );
  console.log('INSTALLMENT INVOICE ROWS:', JSON.stringify(installmentInvoices.rows, null, 2));

  const payments = await pool.query(
    `SELECT p.payment_id, p.invoice_id, p.payable_amount, p.status, p.approval_status,
            TO_CHAR(p.issue_date, 'YYYY-MM-DD') AS issue_date
     FROM paymenttbl p
     WHERE p.invoice_id IN (
       SELECT i.invoice_id FROM invoicestbl i
       JOIN invoicestudentstbl ist ON ist.invoice_id = i.invoice_id
       WHERE ist.student_id = $1
     )
     ORDER BY p.invoice_id`,
    [sid]
  );
  console.log('PAYMENTS:', JSON.stringify(payments.rows, null, 2));

  const ars = await pool.query(
    `SELECT ar.ack_receipt_id, ar.invoice_id, ar.ack_receipt_ar_number, ar.status
     FROM acknowledgement_receiptstbl ar
     WHERE ar.invoice_id IN (
       SELECT i.invoice_id FROM invoicestbl i
       JOIN invoicestudentstbl ist ON ist.invoice_id = i.invoice_id
       WHERE ist.student_id = $1
     )
     ORDER BY ar.invoice_id`,
    [sid]
  );
  console.log('AR RECEIPTS:', JSON.stringify(ars.rows, null, 2));

  const pps = await pool.query(
    `SELECT * FROM program_payment_statustbl WHERE student_id = $1`,
    [sid]
  );
  console.log('PROGRAM PAYMENT STATUS:', JSON.stringify(pps.rows, null, 2));
} finally {
  await pool.end();
}
