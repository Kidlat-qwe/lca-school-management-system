/**
 * Elijah Mikael A. De Jesus (aquinomarielle221@gmail.com, user 275) —
 * August Month Re-enrollment should be dropped, not rejoin.
 *
 * Plan 2 · Profile 412 · Class 53 VMP_NURSERY_TThS_11:00 AM · Branch 6
 *
 * Current:
 *   P6 CS 2468 dropped — enrolled_at 2026-08-31, removed_at 2026-09-03
 *   P7 CS 2469 rejoin — enrolled_at 2026-08-31 (same day as P6)
 *   Matrix: Aug=rejoin, Sep=rejoin
 *   Cause: calendar-rejoin overlay used P7 enrolled_at month (August) and
 *   overwrote the August dropped billing cell (dropped uses mark "-").
 *
 * Target:
 *   P7 CS 2469 enrolled_at → 2026-09-02 (comeback after drop; Sep rejoin)
 *   Matrix: Aug=dropped, Sep=rejoin
 *
 * Also requires enrollmentRateMetrics: calendar rejoin must not overwrite dropped.
 *
 * Run (from backend/):
 *   node scripts/repairElijahDeJesusAugustDropped.js --production
 *   node scripts/repairElijahDeJesusAugustDropped.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

const STUDENT_ID = 275;
const STUDENT_EMAIL = 'aquinomarielle221@gmail.com';
const CLASS_ID = 53;
const BRANCH_ID = 6;
const PROFILE_ID = 412;
const PHASE6_CS_ID = 2468;
const PHASE7_CS_ID = 2469;

/** Comeback after Phase 6 drop (removed 2026-09-03). */
const PHASE7_ENROLLED_AT = '2026-09-02 12:00:00+08';

const REPAIR_NOTE =
  'Ops repair 2026-09-16 — Elijah De Jesus P7 rejoin enrolled_at → Sep 2 (August matrix = dropped)';

const isApply = process.argv.includes('--apply');

async function previewMatrix(queryFn) {
  const matrix = await loadStudentMonthEnrollmentMatrix(queryFn, {
    year: 2026,
    branchId: BRANCH_ID,
    classId: CLASS_ID,
  });
  const track = (matrix.students || []).find(
    (s) => Number(s.student_id) === STUDENT_ID && Number(s.class_id) === CLASS_ID
  );
  const cells = [];
  for (const m of matrix.months || []) {
    const c = track?.months?.[m.key];
    if (!c) continue;
    if (c.mark === '1' || c.mark === '✓' || c.mark === 'X' || c.mark === '-' || c.label) {
      cells.push({
        month: m.key,
        label: c.label,
        status: c.status,
        phase: c.phase_number ?? null,
        mark: c.mark,
      });
    }
  }
  return cells;
}

async function loadRows(client) {
  const res = await client.query(
    `SELECT classstudent_id, phase_number, program_enrollment_status,
            TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled_ymd,
            TO_CHAR(TIMEZONE('Asia/Manila', removed_at), 'YYYY-MM-DD HH24:MI') AS removed_ymd,
            removed_reason
     FROM classstudentstbl
     WHERE student_id = $1
       AND class_id = $2
       AND phase_number IN (5, 6, 7)
     ORDER BY phase_number, classstudent_id`,
    [STUDENT_ID, CLASS_ID]
  );
  return res.rows;
}

async function main() {
  console.log(
    `\nElijah De Jesus — August dropped (not rejoin)${
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
        `SELECT user_id, full_name, email
         FROM userstbl
         WHERE user_id = $1
           AND LOWER(TRIM(email)) = LOWER(TRIM($2))
           AND user_type = 'Student'`,
        [STUDENT_ID, STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student) throw new Error('Student not found');
    console.log(`Student: ${student.full_name} (${student.email})`);

    const profile = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id, class_id, is_active
         FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1
           AND student_id = $2
           AND class_id = $3`,
        [PROFILE_ID, STUDENT_ID, CLASS_ID]
      )
    ).rows[0];
    if (!profile) throw new Error(`Profile ${PROFILE_ID} not found`);

    const before = await loadRows(client);
    console.log('\nBEFORE phases 5–7:');
    console.table(before);
    console.log('\nMatrix 2026 BEFORE:');
    console.table(await previewMatrix(query));

    const p6 = before.find((r) => Number(r.classstudent_id) === PHASE6_CS_ID);
    const p7 = before.find((r) => Number(r.classstudent_id) === PHASE7_CS_ID);
    if (!p6 || Number(p6.phase_number) !== 6) {
      throw new Error(`Phase 6 CS ${PHASE6_CS_ID} missing`);
    }
    if (String(p6.program_enrollment_status) !== 'dropped') {
      throw new Error(
        `Phase 6 status is ${p6.program_enrollment_status} (expected dropped)`
      );
    }
    if (!p7 || Number(p7.phase_number) !== 7) {
      throw new Error(`Phase 7 CS ${PHASE7_CS_ID} missing`);
    }
    if (String(p7.program_enrollment_status) !== 'rejoin') {
      throw new Error(
        `Phase 7 status is ${p7.program_enrollment_status} (expected rejoin)`
      );
    }

    console.log('\nPlanned:');
    console.log(
      `  1. Keep CS ${PHASE6_CS_ID} Phase 6 dropped (${p6.enrolled_ymd} / removed ${p6.removed_ymd})`
    );
    console.log(
      `  2. CS ${PHASE7_CS_ID} Phase 7 rejoin: enrolled ${p7.enrolled_ymd} → 2026-09-02`
    );
    console.log('  3. Expected matrix: Aug=dropped, Sep=rejoin');

    const runOnClient = (text, params) => client.query(text, params);

    await client.query('BEGIN');

    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 'rejoin',
           enrolled_at = $1::timestamptz,
           removed_at = NULL,
           removed_reason = NULL,
           removed_by = NULL
       WHERE classstudent_id = $2
         AND student_id = $3
         AND class_id = $4
         AND phase_number = 7`,
      [PHASE7_ENROLLED_AT, PHASE7_CS_ID, STUDENT_ID, CLASS_ID]
    );

    console.log('\nPhases 5–7 (txn):');
    console.table(await loadRows(client));
    console.log('\nMatrix 2026 PROJECTED:');
    console.table(await previewMatrix(runOnClient));

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
