import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
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
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER; // Default to SMTP_USER if not set

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

export default {
  verifySMTPConnection,
  sendInvoiceEmail,
  sendSuspensionEmail,
};

