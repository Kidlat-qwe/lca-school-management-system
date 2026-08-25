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
      // Unverified = awaiting pay; Verified / Applied / similar = already settled.
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
  // Treat CMS-settled bill as paid for all tokens (even pending gateway rows).
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

  // Only pending, non-expired, unpaid-bill links open FIUU.
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
    autodebit_staff_opt_in: Boolean(row.metadata?.autodebit_staff_opt_in),
    parent_autodebit_decision: row.metadata?.parent_autodebit_decision || null,
    autodebit_class_name: row.metadata?.autodebit_class_name || null,
    autodebit_terms_version: row.metadata?.autodebit_terms_version || null,
    needs_parent_autodebit_decision: Boolean(
      openOk &&
        row.metadata?.autodebit_eligible &&
        (row.metadata?.autodebit_offered !== false) &&
        !row.metadata?.parent_autodebit_decision
    ),
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
 * When staff offered auto-debit, parent must accept/decline T&Cs before FIUU.
 */
export function buildFiuuAutoPostHtml(payload, { consentActionUrl = null, terms = null } = {}) {
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

  if (payload.needs_parent_autodebit_decision && consentActionUrl) {
    const classLabel = escapeHtmlAttr(
      payload.autodebit_class_name || 'this class installment plan'
    );
    const termsTitle = escapeHtmlAttr(terms?.title || 'LCA AutoPay Terms & Conditions');
    const termsBody = String(terms?.body || '')
      .split(/\n\n/)
      .map(
        (p) =>
          `<p style="margin:0 0 10px;font-size:13px;line-height:1.55;color:#475569;">${escapeHtmlAttr(p)}</p>`
      )
      .join('');
    const whatHappensList = Array.isArray(terms?.what_happens) && terms.what_happens.length
      ? terms.what_happens
      : [
          'Your card may be securely tokenized by FIUU after a successful first payment.',
          'LCA may automatically charge that card for tuition under your plan until settled or you cancel AutoPay.',
          'AutoPay is optional — leave it off to pay each invoice with a payment link instead.',
        ];
    const whatHappensHtml = whatHappensList
      .map((item) => `<li>${escapeHtmlAttr(item)}</li>`)
      .join('');
    const action = escapeHtmlAttr(consentActionUrl);

    const bodyHtml = `
              <div style="margin-top:16px;text-align:left;">
                <p style="margin:0 0 14px;font-size:13px;color:#334155;line-height:1.5;">
                  Optional <strong>LCA AutoPay</strong> is available for <strong>${classLabel}</strong>.
                  It stays <strong>off</strong> unless you turn it on and accept the Terms.
                </p>

                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;
                            background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 12px;margin-bottom:14px;">
                  <div style="font-size:13px;color:#0f172a;line-height:1.4;padding-right:8px;">
                    <div style="font-weight:700;margin-bottom:4px;">Enable LCA AutoPay</div>
                    <div style="font-size:12px;color:#64748b;">Default is off. Turning it on shows Terms first.</div>
                  </div>
                  <button type="button" id="autodebitToggle" role="switch" aria-checked="false"
                    style="flex-shrink:0;width:52px;height:30px;border-radius:999px;border:0;cursor:pointer;
                           background:#cbd5e1;position:relative;padding:0;">
                    <span id="autodebitKnob"
                      style="position:absolute;top:3px;left:3px;width:24px;height:24px;border-radius:50%;
                             background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.2);transition:left 0.15s;"></span>
                  </button>
                </div>

                <p id="autodebitStatus" style="margin:0 0 14px;font-size:12px;color:#64748b;">
                  LCA AutoPay is <strong>off</strong>. You will pay this invoice only.
                </p>

                <button type="button" id="continuePayBtn"
                  style="display:block;width:100%;background:#1e3a8a;color:#fff;border:0;border-radius:8px;
                         font-weight:600;font-size:14px;padding:12px 16px;cursor:pointer;">
                  Continue to payment
                </button>

                <form id="declineForm" method="POST" action="${action}" style="display:none;">
                  <input type="hidden" name="decision" value="decline" />
                  <input type="hidden" name="terms_accepted" value="1" />
                </form>
                <form id="acceptForm" method="POST" action="${action}" style="display:none;">
                  <input type="hidden" name="decision" value="accept" />
                  <input type="hidden" name="terms_accepted" value="1" />
                </form>
              </div>

              <div id="termsModal" style="display:none;position:fixed;inset:0;z-index:50;
                   background:rgba(15,23,42,0.55);align-items:center;justify-content:center;padding:16px;">
                <div role="dialog" aria-modal="true" aria-labelledby="termsModalTitle"
                  style="width:100%;max-width:440px;background:#fff;border-radius:12px;overflow:hidden;
                         box-shadow:0 20px 40px rgba(15,23,42,0.25);max-height:90vh;display:flex;flex-direction:column;">
                  <div style="padding:16px 18px 10px;border-bottom:1px solid #f1f5f9;">
                    <div id="termsModalTitle" style="font-size:15px;font-weight:700;color:#0f172a;">${termsTitle}</div>
                    <p style="margin:6px 0 0;font-size:12px;color:#64748b;line-height:1.4;">
                      Please read carefully before enabling LCA AutoPay.
                    </p>
                  </div>
                  <div style="padding:14px 18px;overflow:auto;flex:1;">
                    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 12px;margin-bottom:12px;">
                      <div style="font-size:12px;font-weight:700;color:#1e3a8a;margin-bottom:6px;">What happens if you turn this on</div>
                      <ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.5;color:#334155;">
                        ${whatHappensHtml}
                      </ul>
                    </div>
                    ${termsBody}
                  </div>
                  <div style="padding:12px 18px 16px;border-top:1px solid #f1f5f9;display:flex;flex-direction:column;gap:8px;">
                    <button type="button" id="termsAgreeBtn"
                      style="width:100%;background:#1e3a8a;color:#fff;border:0;border-radius:8px;
                             font-weight:600;font-size:14px;padding:11px 14px;cursor:pointer;">
                      I agree — enable LCA AutoPay
                    </button>
                    <button type="button" id="termsCancelBtn"
                      style="width:100%;background:#fff;color:#334155;border:1px solid #cbd5e1;border-radius:8px;
                             font-weight:600;font-size:14px;padding:11px 14px;cursor:pointer;">
                      Cancel — keep AutoPay off
                    </button>
                  </div>
                </div>
              </div>

              <script>
                (function () {
                  var enabled = false;
                  var termsAccepted = false;
                  var toggle = document.getElementById('autodebitToggle');
                  var knob = document.getElementById('autodebitKnob');
                  var status = document.getElementById('autodebitStatus');
                  var modal = document.getElementById('termsModal');
                  var continueBtn = document.getElementById('continuePayBtn');
                  var agreeBtn = document.getElementById('termsAgreeBtn');
                  var cancelBtn = document.getElementById('termsCancelBtn');
                  var acceptForm = document.getElementById('acceptForm');
                  var declineForm = document.getElementById('declineForm');

                  function paintToggle() {
                    toggle.setAttribute('aria-checked', enabled ? 'true' : 'false');
                    toggle.style.background = enabled ? '#16a34a' : '#cbd5e1';
                    knob.style.left = enabled ? '25px' : '3px';
                    if (enabled && termsAccepted) {
                      status.innerHTML = 'LCA AutoPay is <strong>on</strong> (Terms accepted).';
                      status.style.color = '#166534';
                      continueBtn.textContent = 'Continue with LCA AutoPay';
                    } else {
                      status.innerHTML = 'LCA AutoPay is <strong>off</strong>. You will pay this invoice only.';
                      status.style.color = '#64748b';
                      continueBtn.textContent = 'Continue to payment';
                    }
                  }

                  function openModal() {
                    modal.style.display = 'flex';
                  }
                  function closeModal() {
                    modal.style.display = 'none';
                  }

                  toggle.addEventListener('click', function () {
                    if (enabled) {
                      enabled = false;
                      termsAccepted = false;
                      paintToggle();
                      return;
                    }
                    openModal();
                  });

                  agreeBtn.addEventListener('click', function () {
                    enabled = true;
                    termsAccepted = true;
                    closeModal();
                    paintToggle();
                  });

                  cancelBtn.addEventListener('click', function () {
                    enabled = false;
                    termsAccepted = false;
                    closeModal();
                    paintToggle();
                  });

                  modal.addEventListener('click', function (e) {
                    if (e.target === modal) {
                      enabled = false;
                      termsAccepted = false;
                      closeModal();
                      paintToggle();
                    }
                  });

                  continueBtn.addEventListener('click', function () {
                    if (enabled && termsAccepted) {
                      acceptForm.submit();
                    } else {
                      declineForm.submit();
                    }
                  });

                  paintToggle();
                })();
              </script>`;

    return buildBrandedPayPageHtml({
      title: 'LCA AutoPay option',
      heading: 'Before you pay',
      message: 'LCA AutoPay stays off unless you turn it on and accept the Terms.',
      bodyHtml,
      statusTone: 'neutral',
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
    message: 'Please wait while we connect you to FIUU.',
    bodyHtml,
    statusTone: 'neutral',
  });
}
