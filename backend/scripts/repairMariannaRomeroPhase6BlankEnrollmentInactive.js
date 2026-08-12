/**
 * Marianna Agatha Romero — Phase 6 enrollment blank until paid; plan Inactive.
 *
 * Student: 560 · amgromero1987@gmail.com
 * Profile: 400 · class 55 NC_NURSERY_TThS_11:00-12:00PM
 *
 * Phase 6 INV-1953 is Unpaid (issue Jul 25 / due Aug 5) — not 30 days overdue,
 * so it must not show dropped. It also must not show re enrolled until paid.
 * Delete the Phase 6 classstudent row so Student History enrollment is "—".
 * Deactivate the installment profile (plan Status = Inactive).
 *
 * Keep Phase 4 new + Phase 5 re_enrolled (those invoices are Paid).
 * Do not change invoice dates, amounts, or Phase 7 (already un-generated).
 *
 * Run:
 *   node backend/scripts/repairMariannaRomeroPhase6BlankEnrollmentInactive.js --production
 *   node backend/scripts/repairMariannaRomeroPhase6BlankEnrollmentInactive.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const STUDENT_ID = 560;
const STUDENT_EMAIL = 'amgromero1987@gmail.com';
const PROFILE_ID = 400;
const CLASS_ID = 55;
const PHASE6_CLASSSTUDENT_ID = 2099;
const PHASE6_INVOICE_ID = 1953;

const REPAIR_NOTE =
  'Ops repair 2026-08-12 — Marianna Romero Phase 6 enrollment blank until paid; plan Inactive';

const isApply = process.argv.includes('--apply');

async function loadEnrollments(client) {
  const r = await client.query(
    `SELECT cs.classstudent_id, cs.phase_number,
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

async function main() {
  console.log(
    `\nMarianna Romero — Phase 6 blank enrollment + Inactive plan` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`Note: ${REPAIR_NOTE}`);
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);

  if (process.env.DB_NAME !== 'psms_production') {
    console.warn('⚠️ Expected psms_production. Pass --production.');
  }

  const client = await getClient();
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
    console.log('Student:', student.full_name, student.email);

    const profile = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id, class_id, is_active, generated_count
         FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1 AND student_id = $2`,
        [PROFILE_ID, STUDENT_ID]
      )
    ).rows[0];
    if (!profile) throw new Error(`Profile ${PROFILE_ID} not found`);
    if (Number(profile.class_id) !== CLASS_ID) {
      throw new Error(`Profile class_id=${profile.class_id}, expected ${CLASS_ID}`);
    }
    console.log('Profile BEFORE:', profile);

    const inv6 = (
      await client.query(
        `SELECT invoice_id, status, amount,
                TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
                TO_CHAR(due_date, 'YYYY-MM-DD') AS due,
                installmentinvoiceprofiles_id AS profile_id
         FROM invoicestbl WHERE invoice_id = $1`,
        [PHASE6_INVOICE_ID]
      )
    ).rows[0];
    if (!inv6 || Number(inv6.profile_id) !== PROFILE_ID) {
      throw new Error(`INV-${PHASE6_INVOICE_ID} missing on profile ${PROFILE_ID}`);
    }
    if (String(inv6.status).toLowerCase() === 'paid') {
      throw new Error(`INV-${PHASE6_INVOICE_ID} is Paid — refuse (expected Unpaid)`);
    }
    console.log('Phase 6 invoice (unchanged):', inv6);

    console.log('\nEnrollments BEFORE:');
    const before = await loadEnrollments(client);
    console.table(before);

    const phase6 = before.find((e) => Number(e.classstudent_id) === PHASE6_CLASSSTUDENT_ID);
    const phase6AlreadyGone = !phase6;

    console.log('\nPlanned:');
    console.log(
      phase6AlreadyGone
        ? `  1. Phase 6 CS ${PHASE6_CLASSSTUDENT_ID} already absent`
        : `  1. DELETE classstudent ${PHASE6_CLASSSTUDENT_ID} (phase 6 ${phase6.status}) so enrollment shows —`
    );
    console.log(
      profile.is_active
        ? '  2. Profile is_active true → false (plan Inactive)'
        : '  2. Profile already inactive'
    );
    console.log('  3. Keep Phase 4 new / Phase 5 re_enrolled (paid)');
    console.log('  4. Leave INV-1953 Unpaid/Overdue');

    if (!phase6AlreadyGone) {
      if (Number(phase6.phase_number) !== 6) {
        throw new Error(
          `CS ${PHASE6_CLASSSTUDENT_ID} is phase ${phase6.phase_number}, expected 6`
        );
      }
      const del = await client.query(
        `DELETE FROM classstudentstbl
         WHERE classstudent_id = $1
           AND student_id = $2
           AND class_id = $3
           AND phase_number = 6
         RETURNING classstudent_id, phase_number`,
        [PHASE6_CLASSSTUDENT_ID, STUDENT_ID, CLASS_ID]
      );
      if (!del.rows.length) {
        throw new Error(`Failed to delete Phase 6 CS ${PHASE6_CLASSSTUDENT_ID}`);
      }
      console.log(`✅ Deleted classstudent ${PHASE6_CLASSSTUDENT_ID}`);
    }

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET is_active = false
       WHERE installmentinvoiceprofiles_id = $1
         AND student_id = $2`,
      [PROFILE_ID, STUDENT_ID]
    );
    console.log('✅ Profile is_active → false');

    const afterEnroll = await loadEnrollments(client);
    const afterProfile = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id, is_active, generated_count
         FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];

    console.log('\nEnrollments AFTER:');
    console.table(afterEnroll);
    console.log('Profile AFTER:', afterProfile);

    if (afterEnroll.some((e) => Number(e.phase_number) === 6)) {
      throw new Error('Phase 6 classstudent still present');
    }
    const p4 = afterEnroll.find((e) => Number(e.phase_number) === 4);
    const p5 = afterEnroll.find((e) => Number(e.phase_number) === 5);
    if (!p4 || p4.status !== 'new') {
      throw new Error(`Phase 4 expected new, got ${p4?.status}`);
    }
    if (!p5 || p5.status !== 're_enrolled') {
      throw new Error(`Phase 5 expected re_enrolled, got ${p5?.status}`);
    }
    if (afterProfile.is_active) {
      throw new Error('Profile still active');
    }

    console.log('\nExpected UI:');
    console.log('  Plan status: Inactive');
    console.log('  Phase 4  new           Paid');
    console.log('  Phase 5  re enrolled   Paid');
    console.log('  Phase 6  —             Overdue (INV-1953, no enrollment until paid)');
    console.log('  Phase 7  —             Not Generated');

    if (!isApply) {
      await client.query('ROLLBACK');
      console.log('\nDry run only — rolled back. Re-run with --apply to commit.');
      return;
    }

    await client.query('COMMIT');
    console.log('\nCommitted. Refresh Student History → Invoices.');
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
