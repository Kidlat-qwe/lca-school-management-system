/**
 * Tokenized pay links for guardian self-pay.
 * Email opens API /go/:token → HTML auto-POSTs to FIUU (not the CMS SPA).
 * Installment save-card / auto-debit opt-in is on the FIUU Card page only.
 */
import crypto from 'crypto';
import { query } from '../../config/database.js';
import {
  getFiuuPublicApiBaseUrl,
  getFiuuPayBaseUrl,
  getFiuuMerchantId,
  resolveFiuuChannelPath,
} from './config.js';
import {
  DEFAULT_SCHOOL_NAME,
  getEmailBrandLogoUrl,
} from '../../utils/templateRenderService.js';

const DEFAULT_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function generatePayLinkToken() {
  return crypto.randomBytes(24).toString('hex');
}

export function buildPayLinkExpiry(ttlMs = DEFAULT_LINK_TTL_MS) {
  return new Date(Date.now() + ttlMs).toISOString();
}

/**
 * Parse staff-chosen expiry date (YYYY-MM-DD) to ISO end-of-day.
 * Returns null when empty/invalid (no configured expiry → email shows N/A; link does not auto-expire).
 */
export function resolvePayLinkExpiresAt(expiresOnYmd) {
  const raw = String(expiresOnYmd || '').trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const end = new Date(`${raw}T23:59:59.999`);
    if (!Number.isNaN(end.getTime()) && end.getTime() > Date.now() - 60_000) {
      return end.toISOString();
    }
  }
  return null;
}

export function attachPayLinkToMetadata(
  metadata = {},
  { token, expiresAt, expiresOnYmd, disableAfterPayment = true } = {}
) {
  const pay_link_token = token || generatePayLinkToken();
  const next = {
    ...metadata,
    pay_link_token,
    disable_after_payment: disableAfterPayment !== false,
  };
  const resolved =
    expiresAt ||
    (expiresOnYmd != null && String(expiresOnYmd).trim() !== ''
      ? resolvePayLinkExpiresAt(expiresOnYmd)
      : null);
  if (resolved) {
    next.pay_link_expires_at = resolved;
  }
  return next;
}

/** Public URL for email "Pay now" — hits API bridge that immediately POSTs to FIUU. */
export function buildFiuuPublicPayPageUrl(token) {
  const apiBase = String(getFiuuPublicApiBaseUrl() || '').replace(/\/$/, '');
  if (!apiBase) {
    throw Object.assign(
      new Error(
        'PUBLIC_API_BASE_URL (or FIUU_NOTIFY_URL) is required to email payment links that open FIUU'
      ),
      { statusCode: 503 }
    );
  }
  return `${apiBase}/payments/fiuu/go/${encodeURIComponent(token)}`;
}

export async function findGatewayPaymentByPayToken(token) {
  const t = String(token || '').trim();
  if (!t) return null;
  const result = await query(
    `SELECT *
     FROM gateway_paymentstbl
     WHERE metadata->>'pay_link_token' = $1
     ORDER BY gateway_payment_id DESC
     LIMIT 1`,
    [t]
  );
  return result.rows[0] || null;
}

export function isPayLinkExpired(row) {
  const exp = row?.metadata?.pay_link_expires_at;
  if (!exp) return false;
  const ms = Date.parse(String(exp));
  if (Number.isNaN(ms)) return false;
  return Date.now() > ms;
}

/**
 * True when the linked invoice/AR is already settled in CMS (blocks all FIUU email tokens
 * for that bill — including older pending attempts after manual or other FIUU pay).
 */
export async function isTargetBillAlreadySettled(row) {
  if (!row) return false;

  const invoiceId = row.invoice_id != null ? parseInt(row.invoice_id, 10) : NaN;
  if (Number.isFinite(invoiceId) && invoiceId > 0) {
    try {
      const inv = await query(
        `SELECT status, amount FROM invoicestbl WHERE invoice_id = $1 LIMIT 1`,
        [invoiceId]
      );
      const invoice = inv.rows[0];
      if (!invoice) return false;
      if (String(invoice.status || '') === 'Paid') return true;
      if (parseFloat(invoice.amount || 0) <= 0.009) return true;
    } catch (err) {
      console.error('[fiuu-pay-link] invoice settle check failed:', err?.message || err);
    }
  }

  if (String(row.target_type || '') === 'ack_receipt') {
    const ackId = row.target_id != null ? parseInt(row.target_id, 10) : NaN;
    if (!Number.isFinite(ackId) || ackId <= 0) return false;
    try {
      const ack = await query(
        `SELECT status FROM acknowledgement_receiptstbl WHERE ack_receipt_id = $1 LIMIT 1`,
        [ackId]
      );
      const status = String(ack.rows[0]?.status || '');
      if (status && status !== 'Unverified') return true;
    } catch (err) {
      console.error('[fiuu-pay-link] AR settle check failed:', err?.message || err);
    }
  }

  return false;
}

function escapeHtmlAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Public payload for JSON landing / go bridge.
 * @param {object} row - gateway_paymentstbl row
 * @param {{ billAlreadySettled?: boolean }} [options]
 */
export function buildPublicPayPayload(row, { billAlreadySettled = false } = {}) {
  if (!row) {
    throw Object.assign(new Error('Payment link not found'), { statusCode: 404 });
  }

  let status = String(row.status || 'pending');
  if (billAlreadySettled && status === 'pending') {
    status = 'paid';
  }
  const expired = status === 'pending' && isPayLinkExpired(row);
  const disableAfterPayment = row.metadata?.disable_after_payment !== false;
  let formFields = row.raw_request;
  if (typeof formFields === 'string') {
    try {
      formFields = JSON.parse(formFields);
    } catch {
      formFields = {};
    }
  }
  if (!formFields || typeof formFields !== 'object') formFields = {};

  const channel = formFields.channel || row.metadata?.channel || 'QRPH';
  const merchantId = getFiuuMerchantId();
  const channelPath = resolveFiuuChannelPath(channel);
  const payUrl =
    merchantId && channelPath
      ? `${getFiuuPayBaseUrl()}${merchantId}/${channelPath}`
      : null;

  const openOk = status === 'pending' && !expired;

  return {
    orderid: row.orderid,
    status: expired ? 'expired' : status,
    amount: row.amount,
    currency: row.currency || 'PHP',
    description: row.description_sent || '',
    target_type: row.target_type,
    invoice_id: row.invoice_id || null,
    ack_receipt_id: String(row.target_type || '') === 'ack_receipt' ? row.target_id : null,
    payUrl: openOk ? payUrl : null,
    formFields: openOk ? formFields : null,
    expires_at: row.metadata?.pay_link_expires_at || null,
    disable_after_payment: disableAfterPayment,
    bill_already_settled: Boolean(billAlreadySettled),
    autodebit_eligible: Boolean(row.metadata?.autodebit_eligible),
    autodebit_class_name: row.metadata?.autodebit_class_name || null,
  };
}

/** Resolve gateway row + CMS bill state into a public pay payload. */
export async function buildPublicPayPayloadForRow(row) {
  const billAlreadySettled = await isTargetBillAlreadySettled(row);
  return buildPublicPayPayload(row, { billAlreadySettled });
}

/**
 * Shared branded HTML shell for /go/:token pages (status + redirect).
 */
function buildBrandedPayPageHtml({ title, heading, message, bodyHtml = '', statusTone = 'neutral' }) {
  const schoolName = escapeHtmlAttr(DEFAULT_SCHOOL_NAME);
  const logoUrl = escapeHtmlAttr(getEmailBrandLogoUrl());
  const tone =
    statusTone === 'success'
      ? { bg: '#ecfdf5', border: '#a7f3d0', icon: '#059669', heading: '#065f46' }
      : statusTone === 'warning'
        ? { bg: '#fffbeb', border: '#fde68a', icon: '#d97706', heading: '#92400e' }
        : { bg: '#f8fafc', border: '#e2e8f0', icon: '#475569', heading: '#0f172a' };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtmlAttr(title)}</title>
</head>
<body style="margin:0;padding:0;min-height:100vh;background:#f1f5f9;
  font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#334155;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="min-height:100vh;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
          style="max-width:440px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;
                 overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.06);">
          <tr>
            <td style="padding:28px 28px 20px;text-align:center;border-bottom:1px solid #f1f5f9;">
              <img src="${logoUrl}" alt="${schoolName}" width="64" height="64"
                referrerpolicy="no-referrer"
                style="display:block;margin:0 auto 12px;width:64px;height:64px;border:0;border-radius:50%;object-fit:cover;" />
              <div style="font-size:17px;font-weight:700;color:#0f172a;line-height:1.3;">${schoolName}</div>
              <div style="font-size:12px;color:#64748b;margin-top:4px;">Secure payment</div>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px 28px;">
              <div style="background:${tone.bg};border:1px solid ${tone.border};border-radius:10px;padding:18px 16px;text-align:center;">
                <div style="font-size:15px;font-weight:700;color:${tone.heading};margin:0 0 8px;">${escapeHtmlAttr(heading)}</div>
                <p style="margin:0;font-size:14px;line-height:1.5;color:#475569;">${escapeHtmlAttr(message)}</p>
              </div>
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:14px 28px 20px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #f1f5f9;">
              © ${new Date().getFullYear()} ${schoolName}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * HTML that auto-POSTs to FIUU hosted pay (same tab). Used by emailed Pay now link.
 * Always includes a visible Continue button — Helmet CSP may block inline scripts.
 * Installment save-card / auto-debit opt-in is on the FIUU Card page only (token_status).
 */
export function buildFiuuAutoPostHtml(payload) {
  if (!payload?.payUrl || !payload?.formFields) {
    const isPaid = payload?.status === 'paid';
    const isExpired = payload?.status === 'expired';
    return buildBrandedPayPageHtml({
      title: isPaid ? 'Payment received' : isExpired ? 'Link expired' : 'Payment link',
      heading: isPaid ? 'Payment already received' : isExpired ? 'Link expired' : 'Link unavailable',
      message: isPaid
        ? 'This payment was already received. Thank you. You may close this window.'
        : isExpired
          ? 'This payment link has expired. Please contact the school for a new link.'
          : 'This payment link is not available. Please contact the school if you need help.',
      statusTone: isPaid ? 'success' : isExpired ? 'warning' : 'neutral',
    });
  }

  const inputs = Object.entries(payload.formFields)
    .filter(([, v]) => v != null && v !== '')
    .map(
      ([key, value]) =>
        `<input type="hidden" name="${escapeHtmlAttr(key)}" value="${escapeHtmlAttr(value)}" />`
    )
    .join('\n');

  const bodyHtml = `
              <div style="margin-top:18px;text-align:center;">
                <form id="fiuuPay" method="POST" action="${escapeHtmlAttr(payload.payUrl)}">
                  ${inputs}
                  <button type="submit"
                    style="display:inline-block;background:#1e3a8a;color:#fff;border:0;border-radius:8px;
                           font-weight:600;font-size:14px;padding:12px 22px;cursor:pointer;">
                    Continue to FIUU
                  </button>
                </form>
                <p style="margin:12px 0 0;font-size:12px;color:#64748b;">
                  If you are not redirected automatically, tap the button above.
                </p>
              </div>
              <script>
                (function () {
                  var f = document.getElementById('fiuuPay');
                  if (f) f.submit();
                })();
              </script>`;

  return buildBrandedPayPageHtml({
    title: 'Redirecting to FIUU…',
    heading: 'Opening secure payment',
    message: payload.autodebit_eligible
      ? 'On the card page you can optionally save your card for future installment payments for this class only.'
      : 'Please wait while we connect you to FIUU.',
    bodyHtml,
    statusTone: 'neutral',
  });
}
