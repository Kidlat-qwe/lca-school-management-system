/**
 * Financial Dashboard → Invoice list deep links (Penalties KPI, etc.).
 */

import {
  DATE_FILTER_MODES,
  paymentAndIssueDateFilterUtil as invoiceDateFilterUtil,
} from '../dateFilterModes';

const toYmd = (raw) => {
  const t = String(raw ?? '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : '';
};

const toMonthYm = (raw) => {
  const t = String(raw ?? '').trim().slice(0, 7);
  return /^\d{4}-\d{2}$/.test(t) ? t : '';
};

export function parseTruthyQueryFlag(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * Parse Invoice list deep-link query params (Financial Dashboard Penalties → Invoice).
 *
 * Supported:
 * - has_penalty=1
 * - statuses=Paid (or status=Paid)
 * - invoice_month=YYYY-MM → Month filter mode
 * - payment_date_from / payment_date_to → Payment date mode (when no invoice_month)
 */
export function parseInvoiceListDeepLinkFromSearchParams(searchParams) {
  const params = searchParams instanceof URLSearchParams
    ? searchParams
    : new URLSearchParams(String(searchParams || ''));

  const hasPenalty = parseTruthyQueryFlag(params.get('has_penalty'));
  const statusesRaw = String(params.get('statuses') || params.get('status') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const invoiceMonth = toMonthYm(params.get('invoice_month'));
  const payFrom = toYmd(params.get('payment_date_from'));
  const payTo = toYmd(params.get('payment_date_to'));

  const defaults = {
    hasPenalty,
    statuses: statusesRaw,
    dateFilterMode: invoiceDateFilterUtil.DEFAULT_MODE,
    filterIssueMonth: invoiceDateFilterUtil.defaultMonth(),
    filterPaymentDateFrom: '',
    filterPaymentDateTo: '',
    filterIssueDateFrom: '',
    filterIssueDateTo: '',
  };

  if (invoiceMonth) {
    return {
      ...defaults,
      dateFilterMode: DATE_FILTER_MODES.MONTH,
      filterIssueMonth: invoiceMonth,
    };
  }

  if (payFrom || payTo) {
    return {
      ...defaults,
      dateFilterMode: DATE_FILTER_MODES.PAYMENT_DATE,
      filterIssueMonth: '',
      filterPaymentDateFrom: payFrom,
      filterPaymentDateTo: payTo,
    };
  }

  return defaults;
}

/**
 * Build Invoice list URL search params for Paid invoices with late penalties.
 * Prefer invoice_month (Month mode) when provided; otherwise payment date From/To.
 */
export function buildPaidInvoicePenaltiesInvoiceListSearchParams({
  monthYm = '',
  paymentDateFrom = '',
  paymentDateTo = '',
} = {}) {
  const params = new URLSearchParams();
  params.set('statuses', 'Paid');
  params.set('has_penalty', '1');

  const month = toMonthYm(monthYm);
  if (month) {
    params.set('invoice_month', month);
    return params;
  }

  const from = toYmd(paymentDateFrom);
  const to = toYmd(paymentDateTo);
  if (from) params.set('payment_date_from', from);
  if (to) params.set('payment_date_to', to);
  return params;
}

export function hasInvoicePenaltyDeepLinkParam(searchParams) {
  const params = searchParams instanceof URLSearchParams
    ? searchParams
    : new URLSearchParams(String(searchParams || ''));
  return parseTruthyQueryFlag(params.get('has_penalty'));
}
