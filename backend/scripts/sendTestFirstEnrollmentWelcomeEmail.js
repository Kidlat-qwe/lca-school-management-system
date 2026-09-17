/**
 * Clear first-enrollment welcome idempotency logs and send the
 * combined welcome email (for format verification).
 *
 *   node backend/scripts/sendTestFirstEnrollmentWelcomeEmail.js
 *   node backend/scripts/sendTestFirstEnrollmentWelcomeEmail.js --email=someone@example.com
 *   node backend/scripts/sendTestFirstEnrollmentWelcomeEmail.js --email=someone@example.com --force-sequence
 */

import '../config/loadEnv.js';
import { query } from '../config/database.js';
import {
  buildOnboardingPlainText,
  clearOnboardingEmailLogsForStudents,
  maybeSendFirstEnrollmentWelcomeEmail,
  resolveSequenceEmailContent,
  SEQUENCE_EMAIL_IDS,
} from '../utils/firstEnrollmentWelcomeEmail/index.js';
import {
  isEmailConfigured,
  normalizeNotificationRecipients,
  sendSystemNotificationEmailToEach,
} from '../utils/emailService.js';

function resolveTargetEmail(argv) {
  const explicit = argv.find((a) => a.startsWith('--email='));
  if (explicit) return explicit.slice('--email='.length).trim().toLowerCase();

  const dashedEmail = argv.find((a) => /^--[^=]+@[^=]+$/.test(a));
  if (dashedEmail) return dashedEmail.slice(2).trim().toLowerCase();

  const bareEmail = argv.find((a) => a.includes('@') && !a.startsWith('--'));
  if (bareEmail) return bareEmail.trim().toLowerCase();

  return 'it.kier@little-champion.com';
}

const forceSequence = process.argv.includes('--force-sequence');
const targetEmail = resolveTargetEmail(process.argv);

async function clearWelcomeLogs(studentId) {
  return clearOnboardingEmailLogsForStudents([studentId]);
}

async function sendPreviewCombined(recipients, context = {}) {
  const emailId = SEQUENCE_EMAIL_IDS[0] || 'onboarding';
  const content = await resolveSequenceEmailContent({ emailId, context });
  if (content.skipped || !content.enabled) {
    console.log(`Preview "${emailId}": skipped (${content.source || 'disabled'})`);
    return [{ emailId, subject: content.subject, summary: { sent: 0, attempted: 0, skipped: true } }];
  }
  const summary = await sendSystemNotificationEmailToEach({
    recipients,
    subject: content.subject,
    html: content.html,
    attachments: [],
  });
  console.log(`Preview "${emailId}": ${summary.sent}/${summary.attempted} sent (${content.source})`);
  return [{ emailId, subject: content.subject, summary }];
}

async function main() {
  console.log('Combined welcome email preview:\n');
  console.log(buildOnboardingPlainText());
  console.log(`\nSend list: ${SEQUENCE_EMAIL_IDS.join(', ')}\n---\n`);

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
    console.warn(`No Student user found for ${targetEmail}; sending preview only.`);
    await sendPreviewCombined(normalizeNotificationRecipients([targetEmail]));
    return;
  }

  const student = studentRes.rows[0];
  console.log(`Student: ${student.full_name} <${student.email}> id=${student.user_id}`);

  const cleared = await clearWelcomeLogs(student.user_id);
  console.log(`Cleared onboarding idempotency logs: ${cleared}`);

  if (forceSequence) {
    const csRes = await query(
      `SELECT classstudent_id
       FROM classstudentstbl
       WHERE student_id = $1
         AND program_enrollment_status = 'new'
         AND removed_at IS NULL
       ORDER BY enrolled_at ASC NULLS LAST, classstudent_id ASC
       LIMIT 1`,
      [student.user_id]
    );
    const classstudentId = csRes.rows[0]?.classstudent_id ?? null;

    const result = await maybeSendFirstEnrollmentWelcomeEmail({
      studentId: student.user_id,
      enrollmentStatus: 'new',
      classstudentId,
    });
    console.log('Send result:', JSON.stringify(result, null, 2));
    return;
  }

  const check = await maybeSendFirstEnrollmentWelcomeEmail({
    studentId: student.user_id,
    enrollmentStatus: 'new',
  });
  console.log('maybeSend result:', check);

  if (check.skipped && check.reason === 'not_earliest_new_enrollment') {
    console.warn(
      'Skipped: no active "new" enrollment. Use --force-sequence after clearing logs, or enroll the student first.'
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
