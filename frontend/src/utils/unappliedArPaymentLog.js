import { apiRequest } from '../config/api';

export function isUnappliedArPaymentLogRow(payment) {
  if (!payment) return false;
  if (payment.source_type === 'UNAPPLIED_AR') return true;
  return String(payment.payment_id || '').startsWith('AR-');
}

export function parseUnappliedArAckReceiptId(payment) {
  if (!payment) return null;
  const fromSource = String(payment.source_id || '').match(/^AR-(\d+)$/);
  if (fromSource) return parseInt(fromSource[1], 10);
  const fromPaymentId = String(payment.payment_id || '').match(/^AR-(\d+)$/);
  if (fromPaymentId) return parseInt(fromPaymentId[1], 10);
  if (payment.ack_receipt_id != null) return Number(payment.ack_receipt_id);
  return null;
}

/**
 * Finance/Superfinance approval on Payment Logs for unapplied package AR rows.
 * Verifies the acknowledgement receipt (same as AR page Verify).
 */
export async function verifyUnappliedArFromPaymentLog(payment) {
  const ackReceiptId = parseUnappliedArAckReceiptId(payment);
  if (!ackReceiptId) {
    throw new Error('Invalid acknowledgement receipt row.');
  }
  return apiRequest(`/acknowledgement-receipts/${ackReceiptId}/verify`, {
    method: 'PUT',
    body: JSON.stringify({ action: 'verify' }),
  });
}
