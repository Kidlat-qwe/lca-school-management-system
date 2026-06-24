/**
 * Financial dashboard payment / AR verification counts aligned with drill-down grids:
 * - Payment Logs / Invoice / Monthly Operational (completed invoice payments by payment date)
 * - Acknowledgement Receipts list (GET /acknowledgement-receipts)
 */

import {
  computePaymentDateNetTotals,
  formatPaymentDateNetTotalsSummary,
} from './paymentDateNetTotals.js';
import {
  AR_LIST_STATUS_FILTER,
} from '../utils/acknowledgementReceiptStatus.js';
import { loadArSalesAggregateTotals } from './arSalesAggregate.js';

/** Inclusive calendar range for YYYY-MM (matches Payment Logs month mode / issueDateRangeFromManilaMonth). */
export function parseManilaMonthInclusiveRange(monthKey) {
  const key = String(monthKey || '').trim();
  if (!/^\d{4}-\d{2}$/.test(key)) return null;
  const [yearStr, monthStr] = key.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  const from = `${key}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${key}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

const buildBranchDateSql = (branchId, dateFrom, dateTo, tableAlias, params) => {
  let sql = '';
  if (branchId != null) {
    params.push(branchId);
    sql += ` AND ${tableAlias}.branch_id = $${params.length}`;
  }
  if (dateFrom) {
    params.push(dateFrom);
    sql += ` AND ${tableAlias}.issue_date >= $${params.length}::date`;
  }
  if (dateTo) {
    params.push(dateTo);
    sql += ` AND ${tableAlias}.issue_date <= $${params.length}::date`;
  }
  return sql;
};

const lineAmount = (row, paymentField = 'line_amount') =>
  parseFloat(row?.[paymentField]) || 0;

/**
 * Payment verification totals — same completed invoice payment lines as:
 * - Invoice list payment-date summary (computeInvoiceFilterSummary)
 * - Monthly Operational Dashboard invoice sales / total payments (paymenttbl.issue_date)
 * Excludes Returned/Rejected approval. Unapplied package AR is tracked on AR verification cards only.
 */
export async function loadFinancialDashboardPaymentVerification(runQuery, options = {}) {
  const { branchId = null, dateFrom = null, dateTo = null } = options;

  const payParams = [];
  const payScopeSql = buildBranchDateSql(branchId, dateFrom, dateTo, 'p', payParams);

  const payRes = await runQuery(
    `
      SELECT
        p.approval_status,
        COALESCE(p.payable_amount, 0) + COALESCE(p.tip_amount, 0) AS line_amount
      FROM paymenttbl p
      WHERE p.status = 'Completed'
        AND COALESCE(p.approval_status, 'Pending') NOT IN ('Returned', 'Rejected')
        ${payScopeSql}
    `,
    payParams
  );

  let verified_count = 0;
  let verified_amount = 0;
  let unverified_count = 0;
  let unverified_amount = 0;

  const addRow = (isVerified, amount) => {
    if (isVerified) {
      verified_count += 1;
      verified_amount += amount;
    } else {
      unverified_count += 1;
      unverified_amount += amount;
    }
  };

  for (const row of payRes.rows || []) {
    const isApproved = String(row.approval_status || '').trim() === 'Approved';
    addRow(isApproved, lineAmount(row));
  }

  const netTotals = await computePaymentDateNetTotals(runQuery, {
    branchId,
    dateFrom,
    dateTo,
    dateEndExclusive: false,
  });
  const netSummary = formatPaymentDateNetTotalsSummary(netTotals);

  return {
    verified_count,
    verified_amount,
    unverified_count,
    unverified_amount,
    net_count: netSummary.filterTotalPaymentLineCount,
    net_amount: netSummary.filterTotalLineAmount,
    returned_deduction_count: netSummary.returnedDeductionCount,
    returned_deduction_amount: netSummary.returnedDeductionAmount,
    rejected_deduction_count: netSummary.rejectedDeductionCount,
    rejected_deduction_amount: netSummary.rejectedDeductionAmount,
  };
}

/**
 * AR verification totals — Superadmin / Admin buckets aligned with Acknowledgement Receipts:
 * All (Verified+Applied + Unverified + Rejected), Verified (Applied), Unverified, Rejected.
 * Month scope on ar.issue_date.
 */
export async function loadFinancialDashboardArVerification(runQuery, options = {}) {
  const { branchId = null, dateFrom = null, dateTo = null } = options;

  const countForStatusFilter = (statusFilterToken) =>
    loadArSalesAggregateTotals(runQuery, {
      branchId,
      dateFrom,
      dateTo,
      dateEndExclusive: false,
      statusFilterToken,
    });

  const [allBucket, verifiedApplied, unverified, rejected] = await Promise.all([
    countForStatusFilter(AR_LIST_STATUS_FILTER.ALL),
    countForStatusFilter(AR_LIST_STATUS_FILTER.VERIFIED_APPLIED),
    countForStatusFilter(AR_LIST_STATUS_FILTER.UNVERIFIED),
    countForStatusFilter(AR_LIST_STATUS_FILTER.REJECTED),
  ]);

  return {
    all_count: allBucket.count,
    all_amount: allBucket.amount,
    verified_count: verifiedApplied.count,
    verified_amount: verifiedApplied.amount,
    unverified_count: unverified.count,
    unverified_amount: unverified.amount,
    rejected_count: rejected.count,
    rejected_amount: rejected.amount,
  };
}
