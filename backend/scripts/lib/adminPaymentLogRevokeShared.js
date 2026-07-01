/**
 * Shared queries for revoking Admin approvals shown on Payment Logs.
 * All dates / all branches — no year or month filter.
 */

export const PAYMENT_WHERE = `
  COALESCE(p.approval_status, 'Pending') = 'Approved'
  AND p.approved_by IS NOT NULL
  AND p.status = 'Completed'
  AND COALESCE(p.approval_status, 'Pending') NOT IN ('Returned', 'Rejected')
  AND LOWER(TRIM(approver.user_type)) = 'admin'
`;

export const AR_WHERE = `
  ar.verified_by_user_id IS NOT NULL
  AND ar.status IN ('Verified', 'Applied')
  AND LOWER(TRIM(verifier.user_type)) = 'admin'
`;

export async function columnExists(client, tableName, columnName) {
  const r = await client.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1
       AND column_name = $2
     LIMIT 1`,
    [tableName, columnName]
  );
  return r.rows.length > 0;
}

export async function listAdminAccounts(client) {
  const r = await client.query(
    `
      SELECT full_name, user_id, email
      FROM userstbl
      WHERE LOWER(TRIM(user_type)) = 'admin'
      ORDER BY full_name ASC NULLS LAST, user_id ASC
    `
  );
  return r.rows;
}

export async function previewPayments(client) {
  const result = await client.query(
    `
      SELECT
        p.payment_id,
        p.invoice_id,
        p.branch_id,
        COALESCE(pb.branch_nickname, pb.branch_name) AS branch_name,
        p.payment_method,
        TO_CHAR(p.issue_date, 'YYYY-MM-DD') AS issue_date,
        TO_CHAR(TIMEZONE('Asia/Manila', p.approved_at), 'YYYY-MM-DD HH24:MI:SS') AS approved_at_manila,
        approver.full_name AS approver_name,
        approver.user_id AS approver_user_id
      FROM paymenttbl p
      INNER JOIN userstbl approver ON p.approved_by = approver.user_id
      LEFT JOIN branchestbl pb ON p.branch_id = pb.branch_id
      WHERE ${PAYMENT_WHERE}
      ORDER BY p.issue_date DESC, p.approved_at DESC NULLS LAST, p.payment_id DESC
    `
  );
  return result.rows;
}

export async function previewAr(client, hasVerifierCols) {
  const verifiedAtSelect = hasVerifierCols
    ? `TO_CHAR(TIMEZONE('Asia/Manila', ar.verified_at), 'YYYY-MM-DD HH24:MI:SS') AS verified_at_manila`
    : `NULL::text AS verified_at_manila`;

  const r = await client.query(
    `
      SELECT
        ar.ack_receipt_id,
        ar.ack_receipt_number,
        ar.ar_type,
        ar.status,
        ar.branch_id,
        COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
        ar.prospect_student_name,
        ar.package_name_snapshot,
        ar.reference_number,
        TO_CHAR(ar.issue_date, 'YYYY-MM-DD') AS issue_date,
        ar.payment_id,
        ar.invoice_id,
        (ar.payment_id IS NULL AND ar.invoice_id IS NULL) AS shows_in_payment_logs_unapplied,
        ${verifiedAtSelect},
        verifier.full_name AS verifier_name,
        verifier.user_id AS verifier_user_id
      FROM acknowledgement_receiptstbl ar
      INNER JOIN userstbl verifier ON ar.verified_by_user_id = verifier.user_id
      LEFT JOIN branchestbl b ON ar.branch_id = b.branch_id
      WHERE ${AR_WHERE}
      ORDER BY ar.issue_date DESC, ar.verified_at DESC NULLS LAST, ar.ack_receipt_id DESC
    `
  );
  return r.rows;
}

export async function revertPayments(client) {
  const updateResult = await client.query(
    `
      UPDATE paymenttbl p
      SET approval_status = 'Pending',
          approved_by = NULL,
          approved_at = NULL,
          finance_verified_reference_number = NULL
      FROM userstbl approver
      WHERE p.approved_by = approver.user_id
        AND ${PAYMENT_WHERE}
      RETURNING p.payment_id
    `
  );
  return updateResult.rowCount;
}

export async function revertAr(client, hasVerifierCols) {
  const sql = hasVerifierCols
    ? `
        UPDATE acknowledgement_receiptstbl ar
        SET status = 'Submitted',
            verified_by_user_id = NULL,
            verified_at = NULL
        FROM userstbl verifier
        WHERE ar.verified_by_user_id = verifier.user_id
          AND ${AR_WHERE}
        RETURNING ar.ack_receipt_id
      `
    : `
        UPDATE acknowledgement_receiptstbl ar
        SET status = 'Submitted'
        FROM userstbl verifier
        WHERE ar.verified_by_user_id = verifier.user_id
          AND ${AR_WHERE}
        RETURNING ar.ack_receipt_id
      `;

  const result = await client.query(sql);
  return result.rowCount;
}

export function groupCountByYearMonth(rows, dateField) {
  const map = new Map();
  for (const row of rows) {
    const d = String(row[dateField] || '').slice(0, 7);
    const key = d || '(no date)';
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}
