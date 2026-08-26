import crypto from 'crypto';
import { getFiuuExtendedVcode, getFiuuMerchantId, getFiuuSecretKey, getFiuuVerifyKey } from './config.js';

function md5Hex(input) {
  return crypto.createHash('md5').update(String(input), 'utf8').digest('hex');
}

/** Amount for vcode: no commas, 2 decimal places when needed. */
export function formatFiuuAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '0.00';
  return n.toFixed(2);
}

/**
 * vcode for payment request: md5(amount + merchantID + orderID + verifyKey [+ currency])
 */
export function buildPaymentVcode({ amount, orderid, currency = 'PHP' }) {
  const merchantID = getFiuuMerchantId();
  const verifyKey = getFiuuVerifyKey();
  const amt = formatFiuuAmount(amount);
  const oid = String(orderid || '').trim();
  if (getFiuuExtendedVcode()) {
    return md5Hex(`${amt}${merchantID}${oid}${verifyKey}${currency}`);
  }
  return md5Hex(`${amt}${merchantID}${oid}${verifyKey}`);
}

/**
 * Verify FIUU webhook/return skey.
 * HPP IPN uses Secret Key; Recurring API v7 sample documents Verify Key for callback skey.
 * Accept either so MIT and HPP share one handler.
 * @see https://docs.fiuu.dev/reference/security-data-integrity
 * @see Fiuu Recurring API v7.1.4
 */
export function verifyPaymentSkey(payload) {
  const secretKey = getFiuuSecretKey();
  const verifyKey = getFiuuVerifyKey();
  if (!secretKey && !verifyKey) return false;

  const tranID = String(payload.tranID ?? payload.txnID ?? '').trim();
  const orderid = String(payload.orderid ?? '').trim();
  const status = String(payload.status ?? '').trim();
  const merchant = String(payload.domain ?? payload.merchantID ?? getFiuuMerchantId()).trim();
  const amount = String(payload.amount ?? '').trim();
  const currency = String(payload.currency ?? 'PHP').trim();
  const appcode = String(payload.appcode ?? '').trim();
  const paydate = String(payload.paydate ?? '').trim();
  const skey = String(payload.skey ?? '').trim();

  if (!tranID || !orderid || !skey) return false;

  const key0 = md5Hex(`${tranID}${orderid}${status}${merchant}${amount}${currency}`);
  if (secretKey) {
    const key1Secret = md5Hex(`${paydate}${merchant}${key0}${appcode}${secretKey}`);
    if (skey === key1Secret) return true;
  }
  if (verifyKey) {
    const key1Verify = md5Hex(`${paydate}${merchant}${key0}${appcode}${verifyKey}`);
    if (skey === key1Verify) return true;
  }
  return false;
}

/**
 * Recurring MIT request checksum (RecordType T / E / K).
 * md5(RecordType + MerchantID + SubMerchant + Token + OrderID + Currency + Amount + Verifykey)
 */
export function buildRecurringChecksum({
  recordType = 'T',
  merchantId,
  subMerchant = '',
  token,
  orderid,
  currency,
  amount,
}) {
  const verifyKey = getFiuuVerifyKey();
  const mid = String(merchantId ?? getFiuuMerchantId()).trim();
  const amt = formatFiuuAmount(amount);
  return md5Hex(
    `${String(recordType).trim()}${mid}${String(subMerchant ?? '')}${String(token).trim()}${String(orderid).trim()}${String(currency).trim()}${amt}${verifyKey}`
  );
}

/** FIUU success status code is typically "00". */
export function isFiuuPaymentSuccess(status) {
  const s = String(status ?? '').trim();
  return s === '00' || s.toLowerCase() === 'success' || s.toLowerCase() === 'captured';
}

/** Pending authorization (async MIT may return 22 before final result). */
export function isFiuuPaymentPending(status) {
  const s = String(status ?? '').trim();
  return s === '22' || s.toLowerCase() === 'pending';
}

export function isFiuuPaymentFailed(status) {
  const s = String(status ?? '').trim();
  // 22 = pending (not failure) — keep gateway row pending for final notify
  return s === '11' || s.toLowerCase() === 'failed';
}
