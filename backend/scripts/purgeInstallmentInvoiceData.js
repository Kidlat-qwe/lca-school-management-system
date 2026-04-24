/**
 * Global purge script for installment invoice module data.
 *
 * What this script deletes:
 * - All rows in installmentinvoicestbl
 * - All rows in installmentinvoiceprofilestbl
 *
 * What this script does NOT delete:
 * - invoicestbl rows
 * - paymenttbl rows
 * - invoiceitemstbl rows
 * - invoicestudentstbl rows
 *
 * Note:
 * - invoicestbl.installmentinvoiceprofiles_id has FK ON DELETE SET NULL,
 *   so linked invoices are preserved and auto-unlinked when profiles are removed.
 *
 * Usage:
 *   Dry run (default):
 *     node backend/scripts/purgeInstallmentInvoiceData.js
 *     node backend/scripts/purgeInstallmentInvoiceData.js --dry-run
 *
 *   Apply changes:
 *     node backend/scripts/purgeInstallmentInvoiceData.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const args = new Set(process.argv.slice(2));
const isApply = args.has('--apply');
const isDryRun = !isApply || args.has('--dry-run');

async function main() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const profileStatsResult = await client.query(`
      SELECT
        COUNT(*)::int AS total_profiles,
        COUNT(*) FILTER (WHERE is_active = true)::int AS active_profiles,
        COUNT(*) FILTER (WHERE is_active = false)::int AS inactive_profiles
      FROM installmentinvoiceprofilestbl
    `);

    const installmentInvoiceStatsResult = await client.query(`
      SELECT
        COUNT(*)::int AS total_installment_invoices,
        COUNT(*) FILTER (WHERE status = 'Pending')::int AS pending_count,
        COUNT(*) FILTER (WHERE status = 'Generated')::int AS generated_count
      FROM installmentinvoicestbl
    `);

    const linkedInvoicesResult = await client.query(`
      SELECT COUNT(*)::int AS linked_invoices
      FROM invoicestbl
      WHERE installmentinvoiceprofiles_id IS NOT NULL
    `);

    const linkedPaymentsResult = await client.query(`
      SELECT COUNT(*)::int AS linked_payments
      FROM paymenttbl p
      WHERE p.invoice_id IN (
        SELECT i.invoice_id
        FROM invoicestbl i
        WHERE i.installmentinvoiceprofiles_id IS NOT NULL
      )
    `);

    const profileStats = profileStatsResult.rows[0];
    const installmentStats = installmentInvoiceStatsResult.rows[0];
    const linkedInvoices = linkedInvoicesResult.rows[0];
    const linkedPayments = linkedPaymentsResult.rows[0];

    const deleteInstallmentInvoicesResult = await client.query(
      `${isDryRun ? 'SELECT COUNT(*)::int AS count FROM installmentinvoicestbl' : 'DELETE FROM installmentinvoicestbl'}`
    );

    const deleteProfilesResult = await client.query(
      `${isDryRun ? 'SELECT COUNT(*)::int AS count FROM installmentinvoiceprofilestbl' : 'DELETE FROM installmentinvoiceprofilestbl'}`
    );

    const getAffected = (result) =>
      isDryRun ? (parseInt(result.rows?.[0]?.count, 10) || 0) : result.rowCount;

    if (isDryRun) {
      await client.query('ROLLBACK');
      console.log('============================================================');
      console.log('DRY RUN: purgeInstallmentInvoiceData.js');
      console.log(`NODE_ENV: ${process.env.NODE_ENV || 'undefined'}`);
      console.log('No data was changed.');
      console.log('============================================================');
      console.log(`Profiles total: ${profileStats.total_profiles}`);
      console.log(`- Active profiles: ${profileStats.active_profiles}`);
      console.log(`- Inactive profiles: ${profileStats.inactive_profiles}`);
      console.log(`Installment invoice logs total: ${installmentStats.total_installment_invoices}`);
      console.log(`- Pending: ${installmentStats.pending_count}`);
      console.log(`- Generated: ${installmentStats.generated_count}`);
      console.log(`Linked invoices (will be unlinked, not deleted): ${linkedInvoices.linked_invoices}`);
      console.log(`Payments tied to linked invoices (will remain): ${linkedPayments.linked_payments}`);
      console.log('------------------------------------------------------------');
      console.log(`Would delete from installmentinvoicestbl: ${getAffected(deleteInstallmentInvoicesResult)}`);
      console.log(`Would delete from installmentinvoiceprofilestbl: ${getAffected(deleteProfilesResult)}`);
      console.log('============================================================');
      console.log('To execute for real, run with: --apply');
    } else {
      await client.query('COMMIT');
      console.log('============================================================');
      console.log('APPLY MODE: purgeInstallmentInvoiceData.js');
      console.log(`NODE_ENV: ${process.env.NODE_ENV || 'undefined'}`);
      console.log('Purge completed successfully.');
      console.log('============================================================');
      console.log(`Deleted from installmentinvoicestbl: ${getAffected(deleteInstallmentInvoicesResult)}`);
      console.log(`Deleted from installmentinvoiceprofilestbl: ${getAffected(deleteProfilesResult)}`);
      console.log(`Previously linked invoices auto-unlinked: ${linkedInvoices.linked_invoices}`);
      console.log('============================================================');
    }
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Purge failed. Transaction rolled back.');
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
