/**
 * Mattheo Zane Pascual — remove pending enrollment on class 162 only.
 *
 * Student: 280 · taguinodpascual@gmail.com
 *
 * Pending (remove):
 *   Profile 510 · class 162 VMP_Pre-Kindergarten_MWF 11AM (Active)
 *   Unpaid downpayment INV-2396 ₱10,000 — no payments, no classstudent rows
 *
 * Keep:
 *   Class 64 enrollments + profile 135 (completed Pre-K history)
 *
 * Scope (--apply):
 *   1. Guard: refuse if INV-2396 has Completed payments
 *   2. Cancel + detach INV-2396 (and any other invoices on profile 510)
 *   3. Delete installment queue + program_payment_status for profile 510
 *   4. Delete any classstudent rows on class 162 (none expected)
 *   5. DELETE profile 510
 *   6. Do NOT touch class 64 / profile 135
 *
 * Run:
 *   node backend/scripts/repairMattheoPascualRemovePendingClass162.js --production
 *   node backend/scripts/repairMattheoPascualRemovePendingClass162.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const STUDENT_ID = 280;
const STUDENT_EMAIL = 'taguinodpascual@gmail.com';
const REMOVE_PROFILE_ID = 510;
const REMOVE_CLASS_ID = 162;
const KEEP_PROFILE_ID = 135;
const KEEP_CLASS_ID = 64;
const DOWNPAYMENT_INVOICE_ID = 2396;

const REPAIR_NOTE =
  'Ops repair 2026-08-08 — Mattheo Pascual remove pending class 162 profile 510 / INV-2396; keep class 64';

const isApply = process.argv.includes('--apply');

async function main() {
  console.log(
    `\nMattheo Pascual — remove pending class ${REMOVE_CLASS_ID} (profile ${REMOVE_PROFILE_ID})` +
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

    const profiles = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id AS profile_id, class_id, is_active,
                generated_count, phase_start, total_phases, downpayment_invoice_id,
                LEFT(COALESCE(description,''), 60) AS description
         FROM installmentinvoiceprofilestbl
         WHERE student_id = $1
         ORDER BY installmentinvoiceprofiles_id`,
        [STUDENT_ID]
      )
    ).rows;
    console.log('\nProfiles BEFORE:');
    console.table(profiles);

    const remove = profiles.find((p) => Number(p.profile_id) === REMOVE_PROFILE_ID);
    const keep = profiles.find((p) => Number(p.profile_id) === KEEP_PROFILE_ID);

    if (!remove) {
      console.log(`\nProfile ${REMOVE_PROFILE_ID} already gone — nothing to do.`);
      await client.query('ROLLBACK');
      return;
    }
    if (Number(remove.class_id) !== REMOVE_CLASS_ID) {
      throw new Error(
        `Profile ${REMOVE_PROFILE_ID} class ${remove.class_id} ≠ expected ${REMOVE_CLASS_ID}`
      );
    }
    if (!keep || Number(keep.class_id) !== KEEP_CLASS_ID) {
      throw new Error(
        `Keep profile ${KEEP_PROFILE_ID} / class ${KEEP_CLASS_ID} missing — abort`
      );
    }

    const className = (
      await client.query(
        `SELECT class_id, class_name, status,
                TO_CHAR(start_date, 'YYYY-MM-DD') AS start
         FROM classestbl WHERE class_id = $1`,
        [REMOVE_CLASS_ID]
      )
    ).rows[0];
    console.log('\nPending class:', className);

    const enrollments162 = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status AS status
         FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2
         ORDER BY phase_number NULLS LAST`,
        [STUDENT_ID, REMOVE_CLASS_ID]
      )
    ).rows;
    console.log('Class 162 enrollments (expect none):', enrollments162);

    const keepEnrollments = (
      await client.query(
        `SELECT COUNT(*)::int AS count FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2`,
        [STUDENT_ID, KEEP_CLASS_ID]
      )
    ).rows[0];
    console.log(`Class ${KEEP_CLASS_ID} enrollment rows to KEEP:`, keepEnrollments.count);

    const invoices = (
      await client.query(
        `SELECT invoice_id, status, amount, invoice_ar_number,
                installmentinvoiceprofiles_id AS profile_id,
                TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
                LEFT(COALESCE(remarks,''), 80) AS remarks
         FROM invoicestbl
         WHERE installmentinvoiceprofiles_id = $1
            OR invoice_id = $2
         ORDER BY invoice_id`,
        [REMOVE_PROFILE_ID, remove.downpayment_invoice_id || DOWNPAYMENT_INVOICE_ID]
      )
    ).rows;
    console.log('\nInvoices on pending profile:');
    console.table(invoices);

    const invIds = invoices.map((i) => i.invoice_id);
    const payments = invIds.length
      ? (
          await client.query(
            `SELECT payment_id, invoice_id, payable_amount, status, approval_status
             FROM paymenttbl
             WHERE invoice_id = ANY($1::int[])
               AND status = 'Completed'
               AND COALESCE(approval_status, 'Pending') <> 'Rejected'`,
            [invIds]
          )
        ).rows
      : [];
    if (payments.length) {
      throw new Error(
        `Pending profile has Completed payment(s): ${JSON.stringify(payments)} — refuse`
      );
    }
    console.log('Completed payments on pending invoices: 0 (OK to remove)');

    const queue = (
      await client.query(
        `SELECT installmentinvoicedtl_id FROM installmentinvoicestbl
         WHERE installmentinvoiceprofiles_id = $1`,
        [REMOVE_PROFILE_ID]
      )
    ).rows;

    const reserved = (
      await client.query(
        `SELECT reserved_id, class_id, status FROM reservedstudentstbl
         WHERE student_id = $1 AND class_id = $2`,
        [STUDENT_ID, REMOVE_CLASS_ID]
      )
    ).rows;

    console.log('\nPlanned:');
    console.log(`  1. Cancel + detach ${invoices.length} invoice(s) on profile ${REMOVE_PROFILE_ID}`);
    console.log(`  2. Delete queue rows: ${queue.length}`);
    console.log(`  3. Clear program_payment_statustbl for profile ${REMOVE_PROFILE_ID}`);
    console.log(`  4. Delete classstudent on class ${REMOVE_CLASS_ID}: ${enrollments162.length}`);
    if (reserved.length) {
      console.log(`  5. Cancel/clear ${reserved.length} reservation(s) on class ${REMOVE_CLASS_ID}`);
    }
    console.log(`  6. DELETE profile ${REMOVE_PROFILE_ID}`);
    console.log(`  7. KEEP class ${KEEP_CLASS_ID} / profile ${KEEP_PROFILE_ID}`);

    // Cancel + detach invoices
    for (const inv of invoices) {
      const nextRemarks = [inv.remarks, REPAIR_NOTE].filter(Boolean).join(';');
      await client.query(
        `UPDATE invoicestbl
         SET status = CASE
               WHEN LOWER(TRIM(COALESCE(status, ''))) IN ('cancelled', 'canceled') THEN status
               ELSE 'Cancelled'
             END,
             installmentinvoiceprofiles_id = NULL,
             remarks = $1
         WHERE invoice_id = $2`,
        [nextRemarks, inv.invoice_id]
      );
      console.log(`✅ INV-${inv.invoice_id} cancelled + detached (was ${inv.status})`);
    }

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET downpayment_invoice_id = NULL
       WHERE installmentinvoiceprofiles_id = $1`,
      [REMOVE_PROFILE_ID]
    );

    const delQueue = await client.query(
      `DELETE FROM installmentinvoicestbl WHERE installmentinvoiceprofiles_id = $1`,
      [REMOVE_PROFILE_ID]
    );
    console.log(`✅ Deleted queue rows: ${delQueue.rowCount}`);

    try {
      const delPps = await client.query(
        `DELETE FROM program_payment_statustbl WHERE installmentinvoiceprofiles_id = $1`,
        [REMOVE_PROFILE_ID]
      );
      console.log(`✅ Deleted program_payment_status rows: ${delPps.rowCount}`);
    } catch (e) {
      console.warn('⚠ program_payment_statustbl:', e.message);
    }

    if (enrollments162.length) {
      const delCs = await client.query(
        `DELETE FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2`,
        [STUDENT_ID, REMOVE_CLASS_ID]
      );
      console.log(`✅ Deleted classstudent rows on class ${REMOVE_CLASS_ID}: ${delCs.rowCount}`);
    } else {
      console.log(`✓ No classstudent rows on class ${REMOVE_CLASS_ID}`);
    }

    if (reserved.length) {
      await client.query(
        `UPDATE reservedstudentstbl
         SET status = CASE
               WHEN LOWER(TRIM(COALESCE(status, ''))) IN ('cancelled', 'canceled', 'expired') THEN status
               ELSE 'Cancelled'
             END,
             notes = CASE
               WHEN notes IS NULL OR TRIM(notes) = '' THEN $1
               ELSE notes || ' | ' || $1
             END
         WHERE student_id = $2 AND class_id = $3`,
        [REPAIR_NOTE, STUDENT_ID, REMOVE_CLASS_ID]
      );
      console.log(`✅ Marked ${reserved.length} reservation(s) Cancelled`);
    }

    const delProf = await client.query(
      `DELETE FROM installmentinvoiceprofilestbl
       WHERE installmentinvoiceprofiles_id = $1
         AND student_id = $2
         AND class_id = $3
       RETURNING installmentinvoiceprofiles_id`,
      [REMOVE_PROFILE_ID, STUDENT_ID, REMOVE_CLASS_ID]
    );
    if (!delProf.rows.length) {
      throw new Error(`Failed to delete profile ${REMOVE_PROFILE_ID}`);
    }
    console.log(`✅ Deleted profile ${REMOVE_PROFILE_ID}`);

    const afterProfiles = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id AS profile_id, class_id, is_active
         FROM installmentinvoiceprofilestbl
         WHERE student_id = $1
         ORDER BY installmentinvoiceprofiles_id`,
        [STUDENT_ID]
      )
    ).rows;
    console.log('\nProfiles AFTER:');
    console.table(afterProfiles);

    const afterInv = (
      await client.query(
        `SELECT invoice_id, status, installmentinvoiceprofiles_id AS profile_id
         FROM invoicestbl WHERE invoice_id = $1`,
        [DOWNPAYMENT_INVOICE_ID]
      )
    ).rows[0];
    console.log('INV-2396 AFTER:', afterInv);

    const keepCs = (
      await client.query(
        `SELECT COUNT(*)::int AS count FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2`,
        [STUDENT_ID, KEEP_CLASS_ID]
      )
    ).rows[0].count;
    if (Number(keepCs) !== Number(keepEnrollments.count)) {
      throw new Error('Class 64 enrollment count changed — abort');
    }
    console.log(`✓ Class ${KEEP_CLASS_ID} enrollments untouched (${keepCs})`);

    if (afterProfiles.some((p) => Number(p.profile_id) === REMOVE_PROFILE_ID)) {
      throw new Error('Remove profile still present');
    }
    if (!afterProfiles.some((p) => Number(p.profile_id) === KEEP_PROFILE_ID)) {
      throw new Error('Keep profile missing after repair');
    }
    if (String(afterInv?.status).toLowerCase() !== 'cancelled') {
      throw new Error(`INV-2396 status ${afterInv?.status}, expected Cancelled`);
    }

    console.log('\nExpected:');
    console.log('  • Pending class 162 / profile 510 gone from Student History');
    console.log('  • INV-2396 Cancelled (unpaid DP)');
    console.log('  • Class 64 history + profile 135 unchanged');

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
