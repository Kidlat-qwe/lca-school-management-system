/**
 * Diagnose Kiev Zion Z. Serrano installment billing state.
 */
import '../config/loadEnv.js';
import { query } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';

const PROFILE_ID = 384;
const STUDENT_ID = 581;

const profile = await query(
  `SELECT ip.*, u.full_name, u.email,
    TO_CHAR(TIMEZONE('Asia/Manila', ii.next_generation_date), 'YYYY-MM-DD') AS next_gen,
    TO_CHAR(TIMEZONE('Asia/Manila', ii.next_invoice_month), 'YYYY-MM-DD') AS next_month,
    ii.installmentinvoicedtl_id, ii.status AS queue_status
  FROM installmentinvoiceprofilestbl ip
  INNER JOIN userstbl u ON u.user_id = ip.student_id
  LEFT JOIN installmentinvoicestbl ii ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
    AND COALESCE(ii.status,'') != 'Generated'
  WHERE ip.installmentinvoiceprofiles_id = $1`,
  [PROFILE_ID]
);

const invoices = await query(
  `SELECT invoice_id, invoice_ar_number, status, amount, remarks,
    TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue_ymd,
    TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due_ymd
  FROM invoicestbl WHERE installmentinvoiceprofiles_id = $1 ORDER BY invoice_id`,
  [PROFILE_ID]
);

const enrollments = await query(
  `SELECT cs.classstudent_id, cs.class_id, c.class_name, cs.phase_number, cs.program_enrollment_status,
    TO_CHAR(cs.enrolled_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS enrolled_at,
    TO_CHAR(cs.removed_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS removed_at
  FROM classstudentstbl cs
  LEFT JOIN classestbl c ON c.class_id = cs.class_id
  WHERE cs.student_id = $1
  ORDER BY cs.class_id, cs.phase_number`,
  [STUDENT_ID]
);

console.log('PROFILE', profile.rows);
console.log(
  'INVOICES',
  invoices.rows.map((i) => ({ ...i, phase: parseTargetPhase(i.remarks) }))
);
console.log('ENROLLMENTS', enrollments.rows);

const phase2Enrollment = await query(
  `SELECT classstudent_id, program_enrollment_status, removed_reason, removed_by
   FROM classstudentstbl WHERE classstudent_id = 1656`
);
const payments = await query(
  `SELECT payment_id, invoice_id FROM paymenttbl WHERE invoice_id IN (1509, 1795)`
);
console.log('PHASE2_ENROLLMENT', phase2Enrollment.rows);
console.log('PAYMENTS_ON_PHASE23', payments.rows);
