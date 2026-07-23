/**
 * Repair Juan Miguel Benitez (user 137) Playgroup class 57 / profile 93 statuses.
 *
 * Target:
 *   Phase 2 / Feb  → new
 *   Phase 3 / Mar  → re-enrolled
 *   Phase 4 / Apr  → re-enrolled
 *   Phase 5 / May  → re-enrolled
 *   Phase 6 / Jun  → dropped; next month Inactive
 *
 * Usage:
 *   node scripts/repairJuanBenitezPlaygroupStatuses.js
 *   node scripts/repairJuanBenitezPlaygroupStatuses.js --apply
 */
import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import {
  loadStudentMonthEnrollmentMatrix,
  loadStudentPhaseEnrollmentMatrix,
} from '../lib/enrollmentRateMetrics.js';

const STUDENT_ID = 137;
const CLASS_ID = 57;
const BRANCH_ID = 5;
const PROFILE_ID = 93;

const PHASES = [
  { id: 222, phase: 2, status: 'new', enrolledAt: '2026-02-02 12:00:00+08' },
  { id: 230, phase: 3, status: 're_enrolled', enrolledAt: '2026-03-04 12:00:00+08' },
  { id: 742, phase: 4, status: 're_enrolled', enrolledAt: '2026-04-05 12:00:00+08' },
  { id: 743, phase: 5, status: 're_enrolled', enrolledAt: '2026-05-05 12:00:00+08' },
];

const DROP_PHASE = 6;
const DROP_AT = '2026-06-01 12:00:00+08';
const DROP_ENROLLED_AT = '2026-06-01 12:00:00+08';
const DROP_REASON =
  'Ops repair — align Plan statuses (Phase 2 new, Phases 3–5 re-enrolled, drop at Phase 6)';

const isApply = process.argv.includes('--apply');

async function previewMatrices(queryFn) {
  const [monthMatrix, phaseMatrix] = await Promise.all([
    loadStudentMonthEnrollmentMatrix(queryFn, {
      year: 2026,
      branchId: BRANCH_ID,
      classId: CLASS_ID,
    }),
    loadStudentPhaseEnrollmentMatrix(queryFn, {
      branchId: BRANCH_ID,
      classId: CLASS_ID,
      maxPhase: 10,
    }),
  ]);

  const monthTrack = (monthMatrix.students || []).find(
    (s) => s.student_id === STUDENT_ID && s.class_id === CLASS_ID
  );
  const phaseTrack = (phaseMatrix.students || []).find(
    (s) => s.student_id === STUDENT_ID && s.class_id === CLASS_ID
  );

  const monthCells = [];
  for (const m of monthMatrix.months || []) {
    const c = monthTrack?.months?.[m.key];
    if (!c) continue;
    if (c.mark === '1' || c.status === 'active' || c.status === 'inactive' || c.label) {
      monthCells.push({
        month: m.key,
        label: c.label,
        status: c.status,
        phase: c.phase_number,
        mark: c.mark,
      });
    }
  }

  const phaseCells = [];
  for (const p of phaseMatrix.phases || []) {
    const c = phaseTrack?.phases?.[p.key];
    if (!c) continue;
    if (c.mark === '1' || c.status === 'active' || c.status === 'inactive' || c.label) {
      phaseCells.push({
        phase: p.key,
        label: c.label,
        status: c.status,
        mark: c.mark,
      });
    }
  }

  return { monthCells, phaseCells };
}

async function main() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const student = await client.query(
      `SELECT user_id, full_name, email FROM userstbl WHERE user_id = $1`,
      [STUDENT_ID]
    );
    if (!student.rows[0]) throw new Error('Student not found');

    const beforeCs = await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status,
              TO_CHAR(enrolled_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS enrolled,
              TO_CHAR(removed_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS removed
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2
       ORDER BY phase_number, classstudent_id`,
      [STUDENT_ID, CLASS_ID]
    );

    const profile = await client.query(
      `SELECT installmentinvoiceprofiles_id, is_active, generated_count, phase_start, total_phases
       FROM installmentinvoiceprofilestbl
       WHERE installmentinvoiceprofiles_id = $1`,
      [PROFILE_ID]
    );
    if (!profile.rows[0]) throw new Error(`Profile ${PROFILE_ID} not found`);

    console.log('============================================================');
    console.log(isApply ? 'APPLY' : 'DRY RUN — no data will change');
    console.log('============================================================');
    console.log(
      `Student: ${student.rows[0].full_name} <${student.rows[0].email}> (user_id=${STUDENT_ID})`
    );
    console.log(`Class ${CLASS_ID} | Profile ${PROFILE_ID}`);
    console.log('\nBEFORE classstudents:');
    console.table(beforeCs.rows);
    console.log('BEFORE profile:', profile.rows[0]);

    const beforeMatrix = await previewMatrices(query);
    console.log('\nBEFORE month matrix:');
    console.table(beforeMatrix.monthCells);
    console.log('BEFORE phase matrix:');
    console.table(beforeMatrix.phaseCells);

    for (const row of PHASES) {
      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = $1,
             enrolled_at = $2::timestamptz,
             removed_at = $3::timestamptz,
             removed_reason = $4,
             removed_by = NULL,
             enrolled_by = COALESCE(enrolled_by, 'System (Auto-enrolled via installment payment)')
         WHERE classstudent_id = $5
           AND student_id = $6
           AND class_id = $7`,
        [
          row.status,
          row.enrolledAt,
          DROP_AT,
          DROP_REASON,
          row.id,
          STUDENT_ID,
          CLASS_ID,
        ]
      );
    }

    const existingDrop = await client.query(
      `SELECT classstudent_id FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2 AND phase_number = $3
       ORDER BY classstudent_id DESC LIMIT 1`,
      [STUDENT_ID, CLASS_ID, DROP_PHASE]
    );

    if (existingDrop.rows[0]) {
      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = 'dropped',
             enrolled_at = $1::timestamptz,
             removed_at = $2::timestamptz,
             removed_reason = $3,
             removed_by = NULL,
             enrolled_by = 'System (Drop marker)'
         WHERE classstudent_id = $4`,
        [DROP_ENROLLED_AT, DROP_AT, DROP_REASON, existingDrop.rows[0].classstudent_id]
      );
    } else {
      await client.query(
        `INSERT INTO classstudentstbl
           (student_id, class_id, enrolled_by, phase_number,
            program_enrollment_status, enrolled_at, removed_at, removed_reason, removed_by)
         VALUES ($1, $2, 'System (Drop marker)', $3, 'dropped',
                 $4::timestamptz, $5::timestamptz, $6, NULL)`,
        [STUDENT_ID, CLASS_ID, DROP_PHASE, DROP_ENROLLED_AT, DROP_AT, DROP_REASON]
      );
    }

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET is_active = false,
           generated_count = GREATEST(COALESCE(generated_count, 0), 4)
       WHERE installmentinvoiceprofiles_id = $1`,
      [PROFILE_ID]
    );

    const afterCs = await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status,
              TO_CHAR(enrolled_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS enrolled,
              TO_CHAR(removed_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS removed
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2
       ORDER BY phase_number, classstudent_id`,
      [STUDENT_ID, CLASS_ID]
    );
    const afterProfile = await client.query(
      `SELECT installmentinvoiceprofiles_id, is_active, generated_count
       FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`,
      [PROFILE_ID]
    );

    console.log('\nAFTER classstudents (in transaction):');
    console.table(afterCs.rows);
    console.log('AFTER profile:', afterProfile.rows[0]);

    if (!isApply) {
      await client.query('ROLLBACK');
      console.log('\nRolled back (dry run). Re-run with --apply to commit.');
      process.exit(0);
    }

    await client.query('COMMIT');
    console.log('\nCommitted.');

    const afterMatrix = await previewMatrices(query);
    console.log('\nAFTER month matrix:');
    console.table(afterMatrix.monthCells);
    console.log('AFTER phase matrix:');
    console.table(afterMatrix.phaseCells);
    console.log('\nRefresh Student history → Invoices and Month Re-enrollment matrix.');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('Repair failed:', err?.message || err);
    process.exit(1);
  } finally {
    client.release();
    process.exit(0);
  }
}

main();
