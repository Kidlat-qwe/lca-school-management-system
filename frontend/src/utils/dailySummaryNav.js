/** Daily Summary Sales route segments and helpers (sidebar + notifications). */

export const DAILY_SUMMARY_ROUTE_SEGMENTS = {
  END_OF_SHIFT: 'end-of-shift',
  CASH_DEPOSIT: 'cash-deposit-summary',
};

export const DAILY_SUMMARY_KIND = {
  END_OF_SHIFT: 'endOfShift',
  CASH_DEPOSIT: 'cashDeposit',
};

export function getDailySummaryKindFromPathname(pathname = '') {
  if (String(pathname).includes(DAILY_SUMMARY_ROUTE_SEGMENTS.CASH_DEPOSIT)) {
    return DAILY_SUMMARY_KIND.CASH_DEPOSIT;
  }
  return DAILY_SUMMARY_KIND.END_OF_SHIFT;
}

export function getDailySummaryRouteSegment(kind) {
  return kind === DAILY_SUMMARY_KIND.CASH_DEPOSIT
    ? DAILY_SUMMARY_ROUTE_SEGMENTS.CASH_DEPOSIT
    : DAILY_SUMMARY_ROUTE_SEGMENTS.END_OF_SHIFT;
}

/**
 * Base path for daily summary sales for the signed-in user (no trailing segment).
 * @param {{ user_type?: string, userType?: string, branch_id?: number|null, branchId?: number|null }} userInfo
 */
export function getDailySummaryBasePath(userInfo) {
  const userType = userInfo?.user_type || userInfo?.userType;
  const branchId = userInfo?.branchId ?? userInfo?.branch_id;

  if (userType === 'Superadmin') return '/superadmin/daily-summary-sales';
  if (userType === 'Admin') return '/admin/daily-summary-sales';
  if (userType === 'Superfinance') return '/superfinance/daily-summary-sales';
  if (userType === 'Finance') {
    return branchId === null || branchId === undefined
      ? '/superfinance/daily-summary-sales'
      : '/finance/daily-summary-sales';
  }
  return '/superadmin/daily-summary-sales';
}

export function buildDailySummaryPath(userInfo, kind = DAILY_SUMMARY_KIND.END_OF_SHIFT) {
  const base = getDailySummaryBasePath(userInfo);
  const segment = getDailySummaryRouteSegment(kind);
  return `${base}/${segment}`;
}

export function getDailySummaryPageTitle(kind) {
  return kind === DAILY_SUMMARY_KIND.CASH_DEPOSIT ? 'Cash Deposit Summary' : 'End of Shift';
}
