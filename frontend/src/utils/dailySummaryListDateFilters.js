import { issueDateRangeFromManilaMonth } from './dateUtils';
import {
  buildPaymentLogDateParams,
  hasActivePaymentLogDateFilter,
  DEFAULT_PAYMENT_LOG_DATE_MODE,
  PAYMENT_LOG_DATE_MODES,
  defaultPaymentLogFilterMonth,
} from './paymentLogDateFilters';

/** Same default as Payment Logs (current Manila month). */
export const DEFAULT_DAILY_SUMMARY_DATE_FILTER_MODE = DEFAULT_PAYMENT_LOG_DATE_MODE;

export const defaultDailySummaryFilterMonth = defaultPaymentLogFilterMonth;

/** End of Shift tab: Month | End of shift date | EOD submit date */
export const DAILY_SUMMARY_EOD_DATE_MODE_LABELS = Object.freeze({
  [PAYMENT_LOG_DATE_MODES.MONTH]: 'Month',
  [PAYMENT_LOG_DATE_MODES.PAYMENT_DATE]: 'End of shift date',
  [PAYMENT_LOG_DATE_MODES.CREATED_DATE]: 'EOD submit date',
});

/** Cash Deposit tab: Month | Deposit date | Submit date */
export const DAILY_SUMMARY_CASH_DEPOSIT_DATE_MODE_LABELS = Object.freeze({
  [PAYMENT_LOG_DATE_MODES.MONTH]: 'Month',
  [PAYMENT_LOG_DATE_MODES.PAYMENT_DATE]: 'Deposit date',
  [PAYMENT_LOG_DATE_MODES.CREATED_DATE]: 'Submit date',
});

/**
 * @param {boolean} isCashDepositTab
 * @returns {typeof DAILY_SUMMARY_EOD_DATE_MODE_LABELS}
 */
export function getDailySummaryDateModeLabels(isCashDepositTab) {
  return isCashDepositTab ? DAILY_SUMMARY_CASH_DEPOSIT_DATE_MODE_LABELS : DAILY_SUMMARY_EOD_DATE_MODE_LABELS;
}

/**
 * Tooltip for the date-filter panel title attribute.
 * @param {boolean} isCashDepositTab
 * @param {string} mode
 */
export function getDailySummaryDateFilterTitle(isCashDepositTab, mode) {
  if (mode === PAYMENT_LOG_DATE_MODES.MONTH) {
    return isCashDepositTab
      ? 'Deposit periods overlapping the selected Manila month. Clear month for all.'
      : 'End-of-shift rows whose summary day falls in the Manila month. Clear month for all.';
  }
  if (mode === PAYMENT_LOG_DATE_MODES.PAYMENT_DATE) {
    return isCashDepositTab
      ? 'Deposits whose cash period overlaps your date range (inclusive).'
      : 'End of shift calendar day range on summary_date (inclusive).';
  }
  return isCashDepositTab
    ? 'Filter by when the deposit was submitted (submitted_at date, inclusive).'
    : 'Filter by when the end-of-shift summary was submitted (submitted_at date, inclusive).';
}

/** Short helper line below the date filter row. */
export function getDailySummaryDateFilterHint(isCashDepositTab) {
  return isCashDepositTab
    ? 'Month and Deposit date include summaries whose period overlaps the range. Submit date filters when the branch submitted the deposit (submitted_at).'
    : 'Month and End of shift date filter the business day closed (summary_date). EOD submit date filters when the branch submitted the summary (submitted_at). Clear the month to show all dates.';
}

/**
 * Maps the 3-mode date control to list API query params.
 *
 * - **End of shift** (`GET /daily-summary-sales`): Month / End of shift date →
 *   `payment_date_*` on `summary_date`; EOD submit date → `created_date_*` on
 *   `submitted_at::date`.
 * - **Cash deposit** (`GET /cash-deposit-summaries`): Month / Deposit date →
 *   `date_from` / `date_to` (period overlap). Submit date → `created_date_*`
 *   on `submitted_at::date`.
 *
 * @param {boolean} isCashDepositTab
 * @param {{ mode: string, month?: string, paymentFrom?: string, paymentTo?: string, createdFrom?: string, createdTo?: string }} args
 * @returns {Record<string, string>}
 */
export function buildDailySummaryListDateQueryParams(isCashDepositTab, args) {
  const { mode, month = '', paymentFrom = '', paymentTo = '', createdFrom = '', createdTo = '' } = args || {};
  if (!isCashDepositTab) {
    return buildPaymentLogDateParams({
      mode,
      month,
      paymentFrom,
      paymentTo,
      createdFrom,
      createdTo,
    });
  }
  const out = {};
  if (mode === PAYMENT_LOG_DATE_MODES.MONTH) {
    const range = issueDateRangeFromManilaMonth(month);
    if (range.from) out.date_from = range.from;
    if (range.to) out.date_to = range.to;
    return out;
  }
  if (mode === PAYMENT_LOG_DATE_MODES.PAYMENT_DATE) {
    if (paymentFrom) out.date_from = paymentFrom;
    if (paymentTo) out.date_to = paymentTo;
    return out;
  }
  if (mode === PAYMENT_LOG_DATE_MODES.CREATED_DATE) {
    if (createdFrom) out.created_date_from = createdFrom;
    if (createdTo) out.created_date_to = createdTo;
    return out;
  }
  return out;
}

/**
 * @param {{ mode: string, month?: string, paymentFrom?: string, paymentTo?: string, createdFrom?: string, createdTo?: string }} args
 */
export function hasActiveDailySummaryListDateFilter(args) {
  return hasActivePaymentLogDateFilter(args);
}
