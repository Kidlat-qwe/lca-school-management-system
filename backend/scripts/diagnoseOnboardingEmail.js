/**
 * Diagnose why first-enrollment onboarding emails may not send.
 *
 *   node backend/scripts/diagnoseOnboardingEmail.js
 *   node backend/scripts/diagnoseOnboardingEmail.js --email=student@example.com
 */

import '../config/loadEnv.js';
import { query } from '../config/database.js';
import { maybeSendFirstEnrollmentWelcomeEmail, clearOnboardingEmailLogsForStudents } from '../utils/firstEnrollmentWelcomeEmail/index.js';
import { isEmailConfigured } from '../utils/emailService.js';

function resolveEmail(argv) {
  const explicit = argv.find((a) => a.startsWith('--email='));
  if (explicit) return explicit.slice('--email='.length).trim().toLowerCase();
  const dashed = argv.find((a) => /^--[^=]+@[^=]+$/.test(a));
  if (dashed) return dashed.slice(2).trim().toLowerCase();
  return 'it.kier@little-champion.com';
}

async function main() {
  const email = resolveEmail(process.argv);
  console.log('Target email:', email);
  console.log('Email configured:', isEmailConfigured());

  const u = await query(
    `SELECT user_id, full_name, email
     FROM userstbl
     WHERE LOWER(TRIM(email)) = $1
       AND user_type = 'Student'
     LIMIT 1`,
    [email]
  );

  if (!u.rows[0]) {
    console.log('No student found.');
    return;
  }

  const sid = u.rows[0].user_id;
  console.log('\nStudent:', u.rows[0]);

  const logs = await query(
    `SELECT system_log_id, entity_type, user_id, summary, details, created_at
     FROM system_logstbl
     WHERE entity_type IN ('first_enrollment_onboarding_sequence', 'first_enrollment_welcome_email')
       AND (
         user_id = $1
         OR details->>'student_id' = $2
       )
     ORDER BY system_log_id DESC`,
    [sid, String(sid)]
  );
  console.log('\nOnboarding idempotency logs:', logs.rows.length);
  for (const row of logs.rows) {
    console.log(' -', row.system_log_id, row.entity_type, row.summary);
  }

  const enroll = await query(
    `SELECT classstudent_id, class_id, program_enrollment_status, enrolled_at, removed_at
     FROM classstudentstbl
     WHERE student_id = $1
     ORDER BY classstudent_id DESC
     LIMIT 10`,
    [sid]
  );
  console.log('\nRecent class enrollments:');
  for (const row of enroll.rows) {
    console.log(' -', row);
  }

  const earliest = await query(
    `SELECT classstudent_id, program_enrollment_status
     FROM classstudentstbl
     WHERE student_id = $1
       AND program_enrollment_status = 'new'
     ORDER BY enrolled_at ASC NULLS LAST, classstudent_id ASC
     LIMIT 1`,
    [sid]
  );
  console.log('\nEarliest "new" enrollment:', earliest.rows[0] || null);

  const guardian = await query(
    `SELECT guardian_id, email FROM guardianstbl WHERE student_id = $1 ORDER BY guardian_id ASC LIMIT 1`,
    [sid]
  );
  console.log('\nPrimary guardian:', guardian.rows[0] || null);

  console.log('\nChecks (pass --send to send sequence, --clear to wipe logs first):');

  if (process.argv.includes('--clear')) {
    const cleared = await clearOnboardingEmailLogsForStudents([sid]);
    console.log(`Cleared onboarding logs: ${cleared}`);
  }

  const logCheck = await query(
    `SELECT 1 FROM system_logstbl
     WHERE entity_type IN ('first_enrollment_onboarding_sequence', 'first_enrollment_welcome_email')
       AND (user_id = $1 OR details->>'student_id' = $2)
     LIMIT 1`,
    [sid, String(sid)]
  );
  const hasLog = logCheck.rows.length > 0;
  const enrollmentStatus = earliest.rows[0]?.program_enrollment_status ?? null;
  const blockers = [];
  if (!isEmailConfigured()) blockers.push('email_not_configured');
  if (hasLog) blockers.push('already_sent (onboarding log exists)');
  if (enrollmentStatus !== 'new') blockers.push(`not_new_status (${enrollmentStatus || 'none'})`);
  if (!earliest.rows[0]) blockers.push('no active "new" enrollment');

  if (blockers.length) {
    console.log('Would skip send:', blockers.join(', '));
    if (blockers.some((b) => b.startsWith('already_sent'))) {
      console.log('\nFix: node backend/scripts/clearFirstEnrollmentOnboardingLogs.js --email=' + email);
    }
    if (blockers.some((b) => b.startsWith('not_new_status'))) {
      console.log('\nFix: enrollment must be program_enrollment_status = "new" (hard-delete clears history).');
    }
    if (!process.argv.includes('--send')) return;
  }

  if (!process.argv.includes('--send')) {
    console.log('No blockers — sequence would send on next enrollment or with --send.');
    return;
  }

  const result = await maybeSendFirstEnrollmentWelcomeEmail({
    studentId: sid,
    enrollmentStatus: 'new',
    classstudentId: earliest.rows[0]?.classstudent_id ?? null,
  });
  console.log('\nLive send result:', result);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
