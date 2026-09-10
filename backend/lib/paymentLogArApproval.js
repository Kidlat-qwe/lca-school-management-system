/**
 * Payment Logs approval for unapplied Acknowledgement Receipt rows (finance-unified).
 *
 * AR records: cash Package/Merchandise → Verified on issue (Admin verifier → Payment Logs Pending).
 * Non-cash Package/Merchandise → Finance verifies on AR page → Payment Logs Approved for Finance verifiers.
 * FIUU gateway ARs → always Payment Logs Pending until Finance verifies (HPP / MIT / AR).
 */

export function isAdminUserType(userType) {
  return String(userType || '').trim().toLowerCase() === 'admin';
}

/** True when AR/payment method is FIUU (HPP, MIT channel labels, Online). */
export function isFiuuPaymentMethod(paymentMethod) {
  const m = String(paymentMethod || '').trim().toLowerCase();
  if (!m) return false;
  return m === 'fiuu' || m.startsWith('fiuu ') || m.startsWith('fiuu-') || m.includes('fiuu');
}

/**
 * @param {{ verified_by_user_id?: number|null, verified_at?: string|null, verified_by_name?: string|null, verifier_user_type?: string|null, payment_method?: string|null }} row
 */
export function paymentLogApprovalFromArVerification(row) {
  if (isFiuuPaymentMethod(row?.payment_method)) {
    return {
      approval_status: 'Pending',
      approved_by: null,
      approved_at: null,
      approved_by_name: null,
    };
  }

  const verifiedBy = row?.verified_by_user_id;
  if (verifiedBy == null) {
    return {
      approval_status: 'Pending',
      approved_by: null,
      approved_at: null,
      approved_by_name: null,
    };
  }

  if (isAdminUserType(row.verifier_user_type)) {
    return {
      approval_status: 'Pending',
      approved_by: null,
      approved_at: null,
      approved_by_name: null,
    };
  }

  return {
    approval_status: 'Approved',
    approved_by: verifiedBy,
    approved_at: row.verified_at ?? null,
    approved_by_name: row.verified_by_name ?? null,
  };
}

/**
 * Whether linked paymenttbl should be auto-approved when this user verifies an AR.
 */
export function shouldSyncPaymentLogApprovalOnArVerify(userType) {
  return !isAdminUserType(userType);
}
