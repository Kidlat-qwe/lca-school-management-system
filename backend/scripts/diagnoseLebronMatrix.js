import '../config/loadEnv.js';
import { query } from '../config/database.js';
import {
  loadStudentMonthEnrollmentMatrix,
  loadStudentPhaseEnrollmentMatrix,
} from '../lib/enrollmentRateMetrics.js';

const sid = 31;

const cs = await query(
  `SELECT phase_number, program_enrollment_status, removed_at IS NOT NULL AS has_removed
   FROM classstudentstbl WHERE student_id = $1 ORDER BY phase_number`,
  [sid]
);
console.log('CLASSSTUDENT:', cs.rows);

const monthMatrix = await loadStudentMonthEnrollmentMatrix(query, { year: 2026 });
const phaseMatrix = await loadStudentPhaseEnrollmentMatrix(query, { year: 2026 });

const monthRow = monthMatrix.students.find((s) => s.student_id === sid);
const phaseRow = phaseMatrix.students.find((s) => s.student_id === sid);

console.log('\nMONTH (labeled cells only):');
for (const [k, v] of Object.entries(monthRow?.months || {})) {
  if (v?.label) console.log(`  ${k}: ${v.label}`);
}

console.log('\nPHASE:');
for (let p = 1; p <= 10; p++) {
  const c = phaseRow?.phases?.[p];
  if (c?.label) console.log(`  P${p}: ${c.label}`);
}

process.exit(0);
