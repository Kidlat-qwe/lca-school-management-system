/**
 * Shared Acknowledgement Receipt sales totals for Financial Dashboard,
 * Monthly/Daily Operational Dashboard, and AR list header sums.
 *
 * Rules (Superadmin / Admin "All" bucket):
 * - Status: Verified (Applied) + Unverified + Rejected via buildArAdminStatusFilterSql
 * - Exclude Returned-for-correction queue (notes marker + status)
 * - When paired_ack_receipt_id exists: hide leader rows; sum leader + Phase 1 on follower row
 */

import {
  ackReceiptHasPairedAckReceiptIdColumn,
  AR_LIST_EXCLUDE_PAIRED_LEADER_SQL,
  AR_LIST_LINE_AMOUNT_SUM_SQL,
} from './ackReceiptPairedColumn.js';
import {
  AR_LIST_STATUS_FILTER,
  buildArAdminStatusFilterSql,
} from '../utils/acknowledgementReceiptStatus.js';

export async function resolveArSalesLineAggregateFragments(runQuery) {
  const hidePairedLeaders = await ackReceiptHasPairedAckReceiptIdColumn(runQuery);
  return {
    lineSumExpr: hidePairedLeaders
      ? AR_LIST_LINE_AMOUNT_SUM_SQL
      : 'COALESCE(ar.payment_amount, 0) + COALESCE(ar.tip_amount, 0)',
    pairedLeaderExcludeSql: hidePairedLeaders ? AR_LIST_EXCLUDE_PAIRED_LEADER_SQL : '',
  };
}

/**
 * @param {Function} runQuery
 * @param {object} [options]
 * @param {number|null} [options.branchId]
 * @param {string|null} [options.dateFrom] - YYYY-MM-DD inclusive lower bound
 * @param {string|null} [options.dateTo] - inclusive upper bound unless dateEndExclusive
 * @param {boolean} [options.dateEndExclusive] - when true, dateTo is exclusive (monthly ops half-open month)
 * @param {string} [options.statusFilterToken] - AR_LIST_STATUS_FILTER token (default All)
 */
export async function loadArSalesAggregateTotals(runQuery, options = {}) {
  const {
    branchId = null,
    dateFrom = null,
    dateTo = null,
    dateEndExclusive = false,
    statusFilterToken = AR_LIST_STATUS_FILTER.ALL,
  } = options;

  const { lineSumExpr, pairedLeaderExcludeSql } = await resolveArSalesLineAggregateFragments(runQuery);
  const params = [];
  const statusClause = buildArAdminStatusFilterSql('ar', statusFilterToken, 1);
  params.push(...statusClause.params);

  let paramIndex = params.length + 1;
  let scopeSql = `${statusClause.sql}${pairedLeaderExcludeSql}`;

  if (branchId != null) {
    scopeSql += ` AND ar.branch_id = $${paramIndex}`;
    params.push(branchId);
    paramIndex += 1;
  }
  if (dateFrom) {
    scopeSql += ` AND ar.issue_date >= $${paramIndex}::date`;
    params.push(dateFrom);
    paramIndex += 1;
  }
  if (dateTo) {
    scopeSql += dateEndExclusive
      ? ` AND ar.issue_date < $${paramIndex}::date`
      : ` AND ar.issue_date <= $${paramIndex}::date`;
    params.push(dateTo);
    paramIndex += 1;
  }

  const res = await runQuery(
    `
      SELECT
        COUNT(*)::bigint AS count,
        COALESCE(SUM(${lineSumExpr}), 0) AS amount
      FROM acknowledgement_receiptstbl ar
      WHERE 1=1
        ${scopeSql}
    `,
    params
  );

  const row = res.rows[0] || {};
  return {
    count: parseInt(row.count, 10) || 0,
    amount: parseFloat(row.amount) || 0,
    lineSumExpr,
    pairedLeaderExcludeSql,
  };
}

/**
 * Build ar_sales CTE fragment for branch-grouped operational dashboards.
 * @param {number} startIdx - $n for inclusive month start (issue_date >=)
 * @param {number} endIdx - $n for exclusive month end (issue_date <)
 * @param {object} fragments - from resolveArSalesLineAggregateFragments + statusFilterSql
 */
export function buildArSalesBranchCteSql(startIdx, endIdx, fragments) {
  return `
            ar_sales AS (
              SELECT
                ar.branch_id,
                COUNT(*)::bigint AS ar_sales_count,
                COALESCE(SUM(${fragments.lineSumExpr}), 0) AS ar_sales_amount
              FROM acknowledgement_receiptstbl ar
              WHERE ar.issue_date >= $${startIdx}::date
                AND ar.issue_date < $${endIdx}::date
                ${fragments.statusFilterSql}
                ${fragments.pairedLeaderExcludeSql}
              GROUP BY ar.branch_id
            ),`;
}
