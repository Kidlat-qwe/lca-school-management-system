/**
 * FIUU payment helpers (invoice + AR).
 *
 * Primary staff flow: email CMS pay link to guardian (`send_email: true`).
 * Optional: open FIUU QR immediately at the counter.
 */
import { apiRequest } from '../config/api';
import API_BASE_URL from '../config/api';

/**
 * Show Pay via FIUU on Record Payment and AR Create Step 2 (Admin/Superadmin).
 * Hidden by default — set VITE_FIUU_PAYMENT_UI_ENABLED=true in frontend env to show.
 */
export const FIUU_PAYMENT_UI_ENABLED =
  String(import.meta.env.VITE_FIUU_PAYMENT_UI_ENABLED || '').toLowerCase() === 'true';

export async function fetchFiuuConfig() {
  if (!FIUU_PAYMENT_UI_ENABLED) {
    return { enabled: false };
  }
  const res = await apiRequest('/payments/fiuu/config');
  return res.data || { enabled: false };
}

export async function fetchFiuuAutodebitContext(invoiceId) {
  const res = await apiRequest(`/payments/fiuu/autodebit-context/${encodeURIComponent(invoiceId)}`);
  return res.data;
}

export async function createFiuuInvoicePayment({
  invoice_id,
  student_id,
  channel,
  send_email = false,
  recipient_email,
  pay_link_expires_on,
  tip_amount,
  discount_amount,
}) {
  const res = await apiRequest('/payments/fiuu/create', {
    method: 'POST',
    body: JSON.stringify({
      invoice_id,
      student_id,
      channel,
      send_email: Boolean(send_email),
      recipient_email: recipient_email || undefined,
      pay_link_expires_on: pay_link_expires_on || undefined,
      tip_amount: tip_amount === '' || tip_amount == null ? undefined : Number(tip_amount),
      discount_amount:
        discount_amount === '' || discount_amount == null ? undefined : Number(discount_amount),
    }),
  });
  return res.data;
}

/** Merchandise / Package AR create → pending AR + FIUU (optional email link). */
export async function createFiuuArPayment(body) {
  const res = await apiRequest('/payments/fiuu/create-ar', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.data;
}

/** Preview payment-link email HTML (no send). */
export async function previewFiuuPaymentEmail(body) {
  const res = await apiRequest('/payments/fiuu/preview-email', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.data;
}

export async function fetchFiuuPaymentStatus(orderid) {
  const res = await apiRequest(`/payments/fiuu/status/${encodeURIComponent(orderid)}`);
  return res.data;
}

/** Public (no auth) payload for /pay/fiuu/:token landing page. */
export async function fetchPublicFiuuPay(token) {
  const res = await fetch(`${API_BASE_URL}/payments/fiuu/public/${encodeURIComponent(token)}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.message || 'Payment link not found');
  }
  return json.data;
}

/** POST form fields to FIUU hosted payment page (opens new tab). */
export function submitFiuuPaymentForm(payUrl, formFields) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = payUrl;
  form.target = '_blank';
  form.rel = 'noopener noreferrer';

  Object.entries(formFields || {}).forEach(([key, value]) => {
    if (value == null || value === '') return;
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = key;
    input.value = String(value);
    form.appendChild(input);
  });

  document.body.appendChild(form);
  form.submit();
  document.body.removeChild(form);
}

export function pollFiuuPaymentStatus(orderid, { intervalMs = 2500, timeoutMs = 600000 } = {}) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const data = await fetchFiuuPaymentStatus(orderid);
        if (data.status === 'paid') {
          resolve(data);
          return;
        }
        if (data.status === 'failed' || data.status === 'cancelled') {
          reject(new Error('FIUU payment failed or was cancelled'));
          return;
        }
        if (Date.now() - started > timeoutMs) {
          reject(new Error('Payment timed out. Check FIUU portal or try again.'));
          return;
        }
        setTimeout(tick, intervalMs);
      } catch (err) {
        reject(err);
      }
    };
    tick();
  });
}
