import dotenv from 'dotenv';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

import { getClient } from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../.env') });

/**
 * Test script: sends the OVERDUE reminder email using a real student from the DB.
 *
 * Default student email: developmentstudent2@gmail.com
 *
 * Run (PowerShell or CMD):
 *   node backend/scripts/testSendOverdueEmailForExistingStudent.js
 *
 * Optional override:
 *   node backend/scripts/testSendOverdueEmailForExistingStudent.js someone@gmail.com
 */
async function main() {
  const studentEmail = process.argv[2] || 'developmentstudent2@gmail.com';

  // Ensure FROM matches SMTP auth user to avoid sender rejection
  if (process.env.SMTP_USER) {
    process.env.SMTP_FROM = process.env.SMTP_USER;
  }

  const client = await getClient();
  try {
    console.log('📧 Test: Send overdue reminder email (REAL student)');
    console.log('===============================================');
    console.log('Student email:', studentEmail);
    console.log('');

    // 1) Find the student user record
    const studentRes = await client.query(
      `SELECT user_id, full_name, email
       FROM userstbl
       WHERE LOWER(email) = LOWER($1)
       LIMIT 1`,
      [studentEmail]
    );
    if (studentRes.rows.length === 0) {
      throw new Error(`Student not found in userstbl for email: ${studentEmail}`);
    }
    const student = studentRes.rows[0];

    // 2) Get guardian (parent) info (first guardian record)
    const guardianRes = await client.query(
      `SELECT guardian_name, email
       FROM guardianstbl
       WHERE student_id = $1
       ORDER BY guardian_id ASC
       LIMIT 1`,
      [student.user_id]
    );
    const guardian = guardianRes.rows[0] || null;

    // 3) Find the latest overdue unpaid invoice linked to this student
    //    Overdue logic: due_date < today (Asia/Manila date) and status != Paid
    const invoiceRes = await client.query(
      `SELECT
         i.invoice_id,
         i.invoice_description,
         i.due_date,
         i.status,
         i.branch_id,
         b.branch_name
       FROM invoicestudentstbl invs
       JOIN invoicestbl i ON i.invoice_id = invs.invoice_id
       LEFT JOIN branchestbl b ON b.branch_id = i.branch_id
       WHERE invs.student_id = $1
         AND COALESCE(i.status, '') <> 'Paid'
         AND (i.due_date::date < (NOW() AT TIME ZONE 'Asia/Manila')::date)
       ORDER BY i.due_date DESC, i.invoice_id DESC
       LIMIT 1`,
      [student.user_id]
    );
    if (invoiceRes.rows.length === 0) {
      throw new Error(
        `No overdue unpaid invoice found for student ${studentEmail}. Make sure there is at least one invoice past due date.`
      );
    }
    const invoice = invoiceRes.rows[0];

    // 4) Compute outstanding balance (same as manual endpoint)
    const itemsRes = await client.query('SELECT * FROM invoiceitemstbl WHERE invoice_id = $1', [invoice.invoice_id]);
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
      `SELECT COALESCE(SUM(payable_amount), 0) as total_payments
       FROM paymentstbl
       WHERE invoice_id = $1`,
      [invoice.invoice_id]
    );
    const totalPayments = Number(paymentsRes.rows[0]?.total_payments || 0);
    const outstandingBalance = grandTotal - totalPayments;

    // 5) Optional: class name if linked
    let className = null;
    try {
      const classRes = await client.query(
        `SELECT c.class_name
         FROM enrollmentstbl e
         JOIN classestbl c ON e.class_id = c.class_id
         WHERE e.student_id = $1
         ORDER BY e.enrollment_id DESC
         LIMIT 1`,
        [student.user_id]
      );
      if (classRes.rows.length > 0) className = classRes.rows[0].class_name;
    } catch {
      // optional
    }

    const recipientEmails = Array.from(
      new Set([guardian?.email, student.email].filter((e) => e && String(e).trim() !== ''))
    );

    const payload = {
      to: recipientEmails,
      parentName: guardian?.guardian_name || null,
      studentName: student.full_name,
      invoiceId: invoice.invoice_id,
      invoiceNumber: invoice.invoice_description || `INV-${invoice.invoice_id}`,
      invoiceDescription: invoice.invoice_description || `INV-${invoice.invoice_id}`,
      amount: outstandingBalance,
      dueDate: invoice.due_date,
      className,
      centerName: invoice.branch_name || null,
      facebookLink: 'https://www.facebook.com/littlechampionsacademy',
    };

    console.log('Resolved data:');
    console.log(JSON.stringify(payload, null, 2));
    console.log('');

    // Save a preview file (note: QR image is embedded via CID in real email)
    const previewHtml = `
<!DOCTYPE html>
<html>
  <head><meta charset="UTF-8" /><title>Overdue Email Preview (DB)</title></head>
  <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 760px; margin: 0 auto; padding: 20px;">
    <h2>Overdue Email Preview (DB)</h2>
    <p><strong>To:</strong> ${payload.to.join(', ')}</p>
    <p><strong>Parent name:</strong> ${payload.parentName || '(none)'} </p>
    <p><strong>Student:</strong> ${payload.studentName}</p>
    <p><strong>Invoice:</strong> ${payload.invoiceNumber}</p>
    <p><strong>Due date:</strong> ${payload.dueDate}</p>
    <p><strong>Outstanding:</strong> ${new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(payload.amount)}</p>
    <p><strong>Center:</strong> ${payload.centerName || '(none)'}</p>
    <p><strong>Facebook:</strong> <a href="${payload.facebookLink}">${payload.facebookLink}</a></p>
    <hr />
    <p><em>Note: The real email embeds the payment QR image inline.</em></p>
  </body>
</html>
`;
    const previewPath = resolve(__dirname, '../test-overdue-email-preview-existing-student.html');
    fs.writeFileSync(previewPath, previewHtml, 'utf8');
    console.log('✅ Saved HTML preview:', previewPath);

    const { sendOverduePaymentReminderEmail } = await import('../utils/emailService.js');
    const res = await sendOverduePaymentReminderEmail(payload);
    console.log('✅ Email send result:', res);
  } finally {
    client.release();
  }
}

main().catch((e) => {
  console.error('❌ Test send failed:', e?.message || e);
  process.exit(1);
});

