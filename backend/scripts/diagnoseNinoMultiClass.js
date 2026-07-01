import '../config/loadEnv.js';
import { query } from '../config/database.js';
import {
  loadStudentMonthEnrollmentMatrix,
  loadStudentPhaseEnrollmentMatrix,
} from '../lib/enrollmentRateMetrics.js';

const u = await query(
  `SELECT user_id, full_name FROM userstbl WHERE full_name ILIKE '%Nino Angelo%'`
);
const sid = u.rows[0]?.user_id;
console.log('USER', u.rows[0]);

const cs = await query(
  `SELECT cs.classstudent_id, cs.class_id, c.class_name, cs.phase_number,
          cs.program_enrollment_status, cs.enrolled_at
   FROM classstudentstbl cs
   JOIN classestbl c ON c.class_id = cs.class_id
   WHERE cs.student_id = $1 AND cs.removed_at IS NULL
   ORDER BY cs.class_id, cs.phase_number`,
  [sid]
);
console.log('ACTIVE ROWS', cs.rows);

const mm = await loadStudentMonthEnrollmentMatrix(query, { year: 2026 });
const ninoTracks = mm.students.filter((s) => s.student_id === sid);
console.log('MONTH MATRIX TRACKS:', ninoTracks.length);
for (const track of ninoTracks) {
  console.log(
    track.display_name,
    Object.entries(track.months)
      .filter(([, v]) => v.mark === '1')
      .map(([k, v]) => `${k}:${v.label}`)
      .join(', ')
  );
}

const pm = await loadStudentPhaseEnrollmentMatrix(query, { maxPhase: 5 });
const ninoPhaseTracks = pm.students.filter((s) => s.student_id === sid);
console.log('PHASE MATRIX TRACKS:', ninoPhaseTracks.length);
for (const track of ninoPhaseTracks) {
  console.log(
    track.display_name,
    Object.entries(track.phases)
      .filter(([, v]) => v.mark === '1')
      .map(([k, v]) => `P${k}:${v.label}`)
      .join(', ')
  );
}

process.exit(0);
