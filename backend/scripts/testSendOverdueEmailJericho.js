import dotenv from 'dotenv';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../.env') });

/**
 * Test script: sends the overdue reminder email to jericho@rhet-corp.com
 * Uses the same template as production (emailService.js) and saves an HTML preview.
 *
 * Run (PowerShell):
 *   node backend/scripts/testSendOverdueEmailJericho.js
 */
async function main() {
  const to = 'jericho@rhet-corp.com';

  // Ensure FROM matches SMTP auth user to avoid "Sender address rejected"
  if (process.env.SMTP_USER) {
    process.env.SMTP_FROM = process.env.SMTP_USER;
  }

  const testPayload = {
    to,
    parentName: 'Test Parent',
    studentName: 'Test Student',
    invoiceId: 123,
    invoiceNumber: 'INV-123',
    invoiceDescription: 'Test Invoice - Outstanding Balance Reminder',
    amount: 5000,
    dueDate: '2026-01-15',
    className: 'Pre-Kindergarten - Test Class',
    centerName: 'Little Champions Academy Inc - Vista Mall Malolos',
    facebookLink: 'https://www.facebook.com/littlechampionsacademy',
  };

  console.log('📧 Sending overdue reminder email (test)');
  console.log('Recipient:', to);
  console.log('Payload:', JSON.stringify(testPayload, null, 2));

  // Save HTML preview (matches email template intent; image shown in real email via CID)
  const previewHtml = `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Overdue Reminder Preview</title>
  </head>
  <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 700px; margin: 0 auto; padding: 20px;">
    <h2>Preview (will embed QR in actual email)</h2>
    <p><strong>Hello ${testPayload.parentName},</strong></p>
    <p>Good day! This is from Little Champions Academy.</p>
    <p>
      This is a gentle reminder that your child’s account has an outstanding balance. To avoid any disruption in their classes,
      we encourage you to settle it at your earliest convenience using the attached payment QR codes.
    </p>
    <p><strong>Invoice:</strong> ${testPayload.invoiceNumber}</p>
    <p><strong>Description:</strong> ${testPayload.invoiceDescription}</p>
    <p><strong>Outstanding Balance:</strong> ${new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(testPayload.amount)}</p>
    <p><strong>Due Date:</strong> ${testPayload.dueDate}</p>
    <p><strong>Facebook:</strong> <a href="${testPayload.facebookLink}">${testPayload.facebookLink}</a></p>
    <p><strong>Visit:</strong> ${testPayload.centerName}</p>
    <hr />
    <p><em>Note: The QR image is embedded in the real email and will display there.</em></p>
  </body>
</html>
`;

  const previewPath = resolve(__dirname, '../test-overdue-email-preview-jericho.html');
  fs.writeFileSync(previewPath, previewHtml, 'utf8');
  console.log('✅ Saved HTML preview:', previewPath);

  const { sendOverduePaymentReminderEmail } = await import('../utils/emailService.js');
  const res = await sendOverduePaymentReminderEmail(testPayload);
  console.log('✅ Email send result:', res);
}

main().catch((e) => {
  console.error('❌ Test send failed:', e?.message || e);
  process.exit(1);
});

