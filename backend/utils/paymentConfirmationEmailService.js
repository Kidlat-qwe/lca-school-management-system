import {
  normalizeNotificationRecipients,
  sendSystemNotificationEmailToEach,
} from './emailService.js';
import { buildArPdfAttachmentForPaymentConfirmation } from './paymentArPdfAttachment.js';
import { collectPhilippineMobiles } from './sms/semaphoreSmsService.js';
import { sendPairedTemplateSms } from './sms/templateSmsService.js';
import {
  DEFAULT_SCHOOL_NAME,
  formatDateYmd,
  formatPhp,
  logTemplateRenderWarning,
  renderMessagingTemplate,
} from './templateRenderService.js';

const buildInvoicePaidHtmlFallback = ({
  greetingName,
  studentName,
  invoiceId,
  invoiceDescription,
  issueDate,
  dueDate,
  amountPaid,
  branchName,
}) => {
  const escapeHtml = (value) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  return `
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
      Your acknowledgement receipt is attached to this email as a PDF for your records.
    </p>
    <p style="margin:0 0 12px 0">
      Thank you for your payment. If you have questions, please message our Facebook page:
      <a href="https://www.facebook.com/littlechampionsacademy">Little Champions Academy</a>.
    </p>
    <p style="margin:0">${escapeHtml(DEFAULT_SCHOOL_NAME)}</p>
  </div>
`;
};

const buildArPaidHtml = ({
  studentName,
  ackReceiptId,
  ackReceiptNumber,
  issueDate,
  amountPaid,
  referenceNumber,
}) => {
  const escapeHtml = (value) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  return `
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
    <p style="margin:0 0 12px 0">
      Your acknowledgement receipt is attached to this email as a PDF for your records.
    </p>
    <p style="margin:0">Thank you for choosing ${escapeHtml(DEFAULT_SCHOOL_NAME)}</p>
  </div>
`;
};

function toEmailAttachments(pdfResult) {
  if (!pdfResult?.buffer) return [];
  return [
    {
      filename: pdfResult.filename || 'acknowledgement-receipt.pdf',
      content: pdfResult.buffer,
      contentType: 'application/pdf',
    },
  ];
}

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
            u.phone_number AS student_phone,
            g.guardian_name, g.email AS guardian_email, g.guardian_phone_number
     FROM invoicestudentstbl ist
     JOIN userstbl u ON u.user_id = ist.student_id
     LEFT JOIN LATERAL (
       SELECT guardian_name, email, guardian_phone_number
       FROM guardianstbl
       WHERE student_id = ist.student_id
       ORDER BY guardian_id ASC
       LIMIT 1
     ) g ON TRUE
     WHERE ist.invoice_id = $1`,
    [invoiceId]
  );

  const paymentTotalRes = await client.query(
    `SELECT COALESCE(SUM(payable_amount), 0)::numeric AS total_paid,
            MAX(issue_date) AS latest_payment_date
     FROM paymenttbl
     WHERE invoice_id = $1
       AND status = 'Completed'`,
    [invoiceId]
  );
  const amountPaid = Number(paymentTotalRes.rows[0]?.total_paid || 0);
  const paymentDate = paymentTotalRes.rows[0]?.latest_payment_date || invoice.issue_date;
  const invoiceNumber = invoice.invoice_description || `INV-${invoice.invoice_id}`;

  let arPdfAttachment = [];
  try {
    const pdf = await buildArPdfAttachmentForPaymentConfirmation(client, { invoiceId });
    arPdfAttachment = toEmailAttachments(pdf);
  } catch (pdfErr) {
    console.error(
      `sendInvoicePaymentConfirmationByInvoiceId: AR PDF attachment failed for invoice ${invoiceId}:`,
      pdfErr?.message || pdfErr
    );
  }

  const summary = { attempted: 0, sent: 0, failed: 0, smsSent: 0, errors: [], arPdfAttached: arPdfAttachment.length > 0 };
  for (const row of studentsRes.rows) {
    const recipients = normalizeNotificationRecipients([row.student_email, row.guardian_email]);
    if (recipients.length === 0) continue;

    const greetingName = row.guardian_name || row.student_name || 'Client';
    const studentName = row.student_name || 'Student';
    const phoneNumbers = collectPhilippineMobiles(row.guardian_phone_number, row.student_phone);
    const templateVariables = {
      recipientName: greetingName,
      studentName,
      invoiceNumber,
      amountPaid: formatPhp(amountPaid),
      paymentDate: formatDateYmd(paymentDate),
      schoolName: invoice.branch_name || DEFAULT_SCHOOL_NAME,
      branchName: invoice.branch_name || '',
    };

    let subject = `Payment Received - Invoice INV-${invoice.invoice_id}`;
    let html = buildInvoicePaidHtmlFallback({
      greetingName,
      studentName,
      invoiceId: invoice.invoice_id,
      invoiceDescription: invoice.invoice_description,
      issueDate: invoice.issue_date,
      dueDate: invoice.due_date,
      amountPaid,
      branchName: invoice.branch_name,
    });

    try {
      const rendered = await renderMessagingTemplate({
        client,
        templateKey: 'template_payment_confirmation',
        branchId: invoice.branch_id,
        variables: templateVariables,
      });

      if (rendered && rendered.enabled === false) {
        continue;
      }

      if (rendered?.enabled) {
        subject =
          rendered.subject?.trim() ||
          rendered.title?.trim() ||
          subject;
        html = rendered.bodyHtml;
      }
    } catch (templateErr) {
      await logTemplateRenderWarning('sendInvoicePaymentConfirmationByInvoiceId template load', templateErr);
    }

    const result = await sendSystemNotificationEmailToEach({
      recipients,
      subject,
      html,
      attachments: arPdfAttachment,
    });
    summary.attempted += result.attempted;
    summary.sent += result.sent;
    summary.failed += result.failed;
    if (result.errors?.length) summary.errors.push(...result.errors);

    if (result.sent > 0) {
      const smsResult = await sendPairedTemplateSms({
        templateKey: 'template_payment_confirmation',
        branchId: invoice.branch_id,
        variables: templateVariables,
        phoneNumbers,
      });
      if (smsResult?.success) summary.smsSent += 1;
    }
  }
  return summary;
};

export const sendArPaymentConfirmationByAckId = async (client, ackReceiptId) => {
  const ackRes = await client.query(
    `SELECT ar.ack_receipt_id, ar.ack_receipt_number, ar.prospect_student_name, ar.prospect_student_email,
            ar.prospect_student_phone, ar.issue_date, ar.payment_amount, ar.reference_number, ar.branch_id,
            i.invoice_ar_number
     FROM acknowledgement_receiptstbl ar
     LEFT JOIN invoicestbl i ON i.invoice_id = ar.invoice_id
     WHERE ar.ack_receipt_id = $1
     LIMIT 1`,
    [ackReceiptId]
  );
  if (ackRes.rows.length === 0) {
    return { attempted: 0, sent: 0, failed: 0, smsSent: 0, errors: [{ message: 'Acknowledgement receipt not found' }] };
  }

  const ack = ackRes.rows[0];
  const recipients = normalizeNotificationRecipients([ack.prospect_student_email]);
  const phoneNumbers = collectPhilippineMobiles(ack.prospect_student_phone);
  if (recipients.length === 0 && phoneNumbers.length === 0) {
    return { attempted: 0, sent: 0, failed: 0, smsSent: 0, errors: [] };
  }

  const ackNumber = ack.invoice_ar_number || ack.ack_receipt_number || `AR-${ack.ack_receipt_id}`;
  const templateVariables = {
    recipientName: ack.prospect_student_name || 'Client',
    studentName: ack.prospect_student_name || 'Student',
    invoiceNumber: ackNumber,
    amountPaid: formatPhp(ack.payment_amount),
    paymentDate: formatDateYmd(ack.issue_date),
    schoolName: DEFAULT_SCHOOL_NAME,
  };

  let subject = `Payment Received - ${ackNumber}`;
  let html = buildArPaidHtml({
    studentName: ack.prospect_student_name,
    ackReceiptId: ack.ack_receipt_id,
    ackReceiptNumber: ackNumber,
    issueDate: ack.issue_date,
    amountPaid: ack.payment_amount,
    referenceNumber: ack.reference_number,
  });

  try {
    const rendered = await renderMessagingTemplate({
      client,
      templateKey: 'template_payment_confirmation',
      branchId: ack.branch_id,
      variables: templateVariables,
    });

    if (rendered && rendered.enabled === false) {
      return { attempted: 0, sent: 0, failed: 0, smsSent: 0, errors: [], skipped: true };
    }

    if (rendered?.enabled) {
      subject = rendered.subject?.trim() || rendered.title?.trim() || subject;
      html = rendered.bodyHtml;
    }
  } catch (templateErr) {
    await logTemplateRenderWarning('sendArPaymentConfirmationByAckId template load', templateErr);
  }

  let arPdfAttachment = [];
  try {
    const pdf = await buildArPdfAttachmentForPaymentConfirmation(client, { ackReceiptId });
    arPdfAttachment = toEmailAttachments(pdf);
  } catch (pdfErr) {
    console.error(
      `sendArPaymentConfirmationByAckId: AR PDF attachment failed for AR ${ackReceiptId}:`,
      pdfErr?.message || pdfErr
    );
  }

  const summary = { attempted: 0, sent: 0, failed: 0, smsSent: 0, errors: [], arPdfAttached: arPdfAttachment.length > 0 };

  if (recipients.length > 0) {
    const result = await sendSystemNotificationEmailToEach({
      recipients,
      subject,
      html,
      attachments: arPdfAttachment,
    });
    summary.attempted += result.attempted;
    summary.sent += result.sent;
    summary.failed += result.failed;
    if (result.errors?.length) summary.errors.push(...result.errors);
  }

  const shouldSendSms =
    phoneNumbers.length > 0 && (recipients.length === 0 || summary.sent > 0);
  if (shouldSendSms) {
    const smsResult = await sendPairedTemplateSms({
      templateKey: 'template_payment_confirmation',
      branchId: ack.branch_id,
      variables: templateVariables,
      phoneNumbers,
    });
    if (smsResult?.success) summary.smsSent += 1;
  }

  return summary;
};
