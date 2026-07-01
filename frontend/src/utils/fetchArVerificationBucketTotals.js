import { apiRequest } from '../config/api';
import { AR_STATUS_FILTER } from './acknowledgementReceiptStatus';

/**
 * Match GET /acknowledgement-receipts main-tab exclude_status for admin / finance buckets.
 */
export function appendArListStatusExcludeParams(params, statusFilter) {
  const status = statusFilter || AR_STATUS_FILTER.ALL;
  params.set('exclude_status', 'Returned');
  if (
    status === AR_STATUS_FILTER.UNVERIFIED ||
    status === AR_STATUS_FILTER.VERIFIED_APPLIED
  ) {
    params.set('exclude_status', 'Returned,Rejected');
  }
}

/**
 * AR verification bucket totals aligned with Financial Dashboard / AR list filters.
 * @param {{ dateFrom?: string, dateTo?: string, branchId?: number|string|null }} options
 */
export async function fetchArVerificationBucketTotals(options = {}) {
  const { dateFrom = '', dateTo = '', branchId = null } = options;

  const fetchBucket = async (status) => {
    const params = new URLSearchParams({ page: '1', limit: '1', status });
    const from = String(dateFrom || '').trim();
    const to = String(dateTo || '').trim();
    if (from) params.set('payment_date_from', from);
    if (to) params.set('payment_date_to', to);
    if (branchId != null && String(branchId).trim() !== '') {
      params.set('branch_id', String(branchId));
    }
    appendArListStatusExcludeParams(params, status);
    const res = await apiRequest(`/acknowledgement-receipts?${params.toString()}`);
    return {
      count: Number(res.pagination?.total) || 0,
      amount: Number(res.filterTotalLineAmount) || 0,
    };
  };

  const [all, verified, unverified, rejected] = await Promise.all([
    fetchBucket(AR_STATUS_FILTER.ALL),
    fetchBucket(AR_STATUS_FILTER.VERIFIED_APPLIED),
    fetchBucket(AR_STATUS_FILTER.UNVERIFIED),
    fetchBucket(AR_STATUS_FILTER.REJECTED),
  ]);

  return { all, verified, unverified, rejected };
}
