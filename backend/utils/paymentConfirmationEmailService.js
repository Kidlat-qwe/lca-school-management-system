import {
  normalizeNotificationRecipients,
  sendSystemNotificationEmailToEach,
} from './emailService.js';

const formatPhp = (amount) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(amount) || 0);

const formatDateYmd = (value) => {
  if (!value) return 'N/A';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toISOString().slice(0, 10);
};

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const buildInvoicePaidHtml = ({
  greetingName,
  studentName,
  invoiceId,
  invoiceDescription,
  issueDate,
  dueDate,
  amountPaid,
  branchName,
}) => `
  <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2937;max-width:640px">
    <h2 style="margin:0 0 12px 0">Payment Confirmation</h2>
    <p style="margin:0 0 12px 0">Hello ${escapeHtml(greetingName)},</p>
    <p style="margin:0 0 12px 0">
      This is to confirm we received your payment for <strong>${escapeHtml(studentName)}</strong>.
    </p>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;margin:0 0 14px 0">
      <div><strong>Invoice:</strong> INV-${escapeHtml(invoiceId)}</div>
      ${invoiceDescription ? `<div><strong>Description:</strong> ${escapeHtml(invoiceDescription)}</div>` : ''}
      <div><strong>Issue Date:</strong> ${escapeHtml(formatDateYmd(issueDate))}</div>
      <div><strong>Due Date:</strong> ${escapeHtml(formatDateYmd(dueDate))}</div>
      <div><strong>Paid Amount:</strong> ${escapeHtml(formatPhp(amountPaid))}</div>
      ${branchName ? `<div><strong>Branch:</strong> ${escapeHtml(branchName)}</div>` : ''}
    </div>
    <p style="margin:0 0 12px 0">
      Thank you for your payment. If you have questions, please message our Facebook page:
      <a href="https://www.facebook.com/littlechampionsacademy">Little Champions Academy</a>.
    </p>
    <p style="margin:0">Little Champions Academy, Inc.</p>
  </div>
`;

const buildArPaidHtml = ({
  studentName,
  recipientEmail,
  ackReceiptId,
  ackReceiptNumber,
  issueDate,
  amountPaid,
  referenceNumber,
}) => `
  <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2937;max-width:640px">
    <h2 style="margin:0 0 12px 0">Acknowledgement Receipt Payment Confirmation</h2>
    <p style="margin:0 0 12px 0">
      Good day, Parents! We already received your payment for student ${escapeHtml(studentName || 'N/A')}.
    </p>
    <p style="margin:0 0 12px 0">
      This confirms your acknowledgement receipt payment has been recorded successfully.
    </p>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;margin:0 0 14px 0">
      <div><strong>AR Number:</strong> ${escapeHtml(ackReceiptNumber || `AR-${ackReceiptId}`)}</div>
      <div><strong>Issue Date:</strong> ${escapeHtml(formatDateYmd(issueDate))}</div>
      <div><strong>Paid Amount:</strong> ${escapeHtml(formatPhp(amountPaid))}</div>
      ${referenceNumber ? `<div><strong>Reference Number:</strong> ${escapeHtml(referenceNumber)}</div>` : ''}
    </div>
    <p style="margin:0">Thank you for choosing Little Champions Academy, Inc.</p>
  </div>
`;

export const sendInvoicePaymentConfirmationByInvoiceId = async (client, invoiceId) => {
  const invoiceRes = await client.query(
    `SELECT i.invoice_id, i.invoice_description, i.issue_date, i.due_date, i.branch_id,
            COALESCE(b.branch_nickname, b.branch_name) AS branch_name
     FROM invoicestbl i
     LEFT JOIN branchestbl b ON b.branch_id = i.branch_id
     WHERE i.invoice_id = $1
     LIMIT 1`,
    [invoiceId]
  );
  if (invoiceRes.rows.length === 0) {
    return { attempted: 0, sent: 0, failed: 0, errors: [{ message: 'Invoice not found' }] };
  }

  const invoice = invoiceRes.rows[0];
  const studentsRes = await client.query(
    `SELECT DISTINCT u.user_id AS student_id, u.full_name AS student_name, u.email AS student_email,
            g.guardian_name, g.email AS guardian_email
     FROM invoicestudentstbl ist
     JOIN userstbl u ON u.user_id = ist.student_id
     LEFT JOIN LATERAL (
       SELECT guardian_name, email
       FROM guardianstbl
       WHERE student_id = ist.student_id
       ORDER BY guardian_id ASC
       LIMIT 1
     ) g ON TRUE
     WHERE ist.invoice_id = $1`,
    [invoiceId]
  );

  const paymentTotalRes = await client.query(
    `SELECT COALESCE(SUM(payable_amount), 0)::numeric AS total_paid
     FROM paymenttbl
     WHERE invoice_id = $1
       AND status = 'Completed'`,
    [invoiceId]
  );
  const amountPaid = Number(paymentTotalRes.rows[0]?.total_paid || 0);

  const summary = { attempted: 0, sent: 0, failed: 0, errors: [] };
  for (const row of studentsRes.rows) {
    const recipients = normalizeNotificationRecipients([row.student_email, row.guardian_email]);
    if (recipients.length === 0) continue;

    const html = buildInvoicePaidHtml({
      greetingName: row.guardian_name || row.student_name || 'Client',
      studentName: row.student_name || 'Student',
      invoiceId: invoice.invoice_id,
      invoiceDescription: invoice.invoice_description,
      issueDate: invoice.issue_date,
      dueDate: invoice.due_date,
      amountPaid,
      branchName: invoice.branch_name,
    });

    const result = await sendSystemNotificationEmailToEach({
      recipients,
      subject: `Payment Received - Invoice INV-${invoice.invoice_id}`,
      html,
    });
    summary.attempted += result.attempted;
    summary.sent += result.sent;
    summary.failed += result.failed;
    if (result.errors?.length) summary.errors.push(...result.errors);
  }
  return summary;
};

export const sendArPaymentConfirmationByAckId = async (client, ackReceiptId) => {
  const ackRes = await client.query(
    `SELECT ar.ack_receipt_id, ar.ack_receipt_number, ar.prospect_student_name, ar.prospect_student_email, ar.issue_date,
            ar.payment_amount, ar.reference_number, i.invoice_ar_number
     FROM acknowledgement_receiptstbl
     ar
     LEFT JOIN invoicestbl i ON i.invoice_id = ar.invoice_id
     WHERE ar.ack_receipt_id = $1
     LIMIT 1`,
    [ackReceiptId]
  );
  if (ackRes.rows.length === 0) {
    return { attempted: 0, sent: 0, failed: 0, errors: [{ message: 'Acknowledgement receipt not found' }] };
  }

  const ack = ackRes.rows[0];
  const recipients = normalizeNotificationRecipients([ack.prospect_student_email]);
  if (recipients.length === 0) return { attempted: 0, sent: 0, failed: 0, errors: [] };

  return sendSystemNotificationEmailToEach({
    recipients,
    subject: `Payment Received - ${ack.invoice_ar_number || ack.ack_receipt_number || `AR-${ack.ack_receipt_id}`}`,
    html: buildArPaidHtml({
      studentName: ack.prospect_student_name,
      recipientEmail: recipients[0],
      ackReceiptId: ack.ack_receipt_id,
      ackReceiptNumber: ack.invoice_ar_number || ack.ack_receipt_number || null,
      issueDate: ack.issue_date,
      amountPaid: ack.payment_amount,
      referenceNumber: ack.reference_number,
    }),
  });
};
