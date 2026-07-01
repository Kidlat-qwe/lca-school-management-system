/**
 * One-off script: Fix wrong next_generation_date and next_invoice_month
 * in installmentinvoicestbl based on class start date and generated_count.
 *
 * Business rule used:
 * - Phase 1 invoice is tied to the class start month.
 * - After a phase has already been generated, the log row should point to the
 *   month for the next cycle using the class start month as the anchor.
 * - For generated_count = 1 and class start = 2026-03-03:
 *     next_generation_date = 2026-03-25
 *     next_invoice_month   = 2026-03-01
 *
 * Formula:
 * - anchorMonth = first day of class start month
 * - offsetMonths = max(generated_phases - 1, 0) * frequencyMonths
 * - next_invoice_month = anchorMonth + offsetMonths
 * - next_generation_date = 25th day of next_invoice_month
 *
 * Important:
 * - This script intentionally uses the REAL generated phase count derived from
 *   invoicestbl (excluding the downpayment invoice), not ip.generated_count.
 *   The profile counter can already be wrong, which is exactly what we are fixing around.
 *
 * Dry-run by default:
 *   node backend/scripts/fixInstallmentInvoiceNextDates.js
 *
 * Apply updates:
 *   node backend/scripts/fixInstallmentInvoiceNextDates.js --apply
 *
 * Optional filters:
 *   node backend/scripts/fixInstallmentInvoiceNextDates.js --student="Athena Louise Manuel"
 *   node backend/scripts/fixInstallmentInvoiceNextDates.js --profile=123
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { formatYmdLocal, parseYmdToLocalNoon } from '../utils/dateUtils.js';

const APPLY = process.argv.includes('--apply');

const getArgValue = (prefix) => {
  const match = process.argv.find((arg) => arg.startsWith(`${prefix}=`));
  return match ? match.slice(prefix.length + 1) : null;
};

const STUDENT_FILTER = getArgValue('--student');
const PROFILE_FILTER = getArgValue('--profile');

const parseFrequencyMonths = (frequency) => {
  if (!frequency) return 1;
  const match = String(frequency).match(/(\d+)\s*month/i);
  return match ? Math.max(parseInt(match[1], 10) || 1, 1) : 1;
};

const addMonthsKeepingFirstDay = (dateObj, monthsToAdd) => {
  const d = new Date(dateObj);
  d.setDate(1);
  d.setMonth(d.getMonth() + monthsToAdd);
  d.setHours(12, 0, 0, 0);
  return d;
};

const buildExpectedDates = ({ classStartDate, generatedPhases, frequency }) => {
  const classStart = parseYmdToLocalNoon(classStartDate);
  if (!classStart) return null;

  const anchorMonth = new Date(classStart.getFullYear(), classStart.getMonth(), 1, 12, 0, 0, 0);
  const frequencyMonths = parseFrequencyMonths(frequency);
  const offsetMonths = Math.max((Number(generatedPhases) || 0) - 1, 0) * frequencyMonths;
  const nextInvoiceMonth = addMonthsKeepingFirstDay(anchorMonth, offsetMonths);
  const nextGenerationDate = new Date(nextInvoiceMonth);
  nextGenerationDate.setDate(25);

  return {
    expectedNextInvoiceMonth: formatYmdLocal(nextInvoiceMonth),
    expectedNextGenerationDate: formatYmdLocal(nextGenerationDate),
  };
};

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

    const whereSql = filters.length > 0 ? ` AND ${filters.join(' AND ')}` : '';

    const result = await client.query(
      `SELECT ii.installmentinvoicedtl_id,
              ii.installmentinvoiceprofiles_id,
              ii.next_generation_date,
              ii.next_invoice_month,
              ii.frequency AS row_frequency,
              ii.status AS row_status,
              ip.generated_count,
              ip.total_phases,
              ip.is_active,
              ip.downpayment_invoice_id,
              ip.frequency AS profile_frequency,
              ip.class_id,
              u.full_name AS student_name,
              c.start_date::text AS class_start_date,
              (
                SELECT COUNT(*)
                FROM invoicestbl i
                WHERE i.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
                  AND (ip.downpayment_invoice_id IS NULL OR i.invoice_id != ip.downpayment_invoice_id::INTEGER)
              ) AS generated_phases
       FROM installmentinvoicestbl ii
       INNER JOIN installmentinvoiceprofilestbl ip
         ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
       LEFT JOIN classestbl c
         ON ip.class_id = c.class_id
       LEFT JOIN userstbl u
         ON ip.student_id = u.user_id
       WHERE ip.class_id IS NOT NULL
         AND c.start_date IS NOT NULL
         AND ii.next_generation_date IS NOT NULL
         AND ii.next_invoice_month IS NOT NULL
         ${whereSql}
       ORDER BY u.full_name ASC, ii.installmentinvoicedtl_id ASC`,
      params
    );

    if (result.rows.length === 0) {
      console.log('No installment invoice log rows found for the given filters.');
      return;
    }

    const candidates = [];
    const skipped = [];

    for (const row of result.rows) {
      const expected = buildExpectedDates({
        classStartDate: row.class_start_date,
        generatedPhases: row.generated_phases,
        frequency: row.row_frequency || row.profile_frequency || '1 month(s)',
      });

      if (!expected) {
        skipped.push({
          installmentinvoicedtl_id: row.installmentinvoicedtl_id,
          student_name: row.student_name,
          reason: 'Could not derive expected dates',
        });
        continue;
      }

      const currentNextGenerationDate = String(row.next_generation_date).slice(0, 10);
      const currentNextInvoiceMonth = String(row.next_invoice_month).slice(0, 10);

      if (
        currentNextGenerationDate !== expected.expectedNextGenerationDate ||
        currentNextInvoiceMonth !== expected.expectedNextInvoiceMonth
      ) {
        candidates.push({
          installmentinvoicedtl_id: row.installmentinvoicedtl_id,
          installmentinvoiceprofiles_id: row.installmentinvoiceprofiles_id,
          student_name: row.student_name,
          generated_count: row.generated_count,
          generated_phases: row.generated_phases,
          total_phases: row.total_phases,
          is_active: row.is_active,
          class_start_date: String(row.class_start_date).slice(0, 10),
          frequency: row.row_frequency || row.profile_frequency || '1 month(s)',
          current_next_generation_date: currentNextGenerationDate,
          expected_next_generation_date: expected.expectedNextGenerationDate,
          current_next_invoice_month: currentNextInvoiceMonth,
          expected_next_invoice_month: expected.expectedNextInvoiceMonth,
        });
      }
    }

    console.log(`Scanned ${result.rows.length} installment invoice log row(s).`);
    console.log(`Found ${candidates.length} row(s) with wrong next dates.`);
    if (skipped.length > 0) {
      console.log(`Skipped ${skipped.length} row(s) because expected dates could not be derived.`);
    }

    if (candidates.length > 0) {
      console.table(
        candidates.map((row) => ({
          log_id: row.installmentinvoicedtl_id,
          profile_id: row.installmentinvoiceprofiles_id,
          student: row.student_name,
          generated_count: row.generated_count,
          generated_phases: row.generated_phases,
          class_start: row.class_start_date,
          frequency: row.frequency,
          next_generation_from: row.current_next_generation_date,
          next_generation_to: row.expected_next_generation_date,
          next_month_from: row.current_next_invoice_month,
          next_month_to: row.expected_next_invoice_month,
        }))
      );
    }

    if (!APPLY) {
      console.log('Dry run only. Re-run with --apply to update the rows above.');
      return;
    }

    let updatedCount = 0;
    await client.query('BEGIN');

    try {
      for (const row of candidates) {
        await client.query(
          `UPDATE installmentinvoicestbl
           SET next_generation_date = $1,
               next_invoice_month = $2
           WHERE installmentinvoicedtl_id = $3`,
          [
            row.expected_next_generation_date,
            row.expected_next_invoice_month,
            row.installmentinvoicedtl_id,
          ]
        );
        updatedCount += 1;
      }

      await client.query('COMMIT');
      console.log(`Updated ${updatedCount} installment invoice log row(s).`);
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
    console.error('Failed to fix installment invoice next dates:', error);
    process.exit(1);
  });
