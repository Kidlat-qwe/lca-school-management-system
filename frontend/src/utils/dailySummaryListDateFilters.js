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

/**
 * Maps the Payment Logs–style 3-mode control to list API query params.
 *
 * - **End of shift** (`GET /daily-summary-sales`): delegates to
 *   `buildPaymentLogDateParams` — Month / Payment date → `payment_date_*`;
 *   Issue Date → `created_date_*` (same param names as Payment Logs; backend
 *   applies both to `summary_date`, aligned with `paymenttbl.issue_date` per day).
 * - **Cash deposit** (`GET /cash-deposit-summaries`): Month and Payment date →
 *   `date_from` / `date_to` (period overlap). Issue Date → `created_date_*`
 *   (row `created_at`, unchanged from prior cash-deposit behavior).
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
