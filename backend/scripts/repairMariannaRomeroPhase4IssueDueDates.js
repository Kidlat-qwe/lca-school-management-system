/**
 * Marianna Agatha Romero — fix Phase 4 (INV-1354) issue/due dates.
 *
 * Student: 560 · amgromero1987@gmail.com
 * Profile: 400 · class 56 NC_Nursery_MWF_11:00-12:00PM
 *
 * Current: issue 2026-05-25 / due 2026-06-05
 * Target:  issue 2026-04-25 / due 2026-05-05
 *
 * Does NOT change payment, status, AR#, Phase 5+, or enrollments.
 *
 * Run:
 *   node backend/scripts/repairMariannaRomeroPhase4IssueDueDates.js --production
 *   node backend/scripts/repairMariannaRomeroPhase4IssueDueDates.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_ID = 560;
const STUDENT_EMAIL = 'amgromero1987@gmail.com';
const PROFILE_ID = 400;
const CLASS_ID = 56;
const PHASE4_INVOICE_ID = 1354;
const EXPECTED_PHASE = 4;

const CURRENT_ISSUE = '2026-05-25';
const CURRENT_DUE = '2026-06-05';
const TARGET_ISSUE = '2026-04-25';
const TARGET_DUE = '2026-05-05';

const REPAIR_NOTE =
  'Ops repair 2026-08-08 — Marianna Romero Phase 4 INV-1354 issue/due → Apr 25 / May 5';

const isApply = process.argv.includes('--apply');

async function loadInvoice(client, invoiceId) {
  const r = await client.query(
    `SELECT invoice_id, status, amount, invoice_ar_number,
            installmentinvoiceprofiles_id AS profile_id,
            TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
            TO_CHAR(due_date, 'YYYY-MM-DD') AS due,
            LEFT(COALESCE(remarks,''), 160) AS remarks
     FROM invoicestbl WHERE invoice_id = $1`,
    [invoiceId]
  );
  const row = r.rows[0] || null;
  if (row) row.phase = parseTargetPhase(row.remarks);
  return row;
}

async function main() {
  console.log(
    `\nMarianna Romero — Phase 4 issue/due dates` +
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
    if (!profile) throw new Error('Profile not found');
    console.log('Profile:', profile);

    const before = await loadInvoice(client, PHASE4_INVOICE_ID);
    if (!before) throw new Error(`INV-${PHASE4_INVOICE_ID} not found`);
    if (Number(before.profile_id) !== PROFILE_ID) {
      throw new Error(
        `INV-${PHASE4_INVOICE_ID} profile ${before.profile_id} ≠ ${PROFILE_ID}`
      );
    }
    if (before.phase !== EXPECTED_PHASE) {
      throw new Error(
        `Expected TARGET_PHASE:${EXPECTED_PHASE}, got ${before.phase}`
      );
    }
    if (String(before.status).toLowerCase() !== 'paid') {
      throw new Error(`INV-${PHASE4_INVOICE_ID} status is ${before.status}, expected Paid`);
    }
    if (before.issue !== CURRENT_ISSUE || before.due !== CURRENT_DUE) {
      if (before.issue === TARGET_ISSUE && before.due === TARGET_DUE) {
        console.log('\nAlready at target dates — nothing to do.');
        await client.query('ROLLBACK');
        return;
      }
      throw new Error(
        `Unexpected dates issue=${before.issue} due=${before.due} ` +
          `(expected ${CURRENT_ISSUE}/${CURRENT_DUE} or already ${TARGET_ISSUE}/${TARGET_DUE})`
      );
    }

    console.log('\nBEFORE Phase 4 INV-1354:');
    console.table([before]);

    console.log('\nPlanned:');
    console.log(`  1. INV-${PHASE4_INVOICE_ID} issue ${CURRENT_ISSUE} → ${TARGET_ISSUE}`);
    console.log(`  2. INV-${PHASE4_INVOICE_ID} due   ${CURRENT_DUE} → ${TARGET_DUE}`);
    console.log('  3. Append repair note; sync program_payment_status');
    console.log('  4. Leave payment / AR / enrollment / other phases untouched');

    const nextRemarks = before.remarks.includes(REPAIR_NOTE)
      ? before.remarks
      : `${before.remarks};${REPAIR_NOTE}`;

    await client.query(
      `UPDATE invoicestbl
       SET issue_date = $1::date,
           due_date = $2::date,
           remarks = $3
       WHERE invoice_id = $4
         AND installmentinvoiceprofiles_id = $5`,
      [TARGET_ISSUE, TARGET_DUE, nextRemarks, PHASE4_INVOICE_ID, PROFILE_ID]
    );
    console.log(`✅ Updated INV-${PHASE4_INVOICE_ID} dates`);

    try {
      await syncProgramPaymentStatusForInvoice(client, PHASE4_INVOICE_ID);
      console.log('✅ Synced program_payment_status');
    } catch (e) {
      console.warn('⚠ syncProgramPaymentStatus:', e.message);
    }

    const after = await loadInvoice(client, PHASE4_INVOICE_ID);
    console.log('\nAFTER Phase 4 INV-1354:');
    console.table([after]);

    if (after.issue !== TARGET_ISSUE || after.due !== TARGET_DUE) {
      throw new Error(
        `Dates not applied: issue=${after.issue} due=${after.due}`
      );
    }

    console.log('\nExpected UI Phase 4:');
    console.log(`  Issued: April 25, 2026  |  Due: May 5, 2026  |  Status: Paid`);

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
