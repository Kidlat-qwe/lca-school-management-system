/**
 * Diagnose Andrei Caleb Ethan V. Atienza month matrix labels.
 */
import '../config/loadEnv.js';
import { query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

const name = '%Andrei%Atienza%';
const userRes = await query(
  `SELECT user_id, full_name, email FROM userstbl WHERE full_name ILIKE $1 AND user_type = 'Student' LIMIT 5`,
  [name]
);
console.log('=== Students found ===');
for (const u of userRes.rows) console.log(u);
if (!userRes.rows.length) process.exit(0);

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
      TO_CHAR(TIMEZONE('Asia/Manila', cs.removed_at), 'YYYY-MM-DD HH24:MI') AS removed_manila,
      c.class_name,
      c.level_tag
    FROM classstudentstbl cs
    INNER JOIN classestbl c ON c.class_id = cs.class_id
    WHERE cs.student_id = $1
    ORDER BY cs.class_id, cs.phase_number, cs.classstudent_id, cs.enrolled_at NULLS LAST
  `,
  [studentId]
);
console.log('\n=== All enrollment rows ===');
for (const r of rows.rows) console.log(r);

const billing = await query(
  `
    WITH scoped_rows AS (
      SELECT
        cs.student_id, cs.class_id,
        COALESCE(cs.phase_number, 1) AS phase_number,
        cs.program_enrollment_status, cs.removed_at, cs.enrolled_at
      FROM classstudentstbl cs
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
      sr.class_id, sr.phase_number, sr.program_enrollment_status,
      TO_CHAR(sr.removed_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM') AS removed_month,
      TO_CHAR(a.base_month, 'YYYY-MM') AS anchor_month,
      TO_CHAR(
        (a.base_month + ((sr.phase_number - a.base_phase)::int * INTERVAL '1 month'))::date,
        'YYYY-MM'
      ) AS computed_billing_month
    FROM scoped_rows sr
    LEFT JOIN anchor a ON a.student_id = sr.student_id AND a.class_id = sr.class_id
    ORDER BY sr.class_id, sr.phase_number
  `,
  [studentId]
);
console.log('\n=== Computed billing months ===');
for (const r of billing.rows) console.log(r);

const rejoinRows = await query(
  `
    SELECT classstudent_id, class_id, phase_number, program_enrollment_status, enrolled_at,
           TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM') AS enrolled_month
    FROM classstudentstbl
    WHERE student_id = $1 AND program_enrollment_status = 'rejoin'
    ORDER BY enrolled_at
  `,
  [studentId]
);
console.log('\n=== Rejoin rows ===');
console.log(rejoinRows.rows);

for (const year of [2026]) {
  const matrix = await loadStudentMonthEnrollmentMatrix(query, { year });
  const tracks = (matrix.students || []).filter((s) => s.student_id === studentId);
  console.log(`\n=== Matrix tracks ${year} (${tracks.length}) ===`);
  for (const student of tracks) {
    console.log('Track:', student.class_id, student.class_name, student.class_level_tag);
    console.log('  first_enrolled_month_key:', student.first_enrolled_month_key);
    console.log('  first_enrolled_at:', student.first_enrolled_at);
    console.log('  package_complete_month_key:', student.package_complete_month_key);
    for (const m of matrix.months) {
      const cell = student.months?.[m.key];
      if (cell?.mark === '1' || cell?.label) {
        console.log(
          `  ${m.key}: ${cell.label} [${cell.status}]` +
            (cell.calendar_new ? ' calendar_new' : '') +
            (cell.calendar_rejoin ? ' calendar_rejoin' : '') +
            (cell.calendar_dropped ? ' calendar_dropped' : '')
        );
      }
    }
  }
}

const profile = await query(
  `SELECT installmentinvoiceprofiles_id, class_id, phase_start, generated_count, total_phases, downpayment_paid
   FROM installmentinvoiceprofilestbl WHERE student_id = $1 AND class_id = 58`,
  [studentId]
);
console.log('\n=== Installment profile ===');
console.log(profile.rows);

const droppedDetail = await query(
  `SELECT classstudent_id, phase_number, program_enrollment_status, removed_at, removed_reason, enrolled_by
   FROM classstudentstbl WHERE student_id = $1 AND class_id = 58 AND program_enrollment_status = 'dropped'`,
  [studentId]
);
console.log('\n=== Dropped rows detail ===');
console.log(droppedDetail.rows);

process.exit(0);
