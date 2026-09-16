/**
 * Elijah Mikael A. De Jesus (aquinomarielle221@gmail.com, user 275) —
 * Phase 7 after Phase 6 delinquency drop should be labeled rejoin, not re_enrolled.
 *
 * Plan 2 · Profile 412 · Class 53 VMP_NURSERY_TThS_11:00 AM · Branch 6
 *
 * Current:
 *   P6 CS 2468 dropped (INV-2386 unpaid overdue + 10% penalty)
 *   P7 CS 2469 re_enrolled (INV-2665 Paid) — wrong label after drop
 *
 * Target:
 *   P7 CS 2469 → rejoin
 *
 * Run (from backend/):
 *   node scripts/repairElijahDeJesusPhase7RejoinLabel.js --production
 *   node scripts/repairElijahDeJesusPhase7RejoinLabel.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { PROGRAM_ENROLLMENT_STATUS } from '../utils/enrollmentStatus.js';

const STUDENT_ID = 275;
const STUDENT_EMAIL = 'aquinomarielle221@gmail.com';
const CLASS_ID = 53;
const PROFILE_ID = 412;
const PHASE6_CS_ID = 2468;
const PHASE7_CS_ID = 2469;
const PHASE7_INVOICE_ID = 2665;

const REPAIR_NOTE =
  'Ops repair 2026-09-14 — Elijah De Jesus Plan2 Phase 7 re_enrolled → rejoin after Phase 6 drop';

const isApply = process.argv.includes('--apply');

function appendNote(existing, note, maxLen = 255) {
  const cur = String(existing || '').trim();
  const add = String(note || '').trim();
  if (!add) return cur || null;
  if (cur.toLowerCase().includes(add.toLowerCase())) return cur;
  if (!cur) return add.length <= maxLen ? add : add.slice(0, maxLen);
  const joined = `${cur} | ${add}`;
  if (joined.length <= maxLen) return joined;
  return cur.length <= maxLen ? cur : cur.slice(0, maxLen);
}

async function main() {
  console.log(
    `\nElijah De Jesus — Phase 7 rejoin label${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
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
        `SELECT installmentinvoiceprofiles_id, class_id, is_active, generated_count
         FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1
           AND student_id = $2
           AND class_id = $3`,
        [PROFILE_ID, STUDENT_ID, CLASS_ID]
      )
    ).rows[0];
    if (!profile) throw new Error(`Profile ${PROFILE_ID} not found`);
    console.log('Profile:', profile);

    const p6 = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status,
                removed_at IS NOT NULL AS removed, removed_reason
         FROM classstudentstbl
         WHERE classstudent_id = $1
           AND student_id = $2
           AND class_id = $3
           AND phase_number = 6`,
        [PHASE6_CS_ID, STUDENT_ID, CLASS_ID]
      )
    ).rows[0];
    if (!p6) throw new Error(`Missing Phase 6 CS ${PHASE6_CS_ID}`);
    if (String(p6.program_enrollment_status) !== 'dropped') {
      throw new Error(
        `Phase 6 CS ${PHASE6_CS_ID} status is ${p6.program_enrollment_status}, expected dropped`
      );
    }

    const p7 = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status, enrolled_by,
                removed_at IS NOT NULL AS removed,
                TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD') AS enrolled
         FROM classstudentstbl
         WHERE classstudent_id = $1
           AND student_id = $2
           AND class_id = $3
           AND phase_number = 7`,
        [PHASE7_CS_ID, STUDENT_ID, CLASS_ID]
      )
    ).rows[0];
    if (!p7) throw new Error(`Missing Phase 7 CS ${PHASE7_CS_ID}`);
    if (p7.removed) {
      throw new Error(`Phase 7 CS ${PHASE7_CS_ID} is removed — abort`);
    }
    if (String(p7.program_enrollment_status) === PROGRAM_ENROLLMENT_STATUS.REJOIN) {
      console.log(`  · CS ${PHASE7_CS_ID} already rejoin — nothing to change`);
    } else if (String(p7.program_enrollment_status) !== PROGRAM_ENROLLMENT_STATUS.RE_ENROLLED) {
      throw new Error(
        `Phase 7 CS ${PHASE7_CS_ID} status is ${p7.program_enrollment_status}, expected re_enrolled`
      );
    }

    const inv7 = (
      await client.query(
        `SELECT invoice_id, status, remarks, installmentinvoiceprofiles_id
         FROM invoicestbl WHERE invoice_id = $1`,
        [PHASE7_INVOICE_ID]
      )
    ).rows[0];
    if (!inv7) throw new Error(`INV-${PHASE7_INVOICE_ID} missing`);
    if (Number(inv7.installmentinvoiceprofiles_id) !== PROFILE_ID) {
      throw new Error(`INV-${PHASE7_INVOICE_ID} not on profile ${PROFILE_ID}`);
    }
    if (parseTargetPhase(inv7.remarks) !== 7) {
      throw new Error(`INV-${PHASE7_INVOICE_ID} is not TARGET_PHASE:7`);
    }
    if (String(inv7.status) !== 'Paid') {
      throw new Error(`INV-${PHASE7_INVOICE_ID} status is ${inv7.status}, expected Paid`);
    }

    // No active enrollment between drop phase 6 and phase 7 (rejoin must be first comeback).
    const between = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status
         FROM classstudentstbl
         WHERE student_id = $1
           AND class_id = $2
           AND phase_number > 6
           AND phase_number < 7
           AND program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin')
           AND removed_at IS NULL`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows;
    if (between.length) {
      throw new Error(
        `Unexpected active enrollment between P6 and P7: ${JSON.stringify(between)}`
      );
    }

    console.log('\nBefore:');
    console.log(
      `  P6 CS ${p6.classstudent_id}: ${p6.program_enrollment_status}` +
        (p6.removed ? ' (removed)' : '')
    );
    console.log(
      `  P7 CS ${p7.classstudent_id}: ${p7.program_enrollment_status} enrolled ${p7.enrolled}`
    );
    console.log(`  INV-${PHASE7_INVOICE_ID}: ${inv7.status}`);

    console.log('\nPlanned:');
    console.log(
      `  1. CS ${PHASE7_CS_ID}: ${p7.program_enrollment_status} → ${PROGRAM_ENROLLMENT_STATUS.REJOIN}`
    );

    if (String(p7.program_enrollment_status) !== PROGRAM_ENROLLMENT_STATUS.REJOIN) {
      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = $1,
             enrolled_by = $2,
             removed_at = NULL,
             removed_reason = NULL,
             removed_by = NULL
         WHERE classstudent_id = $3
           AND student_id = $4
           AND class_id = $5
           AND phase_number = 7`,
        [
          PROGRAM_ENROLLMENT_STATUS.REJOIN,
          appendNote(p7.enrolled_by, REPAIR_NOTE),
          PHASE7_CS_ID,
          STUDENT_ID,
          CLASS_ID,
        ]
      );
      console.log(`→ CS ${PHASE7_CS_ID}: → rejoin`);
    }

    const p7After = (
      await client.query(
        `SELECT classstudent_id, program_enrollment_status, removed_at IS NOT NULL AS removed
         FROM classstudentstbl WHERE classstudent_id = $1`,
        [PHASE7_CS_ID]
      )
    ).rows[0];
    const p6After = (
      await client.query(
        `SELECT program_enrollment_status FROM classstudentstbl WHERE classstudent_id = $1`,
        [PHASE6_CS_ID]
      )
    ).rows[0];

    console.log('\nAfter (in transaction):');
    console.log(`  P6 CS ${PHASE6_CS_ID}: ${p6After.program_enrollment_status}`);
    console.log(
      `  P7 CS ${p7After.classstudent_id}: ${p7After.program_enrollment_status}` +
        (p7After.removed ? ' (removed)' : '')
    );

    if (p7After.program_enrollment_status !== PROGRAM_ENROLLMENT_STATUS.REJOIN || p7After.removed) {
      throw new Error('Phase 7 rejoin validation failed');
    }
    if (p6After.program_enrollment_status !== 'dropped') {
      throw new Error('Phase 6 must remain dropped');
    }

    console.log('\n✅ Repair verified.');

    if (isApply) {
      await client.query('COMMIT');
      console.log('\n✅ Applied.');
    } else {
      await client.query('ROLLBACK');
      console.log('\nDry run — rolled back. Re-run with --apply to commit.');
    }
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('\nFailed:', err.message || err);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main();
