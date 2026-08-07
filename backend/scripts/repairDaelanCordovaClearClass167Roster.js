/**
 * Daelan Alaistair Shun Cordova (gwenthampal14@gmail.com, user 673)
 * — remove leftover class 167 roster rows so he can appear in Enroll search again.
 *
 * Why: Classes enroll modal hides anyone returned by /students/class/:id, including
 * dropped history. cs 1956 is dropped on class 167 and blocks re-enroll in the UI.
 *
 * Scope (--apply):
 *   1. DELETE classstudent rows for student 673 on class 167 only
 *   2. Delete/deactivate any leftover installment profile on class 167
 *   3. Cancel any reservation on class 167
 *   Does NOT touch class 121 / cs 1955 / profile 498
 *
 * After apply: open class 167 (start 2026-08-03) → Enroll → search "daelan".
 * Class 121 (start 2026-07-01) still shows him as enrolled (correct).
 *
 * Run:
 *   node backend/scripts/repairDaelanCordovaClearClass167Roster.js --production
 *   node backend/scripts/repairDaelanCordovaClearClass167Roster.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const STUDENT_ID = 673;
const STUDENT_EMAIL = 'gwenthampal14@gmail.com';
const KEEP_CLASS_ID = 121;
const CLEAR_CLASS_ID = 167;
const KEEP_CLASSSTUDENT_ID = 1955;
const CLEAR_CLASSSTUDENT_ID = 1956;
const KEEP_PROFILE_ID = 498;

const isApply = process.argv.includes('--apply');

async function loadClassStudents(client, studentId, classIds) {
  const r = await client.query(
    `SELECT cs.classstudent_id, cs.class_id, c.class_name,
            TO_CHAR(c.start_date, 'YYYY-MM-DD') AS class_start,
            cs.phase_number, cs.program_enrollment_status,
            TO_CHAR(cs.enrolled_at, 'YYYY-MM-DD HH24:MI') AS enrolled,
            TO_CHAR(cs.removed_at, 'YYYY-MM-DD HH24:MI') AS removed
     FROM classstudentstbl cs
     JOIN classestbl c ON c.class_id = cs.class_id
     WHERE cs.student_id = $1
       AND cs.class_id = ANY($2::int[])
     ORDER BY cs.class_id, cs.phase_number, cs.classstudent_id`,
    [studentId, classIds]
  );
  return r.rows;
}

async function loadProfiles(client, studentId, classIds) {
  const r = await client.query(
    `SELECT installmentinvoiceprofiles_id AS profile_id, class_id, is_active,
            generated_count, phase_start
     FROM installmentinvoiceprofilestbl
     WHERE student_id = $1
       AND class_id = ANY($2::int[])
     ORDER BY installmentinvoiceprofiles_id`,
    [studentId, classIds]
  );
  return r.rows;
}

async function loadReservations(client, studentId, classIds) {
  const r = await client.query(
    `SELECT reserved_id, class_id, status, phase_number
     FROM reservedstudentstbl
     WHERE student_id = $1
       AND class_id = ANY($2::int[])
     ORDER BY reserved_id`,
    [studentId, classIds]
  );
  return r.rows;
}

async function main() {
  console.log(
    `\nDaelan Cordova — clear class ${CLEAR_CLASS_ID} roster leftovers` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);

  if (process.env.DB_NAME !== 'psms_production') {
    console.warn('⚠️ Expected psms_production. Pass --production.');
  }

  const client = await getClient();
  try {
    const student = (
      await client.query(
        `SELECT user_id, full_name, email, branch_id, level_tag
         FROM userstbl
         WHERE user_id = $1 AND LOWER(TRIM(email)) = LOWER(TRIM($2))`,
        [STUDENT_ID, STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student) {
      throw new Error(`Student ${STUDENT_ID} / ${STUDENT_EMAIL} not found`);
    }
    console.log('Student:', student.full_name, student.email, `(id ${student.user_id})`);

    const keepClass = (
      await client.query(
        `SELECT class_id, class_name, TO_CHAR(start_date, 'YYYY-MM-DD') AS start_ymd, branch_id
         FROM classestbl WHERE class_id = $1`,
        [KEEP_CLASS_ID]
      )
    ).rows[0];
    const clearClass = (
      await client.query(
        `SELECT class_id, class_name, TO_CHAR(start_date, 'YYYY-MM-DD') AS start_ymd, branch_id
         FROM classestbl WHERE class_id = $1`,
        [CLEAR_CLASS_ID]
      )
    ).rows[0];
    if (!keepClass || !clearClass) {
      throw new Error('Expected class 121 and/or 167 missing');
    }
    if (Number(keepClass.branch_id) !== 3 || Number(clearClass.branch_id) !== 3) {
      throw new Error('Safety abort: expected both classes on Cavite (branch 3)');
    }

    console.log(
      `KEEP class ${keepClass.class_id} ${keepClass.class_name} start ${keepClass.start_ymd}`
    );
    console.log(
      `CLEAR class ${clearClass.class_id} ${clearClass.class_name} start ${clearClass.start_ymd}`
    );

    const beforeCs = await loadClassStudents(client, STUDENT_ID, [KEEP_CLASS_ID, CLEAR_CLASS_ID]);
    const beforeProfiles = await loadProfiles(client, STUDENT_ID, [KEEP_CLASS_ID, CLEAR_CLASS_ID]);
    const beforeReservations = await loadReservations(client, STUDENT_ID, [
      KEEP_CLASS_ID,
      CLEAR_CLASS_ID,
    ]);

    console.log('\nClassstudent BEFORE:');
    console.table(beforeCs);
    console.log('Profiles BEFORE:');
    console.table(beforeProfiles);
    console.log('Reservations BEFORE:');
    console.table(beforeReservations);

    const keepRow = beforeCs.find((r) => Number(r.classstudent_id) === KEEP_CLASSSTUDENT_ID);
    if (!keepRow || Number(keepRow.class_id) !== KEEP_CLASS_ID) {
      throw new Error(`Safety abort: keep classstudent ${KEEP_CLASSSTUDENT_ID} on class 121 missing`);
    }
    if (keepRow.removed || String(keepRow.program_enrollment_status).toLowerCase() === 'dropped') {
      throw new Error('Safety abort: class 121 enrollment is not active');
    }

    const clearRows = beforeCs.filter((r) => Number(r.class_id) === CLEAR_CLASS_ID);
    if (clearRows.length === 0) {
      console.log('\nNo class 167 roster rows left — nothing to do.');
      return;
    }

    const unexpectedClear = clearRows.filter(
      (r) => Number(r.classstudent_id) !== CLEAR_CLASSSTUDENT_ID
    );
    if (unexpectedClear.length) {
      throw new Error(
        `Unexpected class 167 classstudent ids: ${unexpectedClear
          .map((r) => r.classstudent_id)
          .join(', ')}`
      );
    }

    const keepProfile = beforeProfiles.find((p) => Number(p.profile_id) === KEEP_PROFILE_ID);
    if (!keepProfile || Number(keepProfile.class_id) !== KEEP_CLASS_ID) {
      throw new Error(`Safety abort: keep profile ${KEEP_PROFILE_ID} on class 121 missing`);
    }

    const clearProfiles = beforeProfiles.filter((p) => Number(p.class_id) === CLEAR_CLASS_ID);
    const clearReservations = beforeReservations.filter((r) => Number(r.class_id) === CLEAR_CLASS_ID);

    console.log('\nPlanned:');
    console.log(
      `  1. DELETE classstudent ${CLEAR_CLASSSTUDENT_ID} (and any other 167 rows) for student ${STUDENT_ID}`
    );
    console.log(
      `  2. Remove leftover class 167 installment profiles: ${
        clearProfiles.length ? clearProfiles.map((p) => p.profile_id).join(', ') : 'none'
      }`
    );
    console.log(
      `  3. Cancel leftover class 167 reservations: ${
        clearReservations.length ? clearReservations.map((r) => r.reserved_id).join(', ') : 'none'
      }`
    );
    console.log(`  4. KEEP classstudent ${KEEP_CLASSSTUDENT_ID} + profile ${KEEP_PROFILE_ID}`);

    if (!isApply) {
      console.log('\nDry run complete. Re-run with --apply to commit.');
      console.log(
        'After apply: class 167 Enroll modal can list Daelan. Class 121 enrollment unchanged.'
      );
      return;
    }

    await client.query('BEGIN');

    const deletedCs = await client.query(
      `DELETE FROM classstudentstbl
       WHERE student_id = $1
         AND class_id = $2
       RETURNING classstudent_id, phase_number, program_enrollment_status`,
      [STUDENT_ID, CLEAR_CLASS_ID]
    );
    console.log('✅ Deleted class 167 classstudent rows:');
    console.table(deletedCs.rows);

    if (clearProfiles.length) {
      const profileIds = clearProfiles.map((p) => Number(p.profile_id));
      await client.query(
        `DELETE FROM installmentinvoicestbl
         WHERE installmentinvoiceprofiles_id = ANY($1::int[])`,
        [profileIds]
      );
      await client.query(
        `DELETE FROM program_payment_statustbl
         WHERE installmentinvoiceprofiles_id = ANY($1::int[])`,
        [profileIds]
      ).catch(() => {});
      await client.query(
        `UPDATE invoicestbl
         SET installmentinvoiceprofiles_id = NULL
         WHERE installmentinvoiceprofiles_id = ANY($1::int[])`,
        [profileIds]
      );
      await client.query(
        `DELETE FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = ANY($1::int[])
           AND student_id = $2
           AND class_id = $3`,
        [profileIds, STUDENT_ID, CLEAR_CLASS_ID]
      );
      console.log(`✅ Removed class 167 profiles: ${profileIds.join(', ')}`);
    }

    if (clearReservations.length) {
      await client.query(
        `UPDATE reservedstudentstbl
         SET status = 'Cancelled'
         WHERE student_id = $1
           AND class_id = $2
           AND status NOT IN ('Cancelled', 'Expired', 'Upgraded')`,
        [STUDENT_ID, CLEAR_CLASS_ID]
      );
      console.log('✅ Cancelled leftover class 167 reservations');
    }

    const afterCs = await loadClassStudents(client, STUDENT_ID, [KEEP_CLASS_ID, CLEAR_CLASS_ID]);
    const afterProfiles = await loadProfiles(client, STUDENT_ID, [KEEP_CLASS_ID, CLEAR_CLASS_ID]);

    if (afterCs.some((r) => Number(r.class_id) === CLEAR_CLASS_ID)) {
      throw new Error('Validation failed: class 167 roster row still exists');
    }
    if (!afterCs.some((r) => Number(r.classstudent_id) === KEEP_CLASSSTUDENT_ID && !r.removed)) {
      throw new Error('Safety abort: class 121 enrollment missing after delete');
    }
    if (!afterProfiles.some((p) => Number(p.profile_id) === KEEP_PROFILE_ID)) {
      throw new Error('Safety abort: profile 498 missing after delete');
    }

    await client.query('COMMIT');

    console.log('\nClassstudent AFTER:');
    console.table(afterCs);
    console.log('Profiles AFTER:');
    console.table(afterProfiles);
    console.log('\nCommitted.');
    console.log(
      '✅ Refresh Classes → class 167 (start 2026-08-03) → Enroll → search "daelan".'
    );
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
