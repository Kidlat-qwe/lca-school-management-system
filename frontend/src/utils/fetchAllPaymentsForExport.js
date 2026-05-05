/**
 * Fetches all payment pages for invoice "payment date" Excel export.
 * Matches Financial Dashboard **total revenue**: `paymenttbl` rows with `status = 'Completed'`
 * in the Manila payment-date window (same date predicate as `/payments/financial-dashboard-metrics`).
 */

/** Pass as `align` from the matching invoice screen (all use the same payment query shape). */
export const PaymentExportAlignMode = {
  SUPERADMIN: 'superadmin',
  FINANCE: 'finance',
  SUPERFINANCE: 'superfinance',
  ADMIN: 'admin',
};

/**
 * @param {number} page
 * @param {number} limit
 * @param {{ branchId?: string|number|null, paymentDateFrom?: string, paymentDateTo?: string, paymentMethod?: string, align?: string }} opts
 * @returns {{ endpoint: string, searchParams: URLSearchParams }}
 */
export function buildInvoicePaymentExportFetchRequest(page, limit, opts) {
  const {
    branchId,
    paymentDateFrom = '',
    paymentDateTo = '',
    paymentMethod = '',
    align: _align = PaymentExportAlignMode.SUPERADMIN,
  } = opts;

  const from = paymentDateFrom ? String(paymentDateFrom).trim().slice(0, 10) : '';
  const to = paymentDateTo ? String(paymentDateTo).trim().slice(0, 10) : '';

  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('page', String(page));
  params.set('status', 'Completed');

  if (branchId != null && String(branchId).trim() !== '') {
    params.set('branch_id', String(branchId));
  }
  if (from) params.set('payment_date_from', from);
  if (to) params.set('payment_date_to', to);
  if (paymentMethod) params.set('payment_method', String(paymentMethod));

  return { endpoint: '/payments', searchParams: params };
}

/**
 * Paginate until all rows are loaded (backend limit max 100 per page).
 *
 * @param {(path: string) => Promise<any>} apiRequest
 * @param {{ branchId?: string|number|null, paymentDateFrom?: string, paymentDateTo?: string, paymentMethod?: string, align?: string }} options
 */
export async function fetchAllPaymentsForExport(apiRequest, options) {
  const {
    branchId,
    paymentDateFrom,
    paymentDateTo,
    paymentMethod,
    align = PaymentExportAlignMode.SUPERADMIN,
  } = options;

  const limit = 100;
  let page = 1;
  const all = [];
  let totalPages = 1;

  do {
    const { endpoint, searchParams } = buildInvoicePaymentExportFetchRequest(page, limit, {
      branchId,
      paymentDateFrom,
      paymentDateTo,
      paymentMethod,
      align,
    });
    const res = await apiRequest(`${endpoint}?${searchParams.toString()}`);
    all.push(...(res.data || []));
    totalPages = Number(res.pagination?.totalPages || 1);
    page += 1;
  } while (page <= totalPages);

  return all;
}
