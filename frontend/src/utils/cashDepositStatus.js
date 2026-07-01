/** DB statuses that mean “awaiting Superfinance verification” (Submitted = legacy). */
export const CASH_DEPOSIT_PENDING_VERIFY_STATUSES = new Set(['Pending', 'Submitted']);

export function formatCashDepositStatus(status) {
  const key = String(status || '').trim();
  if (CASH_DEPOSIT_PENDING_VERIFY_STATUSES.has(key)) return 'Pending';
  if (key === 'Approved') return 'Verified';
  if (key === 'Returned' || key === 'Rejected') return 'Returned';
  return key || '—';
}

export function cashDepositStatusBadgeClass(status) {
  const key = String(status || '').trim();
  if (key === 'Approved') return 'bg-green-100 text-green-800';
  if (CASH_DEPOSIT_PENDING_VERIFY_STATUSES.has(key)) return 'bg-amber-100 text-amber-800';
  if (key === 'Returned' || key === 'Rejected') return 'bg-amber-100 text-amber-800';
  return 'bg-gray-100 text-gray-800';
}

/** Finance with no branch (HQ) or explicit Superfinance role — matches /superfinance/* routes. */
export function isSuperfinanceUser(userInfo) {
  const userType = String(userInfo?.user_type || userInfo?.userType || '').trim();
  const branchId = userInfo?.branch_id ?? userInfo?.branchId;
  const hasNoBranch = branchId === null || branchId === undefined || branchId === '';
  if (userType === 'Superfinance') return true;
  if (userType === 'Finance' && hasNoBranch) return true;
  return false;
}

/** Pending / legacy Submitted — show Verify and Return (Finance/Superfinance UI). */
export function canSuperfinanceVerifyCashDeposit(status) {
  return CASH_DEPOSIT_PENDING_VERIFY_STATUSES.has(String(status || '').trim());
}

export function canSuperfinanceActOnCashDeposit(status) {
  return canSuperfinanceVerifyCashDeposit(status);
}
