/**
 * Daelan Alaistair Shun Cordova (gwenthampal14@gmail.com, user 673)
 * — unenroll from wrong class SOMO_JULY_Pre-Kinder_MWF_2:30 PM (class 167) only.
 *
 * Context:
 *   Two classes share the same name:
 *     class 121 — start 2026-07-01 — KEEP (cs 1955 phase 2 "new", profile 498)
 *     class 167 — start 2026-08-03 — UNENROLL (cs 1956 phase 1 "re_enrolled", profile 499)
 *
 *   Students modal (Phase 1 / July 29) matches class 167 enrollment.
 *
 * Scope (--apply):
 *   1. Soft-drop all active classstudent rows on class 167 for this student
 *   2. Deactivate installment profile(s) linked to class 167 only
 *   Does NOT touch class 121 / profile 498
 *
 * Run:
 *   node backend/scripts/repairDaelanCordovaUnenrollSomo230Class.js --production
 *   node backend/scripts/repairDaelanCordovaUnenrollSomo230Class.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { deactivateInstallmentProfileForClassDrop } from '../utils/billingNotificationEligibility.js';

const STUDENT_ID = 673;
const STUDENT_EMAIL = 'gwenthampal14@gmail.com';
const WRONG_CLASS_ID = 167;
const KEEP_CLASS_ID = 121;
const WRONG_CLASSSTUDENT_ID = 1956;
const WRONG_PROFILE_ID = 499;

const REPAIR_NOTE =
  'Ops repair 2026-08-03 — Daelan Cordova unenroll wrong SOMO_JULY_Pre-Kinder_MWF_2:30 PM class 167 only; keep class 121';

const isApply = process.argv.includes('--apply');

async function loadEnrollments(client, studentId) {
  const r = await client.query(
    `SELECT cs.classstudent_id, cs.class_id, c.class_name, cs.phase_number,
            cs.program_enrollment_status,
            TO_CHAR(cs.enrolled_at, 'YYYY-MM-DD HH24:MI') AS enrolled,
            TO_CHAR(cs.removed_at, 'YYYY-MM-DD HH24:MI') AS removed,
            TO_CHAR(c.start_date, 'YYYY-MM-DD') AS class_start
     FROM classstudentstbl cs
     JOIN classestbl c ON c.class_id = cs.class_id
     WHERE cs.student_id = $1
     ORDER BY cs.class_id, cs.phase_number, cs.classstudent_id`,
    [studentId]
  );
  return r.rows;
}

async function loadActiveForClass(client, studentId, classId) {
  const r = await client.query(
    `SELECT cs.classstudent_id, cs.phase_number, cs.program_enrollment_status,
            cs.removed_at IS NOT NULL AS is_removed
     FROM classstudentstbl cs
     WHERE cs.student_id = $1
       AND cs.class_id = $2
       AND cs.removed_at IS NULL
       AND cs.program_enrollment_status IN (
         'new', 're_enrolled', 'upsell', 'rejoin', 'completed',
         'pending_enrollment', 'reserved'
       )
     ORDER BY cs.phase_number, cs.classstudent_id`,
    [studentId, classId]
  );
  return r.rows;
}

async function loadProfiles(client, studentId) {
  const r = await client.query(
    `SELECT p.installmentinvoiceprofiles_id AS profile_id, p.class_id, c.class_name,
            p.is_active, p.generated_count, p.phase_start
     FROM installmentinvoiceprofilestbl p
     LEFT JOIN classestbl c ON c.class_id = p.class_id
     WHERE p.student_id = $1
     ORDER BY p.installmentinvoiceprofiles_id`,
    [studentId]
  );
  return r.rows;
}

async function main() {
  console.log(
    `\nDaelan Cordova — unenroll wrong class ${WRONG_CLASS_ID} only` +
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
        `SELECT user_id, full_name, email FROM userstbl
         WHERE user_id = $1 AND LOWER(TRIM(email)) = LOWER(TRIM($2))`,
        [STUDENT_ID, STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student) {
      throw new Error(`Student ${STUDENT_ID} / ${STUDENT_EMAIL} not found`);
    }
    console.log('Student:', student.full_name, student.email, `(id ${student.user_id})`);

    const wrongClass = (
      await client.query(
        `SELECT class_id, class_name, TO_CHAR(start_date, 'YYYY-MM-DD') AS start_ymd
         FROM classestbl WHERE class_id = $1`,
        [WRONG_CLASS_ID]
      )
    ).rows[0];
    if (!wrongClass) throw new Error(`Class ${WRONG_CLASS_ID} not found`);
    if (!String(wrongClass.class_name).includes('SOMO_JULY_Pre-Kinder_MWF_2:30')) {
      throw new Error(
        `Class ${WRONG_CLASS_ID} name mismatch: ${wrongClass.class_name}`
      );
    }
    console.log(
      `Wrong class: ${wrongClass.class_id} ${wrongClass.class_name} (start ${wrongClass.start_ymd})`
    );

    const target = (
      await client.query(
        `SELECT classstudent_id, class_id, phase_number, program_enrollment_status, removed_at
         FROM classstudentstbl WHERE classstudent_id = $1`,
        [WRONG_CLASSSTUDENT_ID]
      )
    ).rows[0];
    if (!target) throw new Error(`classstudent ${WRONG_CLASSSTUDENT_ID} not found`);
    if (Number(target.class_id) !== WRONG_CLASS_ID) {
      throw new Error(
        `classstudent ${WRONG_CLASSSTUDENT_ID} is class ${target.class_id}, expected ${WRONG_CLASS_ID}`
      );
    }

    const keepActive = await loadActiveForClass(client, STUDENT_ID, KEEP_CLASS_ID);
    if (keepActive.length === 0) {
      console.warn(
        `⚠ No active enrollment on keep-class ${KEEP_CLASS_ID}. Continuing (unenroll wrong class only).`
      );
    }

    console.log('\nAll enrollments BEFORE:');
    console.table(await loadEnrollments(client, STUDENT_ID));
    console.log('\nProfiles BEFORE:');
    console.table(await loadProfiles(client, STUDENT_ID));
    console.log(`\nActive on wrong class ${WRONG_CLASS_ID}:`);
    console.table(await loadActiveForClass(client, STUDENT_ID, WRONG_CLASS_ID));
    console.log(`Active on keep class ${KEEP_CLASS_ID}:`);
    console.table(keepActive);

    const activeWrong = await loadActiveForClass(client, STUDENT_ID, WRONG_CLASS_ID);
    if (activeWrong.length === 0 && (target.removed_at || target.program_enrollment_status === 'dropped')) {
      console.log('\nAlready unenrolled from class 167 — nothing to do.');
      return;
    }

    console.log('\nPlanned:');
    console.log(
      `  1. Soft-drop classstudent ${WRONG_CLASSSTUDENT_ID} (and any other active rows) on class ${WRONG_CLASS_ID}`
    );
    console.log(
      `  2. Deactivate installment profile(s) on class ${WRONG_CLASS_ID} (expected profile ${WRONG_PROFILE_ID})`
    );
    console.log(`  3. KEEP class ${KEEP_CLASS_ID} enrollment + profile 498 untouched`);

    if (!isApply) {
      console.log('\nDry run complete. Re-run with --apply to commit.');
      return;
    }

    await client.query('BEGIN');

    const idsToDrop = activeWrong.map((r) => Number(r.classstudent_id));
    if (!idsToDrop.includes(WRONG_CLASSSTUDENT_ID) && !target.removed_at) {
      idsToDrop.push(WRONG_CLASSSTUDENT_ID);
    }

    if (idsToDrop.length > 0) {
      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = 'dropped',
             removed_at = CURRENT_TIMESTAMP,
             removed_reason = $1,
             removed_by = NULL
         WHERE classstudent_id = ANY($2::int[])
           AND student_id = $3
           AND class_id = $4`,
        [REPAIR_NOTE, idsToDrop, STUDENT_ID, WRONG_CLASS_ID]
      );
      console.log(`✅ Soft-dropped classstudent ids: ${idsToDrop.join(', ')}`);
    }

    const deactivated = await deactivateInstallmentProfileForClassDrop(client, {
      studentId: STUDENT_ID,
      classId: WRONG_CLASS_ID,
    });
    console.log(`✅ Deactivated ${deactivated} installment profile(s) on class ${WRONG_CLASS_ID}`);

    // Safety: keep-class must still have active enrollment if it had one before
    const keepAfter = await loadActiveForClass(client, STUDENT_ID, KEEP_CLASS_ID);
    if (keepActive.length > 0 && keepAfter.length === 0) {
      throw new Error(`Safety abort: keep-class ${KEEP_CLASS_ID} lost active enrollment`);
    }

    const wrongAfter = await loadActiveForClass(client, STUDENT_ID, WRONG_CLASS_ID);
    if (wrongAfter.length > 0) {
      throw new Error(`Validation failed: still active on class ${WRONG_CLASS_ID}`);
    }

    await client.query('COMMIT');

    console.log('\nCommitted.');
    console.log('\nAll enrollments AFTER:');
    console.table(await loadEnrollments(client, STUDENT_ID));
    console.log('\nProfiles AFTER:');
    console.table(await loadProfiles(client, STUDENT_ID));
    console.log('\n✅ Student removed from class 167 only. Refresh Students / Enrolled class.');
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
