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
 * @see https://docs.fiuu.dev/reference/security-data-integrity
 */
export function verifyPaymentSkey(payload) {
  const secretKey = getFiuuSecretKey();
  if (!secretKey) return false;

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
  const key1 = md5Hex(`${paydate}${merchant}${key0}${appcode}${secretKey}`);
  return skey === key1;
}

/** FIUU success status code is typically "00". */
export function isFiuuPaymentSuccess(status) {
  const s = String(status ?? '').trim();
  return s === '00' || s.toLowerCase() === 'success' || s.toLowerCase() === 'captured';
}

export function isFiuuPaymentFailed(status) {
  const s = String(status ?? '').trim();
  return s === '11' || s === '22' || s.toLowerCase() === 'failed';
}
