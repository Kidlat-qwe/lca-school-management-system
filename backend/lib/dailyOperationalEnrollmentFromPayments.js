/**
 * Daily operational dashboard — enrollment KPIs from completed invoice payments
 * on payment issue date (paymenttbl.issue_date), bucketed by program_enrollment_status
 * on the linked classstudentstbl row (class + phase from invoice remarks / profile).
 *
 * Aligns payment-date filter with Invoice Sales while using canonical enrollment status
 * instead of invoice-type heuristics (full payment no longer counts as re-enrollment).
 */

const EMPTY_TOTALS = () => ({
  new_enrollees: 0,
  re_enrollment_count: 0,
  rejoin_count: 0,
  dropped_unenrolled_count: 0,
});

/** SQL fragment: class-related payments on the dashboard summary date. */
const CLASS_PAYMENT_FILTER_SQL = `
  (
    i.remarks ILIKE '%CLASS_ID:%'
    OR i.installmentinvoiceprofiles_id IS NOT NULL
    OR i.invoice_description ILIKE '%downpayment%'
    OR i.invoice_description ILIKE '%installment%'
    OR i.invoice_description ILIKE '%phase%'
    OR i.invoice_description ILIKE '%full%payment%'
    OR i.invoice_description ILIKE '%fullpayment%'
    OR i.remarks ~* 'REJOIN_PHASE:\\d+'
    OR i.remarks ~* 'TARGET_PHASE:\\d+'
    OR i.remarks ~* 'PHASE_START:\\d+'
  )
`;

/**
 * @param {Function} queryFn
 * @param {{ branchId?: number|null, summaryDate: string }} options
 */
export async function loadDailyOperationalEnrollmentFromPayments(queryFn, options = {}) {
  const { branchId = null, summaryDate } = options;
  if (!summaryDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(summaryDate))) {
    throw new Error('summaryDate must be YYYY-MM-DD');
  }

  const params = [summaryDate];
  let branchFilterSql = '';
  if (branchId) {
    params.push(branchId);
    branchFilterSql = `AND p.branch_id = $${params.length}`;
  }

  const result = await queryFn(
    `
      WITH day_payments AS (
        SELECT
          p.branch_id,
          p.student_id,
          COALESCE(
            (regexp_match(i.remarks, 'CLASS_ID:(\\d+)', 'i'))[1]::int,
            ip.class_id
          ) AS class_id,
          COALESCE(
            (regexp_match(i.remarks, 'REJOIN_PHASE:(\\d+)', 'i'))[1]::int,
            (regexp_match(i.remarks, 'TARGET_PHASE:(\\d+)', 'i'))[1]::int,
            (regexp_match(i.invoice_description, 'phase\\s*(\\d+)', 'i'))[1]::int,
            CASE
              WHEN i.invoice_description ILIKE '%downpayment%'
                OR COALESCE(i.invoice_chain_root_id, i.invoice_id) = ip.downpayment_invoice_id
              THEN COALESCE(NULLIF(ip.phase_start, 0), 1)
              ELSE NULL
            END
          ) AS phase_number
        FROM paymenttbl p
        INNER JOIN invoicestbl i ON i.invoice_id = p.invoice_id
        LEFT JOIN installmentinvoiceprofilestbl ip
          ON ip.installmentinvoiceprofiles_id = i.installmentinvoiceprofiles_id
        WHERE p.status = 'Completed'
          AND p.issue_date = $1::date
          AND COALESCE(p.approval_status, 'Pending') NOT IN ('Returned', 'Rejected')
          AND ${CLASS_PAYMENT_FILTER_SQL}
          ${branchFilterSql}
      ),
      with_status AS (
        SELECT
          dp.branch_id,
          dp.student_id,
          cs.program_enrollment_status
        FROM day_payments dp
        LEFT JOIN LATERAL (
          SELECT cs.program_enrollment_status
          FROM classstudentstbl cs
          WHERE cs.student_id = dp.student_id
            AND cs.class_id = dp.class_id
            AND (dp.phase_number IS NULL OR cs.phase_number = dp.phase_number)
          ORDER BY
            CASE
              WHEN dp.phase_number IS NOT NULL AND cs.phase_number = dp.phase_number THEN 0
              ELSE 1
            END,
            CASE WHEN cs.removed_at IS NULL THEN 0 ELSE 1 END,
            cs.classstudent_id DESC
          LIMIT 1
        ) cs ON dp.class_id IS NOT NULL
        WHERE cs.program_enrollment_status IS NOT NULL
      )
      SELECT
        branch_id,
        COUNT(DISTINCT student_id) FILTER (WHERE program_enrollment_status = 'new')::bigint AS new_enrollees,
        COUNT(DISTINCT student_id) FILTER (
          WHERE program_enrollment_status IN ('re_enrolled', 'upsell')
        )::bigint AS re_enrollment_count,
        COUNT(DISTINCT student_id) FILTER (WHERE program_enrollment_status = 'rejoin')::bigint AS rejoin_count,
        COUNT(DISTINCT student_id) FILTER (WHERE program_enrollment_status = 'dropped')::bigint AS dropped_unenrolled_count
      FROM with_status
      GROUP BY branch_id
    `,
    params
  );

  const byBranch = (result.rows || []).map((row) => ({
    branch_id: parseInt(row.branch_id, 10),
    new_enrollees: parseInt(row.new_enrollees, 10) || 0,
    re_enrollment_count: parseInt(row.re_enrollment_count, 10) || 0,
    rejoin_count: parseInt(row.rejoin_count, 10) || 0,
    dropped_unenrolled_count: parseInt(row.dropped_unenrolled_count, 10) || 0,
  }));

  const totals = byBranch.reduce(
    (acc, row) => ({
      new_enrollees: acc.new_enrollees + row.new_enrollees,
      re_enrollment_count: acc.re_enrollment_count + row.re_enrollment_count,
      rejoin_count: acc.rejoin_count + row.rejoin_count,
      dropped_unenrolled_count: acc.dropped_unenrolled_count + row.dropped_unenrolled_count,
    }),
    EMPTY_TOTALS()
  );

  const rateMetrics = computeDailyPaymentReEnrollmentRate(totals);

  return {
    by_branch: byBranch,
    totals,
    summary_date: summaryDate,
    source: 'payment_issue_date_program_enrollment_status',
    ...rateMetrics,
  };
}

/**
 * Re-enrollment rate: re_enrolled ÷ (new + re_enrolled + rejoin) among class payments
 * on the payment issue date (dropped excluded from rate denominator).
 */
export function computeDailyPaymentReEnrollmentRate(totals = {}) {
  const retained = Number(totals.re_enrollment_count) || 0;
  const newCount = Number(totals.new_enrollees) || 0;
  const rejoinCount = Number(totals.rejoin_count) || 0;
  const priorCount = newCount + retained + rejoinCount;
  const rate = priorCount > 0 ? Number(((retained / priorCount) * 100).toFixed(2)) : 0;

  return {
    re_enrollment_rate: rate,
    re_enrollment_rate_retained_count: retained,
    re_enrollment_rate_prior_count: priorCount,
  };
}

/**
 * Merge payment-date + program_enrollment_status counts into branch breakdown rows.
 */
export function applyPaymentEnrollmentToBranchBreakdown(branchBreakdown, paymentEnrollment) {
  const byBranchId = new Map(
    (paymentEnrollment?.by_branch || []).map((row) => [row.branch_id, row])
  );

  return (branchBreakdown || []).map((row) => {
    const paymentRow = byBranchId.get(row.branch_id);
    return {
      ...row,
      new_enrollees: paymentRow?.new_enrollees ?? 0,
      re_enrollment_count: paymentRow?.re_enrollment_count ?? 0,
      rejoin_count: paymentRow?.rejoin_count ?? 0,
      dropped_unenrolled_count: paymentRow?.dropped_unenrolled_count ?? 0,
    };
  });
}
