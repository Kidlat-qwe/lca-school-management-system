/**
 * FIUU payment gateway configuration (backend-only secrets).
 */

const trim = (v) => String(v || '').trim();

export function isFiuuConfigured() {
  return Boolean(getFiuuMerchantId() && getFiuuVerifyKey() && getFiuuSecretKey());
}

export function getFiuuMerchantId() {
  return trim(process.env.FIUU_MERCHANT_ID);
}

export function getFiuuVerifyKey() {
  return trim(process.env.FIUU_VERIFY_KEY);
}

export function getFiuuSecretKey() {
  return trim(process.env.FIUU_SECRET_KEY);
}

export function getFiuuCurrency() {
  return trim(process.env.FIUU_CURRENCY) || 'PHP';
}

/** Hosted payment page base, e.g. https://pay.fiuu.com/RMS/pay/ */
export function getFiuuPayBaseUrl() {
  const custom = trim(process.env.FIUU_PAY_URL);
  if (custom) return custom.replace(/\/?$/, '/');
  const sandbox = trim(process.env.FIUU_SANDBOX) === 'true';
  return sandbox
    ? 'https://sandbox-payment.fiuu.com/RMS/pay/'
    : 'https://pay.fiuu.com/RMS/pay/';
}

/** Default channel for counter QR (QRPH supports GCash scan). */
export function getFiuuDefaultChannel() {
  return trim(process.env.FIUU_DEFAULT_CHANNEL) || 'QRPH';
}

/** Map channel label to FIUU channel filename when needed. */
export function resolveFiuuChannelPath(channel) {
  const c = trim(channel) || getFiuuDefaultChannel();
  if (!c) return '';
  if (c.endsWith('.php')) return c;
  return `${c}.php`;
}

export function getFiuuReturnUrl() {
  return trim(process.env.FIUU_RETURN_URL);
}

export function getFiuuNotifyUrl() {
  return trim(process.env.FIUU_NOTIFY_URL);
}

export function getFiuuCallbackUrl() {
  return trim(process.env.FIUU_CALLBACK_URL);
}

export function getFiuuExtendedVcode() {
  return trim(process.env.FIUU_EXTENDED_VCODE) === 'true';
}

/** Public CMS frontend origin for return redirect after payment. */
export function getFiuuFrontendReturnUrl() {
  return trim(process.env.FIUU_FRONTEND_RETURN_URL) || trim(process.env.CORS_ORIGIN?.split(',')[0]);
}

/**
 * Public API origin used in emailed pay links (auto-POST bridge to FIUU).
 * Prefer PUBLIC_API_BASE_URL; else derive from FIUU_NOTIFY_URL.
 */
export function getFiuuPublicApiBaseUrl() {
  const explicit = trim(process.env.PUBLIC_API_BASE_URL) || trim(process.env.API_PUBLIC_URL);
  if (explicit) return explicit.replace(/\/$/, '');

  const notify = getFiuuNotifyUrl();
  if (notify) {
    try {
      const u = new URL(notify);
      // https://api-cms.lca-app.com/api/webhooks/fiuu/notify → https://api-cms.lca-app.com/api/sms
      const origin = u.origin;
      return `${origin}/api/sms`;
    } catch {
      /* ignore */
    }
  }
  return '';
}
