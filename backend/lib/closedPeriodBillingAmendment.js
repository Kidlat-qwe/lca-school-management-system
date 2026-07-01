/**
 * Amend locked EOD submissions after billing corrections (e.g. hard delete + re-enroll).
 * Branch Admin refreshes totals from live payments; Finance re-verifies (Submitted status).
 */
export const AMENDMENT_DRIFT_EPSILON = 0.01;

export const AMENDABLE_SUMMARY_STATUSES = new Set(['Approved', 'Submitted']);

export function amountsDiffer(a, b, epsilon = AMENDMENT_DRIFT_EPSILON) {
  return Math.abs((Number(a) || 0) - (Number(b) || 0)) > epsilon;
}

/**
 * True when stored EOD totals differ from live payment + AR snapshot.
 * @param {{ status?: string, total_amount?: number, payment_count?: number }} summaryRow
 * @param {{ total?: number, paymentCount?: number }} liveTotals
 */
export function eodHasAmendmentDrift(summaryRow, liveTotals) {
  if (!summaryRow || !AMENDABLE_SUMMARY_STATUSES.has(String(summaryRow.status || ''))) {
    return false;
  }
  if (!liveTotals) return false;
  return (
    amountsDiffer(summaryRow.total_amount, liveTotals.total) ||
    parseInt(summaryRow.payment_count || 0, 10) !== parseInt(liveTotals.paymentCount || 0, 10)
  );
}

/**
 * Calendar dates with completed sales but no daily_summary_salestbl row (EOD gap after hard delete).
 * @param {Function|{ query: Function }} db pool.query, getClient(), or the app's `query` helper
 * @param {number} branchId
 * @param {string} todayYmd YYYY-MM-DD (Manila today)
 * @returns {Promise<string[]>}
 */
export async function getEodBackfillDates(db, branchId, todayYmd) {
  if (!branchId || !todayYmd) return [];

  const runQuery =
    typeof db === 'function' ? db : (text, params) => db.query(text, params);

  const result = await runQuery(
    `WITH sales_dates AS (
       SELECT DISTINCT p.issue_date::date AS d
       FROM paymenttbl p
       WHERE p.branch_id = $1
         AND p.issue_date <= $2::date
         AND p.status = 'Completed'
         AND COALESCE(p.approval_status, 'Pending') <> 'Rejected'
       UNION
       SELECT DISTINCT ar.issue_date::date AS d
       FROM acknowledgement_receiptstbl ar
       WHERE ar.branch_id = $1
         AND ar.issue_date <= $2::date
         AND COALESCE(ar.status, 'Submitted') NOT IN ('Rejected', 'Cancelled', 'Applied')
         AND ar.payment_id IS NULL
         AND ar.invoice_id IS NULL
     )
     SELECT TO_CHAR(s.d, 'YYYY-MM-DD') AS summary_date
     FROM sales_dates s
     WHERE NOT EXISTS (
       SELECT 1 FROM daily_summary_salestbl d
       WHERE d.branch_id = $1 AND d.summary_date = s.d
     )
     ORDER BY s.d ASC`,
    [branchId, todayYmd]
  );

  return (result.rows || [])
    .map((r) => String(r.summary_date || '').slice(0, 10))
    .filter(Boolean);
}

/**
 * Branch Admin may amend only their branch's submission (original submitter unless Superadmin).
 * @param {object} req Express request with req.user
 * @param {{ branch_id?: number, submitted_by?: number }} summaryRow
 * @param {{ idField?: string }} [options]
 */
export function assertAdminMayAmendSummary(req, summaryRow, { idField = 'submitted_by' } = {}) {
  if (req.user?.userType === 'Superadmin') {
    return { ok: true };
  }
  if (req.user?.userType !== 'Admin') {
    return { ok: false, status: 403, message: 'Only branch Admin can amend closed submissions.' };
  }
  if (
    req.user?.branchId &&
    summaryRow.branch_id != null &&
    Number(req.user.branchId) !== Number(summaryRow.branch_id)
  ) {
    return { ok: false, status: 403, message: 'You can only amend submissions for your branch.' };
  }
  const submitterId = summaryRow[idField];
  const userId = req.user?.userId;
  if (submitterId != null && userId != null && Number(submitterId) !== Number(userId)) {
    return {
      ok: false,
      status: 403,
      message: 'Only the Admin who originally submitted this record can amend it.',
    };
  }
  return { ok: true };
}
