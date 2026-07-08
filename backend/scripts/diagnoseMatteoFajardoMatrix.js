import '../config/loadEnv.js';
import { query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

const name = '%Matteo%Fajardo%';
const u = await query(
  `SELECT user_id, full_name, email FROM userstbl WHERE full_name ILIKE $1 AND user_type = 'Student'`,
  [name]
);
console.log('Student:', u.rows[0]);
const studentId = u.rows[0]?.user_id;
if (!studentId) process.exit(0);

const rows = await query(
  `SELECT cs.classstudent_id, cs.class_id, COALESCE(cs.phase_number,1) AS phase_number,
    cs.program_enrollment_status, cs.enrolled_at, cs.removed_at,
    TO_CHAR(TIMEZONE('Asia/Manila', cs.enrolled_at), 'YYYY-MM-DD') AS enrolled_manila,
    c.class_name, TO_CHAR(c.start_date, 'YYYY-MM-DD') AS class_start
   FROM classstudentstbl cs JOIN classestbl c ON c.class_id = cs.class_id
   WHERE cs.student_id = $1 ORDER BY cs.class_id, cs.phase_number`,
  [studentId]
);
console.log('\n=== Enrollment ===');
console.table(rows.rows);

const billing = await query(
  `
    WITH scoped_rows AS (
      SELECT cs.student_id, cs.class_id, COALESCE(cs.phase_number, 1) AS phase_number,
        cs.program_enrollment_status, cs.enrolled_at, c.start_date AS class_start_date
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
        AND program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin', 'completed')
      ORDER BY student_id, class_id, phase_number ASC, enrolled_at ASC
    )
    SELECT sr.phase_number, sr.program_enrollment_status,
      TO_CHAR(a.base_month, 'YYYY-MM') AS anchor_month, a.base_phase,
      TO_CHAR(
        (GREATEST(a.base_month,
          CASE WHEN sr.class_start_date IS NOT NULL
            THEN DATE_TRUNC('month', TIMEZONE('Asia/Manila', sr.class_start_date))::date
            ELSE a.base_month END
        ) + ((sr.phase_number - a.base_phase)::int * INTERVAL '1 month'))::date,
        'YYYY-MM'
      ) AS billing_month
    FROM scoped_rows sr
    LEFT JOIN anchor a ON a.student_id = sr.student_id AND a.class_id = sr.class_id
    ORDER BY sr.class_id, sr.phase_number
  `,
  [studentId]
);
console.log('\n=== Computed billing months ===');
console.table(billing.rows);

const matrix = await loadStudentMonthEnrollmentMatrix(query, { year: 2026 });
const tracks = matrix.students.filter((s) => s.student_id === studentId);
for (const t of tracks) {
  console.log(`\n=== Track class ${t.class_id} ${t.class_name} ===`);
  console.log({
    matrix_installment_class_id: t.matrix_installment_class_id,
    first_enrolled_month_key: t.first_enrolled_month_key,
    hide: t.hide_from_matrix,
  });
  for (const m of matrix.months) {
    const c = t.months?.[m.key];
    if (c?.mark === '1' || c?.mark === '✓' || c?.mark === 'X' || c?.status === 'dropped') {
      console.log(m.key, c.label, c.status, 'p' + c.phase_number, 'mark=' + c.mark);
    }
  }
}

process.exit(0);
