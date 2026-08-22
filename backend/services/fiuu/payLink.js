/**
 * Tokenized pay links for guardian self-pay.
 * Email opens API /go/:token → HTML auto-POSTs to FIUU (not the CMS SPA).
 */
import crypto from 'crypto';
import { query } from '../../config/database.js';
import {
  getFiuuPublicApiBaseUrl,
  getFiuuPayBaseUrl,
  getFiuuMerchantId,
  resolveFiuuChannelPath,
} from './config.js';

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

function escapeHtmlAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Public payload for JSON landing / diagnostics.
 */
export function buildPublicPayPayload(row) {
  if (!row) {
    throw Object.assign(new Error('Payment link not found'), { statusCode: 404 });
  }

  const status = String(row.status || 'pending');
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

  // Only pending, non-expired links open FIUU. Paid/expired always show a status page
  // (disable_after_payment is stored for email copy / future policy; default blocks reopen).
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
  };
}

/**
 * HTML that auto-POSTs to FIUU hosted pay (same tab). Used by emailed Pay now link.
 * Always includes a visible Continue button — Helmet CSP may block inline scripts.
 */
export function buildFiuuAutoPostHtml(payload) {
  if (!payload?.payUrl || !payload?.formFields) {
    const msg =
      payload?.status === 'paid'
        ? 'This payment was already received. Thank you.'
        : payload?.status === 'expired'
          ? 'This payment link has expired. Please contact the school for a new link.'
          : 'This payment link is not available.';
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Payment</title></head>
<body style="font-family:system-ui,sans-serif;padding:2rem;text-align:center;color:#374151;">
  <p>${escapeHtmlAttr(msg)}</p>
</body></html>`;
  }

  const inputs = Object.entries(payload.formFields)
    .filter(([, v]) => v != null && v !== '')
    .map(
      ([key, value]) =>
        `<input type="hidden" name="${escapeHtmlAttr(key)}" value="${escapeHtmlAttr(value)}" />`
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Redirecting to FIUU…</title>
</head>
<body style="font-family:system-ui,sans-serif;padding:2rem;max-width:28rem;margin:0 auto;text-align:center;color:#374151;">
  <p style="margin:0 0 1rem;">Opening secure FIUU payment…</p>
  <form id="fiuuPay" method="POST" action="${escapeHtmlAttr(payload.payUrl)}">
    ${inputs}
    <button type="submit"
      style="display:inline-block;background:#4f46e5;color:#fff;border:0;border-radius:8px;
             font-weight:600;font-size:14px;padding:12px 22px;cursor:pointer;">
      Continue to FIUU
    </button>
  </form>
  <p style="margin:1rem 0 0;font-size:12px;color:#6b7280;">
    If you are not redirected automatically, tap the button above.
  </p>
  <script>
    (function () {
      var f = document.getElementById('fiuuPay');
      if (f) f.submit();
    })();
  </script>
</body>
</html>`;
}
