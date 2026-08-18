/**
 * Email transport layer: SMTP (nodemailer) or Brevo HTTP API (port 443).
 * Use Brevo on VPS hosts (e.g. Linode) that block outbound SMTP ports 25/465/587.
 * Docs: https://developers.brevo.com/docs/send-a-transactional-email
 */
import nodemailer from 'nodemailer';
import { readFileSync } from 'fs';

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_SECURE = process.env.SMTP_SECURE === 'true';
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASSWORD = process.env.SMTP_PASSWORD;

const BREVO_API_KEY = (process.env.BREVO_API_KEY || '').trim();
const EMAIL_PROVIDER_RAW = (process.env.EMAIL_PROVIDER || 'auto').trim().toLowerCase();

const rawSmtpFrom = (process.env.SMTP_FROM || '').trim();
const rawSmtpUser = (SMTP_USER || '').trim();
let smtpFromEmail = rawSmtpFrom || rawSmtpUser;
if (rawSmtpUser && rawSmtpFrom && rawSmtpFrom.toLowerCase() !== rawSmtpUser.toLowerCase()) {
  smtpFromEmail = rawSmtpUser;
} else if (!smtpFromEmail) {
  smtpFromEmail = rawSmtpUser || rawSmtpFrom;
}

const BREVO_FROM_EMAIL = (
  process.env.BREVO_FROM_EMAIL ||
  process.env.SMTP_FROM ||
  smtpFromEmail ||
  ''
).trim();

const BREVO_FROM_NAME =
  (process.env.BREVO_FROM_NAME || 'Little Champions Academy Inc.').trim() ||
  'Little Champions Academy Inc.';

export const getEmailProvider = () => {
  if (EMAIL_PROVIDER_RAW === 'brevo') return BREVO_API_KEY ? 'brevo' : null;
  if (EMAIL_PROVIDER_RAW === 'smtp') return isSmtpEnvConfigured() ? 'smtp' : null;
  if (BREVO_API_KEY) return 'brevo';
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
    brevo: {
      configured: Boolean(BREVO_API_KEY),
      from: BREVO_FROM_EMAIL || null,
      fromName: BREVO_FROM_NAME,
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
    from: s.provider === 'brevo' ? s.brevo.from : s.smtp.from,
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
  if (provider === 'brevo') {
    if (!BREVO_FROM_EMAIL) {
      throw new Error('BREVO_FROM_EMAIL (or SMTP_FROM) is required when using Brevo');
    }
    return BREVO_FROM_EMAIL;
  }
  if (!smtpFromEmail) {
    throw new Error('SMTP_FROM or SMTP_USER is required when using SMTP');
  }
  return smtpFromEmail;
}

function getFromName() {
  return getEmailProvider() === 'brevo' ? BREVO_FROM_NAME : 'Little Champions Academy Inc.';
}

function getFromHeader() {
  const email = getFromAddress();
  return `${getFromName()} <${email}>`;
}

function toBase64Content(att) {
  let contentBuf = att.content;
  if (!contentBuf && att.path) {
    contentBuf = readFileSync(att.path);
  }
  return Buffer.isBuffer(contentBuf)
    ? contentBuf.toString('base64')
    : Buffer.from(contentBuf || '').toString('base64');
}

async function sendViaBrevo({ to, subject, html, attachments = [] }) {
  if (!BREVO_API_KEY) {
    throw new Error('BREVO_API_KEY is not set');
  }

  const recipients = (Array.isArray(to) ? to : [to])
    .map((email) => String(email || '').trim())
    .filter(Boolean)
    .map((email) => ({ email }));

  if (recipients.length === 0) {
    throw new Error('Brevo send requires at least one recipient');
  }

  const body = {
    sender: {
      name: getFromName(),
      email: getFromAddress(),
    },
    to: recipients,
    subject,
    htmlContent: html,
  };

  const brevoAttachments = (attachments || [])
    .filter((att) => att && (att.content || att.path))
    .map((att) => ({
      name: att.filename || 'attachment',
      content: toBase64Content(att),
    }));

  if (brevoAttachments.length > 0) {
    body.attachment = brevoAttachments;
  }

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': BREVO_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const responseText = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(`Brevo API ${res.status}: ${responseText || res.statusText}`);
  }

  let parsed = {};
  try {
    parsed = responseText ? JSON.parse(responseText) : {};
  } catch {
    parsed = {};
  }

  const messageId = parsed.messageId || parsed.messageIds?.[0] || `brevo-${Date.now()}`;
  return { success: true, messageId, provider: 'brevo' };
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
 * Send email using the active provider (Brevo API or SMTP).
 */
export async function sendMail({ to, subject, html, attachments = [] }) {
  const provider = getEmailProvider();
  if (!provider) {
    throw new Error(
      'Email is not configured. Set BREVO_API_KEY (recommended on Linode) or SMTP_HOST/SMTP_USER/SMTP_PASSWORD.'
    );
  }

  if (provider === 'brevo') {
    return sendViaBrevo({ to, subject, html, attachments });
  }
  return sendViaSmtp({ to, subject, html, attachments });
}

export async function verifyEmailConnection() {
  const provider = getEmailProvider();
  if (!provider) {
    console.error('❌ Email not configured (no Brevo API key or SMTP settings)');
    return false;
  }

  if (provider === 'brevo') {
    try {
      const res = await fetch('https://api.brevo.com/v3/account', {
        headers: {
          accept: 'application/json',
          'api-key': BREVO_API_KEY,
        },
      });
      if (res.ok) {
        console.log('✅ Brevo API key is valid (HTTPS — works when SMTP ports are blocked)');
        return true;
      }
      console.error('❌ Brevo API key rejected:', res.status, await res.text().catch(() => ''));
      return false;
    } catch (err) {
      console.error('❌ Brevo verify error:', err?.message || err);
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
