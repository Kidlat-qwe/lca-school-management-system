import { apiRequest } from '../config/api';

/**
 * Payment Logs list totals for the same scope as the main "Payment logs" tab
 * (Completed, excluding Returned/Rejected approval).
 *
 * @param {{ branchId?: string|number, paymentDateFrom?: string, paymentDateTo?: string }} args
 * @returns {Promise<{ lineCount: number, lineTotal: number }>}
 */
export async function fetchPaymentLogFilterSummary({
  branchId = '',
  paymentDateFrom = '',
  paymentDateTo = '',
} = {}) {
  const params = new URLSearchParams({
    limit: '1',
    page: '1',
    status: 'Completed',
    exclude_approval_status: 'Returned,Rejected',
  });
  if (branchId) params.set('branch_id', String(branchId));
  if (paymentDateFrom) params.set('payment_date_from', paymentDateFrom);
  if (paymentDateTo) params.set('payment_date_to', paymentDateTo);

  const response = await apiRequest(`/payments?${params.toString()}`);
  return {
    lineCount: Number(response.pagination?.total ?? 0),
    lineTotal: Number(response.filterTotalLineAmount ?? 0),
  };
}
