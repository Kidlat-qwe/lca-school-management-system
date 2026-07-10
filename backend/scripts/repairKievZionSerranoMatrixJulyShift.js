/**
 * Kiev Zion Z. Serrano — month re-enrollment matrix July alignment.
 *
 * After class start shift to July (display class 120) and phase 1 paid:
 * - Phase 1 "new" should appear in July, not May/June.
 * - Remove premature phase 2 enrollment row (phase 2 invoice not generated).
 *
 * Billing profile class: 110 | Display class: 120
 *
 * Run:
 *   node backend/scripts/repairKievZionSerranoMatrixJulyShift.js
 *   node backend/scripts/repairKievZionSerranoMatrixJulyShift.js --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

const STUDENT_ID = 581;
const BILLING_CLASS_ID = 110;
const DISPLAY_CLASS_ID = 120;
const PHASE1_BILLING_CLASSSTUDENT_ID = 1743;
const PHASE2_PREMATURE_CLASSSTUDENT_ID = 1656;
const DISPLAY_CLASSSTUDENT_ID = 1025;
const JULY_CLASS_START = '2026-07-03';
const REPAIR_NOTE = 'Ops repair — matrix new month July after class start June→July';

const isApply = process.argv.includes('--apply');

async function previewMatrix(classId) {
  const matrix = await loadStudentMonthEnrollmentMatrix(query, { year: 2026 });
  const track = matrix.students.find(
    (s) => s.student_id === STUDENT_ID && s.class_id === classId
  );
  if (!track) return null;
  const cells = [];
  for (const m of matrix.months) {
    const c = track.months?.[m.key];
    if (c?.mark === '1' || c?.mark === '✓' || c?.mark === 'X' || c?.status === 'dropped') {
      cells.push({
        month: m.key,
        label: c.label,
        status: c.status,
        phase: c.phase_number,
        mark: c.mark,
      });
    }
  }
  return cells;
}

async function main() {
  console.log(
    `\nKiev Zion Serrano — matrix July shift${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );

  const client = await getClient();
  try {
    const enrollments = (
      await client.query(
        `SELECT cs.classstudent_id, cs.class_id, cs.phase_number, cs.program_enrollment_status,
                TO_CHAR(TIMEZONE('Asia/Manila', cs.enrolled_at), 'YYYY-MM-DD') AS enrolled_manila,
                c.class_name,
                TO_CHAR(c.start_date, 'YYYY-MM-DD') AS class_start
         FROM classstudentstbl cs
         JOIN classestbl c ON c.class_id = cs.class_id
         WHERE cs.student_id = $1
         ORDER BY cs.class_id, cs.phase_number`,
        [STUDENT_ID]
      )
    ).rows;

    console.log('Current enrollments:');
    console.table(enrollments);

    console.log('\nMatrix BEFORE (display class 120):');
    console.table((await previewMatrix(DISPLAY_CLASS_ID)) || []);

    console.log('\nPlanned changes:');
    console.log(
      `  • UPDATE classstudent ${PHASE1_BILLING_CLASSSTUDENT_ID} enrolled_at → ${JULY_CLASS_START}`
    );
    console.log(
      `  • UPDATE classstudent ${DISPLAY_CLASSSTUDENT_ID} enrolled_at → ${JULY_CLASS_START}`
    );
    console.log(
      `  • DELETE classstudent ${PHASE2_PREMATURE_CLASSSTUDENT_ID} (premature phase 2, not generated)`
    );
    console.log('\nExpected matrix AFTER:');
    console.table([
      { month: '2026-07', label: 'new', phase: 1 },
      { month: '2026-08', label: 'Active', phase: null },
    ]);

    if (!isApply) {
      console.log('\nDRY RUN — re-run with --apply');
      return;
    }

    await client.query('BEGIN');

    await client.query(
      `UPDATE classstudentstbl
       SET enrolled_at = $1::timestamptz,
           enrolled_by = COALESCE(enrolled_by, '') || ' | ' || $2
       WHERE classstudent_id = $3`,
      [`${JULY_CLASS_START}T00:00:00+08:00`, REPAIR_NOTE, PHASE1_BILLING_CLASSSTUDENT_ID]
    );

    await client.query(
      `UPDATE classstudentstbl
       SET enrolled_at = $1::timestamptz,
           enrolled_by = COALESCE(enrolled_by, '') || ' | ' || $2
       WHERE classstudent_id = $3`,
      [`${JULY_CLASS_START}T00:00:00+08:00`, REPAIR_NOTE, DISPLAY_CLASSSTUDENT_ID]
    );

    await client.query(`DELETE FROM classstudentstbl WHERE classstudent_id = $1`, [
      PHASE2_PREMATURE_CLASSSTUDENT_ID,
    ]);

    await client.query('COMMIT');
    console.log('\n✅ Applied enrollment matrix alignment.');

    console.log('\nMatrix AFTER (display class 120):');
    console.table((await previewMatrix(DISPLAY_CLASS_ID)) || []);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error('Repair failed:', err.message);
  process.exit(1);
});
