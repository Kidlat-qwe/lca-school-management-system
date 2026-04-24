/**
 * One-off script: hard delete selected students from class + billing records.
 *
 * What it removes (target students only):
 * - classstudentstbl rows (hard delete; bypasses unenroll flow)
 * - paymenttbl rows tied to target invoices or target students
 * - installmentinvoicestbl rows for target installment profiles
 * - invoicestudentstbl rows for target invoices
 * - invoiceitemstbl rows for target invoices
 * - invoicestbl rows directly linked to target students/profiles (+ chain-linked balance invoices)
 * - installmentinvoiceprofilestbl rows for target students
 *
 * Notes:
 * - Uses a single transaction (all-or-nothing).
 * - This is intentionally destructive and irreversible.
 * - It does NOT mark students as dropped/unenrolled because records are deleted.
 *
 * Run:
 *   node backend/scripts/hardDeleteStudentsFromClassesAndBilling.js
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const isDryRun = process.argv.includes('--dry-run');

const TARGET_STUDENT_EMAILS = [
  'climacoedellyn@gmail.com',
];

async function main() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const studentResult = await client.query(
      `SELECT user_id, full_name, email
       FROM userstbl
       WHERE user_type = 'Student'
         AND email = ANY($1::text[])`,
      [TARGET_STUDENT_EMAILS]
    );

    if (studentResult.rows.length === 0) {
      console.log('No matching student accounts found for provided emails.');
      await client.query('ROLLBACK');
      return;
    }

    const students = studentResult.rows;
    const studentIds = students.map((s) => s.user_id);
    console.log('Target students:', students.map((s) => `${s.full_name} <${s.email}>`).join(', '));

    // 1) Collect target installment profiles by student.
    const profileResult = await client.query(
      `SELECT installmentinvoiceprofiles_id
       FROM installmentinvoiceprofilestbl
       WHERE student_id = ANY($1::int[])`,
      [studentIds]
    );
    const profileIds = profileResult.rows.map((r) => r.installmentinvoiceprofiles_id);

    // 2) Collect invoices directly tied to target students and installment profiles.
    const invoiceDirectResult = await client.query(
      `SELECT DISTINCT i.invoice_id
       FROM invoicestbl i
       LEFT JOIN invoicestudentstbl ist ON ist.invoice_id = i.invoice_id
       WHERE ist.student_id = ANY($1::int[])
          OR i.installmentinvoiceprofiles_id = ANY(COALESCE($2::int[], ARRAY[]::int[]))`,
      [studentIds, profileIds]
    );
    const baseInvoiceIds = invoiceDirectResult.rows.map((r) => r.invoice_id);

    // 3) Include chain-linked invoices (e.g., balance invoices).
    const chainInvoiceResult = await client.query(
      `SELECT DISTINCT i2.invoice_id
       FROM invoicestbl i2
       WHERE i2.invoice_id = ANY(COALESCE($1::int[], ARRAY[]::int[]))
          OR i2.invoice_chain_root_id = ANY(COALESCE($1::int[], ARRAY[]::int[]))`,
      [baseInvoiceIds]
    );
    const invoiceIds = chainInvoiceResult.rows.map((r) => r.invoice_id);

    // 4) Hard-delete enrollment records (bypasses dropped/unenrolled tracking).
    const classDelete = await client.query(
      `${isDryRun ? 'SELECT COUNT(*)::int AS count FROM classstudentstbl' : 'DELETE FROM classstudentstbl'}
       WHERE student_id = ANY($1::int[])`,
      [studentIds]
    );

    // 5) Delete payments tied to targeted students/invoices.
    const paymentDelete = await client.query(
      `${isDryRun ? 'SELECT COUNT(*)::int AS count FROM paymenttbl' : 'DELETE FROM paymenttbl'}
       WHERE student_id = ANY($1::int[])
          OR invoice_id = ANY(COALESCE($2::int[], ARRAY[]::int[]))`,
      [studentIds, invoiceIds]
    );

    // 6) Delete installment generated rows first, then profiles.
    const installmentInvoicesDelete = await client.query(
      `${isDryRun ? 'SELECT COUNT(*)::int AS count FROM installmentinvoicestbl' : 'DELETE FROM installmentinvoicestbl'}
       WHERE installmentinvoiceprofiles_id = ANY(COALESCE($1::int[], ARRAY[]::int[]))`,
      [profileIds]
    );

    // 7) Delete invoice children before invoices.
    const invoiceStudentsDelete = await client.query(
      `${isDryRun ? 'SELECT COUNT(*)::int AS count FROM invoicestudentstbl' : 'DELETE FROM invoicestudentstbl'}
       WHERE invoice_id = ANY(COALESCE($1::int[], ARRAY[]::int[]))
          OR student_id = ANY($2::int[])`,
      [invoiceIds, studentIds]
    );

    const invoiceItemsDelete = await client.query(
      `${isDryRun ? 'SELECT COUNT(*)::int AS count FROM invoiceitemstbl' : 'DELETE FROM invoiceitemstbl'}
       WHERE invoice_id = ANY(COALESCE($1::int[], ARRAY[]::int[]))`,
      [invoiceIds]
    );

    const invoicesDelete = await client.query(
      `${isDryRun ? 'SELECT COUNT(*)::int AS count FROM invoicestbl' : 'DELETE FROM invoicestbl'}
       WHERE invoice_id = ANY(COALESCE($1::int[], ARRAY[]::int[]))`,
      [invoiceIds]
    );

    const profileDelete = await client.query(
      `${isDryRun ? 'SELECT COUNT(*)::int AS count FROM installmentinvoiceprofilestbl' : 'DELETE FROM installmentinvoiceprofilestbl'}
       WHERE installmentinvoiceprofiles_id = ANY(COALESCE($1::int[], ARRAY[]::int[]))
          OR student_id = ANY($2::int[])`,
      [profileIds, studentIds]
    );

    const getAffected = (result) =>
      isDryRun ? (parseInt(result.rows?.[0]?.count, 10) || 0) : result.rowCount;

    if (isDryRun) {
      await client.query('ROLLBACK');
      console.log('DRY RUN ONLY (no data changed).');
      console.log(`- classstudentstbl would delete: ${getAffected(classDelete)}`);
      console.log(`- paymenttbl would delete: ${getAffected(paymentDelete)}`);
      console.log(`- installmentinvoicestbl would delete: ${getAffected(installmentInvoicesDelete)}`);
      console.log(`- invoicestudentstbl would delete: ${getAffected(invoiceStudentsDelete)}`);
      console.log(`- invoiceitemstbl would delete: ${getAffected(invoiceItemsDelete)}`);
      console.log(`- invoicestbl would delete: ${getAffected(invoicesDelete)}`);
      console.log(`- installmentinvoiceprofilestbl would delete: ${getAffected(profileDelete)}`);
    } else {
      await client.query('COMMIT');
      console.log('Hard delete completed successfully.');
      console.log(`- classstudentstbl deleted: ${getAffected(classDelete)}`);
      console.log(`- paymenttbl deleted: ${getAffected(paymentDelete)}`);
      console.log(`- installmentinvoicestbl deleted: ${getAffected(installmentInvoicesDelete)}`);
      console.log(`- invoicestudentstbl deleted: ${getAffected(invoiceStudentsDelete)}`);
      console.log(`- invoiceitemstbl deleted: ${getAffected(invoiceItemsDelete)}`);
      console.log(`- invoicestbl deleted: ${getAffected(invoicesDelete)}`);
      console.log(`- installmentinvoiceprofilestbl deleted: ${getAffected(profileDelete)}`);
    }
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Hard delete failed. Transaction rolled back.');
    console.error(error);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

