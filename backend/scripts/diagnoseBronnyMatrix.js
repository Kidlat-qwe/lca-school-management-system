import '../config/loadEnv.js';
import { query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

const users = await query(
  `SELECT user_id, full_name FROM userstbl WHERE full_name ILIKE '%Bronny James%'`
);
console.log('Users:', users.rows);

const studentId = users.rows[0]?.user_id;
if (!studentId) {
  console.log('Bronny not found');
  process.exit(0);
}

const cs = await query(
  `SELECT cs.classstudent_id, cs.class_id, cs.phase_number, cs.program_enrollment_status,
          cs.enrolled_at, cs.removed_at, c.class_name, c.level_tag
   FROM classstudentstbl cs
   JOIN classestbl c ON c.class_id = cs.class_id
   WHERE cs.student_id = $1
   ORDER BY c.class_name, cs.phase_number`,
  [studentId]
);
console.log('\nClassstudent rows:', cs.rows);

const matrix2026 = await loadStudentMonthEnrollmentMatrix(query, { year: 2026 });
const matrix2027 = await loadStudentMonthEnrollmentMatrix(query, { year: 2027 });

const bronnyTracks = (matrix) =>
  (matrix.students || []).filter(
    (s) => s.student_id === studentId || (s.full_name || '').includes('Bronny')
  );

console.log('\n=== 2026 matrix tracks for Bronny ===');
for (const t of bronnyTracks(matrix2026)) {
  console.log(JSON.stringify({
    student_id: t.student_id,
    class_id: t.class_id,
    class_name: t.class_name,
    level_tag: t.class_level_tag,
    display_name: t.display_name,
    hide_from_matrix: t.hide_from_matrix,
    matrix_merged_upsell_anchor: t.matrix_merged_upsell_anchor,
    matrix_merged_into_anchor: t.matrix_merged_into_anchor,
    months: t.months,
  }, null, 2));
}

console.log('\n=== 2027 matrix tracks for Bronny ===');
for (const t of bronnyTracks(matrix2027)) {
  console.log(JSON.stringify({
    class_id: t.class_id,
    class_name: t.class_name,
    months: t.months,
    hide_from_matrix: t.hide_from_matrix,
  }, null, 2));
}

process.exit(0);
