/**
 * Zein Austin Napilisan — fix enrollment statuses after Phase 1 drop.
 *
 * Student: 589 · napilisanedmar@gmail.com
 * Profile: 398 · class 162 VMP_Pre-Kindergarten_MWF 11AM · Branch VMP (6)
 *
 * Student History today:
 *   Phase 1 dropped (INV-1309 unpaid)
 *   Phase 2 Not Enrolled
 *   Phase 3 CS 1204  new     → should be rejoin (first enroll after drop)
 *   Phase 4 CS 1715  rejoin  → should be re_enrolled
 *   Phase 5 CS 2206  rejoin  → should be re_enrolled
 *
 * Month matrix today shows consecutive JUL + AUG rejoin (invalid).
 * After fix: first comeback = rejoin; later months = re-enrolled / Active.
 *
 * Does NOT change invoices, payments, dates, or Phase 1/2 rows.
 *
 * Run:
 *   node backend/scripts/repairZeinNapilisanEnrollmentStatuses.js --production
 *   node backend/scripts/repairZeinNapilisanEnrollmentStatuses.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import {
  loadStudentMonthEnrollmentMatrix,
  loadStudentPhaseEnrollmentMatrix,
} from '../lib/enrollmentRateMetrics.js';

const STUDENT_EMAIL = 'napilisanedmar@gmail.com';
const STUDENT_ID = 589;
const CLASS_ID = 162;
const BRANCH_ID = 6;
const PROFILE_ID = 398;
const CLASS_NAME = 'VMP_Pre-Kindergarten_MWF 11AM';

const REPAIR_NOTE =
  'Ops repair 2026-08-14 — Zein Napilisan Phase 3 rejoin, Phase 4–5 re_enrolled (after P1 drop)';

const PHASES = [
  {
    id: 1204,
    phase: 3,
    currentStatus: 'new',
    targetStatus: 'rejoin',
  },
  {
    id: 1715,
    phase: 4,
    currentStatus: 'rejoin',
    targetStatus: 're_enrolled',
  },
  {
    id: 2206,
    phase: 5,
    currentStatus: 'rejoin',
    targetStatus: 're_enrolled',
  },
];

const isApply = process.argv.includes('--apply');

async function loadEnrollments(client) {
  const r = await client.query(
    `SELECT cs.classstudent_id, cs.class_id, cs.phase_number,
            cs.program_enrollment_status AS status,
            TO_CHAR(TIMEZONE('Asia/Manila', cs.enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled,
            TO_CHAR(TIMEZONE('Asia/Manila', cs.removed_at), 'YYYY-MM-DD HH24:MI') AS removed
     FROM classstudentstbl cs
     WHERE cs.student_id = $1 AND cs.class_id = $2
     ORDER BY cs.phase_number, cs.classstudent_id`,
    [STUDENT_ID, CLASS_ID]
  );
  return r.rows;
}

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
    (s) => Number(s.student_id) === STUDENT_ID && Number(s.class_id) === CLASS_ID
  );
  const phaseTrack = (phaseMatrix.students || []).find(
    (s) => Number(s.student_id) === STUDENT_ID && Number(s.class_id) === CLASS_ID
  );

  const monthCells = [];
  for (const m of monthMatrix.months || []) {
    const c = monthTrack?.months?.[m.key];
    if (!c) continue;
    if (c.mark === '1' || c.mark === '✓' || c.mark === 'X' || c.status || c.label) {
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
    if (c.mark === '1' || c.mark === '✓' || c.mark === 'X' || c.status || c.label) {
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
    `\nZein Napilisan — Phase 3 rejoin / 4–5 re_enrolled` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`Note: ${REPAIR_NOTE}`);
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);

  if (process.env.DB_NAME !== 'psms_production') {
    console.warn('⚠️ Expected psms_production. Pass --production.');
  }

  const client = await getClient();
  const txQuery = (text, params) => client.query(text, params);

  try {
    await client.query('BEGIN');

    const student = (
      await client.query(
        `SELECT user_id, full_name, email FROM userstbl
         WHERE user_id = $1 AND LOWER(TRIM(email)) = LOWER(TRIM($2))`,
        [STUDENT_ID, STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student) throw new Error('Student not found');
    console.log('Student:', student.full_name, student.email, `(id ${student.user_id})`);

    const klass = (
      await client.query(
        `SELECT class_id, class_name, branch_id FROM classestbl WHERE class_id = $1`,
        [CLASS_ID]
      )
    ).rows[0];
    if (!klass || klass.class_name !== CLASS_NAME) {
      throw new Error(`Class ${CLASS_ID} name mismatch: ${klass?.class_name}`);
    }
    if (Number(klass.branch_id) !== BRANCH_ID) {
      throw new Error(`Class branch ${klass.branch_id} ≠ ${BRANCH_ID}`);
    }

    const profile = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id AS profile_id, student_id, class_id,
                is_active, generated_count, phase_start
         FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];
    if (!profile || Number(profile.student_id) !== STUDENT_ID) {
      throw new Error(`Profile ${PROFILE_ID} not found`);
    }
    if (Number(profile.class_id) !== CLASS_ID) {
      throw new Error(`Profile class_id ${profile.class_id} ≠ ${CLASS_ID}`);
    }
    console.log('Profile:', profile);

    const beforeCs = await loadEnrollments(client);
    console.log('\nBEFORE enrollments (class 162):');
    console.table(beforeCs);

    console.log('\nBEFORE month matrix:');
    const beforeMatrix = await previewMatrices(txQuery);
    console.table(
      beforeMatrix.monthCells.length ? beforeMatrix.monthCells : [{ note: '(none)' }]
    );
    console.log('BEFORE phase matrix:');
    console.table(
      beforeMatrix.phaseCells.length ? beforeMatrix.phaseCells : [{ note: '(none)' }]
    );

    for (const row of PHASES) {
      const existing = beforeCs.find((r) => Number(r.classstudent_id) === row.id);
      if (!existing) {
        throw new Error(`Enrollment ${row.id} (phase ${row.phase}) not found`);
      }
      if (Number(existing.phase_number) !== row.phase) {
        throw new Error(
          `CS ${row.id} phase ${existing.phase_number} ≠ expected ${row.phase}`
        );
      }
      const statusOk =
        String(existing.status) === row.currentStatus ||
        String(existing.status) === row.targetStatus;
      if (!statusOk) {
        throw new Error(
          `CS ${row.id} status ${existing.status} ≠ ${row.currentStatus} or ${row.targetStatus}`
        );
      }

      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = $1,
             removed_at = NULL,
             removed_reason = NULL,
             removed_by = NULL
         WHERE classstudent_id = $2
           AND student_id = $3
           AND class_id = $4
           AND phase_number = $5`,
        [row.targetStatus, row.id, STUDENT_ID, CLASS_ID, row.phase]
      );
      console.log(
        `✅ Phase ${row.phase} CS ${row.id}: ${row.currentStatus} → ${row.targetStatus}`
      );
    }

    const afterCs = await loadEnrollments(client);
    console.log('\nAFTER enrollments (in transaction):');
    console.table(afterCs);

    const expected = [
      { phase: 1, status: 'dropped' },
      { phase: 3, status: 'rejoin' },
      { phase: 4, status: 're_enrolled' },
      { phase: 5, status: 're_enrolled' },
    ];
    for (const exp of expected) {
      const row = afterCs.find((r) => Number(r.phase_number) === exp.phase);
      if (!row || String(row.status) !== exp.status) {
        throw new Error(
          `Validation failed for phase ${exp.phase}: status=${row?.status}`
        );
      }
      if (exp.status !== 'dropped' && row.removed != null) {
        throw new Error(`Phase ${exp.phase} unexpectedly removed`);
      }
    }

    const activeRejoins = afterCs.filter(
      (r) => String(r.status) === 'rejoin' && r.removed == null
    );
    if (activeRejoins.length !== 1 || Number(activeRejoins[0].phase_number) !== 3) {
      throw new Error(
        `Expected exactly one active rejoin at Phase 3; got ${JSON.stringify(activeRejoins)}`
      );
    }

    console.log('\nAFTER month matrix (in transaction):');
    const afterMatrix = await previewMatrices(txQuery);
    console.table(
      afterMatrix.monthCells.length ? afterMatrix.monthCells : [{ note: '(none)' }]
    );
    console.log('AFTER phase matrix (in transaction):');
    console.table(
      afterMatrix.phaseCells.length ? afterMatrix.phaseCells : [{ note: '(none)' }]
    );

    console.log('\nExpected UI:');
    console.log('  Invoices: Phase 1 dropped · Phase 2 Not Enrolled');
    console.log('  Invoices: Phase 3 rejoin · Phase 4 re enrolled · Phase 5 re enrolled');
    console.log('  Month matrix: one rejoin after drop; later months re-enrolled / Active');

    if (!isApply) {
      await client.query('ROLLBACK');
      console.log('\nDry run only — rolled back. Re-run with --apply to commit.');
      return;
    }

    await client.query('COMMIT');
    console.log('\nCommitted. Refresh Student History → Invoices and Month Re-enrollment.');
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
