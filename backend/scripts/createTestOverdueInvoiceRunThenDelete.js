import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { getClient } from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../.env') });

const STUDENT_EMAIL = process.argv[2] || 'developmentstudent2@gmail.com';

/**
 * 1) Create a test overdue unpaid invoice for the student.
 * 2) Run the overdue email test (same logic as testSendOverdueEmailForExistingStudent).
 * 3) Delete the test invoice and related rows.
 */
async function main() {
  if (process.env.SMTP_USER) {
    process.env.SMTP_FROM = process.env.SMTP_USER;
  }

  const client = await getClient();
  let testInvoiceId = null;

  try {
    console.log('📧 Create test overdue invoice → send email → delete');
    console.log('==================================================');
    console.log('Student email:', STUDENT_EMAIL);
    console.log('');

    // 1) Get student
    const studentRes = await client.query(
      `SELECT user_id, full_name, email FROM userstbl WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [STUDENT_EMAIL]
    );
    if (studentRes.rows.length === 0) {
      throw new Error(`Student not found for email: ${STUDENT_EMAIL}`);
    }
    const student = studentRes.rows[0];

    // 2) Get first branch
    const branchRes = await client.query(
      `SELECT branch_id, branch_name FROM branchestbl ORDER BY branch_id ASC LIMIT 1`
    );
    if (branchRes.rows.length === 0) {
      throw new Error('No branch found in branchestbl');
    }
    const branch = branchRes.rows[0];

    // 3) Create overdue invoice (due_date = yesterday Manila)
    const issueDate = new Date();
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - 1);

    await client.query('BEGIN');
    const invResult = await client.query(
      `INSERT INTO invoicestbl (invoice_description, branch_id, amount, status, remarks, issue_date, due_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING invoice_id, invoice_description, due_date, branch_id`,
      ['TEMP', branch.branch_id, 1000, 'Unpaid', null, issueDate, dueDate, null]
    );
    const inv = invResult.rows[0];
    testInvoiceId = inv.invoice_id;

    await client.query(
      `UPDATE invoicestbl SET invoice_description = $1 WHERE invoice_id = $2`,
      [`INV-${testInvoiceId}`, testInvoiceId]
    );

    await client.query(
      `INSERT INTO invoiceitemstbl (invoice_id, description, amount, tax_item, tax_percentage, discount_amount, penalty_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [testInvoiceId, 'Test overdue item', 1000, null, null, null, null]
    );

    await client.query(
      'INSERT INTO invoicestudentstbl (invoice_id, student_id) VALUES ($1, $2)',
      [testInvoiceId, student.user_id]
    );
    await client.query('COMMIT');

    console.log('✅ Test invoice created: invoice_id =', testInvoiceId, 'INV-' + testInvoiceId);
    console.log('   Branch:', branch.branch_name, '| Due (past):', dueDate.toISOString().slice(0, 10));
    console.log('');

    // 4) Run overdue email logic (same as testSendOverdueEmailForExistingStudent)
    const guardianRes = await client.query(
      `SELECT guardian_name, email FROM guardianstbl WHERE student_id = $1 ORDER BY guardian_id ASC LIMIT 1`,
      [student.user_id]
    );
    const guardian = guardianRes.rows[0] || null;

    const itemsRes = await client.query('SELECT * FROM invoiceitemstbl WHERE invoice_id = $1', [testInvoiceId]);
    const totals = (itemsRes.rows || []).reduce(
      (acc, item) => {
        const amt = Number(item.amount) || 0;
        const discount = Number(item.discount_amount) || 0;
        const penalty = Number(item.penalty_amount) || 0;
        const taxPct = Number(item.tax_percentage) || 0;
        const taxableBase = amt - discount + penalty;
        const tax = taxableBase * (taxPct / 100);
        acc.subtotal += amt;
        acc.discount += discount;
        acc.penalty += penalty;
        acc.tax += tax;
        return acc;
      },
      { subtotal: 0, discount: 0, penalty: 0, tax: 0 }
    );
    const grandTotal = totals.subtotal - totals.discount + totals.penalty + totals.tax;
    const paymentsRes = await client.query(
      `SELECT COALESCE(SUM(payable_amount), 0) as total_payments FROM paymenttbl WHERE invoice_id = $1`,
      [testInvoiceId]
    );
    const totalPayments = Number(paymentsRes.rows[0]?.total_payments || 0);
    const outstandingBalance = grandTotal - totalPayments;

    // Send test email to real address (student email is dummy)
    const recipientEmails = ['jericho@rhet-corp.com'];

    const payload = {
      to: recipientEmails,
      parentName: guardian?.guardian_name || null,
      studentName: student.full_name,
      invoiceId: testInvoiceId,
      invoiceNumber: `INV-${testInvoiceId}`,
      invoiceDescription: `INV-${testInvoiceId}`,
      amount: outstandingBalance,
      dueDate: inv.due_date,
      className: null,
      centerName: branch.branch_name || null,
      facebookLink: 'https://www.facebook.com/littlechampionsacademy',
    };

    console.log('Sending overdue email...');
    const { sendOverduePaymentReminderEmail } = await import('../utils/emailService.js');
    const res = await sendOverduePaymentReminderEmail(payload);
    console.log('✅ Email send result:', res);
    console.log('');

    // 5) Delete test invoice (reverse order: payments if any, invoicestudentstbl, invoiceitemstbl, invoicestbl)
    await client.query('DELETE FROM paymenttbl WHERE invoice_id = $1', [testInvoiceId]);
    await client.query('DELETE FROM invoicestudentstbl WHERE invoice_id = $1', [testInvoiceId]);
    await client.query('DELETE FROM invoiceitemstbl WHERE invoice_id = $1', [testInvoiceId]);
    await client.query('DELETE FROM invoicestbl WHERE invoice_id = $1', [testInvoiceId]);
    console.log('✅ Test invoice and related rows deleted. invoice_id =', testInvoiceId);
  } finally {
    if (testInvoiceId) {
      try {
        await client.query('DELETE FROM paymenttbl WHERE invoice_id = $1', [testInvoiceId]);
        await client.query('DELETE FROM invoicestudentstbl WHERE invoice_id = $1', [testInvoiceId]);
        await client.query('DELETE FROM invoiceitemstbl WHERE invoice_id = $1', [testInvoiceId]);
        await client.query('DELETE FROM invoicestbl WHERE invoice_id = $1', [testInvoiceId]);
      } catch (e) {
        // ignore cleanup errors
      }
    }
    client.release();
  }
}

main().catch((e) => {
  console.error('❌ Failed:', e?.message || e);
  process.exit(1);
});
