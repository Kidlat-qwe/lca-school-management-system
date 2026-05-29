/**
 * Diagnose EOD email delivery on this server (run on Linode with production .env).
 *
 * Usage (from backend/):
 *   node scripts/diagnoseEodEmail.js
 *   node scripts/diagnoseEodEmail.js --send-test you@example.com
 */
import '../config/loadEnv.js';
import { query } from '../config/database.js';
import {
  getSmtpConfigSummary,
  verifySMTPConnection,
  sendSystemNotificationEmail,
} from '../utils/emailService.js';
import { loadEffectiveTemplate } from '../utils/templateRenderService.js';
import { resolveEodStakeholderEmails, SUPERADMIN_USER_TYPE_SQL } from '../utils/eodEmailRecipients.js';

const parseEodStakeholderEmailsFromEnv = () =>
  String(process.env.EOD_STAKEHOLDER_EMAILS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const sendTestTo = process.argv.includes('--send-test')
  ? process.argv[process.argv.indexOf('--send-test') + 1]
  : null;

async function main() {
  console.log('\n=== EOD email diagnostic ===\n');
  console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`Database: ${process.env.DB_NAME}`);

  const smtp = getSmtpConfigSummary();
  console.log('\nSMTP config:', {
    configured: smtp.configured,
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    user: smtp.user,
    from: smtp.from,
  });

  if (!smtp.configured) {
    console.error('\n❌ SMTP is not configured. Add SMTP_* variables to backend/.env on this server.');
    process.exit(1);
  }

  const smtpOk = await verifySMTPConnection();
  console.log(smtpOk ? '\n✅ SMTP connection verify OK' : '\n❌ SMTP connection verify FAILED');

  const superadminRows = await query(
    `SELECT user_id, full_name, TRIM(email) AS email, firebase_uid, user_type
     FROM userstbl
     WHERE ${SUPERADMIN_USER_TYPE_SQL}
     ORDER BY user_id`
  );

  console.log(`\nSuperadmin accounts in DB: ${superadminRows.rows.length}`);
  for (const row of superadminRows.rows) {
    console.log(
      `  - user_id=${row.user_id} name=${row.full_name || '-'} user_type=${row.user_type} db_email=${row.email || '(empty)'} firebase_uid=${row.firebase_uid ? 'yes' : 'no'}`
    );
  }

  const envEmails = parseEodStakeholderEmailsFromEnv();
  if (envEmails.length) {
    console.log(`\nEOD_STAKEHOLDER_EMAILS: ${envEmails.join(', ')}`);
  } else {
    console.log('\nEOD_STAKEHOLDER_EMAILS: (not set)');
  }

  const resolved = await resolveEodStakeholderEmails(superadminRows.rows, envEmails);
  console.log(`\nResolved stakeholder recipients (${resolved.length}):`, resolved.length ? resolved : '(none)');

  const tpl = await loadEffectiveTemplate(null, 'template_eod_summary', null);
  console.log('\ntemplate_eod_summary:', {
    enabled: tpl.enabled,
    scope: tpl.scope,
    subject: tpl.subject ? '(set)' : '(empty)',
  });

  if (!tpl.enabled) {
    console.warn('\n⚠️  EOD template is DISABLED in Settings. Enable it or emails will be skipped.');
  }

  if (!resolved.length) {
    console.warn(
      '\n⚠️  No recipients. Set email on Superadmin in Personnel, or add EOD_STAKEHOLDER_EMAILS=your@email.com to .env'
    );
  }

  if (sendTestTo) {
    console.log(`\nSending test email to ${sendTestTo}...`);
    await sendSystemNotificationEmail({
      to: sendTestTo,
      subject: '[PSMS] EOD email test',
      html: '<p>If you received this, SMTP works on this server.</p>',
    });
    console.log('✅ Test email sent');
  } else if (smtpOk && resolved.length) {
    console.log('\nTip: run with --send-test your@email.com to send a test message.');
  }

  console.log('\n=== Done ===\n');
  process.exit(smtpOk && resolved.length && tpl.enabled ? 0 : 2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
