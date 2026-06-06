/**
 * Inspect Bronny tracks before/after upsell month-matrix merge.
 */
import '../config/loadEnv.js';
import { query } from '../config/database.js';
import {
  applyUpsellMatrixDisplayRules,
  filterHiddenMatrixTracks,
} from '../lib/enrollmentRateMetrics.js';

// Minimal re-run: load matrix internals via exported loader path
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

// Patch: load with internal access - use full matrix then manually check hidden
const matrix = await loadStudentMonthEnrollmentMatrix(query, { year: 2026 });

// The API filters hidden - query all tracks by re-loading isn't easy.
// Query Bronny classstudent + billing manually
const bronnyId = (
  await query(`SELECT user_id FROM userstbl WHERE full_name ILIKE 'Bronny James' AND user_type='Student' LIMIT 1`)
).rows[0]?.user_id;

const phases = await query(
  `
  SELECT cs.class_id, c.class_name, cs.phase_number, cs.program_enrollment_status, cs.enrolled_at, c.start_date
  FROM classstudentstbl cs
  JOIN classestbl c ON c.class_id = cs.class_id
  WHERE cs.student_id = $1
  ORDER BY c.class_name, cs.phase_number
  `,
  [bronnyId]
);

console.log('Bronny phase rows:', phases.rows.length);
for (const r of phases.rows) {
  console.log(`  ${r.class_name} ph${r.phase_number} ${r.program_enrollment_status} enrolled=${r.enrolled_at?.toISOString?.().slice(0, 10)}`);
}

console.log('\nVisible 2026 matrix tracks:');
for (const s of matrix.students.filter((x) => x.student_id === bronnyId)) {
  console.log(s.display_name, s.class_name, 'hidden:', s.hide_from_matrix);
  for (const [k, c] of Object.entries(s.months || {}).filter(([, v]) => v?.label).sort()) {
    console.log(`  ${k}: ${c.label}`);
  }
}

console.log('\nMatrix KPI re-enrolled 2026:', matrix.total_re_enrolled_count);

process.exit(0);
