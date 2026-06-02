/**
 * Diagnose Amari Syre Tongol matrix labels across 2025-2026.
 */
import '../config/loadEnv.js';
import { query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

const name = '%Amari Syre Tongol%';
const userRes = await query(
  `SELECT user_id, full_name FROM userstbl WHERE full_name ILIKE $1 AND user_type = 'Student' LIMIT 3`,
  [name]
);
if (!userRes.rows.length) {
  console.log('Student not found');
  process.exit(0);
}
const studentId = userRes.rows[0].user_id;
console.log('Student:', userRes.rows[0]);

const rows = await query(
  `
    SELECT
      cs.classstudent_id,
      COALESCE(cs.phase_number, 1) AS phase_number,
      cs.program_enrollment_status,
      cs.enrolled_at,
      TO_CHAR(TIMEZONE('Asia/Manila', cs.enrolled_at), 'YYYY-MM-DD') AS enrolled_manila,
      cs.removed_at,
      c.class_name,
      c.start_date,
      EXISTS (
        SELECT 1 FROM installmentinvoiceprofilestbl ip
        WHERE ip.student_id = cs.student_id AND ip.class_id = cs.class_id
      ) AS is_installment
    FROM classstudentstbl cs
    INNER JOIN classestbl c ON c.class_id = cs.class_id
    WHERE cs.student_id = $1
    ORDER BY cs.phase_number, cs.enrolled_at
  `,
  [studentId]
);
console.log('\n=== Enrollment rows ===');
for (const r of rows.rows) console.log(r);

for (const year of [2025, 2026]) {
  const matrix = await loadStudentMonthEnrollmentMatrix(query, { year });
  const student = (matrix.students || []).find((s) => s.student_id === studentId);
  console.log(`\n=== Matrix ${year} ===`);
  console.log('first_enrolled_month_key:', student?.first_enrolled_month_key);
  if (student) {
    for (const m of matrix.months) {
      const cell = student.months?.[m.key];
      if (cell?.mark === '1' || cell?.label) {
        console.log(m.key, cell.label || '(empty)', cell.mark);
      }
    }
    console.log('last_full_pay_month_key:', student.last_full_pay_month_key);
  } else {
    console.log('Not in cohort');
  }
}

process.exit(0);
