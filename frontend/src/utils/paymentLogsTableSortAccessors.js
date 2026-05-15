import {
  getPaymentLogTableAmountColumn,
  getPaymentLogTableTotalAmountColumn,
} from './paymentLogTableAmounts';

/**
 * String key aligned with Invoice column ordering: real invoices first (by numeric id), then AR/other.
 * @param {Record<string, unknown>} p
 */
export function paymentLogsInvoiceSortKey(p) {
  if (p?.invoice_id != null && String(p.invoice_id).trim() !== '') {
    const n = Number(p.invoice_id);
    if (!Number.isNaN(n)) return `0:${String(n).padStart(12, '0')}`;
  }
  const ar = (p?.invoice_ar_number || '').trim().toLowerCase();
  if (ar) return `1:${ar}`;
  return `2:${String(p?.payment_id ?? '').toLowerCase()}`;
}

/**
 * Shared column sort map for superadmin / admin / finance / superfinance payment log grids.
 *
 * @param {object} options
 * @param {(payment: object) => string} options.branchAccessor
 * @param {(payment: object) => string} options.issuedByAccessor
 * @param {'main'|'return'|'rejected'} [options.logTab='main']
 */
export function buildPaymentLogsTableSortAccessors({ branchAccessor, issuedByAccessor, logTab = 'main' }) {
  const returnedByAccessor =
    logTab === 'rejected'
      ? (p) => String(p?.rejected_by_name ?? '').trim()
      : logTab === 'return'
        ? (p) => String(p?.returned_by_name ?? '').trim()
        : () => '';

  return {
    invoice: { accessor: paymentLogsInvoiceSortKey, type: 'string' },
    branch: { accessor: branchAccessor, type: 'string' },
    issue_date: { accessor: 'issue_date', type: 'date' },
    payment_date: { accessor: 'payment_date', type: 'date' },
    student_name: { accessor: (p) => String(p?.student_name ?? '').trim(), type: 'string' },
    package_item: { accessor: (p) => String(p?.invoice_description ?? '').trim(), type: 'string' },
    level_tag: { accessor: (p) => String(p?.student_level_tag ?? '').trim(), type: 'string' },
    payment_method: { accessor: (p) => String(p?.payment_method ?? '').trim(), type: 'string' },
    amount: { accessor: (p) => getPaymentLogTableAmountColumn(p), type: 'number' },
    total_amount: { accessor: (p) => getPaymentLogTableTotalAmountColumn(p), type: 'number' },
    status: { accessor: (p) => p?.approval_status || p?.status || 'Pending', type: 'string' },
    returned_by: { accessor: returnedByAccessor, type: 'string' },
    reference: { accessor: (p) => String(p?.reference_number ?? '').trim(), type: 'string' },
    ack_receipt: { accessor: (p) => String(p?.invoice_ar_number ?? '').trim(), type: 'string' },
    issued_by: { accessor: issuedByAccessor, type: 'string' },
  };
}

/** Student payment history table (no branch / issued-by columns). */
export function buildStudentPaymentLogsTableSortAccessors() {
  return {
    invoice: { accessor: paymentLogsInvoiceSortKey, type: 'string' },
    description: { accessor: (p) => String(p?.invoice_description ?? '').trim(), type: 'string' },
    payment_method: { accessor: (p) => String(p?.payment_method ?? '').trim(), type: 'string' },
    payment_type: { accessor: (p) => String(p?.payment_type ?? '').trim(), type: 'string' },
    amount: { accessor: (p) => parseFloat(p?.payable_amount) || 0, type: 'number' },
    status: { accessor: 'status', type: 'string' },
    issue_date: { accessor: 'issue_date', type: 'date' },
    ack_receipt: { accessor: (p) => String(p?.invoice_ar_number ?? '').trim(), type: 'string' },
    reference: { accessor: (p) => String(p?.reference_number ?? '').trim(), type: 'string' },
  };
}
