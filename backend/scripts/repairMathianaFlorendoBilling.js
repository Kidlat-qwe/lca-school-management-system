/**
 * Repair Mathiana Victoria Reyes Florendo — remove duplicate plan 1 (profile 348),
 * keep plan 2 (profile 350), fix phase 1/2 enrollment statuses.
 *
 * Usage:
 *   node scripts/repairMathianaFlorendoBilling.js
 *   node scripts/repairMathianaFlorendoBilling.js --apply
 */
import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { PROGRAM_ENROLLMENT_STATUS } from '../utils/enrollmentStatus.js';

const STUDENT_ID = 554;
const CLASS_ID = 128;
const REMOVE_PROFILE_ID = 348; // Plan 1
const KEEP_PROFILE_ID = 350; // Plan 2
const UNPAID_PLAN1_INVOICES = [973, 1923];
const PLAN1_DOWNPAYMENT_INVOICE = 969;
const REPAIR_NOTE = 'Ops repair — remove duplicate installment plan 1; align plan 2 enrollments';

const isApply = process.argv.includes('--apply');

async function preview() {
  const profiles = await query(
    `SELECT installmentinvoiceprofiles_id, is_active, generated_count, downpayment_paid, downpayment_invoice_id
     FROM installmentinvoiceprofilestbl WHERE student_id = $1 ORDER BY installmentinvoiceprofiles_id`,
    [STUDENT_ID]
  );
  const enrollments = await query(
    `SELECT classstudent_id, phase_number, program_enrollment_status, removed_at
     FROM classstudentstbl WHERE student_id = $1 AND class_id = $2 ORDER BY phase_number`,
    [STUDENT_ID, CLASS_ID]
  );
  const invoices = await query(
    `SELECT i.invoice_id, i.installmentinvoiceprofiles_id, i.status, i.invoice_description
     FROM invoicestbl i
     JOIN invoicestudentstbl ist ON ist.invoice_id = i.invoice_id
     WHERE ist.student_id = $1
     ORDER BY i.invoice_id`,
    [STUDENT_ID]
  );
  console.log('Profiles:', profiles.rows);
  console.log('Enrollments:', enrollments.rows);
  console.log('Invoices:', invoices.rows);
}

async function main() {
  console.log(`\nMathiana Florendo billing repair${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`);
  console.log('Before:');
  await preview();

  if (!isApply) {
    console.log('\nPlanned changes:');
    console.log(`- Delete installment schedule rows for profile ${REMOVE_PROFILE_ID}`);
    console.log(`- Delete unpaid plan-1 invoices ${UNPAID_PLAN1_INVOICES.join(', ')}`);
    console.log(`- Cancel downpayment invoice ${PLAN1_DOWNPAYMENT_INVOICE} (paid record kept)`);
    console.log(`- Delete profile ${REMOVE_PROFILE_ID}`);
    console.log(`- Activate profile ${KEEP_PROFILE_ID} (generated_count=2, downpayment_paid=true)`);
    console.log('- Phase 1 enrollment -> new (clear removed_at)');
    console.log('- Phase 2 enrollment -> re_enrolled (clear removed_at)');
    console.log('\nRe-run with --apply to execute.');
    return;
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    await client.query(
      `DELETE FROM installmentinvoicestbl WHERE installmentinvoiceprofiles_id = $1`,
      [REMOVE_PROFILE_ID]
    );

    for (const invoiceId of UNPAID_PLAN1_INVOICES) {
      await client.query(`DELETE FROM program_payment_statustbl WHERE invoice_id = $1`, [invoiceId]);
      await client.query(`DELETE FROM invoiceitemstbl WHERE invoice_id = $1`, [invoiceId]);
      await client.query(`DELETE FROM invoicestudentstbl WHERE invoice_id = $1`, [invoiceId]);
      await client.query(`DELETE FROM invoicestbl WHERE invoice_id = $1`, [invoiceId]);
    }

    await client.query(
      `UPDATE invoicestbl
       SET status = 'Cancelled',
           remarks = COALESCE(remarks, '') || ';${REPAIR_NOTE} — superseded by plan 2'
       WHERE invoice_id = $1`,
      [PLAN1_DOWNPAYMENT_INVOICE]
    );

    await client.query(
      `UPDATE installmentinvoiceprofilestbl SET downpayment_invoice_id = NULL WHERE installmentinvoiceprofiles_id = $1`,
      [REMOVE_PROFILE_ID]
    );

    await client.query(`DELETE FROM program_payment_statustbl WHERE installmentinvoiceprofiles_id = $1`, [
      REMOVE_PROFILE_ID,
    ]);

    await client.query(
      `DELETE FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`,
      [REMOVE_PROFILE_ID]
    );

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET is_active = true,
           generated_count = 2,
           downpayment_paid = true
       WHERE installmentinvoiceprofiles_id = $1`,
      [KEEP_PROFILE_ID]
    );

    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = $1,
           removed_at = NULL,
           enrolled_by = COALESCE(enrolled_by, $4)
       WHERE classstudent_id = (
         SELECT classstudent_id FROM classstudentstbl
         WHERE student_id = $2 AND class_id = $3 AND phase_number = 1
         ORDER BY classstudent_id DESC LIMIT 1
       )`,
      [PROGRAM_ENROLLMENT_STATUS.NEW, STUDENT_ID, CLASS_ID, REPAIR_NOTE]
    );

    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = $1,
           removed_at = NULL,
           enrolled_by = COALESCE(enrolled_by, $4)
       WHERE classstudent_id = (
         SELECT classstudent_id FROM classstudentstbl
         WHERE student_id = $2 AND class_id = $3 AND phase_number = 2
         ORDER BY classstudent_id DESC LIMIT 1
       )`,
      [PROGRAM_ENROLLMENT_STATUS.RE_ENROLLED, STUDENT_ID, CLASS_ID, REPAIR_NOTE]
    );

    await client.query('COMMIT');
    console.log('\n✅ Repair applied.\nAfter:');
    await preview();
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
    console.error(err);
    process.exit(1);
  });
