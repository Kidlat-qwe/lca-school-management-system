/**
 * One-off script: Sync installmentinvoiceprofilestbl.generated_count
 * to the actual number of generated installment invoices in invoicestbl,
 * excluding the downpayment invoice.
 *
 * Why this matters:
 * - The "Generate Invoice - Single" modal uses generated_count for phase progress
 *   and date computation.
 * - If generated_count is ahead of the real invoice count, the modal shows the
 *   wrong phase progress and wrong due / invoice month values.
 *
 * Dry run:
 *   node backend/scripts/fixInstallmentProfileGeneratedCount.js
 *
 * Apply:
 *   node backend/scripts/fixInstallmentProfileGeneratedCount.js --apply
 *
 * Optional filters:
 *   node backend/scripts/fixInstallmentProfileGeneratedCount.js --student="Athena Louise Manuel"
 *   node backend/scripts/fixInstallmentProfileGeneratedCount.js --profile=69
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const APPLY = process.argv.includes('--apply');

const getArgValue = (prefix) => {
  const match = process.argv.find((arg) => arg.startsWith(`${prefix}=`));
  return match ? match.slice(prefix.length + 1) : null;
};

const STUDENT_FILTER = getArgValue('--student');
const PROFILE_FILTER = getArgValue('--profile');

async function main() {
  const client = await getClient();

  try {
    const filters = [];
    const params = [];

    if (STUDENT_FILTER) {
      params.push(STUDENT_FILTER);
      filters.push(`u.full_name = $${params.length}`);
    }

    if (PROFILE_FILTER) {
      params.push(Number(PROFILE_FILTER));
      filters.push(`ip.installmentinvoiceprofiles_id = $${params.length}`);
    }

    const whereSql = filters.length ? ` AND ${filters.join(' AND ')}` : '';

    const result = await client.query(
      `SELECT ip.installmentinvoiceprofiles_id,
              ip.student_id,
              ip.generated_count,
              ip.total_phases,
              ip.downpayment_invoice_id,
              ip.is_active,
              u.full_name AS student_name,
              (
                SELECT COUNT(*)
                FROM invoicestbl i
                WHERE i.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
                  AND (ip.downpayment_invoice_id IS NULL OR i.invoice_id != ip.downpayment_invoice_id::INTEGER)
              ) AS actual_generated_count
       FROM installmentinvoiceprofilestbl ip
       LEFT JOIN userstbl u ON ip.student_id = u.user_id
       WHERE 1=1 ${whereSql}
       ORDER BY u.full_name ASC, ip.installmentinvoiceprofiles_id ASC`,
      params
    );

    if (result.rows.length === 0) {
      console.log('No installment profiles found for the given filters.');
      return;
    }

    const mismatches = result.rows.filter(
      (row) => Number(row.generated_count || 0) !== Number(row.actual_generated_count || 0)
    );

    console.log(`Scanned ${result.rows.length} installment profile(s).`);
    console.log(`Found ${mismatches.length} profile(s) with wrong generated_count.`);

    if (mismatches.length > 0) {
      console.table(
        mismatches.map((row) => ({
          profile_id: row.installmentinvoiceprofiles_id,
          student: row.student_name,
          stored_generated_count: Number(row.generated_count || 0),
          actual_generated_count: Number(row.actual_generated_count || 0),
          total_phases: row.total_phases,
          downpayment_invoice_id: row.downpayment_invoice_id,
          is_active: row.is_active,
        }))
      );
    }

    if (!APPLY) {
      console.log('Dry run only. Re-run with --apply to update the profiles above.');
      return;
    }

    await client.query('BEGIN');
    let updated = 0;

    try {
      for (const row of mismatches) {
        await client.query(
          `UPDATE installmentinvoiceprofilestbl
           SET generated_count = $1
           WHERE installmentinvoiceprofiles_id = $2`,
          [Number(row.actual_generated_count || 0), row.installmentinvoiceprofiles_id]
        );
        updated += 1;
      }

      await client.query('COMMIT');
      console.log(`Updated ${updated} installment profile(s).`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    client.release();
  }
}

main()
  .then(() => {
    console.log('Done.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Failed to sync installment generated_count:', error);
    process.exit(1);
  });
