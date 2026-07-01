/**
 * Email transport layer: SMTP (nodemailer) or SendGrid HTTP API (port 443).
 * Use SendGrid on VPS hosts (e.g. Linode) that block outbound SMTP ports 25/465/587.
 */
import nodemailer from 'nodemailer';
import { readFileSync } from 'fs';

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_SECURE = process.env.SMTP_SECURE === 'true';
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASSWORD = process.env.SMTP_PASSWORD;

const SENDGRID_API_KEY = (process.env.SENDGRID_API_KEY || '').trim();
const EMAIL_PROVIDER_RAW = (process.env.EMAIL_PROVIDER || 'auto').trim().toLowerCase();

const rawSmtpFrom = (process.env.SMTP_FROM || '').trim();
const rawSmtpUser = (SMTP_USER || '').trim();
let smtpFromEmail = rawSmtpFrom || rawSmtpUser;
if (rawSmtpUser && rawSmtpFrom && rawSmtpFrom.toLowerCase() !== rawSmtpUser.toLowerCase()) {
  smtpFromEmail = rawSmtpUser;
} else if (!smtpFromEmail) {
  smtpFromEmail = rawSmtpUser || rawSmtpFrom;
}

const SENDGRID_FROM_EMAIL = (
  process.env.SENDGRID_FROM_EMAIL ||
  process.env.SMTP_FROM ||
  smtpFromEmail ||
  ''
).trim();

export const getEmailProvider = () => {
  if (EMAIL_PROVIDER_RAW === 'sendgrid') return SENDGRID_API_KEY ? 'sendgrid' : null;
  if (EMAIL_PROVIDER_RAW === 'smtp') return isSmtpEnvConfigured() ? 'smtp' : null;
  if (SENDGRID_API_KEY) return 'sendgrid';
  if (isSmtpEnvConfigured()) return 'smtp';
  return null;
};

function isSmtpEnvConfigured() {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASSWORD);
}

export const isEmailConfigured = () => Boolean(getEmailProvider());

/** @deprecated use isEmailConfigured */
export const isSmtpConfigured = isEmailConfigured;

export const getEmailConfigSummary = () => {
  const provider = getEmailProvider();
  return {
    provider,
    configured: Boolean(provider),
    smtp: {
      configured: isSmtpEnvConfigured(),
      host: SMTP_HOST || null,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      user: SMTP_USER || null,
      from: smtpFromEmail || null,
    },
    sendgrid: {
      configured: Boolean(SENDGRID_API_KEY),
      from: SENDGRID_FROM_EMAIL || null,
    },
  };
};

/** @deprecated use getEmailConfigSummary */
export const getSmtpConfigSummary = () => {
  const s = getEmailConfigSummary();
  return {
    configured: s.configured,
    provider: s.provider,
    host: s.smtp.host,
    port: s.smtp.port,
    secure: s.smtp.secure,
    user: s.smtp.user,
    from: s.provider === 'sendgrid' ? s.sendgrid.from : s.smtp.from,
  };
};

const smtpTransporter = isSmtpEnvConfigured()
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
      tls: {
        rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false',
      },
    })
  : null;

function getFromAddress() {
  const provider = getEmailProvider();
  if (provider === 'sendgrid') {
    if (!SENDGRID_FROM_EMAIL) {
      throw new Error('SENDGRID_FROM_EMAIL (or SMTP_FROM) is required when using SendGrid');
    }
    return SENDGRID_FROM_EMAIL;
  }
  if (!smtpFromEmail) {
    throw new Error('SMTP_FROM or SMTP_USER is required when using SMTP');
  }
  return smtpFromEmail;
}

function getFromHeader() {
  const email = getFromAddress();
  return `Little Champions Academy <${email}>`;
}

async function sendViaSendGrid({ to, subject, html, attachments = [] }) {
  if (!SENDGRID_API_KEY) {
    throw new Error('SENDGRID_API_KEY is not set');
  }

  const recipients = Array.isArray(to) ? to : [to];
  const personalizations = recipients.map((email) => ({
    to: [{ email }],
  }));

  const body = {
    personalizations,
    from: { email: getFromAddress(), name: 'Little Champions Academy' },
    subject,
    content: [{ type: 'text/html', value: html }],
  };

  if (attachments.length > 0) {
    body.attachments = attachments.map((att) => {
      let contentBuf = att.content;
      if (!contentBuf && att.path) {
        contentBuf = readFileSync(att.path);
      }
      const payload = {
        content: Buffer.isBuffer(contentBuf)
          ? contentBuf.toString('base64')
          : Buffer.from(contentBuf || '').toString('base64'),
        filename: att.filename || 'attachment',
        type: att.contentType || att.type || 'application/octet-stream',
        disposition: att.cid ? 'inline' : 'attachment',
      };
      if (att.cid) payload.content_id = att.cid;
      return payload;
    });
  }

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`SendGrid API ${res.status}: ${errText || res.statusText}`);
  }

  const messageId = res.headers.get('x-message-id') || `sendgrid-${Date.now()}`;
  return { success: true, messageId, provider: 'sendgrid' };
}

async function sendViaSmtp({ to, subject, html, attachments = [] }) {
  if (!smtpTransporter) {
    throw new Error('SMTP is not configured');
  }

  const info = await smtpTransporter.sendMail({
    from: getFromHeader(),
    to,
    subject,
    html,
    attachments,
  });

  return { success: true, messageId: info.messageId, provider: 'smtp' };
}

/**
 * Send email using the active provider (SendGrid API or SMTP).
 */
export async function sendMail({ to, subject, html, attachments = [] }) {
  const provider = getEmailProvider();
  if (!provider) {
    throw new Error(
      'Email is not configured. Set SENDGRID_API_KEY (recommended on Linode) or SMTP_HOST/SMTP_USER/SMTP_PASSWORD.'
    );
  }

  if (provider === 'sendgrid') {
    return sendViaSendGrid({ to, subject, html, attachments });
  }
  return sendViaSmtp({ to, subject, html, attachments });
}

export async function verifyEmailConnection() {
  const provider = getEmailProvider();
  if (!provider) {
    console.error('❌ Email not configured (no SendGrid API key or SMTP settings)');
    return false;
  }

  if (provider === 'sendgrid') {
    try {
      const res = await fetch('https://api.sendgrid.com/v3/scopes', {
        headers: { Authorization: `Bearer ${SENDGRID_API_KEY}` },
      });
      if (res.ok) {
        console.log('✅ SendGrid API key is valid (HTTPS — works when SMTP ports are blocked)');
        return true;
      }
      console.error('❌ SendGrid API key rejected:', res.status, await res.text().catch(() => ''));
      return false;
    } catch (err) {
      console.error('❌ SendGrid verify error:', err?.message || err);
      return false;
    }
  }

  try {
    await smtpTransporter.verify();
    console.log('✅ SMTP server is ready to send emails');
    return true;
  } catch (error) {
    console.error('❌ SMTP connection error:', error?.message || error);
    return false;
  }
}

/** @deprecated use verifyEmailConnection */
export const verifySMTPConnection = verifyEmailConnection;

export function getNodemailerFromHeader() {
  try {
    return getFromHeader();
  } catch {
    return undefined;
  }
}

export function logSmtpFromMismatchWarning() {
  if (
    rawSmtpUser &&
    rawSmtpFrom &&
    rawSmtpFrom.toLowerCase() !== rawSmtpUser.toLowerCase() &&
    getEmailProvider() === 'smtp'
  ) {
    console.warn(
      `[emailService] SMTP_FROM (${rawSmtpFrom}) does not match SMTP_USER (${rawSmtpUser}). Using SMTP_USER as the From address.`
    );
  }
}
