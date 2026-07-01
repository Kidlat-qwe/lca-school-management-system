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
  getEmailConfigSummary,
  verifyEmailConnection,
} from '../utils/emailTransport.js';
import { sendSystemNotificationEmail } from '../utils/emailService.js';
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

async function testTcpPort(host, port, label) {
  try {
    const { execSync } = await import('child_process');
    execSync(`timeout 6 bash -c 'echo >/dev/tcp/${host}/${port}'`, { stdio: 'pipe' });
    console.log(`  ${label} (${host}:${port}): OPEN`);
    return true;
  } catch {
    console.log(`  ${label} (${host}:${port}): BLOCKED or TIMEOUT`);
    return false;
  }
}

async function main() {
  console.log('\n=== EOD email diagnostic ===\n');
  console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`Database: ${process.env.DB_NAME}`);

  const emailCfg = getEmailConfigSummary();
  console.log('\nEmail config:', emailCfg);

  if (emailCfg.smtp.configured && emailCfg.smtp.host) {
    console.log('\nOutbound SMTP port check (from this server):');
    const p465 = await testTcpPort(emailCfg.smtp.host, 465, 'SMTP SSL');
    const p587 = await testTcpPort(emailCfg.smtp.host, 587, 'SMTP STARTTLS');
    if (!p465 && !p587) {
      console.warn(
        '\n⚠️  Both SMTP ports are blocked from this VPS (common on Linode).\n' +
          '    Use SendGrid instead (HTTPS port 443):\n' +
          '      1. Create free account at https://sendgrid.com\n' +
          '      2. Verify sender: lca@little-champion.com (Single Sender Verification)\n' +
          '      3. Create API key with Mail Send permission\n' +
          '      4. Add to backend/.env on Linode:\n' +
          '           SENDGRID_API_KEY=SG.xxxxx\n' +
          '           SENDGRID_FROM_EMAIL=lca@little-champion.com\n' +
          '           EMAIL_PROVIDER=sendgrid\n' +
          '      5. Restart API and re-run this script\n'
      );
    }
  }

  if (!emailCfg.configured) {
    console.error('\n❌ Email is not configured.');
    process.exit(1);
  }

  const emailOk = await verifyEmailConnection();
  console.log(emailOk ? '\n✅ Email transport verify OK' : '\n❌ Email transport verify FAILED');

  const superadminRows = await query(
    `SELECT user_id, full_name, TRIM(email) AS email, firebase_uid, user_type
     FROM userstbl
     WHERE ${SUPERADMIN_USER_TYPE_SQL}
     ORDER BY user_id`
  );

  console.log(`\nSuperadmin accounts in DB: ${superadminRows.rows.length}`);
  for (const row of superadminRows.rows) {
    console.log(
      `  - user_id=${row.user_id} name=${row.full_name || '-'} db_email=${row.email || '(empty)'}`
    );
  }

  const envEmails = parseEodStakeholderEmailsFromEnv();
  console.log(envEmails.length ? `\nEOD_STAKEHOLDER_EMAILS: ${envEmails.join(', ')}` : '\nEOD_STAKEHOLDER_EMAILS: (not set)');

  const resolved = await resolveEodStakeholderEmails(superadminRows.rows, envEmails);
  console.log(`\nResolved stakeholder recipients (${resolved.length}):`, resolved.length ? resolved : '(none)');

  const tpl = await loadEffectiveTemplate(null, 'template_eod_summary', null);
  console.log('\ntemplate_eod_summary:', { enabled: tpl.enabled, scope: tpl.scope });

  if (!tpl.enabled) {
    console.warn('\n⚠️  EOD template is DISABLED in Settings.');
  }

  if (sendTestTo) {
    console.log(`\nSending test email to ${sendTestTo} via ${emailCfg.provider}...`);
    await sendSystemNotificationEmail({
      to: sendTestTo,
      subject: '[PSMS] EOD email test',
      html: '<p>If you received this, email works on this server.</p>',
    });
    console.log('✅ Test email sent');
  }

  console.log('\n=== Done ===\n');
  process.exit(emailOk && resolved.length && tpl.enabled ? 0 : 2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
