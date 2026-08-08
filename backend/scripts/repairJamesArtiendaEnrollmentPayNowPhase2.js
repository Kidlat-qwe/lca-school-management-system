/**
 * JAMES MIKHAIL M. ARTIENDA — restore enrollments so Pay Now is on Phase 2.
 *
 * After payment shift, INV-256 (Phase 2) is Unpaid/Overdue. Delinquency
 * auto-dropped Phase 2 (and Phase 6 was already dropped). Dropped slots skip
 * Pay Now, so the UI offered Pay Now on Phase 7 instead.
 *
 * Scope (--apply):
 *   1. Phase 2 (CS 287) → re_enrolled; clear removed_*
 *   2. Phase 6 (CS 2079) → re_enrolled; clear removed_*
 *   3. Phases 3–5 already re_enrolled (no-op if already correct)
 *   4. Move INV-256 due → 2026-08-05 (under grace) so delinquency does not
 *      immediately re-drop Phase 2 (old due 2026-04-05 is 30+ days past)
 *   5. Reactivate installment profile (is_active=true)
 *
 * Expected UI:
 *   Pay Now on Phase 2 (INV-256). After Phase 2 is paid → Pay Now on Phase 7.
 *
 * Run:
 *   node backend/scripts/repairJamesArtiendaEnrollmentPayNowPhase2.js --production
 *   node backend/scripts/repairJamesArtiendaEnrollmentPayNowPhase2.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_ID = 119;
const STUDENT_EMAIL = 'menalie_artienda28@yahoo.com';
const CLASS_ID = 56;
const PROFILE_ID = 82;

const PHASE2_CS_ID = 287;
const PHASE6_CS_ID = 2079;
const PHASE2_INVOICE_ID = 256;
const PHASE7_INVOICE_ID = 2164;

/** Keep issue history; move due into current cycle so Pay Now + no instant re-drop */
const PHASE2_NEW_DUE = '2026-08-05';

const REPAIR_NOTE =
  'Ops repair 2026-08-08 — James Artienda restore Phase2+6 re_enrolled; Pay Now on Phase 2';

const isApply = process.argv.includes('--apply');

async function loadEnrollments(client) {
  return (
    await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status AS status,
              TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD') AS enrolled,
              TO_CHAR(TIMEZONE('Asia/Manila', removed_at), 'YYYY-MM-DD') AS removed,
              LEFT(COALESCE(removed_reason,''), 60) AS removed_reason
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2
       ORDER BY phase_number NULLS LAST, classstudent_id`,
      [STUDENT_ID, CLASS_ID]
    )
  ).rows;
}

async function restoreReEnrolled(client, classstudentId, phaseNumber) {
  const r = await client.query(
    `UPDATE classstudentstbl
     SET program_enrollment_status = 're_enrolled',
         removed_at = NULL,
         removed_reason = NULL,
         removed_by = NULL,
         enrolled_by = CASE
           WHEN enrolled_by IS NULL OR TRIM(enrolled_by) = '' THEN $1::text
           WHEN enrolled_by ILIKE '%' || $1::text || '%' THEN enrolled_by
           ELSE enrolled_by || ' | ' || $1::text
         END
     WHERE classstudent_id = $2
       AND student_id = $3
       AND class_id = $4
       AND phase_number = $5
     RETURNING classstudent_id, phase_number, program_enrollment_status AS status`,
    [REPAIR_NOTE, classstudentId, STUDENT_ID, CLASS_ID, phaseNumber]
  );
  if (!r.rows.length) {
    throw new Error(`Failed to restore phase ${phaseNumber} CS ${classstudentId}`);
  }
  console.log(`✅ Phase ${phaseNumber} CS ${classstudentId} → re_enrolled`);
  return r.rows[0];
}

async function main() {
  console.log(
    `\nJames Artienda — enrollments + Pay Now on Phase 2` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`Note: ${REPAIR_NOTE}`);
  console.log(`DB: ${process.env.DB_NAME} | NODE_ENV=${process.env.NODE_ENV}\n`);

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

    console.log('\nEnrollments BEFORE:');
    console.table(await loadEnrollments(client));

    const inv2 = (
      await client.query(
        `SELECT invoice_id, status, amount,
                TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
                TO_CHAR(due_date, 'YYYY-MM-DD') AS due,
                installmentinvoiceprofiles_id AS profile_id
         FROM invoicestbl WHERE invoice_id = $1`,
        [PHASE2_INVOICE_ID]
      )
    ).rows[0];
    if (!inv2 || Number(inv2.profile_id) !== PROFILE_ID) {
      throw new Error(`INV-${PHASE2_INVOICE_ID} missing on profile ${PROFILE_ID}`);
    }
    if (String(inv2.status).toLowerCase() === 'paid') {
      throw new Error(`INV-${PHASE2_INVOICE_ID} is Paid — refuse (expected Unpaid for Pay Now)`);
    }
    console.log('Phase 2 invoice BEFORE:', inv2);

    const profile = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id, is_active, generated_count
         FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1 AND student_id = $2`,
        [PROFILE_ID, STUDENT_ID]
      )
    ).rows[0];
    console.log('Profile BEFORE:', profile);

    console.log('\nPlanned:');
    console.log('  1. Phase 2 CS 287 → re_enrolled (clear delinquency drop)');
    console.log('  2. Phase 3–5 already re_enrolled (verify)');
    console.log('  3. Phase 6 CS 2079 → re_enrolled');
    console.log(`  4. INV-256 due ${inv2.due} → ${PHASE2_NEW_DUE} (avoid instant re-drop)`);
    console.log('  5. Profile is_active → true');
    console.log('  6. Expect Pay Now on Phase 2; after pay → Phase 7');

    // Restore Phase 2 + 6
    await restoreReEnrolled(client, PHASE2_CS_ID, 2);
    await restoreReEnrolled(client, PHASE6_CS_ID, 6);

    // Verify phases 3–5
    const mid = (
      await client.query(
        `SELECT phase_number, program_enrollment_status AS status
         FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2 AND phase_number BETWEEN 3 AND 5
         ORDER BY phase_number`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows;
    for (const row of mid) {
      if (String(row.status) !== 're_enrolled') {
        await client.query(
          `UPDATE classstudentstbl
           SET program_enrollment_status = 're_enrolled',
               removed_at = NULL,
               removed_reason = NULL,
               removed_by = NULL
           WHERE student_id = $1 AND class_id = $2 AND phase_number = $3`,
          [STUDENT_ID, CLASS_ID, row.phase_number]
        );
        console.log(`✅ Phase ${row.phase_number} forced → re_enrolled (was ${row.status})`);
      } else {
        console.log(`✓ Phase ${row.phase_number} already re_enrolled`);
      }
    }

    // Shift Phase 2 due date so delinquency (≥30 days after due) does not re-drop today
    await client.query(
      `UPDATE invoicestbl
       SET due_date = $1::date,
           remarks = CASE
             WHEN remarks IS NULL OR TRIM(remarks) = '' THEN $2
             WHEN remarks ILIKE '%' || $2 || '%' THEN remarks
             ELSE remarks || ';' || $2
           END
       WHERE invoice_id = $3`,
      [PHASE2_NEW_DUE, REPAIR_NOTE, PHASE2_INVOICE_ID]
    );
    console.log(`✅ INV-${PHASE2_INVOICE_ID} due → ${PHASE2_NEW_DUE}`);

    try {
      await syncProgramPaymentStatusForInvoice(client, PHASE2_INVOICE_ID);
    } catch (e) {
      console.warn('⚠ sync Phase 2:', e.message);
    }

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET is_active = true
       WHERE installmentinvoiceprofiles_id = $1`,
      [PROFILE_ID]
    );
    console.log('✅ Profile is_active → true');

    console.log('\nEnrollments AFTER:');
    console.table(await loadEnrollments(client));

    const inv2After = (
      await client.query(
        `SELECT invoice_id, status, amount,
                TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
                TO_CHAR(due_date, 'YYYY-MM-DD') AS due
         FROM invoicestbl WHERE invoice_id = $1`,
        [PHASE2_INVOICE_ID]
      )
    ).rows[0];
    const inv7 = (
      await client.query(
        `SELECT invoice_id, status, amount,
                TO_CHAR(due_date, 'YYYY-MM-DD') AS due
         FROM invoicestbl WHERE invoice_id = $1`,
        [PHASE7_INVOICE_ID]
      )
    ).rows[0];
    const profileAfter = (
      await client.query(
        `SELECT is_active, generated_count FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];

    console.log('\nPhase 2 invoice AFTER:', inv2After);
    console.log('Phase 7 invoice (unchanged unpaid):', inv7);
    console.log('Profile AFTER:', profileAfter);

    const enr = await loadEnrollments(client);
    for (const phase of [2, 3, 4, 5, 6]) {
      const row = enr.find((e) => Number(e.phase_number) === phase);
      if (!row || String(row.status) !== 're_enrolled' || row.removed) {
        throw new Error(`Phase ${phase} not re_enrolled after repair`);
      }
    }
    if (String(inv2After.status).toLowerCase() === 'paid') {
      throw new Error('Phase 2 unexpectedly Paid');
    }
    if (!profileAfter.is_active) {
      throw new Error('Profile not active');
    }

    console.log('\nExpected UI:');
    console.log('  • Phases 3–6 enrollment: re_enrolled');
    console.log('  • Phase 2: Unpaid/grace + Pay Now (not dropped)');
    console.log('  • After Phase 2 paid → Pay Now on Phase 7 (INV-2164)');

    if (!isApply) {
      await client.query('ROLLBACK');
      console.log('\nDry run only — rolled back. Re-run with --apply to commit.');
      return;
    }

    await client.query('COMMIT');
    console.log('\nCommitted.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('\nFAILED — rolled back:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main();
