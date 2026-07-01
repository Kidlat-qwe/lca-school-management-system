/**
 * Mariasha Luzia B. Pangilin — align phase 1 enrolled_at with class Phase 1 start
 * so the month re-enrollment matrix shows **new** in March (not May).
 *
 * Root cause: phase 1 classstudent.enrolled_at was set to 2026-05-17 (auto-enroll on
 * a later payment), so billing anchor month = May. Class Phase 1 sessions begin
 * 2026-03-02.
 *
 * Fix (--apply):
 *   - classstudentstbl phase 1 active row → enrolled_at = first Phase 1 session date
 *
 * Run:
 *   node backend/scripts/repairMariashaPangilinPhase1EnrollmentAnchor.js
 *   node backend/scripts/repairMariashaPangilinPhase1EnrollmentAnchor.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';
import { query } from '../config/database.js';

const STUDENT_EMAIL = 'marykatherinepangilin@gmail.com';
const STUDENT_ID = 476;
const CLASS_ID = 37;
const PROFILE_ID = 337;

const REPAIR_NOTE =
  'Ops repair — Mariasha Pangilin phase 1 enrolled_at aligned to Phase 1 class start';

const isApply = process.argv.includes('--apply');

function formatTs(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

async function loadPhase1SessionStart(client) {
  const r = await client.query(
    `SELECT MIN(cs.scheduled_date) AS first_session
     FROM classsessionstbl cs
     WHERE cs.class_id = $1
       AND cs.phase_number = 1
       AND COALESCE(cs.status, 'Scheduled') != 'Cancelled'`,
    [CLASS_ID]
  );
  const first = r.rows[0]?.first_session;
  if (!first) {
    throw new Error(`No Phase 1 sessions found for class_id=${CLASS_ID}`);
  }
  return first;
}

async function loadPhase1EnrollmentRow(client) {
  const r = await client.query(
    `SELECT classstudent_id, phase_number, program_enrollment_status, enrolled_at, removed_at, enrolled_by
     FROM classstudentstbl
     WHERE student_id = $1
       AND class_id = $2
       AND phase_number = 1
       AND removed_at IS NULL
     ORDER BY classstudent_id DESC
     LIMIT 1`,
    [STUDENT_ID, CLASS_ID]
  );
  return r.rows[0] || null;
}

async function previewMatrixMonths() {
  const matrix = await loadStudentMonthEnrollmentMatrix(query, { year: 2026 });
  const track = matrix.students.find(
    (s) => s.student_id === STUDENT_ID && s.class_id === CLASS_ID
  );
  if (!track) return [];
  return Object.entries(track.months || {})
    .filter(([, cell]) => cell?.mark === '1')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, cell]) => ({
      month: monthKey,
      label: cell.label,
      phase_number: cell.phase_number,
    }));
}

async function main() {
  console.log(
    `\nMariasha Pangilin — phase 1 enrollment anchor repair${
      isApply ? ' (APPLY)' : ' (DRY RUN)'
    }\n`
  );

  const client = await getClient();

  try {
    const student = (
      await client.query(
        `SELECT user_id, full_name, email FROM userstbl
         WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))`,
        [STUDENT_EMAIL]
      )
    ).rows[0];

    if (!student || Number(student.user_id) !== STUDENT_ID) {
      throw new Error(`Student not found or ID mismatch for ${STUDENT_EMAIL}`);
    }

    console.log(`Student: ${student.full_name} (${student.email})`);
    console.log(`Class ID: ${CLASS_ID} | Profile ID: ${PROFILE_ID}`);

    const targetEnrolledAt = await loadPhase1SessionStart(client);
    const row = await loadPhase1EnrollmentRow(client);

    if (!row) {
      throw new Error('No active phase 1 classstudent row found');
    }

    console.log('\nPhase 1 class Phase 1 first session (target enrolled_at):', targetEnrolledAt);
    console.log('\nCurrent phase 1 enrollment row:');
    console.table([
      {
        classstudent_id: row.classstudent_id,
        status: row.program_enrollment_status,
        enrolled_at: formatTs(row.enrolled_at),
        enrolled_by: (row.enrolled_by || '').slice(0, 80),
      },
    ]);

    const beforeMatrix = await previewMatrixMonths();
    console.log('\nMatrix months BEFORE:');
    if (beforeMatrix.length === 0) {
      console.log('  (no labeled cells)');
    } else {
      console.table(beforeMatrix);
    }

    console.log('\nPlanned change:');
    console.log(
      `  • classstudent_id ${row.classstudent_id}: enrolled_at ${formatTs(row.enrolled_at)} → ${formatTs(targetEnrolledAt)}`
    );
    console.log(`  • enrolled_by: append repair note`);

    console.log('\nExpected matrix AFTER apply:');
    console.table([
      { month: '2026-03', label: 'new', phase_number: 1 },
      { month: '2026-04', label: 're-enrolled', phase_number: 2 },
      { month: '2026-05', label: 're-enrolled', phase_number: 3 },
      { month: '2026-06', label: 're-enrolled', phase_number: 4 },
    ]);

    if (!isApply) {
      console.log('\nRe-run with --apply to update enrolled_at.');
      return;
    }

    await client.query('BEGIN');

    const enrolledBy = [row.enrolled_by, REPAIR_NOTE].filter(Boolean).join(' | ');

    await client.query(
      `UPDATE classstudentstbl
       SET enrolled_at = $1,
           enrolled_by = $2
       WHERE classstudent_id = $3`,
      [targetEnrolledAt, enrolledBy, row.classstudent_id]
    );

    await client.query('COMMIT');
    console.log('\n✅ Applied enrolled_at update.');

    const afterMatrix = await previewMatrixMonths();
    console.log('\nMatrix months AFTER:');
    console.table(afterMatrix);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
