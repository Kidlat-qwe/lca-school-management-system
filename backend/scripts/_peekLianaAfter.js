import '../config/loadEnv.js';
import { query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

const sid = 678;
const classId = 57;

const en = await query(
  `SELECT classstudent_id, phase_number, program_enrollment_status,
          enrolled_at,
          TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD HH24:MI TZ') AS enrolled_mnl,
          TO_CHAR(enrolled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS enrolled_utc
   FROM classstudentstbl WHERE student_id = $1 ORDER BY class_id, phase_number`,
  [sid]
);
console.log('ENROLL');
console.table(en.rows);

const inv = await query(
  `SELECT invoice_id,
          TO_CHAR(TIMEZONE('Asia/Manila', issue_date),'YYYY-MM-DD') AS issue,
          TO_CHAR(TIMEZONE('Asia/Manila', due_date),'YYYY-MM-DD') AS due
   FROM invoicestbl WHERE installmentinvoiceprofiles_id = 506 ORDER BY invoice_id`
);
console.log('INV');
console.table(inv.rows);

const c = await query(
  `SELECT class_id, class_name,
          TO_CHAR(TIMEZONE('Asia/Manila', start_date),'YYYY-MM-DD') AS start_mnl
   FROM classestbl WHERE class_id = $1`,
  [classId]
);
console.log('CLASS', c.rows[0]);

const matrix = await loadStudentMonthEnrollmentMatrix(query, {
  year: 2026,
  branchId: 5,
  classId,
});
const track = (matrix.students || []).find((s) => s.student_id === sid && s.class_id === classId);
for (const m of matrix.months || []) {
  const cell = track?.months?.[m.key];
  if (cell?.label || cell?.mark === '1' || cell?.mark === '✓') {
    console.log(m.key, cell);
  }
}

process.exit(0);
