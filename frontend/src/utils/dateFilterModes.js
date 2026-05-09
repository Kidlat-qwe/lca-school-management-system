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

export const DATE_FILTER_MODES = Object.freeze({
  MONTH: 'month',
  PRIMARY: 'primary',
  CREATED_DATE: 'createdDate',
});

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
      if (primaryFrom) out[fromKey] = primaryFrom;
      if (primaryTo) out[toKey] = primaryTo;
      return out;
    }
    if (mode === DATE_FILTER_MODES.CREATED_DATE) {
      if (createdFrom) out.created_date_from = createdFrom;
      if (createdTo) out.created_date_to = createdTo;
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
