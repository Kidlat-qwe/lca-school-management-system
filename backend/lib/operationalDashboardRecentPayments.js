/**
 * Recent completed invoice payments for daily / monthly operational dashboards.
 * Scope matches invoice sales: paymenttbl.issue_date, status Completed,
 * approval not Returned/Rejected, invoice_id required.
 */

import {
  PAYMENT_LOG_INVOICE_CONTEXT_JOIN,
  PAYMENT_LOG_INVOICE_CONTEXT_SELECT,
  PAYMENT_LOG_INVOICE_STATUS_SELECT,
} from '../utils/paymentLogInvoiceContextSql.js';

/** Max rows returned for the scrollable log (UI shows 3 rows at a time). */
const DEFAULT_LIMIT = 50;

const mapPaymentRow = (row) => ({
  payment_id: parseInt(row.payment_id, 10),
  invoice_id: row.invoice_id != null ? parseInt(row.invoice_id, 10) : null,
  invoice_label: row.invoice_id != null ? `INV-${row.invoice_id}` : null,
  student_name: row.student_name || null,
  issue_date: row.issue_date ? String(row.issue_date).slice(0, 10) : null,
  payment_method: row.payment_method || null,
  payment_type: row.payment_type || null,
  invoice_description: row.invoice_description || null,
  invoice_status: row.invoice_status || null,
  invoice_remarks: row.invoice_remarks || null,
  parent_invoice_id:
    row.parent_invoice_id != null ? parseInt(row.parent_invoice_id, 10) : null,
  installmentinvoiceprofiles_id:
    row.installmentinvoiceprofiles_id != null
      ? parseInt(row.installmentinvoiceprofiles_id, 10)
      : null,
  installment_profile_description: row.installment_profile_description || null,
  installment_downpayment_invoice_id:
    row.installment_downpayment_invoice_id != null
      ? parseInt(row.installment_downpayment_invoice_id, 10)
      : null,
  amount:
    (parseFloat(row.payable_amount) || 0) + (parseFloat(row.tip_amount) || 0),
  approval_status: row.approval_status || null,
});

/**
 * @param {Function} queryFn
 * @param {{ branchId?: number|null, summaryDate?: string, monthStart?: string, monthEndExclusive?: string, limit?: number }} options
 */
export async function loadRecentInvoicePaymentsForOperationalDashboard(queryFn, options = {}) {
  const { branchId = null, summaryDate, monthStart, monthEndExclusive, limit = DEFAULT_LIMIT } =
    options;

  const params = [];
  let dateFilterSql = '';

  if (summaryDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(summaryDate))) {
      throw new Error('summaryDate must be YYYY-MM-DD');
    }
    params.push(summaryDate);
    dateFilterSql = `p.issue_date = $${params.length}::date`;
  } else if (monthStart && monthEndExclusive) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(String(monthStart)) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(monthEndExclusive))
    ) {
      throw new Error('monthStart and monthEndExclusive must be YYYY-MM-DD');
    }
    params.push(monthStart, monthEndExclusive);
    dateFilterSql = `p.issue_date >= $1::date AND p.issue_date < $2::date`;
  } else {
    throw new Error('Provide summaryDate or monthStart + monthEndExclusive');
  }

  let branchFilterSql = '';
  if (branchId) {
    params.push(branchId);
    branchFilterSql = `AND p.branch_id = $${params.length}`;
  }

  params.push(limit);

  const result = await queryFn(
    `
      SELECT
        p.payment_id,
        p.invoice_id,
        p.issue_date::text AS issue_date,
        p.payment_method,
        p.payment_type,
        p.payable_amount,
        p.tip_amount,
        p.approval_status,
        COALESCE(u.full_name, u.email, 'Student') AS student_name,
        i.invoice_description,
        ${PAYMENT_LOG_INVOICE_STATUS_SELECT}${PAYMENT_LOG_INVOICE_CONTEXT_SELECT}
      FROM paymenttbl p
      INNER JOIN invoicestbl i ON i.invoice_id = p.invoice_id${PAYMENT_LOG_INVOICE_CONTEXT_JOIN}
      LEFT JOIN userstbl u ON p.student_id = u.user_id
      WHERE p.status = 'Completed'
        AND ${dateFilterSql}
        AND COALESCE(p.approval_status, 'Pending') NOT IN ('Returned', 'Rejected')
        ${branchFilterSql}
      ORDER BY p.issue_date DESC, p.payment_id DESC
      LIMIT $${params.length}
    `,
    params
  );

  return (result.rows || []).map(mapPaymentRow);
}
