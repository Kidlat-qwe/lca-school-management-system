/**
 * Paginate GET /payments until all rows are loaded (for Excel export).
 */
export async function fetchAllPaymentsForExport(apiRequest, { branchId, paymentDateFrom, paymentDateTo }) {
  const limit = 100;
  let page = 1;
  const all = [];
  let totalPages = 1;
  const from = paymentDateFrom ? String(paymentDateFrom).trim().slice(0, 10) : '';
  const to = paymentDateTo ? String(paymentDateTo).trim().slice(0, 10) : '';

  do {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    params.set('page', String(page));
    params.set('status', 'Completed');
    if (branchId != null && branchId !== '') {
      params.set('branch_id', String(branchId));
    }
    if (from) params.set('payment_date_from', from);
    if (to) params.set('payment_date_to', to);
    const res = await apiRequest(`/payments?${params.toString()}`);
    all.push(...(res.data || []));
    totalPages = res.pagination?.totalPages || 1;
    page += 1;
  } while (page <= totalPages);

  return all;
}
