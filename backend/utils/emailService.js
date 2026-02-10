import nodemailer from 'nodemailer';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { resolve } from 'path';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '../.env') });

// SMTP Configuration
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_SECURE = process.env.SMTP_SECURE === 'true'; // true for 465, false for other ports
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASSWORD = process.env.SMTP_PASSWORD;
// IMPORTANT:
// - The SMTP envelope "from" must be owned by SMTP_USER to avoid sender rejection.
// - We set the display name to "no-reply" while keeping the actual email address as SMTP_FROM/SMTP_USER.
const SMTP_FROM_EMAIL = process.env.SMTP_FROM || SMTP_USER; // must be a real/owned mailbox
const SMTP_FROM = SMTP_FROM_EMAIL ? `no-reply <${SMTP_FROM_EMAIL}>` : undefined;

// Create transporter
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_SECURE, // true for 465, false for other ports
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASSWORD,
  },
});

/**
 * Verify SMTP connection
 * @returns {Promise<boolean>} True if connection is successful
 */
export const verifySMTPConnection = async () => {
  try {
    await transporter.verify();
    console.log('✅ SMTP server is ready to send emails');
    return true;
  } catch (error) {
    console.error('❌ SMTP connection error:', error);
    return false;
  }
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

  // Validate SMTP configuration
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD) {
    throw new Error('SMTP configuration is incomplete. Please check your .env file.');
  }

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
            
            <p>Thank you for choosing Little Champions Academy. We appreciate your trust and support!</p>
            
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
    attachments: [
      {
        filename: `invoice-${invoiceId}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  };

  try {
    const info = await transporter.sendMail(mailOptions);
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

  // Validate SMTP configuration
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD) {
    throw new Error('SMTP configuration is incomplete. Please check your .env file.');
  }

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
    const info = await transporter.sendMail(mailOptions);
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

  // Validate SMTP configuration
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD) {
    throw new Error('SMTP configuration is incomplete. Please check your .env file.');
  }

  // Format amount as currency
  const formattedAmount = new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
  }).format(amount);

  // Format due date
  const d = new Date(dueDate);
  const formattedDueDate = Number.isNaN(d.getTime()) ? String(dueDate) : [
    String(d.getUTCDate()).padStart(2, '0'),
    String(d.getUTCMonth() + 1).padStart(2, '0'),
    d.getUTCFullYear(),
  ].join('/');

  const fbLink = facebookLink || 'https://www.facebook.com/littlechampionsacademy';
  const greetingName = parentName || studentName || 'Parent/Guardian';
  const visitCenterName = centerName || className || 'Little Champions Academy';

  const mailOptions = {
    from: SMTP_FROM,
    to,
    subject: `Payment Reminder - Overdue Invoice ${invoiceNumber}`,
    attachments: [
      {
        filename: 'payment-qr.png',
        path: fileURLToPath(new URL('../assets/payment-qr.png', import.meta.url)),
        cid: 'payment_qr',
      },
    ],
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
              color: #d32f2f;
              margin: 20px 0 10px 0;
            }
            p {
              margin: 15px 0;
            }
            .warning-box {
              background-color: #fff3cd;
              border-left: 4px solid #ffc107;
              padding: 15px;
              border-radius: 5px;
              margin: 20px 0;
            }
            .invoice-info {
              background-color: #f9f9f9;
              padding: 15px;
              border-radius: 5px;
              margin: 20px 0;
            }
            .invoice-info strong {
              color: #333;
            }
            .info-row {
              margin: 8px 0;
            }
            .amount-highlight {
              font-size: 18px;
              font-weight: bold;
              color: #d32f2f;
            }
            .contact-info {
              background-color: #e3f2fd;
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
            .qr-wrap {
              margin: 20px 0;
              text-align: center;
            }
            .qr-img {
              width: 100%;
              max-width: 560px;
              border-radius: 8px;
              border: 1px solid #e5e7eb;
              display: block;
              margin: 0 auto;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>LITTLE CHAMPIONS ACADEMY INC.</h1>
          </div>
          <div class="content">
            <p>Hello ${greetingName},</p>

            <p>Good day! This is from Little Champions Academy.</p>

            <p>
              This is a gentle reminder that your child’s account has an outstanding balance.
              To avoid any disruption in their classes, we encourage you to settle it at your earliest convenience
              using the attached payment QR codes.
            </p>

            <p>
              <strong>The information in this email applies to the branch where your child is enrolled: ${visitCenterName}.</strong>
            </p>

            <div class="invoice-info">
              <div class="info-row"><strong>Invoice:</strong> ${invoiceNumber}</div>
              ${invoiceDescription ? `<div class="info-row"><strong>Description:</strong> ${invoiceDescription}</div>` : ''}
              <div class="info-row"><strong>Due Date:</strong> ${formattedDueDate}</div>
              <div class="info-row"><strong>Outstanding Balance:</strong> <span class="amount-highlight">${formattedAmount}</span></div>
            </div>

            <div class="qr-wrap">
              <img class="qr-img" src="cid:payment_qr" alt="Payment QR Codes" />
            </div>

            <p>If you’ve already paid, kindly disregard this message.</p>

            <p>
              For assistance or payment arrangements, you may message us via our Facebook Page
              <a href="${fbLink}">${fbLink}</a> or visit <strong>${visitCenterName}</strong> (the branch where your child is enrolled).
            </p>

            <p>Thank you, and we look forward to continuing your child’s learning journey!</p>

            <p>Warm regards,<br>
              <strong>Little Champions Academy, Inc.</strong><br>
              Play. Learn. Succeed.
            </p>
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
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Overdue payment reminder email sent successfully:', {
      to,
      studentName,
      invoiceId,
      invoiceNumber,
      messageId: info.messageId,
    });
    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error) {
    console.error('❌ Error sending overdue payment reminder email:', error);
    throw error;
  }
};

export default {
  verifySMTPConnection,
  sendInvoiceEmail,
  sendSuspensionEmail,
  sendOverduePaymentReminderEmail,
};

