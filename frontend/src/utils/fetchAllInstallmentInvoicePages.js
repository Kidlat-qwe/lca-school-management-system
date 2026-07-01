/**
 * Loads all installment schedule rows (`installmentinvoicestbl`) from GET /installment-invoices/invoices.
 * The API paginates; loading only page 1 hid students whose rows sorted after the first batch.
 *
 * @param {Function} apiRequest - Same `apiRequest` used elsewhere (from config/api).
 * @param {{ extraSearchParams?: Record<string, string | number> }} options - Optional query params (e.g. branch_id if API supports it).
 */
export async function fetchAllInstallmentInvoicePages(apiRequest, options = {}) {
  const { extraSearchParams } = options;
  const pageSize = 100;
  let page = 1;
  const all = [];

  while (true) {
    const params = new URLSearchParams();
    params.set('limit', String(pageSize));
    params.set('page', String(page));
    if (extraSearchParams && typeof extraSearchParams === 'object') {
      Object.entries(extraSearchParams).forEach(([k, v]) => {
        if (v != null && v !== '') params.set(k, String(v));
      });
    }

    const res = await apiRequest(`/installment-invoices/invoices?${params.toString()}`);
    const batch = Array.isArray(res.data) ? res.data : [];
    const total = res.pagination?.total;

    all.push(...batch);

    if (batch.length === 0) break;
    if (typeof total === 'number' && all.length >= total) break;
    if (batch.length < pageSize) break;

    page += 1;
    if (page > 1000) break;
  }

  return all;
}
