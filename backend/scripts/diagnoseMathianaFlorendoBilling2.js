import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const p = process.env.NODE_ENV === 'production' ? 'PRODUCTION' : 'DEVELOPMENT';
const pool = new pg.Pool({
  host: process.env[`DB_HOST_${p}`],
  port: process.env[`DB_PORT_${p}`],
  database: process.env[`DB_NAME_${p}`],
  user: process.env[`DB_USER_${p}`],
  password: process.env[`DB_PASSWORD_${p}`],
  ssl: process.env[`DB_SSL_${p}`] === 'true' ? { rejectUnauthorized: false } : false,
});
const ids = [969, 971, 973, 990, 1923];
const pay = await pool.query('SELECT payment_id, invoice_id, payable_amount, status, approval_status FROM paymenttbl WHERE invoice_id = ANY($1::int[])', [ids]);
console.log('PAYMENTS', pay.rows);
const ar = await pool.query('SELECT ack_receipt_id, invoice_id, ack_receipt_ar_number, status FROM acknowledgement_receiptstbl WHERE invoice_id = ANY($1::int[])', [ids]);
console.log('AR', ar.rows);
const ii = await pool.query('SELECT * FROM installmentinvoicestbl WHERE installmentinvoiceprofiles_id IN (348,350)');
console.log('INSTALLMENT SCHEDULE ROWS', ii.rows);
const pps = await pool.query('SELECT program_payment_status_id, installmentinvoiceprofiles_id, invoice_id, phase_number, status FROM program_payment_statustbl WHERE student_id=554');
console.log('PPS', pps.rows);
const invItems = await pool.query('SELECT invoice_id, COUNT(*) FROM invoiceitemstbl WHERE invoice_id = ANY($1::int[]) GROUP BY invoice_id', [ids]);
console.log('ITEMS', invItems.rows);
await pool.end();
