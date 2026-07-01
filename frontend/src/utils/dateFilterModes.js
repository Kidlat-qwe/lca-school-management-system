/**
 * Generic factory for the 3-mode date filter switcher used across pages
 * that need to filter by either a "primary date" (e.g. payment_date,
 * issue_date) OR by the record-created date, with a single Month picker
 * as the default convenience mode.
 *
 * The three modes are mutually exclusive:
 *
 *   - "month"        → single YYYY-MM picker (default current Manila month).
 *                      Emits {primary}_from / {primary}_to spanning the month.
 *   - "primary"      → explicit From / To range on the primary date.
 *                      Emits {primary}_from / {primary}_to.
 *   - "createdDate"  → explicit From / To range on the record-created date.
 *                      Emits created_date_from / created_date_to.
 *
 * Centralizing the mode <-> URL-param translation here keeps the four
 * Payment Logs pages, the four Invoice pages, and the AR page all in lock-step
 * even if param naming diverges (payment_date_* vs issue_date_*).
 */

import { issueDateRangeFromManilaMonth, manilaMonthYYYYMM } from './dateUtils';

/** Keep only a valid YYYY-MM-DD for API query params (avoids accidental suffixes). */
const toYmdParam = (raw) => {
  const t = String(raw ?? '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : '';
};

export const DATE_FILTER_MODES = Object.freeze({
  MONTH: 'month',
  PAYMENT_DATE: 'paymentDate',
  ISSUE_DATE: 'issueDate',
  PRIMARY: 'primary',
  CREATED_DATE: 'createdDate',
});

/**
 * When switching Month | Payment date | Issue Date on list UIs, clear stored values
 * for modes you are leaving so hidden inputs do not keep stale ranges that reappear
 * when switching back (e.g. Payment date → Month should clear From/To).
 *
 * @param {string} nextMode
 * @param {{ setPaymentFrom: (v: string) => void, setPaymentTo: (v: string) => void, setIssueFrom: (v: string) => void, setIssueTo: (v: string) => void }} setters
 */
export function clearInactivePaymentIssueDateModeFields(nextMode, setters) {
  const { setPaymentFrom, setPaymentTo, setIssueFrom, setIssueTo } = setters;
  if (nextMode === DATE_FILTER_MODES.MONTH) {
    setPaymentFrom('');
    setPaymentTo('');
    setIssueFrom('');
    setIssueTo('');
  } else if (nextMode === DATE_FILTER_MODES.PAYMENT_DATE) {
    setIssueFrom('');
    setIssueTo('');
  } else if (nextMode === DATE_FILTER_MODES.ISSUE_DATE) {
    setPaymentFrom('');
    setPaymentTo('');
  }
}

export const DEFAULT_DATE_FILTER_MODE = DATE_FILTER_MODES.MONTH;

/** Default Manila YYYY-MM seeded into the Month picker on first render. */
export const defaultDateFilterMonth = () => manilaMonthYYYYMM();

/**
 * Build a date-filter helper bound to a particular primary-date URL param.
 *
 * @param {object} config
 * @param {string} config.primaryParam         - URL param prefix for the primary date,
 *                                               e.g. 'payment_date' or 'issue_date'.
 *                                               (Will emit `${primaryParam}_from` / `${primaryParam}_to`.)
 * @param {string} [config.primaryLabel='Date'] - Human label for the primary mode tab,
 *                                               e.g. 'Payment date' or 'Issue date'.
 * @returns {{
 *   MODES: typeof DATE_FILTER_MODES,
 *   MODE_LABELS: Record<string, string>,
 *   DEFAULT_MODE: string,
 *   defaultMonth: () => string,
 *   buildParams: (args: object) => Record<string, string>,
 *   hasActiveFilter: (args: object) => boolean,
 * }}
 */
export const makeDateFilterUtil = ({ primaryParam, primaryLabel = 'Date' } = {}) => {
  if (!primaryParam || typeof primaryParam !== 'string') {
    throw new Error('makeDateFilterUtil: primaryParam is required');
  }
  const fromKey = `${primaryParam}_from`;
  const toKey = `${primaryParam}_to`;

  const MODE_LABELS = Object.freeze({
    [DATE_FILTER_MODES.MONTH]: 'Month',
    [DATE_FILTER_MODES.PRIMARY]: primaryLabel,
    [DATE_FILTER_MODES.CREATED_DATE]: 'Date created',
  });

  const buildParams = ({
    mode,
    month = '',
    primaryFrom = '',
    primaryTo = '',
    createdFrom = '',
    createdTo = '',
  } = {}) => {
    const out = {};
    if (mode === DATE_FILTER_MODES.MONTH) {
      const range = issueDateRangeFromManilaMonth(month);
      if (range.from) out[fromKey] = range.from;
      if (range.to) out[toKey] = range.to;
      return out;
    }
    if (mode === DATE_FILTER_MODES.PRIMARY) {
      const pf = toYmdParam(primaryFrom);
      const pt = toYmdParam(primaryTo);
      if (pf) out[fromKey] = pf;
      if (pt) out[toKey] = pt;
      return out;
    }
    if (mode === DATE_FILTER_MODES.CREATED_DATE) {
      const cf = toYmdParam(createdFrom);
      const ct = toYmdParam(createdTo);
      if (cf) out.created_date_from = cf;
      if (ct) out.created_date_to = ct;
      return out;
    }
    return out;
  };

  const hasActiveFilter = ({
    mode,
    month = '',
    primaryFrom = '',
    primaryTo = '',
    createdFrom = '',
    createdTo = '',
  } = {}) => {
    if (mode === DATE_FILTER_MODES.MONTH) return Boolean(month);
    if (mode === DATE_FILTER_MODES.PRIMARY) return Boolean(primaryFrom || primaryTo);
    if (mode === DATE_FILTER_MODES.CREATED_DATE) return Boolean(createdFrom || createdTo);
    return false;
  };

  return Object.freeze({
    MODES: DATE_FILTER_MODES,
    MODE_LABELS,
    DEFAULT_MODE: DEFAULT_DATE_FILTER_MODE,
    defaultMonth: defaultDateFilterMonth,
    buildParams,
    hasActiveFilter,
  });
};

/**
 * Pre-built helper for any page filtering by an `issue_date` primary date
 * (Invoice list + Acknowledgement Receipts list).
 *
 * URL params emitted:
 *   - mode 'month'       → issue_date_from / issue_date_to (spanning the month)
 *   - mode 'primary'     → issue_date_from / issue_date_to (explicit range)
 *   - mode 'createdDate' → created_date_from / created_date_to
 */
export const issueDateFilterUtil = makeDateFilterUtil({
  primaryParam: 'issue_date',
  primaryLabel: 'Issue date',
});

/**
 * Shared helper for Invoice list pages (Month | Payment date | Issue Date).
 * Month and Payment date modes align with Payment Logs (payment_date_from/to).
 *
 *   - mode 'month'       -> payment_date_from / payment_date_to (Manila calendar month)
 *   - mode 'paymentDate' -> payment_date_from / payment_date_to
 *   - mode 'issueDate'   -> issue_date_from / issue_date_to
 */
export const paymentAndIssueDateFilterUtil = Object.freeze({
  MODES: DATE_FILTER_MODES,
  MODE_LABELS: Object.freeze({
    [DATE_FILTER_MODES.MONTH]: 'Month',
    [DATE_FILTER_MODES.PAYMENT_DATE]: 'Payment date',
    [DATE_FILTER_MODES.ISSUE_DATE]: 'Issue Date',
  }),
  DEFAULT_MODE: DATE_FILTER_MODES.MONTH,
  defaultMonth: defaultDateFilterMonth,
  buildParams: ({
    mode,
    month = '',
    paymentFrom = '',
    paymentTo = '',
    issueFrom = '',
    issueTo = '',
  } = {}) => {
    const out = {};
    if (mode === DATE_FILTER_MODES.MONTH) {
      const range = issueDateRangeFromManilaMonth(month);
      if (range.from) out.payment_date_from = range.from;
      if (range.to) out.payment_date_to = range.to;
      return out;
    }
    if (mode === DATE_FILTER_MODES.PAYMENT_DATE) {
      const pf = toYmdParam(paymentFrom);
      const pt = toYmdParam(paymentTo);
      if (pf) out.payment_date_from = pf;
      if (pt) out.payment_date_to = pt;
      return out;
    }
    if (mode === DATE_FILTER_MODES.ISSUE_DATE) {
      const inf = toYmdParam(issueFrom);
      const int = toYmdParam(issueTo);
      if (inf) out.issue_date_from = inf;
      if (int) out.issue_date_to = int;
      return out;
    }
    return out;
  },
  hasActiveFilter: ({
    mode,
    month = '',
    paymentFrom = '',
    paymentTo = '',
    issueFrom = '',
    issueTo = '',
  } = {}) => {
    if (mode === DATE_FILTER_MODES.MONTH) return Boolean(month);
    if (mode === DATE_FILTER_MODES.PAYMENT_DATE) return Boolean(paymentFrom || paymentTo);
    if (mode === DATE_FILTER_MODES.ISSUE_DATE) return Boolean(issueFrom || issueTo);
    return false;
  },
});
