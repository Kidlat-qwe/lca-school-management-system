/**
 * Email guardian/client a CMS FIUU payment link.
 */
import {
  isEmailConfigured,
  normalizeNotificationRecipients,
  sendSystemNotificationEmailToEach,
} from '../../utils/emailService.js';
import { wrapBrandedEmailHtml } from '../../utils/templateRenderService.js';

function formatPhp(amount) {
  const n = Number(amount || 0);
  return `PHP ${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * @param {object} params
 * @param {string|string[]} params.to
 * @param {string} params.payLinkUrl
 * @param {string|number} params.amount
 * @param {string} [params.studentName]
 * @param {string} [params.refLabel]
 * @param {string} [params.description]
 */
export async function sendFiuuPaymentLinkEmail({
  to,
  payLinkUrl,
  amount,
  studentName = 'Client',
  refLabel = 'Payment',
  description = '',
}) {
  if (!isEmailConfigured()) {
    throw Object.assign(
      new Error('Email is not configured. Set BREVO_API_KEY or SMTP settings before sending payment links.'),
      { statusCode: 503 }
    );
  }

  const recipients = normalizeNotificationRecipients(Array.isArray(to) ? to : [to]);
  if (recipients.length === 0) {
    throw Object.assign(new Error('A valid guardian/client email is required to send the payment link'), {
      statusCode: 400,
    });
  }
  if (!payLinkUrl) {
    throw Object.assign(new Error('payLinkUrl is required'), { statusCode: 400 });
  }

  const greeting = String(studentName || 'Client').trim() || 'Client';
  const subject = `Payment link — ${refLabel} (${formatPhp(amount)})`;
  const descLine = description
    ? `<p style="margin:0 0 12px;color:#4b5563;font-size:14px;">${escapeHtml(description)}</p>`
    : '';

  const html = wrapBrandedEmailHtml(`
    <p style="margin:0 0 12px;font-size:16px;">Hello ${escapeHtml(greeting)},</p>
    <p style="margin:0 0 12px;font-size:14px;color:#374151;">
      You have a pending payment of <strong>${escapeHtml(formatPhp(amount))}</strong>
      for <strong>${escapeHtml(refLabel)}</strong>.
    </p>
    ${descLine}
    <p style="margin:0 0 20px;font-size:14px;color:#374151;">
      Click the button below to pay securely via FIUU (GCash, Maya, or any QR Ph app).
      Your bill stays unpaid in our system until payment is completed.
    </p>
    <p style="margin:0 0 24px;text-align:center;">
      <a href="${escapeHtml(payLinkUrl)}"
         style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;
                font-weight:600;font-size:14px;padding:12px 22px;border-radius:8px;">
        Pay now
      </a>
    </p>
    <p style="margin:0 0 8px;font-size:12px;color:#6b7280;">
      Or copy this link into your browser (opens FIUU payment):<br/>
      <a href="${escapeHtml(payLinkUrl)}" style="color:#4f46e5;word-break:break-all;">${escapeHtml(payLinkUrl)}</a>
    </p>
    <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;">
      If you did not expect this email, please ignore it or contact the school.
    </p>
  `);

  const result = await sendSystemNotificationEmailToEach({
    recipients,
    subject,
    html,
  });

  return {
    recipients,
    sent: result?.sent ?? recipients.length,
    failed: result?.failed || [],
  };
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
