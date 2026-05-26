/**
 * Why rejected payments appear or not on Payment Logs → Rejected tab.
 * Usage: node scripts/diagnoseRejectedPaymentLogs.js
 */
import '../config/loadEnv.js';
import pool from '../config/database.js';

const r = await pool.query(`
  SELECT
    p.payment_id,
    p.invoice_id,
    p.branch_id,
    p.status AS payment_status,
    p.approval_status,
    TO_CHAR(p.issue_date, 'YYYY-MM-DD') AS issue_date,
    TO_CHAR(p.rejected_at, 'YYYY-MM-DD') AS rejected_at,
    i.status AS invoice_status,
    u.full_name AS student_name
  FROM paymenttbl p
  LEFT JOIN invoicestbl i ON i.invoice_id = p.invoice_id
  LEFT JOIN userstbl u ON u.user_id = p.student_id
  WHERE COALESCE(p.approval_status, '') = 'Rejected'
  ORDER BY p.payment_id
`);

console.log(`\nAll approval_status=Rejected (${r.rows.length} rows):\n`);
console.table(
  r.rows.map((row) => ({
    payment_id: row.payment_id,
    invoice_id: row.invoice_id,
    branch_id: row.branch_id,
    payment_status: row.payment_status,
    invoice_status: row.invoice_status,
    invoice_still_rejected: row.invoice_status === 'Rejected' ? 'YES' : 'NO',
    issue_date: row.issue_date,
    rejected_at: row.rejected_at,
    student: row.student_name,
  }))
);

console.log(`\nRejected tab shows rows where approval_status=Rejected AND invoice status is still Rejected.`);
const visible = r.rows.filter((row) => row.invoice_status === 'Rejected' || row.invoice_id == null);
console.log(`Visible on Rejected tab: ${visible.length} of ${r.rows.length} row(s).`);

await pool.end();
