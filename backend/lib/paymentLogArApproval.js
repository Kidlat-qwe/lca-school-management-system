/**
 * Payment Logs approval for unapplied Acknowledgement Receipt rows (finance-unified).
 *
 * AR records stay Verified/Applied in acknowledgement_receiptstbl.
 * Payment Logs "Approved" applies only when Finance/Superfinance/Superadmin verified the AR —
 * not when user_type = Admin (those show Pending Approval on Payment Logs).
 */

export function isAdminUserType(userType) {
  return String(userType || '').trim().toLowerCase() === 'admin';
}

/**
 * @param {{ verified_by_user_id?: number|null, verified_at?: string|null, verified_by_name?: string|null, verifier_user_type?: string|null }} row
 */
export function paymentLogApprovalFromArVerification(row) {
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
