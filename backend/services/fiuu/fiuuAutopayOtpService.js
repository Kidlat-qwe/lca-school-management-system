/**
 * LCA AutoPay enrollment verification before consent is finalized.
 * - SMS: parent enters mobile → OTP sent → enter code on /go
 * - Email: parent enters email → click Verify in email (no code on page)
 */
import crypto from 'crypto';
import { query } from '../../config/database.js';
import { sendMail, isEmailConfigured } from '../../utils/emailTransport.js';
import {
  collectPhilippineMobiles,
  isSemaphoreConfigured,
  normalizePhilippineMobile,
  sendSemaphoreSms,
} from '../../utils/sms/semaphoreSmsService.js';
import { normalizeNotificationRecipients } from '../../utils/emailService.js';
import { DEFAULT_SCHOOL_NAME } from '../../utils/templateRenderService.js';
import { getFiuuPublicApiBaseUrl, getFiuuSecretKey, getFiuuVerifyKey, isFiuuAutopayOtpEnabled } from './config.js';
import {
  findGatewayPaymentByPayToken,
  isPayLinkExpired,
  isTargetBillAlreadySettled,
} from './payLink.js';

const OTP_TTL_MS = 10 * 60 * 1000;
const EMAIL_LINK_TTL_MS = 30 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;

function hashValue(value) {
  return crypto.createHash('sha256').update(String(value).trim(), 'utf8').digest('hex');
}

function hmacSign(payload) {
  const key = getFiuuSecretKey() || getFiuuVerifyKey() || 'psms-autopay-otp';
  return crypto.createHmac('sha256', key).update(payload, 'utf8').digest('hex');
}

function generateOtpCode() {
  return String(crypto.randomInt(100000, 999999));
}

function parseMeta(row) {
  const raw = row?.metadata;
  if (!raw) return {};
  if (typeof raw === 'object') return { ...raw };
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function loadPayTokenRow(token) {
  const row = await findGatewayPaymentByPayToken(token);
  if (!row) {
    throw Object.assign(new Error('Payment link not found'), { statusCode: 404 });
  }
  const billAlreadySettled = await isTargetBillAlreadySettled(row);
  if (billAlreadySettled || row.status === 'paid') {
    throw Object.assign(new Error('This payment was already received'), { statusCode: 400 });
  }
  if (isPayLinkExpired(row)) {
    throw Object.assign(new Error('This payment link has expired'), { statusCode: 410 });
  }
  return row;
}

async function persistMeta(gatewayPaymentId, meta) {
  await query(
    `UPDATE gateway_paymentstbl
     SET metadata = $2::jsonb, updated_at = CURRENT_TIMESTAMP
     WHERE gateway_payment_id = $1`,
    [gatewayPaymentId, JSON.stringify(meta)]
  );
}

export function maskPhilippineMobile(mobile) {
  const digits = String(mobile || '').replace(/\D/g, '');
  if (digits.length < 6) return '••••';
  return `•••• ${digits.slice(-4)}`;
}

export function maskEmailAddress(email) {
  const raw = String(email || '').trim();
  const at = raw.indexOf('@');
  if (at <= 0) return '••••';
  const local = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  const shown = local.length <= 1 ? '*' : `${local[0]}•••`;
  return `${shown}@${domain}`;
}

/** Display PH mobile as 09XXXXXXXXX for form prefill. */
export function formatMobileForInput(mobile63) {
  const normalized = normalizePhilippineMobile(mobile63);
  if (!normalized) return '';
  if (normalized.startsWith('63') && normalized.length === 12) {
    return `0${normalized.slice(2)}`;
  }
  return String(mobile63 || '').trim();
}

export function parseEnteredMobile(raw) {
  const normalized = normalizePhilippineMobile(raw);
  if (!normalized) {
    throw Object.assign(new Error('Enter a valid Philippine mobile number (e.g. 09XXXXXXXXX).'), {
      statusCode: 400,
    });
  }
  return normalized;
}

export function parseEnteredEmail(raw) {
  const list = normalizeNotificationRecipients([raw]);
  if (!list.length) {
    throw Object.assign(new Error('Enter a valid email address.'), { statusCode: 400 });
  }
  return list[0];
}

/**
 * Suggested contacts from CMS (prefill hints only).
 */
export async function resolveAutopayVerificationContacts(studentId) {
  const id = parseInt(studentId, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return { studentName: 'Student', suggestedMobile: '', suggestedEmail: '' };
  }

  const result = await query(
    `SELECT u.full_name AS student_name, u.email AS student_email, u.phone_number AS student_phone,
            g.email AS guardian_email, g.guardian_phone_number
     FROM userstbl u
     LEFT JOIN guardianstbl g ON g.student_id = u.user_id
     WHERE u.user_id = $1
     ORDER BY g.guardian_id ASC NULLS LAST
     LIMIT 5`,
    [id]
  );

  const mobiles = collectPhilippineMobiles(
    ...result.rows.map((r) => r.guardian_phone_number),
    ...result.rows.map((r) => r.student_phone)
  );
  const emails = normalizeNotificationRecipients(
    result.rows.flatMap((r) => [r.guardian_email, r.student_email])
  );

  return {
    studentName: result.rows[0]?.student_name || 'Student',
    suggestedMobile: formatMobileForInput(mobiles[0]),
    suggestedEmail: emails[0] || '',
  };
}

function buildOtpMessage({ code, studentName, classLabel }) {
  const plan = classLabel ? ` (${classLabel})` : '';
  return (
    `${DEFAULT_SCHOOL_NAME}: Code ${code} — verify LCA AutoPay for ${studentName}'s installment plan${plan}. ` +
    `Valid 10 min. Do not share.`
  );
}

function buildEmailVerifyUrl(token, gatewayPaymentId, expiresAt) {
  const apiBase = String(getFiuuPublicApiBaseUrl() || '').replace(/\/$/, '');
  const exp = String(expiresAt);
  const sig = hmacSign(`${token}:${gatewayPaymentId}:${exp}`);
  return `${apiBase}/payments/fiuu/go/${encodeURIComponent(token)}/autopay-otp/confirm-email?exp=${encodeURIComponent(exp)}&sig=${encodeURIComponent(sig)}`;
}

function buildEmailVerifyHtml({ verifyUrl, studentName, classLabel }) {
  const school = DEFAULT_SCHOOL_NAME;
  const classLine = classLabel
    ? `<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#475569;">Plan / class: <strong>${classLabel}</strong></p>`
    : '';
  return `<!DOCTYPE html>
<html><body style="font-family:Segoe UI,Arial,sans-serif;background:#f8fafc;padding:24px;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;">
    <h1 style="margin:0 0 12px;font-size:18px;color:#0f172a;">Verify LCA AutoPay authorization</h1>
    <p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#475569;">
      You are authorizing <strong>LCA AutoPay</strong> for <strong>${studentName}</strong>'s recurring installment invoices.
      This confirms you agree to automatic card charges per the LCA AutoPay Terms until you cancel or the plan ends.
    </p>
    ${classLine}
    <p style="margin:0 0 16px;font-size:14px;line-height:1.55;color:#475569;">
      Click the button below to verify your email and continue to payment.
    </p>
    <p style="margin:0 0 20px;text-align:center;">
      <a href="${verifyUrl}" style="display:inline-block;background:#1e3a8a;color:#fff;text-decoration:none;
         font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px;">Verify AutoPay authorization</a>
    </p>
    <p style="margin:0;font-size:12px;color:#64748b;">This link expires in 30 minutes. If you did not request this, contact ${school}.</p>
  </div>
</body></html>`;
}

async function finalizeAutopayVerification(token) {
  const row = await loadPayTokenRow(token);
  const meta = parseMeta(row);
  meta.autopay_otp_verified_at = new Date().toISOString();
  meta.autopay_otp_pending = false;
  delete meta.autopay_otp_code_hash;
  delete meta.autopay_email_verify_sig;
  await persistMeta(row.gateway_payment_id, meta);

  const { applyParentAutodebitDecisionOnPayToken } = await import('./fiuuPaymentService.js');
  await applyParentAutodebitDecisionOnPayToken(token, {
    decision: 'accept',
    terms_accepted: true,
    skipOtpCheck: true,
  });
}

function assertResendCooldown(meta) {
  const lastSent = meta.autopay_otp_last_sent_at ? Date.parse(meta.autopay_otp_last_sent_at) : 0;
  if (lastSent && Date.now() - lastSent < RESEND_COOLDOWN_MS) {
    const waitSec = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - lastSent)) / 1000);
    throw Object.assign(new Error(`Please wait ${waitSec} seconds before sending again.`), {
      statusCode: 429,
    });
  }
}

export async function startAutopayOtpVerification(token) {
  const row = await loadPayTokenRow(token);
  const meta = parseMeta(row);
  if (!meta.autodebit_eligible) {
    throw Object.assign(new Error('AutoPay is not offered on this payment link'), { statusCode: 400 });
  }

  const contacts = await resolveAutopayVerificationContacts(row.student_id);

  meta.autopay_otp_pending = true;
  meta.autopay_otp_verified_at = null;
  meta.autopay_otp_attempts = 0;
  meta.autopay_otp_ui_mode = meta.autopay_otp_ui_mode || 'sms';
  await persistMeta(row.gateway_payment_id, meta);

  return buildPageContext(row, meta, contacts, meta.autopay_otp_ui_mode || 'sms', token);
}

function mapSmsSendFailure(smsResult) {
  if (smsResult.reason === 'semaphore_not_configured') {
    return 'SMS is not configured on the server. Use email verification instead.';
  }
  if (smsResult.reason === 'no_valid_phone_numbers') {
    return 'Enter a valid Philippine mobile number (e.g. 09XXXXXXXXX).';
  }
  if (smsResult.reason === 'network_error') {
    return 'Could not reach the SMS provider. Try again or use email verification.';
  }
  const httpStatus = smsResult.httpStatus;
  const detail = String(smsResult.error || '').trim();
  if (/sendername supplied is not valid/i.test(detail)) {
    return (
      'SMS sender name is not approved in Semaphore. Use email verification for now, or ask the school to set an approved SEMAPHORE_SENDER_NAME in Coolify (or remove it to use the account default).'
    );
  }
  if (httpStatus === 500) {
    return (
      'SMS provider returned a server error. Use email verification for now, or ask the school to verify Semaphore API key, sender name, and account credits in Coolify.'
    );
  }
  if (detail) {
    return `SMS could not be sent (${detail}). Try email verification or contact the school.`;
  }
  return 'Could not send SMS verification code. Try email verification or contact the school.';
}

export async function sendAutopaySmsOtp(token, mobileRaw) {
  if (!isFiuuAutopayOtpEnabled()) {
    throw Object.assign(new Error('AutoPay verification is not enabled'), { statusCode: 503 });
  }

  const row = await loadPayTokenRow(token);
  const meta = parseMeta(row);
  if (!meta.autopay_otp_pending) {
    throw Object.assign(new Error('AutoPay verification was not started'), { statusCode: 400 });
  }
  if (meta.autopay_otp_verified_at) {
    return { alreadyVerified: true };
  }

  assertResendCooldown(meta);

  const mobile = parseEnteredMobile(mobileRaw);
  if (!isSemaphoreConfigured()) {
    throw Object.assign(new Error('SMS is not configured on the server'), { statusCode: 503 });
  }

  const contacts = await resolveAutopayVerificationContacts(row.student_id);
  const classLabel = meta.autodebit_class_name || null;
  const code = generateOtpCode();
  const message = buildOtpMessage({ code, studentName: contacts.studentName, classLabel });

  const smsResult = await sendSemaphoreSms({ numbers: mobile, message });
  if (smsResult.skipped) {
    throw Object.assign(new Error(mapSmsSendFailure(smsResult)), { statusCode: 400 });
  }
  if (!smsResult.success) {
    throw Object.assign(new Error(mapSmsSendFailure(smsResult)), { statusCode: 502 });
  }

  meta.autopay_otp_ui_mode = 'sms';
  meta.autopay_otp_channel = 'sms';
  meta.autopay_otp_contact = mobile;
  meta.autopay_otp_code_hash = hashValue(code);
  meta.autopay_otp_expires_at = new Date(Date.now() + OTP_TTL_MS).toISOString();
  meta.autopay_otp_last_sent_at = new Date().toISOString();
  meta.autopay_otp_attempts = 0;
  delete meta.autopay_email_verify_sig;
  await persistMeta(row.gateway_payment_id, meta);

  return { sent: true, channel: 'sms', mobileMasked: maskPhilippineMobile(mobile) };
}

export async function sendAutopayEmailVerification(token, emailRaw) {
  if (!isFiuuAutopayOtpEnabled()) {
    throw Object.assign(new Error('AutoPay verification is not enabled'), { statusCode: 503 });
  }

  const row = await loadPayTokenRow(token);
  const meta = parseMeta(row);
  if (!meta.autopay_otp_pending) {
    throw Object.assign(new Error('AutoPay verification was not started'), { statusCode: 400 });
  }
  if (meta.autopay_otp_verified_at) {
    return { alreadyVerified: true };
  }

  assertResendCooldown(meta);

  const email = parseEnteredEmail(emailRaw);
  if (!isEmailConfigured()) {
    throw Object.assign(new Error('Email is not configured on the server'), { statusCode: 503 });
  }

  const contacts = await resolveAutopayVerificationContacts(row.student_id);
  const classLabel = meta.autodebit_class_name || null;
  const expiresAt = Date.now() + EMAIL_LINK_TTL_MS;
  const verifyUrl = buildEmailVerifyUrl(token, row.gateway_payment_id, expiresAt);

  await sendMail({
    to: email,
    subject: `Verify LCA AutoPay authorization — ${contacts.studentName}`,
    html: buildEmailVerifyHtml({
      verifyUrl,
      studentName: contacts.studentName,
      classLabel,
    }),
  });

  meta.autopay_otp_ui_mode = 'email';
  meta.autopay_otp_channel = 'email';
  meta.autopay_otp_contact = email;
  meta.autopay_email_verify_expires_at = new Date(expiresAt).toISOString();
  meta.autopay_email_verify_sig = hmacSign(`${token}:${row.gateway_payment_id}:${expiresAt}`);
  meta.autopay_otp_last_sent_at = new Date().toISOString();
  delete meta.autopay_otp_code_hash;
  delete meta.autopay_otp_expires_at;
  meta.autopay_otp_attempts = 0;
  await persistMeta(row.gateway_payment_id, meta);

  return { sent: true, channel: 'email', emailMasked: maskEmailAddress(email) };
}

/** Legacy route handler — dispatches by channel. */
export async function sendAutopayOtpCode(token, channel, body = {}) {
  const ch = String(channel || body?.channel || '').toLowerCase();
  if (ch === 'email') {
    return sendAutopayEmailVerification(token, body?.email);
  }
  return sendAutopaySmsOtp(token, body?.mobile);
}

export async function verifyAutopayOtpCode(token, code) {
  if (!isFiuuAutopayOtpEnabled()) {
    throw Object.assign(new Error('AutoPay verification is not enabled'), { statusCode: 503 });
  }

  const row = await loadPayTokenRow(token);
  const meta = parseMeta(row);
  if (!meta.autopay_otp_pending) {
    throw Object.assign(new Error('AutoPay verification was not started'), { statusCode: 400 });
  }
  if (meta.autopay_otp_verified_at) {
    return { verified: true, alreadyVerified: true };
  }
  if (meta.autopay_otp_channel !== 'sms') {
    throw Object.assign(
      new Error('Use the verification link in your email, or switch to SMS verification.'),
      { statusCode: 400 }
    );
  }

  const attempts = parseInt(meta.autopay_otp_attempts, 10) || 0;
  if (attempts >= MAX_VERIFY_ATTEMPTS) {
    throw Object.assign(
      new Error('Too many incorrect attempts. Please request a new code or pay this invoice only.'),
      { statusCode: 429 }
    );
  }

  const expiresAt = meta.autopay_otp_expires_at ? Date.parse(meta.autopay_otp_expires_at) : 0;
  if (!meta.autopay_otp_code_hash || !expiresAt || Date.now() > expiresAt) {
    throw Object.assign(new Error('Verification code expired. Please request a new code.'), {
      statusCode: 400,
    });
  }

  const normalized = String(code || '').replace(/\D/g, '').trim();
  if (normalized.length !== 6) {
    throw Object.assign(new Error('Enter the 6-digit verification code'), { statusCode: 400 });
  }

  if (hashValue(normalized) !== meta.autopay_otp_code_hash) {
    meta.autopay_otp_attempts = attempts + 1;
    await persistMeta(row.gateway_payment_id, meta);
    const remaining = MAX_VERIFY_ATTEMPTS - meta.autopay_otp_attempts;
    throw Object.assign(
      new Error(
        remaining > 0
          ? `Incorrect code. ${remaining} attempt(s) remaining.`
          : 'Too many incorrect attempts. Please request a new code.'
      ),
      { statusCode: 400 }
    );
  }

  await finalizeAutopayVerification(token);
  return { verified: true };
}

export async function confirmAutopayEmailVerification(token, { exp, sig }) {
  if (!isFiuuAutopayOtpEnabled()) {
    throw Object.assign(new Error('AutoPay verification is not enabled'), { statusCode: 503 });
  }

  const row = await loadPayTokenRow(token);
  const meta = parseMeta(row);
  if (!meta.autopay_otp_pending && !meta.autopay_email_verify_sig) {
    throw Object.assign(new Error('Email verification is not in progress'), { statusCode: 400 });
  }
  if (meta.autopay_otp_verified_at) {
    return { verified: true, alreadyVerified: true };
  }

  const expMs = parseInt(String(exp || ''), 10);
  const signature = String(sig || '').trim();
  if (!Number.isFinite(expMs) || !signature) {
    throw Object.assign(new Error('Invalid verification link'), { statusCode: 400 });
  }
  if (Date.now() > expMs) {
    throw Object.assign(new Error('Verification link has expired. Request a new email.'), {
      statusCode: 410,
    });
  }

  const expected = hmacSign(`${token}:${row.gateway_payment_id}:${expMs}`);
  const stored = String(meta.autopay_email_verify_sig || '');
  if (signature !== expected || signature !== stored) {
    throw Object.assign(new Error('Invalid or expired verification link'), { statusCode: 400 });
  }

  await finalizeAutopayVerification(token);
  return { verified: true };
}

export async function cancelAutopayOtpVerification(token) {
  const row = await loadPayTokenRow(token);
  const meta = parseMeta(row);
  meta.autopay_otp_pending = false;
  meta.autopay_otp_verified_at = null;
  delete meta.autopay_otp_code_hash;
  delete meta.autopay_otp_expires_at;
  delete meta.autopay_otp_channel;
  delete meta.autopay_otp_contact;
  delete meta.autopay_otp_last_sent_at;
  delete meta.autopay_email_verify_sig;
  delete meta.autopay_email_verify_expires_at;
  meta.autopay_otp_attempts = 0;
  await persistMeta(row.gateway_payment_id, meta);
  return { cancelled: true };
}

function buildPageContext(row, meta, contacts, mode, payToken) {
  const uiMode = mode === 'email' ? 'email' : 'sms';
  const contact = meta.autopay_otp_contact || '';
  return {
    token: payToken,
    classLabel: meta.autodebit_class_name || 'this installment plan',
    studentName: contacts.studentName,
    mode: uiMode,
    suggestedMobile: contacts.suggestedMobile,
    suggestedEmail: contacts.suggestedEmail,
    smsCodeSent: meta.autopay_otp_channel === 'sms' && Boolean(meta.autopay_otp_code_hash),
    emailLinkSent: meta.autopay_otp_channel === 'email' && Boolean(meta.autopay_email_verify_sig),
    contactMasked:
      meta.autopay_otp_channel === 'sms'
        ? maskPhilippineMobile(contact)
        : meta.autopay_otp_channel === 'email'
          ? maskEmailAddress(contact)
          : null,
    enteredMobile: uiMode === 'sms' ? formatMobileForInput(contact) || contacts.suggestedMobile : '',
    enteredEmail: uiMode === 'email' ? contact || contacts.suggestedEmail : '',
    verified: Boolean(meta.autopay_otp_verified_at),
  };
}

export async function getAutopayOtpPageContext(token, { mode = null } = {}) {
  const row = await loadPayTokenRow(token);
  const meta = parseMeta(row);
  if (!meta.autopay_otp_pending && !meta.autopay_otp_verified_at) {
    throw Object.assign(new Error('AutoPay verification is not in progress'), { statusCode: 400 });
  }

  const contacts = await resolveAutopayVerificationContacts(row.student_id);
  const uiMode = mode === 'email' || mode === 'sms' ? mode : meta.autopay_otp_ui_mode || 'sms';

  if (mode && mode !== meta.autopay_otp_ui_mode) {
    meta.autopay_otp_ui_mode = uiMode;
    await persistMeta(row.gateway_payment_id, meta);
  }

  const payToken =
    typeof row.metadata === 'object' && row.metadata?.pay_link_token
      ? row.metadata.pay_link_token
      : token;

  return buildPageContext(row, meta, contacts, uiMode, payToken);
}
