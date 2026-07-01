/**
 * Diagnose Johan Caeleb Ragos Apasan month matrix labels.
 */
import '../config/loadEnv.js';
import { query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

const name = '%Johan%Apasan%';
const userRes = await query(
  `SELECT user_id, full_name, email FROM userstbl WHERE full_name ILIKE $1 AND user_type = 'Student' LIMIT 5`,
  [name]
);
console.log('=== Students found ===');
for (const u of userRes.rows) console.log(u);
if (!userRes.rows.length) {
  console.log('Student not found');
  process.exit(0);
}

const studentId = userRes.rows[0].user_id;

const rows = await query(
  `
    SELECT
      cs.classstudent_id,
      cs.class_id,
      COALESCE(cs.phase_number, 1) AS phase_number,
      cs.program_enrollment_status,
      cs.enrolled_by,
      cs.enrolled_at,
      TO_CHAR(TIMEZONE('Asia/Manila', cs.enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled_manila,
      cs.removed_at,
      TO_CHAR(TIMEZONE('Asia/Manila', cs.removed_at), 'YYYY-MM-DD') AS removed_manila,
      c.class_name,
      c.level_tag,
      c.start_date,
      TO_CHAR(c.start_date, 'YYYY-MM-DD') AS class_start,
      EXISTS (
        SELECT 1 FROM installmentinvoiceprofilestbl ip
        WHERE ip.student_id = cs.student_id AND ip.class_id = cs.class_id AND ip.is_active = true
      ) AS has_active_installment
    FROM classstudentstbl cs
    INNER JOIN classestbl c ON c.class_id = cs.class_id
    WHERE cs.student_id = $1
    ORDER BY cs.class_id, cs.phase_number, cs.classstudent_id
  `,
  [studentId]
);
console.log('\n=== Enrollment rows ===');
for (const r of rows.rows) console.log(r);

const ip = await query(
  `SELECT installmentinvoiceprofiles_id, class_id, downpayment_paid, generated_count, total_phases, phase_start, is_active, amount
   FROM installmentinvoiceprofilestbl WHERE student_id = $1 ORDER BY installmentinvoiceprofiles_id`,
  [studentId]
);
console.log('\n=== Installment profiles ===');
for (const r of ip.rows) console.log(r);

// Billing month per phase (same formula as matrix)
const billing = await query(
  `
    WITH scoped_rows AS (
      SELECT
        cs.classstudent_id,
        cs.student_id,
        cs.class_id,
        COALESCE(cs.phase_number, 1) AS phase_number,
        cs.program_enrollment_status,
        cs.removed_at,
        cs.enrolled_at,
        c.start_date AS class_start_date,
        EXISTS (
          SELECT 1 FROM paymenttbl p
          INNER JOIN invoicestbl i ON i.invoice_id = p.invoice_id
          WHERE p.student_id = cs.student_id
            AND i.invoice_description ILIKE '%' || COALESCE(cs.phase_number, 1)::text || '%'
            AND p.status = 'Paid'
            AND p.approval_status = 'Approved'
            AND i.invoice_description ILIKE '%Full Payment%'
          LIMIT 1
        ) AS is_full_payment_guess
      FROM classstudentstbl cs
      INNER JOIN classestbl c ON cs.class_id = c.class_id
      WHERE cs.student_id = $1
    ),
    anchor AS (
      SELECT DISTINCT ON (student_id, class_id)
        student_id, class_id, phase_number AS base_phase,
        DATE_TRUNC('month', TIMEZONE('Asia/Manila', enrolled_at))::date AS base_month
      FROM scoped_rows
      WHERE enrolled_at IS NOT NULL
      ORDER BY student_id, class_id, phase_number ASC, enrolled_at ASC
    )
    SELECT
      sr.phase_number,
      sr.program_enrollment_status,
      sr.removed_at,
      TO_CHAR(a.base_month, 'YYYY-MM') AS anchor_month,
      a.base_phase,
      TO_CHAR(
        CASE
          WHEN a.base_month IS NOT NULL THEN
            (a.base_month + ((sr.phase_number - a.base_phase)::int * INTERVAL '1 month'))::date
          ELSE NULL
        END,
        'YYYY-MM'
      ) AS computed_billing_month
    FROM scoped_rows sr
    LEFT JOIN anchor a ON a.student_id = sr.student_id AND a.class_id = sr.class_id
    ORDER BY sr.class_id, sr.phase_number
  `,
  [studentId]
);
console.log('\n=== Computed billing months (installment formula) ===');
for (const r of billing.rows) console.log(r);

for (const year of [2026]) {
  const matrix = await loadStudentMonthEnrollmentMatrix(query, { year });
  const tracks = (matrix.students || []).filter((s) => s.student_id === studentId);
  console.log(`\n=== Matrix tracks ${year} (${tracks.length}) ===`);
  for (const student of tracks) {
    console.log('Track:', student.class_id, student.class_name, 'level:', student.class_level_tag);
    console.log('  first_enrolled_month_key:', student.first_enrolled_month_key);
    console.log('  last_full_pay_month_key:', student.last_full_pay_month_key);
    console.log('  package_complete_month_key:', student.package_complete_month_key);
    console.log('  class_number_of_phase:', student.class_number_of_phase);
    console.log('  installment_package_complete:', student.installment_package_complete);
    console.log('  hide_from_matrix:', student.hide_from_matrix);
    for (const m of matrix.months) {
      const cell = student.months?.[m.key];
      const mark = cell?.mark ?? '-';
      const label = cell?.label ?? '';
      if (mark === '1' || label) {
        console.log(`  ${m.key}: ${label || '(no label)'} [${cell?.status || ''}]`);
      } else {
        console.log(`  ${m.key}: —`);
      }
    }
  }
}

const classId = rows.rows[0]?.class_id;
const inv = await query(
  `SELECT i.invoice_id, i.invoice_description, i.status, i.amount, i.issue_date,
          TO_CHAR(TIMEZONE('Asia/Manila', i.issue_date), 'YYYY-MM-DD') AS issue_manila,
          i.installmentinvoiceprofiles_id, i.remarks
   FROM invoicestbl i
   JOIN invoicestudentstbl ist ON ist.invoice_id = i.invoice_id
   WHERE ist.student_id = $1
   ORDER BY i.issue_date, i.invoice_id`,
  [studentId]
);
console.log('\n=== Invoices ===');
for (const r of inv.rows) console.log(r);

const pay1158 = await query(
  `SELECT p.payment_id, p.invoice_id, p.payable_amount, p.status, p.approval_status, p.created_at,
          i.invoice_description, i.remarks
   FROM paymenttbl p
   LEFT JOIN invoicestbl i ON i.invoice_id = p.invoice_id
   WHERE p.student_id = $1
   ORDER BY p.payment_id`,
  [studentId]
);
console.log('\n=== All payments ===');
for (const r of pay1158.rows) console.log(r);

const allPhases = await query(
  `SELECT classstudent_id, phase_number, program_enrollment_status, enrolled_at, removed_at, enrolled_by
   FROM classstudentstbl
   WHERE student_id = $1 AND class_id = $2
   ORDER BY phase_number, classstudent_id`,
  [studentId, classId]
);
console.log('\n=== All phase rows (incl removed) ===');
console.log(allPhases.rows);

process.exit(0);
