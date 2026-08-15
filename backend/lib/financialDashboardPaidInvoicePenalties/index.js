/**
 * Financial dashboard: Paid invoices that still carry late-penalty line amounts.
 *
 * Scope matches Payment Logs / Total Payments — completed payments by payment
 * business date (`paymenttbl.issue_date`), excluding Returned/Rejected approval.
 * Each Paid invoice with SUM(penalty_amount) > 0 is counted once; penalty ₱ is
 * the invoice line total (not multiplied by payment rows).
 */

export async function loadFinancialDashboardPaidInvoicePenalties(runQuery, options = {}) {
  const { branchId = null, dateFrom = null, dateTo = null } = options;
  const params = [];
  let paymentScopeSql = '';
  let invoiceBranchSql = '';

  if (branchId != null) {
    params.push(branchId);
    invoiceBranchSql += ` AND i.branch_id = $${params.length}`;
    paymentScopeSql += ` AND p.branch_id = $${params.length}`;
  }
  if (dateFrom) {
    params.push(dateFrom);
    paymentScopeSql += ` AND p.issue_date >= $${params.length}::date`;
  }
  if (dateTo) {
    params.push(dateTo);
    paymentScopeSql += ` AND p.issue_date <= $${params.length}::date`;
  }

  const result = await runQuery(
    `
      WITH paid_penalty_invoices AS (
        SELECT
          i.invoice_id,
          (
            SELECT COALESCE(SUM(ii.penalty_amount), 0)
            FROM invoiceitemstbl ii
            WHERE ii.invoice_id = i.invoice_id
          )::numeric AS total_penalty
        FROM invoicestbl i
        WHERE i.status = 'Paid'
          ${invoiceBranchSql}
          AND EXISTS (
            SELECT 1
            FROM invoiceitemstbl ii
            WHERE ii.invoice_id = i.invoice_id
              AND COALESCE(ii.penalty_amount, 0) > 0
          )
          AND EXISTS (
            SELECT 1
            FROM paymenttbl p
            WHERE p.invoice_id = i.invoice_id
              AND p.status = 'Completed'
              AND COALESCE(p.approval_status, 'Pending') NOT IN ('Returned', 'Rejected')
              ${paymentScopeSql}
          )
      )
      SELECT
        COUNT(*)::int AS invoice_count,
        COALESCE(SUM(total_penalty), 0)::numeric AS penalty_amount
      FROM paid_penalty_invoices
    `,
    params
  );

  const row = result.rows?.[0] || {};
  return {
    invoice_count: parseInt(row.invoice_count, 10) || 0,
    penalty_amount: parseFloat(row.penalty_amount) || 0,
  };
}
