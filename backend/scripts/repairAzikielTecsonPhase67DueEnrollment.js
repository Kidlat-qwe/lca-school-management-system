/**
 * Azikiel T. Tecson (luis.tecson.ph@gmail.com, user 643) —
 * fix Phase 6/7 due dates + Month Re-enrollment labels.
 *
 * Production · class 47 SOMO_Playgroup_TTh_9:30-10:30AM · profile 472 · phase_start 6
 *
 * Desired:
 *   INV 2403 (Phase 6) due → 2026-08-05
 *   INV 2820 (Phase 7) due → 2026-09-05
 *   CS 1519 Phase 6: pending_enrollment → new; enrolled_at → 2026-08-03
 *     (so Month Re-enrollment shows **new** in August)
 *   CS 2481 Phase 7: keep re_enrolled; enrolled_at already 2026-09-01
 *     (Month Re-enrollment **re-enrolled** in September)
 *
 * Run (from backend/):
 *   node scripts/repairAzikielTecsonPhase67DueEnrollment.js --production
 *   node scripts/repairAzikielTecsonPhase67DueEnrollment.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_ID = 643;
const STUDENT_EMAIL = 'luis.tecson.ph@gmail.com';
const CLASS_ID = 47;
const PROFILE_ID = 472;

const PHASE6_INVOICE_ID = 2403;
const PHASE7_INVOICE_ID = 2820;
const PHASE6_CS_ID = 1519;
const PHASE7_CS_ID = 2481;

const PHASE6_DUE = '2026-08-05';
const PHASE7_DUE = '2026-09-05';
const PHASE6_ENROLLED_AT = '2026-08-03 12:00:00'; // Asia/Manila noon local via timestamptz cast below

const REPAIR_NOTE =
  'Ops — Azikiel Tecson Phase 6/7 due Aug 5 / Sep 5; P6 pending→new for August matrix';

const isApply = process.argv.includes('--apply');

async function loadSnapshot(client) {
  const student = (
    await client.query(
      `SELECT user_id, full_name, email FROM userstbl WHERE user_id = $1`,
      [STUDENT_ID]
    )
  ).rows[0];

  const profile = (
    await client.query(
      `SELECT installmentinvoiceprofiles_id, class_id, phase_start, generated_count,
              total_phases, is_active
       FROM installmentinvoiceprofilestbl
       WHERE installmentinvoiceprofiles_id = $1`,
      [PROFILE_ID]
    )
  ).rows[0];

  const invoices = (
    await client.query(
      `SELECT invoice_id, status, amount,
              TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue_ymd,
              TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due_ymd,
              substring(remarks from 'TARGET_PHASE:([0-9]+)') AS phase
       FROM invoicestbl
       WHERE invoice_id = ANY($1::int[])
       ORDER BY invoice_id`,
      [[PHASE6_INVOICE_ID, PHASE7_INVOICE_ID]]
    )
  ).rows;

  const enrollments = (
    await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status,
              TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled_ymd,
              removed_at, removed_reason
       FROM classstudentstbl
       WHERE classstudent_id = ANY($1::int[])
       ORDER BY phase_number`,
      [[PHASE6_CS_ID, PHASE7_CS_ID]]
    )
  ).rows;

  return { student, profile, invoices, enrollments };
}

async function main() {
  console.log(
    `\nAzikiel Tecson — Phase 6/7 due + enrollment${
      isApply ? ' (APPLY)' : ' (DRY RUN)'
    }\n`
  );
  console.log(`Note: ${REPAIR_NOTE}\n`);

  const client = await getClient();
  try {
    const before = await loadSnapshot(client);
    if (!before.student) throw new Error(`Student ${STUDENT_ID} not found`);
    if (before.student.email?.toLowerCase() !== STUDENT_EMAIL.toLowerCase()) {
      throw new Error(`Email mismatch (expected ${STUDENT_EMAIL})`);
    }
    if (!before.profile || Number(before.profile.class_id) !== CLASS_ID) {
      throw new Error(`Profile ${PROFILE_ID} / class mismatch`);
    }

    const inv6 = before.invoices.find((i) => Number(i.invoice_id) === PHASE6_INVOICE_ID);
    const inv7 = before.invoices.find((i) => Number(i.invoice_id) === PHASE7_INVOICE_ID);
    const cs6 = before.enrollments.find((r) => Number(r.classstudent_id) === PHASE6_CS_ID);
    const cs7 = before.enrollments.find((r) => Number(r.classstudent_id) === PHASE7_CS_ID);

    if (!inv6 || Number(inv6.phase) !== 6) throw new Error('Phase 6 invoice missing/mismatch');
    if (!inv7 || Number(inv7.phase) !== 7) throw new Error('Phase 7 invoice missing/mismatch');
    if (String(inv6.status).toLowerCase() !== 'paid') throw new Error('Phase 6 invoice not Paid');
    if (String(inv7.status).toLowerCase() !== 'paid') throw new Error('Phase 7 invoice not Paid');
    if (!cs6 || Number(cs6.phase_number) !== 6) throw new Error('Phase 6 enrollment row missing');
    if (!cs7 || Number(cs7.phase_number) !== 7) throw new Error('Phase 7 enrollment row missing');

    console.log('Student:', before.student);
    console.log('Profile:', before.profile);
    console.log('\nBEFORE invoices:');
    console.table(before.invoices);
    console.log('\nBEFORE enrollments:');
    console.table(before.enrollments);

    console.log('\nPlanned:');
    console.log(
      `  1. INV ${PHASE6_INVOICE_ID} due ${inv6.due_ymd} → ${PHASE6_DUE}`
    );
    console.log(
      `  2. INV ${PHASE7_INVOICE_ID} due ${inv7.due_ymd} → ${PHASE7_DUE}`
    );
    console.log(
      `  3. CS ${PHASE6_CS_ID} Phase 6: ${cs6.program_enrollment_status} @ ${cs6.enrolled_ymd}` +
        ` → new @ 2026-08-03 (August matrix = new)`
    );
    console.log(
      `  4. CS ${PHASE7_CS_ID} Phase 7: keep re_enrolled @ ${cs7.enrolled_ymd}` +
        ` (September matrix = re-enrolled)`
    );
    console.log('  5. Append repair note on invoice remarks; sync program payment status');

    if (!isApply) {
      console.log('\nDry run only. Re-run with --apply to commit.');
      return;
    }

    await client.query('BEGIN');

    await client.query(
      `UPDATE invoicestbl
       SET due_date = ($1::date + TIME '12:00'),
           late_penalty_applied_for_due_date = NULL,
           remarks = CASE
             WHEN remarks ILIKE $3 THEN remarks
             ELSE TRIM(BOTH ';' FROM COALESCE(remarks, '')) || ';' || $2
           END
       WHERE invoice_id = $4`,
      [PHASE6_DUE, REPAIR_NOTE, `%${REPAIR_NOTE}%`, PHASE6_INVOICE_ID]
    );

    await client.query(
      `UPDATE invoicestbl
       SET due_date = ($1::date + TIME '12:00'),
           late_penalty_applied_for_due_date = NULL,
           remarks = CASE
             WHEN remarks ILIKE $3 THEN remarks
             ELSE TRIM(BOTH ';' FROM COALESCE(remarks, '')) || ';' || $2
           END
       WHERE invoice_id = $4`,
      [PHASE7_DUE, REPAIR_NOTE, `%${REPAIR_NOTE}%`, PHASE7_INVOICE_ID]
    );

    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 'new',
           enrolled_at = TIMEZONE('Asia/Manila', $1::timestamp),
           enrolled_by = CASE
             WHEN enrolled_by ILIKE '%pending%' OR enrolled_by ILIKE '%Downpayment%'
             THEN 'System (Auto-enrolled via installment payment)'
             ELSE enrolled_by
           END,
           removed_at = NULL,
           removed_reason = NULL,
           removed_by = NULL
       WHERE classstudent_id = $2
         AND student_id = $3
         AND class_id = $4
         AND phase_number = 6`,
      [PHASE6_ENROLLED_AT, PHASE6_CS_ID, STUDENT_ID, CLASS_ID]
    );

    // Ensure Phase 7 stays re_enrolled and not removed
    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 're_enrolled',
           removed_at = NULL,
           removed_reason = NULL,
           removed_by = NULL
       WHERE classstudent_id = $1
         AND student_id = $2
         AND class_id = $3
         AND phase_number = 7`,
      [PHASE7_CS_ID, STUDENT_ID, CLASS_ID]
    );

    await syncProgramPaymentStatusForInvoice(client, PHASE6_INVOICE_ID);
    await syncProgramPaymentStatusForInvoice(client, PHASE7_INVOICE_ID);

    await client.query('COMMIT');
    console.log('\n✅ Applied.');

    const after = await loadSnapshot(client);
    console.log('\nAFTER invoices:');
    console.table(after.invoices);
    console.log('\nAFTER enrollments:');
    console.table(after.enrollments);
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
