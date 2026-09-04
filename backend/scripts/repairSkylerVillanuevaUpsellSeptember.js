/**
 * Skyler Dawson Legerin Villanueva (shannenlegerin@gmail.com, user 254) —
 * move Pre-K upsell month from August → September on Month Re-enrollment.
 *
 * Production · Nursery class 79 (completed Apr) · Pre-K class 161
 *   NC_Pre-Kindergarten_TTHS 4PM · start 2026-09-03 · profile 526
 *
 * Cause: Phase 1–6 enrolled_at = 2026-08-31 (advance pay) → matrix first
 * billing month = August upsell. Class starts September, so upsell should be Sep.
 *
 * Desired:
 *   CS 2450 Phase 1: keep status upsell; enrolled_at → 2026-09-03
 *     (Month Re-enrollment: September = upsell)
 *   CS 2451–2455 Phases 2–6: keep re_enrolled; shift enrolled_at into
 *     Oct / Nov / Dec / Jan / Feb so consecutive months stay re-enrolled
 *     after the September upsell cell.
 *
 * Run (from backend/):
 *   node scripts/repairSkylerVillanuevaUpsellSeptember.js --production
 *   node scripts/repairSkylerVillanuevaUpsellSeptember.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const STUDENT_ID = 254;
const STUDENT_EMAIL = 'shannenlegerin@gmail.com';
const PREK_CLASS_ID = 161;
const PROFILE_ID = 526;

/** Phase 1 upsell on class start date (September). */
const PHASE1_CS_ID = 2450;
const PHASE1_ENROLLED_AT = '2026-09-03 12:00:00';

/**
 * Later Pre-K phases: keep re_enrolled; place enrolled_at in the month that
 * should show on the matrix after Sep upsell (Oct…Feb).
 */
const LATER_PHASES = [
  { classstudent_id: 2451, phase: 2, status: 're_enrolled', enrolled_at: '2026-10-05 12:00:00' },
  { classstudent_id: 2452, phase: 3, status: 're_enrolled', enrolled_at: '2026-11-05 12:00:00' },
  { classstudent_id: 2453, phase: 4, status: 're_enrolled', enrolled_at: '2026-12-05 12:00:00' },
  { classstudent_id: 2454, phase: 5, status: 're_enrolled', enrolled_at: '2027-01-05 12:00:00' },
  { classstudent_id: 2455, phase: 6, status: 're_enrolled', enrolled_at: '2027-02-05 12:00:00' },
];

const REPAIR_NOTE =
  'Ops — Skyler Villanueva: Pre-K Phase 1 upsell enrolled_at → Sep 3 (matrix upsell in September)';

const isApply = process.argv.includes('--apply');

async function loadRows(client) {
  const res = await client.query(
    `SELECT classstudent_id, phase_number, program_enrollment_status,
            TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled_ymd,
            removed_at
     FROM classstudentstbl
     WHERE student_id = $1
       AND class_id = $2
     ORDER BY COALESCE(phase_number, 0), classstudent_id`,
    [STUDENT_ID, PREK_CLASS_ID]
  );
  return res.rows;
}

async function main() {
  console.log(
    `\nSkyler Villanueva — upsell month → September${
      isApply ? ' (APPLY)' : ' (DRY RUN)'
    }\n`
  );
  console.log(`Note: ${REPAIR_NOTE}\n`);

  const client = await getClient();
  try {
    const user = (
      await client.query(
        `SELECT user_id, full_name, email FROM userstbl WHERE user_id = $1`,
        [STUDENT_ID]
      )
    ).rows[0];
    if (!user) throw new Error(`Student ${STUDENT_ID} not found`);
    if (user.email?.toLowerCase() !== STUDENT_EMAIL.toLowerCase()) {
      throw new Error(`Email mismatch (expected ${STUDENT_EMAIL})`);
    }

    const klass = (
      await client.query(
        `SELECT class_id, class_name,
                TO_CHAR(TIMEZONE('Asia/Manila', start_date), 'YYYY-MM-DD') AS class_start
         FROM classestbl WHERE class_id = $1`,
        [PREK_CLASS_ID]
      )
    ).rows[0];
    if (!klass) throw new Error(`Class ${PREK_CLASS_ID} not found`);
    if (klass.class_start !== '2026-09-03') {
      console.warn(
        `Warning: class start is ${klass.class_start} (expected 2026-09-03)`
      );
    }

    const profile = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id, class_id, is_active, phase_start
         FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1
           AND student_id = $2`,
        [PROFILE_ID, STUDENT_ID]
      )
    ).rows[0];
    if (!profile || Number(profile.class_id) !== PREK_CLASS_ID) {
      throw new Error(`Profile ${PROFILE_ID} / class mismatch`);
    }

    const before = await loadRows(client);
    console.log('Student:', user);
    console.log('Class:', klass);
    console.log('Profile:', profile);
    console.log('\nBEFORE Pre-K classstudent rows:');
    console.table(before);

    const p1 = before.find((r) => Number(r.classstudent_id) === PHASE1_CS_ID);
    if (!p1 || Number(p1.phase_number) !== 1) {
      throw new Error(`Phase 1 CS ${PHASE1_CS_ID} missing/mismatch`);
    }
    if (String(p1.program_enrollment_status).toLowerCase() !== 'upsell') {
      throw new Error(
        `Phase 1 status is ${p1.program_enrollment_status} (expected upsell) — aborting`
      );
    }

    for (const t of LATER_PHASES) {
      const row = before.find((r) => Number(r.classstudent_id) === t.classstudent_id);
      if (!row || Number(row.phase_number) !== t.phase) {
        throw new Error(`Phase ${t.phase} CS ${t.classstudent_id} missing/mismatch`);
      }
      if (String(row.program_enrollment_status).toLowerCase() !== 're_enrolled') {
        throw new Error(
          `Phase ${t.phase} status is ${row.program_enrollment_status} (expected re_enrolled)`
        );
      }
    }

    console.log('\nPlanned:');
    console.log(
      `  1. CS ${PHASE1_CS_ID} Phase 1 upsell: enrolled ${p1.enrolled_ymd} → 2026-09-03 (Sep matrix = upsell)`
    );
    for (const t of LATER_PHASES) {
      const row = before.find((r) => Number(r.classstudent_id) === t.classstudent_id);
      console.log(
        `  ${t.phase}. CS ${t.classstudent_id} Phase ${t.phase} re_enrolled: ` +
          `${row.enrolled_ymd} → ${t.enrolled_at.slice(0, 10)}`
      );
    }

    if (!isApply) {
      console.log('\nDry run only. Re-run with --apply to commit.');
      return;
    }

    await client.query('BEGIN');

    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 'upsell',
           enrolled_at = TIMEZONE('Asia/Manila', $1::timestamp),
           removed_at = NULL,
           removed_reason = NULL,
           removed_by = NULL
       WHERE classstudent_id = $2
         AND student_id = $3
         AND class_id = $4
         AND phase_number = 1`,
      [PHASE1_ENROLLED_AT, PHASE1_CS_ID, STUDENT_ID, PREK_CLASS_ID]
    );

    for (const t of LATER_PHASES) {
      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = $1,
             enrolled_at = TIMEZONE('Asia/Manila', $2::timestamp),
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
          PREK_CLASS_ID,
          t.phase,
        ]
      );
    }

    await client.query('COMMIT');
    console.log('\n✅ Applied.');
    console.log(`(${REPAIR_NOTE})`);

    const after = await loadRows(client);
    console.log('\nAFTER Pre-K classstudent rows:');
    console.table(after);
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
