/**
 * Kiev Zion Z. Serrano — align installment billing class enrollment rows so the
 * month re-enrollment matrix shows May=new, June=dropped, July=inactive on the
 * VMP display class (billing lives on VMM class 110).
 *
 * Root cause:
 *   - Installment profile + invoices on class 110 (start May 4)
 *   - Phase 1 enrollment row missing on class 110
 *   - Phase 2 dropped row uses July removed_at (calendar month) instead of June billing
 *   - Auto-enroll landed on display class 120 (July start) — matrix links via cross-class rules
 *
 * Fix (--apply):
 *   - Insert phase 1 `new` on class 110 anchored to class start (May 4)
 *   - Align phase 2 dropped enrolled_at / removed_at to June billing month
 *
 * Run:
 *   node backend/scripts/repairKievZionSerranoMatrixAlignment.js
 *   node backend/scripts/repairKievZionSerranoMatrixAlignment.js --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

const STUDENT_ID = 581;
const BILLING_CLASS_ID = 110;
const DISPLAY_CLASS_ID = 120;
const PROFILE_ID = 384;
const PHASE2_CLASSSTUDENT_ID = 1656;

const REPAIR_NOTE = 'Ops repair — Kiev Zion Serrano matrix billing months aligned to installment class start';

const isApply = process.argv.includes('--apply');

async function loadClassStart(client, classId) {
  const r = await client.query(
    `SELECT start_date FROM classestbl WHERE class_id = $1`,
    [classId]
  );
  const start = r.rows[0]?.start_date;
  if (!start) throw new Error(`Class ${classId} has no start_date`);
  return start;
}

async function loadPhase1Row(client) {
  const r = await client.query(
    `SELECT classstudent_id, program_enrollment_status, enrolled_at, removed_at
     FROM classstudentstbl
     WHERE student_id = $1 AND class_id = $2 AND phase_number = 1
     ORDER BY classstudent_id DESC
     LIMIT 1`,
    [STUDENT_ID, BILLING_CLASS_ID]
  );
  return r.rows[0] || null;
}

async function loadPhase2Row(client) {
  const r = await client.query(
    `SELECT classstudent_id, program_enrollment_status, enrolled_at, removed_at, enrolled_by
     FROM classstudentstbl
     WHERE classstudent_id = $1`,
    [PHASE2_CLASSSTUDENT_ID]
  );
  return r.rows[0] || null;
}

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
        mark: c.mark,
        phase: c.phase_number,
      });
    }
  }
  return cells;
}

async function main() {
  console.log(
    `\nKiev Zion Serrano — matrix alignment repair${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );

  const client = await getClient();

  try {
    const student = (
      await client.query(
        `SELECT user_id, full_name, email FROM userstbl WHERE user_id = $1`,
        [STUDENT_ID]
      )
    ).rows[0];
    if (!student) throw new Error(`Student ${STUDENT_ID} not found`);

    console.log(`Student: ${student.full_name} (${student.email})`);
    console.log(`Billing class: ${BILLING_CLASS_ID} | Display class: ${DISPLAY_CLASS_ID} | Profile: ${PROFILE_ID}`);

    const classStart = await loadClassStart(client, BILLING_CLASS_ID);
    const phase1TargetEnrolledAt = classStart;
    const phase2TargetEnrolledAt = '2026-06-01T00:00:00+08:00';
    const phase2TargetRemovedAt = '2026-06-06T00:00:00+08:00';

    const phase1 = await loadPhase1Row(client);
    const phase2 = await loadPhase2Row(client);

    console.log('\nClass start (phase 1 target enrolled_at):', classStart);
    console.log('\nCurrent phase 1 on billing class:', phase1 || '(missing)');
    console.log('\nCurrent phase 2 dropped row:', phase2);

    console.log('\nMatrix BEFORE (display class 120):');
    console.table((await previewMatrix(DISPLAY_CLASS_ID)) || []);

    console.log('\nPlanned changes:');
    if (!phase1) {
      console.log(
        `  • INSERT phase 1 new on class ${BILLING_CLASS_ID}, enrolled_at = ${classStart}`
      );
    } else {
      console.log(
        `  • UPDATE classstudent_id ${phase1.classstudent_id}: enrolled_at → ${classStart}`
      );
    }
    console.log(
      `  • UPDATE classstudent_id ${PHASE2_CLASSSTUDENT_ID}: enrolled_at → ${phase2TargetEnrolledAt}, removed_at → ${phase2TargetRemovedAt}`
    );

    console.log('\nExpected matrix AFTER (display class 120):');
    console.table([
      { month: '2026-05', label: 'new', phase: 1 },
      { month: '2026-06', label: 'dropped', phase: 2 },
      { month: '2026-07', label: 'Inactive', phase: 3 },
    ]);

    if (!isApply) {
      console.log('\nRe-run with --apply to update enrollment rows.');
      return;
    }

    await client.query('BEGIN');

    if (!phase1) {
      await client.query(
        `INSERT INTO classstudentstbl (
           student_id, class_id, enrolled_by, phase_number, program_enrollment_status, enrolled_at
         ) VALUES ($1, $2, $3, 1, 'new', $4)`,
        [STUDENT_ID, BILLING_CLASS_ID, REPAIR_NOTE, phase1TargetEnrolledAt]
      );
    } else {
      await client.query(
        `UPDATE classstudentstbl
         SET enrolled_at = $1,
             enrolled_by = COALESCE(enrolled_by, '') || ' | ' || $2
         WHERE classstudent_id = $3`,
        [phase1TargetEnrolledAt, REPAIR_NOTE, phase1.classstudent_id]
      );
    }

    await client.query(
      `UPDATE classstudentstbl
       SET enrolled_at = $1,
           removed_at = $2,
           enrolled_by = COALESCE(enrolled_by, '') || ' | ' || $3
       WHERE classstudent_id = $4`,
      [phase2TargetEnrolledAt, phase2TargetRemovedAt, REPAIR_NOTE, PHASE2_CLASSSTUDENT_ID]
    );

    await client.query('COMMIT');
    console.log('\n✅ Applied enrollment alignment updates.');

    console.log('\nMatrix AFTER (display class 120):');
    console.table((await previewMatrix(DISPLAY_CLASS_ID)) || []);
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
