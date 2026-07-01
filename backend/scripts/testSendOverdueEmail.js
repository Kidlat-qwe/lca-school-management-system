import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '../.env') });

/**
 * Test script to send overdue payment reminder email
 * Usage: node backend/scripts/testSendOverdueEmail.js
 */
async function testSendOverdueEmail() {
  const testEmail = 'jericho@rhet-corp.com';
  
  console.log('📧 Testing Overdue Payment Reminder Email');
  console.log('==========================================');
  console.log(`Recipient: ${testEmail}`);
  console.log('');

  // SMTP Configuration
  const SMTP_HOST = process.env.SMTP_HOST;
  const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
  const SMTP_SECURE = process.env.SMTP_SECURE === 'true';
  const SMTP_USER = process.env.SMTP_USER;
  const SMTP_PASSWORD = process.env.SMTP_PASSWORD;
  // Use SMTP_USER as FROM to avoid sender rejection
  const SMTP_FROM = SMTP_USER || process.env.SMTP_FROM;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD) {
    console.error('❌ SMTP configuration is incomplete.');
    console.error('Please check your .env file has: SMTP_HOST, SMTP_USER, SMTP_PASSWORD');
    process.exit(1);
  }

  // Test data
  const testData = {
    to: testEmail,
    studentName: 'Test Student',
    invoiceId: 123,
    invoiceNumber: 'INV-123',
    invoiceDescription: 'Test Invoice - Installment Payment',
    amount: 5000.00,
    dueDate: '2026-01-15', // Past date to simulate overdue
    className: 'Pre-Kindergarten - Test Class',
  };

  console.log('Email Data:');
  console.log(JSON.stringify(testData, null, 2));
  console.log('');
  console.log('SMTP Configuration:');
  console.log(`  Host: ${SMTP_HOST}`);
  console.log(`  Port: ${SMTP_PORT}`);
  console.log(`  Secure: ${SMTP_SECURE}`);
  console.log(`  User: ${SMTP_USER}`);
  console.log(`  From: ${SMTP_FROM}`);
  console.log('');

  // Format amount as currency
  const formattedAmount = new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
  }).format(testData.amount);

  // Format due date
  const d = new Date(testData.dueDate);
  const formattedDueDate = Number.isNaN(d.getTime()) ? String(testData.dueDate) : [
    String(d.getUTCDate()).padStart(2, '0'),
    String(d.getUTCMonth() + 1).padStart(2, '0'),
    d.getUTCFullYear(),
  ].join('/');

  // Generate email HTML
  const emailHTML = `
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
        </style>
      </head>
      <body>
        <div class="header">
          <h1>LITTLE CHAMPIONS ACADEMY INC.</h1>
        </div>
        <div class="content">
          <h2>Payment Reminder - Overdue Invoice</h2>
          
          <p>Dear ${testData.studentName},</p>
          
          <div class="warning-box">
            <p><strong>⚠️ Important Notice:</strong> Your invoice payment is now overdue. Please settle your outstanding balance as soon as possible to avoid being dropped from your class.</p>
          </div>
          
          <p>We would like to remind you that you have an outstanding balance on the following invoice:</p>
          
          <div class="invoice-info">
            <div class="info-row"><strong>Invoice Number:</strong> ${testData.invoiceNumber}</div>
            ${testData.invoiceDescription ? `<div class="info-row"><strong>Description:</strong> ${testData.invoiceDescription}</div>` : ''}
            ${testData.className ? `<div class="info-row"><strong>Class:</strong> ${testData.className}</div>` : ''}
            <div class="info-row"><strong>Due Date:</strong> ${formattedDueDate}</div>
            <div class="info-row"><strong>Outstanding Balance:</strong> <span class="amount-highlight">${formattedAmount}</span></div>
          </div>
          
          <p><strong>Action Required:</strong></p>
          <p>Please pay your current balance immediately to avoid being dropped from your class. Failure to settle this invoice may result in automatic removal from your enrolled class.</p>
          
          <p>You can make your payment through any of the following methods:</p>
          <ul>
            <li>Visit our school office</li>
            <li>Bank transfer (contact us for account details)</li>
            <li>Mobile payment (GCash, PayMaya, etc.)</li>
          </ul>
          
          <div class="contact-info">
            <p><strong>If you have any questions or need assistance with payment arrangements, please contact us:</strong></p>
            <p>Facebook Page: <a href="https://www.facebook.com/littlechampionsacademy">https://www.facebook.com/littlechampionsacademy</a></p>
          </div>
          
          <p>We understand that circumstances may arise, and we're here to help. Please reach out to us if you need to discuss payment options or have any concerns.</p>
          
          <p>Thank you for your prompt attention to this matter.</p>
          
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
  `;

  // Save HTML to file for preview
  const htmlFilePath = resolve(__dirname, '../test-overdue-email-preview.html');
  fs.writeFileSync(htmlFilePath, emailHTML, 'utf8');
  
  console.log('✅ Email HTML content generated!');
  console.log(`📄 Saved to: ${htmlFilePath}`);
  console.log('');

  // Create transporter
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASSWORD,
    },
  });

  // Send email
  console.log('Sending email...');
  try {
    const mailOptions = {
      from: SMTP_FROM,
      to: testEmail,
      subject: `Payment Reminder - Overdue Invoice ${testData.invoiceNumber}`,
      html: emailHTML,
    };

    const info = await transporter.sendMail(mailOptions);
    
    console.log('');
    console.log('✅ Email sent successfully!');
    console.log('Message ID:', info.messageId);
    console.log('');
    console.log('Email Details:');
    console.log(`  From: ${SMTP_FROM}`);
    console.log(`  To: ${testEmail}`);
    console.log(`  Subject: Payment Reminder - Overdue Invoice ${testData.invoiceNumber}`);
    console.log('');
    console.log('Please check the inbox (and spam folder) for:', testEmail);
    console.log('');
    console.log('Email HTML preview also saved to:');
    console.log(`   ${htmlFilePath}`);
  } catch (error) {
    console.log('');
    console.error('❌ Error sending email:');
    console.error(error.message);
    console.log('');
    console.log('Email HTML preview has been saved to:');
    console.log(`   ${htmlFilePath}`);
    console.log('');
    console.log('You can open this file in your browser to see the email design.');
    
    if (error.code === 'EENVELOPE' && error.message.includes('Sender address rejected')) {
      console.log('');
      console.log('💡 Tip: The SMTP server requires the FROM address to match the authenticated user.');
      console.log(`   Current SMTP_USER: ${SMTP_USER}`);
      console.log(`   Current SMTP_FROM: ${process.env.SMTP_FROM || 'not set'}`);
      console.log(`   Using: ${SMTP_FROM}`);
      console.log('');
      console.log('   If this still fails, check your email server settings to allow this FROM address.');
    }
    
    process.exit(1);
  }
}

// Run the test
testSendOverdueEmail()
  .then(() => {
    console.log('');
    console.log('Test completed.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
