import { query } from '../config/database.js';

const RESERVED_DEPOSIT_STATUSES = ['Submitted', 'Approved'];

const mapSnapshotGapRow = (row) => ({
  payment_id: row.payment_id,
  invoice_id: row.invoice_id,
  student_name: row.student_name || null,
  student_email: row.student_email || null,
  issue_date: row.issue_date || null,
  payment_method: row.payment_method || 'Cash',
  status: row.status || null,
  reference_number: row.reference_number || null,
  payable_amount: Number(row.payable_amount) || 0,
  tip_amount: Number(row.tip_amount) || 0,
  line_amount: Number(row.line_amount) || 0,
  deposit_summary_id: row.deposit_summary_id,
  deposit_summary_status: row.deposit_summary_status,
  deposit_summary_start_date: row.deposit_summary_start_date,
  deposit_summary_end_date: row.deposit_summary_end_date,
  gap_type: row.gap_type,
  removed_from_live_data: row.gap_type === 'removed_snapshot',
});

/**
 * Cash lines stored on a Submitted/Approved deposit snapshot whose payment_id
 * no longer exists in paymenttbl (e.g. after hard-delete student script).
 * Scoped to a single payment date for branch-admin recovery review.
 *
 * @param {{ branchId: number, paymentDate: string }} args
 * @returns {Promise<object[]>}
 */
export const getRemovedCashDepositSnapshotPayments = async ({ branchId, paymentDate }) => {
  const result = await query(
    `SELECT DISTINCT ON ((deposited.payment_row->>'payment_id')::int)
            (deposited.payment_row->>'payment_id')::int AS payment_id,
            NULLIF(deposited.payment_row->>'invoice_id', '')::int AS invoice_id,
            deposited.payment_row->>'student_name' AS student_name,
            deposited.payment_row->>'student_email' AS student_email,
            COALESCE(
              NULLIF(TRIM(deposited.payment_row->>'issue_date'), ''),
              NULLIF(TRIM(deposited.payment_row->>'payment_date'), '')
            ) AS issue_date,
            deposited.payment_row->>'payment_method' AS payment_method,
            deposited.payment_row->>'status' AS status,
            deposited.payment_row->>'reference_number' AS reference_number,
            COALESCE((deposited.payment_row->>'payable_amount')::numeric, 0) AS payable_amount,
            COALESCE((deposited.payment_row->>'tip_amount')::numeric, 0) AS tip_amount,
            c.cash_deposit_summary_id AS deposit_summary_id,
            c.status AS deposit_summary_status,
            TO_CHAR(c.start_date, 'YYYY-MM-DD') AS deposit_summary_start_date,
            TO_CHAR(c.end_date, 'YYYY-MM-DD') AS deposit_summary_end_date
     FROM cash_deposit_summarytbl c
     CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.cash_payment_snapshot, '[]'::jsonb)) deposited(payment_row)
     WHERE c.branch_id = $1
       AND c.status = ANY($3::text[])
       AND $2::date BETWEEN c.start_date::date AND c.end_date::date
       AND deposited.payment_row ? 'payment_id'
       AND (deposited.payment_row->>'payment_id') ~ '^[0-9]+$'
       AND COALESCE(
             NULLIF(TRIM(deposited.payment_row->>'issue_date'), ''),
             NULLIF(TRIM(deposited.payment_row->>'payment_date'), '')
           )::date = $2::date
       AND NOT EXISTS (
         SELECT 1
         FROM paymenttbl p
         WHERE p.payment_id = (deposited.payment_row->>'payment_id')::int
       )
     ORDER BY (deposited.payment_row->>'payment_id')::int,
              c.submitted_at DESC NULLS LAST,
              c.cash_deposit_summary_id DESC`,
    [branchId, paymentDate, RESERVED_DEPOSIT_STATUSES]
  );

  return (result.rows || []).map((row) => ({
    ...row,
    payment_id: row.payment_id,
    invoice_id: row.invoice_id,
    payable_amount: Number(row.payable_amount) || 0,
    tip_amount: Number(row.tip_amount) || 0,
    removed_from_live_data: true,
  }));
};

/**
 * Students / cash lines from prior Submitted/Approved deposits that are not
 * reflected in the branch admin's current Deposit Cash modal range:
 * - snapshot ghosts (payment deleted after verify)
 * - live completed cash outside the current From–To window and not yet deposited
 *
 * @param {{ branchId: number, currentStartDate: string, currentEndDate: string }} args
 */
export const getCashDepositRecoveryGaps = async ({
  branchId,
  currentStartDate,
  currentEndDate,
}) => {
  const removedRes = await query(
    `SELECT DISTINCT ON (c.cash_deposit_summary_id, (deposited.payment_row->>'payment_id')::int)
            c.cash_deposit_summary_id AS deposit_summary_id,
            c.status AS deposit_summary_status,
            TO_CHAR(c.start_date, 'YYYY-MM-DD') AS deposit_summary_start_date,
            TO_CHAR(c.end_date, 'YYYY-MM-DD') AS deposit_summary_end_date,
            (deposited.payment_row->>'payment_id')::int AS payment_id,
            NULLIF(deposited.payment_row->>'invoice_id', '')::int AS invoice_id,
            deposited.payment_row->>'student_name' AS student_name,
            deposited.payment_row->>'student_email' AS student_email,
            COALESCE(
              NULLIF(TRIM(deposited.payment_row->>'issue_date'), ''),
              NULLIF(TRIM(deposited.payment_row->>'payment_date'), '')
            ) AS issue_date,
            deposited.payment_row->>'payment_method' AS payment_method,
            deposited.payment_row->>'status' AS status,
            deposited.payment_row->>'reference_number' AS reference_number,
            COALESCE((deposited.payment_row->>'payable_amount')::numeric, 0) AS payable_amount,
            COALESCE((deposited.payment_row->>'tip_amount')::numeric, 0) AS tip_amount,
            (
              COALESCE((deposited.payment_row->>'payable_amount')::numeric, 0)
              + COALESCE((deposited.payment_row->>'tip_amount')::numeric, 0)
            ) AS line_amount,
            'removed_snapshot' AS gap_type
     FROM cash_deposit_summarytbl c
     CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.cash_payment_snapshot, '[]'::jsonb)) deposited(payment_row)
     WHERE c.branch_id = $1
       AND c.status = ANY($4::text[])
       AND deposited.payment_row ? 'payment_id'
       AND (deposited.payment_row->>'payment_id') ~ '^[0-9]+$'
       AND NOT EXISTS (
         SELECT 1
         FROM paymenttbl p
         WHERE p.payment_id = (deposited.payment_row->>'payment_id')::int
       )
     ORDER BY c.cash_deposit_summary_id,
              (deposited.payment_row->>'payment_id')::int,
              c.submitted_at DESC NULLS LAST`,
    [branchId, currentStartDate, currentEndDate, RESERVED_DEPOSIT_STATUSES]
  );

  const undepositedRes = await query(
    `SELECT p.payment_id,
            p.invoice_id,
            u.full_name AS student_name,
            u.email AS student_email,
            TO_CHAR(p.issue_date, 'YYYY-MM-DD') AS issue_date,
            p.payment_method,
            p.status,
            p.reference_number,
            COALESCE(p.payable_amount, 0) AS payable_amount,
            COALESCE(p.tip_amount, 0) AS tip_amount,
            (COALESCE(p.payable_amount, 0) + COALESCE(p.tip_amount, 0)) AS line_amount,
            dep.cash_deposit_summary_id AS deposit_summary_id,
            dep.deposit_status AS deposit_summary_status,
            dep.deposit_start AS deposit_summary_start_date,
            dep.deposit_end AS deposit_summary_end_date,
            'undeposited_outside_range' AS gap_type
     FROM paymenttbl p
     LEFT JOIN userstbl u ON p.student_id = u.user_id
     INNER JOIN LATERAL (
       SELECT c.cash_deposit_summary_id,
              c.status AS deposit_status,
              TO_CHAR(c.start_date, 'YYYY-MM-DD') AS deposit_start,
              TO_CHAR(c.end_date, 'YYYY-MM-DD') AS deposit_end
       FROM cash_deposit_summarytbl c
       WHERE c.branch_id = p.branch_id
         AND c.status = ANY($4::text[])
         AND p.issue_date >= c.start_date::date
         AND p.issue_date <= c.end_date::date
       ORDER BY c.submitted_at DESC NULLS LAST, c.cash_deposit_summary_id DESC
       LIMIT 1
     ) dep ON true
     WHERE p.branch_id = $1
       AND LOWER(TRIM(p.payment_method)) = 'cash'
       AND p.status = 'Completed'
       AND COALESCE(p.approval_status, 'Pending') <> 'Rejected'
       AND NOT (p.issue_date >= $2::date AND p.issue_date <= $3::date)
       AND NOT EXISTS (
         SELECT 1
         FROM cash_deposit_summarytbl c
         CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.cash_payment_snapshot, '[]'::jsonb)) deposited(payment_row)
         WHERE c.branch_id = p.branch_id
           AND c.status IN ('Pending', 'Submitted', 'Approved')
           AND p.issue_date >= c.start_date::date
           AND p.issue_date <= c.end_date::date
           AND deposited.payment_row ? 'payment_id'
           AND (deposited.payment_row->>'payment_id') ~ '^[0-9]+$'
           AND (deposited.payment_row->>'payment_id')::int = p.payment_id
       )
     ORDER BY p.issue_date DESC, p.payment_id DESC`,
    [branchId, currentStartDate, currentEndDate, RESERVED_DEPOSIT_STATUSES]
  );

  const allGaps = [
    ...(removedRes.rows || []).map(mapSnapshotGapRow),
    ...(undepositedRes.rows || []).map(mapSnapshotGapRow),
  ];

  const periodsMap = new Map();
  for (const gap of allGaps) {
    const key = `${gap.deposit_summary_id || ''}_${gap.deposit_summary_start_date}_${gap.deposit_summary_end_date}`;
    if (!periodsMap.has(key)) {
      periodsMap.set(key, {
        cash_deposit_summary_id: gap.deposit_summary_id,
        start_date: gap.deposit_summary_start_date,
        end_date: gap.deposit_summary_end_date,
        status: gap.deposit_summary_status,
        missing_students: [],
      });
    }
    periodsMap.get(key).missing_students.push(gap);
  }

  const periods = [...periodsMap.values()].sort((a, b) =>
    String(b.start_date).localeCompare(String(a.start_date))
  );

  return {
    periods,
    missing_students: allGaps,
    missing_count: allGaps.length,
  };
};
