/**
 * Shared helpers for the Payment Logs date-filter mode switcher.
 *
 * The Payment Logs pages (admin / superadmin / finance / superfinance) all
 * expose three mutually-exclusive date filter modes:
 *
 *   - "month"        → single YYYY-MM picker (defaults to current Manila month).
 *                      Translated to payment_date_from / payment_date_to.
 *   - "paymentDate"  → explicit From / To range on payment_date (p.issue_date).
 *   - "createdDate"  → explicit From / To range on payment **issue date** (same column as
 *                      the table header "Issue Date"; API params `created_date_from/to`
 *                      filter `p.issue_date` / `ar.issue_date` for parity with this label).
 *
 * Keeping the mode <-> param translation in one place avoids drift between
 * the four pages and the export-paths.
 */

import { issueDateRangeFromManilaMonth, manilaMonthYYYYMM } from './dateUtils';

export const PAYMENT_LOG_DATE_MODES = Object.freeze({
  MONTH: 'month',
  PAYMENT_DATE: 'paymentDate',
  CREATED_DATE: 'createdDate',
});

export const PAYMENT_LOG_DATE_MODE_LABELS = Object.freeze({
  [PAYMENT_LOG_DATE_MODES.MONTH]: 'Month',
  [PAYMENT_LOG_DATE_MODES.PAYMENT_DATE]: 'Payment date',
  [PAYMENT_LOG_DATE_MODES.CREATED_DATE]: 'Issue Date',
});

/**
 * Default mode the page boots with.
 */
export const DEFAULT_PAYMENT_LOG_DATE_MODE = PAYMENT_LOG_DATE_MODES.MONTH;

/**
 * Default month (current Manila YYYY-MM) used when boot-loading "month" mode.
 */
export const defaultPaymentLogFilterMonth = () => manilaMonthYYYYMM();

/**
 * Build the date-related URL params for a Payment Logs request based on the
 * active mode and its inputs. Returns an object with at most:
 *   { payment_date_from, payment_date_to, created_date_from, created_date_to }
 *
 * Empty/blank inputs are simply omitted so callers can spread the result into
 * a URLSearchParams without setting empty params.
 *
 * @param {object} args
 * @param {'month'|'paymentDate'|'createdDate'} args.mode
 * @param {string} [args.month]           - YYYY-MM (used when mode === 'month')
 * @param {string} [args.paymentFrom]     - YYYY-MM-DD
 * @param {string} [args.paymentTo]       - YYYY-MM-DD
 * @param {string} [args.createdFrom]     - YYYY-MM-DD
 * @param {string} [args.createdTo]       - YYYY-MM-DD
 * @returns {Record<string, string>}
 */
export const buildPaymentLogDateParams = ({
  mode,
  month = '',
  paymentFrom = '',
  paymentTo = '',
  createdFrom = '',
  createdTo = '',
} = {}) => {
  const out = {};
  if (mode === PAYMENT_LOG_DATE_MODES.MONTH) {
    const range = issueDateRangeFromManilaMonth(month);
    if (range.from) out.payment_date_from = range.from;
    if (range.to) out.payment_date_to = range.to;
    return out;
  }
  if (mode === PAYMENT_LOG_DATE_MODES.PAYMENT_DATE) {
    if (paymentFrom) out.payment_date_from = paymentFrom;
    if (paymentTo) out.payment_date_to = paymentTo;
    return out;
  }
  if (mode === PAYMENT_LOG_DATE_MODES.CREATED_DATE) {
    if (createdFrom) out.created_date_from = createdFrom;
    if (createdTo) out.created_date_to = createdTo;
    return out;
  }
  return out;
};

/**
 * Convenience: returns true when the active mode currently has any non-empty
 * date input. Used to decide whether to highlight a "Date filter active"
 * indicator and whether Reset should re-fetch.
 */
export const hasActivePaymentLogDateFilter = ({
  mode,
  month = '',
  paymentFrom = '',
  paymentTo = '',
  createdFrom = '',
  createdTo = '',
} = {}) => {
  if (mode === PAYMENT_LOG_DATE_MODES.MONTH) return Boolean(month);
  if (mode === PAYMENT_LOG_DATE_MODES.PAYMENT_DATE) return Boolean(paymentFrom || paymentTo);
  if (mode === PAYMENT_LOG_DATE_MODES.CREATED_DATE) return Boolean(createdFrom || createdTo);
  return false;
};

/**
 * Parse Payment Logs deep-link query params (Financial Dashboard → Payment Logs).
 *
 * @param {string} search - location.search (e.g. "?financeApproval=approved&...")
 * @returns {{
 *   logTab: 'main'|'return'|'rejected',
 *   financeApproval: ''|'approved'|'pending',
 *   clearFinanceApproval: boolean,
 *   paymentDateFrom: string,
 *   paymentDateTo: string,
 *   usePaymentDateMode: boolean,
 * }}
 */
export const parsePaymentLogsLocationSearch = (search = '') => {
  const params = new URLSearchParams(search);
  const notificationTab = params.get('notificationTab');
  const financeApproval = params.get('financeApproval');
  const payFrom = (params.get('payment_date_from') || params.get('issue_date_from') || '')
    .trim()
    .slice(0, 10);
  const payTo = (params.get('payment_date_to') || params.get('issue_date_to') || '').trim().slice(0, 10);
  const hasUrlPayFrom = /^\d{4}-\d{2}-\d{2}$/.test(payFrom);
  const hasUrlPayTo = /^\d{4}-\d{2}-\d{2}$/.test(payTo);

  return {
    logTab:
      notificationTab === 'return' || notificationTab === 'rejected' ? notificationTab : 'main',
    financeApproval:
      financeApproval === 'approved' || financeApproval === 'pending' ? financeApproval : '',
    clearFinanceApproval: financeApproval === 'all' || financeApproval === '',
    paymentDateFrom: hasUrlPayFrom ? payFrom : '',
    paymentDateTo: hasUrlPayTo ? payTo : '',
    usePaymentDateMode: hasUrlPayFrom || hasUrlPayTo,
  };
};
