/**
 * Olivia Brie Sales (ladypipay24@gmail.com) — align Plan 2 (11:00AM Nursery) enrollment
 * statuses for Student History + Month/Phase Re-enrollment matrix.
 *
 * Target (class 53 / profile 413):
 *   Phase 3 → new
 *   Phase 4 → re_enrolled
 *   Phase 5 → re_enrolled
 *
 * Run:
 *   node backend/scripts/repairOliviaSalesPlan2EnrollmentStatuses.js --production
 *   node backend/scripts/repairOliviaSalesPlan2EnrollmentStatuses.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import {
  loadStudentMonthEnrollmentMatrix,
  loadStudentPhaseEnrollmentMatrix,
} from '../lib/enrollmentRateMetrics.js';

const STUDENT_EMAIL = 'ladypipay24@gmail.com';
const STUDENT_ID = 272;
const CLASS_ID = 53;
const BRANCH_ID = 6;
const PROFILE_ID = 413;

const REPAIR_NOTE =
  'Ops repair 2026-08-01 — Olivia Sales Plan2 enrollment: Phase3 new, Phase4–5 re_enrolled';

/** Restore Phase 3; normalize Phases 4–5. */
const PHASES = [
  {
    id: 1182,
    phase: 3,
    status: 'new',
    enrolledAt: '2026-05-05 12:00:00+08',
    clearRemoved: true,
  },
  {
    id: 1183,
    phase: 4,
    status: 're_enrolled',
    enrolledAt: '2026-06-06 12:00:00+08',
    clearRemoved: true,
  },
  {
    id: 2007,
    phase: 5,
    status: 're_enrolled',
    enrolledAt: '2026-07-04 12:00:00+08',
    clearRemoved: true,
  },
];

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
  console.log(
    `\nOlivia Sales — Plan2 enrollment statuses` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);

  if (process.env.DB_NAME !== 'psms_production') {
    console.warn(
      '⚠️ Expected psms_production (this student is not on development). Pass --production.'
    );
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const student = (
      await client.query(
        `SELECT user_id, full_name, email
         FROM userstbl
         WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))`,
        [STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student || Number(student.user_id) !== STUDENT_ID) {
      throw new Error(`Student ${STUDENT_EMAIL} (id ${STUDENT_ID}) not found`);
    }
    console.log('Student:', student.full_name, student.email, `(id ${student.user_id})`);

    const beforeCs = await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status,
              TO_CHAR(enrolled_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS enrolled,
              TO_CHAR(removed_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS removed
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2
       ORDER BY phase_number, classstudent_id`,
      [STUDENT_ID, CLASS_ID]
    );
    console.log('\nBEFORE classstudents:');
    console.table(beforeCs.rows);

    const beforeMatrix = await previewMatrices(query);
    console.log('\nBEFORE month matrix (Olivia track):');
    console.table(beforeMatrix.monthCells);
    console.log('BEFORE phase matrix (Olivia track):');
    console.table(beforeMatrix.phaseCells);

    for (const row of PHASES) {
      const existing = beforeCs.rows.find((r) => Number(r.classstudent_id) === row.id);
      if (!existing) {
        throw new Error(`Enrollment ${row.id} (phase ${row.phase}) not found`);
      }
      if (Number(existing.phase_number) !== row.phase) {
        throw new Error(
          `Enrollment ${row.id} phase ${existing.phase_number} ≠ expected ${row.phase}`
        );
      }

      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = $1,
             enrolled_at = $2::timestamptz,
             removed_at = NULL,
             removed_reason = NULL,
             removed_by = NULL,
             enrolled_by = COALESCE(enrolled_by, $3)
         WHERE classstudent_id = $4
           AND student_id = $5
           AND class_id = $6
           AND phase_number = $7`,
        [
          row.status,
          row.enrolledAt,
          REPAIR_NOTE,
          row.id,
          STUDENT_ID,
          CLASS_ID,
          row.phase,
        ]
      );
      console.log(`✅ Phase ${row.phase} (id ${row.id}) → ${row.status}`);
    }

    const afterCs = await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status,
              TO_CHAR(enrolled_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS enrolled,
              TO_CHAR(removed_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS removed
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2
       ORDER BY phase_number, classstudent_id`,
      [STUDENT_ID, CLASS_ID]
    );
    console.log('\nAFTER classstudents (in transaction):');
    console.table(afterCs.rows);

    const expected = [
      { phase: 3, status: 'new' },
      { phase: 4, status: 're_enrolled' },
      { phase: 5, status: 're_enrolled' },
    ];
    for (const exp of expected) {
      const row = afterCs.rows.find((r) => Number(r.phase_number) === exp.phase);
      if (!row || row.program_enrollment_status !== exp.status || row.removed != null) {
        throw new Error(
          `Validation failed for phase ${exp.phase}: got ${row?.program_enrollment_status} removed=${row?.removed}`
        );
      }
    }

    if (!isApply) {
      await client.query('ROLLBACK');
      console.log('\nRolled back (dry run). Re-run with --apply to commit.');
      return;
    }

    await client.query('COMMIT');
    console.log('\nCommitted.');

    const afterMatrix = await previewMatrices(query);
    console.log('\nAFTER month matrix (Olivia track):');
    console.table(afterMatrix.monthCells);
    console.log('AFTER phase matrix (Olivia track):');
    console.table(afterMatrix.phaseCells);
    console.log('\n✅ Refresh Student history → Invoices and Re-enrollment matrix.');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('\n❌ Repair failed:', err?.message || err);
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
