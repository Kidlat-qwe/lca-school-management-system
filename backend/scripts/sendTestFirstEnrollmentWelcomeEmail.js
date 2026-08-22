/**
 * One-off: clear first-enrollment welcome idempotency logs and send the
 * current welcome email body to a student (for format verification).
 *
 *   node backend/scripts/sendTestFirstEnrollmentWelcomeEmail.js
 *   node backend/scripts/sendTestFirstEnrollmentWelcomeEmail.js --email=someone@example.com
 */

import '../config/loadEnv.js';
import { query } from '../config/database.js';
import {
  buildFirstEnrollmentWelcomePlainText,
  maybeSendFirstEnrollmentWelcomeEmail,
} from '../utils/firstEnrollmentWelcomeEmail/index.js';
import {
  isEmailConfigured,
  normalizeNotificationRecipients,
  sendSystemNotificationEmailToEach,
} from '../utils/emailService.js';
import { plainTextToEmailHtml } from '../utils/templateRenderService.js';

const emailArg = process.argv.find((a) => a.startsWith('--email='));
const targetEmail = (emailArg ? emailArg.slice('--email='.length) : 'it.kier@little-champion.com')
  .trim()
  .toLowerCase();

async function main() {
  console.log('Welcome body preview:\n');
  console.log(buildFirstEnrollmentWelcomePlainText());
  console.log('\n---\n');

  if (!isEmailConfigured()) {
    throw new Error('Email is not configured in backend/.env');
  }

  const studentRes = await query(
    `SELECT user_id, full_name, email
     FROM userstbl
     WHERE user_type = 'Student'
       AND LOWER(TRIM(email)) = $1
     LIMIT 1`,
    [targetEmail]
  );

  if (studentRes.rows.length === 0) {
    // Still send a preview to the address even if no student row exists.
    console.warn(`No Student user found for ${targetEmail}; sending preview only.`);
    const summary = await sendSystemNotificationEmailToEach({
      recipients: normalizeNotificationRecipients([targetEmail]),
      subject: 'Welcome to Little Champions Academy!',
      html: plainTextToEmailHtml(buildFirstEnrollmentWelcomePlainText()),
    });
    console.log('Preview send summary:', summary);
    return;
  }

  const student = studentRes.rows[0];
  console.log(`Student: ${student.full_name} <${student.email}> id=${student.user_id}`);

  const cleared = await query(
    `DELETE FROM system_logstbl
     WHERE entity_type = 'first_enrollment_welcome_email'
       AND (
         user_id = $1
         OR (details->>'student_id')::int = $1
       )`,
    [student.user_id]
  );
  console.log(`Cleared welcome idempotency logs: ${cleared.rowCount}`);

  // Force send even if no classstudent "new" row exists right now (format test).
  const { getClient } = await import('../config/database.js');
  const { buildArPdfAttachmentForPaymentConfirmation } = await import(
    '../utils/paymentArPdfAttachment.js'
  );
  let attachments = [];
  const client = await getClient();
  try {
    const invRes = await client.query(
      `SELECT i.invoice_id, i.ack_receipt_id
       FROM invoicestudentstbl ist
       INNER JOIN invoicestbl i ON i.invoice_id = ist.invoice_id
       WHERE ist.student_id = $1
       ORDER BY i.invoice_id DESC
       LIMIT 1`,
      [student.user_id]
    );
    const invoiceId = invRes.rows[0]?.invoice_id || null;
    const ackReceiptId = invRes.rows[0]?.ack_receipt_id || null;
    const pdf = await buildArPdfAttachmentForPaymentConfirmation(client, {
      invoiceId,
      ackReceiptId,
    });
    if (pdf?.buffer) {
      attachments = [
        {
          filename: pdf.filename || 'acknowledgement-receipt.pdf',
          content: pdf.buffer,
          contentType: 'application/pdf',
        },
      ];
    }
    console.log(
      `AR PDF: ${attachments.length ? pdf.filename : 'none'} (invoice=${invoiceId}, ack=${ackReceiptId})`
    );
  } finally {
    client.release();
  }

  const summary = await sendSystemNotificationEmailToEach({
    recipients: normalizeNotificationRecipients([student.email]),
    subject: 'Welcome to Little Champions Academy!',
    html: plainTextToEmailHtml(
      buildFirstEnrollmentWelcomePlainText({ includeArAttachmentNote: attachments.length > 0 })
    ),
    attachments,
  });
  console.log('Forced welcome send summary:', summary);

  // Re-mark as sent so production path stays idempotent until next hard-delete wipe.
  if (summary.sent > 0) {
    await query(
      `INSERT INTO system_logstbl (
         user_id, user_full_name, user_type, branch_id,
         http_method, http_status, request_path, action,
         entity_type, summary, details, ip_address
       ) VALUES (
         $1, NULL, 'System', NULL,
         'SYSTEM', 200, '/internal/first-enrollment-welcome-email', 'create',
         'first_enrollment_welcome_email', $2, $3::jsonb, NULL
       )`,
      [
        student.user_id,
        `Test welcome email sent to ${student.email}`,
        JSON.stringify({
          student_id: Number(student.user_id),
          recipients: [student.email],
          sent: summary.sent,
          failed: summary.failed,
          source: 'sendTestFirstEnrollmentWelcomeEmail',
        }),
      ]
    );
  }

  // Sanity: maybeSend path reports already_sent after mark.
  const check = await maybeSendFirstEnrollmentWelcomeEmail({
    studentId: student.user_id,
    enrollmentStatus: 'new',
  });
  console.log('maybeSend after mark:', check);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
