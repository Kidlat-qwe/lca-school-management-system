/**
 * One-off / ops: list distinct student emails tied to invoices that have a penalty.
 * Penalty = late_penalty_applied_for_due_date set OR any invoice line with penalty_amount > 0.
 * Uses DB from backend/.env (set NODE_ENV / .env.production if you use layered env).
 */
import '../config/loadEnv.js';
import { query } from '../config/database.js';

const sql = `
  SELECT DISTINCT u.user_id, u.email, u.full_name
  FROM invoicestudentstbl ist
  JOIN userstbl u ON u.user_id = ist.student_id
  JOIN invoicestbl i ON i.invoice_id = ist.invoice_id
  WHERE COALESCE(u.user_type, '') = 'Student'
    AND (
      i.late_penalty_applied_for_due_date IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM invoiceitemstbl ii
        WHERE ii.invoice_id = i.invoice_id
          AND COALESCE(ii.penalty_amount, 0) > 0
      )
    )
  ORDER BY u.email NULLS LAST, u.user_id;
`;

try {
  const { rows } = await query(sql);
  const emails = [...new Set(rows.map((r) => r.email).filter(Boolean))];
  console.log(JSON.stringify({ countStudents: rows.length, distinctEmails: emails.length, rows, emails }, null, 2));
  process.exit(0);
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
