import { paymentAndIssueDateFilterUtil as invoiceDateFilterUtil } from './dateFilterModes';

/**
 * Query params for GET /invoices (server-side list, same pattern as Payment Logs).
 */
export function buildInvoiceListRequestParams({
  page = 1,
  limit = 10,
  branchId = '',
  statuses = [],
  dateFilterMode,
  month = '',
  paymentFrom = '',
  paymentTo = '',
  issueFrom = '',
  issueTo = '',
  search = '',
  studentSearch = '',
} = {}) {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  if (branchId) params.set('branch_id', String(branchId));
  if (Array.isArray(statuses) && statuses.length > 0) {
    params.set('statuses', statuses.join(','));
  }
  const trimmedSearch = String(search || '').trim();
  const trimmedStudentSearch = String(studentSearch || '').trim();
  if (trimmedSearch) params.set('search', trimmedSearch);
  if (trimmedStudentSearch) params.set('student_search', trimmedStudentSearch);
  const dateParams = invoiceDateFilterUtil.buildParams({
    mode: dateFilterMode,
    month,
    paymentFrom,
    paymentTo,
    issueFrom,
    issueTo,
  });
  Object.entries(dateParams).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params;
}
