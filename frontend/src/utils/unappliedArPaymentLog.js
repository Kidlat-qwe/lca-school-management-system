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

/** Revoke Finance/Superfinance verification on an unapplied package AR row (Payment Logs). */
export async function revokeUnappliedArFromPaymentLog(payment) {
  const ackReceiptId = parseUnappliedArAckReceiptId(payment);
  if (!ackReceiptId) {
    throw new Error('Invalid acknowledgement receipt row.');
  }
  return apiRequest(`/acknowledgement-receipts/${ackReceiptId}/verify`, {
    method: 'PUT',
    body: JSON.stringify({ action: 'unverify' }),
  });
}

/**
 * Approve or revoke approval on a payment log row (cash/bank or unapplied AR).
 * @param {object|number|string} paymentOrId — full row or numeric payment_id
 * @param {boolean} approve
 */
export async function setPaymentLogApproval(paymentOrId, approve) {
  const payment =
    paymentOrId != null && typeof paymentOrId === 'object'
      ? paymentOrId
      : { payment_id: paymentOrId };

  if (isUnappliedArPaymentLogRow(payment)) {
    if (approve) {
      throw new Error('Approve unapplied acknowledgement receipts from the verification modal.');
    }
    return revokeUnappliedArFromPaymentLog(payment);
  }

  const paymentId = payment.payment_id ?? paymentOrId;
  return apiRequest(`/payments/${paymentId}/approve`, {
    method: 'PUT',
    body: JSON.stringify({ approve }),
  });
}

/** Finance/Superfinance/Superadmin can approve or revoke rows in scope. */
export function canApprovePaymentLog(userInfo, payment) {
  const userType = userInfo?.user_type || userInfo?.userType;
  const userBranchId = userInfo?.branch_id ?? userInfo?.branchId;
  if (!userType || !payment) return false;
  if (userType === 'Superadmin' || userType === 'Superfinance') return true;
  if (userType === 'Finance') {
    if (userBranchId == null || userBranchId === undefined) return true;
    if (payment.branch_id == null || payment.branch_id === undefined) return true;
    return Number(payment.branch_id) === Number(userBranchId);
  }
  return false;
}
