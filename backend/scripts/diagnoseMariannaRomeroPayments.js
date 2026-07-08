import '../config/loadEnv.js';
import { query } from '../config/database.js';

const r = await query(
  `SELECT cds.cash_deposit_summary_id, cds.summary_date, cds.status,
          cdsp.payable_amount, cdsp.invoice_id, cdsp.payment_id
   FROM cash_deposit_summary_paymentstbl cdsp
   JOIN cash_deposit_summarytbl cds ON cds.cash_deposit_summary_id = cdsp.cash_deposit_summary_id
   WHERE cdsp.invoice_id IN (1349, 1354, 1735)
      OR cdsp.payment_id = 1147`
);
console.log('cash deposit links', r.rows);

const inv1354hist = await query(
  `SELECT p.payment_id, p.payable_amount, p.payment_method, p.reference_number,
          TO_CHAR(p.issue_date,'YYYY-MM-DD') issue_date, p.status, p.approval_status
   FROM paymenttbl p
   WHERE p.invoice_id = 1354
   UNION ALL
   SELECT 1147, NULL, NULL, NULL, NULL, 'deleted', NULL
   WHERE NOT EXISTS (SELECT 1 FROM paymenttbl WHERE payment_id = 1147)`
);

// Search all payments for student on June 8
const june8 = await query(
  `SELECT p.*, i.invoice_description
   FROM paymenttbl p
   JOIN invoicestudentstbl ist ON ist.invoice_id = p.invoice_id
   JOIN invoicestbl i ON i.invoice_id = p.invoice_id
   WHERE ist.student_id = 560
     AND p.issue_date::date = '2026-06-08'::date`
);
console.log('june8 payments', june8.rows);
