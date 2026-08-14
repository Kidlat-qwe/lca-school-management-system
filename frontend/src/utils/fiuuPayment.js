import { apiRequest } from '../config/api';

/**
 * Hide Pay via FIUU on Record Payment until the option is fully ready.
 * Set true to show the Admin/Superadmin invoice modal tab again.
 */
export const FIUU_PAYMENT_UI_ENABLED = false;

export async function fetchFiuuConfig() {
  if (!FIUU_PAYMENT_UI_ENABLED) {
    return { enabled: false };
  }
  const res = await apiRequest('/payments/fiuu/config');
  return res.data || { enabled: false };
}

export async function createFiuuInvoicePayment({ invoice_id, student_id, channel }) {
  const res = await apiRequest('/payments/fiuu/create', {
    method: 'POST',
    body: JSON.stringify({ invoice_id, student_id, channel }),
  });
  return res.data;
}

export async function fetchFiuuPaymentStatus(orderid) {
  const res = await apiRequest(`/payments/fiuu/status/${encodeURIComponent(orderid)}`);
  return res.data;
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
