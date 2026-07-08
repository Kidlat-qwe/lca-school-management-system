/**
 * Diagnose Kiev Zion Z. Serrano month matrix labels.
 */
import '../config/loadEnv.js';
import { query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

const STUDENT_ID = 581;
const DISPLAY_CLASS_ID = 120;

const rows = await query(
  `SELECT cs.classstudent_id, cs.class_id, COALESCE(cs.phase_number,1) AS phase_number,
    cs.program_enrollment_status, cs.enrolled_at, cs.removed_at, cs.enrolled_by,
    TO_CHAR(TIMEZONE('Asia/Manila', cs.enrolled_at), 'YYYY-MM-DD') AS enrolled_manila,
    TO_CHAR(TIMEZONE('Asia/Manila', cs.removed_at), 'YYYY-MM-DD') AS removed_manila,
    c.class_name, TO_CHAR(c.start_date, 'YYYY-MM-DD') AS class_start
   FROM classstudentstbl cs JOIN classestbl c ON c.class_id = cs.class_id
   WHERE cs.student_id = $1 ORDER BY cs.class_id, cs.phase_number`,
  [STUDENT_ID]
);
console.log('=== Enrollment ===');
console.table(rows.rows);

const matrix = await loadStudentMonthEnrollmentMatrix(query, { year: 2026 });
const track = matrix.students.find(
  (s) => s.student_id === STUDENT_ID && s.class_id === DISPLAY_CLASS_ID
);
console.log('\n=== Matrix (display class) ===');
if (!track) {
  console.log('Track not found');
} else {
  console.log({
    matrix_installment_class_id: track.matrix_installment_class_id,
    first_enrolled_month_key: track.first_enrolled_month_key,
  });
  for (const m of matrix.months) {
    const c = track.months?.[m.key];
    if (c?.mark === '1' || c?.mark === '✓' || c?.mark === 'X' || c?.status === 'dropped') {
      console.log(m.key, c.label, c.status, 'phase', c.phase_number, 'mark', c.mark);
    }
  }
}

process.exit(0);
