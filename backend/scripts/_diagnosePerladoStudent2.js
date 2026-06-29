import '../config/loadEnv.js';
import pkg from 'pg';

const { Pool } = pkg;
const pool = new Pool({
  host: process.env.DB_HOST_PRODUCTION,
  port: parseInt(process.env.DB_PORT_PRODUCTION || '5432'),
  database: process.env.DB_NAME_PRODUCTION,
  user: process.env.DB_USER_PRODUCTION,
  password: process.env.DB_PASSWORD_PRODUCTION,
  ssl: { rejectUnauthorized: false },
});
const q = (text, params) => pool.query(text, params);

const STUDENT_ID = 528;
const PROFILE_ID = 311;

async function main() {
  const payments = await q(
    `SELECT p.*, i.invoice_ar_number, i.remarks, i.installmentinvoiceprofiles_id
     FROM paymenttbl p
     JOIN invoicestbl i ON i.invoice_id = p.invoice_id
     WHERE p.student_id = $1
     ORDER BY p.payment_id`,
    [STUDENT_ID]
  );
  console.log('All payments:', payments.rows);

  const invStudents = await q(
    `SELECT ist.*, i.invoice_ar_number, i.remarks
     FROM invoicestudentstbl ist
     JOIN invoicestbl i ON i.invoice_id = ist.invoice_id
     WHERE ist.student_id = $1`,
    [STUDENT_ID]
  );
  console.log('Invoice students:', invStudents.rows);

  const items = await q(
    `SELECT ii.* FROM invoiceitemstbl ii
     JOIN invoicestbl i ON i.invoice_id = ii.invoice_id
     WHERE i.installmentinvoiceprofiles_id = $1 OR i.invoice_id IN (786,787,789,1729)
     ORDER BY ii.invoice_id, ii.invoice_item_id`,
    [PROFILE_ID]
  );
  console.log('Invoice items:', items.rows);

  const enrollments = await q(
    `SELECT * FROM classstudentstbl WHERE student_id = $1 AND class_id = 88 ORDER BY classstudent_id`,
    [STUDENT_ID]
  );
  console.log('All class 88 enrollments:', enrollments.rows);

  const ars = await q(`SELECT * FROM acknowledgement_receiptstbl WHERE student_id = $1`, [STUDENT_ID]);
  console.log('ARs:', ars.rows);

  const pps = await q(`SELECT * FROM program_payment_statustbl WHERE student_id = $1`, [STUDENT_ID]);
  console.log('Program payment status:', pps.rows);

  const invChain = await q(
    `SELECT invoice_id, status, amount, parent_invoice_id, balance_invoice_id,
            invoice_chain_root_id, installmentinvoiceprofiles_id, remarks
     FROM invoicestbl WHERE invoice_id IN (786,787,789,1729)`
  );
  console.log('Invoice chains:', invChain.rows);

  await pool.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
