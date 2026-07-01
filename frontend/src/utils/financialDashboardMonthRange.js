import { issueDateRangeFromManilaMonth } from './dateUtils';

/**
 * Inclusive payment / issue date range for Financial Dashboard month picker.
 * Matches Payment Logs month mode and Acknowledgement Receipts Month filter.
 */
export function financialDashboardMonthRange(monthYm) {
  return issueDateRangeFromManilaMonth(monthYm);
}

export function appendFinancialDashboardPaymentMonthParams(params, monthYm) {
  const { from, to } = financialDashboardMonthRange(monthYm);
  if (from) params.set('payment_date_from', from);
  if (to) params.set('payment_date_to', to);
  return params;
}

/** AR list Month filter — pass ar_month=YYYY-MM so the list opens in Month mode. */
export function appendFinancialDashboardArMonthParams(params, monthYm) {
  const month = String(monthYm || '').trim();
  if (/^\d{4}-\d{2}$/.test(month)) {
    params.set('ar_month', month);
  }
  return params;
}
