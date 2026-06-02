import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { resolve } from 'path';
import { dirname } from 'path';
import {
  computeDaysOverdue,
  formatDateDisplay,
  formatPhp,
  logTemplateRenderWarning,
  renderMessagingTemplate,
  wrapBrandedEmailHtml,
} from './templateRenderService.js';
import {
  sendMail,
  verifyEmailConnection,
  verifySMTPConnection,
  isEmailConfigured,
  isSmtpConfigured,
  getEmailConfigSummary,
  getSmtpConfigSummary,
  getNodemailerFromHeader,
  logSmtpFromMismatchWarning,
} from './emailTransport.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '../.env') });

logSmtpFromMismatchWarning();

const SMTP_FROM = getNodemailerFromHeader();

const requireEmailConfigured = () => {
  if (!isEmailConfigured()) {
    throw new Error(
      'Email is not configured. Set SENDGRID_API_KEY (recommended on Linode) or SMTP_HOST/SMTP_USER/SMTP_PASSWORD in backend/.env.'
    );
  }
};

export {
  verifyEmailConnection,
  verifySMTPConnection,
  isEmailConfigured,
  isSmtpConfigured,
  getEmailConfigSummary,
  getSmtpConfigSummary,
};

/**
 * Send invoice email to student with PDF attachment
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email address
 * @param {string} options.studentName - Student name
 * @param {number} options.invoiceId - Invoice ID
 * @param {string} options.invoiceNumber - Invoice number (e.g., INV-123)
 * @param {Buffer} options.pdfBuffer - PDF buffer to attach
 * @returns {Promise<Object>} Email send result
 */
export const sendInvoiceEmail = async ({
  to,
  studentName,
  invoiceId,
  invoiceNumber,
  pdfBuffer,
}) => {
  // Validate required fields
  if (!to || !studentName || !invoiceId || !pdfBuffer) {
    throw new Error('Missing required email parameters');
  }

  requireEmailConfigured();

  const mailOptions = {
    from: SMTP_FROM,
    to: to,
    subject: `Invoice Payment Confirmation - ${invoiceNumber}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }
            .header {
              background-color: #F7C844;
              padding: 20px;
              text-align: center;
              border-radius: 5px 5px 0 0;
            }
            .content {
              background-color: #ffffff;
              padding: 30px;
              border: 1px solid #e0e0e0;
              border-top: none;
            }
            .footer {
              background-color: #f5f5f5;
              padding: 20px;
              text-align: center;
              border-radius: 0 0 5px 5px;
              font-size: 12px;
              color: #666;
            }
            h1 {
              color: #000;
              margin: 0;
            }
            p {
              margin: 15px 0;
            }
            .invoice-info {
              background-color: #f9f9f9;
              padding: 15px;
              border-radius: 5px;
              margin: 20px 0;
            }
            .button {
              display: inline-block;
              padding: 12px 24px;
              background-color: #F7C844;
              color: #000;
              text-decoration: none;
              border-radius: 5px;
              font-weight: bold;
              margin: 20px 0;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>LITTLE CHAMPIONS ACADEMY INC.</h1>
          </div>
          <div class="content">
            <p>Dear ${studentName},</p>
            
            <p>Thank you for your payment! We have successfully received and processed your payment for the following invoice:</p>
            
            <div class="invoice-info">
              <strong>Invoice Number:</strong> ${invoiceNumber}<br>
              <strong>Invoice ID:</strong> ${invoiceId}
            </div>
            
            <p>Please find your invoice PDF attached to this email for your records.</p>
            
            <p>If you have any questions or concerns regarding this invoice, please don't hesitate to contact us through our Facebook Page: <a href="https://www.facebook.com/littlechampionsacademy">https://www.facebook.com/littlechampionsacademy</a></p>
            
            <p>Thank you for your continued support and commitment to your child&rsquo;s education. We look forward to another great month of learning and growth together.</p>

            <p>With appreciation,<br>
            <strong>Little Champions Academy Inc.</strong><br>
            Play. Learn. Succeed</p>
          </div>
          <div class="footer">
            <p>This is an automated email. Please do not reply to this message.</p>
            <p>© ${new Date().getFullYear()} Little Champions Academy, Inc. All rights reserved.</p>
          </div>
        </body>
      </html>
    `,
    attachments: [
      {
        filename: `invoice-${invoiceId}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  };

  try {
    const info = await sendMail({
      to,
      subject: mailOptions.subject,
      html: mailOptions.html,
      attachments: mailOptions.attachments,
    });
    console.log('✅ Invoice email sent successfully:', {
      to,
      messageId: info.messageId,
      invoiceId,
    });
    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error) {
    console.error('❌ Error sending invoice email:', error);
    throw error;
  }
};

/**
 * Send suspension notification email to student
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email address
 * @param {string} options.studentName - Student name
 * @param {string} options.className - Class name
 * @param {string} options.suspensionName - Suspension name (e.g., "Typhoon Paul")
 * @param {string} options.reason - Suspension reason
 * @param {string} options.startDate - Suspension start date (formatted)
 * @param {string} options.endDate - Suspension end date (formatted)
 * @param {string} options.description - Additional description (optional)
 * @param {boolean} options.autoReschedule - Whether sessions will be rescheduled
 * @returns {Promise<Object>} Email send result
 */
export const sendSuspensionEmail = async ({
  to,
  studentName,
  className,
  suspensionName,
  reason,
  startDate,
  endDate,
  description,
  autoReschedule,
}) => {
  // Validate required fields
  if (!to || !studentName || !className || !suspensionName || !reason || !startDate || !endDate) {
    throw new Error('Missing required email parameters');
  }

  requireEmailConfigured();

  // Format rescheduling message
  const rescheduleMessage = autoReschedule
    ? 'Affected sessions will be automatically rescheduled and you will be notified of the new dates.'
    : 'Please contact the school for information about rescheduling affected sessions.';

  const mailOptions = {
    from: SMTP_FROM,
    to: to,
    subject: `Class Suspension Notice - ${className}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }
            .header {
              background-color: #F7C844;
              padding: 20px;
              text-align: center;
              border-radius: 5px 5px 0 0;
            }
            .content {
              background-color: #ffffff;
              padding: 30px;
              border: 1px solid #e0e0e0;
              border-top: none;
            }
            .footer {
              background-color: #f5f5f5;
              padding: 20px;
              text-align: center;
              border-radius: 0 0 5px 5px;
              font-size: 12px;
              color: #666;
            }
            h1 {
              color: #000;
              margin: 0;
            }
            h2 {
              color: #333;
              margin: 20px 0 10px 0;
            }
            p {
              margin: 15px 0;
            }
            .suspension-info {
              background-color: #fff3cd;
              border-left: 4px solid #ffc107;
              padding: 15px;
              border-radius: 5px;
              margin: 20px 0;
            }
            .suspension-info strong {
              color: #856404;
            }
            .info-row {
              margin: 8px 0;
            }
            .contact-info {
              background-color: #f9f9f9;
              padding: 15px;
              border-radius: 5px;
              margin: 20px 0;
            }
            a {
              color: #F7C844;
              text-decoration: none;
            }
            a:hover {
              text-decoration: underline;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>LITTLE CHAMPIONS ACADEMY INC.</h1>
          </div>
          <div class="content">
            <h2>Class Suspension Notice</h2>
            
            <p>Dear ${studentName},</p>
            
            <p>We regret to inform you that your class has been suspended due to unforeseen circumstances.</p>
            
            <div class="suspension-info">
              <div class="info-row"><strong>Class:</strong> ${className}</div>
              <div class="info-row"><strong>Suspension:</strong> ${suspensionName}</div>
              <div class="info-row"><strong>Reason:</strong> ${reason}</div>
              <div class="info-row"><strong>Suspension Period:</strong> ${startDate} to ${endDate}</div>
            </div>
            
            ${description ? `<p><strong>Additional Information:</strong><br>${description.replace(/\n/g, '<br>')}</p>` : ''}
            
            <p><strong>Rescheduling:</strong><br>${rescheduleMessage}</p>
            
            <p>We apologize for any inconvenience this may cause. Your safety and well-being are our top priorities.</p>
            
            <div class="contact-info">
              <p><strong>If you have any questions or concerns, please contact us:</strong></p>
              <p>Facebook Page: <a href="https://www.facebook.com/littlechampionsacademy">https://www.facebook.com/littlechampionsacademy</a></p>
            </div>
            
            <p>Thank you for your understanding and continued support.</p>
            
            <p>Best regards,<br>
            <strong>Little Champions Academy, Inc.</strong><br>
            Play. Learn. Succeed.</p>
          </div>
          <div class="footer">
            <p>This is an automated email. Please do not reply to this message.</p>
            <p>© ${new Date().getFullYear()} Little Champions Academy, Inc. All rights reserved.</p>
          </div>
        </body>
      </html>
    `,
  };

  try {
    const info = await sendMail({
      to,
      subject: mailOptions.subject,
      html: mailOptions.html,
      attachments: mailOptions.attachments,
    });
    console.log('✅ Suspension email sent successfully:', {
      to,
      studentName,
      className,
      messageId: info.messageId,
    });
    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error) {
    console.error('❌ Error sending suspension email:', error);
    throw error;
  }
};

/**
 * Send overdue payment reminder email to student
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email address
 * @param {string} options.studentName - Student name
 * @param {number} options.invoiceId - Invoice ID
 * @param {string} options.invoiceNumber - Invoice number (e.g., INV-123)
 * @param {string} options.invoiceDescription - Invoice description
 * @param {number} options.amount - Outstanding balance amount
 * @param {string} options.dueDate - Due date (formatted)
 * @param {string} options.className - Class name (optional)
 * @returns {Promise<Object>} Email send result
 */
export const sendOverduePaymentReminderEmail = async ({
  to,
  parentName,
  studentName,
  invoiceId,
  invoiceNumber,
  invoiceDescription,
  amount,
  dueDate,
  className,
  centerName,
  facebookLink,
  branchId = null,
  phoneNumbers = [],
}) => {
  // Validate required fields
  if (!to || !invoiceId || !invoiceNumber || amount === undefined || !dueDate) {
    throw new Error('Missing required email parameters');
  }
  const hasRecipients =
    (typeof to === 'string' && to.trim() !== '') ||
    (Array.isArray(to) && to.filter((x) => String(x || '').trim() !== '').length > 0);
  if (!hasRecipients) {
    throw new Error('Missing required email parameters');
  }

  requireEmailConfigured();

  const formattedAmount = formatPhp(amount);
  const formattedDueDate = formatDateDisplay(dueDate);
  const daysOverdue = computeDaysOverdue(dueDate);
  const fbLink = facebookLink || 'https://www.facebook.com/littlechampionsacademy';
  const greetingName = parentName || studentName || 'Parent/Guardian';
  const visitCenterName = centerName || className || 'Little Champions Academy';

  const templateVariables = {
    recipientName: greetingName,
    studentName: studentName || 'Student',
    invoiceNumber: invoiceNumber || `INV-${invoiceId}`,
    dueDate: formattedDueDate,
    amountDue: formattedAmount,
    daysOverdue: String(daysOverdue),
    schoolName: visitCenterName,
    branchName: visitCenterName,
  };

  let subject = `Payment Reminder - Overdue Invoice ${invoiceNumber}`;
  let bodyHtml = wrapBrandedEmailHtml(`
    <p style="margin:0 0 16px;color:#111827;line-height:1.6;">Hello ${greetingName},</p>
    <p style="margin:0 0 16px;color:#111827;line-height:1.6;">This is a reminder that invoice ${invoiceNumber} for ${studentName || 'Student'} is ${daysOverdue} day(s) past due.</p>
    <p style="margin:0 0 16px;color:#111827;line-height:1.6;">Amount due: ${formattedAmount}<br/>Due date: ${formattedDueDate}</p>
  `);

  try {
    const rendered = await renderMessagingTemplate({
      templateKey: 'template_payment_reminder',
      branchId,
      variables: templateVariables,
    });

    if (rendered && rendered.enabled === false) {
      console.log('[emailService] Payment reminder template disabled; skipping email.', {
        invoiceId,
        invoiceNumber,
      });
      return { success: true, skipped: true, reason: 'template_disabled', smsSkipped: true };
    }

    if (rendered?.enabled) {
      subject =
        rendered.subject?.trim() ||
        rendered.title?.trim() ||
        subject;
      bodyHtml = rendered.bodyHtml;
    }
  } catch (templateErr) {
    await logTemplateRenderWarning('sendOverduePaymentReminderEmail template load', templateErr);
  }

  const qrBlock = `
    <div style="margin:20px 0;text-align:center;">
      <img style="width:100%;max-width:560px;border-radius:8px;border:1px solid #e5e7eb;display:block;margin:0 auto;"
           src="cid:payment_qr" alt="Payment QR Codes" />
    </div>
    <p style="margin:0 0 16px;color:#111827;line-height:1.6;">
      For assistance, message us via our Facebook Page
      <a href="${fbLink}" style="color:#F7C844;">${fbLink}</a>
      or visit <strong>${visitCenterName}</strong>.
    </p>`;

  bodyHtml = bodyHtml.replace(
    '<div style="background-color:#f5f5f5;',
    `${qrBlock}<div style="background-color:#f5f5f5;`
  );

  const mailOptions = {
    from: SMTP_FROM,
    to,
    subject,
    attachments: [
      {
        filename: 'payment-qr.png',
        path: fileURLToPath(new URL('../assets/payment-qr.png', import.meta.url)),
        cid: 'payment_qr',
      },
    ],
    html: bodyHtml,
  };

  try {
    const info = await sendMail({
      to,
      subject: mailOptions.subject,
      html: mailOptions.html,
      attachments: mailOptions.attachments,
    });
    console.log('✅ Overdue payment reminder email sent successfully:', {
      to,
      studentName,
      invoiceId,
      invoiceNumber,
      messageId: info.messageId,
    });

    let sms = { skipped: true, reason: 'not_attempted' };
    try {
      const { sendPairedTemplateSms } = await import('./sms/templateSmsService.js');
      sms = await sendPairedTemplateSms({
        templateKey: 'template_payment_reminder',
        branchId,
        variables: templateVariables,
        phoneNumbers,
      });
    } catch (smsErr) {
      console.error('[emailService] Payment reminder SMS after email:', smsErr?.message || smsErr);
      sms = { success: false, error: smsErr?.message || String(smsErr) };
    }

    return {
      success: true,
      messageId: info.messageId,
      sms,
    };
  } catch (error) {
    console.error('❌ Error sending overdue payment reminder email:', error);
    throw error;
  }
};

/**
 * Email sent when a monthly installment invoice is auto-generated (25th issue, due 5th).
 * Includes payment QR codes (same as overdue reminder).
 */
export const sendMonthlyInvoiceNoticeEmail = async ({
  to,
  subject,
  bodyHtml,
  invoiceId,
  invoiceNumber,
  studentName,
}) => {
  const normalizedRecipients = Array.isArray(to)
    ? to.map((x) => String(x || '').trim()).filter(Boolean)
    : [String(to || '').trim()].filter(Boolean);

  if (normalizedRecipients.length === 0 || !subject || !bodyHtml) {
    throw new Error('Missing required email parameters');
  }

  requireEmailConfigured();

  const fbLink = 'https://www.facebook.com/littlechampionsacademy';
  const qrBlock = `
    <div style="margin:20px 0;text-align:center;">
      <img style="width:100%;max-width:560px;border-radius:8px;border:1px solid #e5e7eb;display:block;margin:0 auto;"
           src="cid:payment_qr" alt="Payment QR Codes" />
    </div>
    <p style="margin:0 0 16px;color:#111827;line-height:1.6;">
      For assistance, message us via our Facebook Page
      <a href="${fbLink}" style="color:#F7C844;">${fbLink}</a>.
    </p>`;

  let html = bodyHtml;
  if (html.includes('<div style="background-color:#f5f5f5;')) {
    html = html.replace('<div style="background-color:#f5f5f5;', `${qrBlock}<div style="background-color:#f5f5f5;`);
  } else {
    html = `${html}${qrBlock}`;
  }

  const mailOptions = {
    from: SMTP_FROM,
    to: normalizedRecipients,
    subject,
    attachments: [
      {
        filename: 'payment-qr.png',
        path: fileURLToPath(new URL('../assets/payment-qr.png', import.meta.url)),
        cid: 'payment_qr',
      },
    ],
    html,
  };

  try {
    const info = await sendMail({
      to,
      subject: mailOptions.subject,
      html: mailOptions.html,
      attachments: mailOptions.attachments,
    });
    console.log('✅ Monthly invoice notice email sent:', {
      to: normalizedRecipients,
      invoiceId,
      invoiceNumber,
      studentName,
      messageId: info.messageId,
    });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Error sending monthly invoice notice email:', error);
    throw error;
  }
};

/**
 * Send generic system notification email.
 * @param {Object} options
 * @param {string|string[]} options.to - Recipient email(s)
 * @param {string} options.subject - Email subject
 * @param {string} options.html - Email HTML body
 * @returns {Promise<Object>} Email send result
 */
export const sendSystemNotificationEmail = async ({
  to,
  subject,
  html,
  attachments = [],
}) => {
  const normalizedRecipients = Array.isArray(to)
    ? to.map((x) => String(x || '').trim()).filter(Boolean)
    : [String(to || '').trim()].filter(Boolean);

  if (normalizedRecipients.length === 0 || !subject || !html) {
    throw new Error('Missing required email parameters');
  }

  if (!isEmailConfigured()) {
    throw new Error('Email is not configured. Please check your .env file.');
  }

  const normalizedAttachments = Array.isArray(attachments)
    ? attachments
        .filter((att) => att && (att.content || att.path))
        .map((att) => ({
          filename: att.filename || 'attachment.pdf',
          content: att.content,
          path: att.path,
          contentType: att.contentType || 'application/pdf',
        }))
    : [];

  try {
    const info = await sendMail({
      to: normalizedRecipients,
      subject,
      html,
      attachments: normalizedAttachments,
    });
    console.log('✅ System notification email sent successfully:', {
      to: normalizedRecipients,
      messageId: info.messageId,
      subject,
    });
    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error) {
    console.error('❌ Error sending system notification email:', error);
    throw error;
  }
};

const BASIC_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Dedupe and drop invalid-looking addresses (empty / no @).
 */
export const normalizeNotificationRecipients = (list) => {
  const seen = new Set();
  const out = [];
  for (const r of list || []) {
    const e = String(r || '').trim();
    if (!e || !BASIC_EMAIL_RE.test(e)) continue;
    const k = e.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
};

/**
 * Send the same system notification to each recipient in separate SMTP transactions.
 * More reliable than one message with many To: addresses on strict providers.
 */
export const sendSystemNotificationEmailToEach = async ({
  recipients,
  subject,
  html,
  attachments = [],
}) => {
  const unique = normalizeNotificationRecipients(recipients);
  const summary = { attempted: unique.length, sent: 0, failed: 0, errors: [] };
  for (const email of unique) {
    try {
      await sendSystemNotificationEmail({ to: email, subject, html, attachments });
      summary.sent += 1;
    } catch (e) {
      summary.failed += 1;
      const message = e?.message || String(e);
      summary.errors.push({ email, message });
      console.error(`[emailService] sendSystemNotificationEmailToEach failed for ${email}:`, message);
    }
  }
  return summary;
};

export default {
  verifyEmailConnection,
  verifySMTPConnection,
  isEmailConfigured,
  isSmtpConfigured,
  getEmailConfigSummary,
  getSmtpConfigSummary,
  sendInvoiceEmail,
  sendSuspensionEmail,
  sendOverduePaymentReminderEmail,
  sendMonthlyInvoiceNoticeEmail,
  sendSystemNotificationEmail,
  sendSystemNotificationEmailToEach,
  normalizeNotificationRecipients,
};

