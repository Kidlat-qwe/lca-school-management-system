/**
 * Ryleigh Maeve Sabalsa (sabalsamelodie@gmail.com, user 229) —
 * Align Month Re-enrollment matrix for Nursery Plans 2–3 + Pre-K upsell.
 *
 * Production · Branch 1 (Vista Mall Malolos)
 *
 * Nursery class 71 VMM_Nursery_TThS 9:30 AM (2025-08-05 → 2026-05-21):
 *   Profile 252 Plan 2 — Per Phase (5) · 1 phase · INV-494 (due 2025-11-24)
 *   Profile 293 Plan 3 — Per Phase (9) · 2 phases · INV-670 / INV-976
 *
 * Pre-K class 171 VMM_Pre-Kinder_TThS 9:30 (start 2026-09-03):
 *   Profile 520 Installment Plan 3 · Phase 1 upsell · INV-2456
 *
 * Desired month matrix (phase-offset from Plan 2 Phase 5):
 *   2025-11  completed  (Plan 2 Phase 5 — 1-phase per-phase)
 *   2026-03  new        (Plan 3 Phase 9 — after completed, stays "new")
 *   2026-04  completed  (Plan 3 Phase 10)
 *   2026-09  upsell     (Pre-K Phase 1)
 *
 * Also requires enrollmentRateMetrics display rule: DB status "new" after a
 * prior completed cell on the same track keeps label "new" (not re-enrolled).
 *
 * Run (from backend/):
 *   node scripts/repairRyleighSabalsaMatrixEnrollment.js --production
 *   node scripts/repairRyleighSabalsaMatrixEnrollment.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

const STUDENT_ID = 229;
const STUDENT_EMAIL = 'sabalsamelodie@gmail.com';
const BRANCH_ID = 1;

const NURSERY_CLASS_ID = 71;
const PREK_CLASS_ID = 171;

const PLAN2_PROFILE_ID = 252;
const PLAN3_PROFILE_ID = 293;
const PREK_PROFILE_ID = 520;

/** Include Plan 2 Phase 5 on the month matrix (was hidden by phase_start=9). */
const PLAN3_PROFILE_PHASE_START = 5;

/** Plan 2 Phase 5 — completed November 2025. */
const PLAN2_PHASE5 = {
  classstudent_id: 486,
  phase: 5,
  status: 'completed',
  enrolled_at: '2025-11-24 12:00:00+08',
};

/** Plan 3 Phase 9 — status new (matrix lands March via offset from Nov). */
const PLAN3_PHASE9 = {
  classstudent_id: 536,
  phase: 9,
  status: 'new',
  enrolled_at: '2026-04-05 12:00:00+08',
};

/** Plan 3 Phase 10 — completed (matrix lands April via offset). */
const PLAN3_PHASE10 = {
  classstudent_id: 911,
  phase: 10,
  status: 'completed',
  enrolled_at: '2026-05-05 12:00:00+08',
};

/** Pre-K Phase 1 — upsell September 2026. */
const PREK_PHASE1 = {
  classstudent_id: 2271,
  phase: 1,
  status: 'upsell',
  enrolled_at: '2026-09-03 12:00:00+08',
};

const REPAIR_NOTE =
  'Ops repair 2026-09-16 — Ryleigh: Plan2 Nov completed; Plan3 Mar new/Apr completed; Pre-K Sep upsell';

const isApply = process.argv.includes('--apply');

async function previewMatrix(queryFn, year) {
  const matrix = await loadStudentMonthEnrollmentMatrix(queryFn, {
    year,
    branchId: BRANCH_ID,
  });
  const tracks = (matrix.students || []).filter(
    (s) => Number(s.student_id) === STUDENT_ID
  );
  const out = [];
  for (const track of tracks) {
    for (const m of matrix.months || []) {
      const c = track.months?.[m.key];
      if (!c) continue;
      if (c.mark === '1' || c.mark === '✓' || c.mark === 'X' || c.label) {
        out.push({
          class_id: track.class_id,
          month: m.key,
          label: c.label,
          status: c.status,
          phase: c.phase_number ?? null,
          mark: c.mark,
          single_phase: Boolean(c.single_phase_completed),
        });
      }
    }
  }
  return out;
}

async function loadClassstudents(client, classId) {
  const res = await client.query(
    `SELECT classstudent_id, phase_number, program_enrollment_status,
            TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled_ymd,
            removed_at IS NOT NULL AS removed
     FROM classstudentstbl
     WHERE student_id = $1 AND class_id = $2
     ORDER BY COALESCE(phase_number, 0), classstudent_id`,
    [STUDENT_ID, classId]
  );
  return res.rows;
}

async function main() {
  console.log(
    `\nRyleigh Sabalsa — matrix enrollment align${
      isApply ? ' (APPLY)' : ' (DRY RUN)'
    }\n`
  );
  console.log(`Note: ${REPAIR_NOTE}`);
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);
  if (process.env.DB_NAME !== 'psms_production') {
    console.warn('⚠️ Expected psms_production. Pass --production.');
  }

  const client = await getClient();
  try {
    const student = (
      await client.query(
        `SELECT user_id, full_name, email, branch_id
         FROM userstbl
         WHERE user_id = $1
           AND LOWER(TRIM(email)) = LOWER(TRIM($2))
           AND user_type = 'Student'`,
        [STUDENT_ID, STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student) throw new Error('Student not found');
    console.log(`Student: ${student.full_name} (${student.email}) branch=${student.branch_id}`);

    const profiles = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id AS profile_id, class_id, phase_start,
                total_phases, generated_count, is_active
         FROM installmentinvoiceprofilestbl
         WHERE student_id = $1
           AND installmentinvoiceprofiles_id = ANY($2::int[])
         ORDER BY installmentinvoiceprofiles_id`,
        [STUDENT_ID, [PLAN2_PROFILE_ID, PLAN3_PROFILE_ID, PREK_PROFILE_ID]]
      )
    ).rows;
    console.log('\nProfiles:');
    console.table(profiles);

    const plan3 = profiles.find((p) => Number(p.profile_id) === PLAN3_PROFILE_ID);
    if (!plan3 || Number(plan3.class_id) !== NURSERY_CLASS_ID) {
      throw new Error(`Plan 3 profile ${PLAN3_PROFILE_ID} missing / class mismatch`);
    }

    const nurseryBefore = await loadClassstudents(client, NURSERY_CLASS_ID);
    const prekBefore = await loadClassstudents(client, PREK_CLASS_ID);
    console.log('\nBEFORE Nursery classstudents:');
    console.table(nurseryBefore);
    console.log('\nBEFORE Pre-K classstudents:');
    console.table(prekBefore);

    console.log('\nMatrix 2025 BEFORE:');
    console.table(await previewMatrix(query, 2025));
    console.log('\nMatrix 2026 BEFORE:');
    console.table(await previewMatrix(query, 2026));

    const targets = [PLAN2_PHASE5, PLAN3_PHASE9, PLAN3_PHASE10];
    for (const t of targets) {
      const row = nurseryBefore.find((r) => Number(r.classstudent_id) === t.classstudent_id);
      if (!row || Number(row.phase_number) !== t.phase) {
        throw new Error(
          `Nursery CS ${t.classstudent_id} phase ${t.phase} missing/mismatch`
        );
      }
    }
    const prekRow = prekBefore.find(
      (r) => Number(r.classstudent_id) === PREK_PHASE1.classstudent_id
    );
    if (!prekRow || Number(prekRow.phase_number) !== 1) {
      throw new Error(`Pre-K CS ${PREK_PHASE1.classstudent_id} Phase 1 missing`);
    }
    if (String(prekRow.program_enrollment_status).toLowerCase() !== 'upsell') {
      throw new Error(
        `Pre-K Phase 1 status is ${prekRow.program_enrollment_status} (expected upsell)`
      );
    }

    console.log('\nPlanned:');
    console.log(
      `  1. Profile ${PLAN3_PROFILE_ID}: phase_start ${plan3.phase_start} → ${PLAN3_PROFILE_PHASE_START}`
    );
    console.log('  2. CS 486 Phase 5 → completed / 2025-11-24 (matrix Nov completed)');
    console.log('  3. CS 536 Phase 9 → new (matrix Mar new after completed)');
    console.log('  4. CS 911 Phase 10 → completed (matrix Apr completed)');
    console.log('  5. CS 2271 Pre-K Phase 1 → upsell / 2026-09-03');

    const runOnClient = (text, params) => client.query(text, params);

    await client.query('BEGIN');

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET phase_start = $1
       WHERE installmentinvoiceprofiles_id = $2
         AND student_id = $3
         AND class_id = $4`,
      [PLAN3_PROFILE_PHASE_START, PLAN3_PROFILE_ID, STUDENT_ID, NURSERY_CLASS_ID]
    );

    for (const t of targets) {
      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = $1,
             enrolled_at = $2::timestamptz,
             removed_at = NULL,
             removed_reason = NULL,
             removed_by = NULL
         WHERE classstudent_id = $3
           AND student_id = $4
           AND class_id = $5
           AND phase_number = $6`,
        [
          t.status,
          t.enrolled_at,
          t.classstudent_id,
          STUDENT_ID,
          NURSERY_CLASS_ID,
          t.phase,
        ]
      );
    }

    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = $1,
           enrolled_at = $2::timestamptz,
           removed_at = NULL,
           removed_reason = NULL,
           removed_by = NULL
       WHERE classstudent_id = $3
         AND student_id = $4
         AND class_id = $5
         AND phase_number = $6`,
      [
        PREK_PHASE1.status,
        PREK_PHASE1.enrolled_at,
        PREK_PHASE1.classstudent_id,
        STUDENT_ID,
        PREK_CLASS_ID,
        PREK_PHASE1.phase,
      ]
    );

    console.log('\nNursery classstudents (txn):');
    console.table(await loadClassstudents(client, NURSERY_CLASS_ID));
    console.log('\nPre-K classstudents (txn):');
    console.table(await loadClassstudents(client, PREK_CLASS_ID));

    console.log('\nMatrix 2025 PROJECTED:');
    console.table(await previewMatrix(runOnClient, 2025));
    console.log('\nMatrix 2026 PROJECTED:');
    console.table(await previewMatrix(runOnClient, 2026));

    if (!isApply) {
      await client.query('ROLLBACK');
      console.log('\nDry run only — transaction rolled back. Re-run with --apply to commit.');
      return;
    }

    await client.query('COMMIT');
    console.log('\n✅ Applied.');
    console.log(`(${REPAIR_NOTE})`);
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
    console.error('\nFailed:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
