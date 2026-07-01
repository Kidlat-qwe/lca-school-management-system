import '../config/loadEnv.js';
import { query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

const userRes = await query(
  `SELECT user_id FROM userstbl WHERE full_name ILIKE '%Gabriel%Balagtas%' LIMIT 1`
);
const sid = userRes.rows[0]?.user_id;

const cs = await query(
  `SELECT cs.class_id, c.class_name, c.level_tag, cs.phase_number, cs.program_enrollment_status,
          cs.enrolled_at, cs.removed_at
   FROM classstudentstbl cs
   JOIN classestbl c ON c.class_id = cs.class_id
   WHERE cs.student_id = $1
   ORDER BY c.class_id, cs.phase_number`,
  [sid]
);
console.log('Enrollments:', cs.rows);

const matrix = await loadStudentMonthEnrollmentMatrix(query, { year: 2026 });
const gabriel = matrix.students.find((s) => s.full_name?.includes('Gabriel'));
if (gabriel) {
  const keys = ['2026-05','2026-06','2026-07','2026-08','2026-09','2026-10','2026-11'];
  for (const k of keys) {
    const c = gabriel.months?.[k];
    console.log(k, c?.mark, c?.label, c?.status, c?.display_upsell_merged ? '[merged]' : '');
  }
}

// Billing month calc for class 40
const billing = await query(
  `
  WITH scoped AS (
    SELECT cs.*, c.start_date,
      NOT EXISTS (SELECT 1 FROM installmentinvoiceprofilestbl ip WHERE ip.student_id=cs.student_id AND ip.class_id=cs.class_id)
      AND NOT EXISTS (
        SELECT 1 FROM invoicestbl i JOIN invoicestudentstbl ist ON ist.invoice_id=i.invoice_id
        WHERE ist.student_id=cs.student_id AND i.status='Paid' AND i.invoice_description ILIKE '%downpayment%'
        AND i.remarks ILIKE ('%CLASS_ID:'||cs.class_id::text||'%')
      ) AS is_full_payment
    FROM classstudentstbl cs JOIN classestbl c ON c.class_id=cs.class_id
    WHERE cs.student_id=$1 AND cs.class_id=40
  ),
  anchor AS (
    SELECT DISTINCT ON (student_id, class_id) student_id, class_id, phase_number AS base_phase,
      DATE_TRUNC('month', TIMEZONE('Asia/Manila', enrolled_at))::date AS base_month
    FROM scoped WHERE enrolled_at IS NOT NULL
    ORDER BY student_id, class_id, phase_number, enrolled_at
  )
  SELECT sr.phase_number, sr.program_enrollment_status, sr.removed_at,
    CASE WHEN sr.is_full_payment AND sr.start_date IS NOT NULL THEN
      TO_CHAR((DATE_TRUNC('month', TIMEZONE('Asia/Manila', sr.start_date)) + ((sr.phase_number-1)||' month')::interval)::date, 'YYYY-MM')
    WHEN a.base_month IS NOT NULL THEN
      TO_CHAR((a.base_month + ((sr.phase_number - a.base_phase)||' month')::interval)::date, 'YYYY-MM')
    END AS billing_month
  FROM scoped sr
  LEFT JOIN anchor a ON a.student_id=sr.student_id AND a.class_id=sr.class_id
  ORDER BY sr.phase_number
  `,
  [sid]
);
console.log('\nClass 40 billing months:', billing.rows);

process.exit(0);
