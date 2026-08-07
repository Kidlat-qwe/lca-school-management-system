/**
 * Kyrie Robles Albao — clear dropped enrollment badges + Phase 2 "Skipped — no invoice".
 *
 * After Phase 2/3 invoice cancel, UI still shows:
 *   Phase 1 enrollment: dropped (CS 1884)
 *   Phase 2 enrollment: dropped + billing "Skipped — no invoice" (CS 1930 gap)
 *
 * Delete both dropped classstudent rows. Keep Phase 1 INV-2007 Unpaid on profile.
 * Phase 1 enrollment → "—"; Phase 2 → Not Generated with normal billing dash.
 *
 * Run:
 *   node backend/scripts/repairKyrieAlbaoClearDroppedEnrollments.js --production
 *   node backend/scripts/repairKyrieAlbaoClearDroppedEnrollments.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const STUDENT_ID = 623;
const STUDENT_EMAIL = 'andee.albao@gmail.com';
const CLASS_ID = 83;
const PROFILE_ID = 491;
const PHASE1_INVOICE_ID = 2007;
const DELETE_CLASSSTUDENT_IDS = [1884, 1930]; // Phase 1 + Phase 2 dropped

const REPAIR_NOTE =
  'Ops repair 2026-08-07 — Kyrie Albao clear dropped enrollments (remove dropped badge + skipped_gap)';

const isApply = process.argv.includes('--apply');

async function loadState(client) {
  const student = (
    await client.query(
      `SELECT user_id, full_name, email FROM userstbl
       WHERE user_id = $1 AND LOWER(TRIM(email)) = LOWER(TRIM($2))`,
      [STUDENT_ID, STUDENT_EMAIL]
    )
  ).rows[0];

  const enrollments = (
    await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status,
              TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled,
              TO_CHAR(TIMEZONE('Asia/Manila', removed_at), 'YYYY-MM-DD') AS removed,
              LEFT(COALESCE(removed_reason, ''), 100) AS reason
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2
       ORDER BY phase_number, classstudent_id`,
      [STUDENT_ID, CLASS_ID]
    )
  ).rows;

  const phase1 = (
    await client.query(
      `SELECT invoice_id, status, installmentinvoiceprofiles_id,
              TO_CHAR(issue_date,'YYYY-MM-DD') AS issue,
              TO_CHAR(due_date,'YYYY-MM-DD') AS due
       FROM invoicestbl WHERE invoice_id = $1`,
      [PHASE1_INVOICE_ID]
    )
  ).rows[0];

  const profile = (
    await client.query(
      `SELECT installmentinvoiceprofiles_id, generated_count, is_active
       FROM installmentinvoiceprofilestbl
       WHERE installmentinvoiceprofiles_id = $1`,
      [PROFILE_ID]
    )
  ).rows[0];

  return { student, enrollments, phase1, profile };
}

async function main() {
  console.log(
    `\nKyrie Albao — clear dropped enrollments${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`Note: ${REPAIR_NOTE}\n`);

  const client = await getClient();
  try {
    const before = await loadState(client);
    if (!before.student) throw new Error('Student not found');
    console.log('Student:', before.student.full_name, before.student.email);
    console.log('BEFORE profile:', before.profile);
    console.log('BEFORE Phase 1 invoice:', before.phase1);
    console.log('BEFORE enrollments:');
    console.table(before.enrollments);

    const toDelete = before.enrollments.filter((e) =>
      DELETE_CLASSSTUDENT_IDS.includes(Number(e.classstudent_id))
    );
    if (toDelete.length !== DELETE_CLASSSTUDENT_IDS.length) {
      throw new Error(
        `Expected classstudents ${DELETE_CLASSSTUDENT_IDS.join(', ')}; found ${JSON.stringify(toDelete)}`
      );
    }
    for (const e of toDelete) {
      if (String(e.program_enrollment_status) !== 'dropped') {
        throw new Error(
          `CS ${e.classstudent_id} status is ${e.program_enrollment_status}, expected dropped`
        );
      }
    }
    if (!before.phase1 || String(before.phase1.status) !== 'Unpaid') {
      throw new Error('Phase 1 INV-2007 must remain Unpaid');
    }
    if (Number(before.phase1.installmentinvoiceprofiles_id) !== PROFILE_ID) {
      throw new Error('Phase 1 must stay on profile');
    }

    console.log('\nPlanned:');
    for (const e of toDelete) {
      console.log(
        `  • DELETE classstudent ${e.classstudent_id} (phase ${e.phase_number} dropped)`
      );
    }
    console.log('  • Keep INV-2007 Unpaid on profile');
    console.log('  • Expect UI: Phase 1 enrollment "—"; Phase 2 no dropped / no Skipped — no invoice');

    if (!isApply) {
      console.log('\nDry run only. Re-run with --apply to commit.');
      return;
    }

    await client.query('BEGIN');

    const del = await client.query(
      `DELETE FROM classstudentstbl
       WHERE classstudent_id = ANY($1::int[])
         AND student_id = $2
         AND class_id = $3
         AND program_enrollment_status = 'dropped'
       RETURNING classstudent_id, phase_number`,
      [DELETE_CLASSSTUDENT_IDS, STUDENT_ID, CLASS_ID]
    );
    if (del.rows.length !== DELETE_CLASSSTUDENT_IDS.length) {
      throw new Error(
        `Deleted ${del.rows.length} rows, expected ${DELETE_CLASSSTUDENT_IDS.length}`
      );
    }
    console.log('✅ Deleted:', del.rows);

    const after = await loadState(client);
    console.log('\nAFTER enrollments:');
    console.table(after.enrollments);
    console.log('AFTER Phase 1 invoice:', after.phase1);

    if (after.enrollments.length) {
      throw new Error('Expected no classstudent rows left on this class');
    }
    if (
      !after.phase1 ||
      after.phase1.status !== 'Unpaid' ||
      Number(after.phase1.installmentinvoiceprofiles_id) !== PROFILE_ID
    ) {
      throw new Error('Phase 1 invoice validation failed');
    }

    await client.query('COMMIT');
    console.log(
      '\nCommitted. Refresh Student History — dropped badges and Skipped — no invoice should be gone.'
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
