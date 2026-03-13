/**
 * Fix next_invoice_month to match the month of next_generation_date
 *
 * Sets next_invoice_month = first day of the month of next_generation_date
 * for all rows in installmentinvoicestbl where next_generation_date is not null.
 *
 * Usage (from backend folder):
 *   node scripts/fixNextInvoiceMonth.js           # Dry run (shows what would change)
 *   node scripts/fixNextInvoiceMonth.js --execute # Apply updates to database
 *
 * Uses DB config from .env (DB_HOST_PRODUCTION etc when NODE_ENV=production).
 * Ensure NODE_ENV is set correctly in .env before running.
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const EXECUTE = process.argv.includes('--execute');

async function main() {
  const client = await getClient();

  try {
    // 1. Fetch rows that need updating (next_invoice_month month differs from next_generation_date month)
    const checkResult = await client.query(
      `SELECT 
         ii.installmentinvoicedtl_id,
         ii.student_name,
         ii.next_generation_date,
         ii.next_invoice_month,
         to_char(date_trunc('month', ii.next_generation_date::date)::date, 'YYYY-MM-DD') AS correct_next_invoice_month
       FROM installmentinvoicestbl ii
       WHERE ii.next_generation_date IS NOT NULL
         AND (
           ii.next_invoice_month IS NULL
           OR ii.next_invoice_month::date != date_trunc('month', ii.next_generation_date::date)::date
         )
       ORDER BY ii.installmentinvoicedtl_id`
    );

    const rowsToUpdate = checkResult.rows;

    if (rowsToUpdate.length === 0) {
      console.log('✅ No rows need updating. All next_invoice_month values already match next_generation_date month.');
      return;
    }

    console.log(`\n📋 Found ${rowsToUpdate.length} row(s) that need updating:\n`);
    console.log('─'.repeat(100));
    console.log(
      'ID'.padEnd(8) +
        'Student'.padEnd(30) +
        'Next Gen'.padEnd(14) +
        'Current Next Month'.padEnd(20) +
        'Correct Next Month'
    );
    console.log('─'.repeat(100));

    const toStr = (v) => (v == null ? '' : typeof v === 'object' && v.toISOString ? v.toISOString().split('T')[0] : String(v));
    for (const row of rowsToUpdate) {
      console.log(
        String(row.installmentinvoicedtl_id).padEnd(8) +
          (row.student_name || '').substring(0, 28).padEnd(30) +
          toStr(row.next_generation_date).padEnd(14) +
          (row.next_invoice_month == null ? 'NULL' : toStr(row.next_invoice_month)).padEnd(20) +
          toStr(row.correct_next_invoice_month)
      );
    }
    console.log('─'.repeat(100));

    if (!EXECUTE) {
      console.log('\n⚠️  DRY RUN (no changes made). Run with --execute to apply updates:');
      console.log('   node scripts/fixNextInvoiceMonth.js --execute\n');
      return;
    }

    // 2. Apply the update
    const updateResult = await client.query(
      `UPDATE installmentinvoicestbl 
       SET next_invoice_month = date_trunc('month', next_generation_date::date)::date
       WHERE next_generation_date IS NOT NULL
         AND (
           next_invoice_month IS NULL
           OR next_invoice_month::date != date_trunc('month', next_generation_date::date)::date
         )`
    );

    console.log(`\n✅ Updated ${updateResult.rowCount} row(s) successfully.\n`);
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
