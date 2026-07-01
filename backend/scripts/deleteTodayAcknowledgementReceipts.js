import '../config/loadEnv.js';

const APPLY = process.argv.includes('--apply');
const INCLUDE_APPLIED = process.argv.includes('--include-applied');
const TARGET_DATE_ARG = process.argv.find((arg) => arg.startsWith('--date=')) || '';
const TARGET_DATE = TARGET_DATE_ARG ? TARGET_DATE_ARG.split('=')[1] : null;

function getTodayManilaYmd() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

function printUsage() {
  console.log('Delete acknowledgement receipts for a specific date (default: today Manila).');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/deleteTodayAcknowledgementReceipts.js [--date=YYYY-MM-DD] [--include-applied] [--apply]');
  console.log('');
  console.log('Options:');
  console.log('  --date=YYYY-MM-DD   Override target date. Default is today in Asia/Manila.');
  console.log('  --include-applied   Also delete rows with invoice_id/payment_id or status Applied.');
  console.log('  --apply             Execute deletion. Without this flag, script is dry-run only.');
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printUsage();
  process.exit(0);
}

async function main() {
  const targetDate = TARGET_DATE || getTodayManilaYmd();
  const { getClient } = await import('../config/database.js');
  const client = await getClient();

  try {
    await client.query('BEGIN');

    const result = await client.query(
      `SELECT ack_receipt_id, prospect_student_name, ar_type, status, issue_date, invoice_id, payment_id
       FROM acknowledgement_receiptstbl
       WHERE issue_date = $1::date
       ORDER BY ack_receipt_id ASC`,
      [targetDate]
    );

    if (result.rows.length === 0) {
      console.log(`No acknowledgement receipts found for ${targetDate}.`);
      await client.query('ROLLBACK');
      return;
    }

    const linkedRows = result.rows.filter(
      (row) =>
        row.invoice_id != null ||
        row.payment_id != null ||
        String(row.status || '').trim().toUpperCase() === 'APPLIED'
    );
    const deletableRows = INCLUDE_APPLIED
      ? result.rows
      : result.rows.filter(
          (row) =>
            row.invoice_id == null &&
            row.payment_id == null &&
            String(row.status || '').trim().toUpperCase() !== 'APPLIED'
        );

    console.log(`Target date: ${targetDate}`);
    console.log(`Matched rows: ${result.rows.length}`);
    console.log(`Deletable rows: ${deletableRows.length}`);
    console.log(`Linked/applied rows: ${linkedRows.length}${INCLUDE_APPLIED ? ' (included due to --include-applied)' : ' (skipped)'}`);
    console.log('');

    for (const row of result.rows) {
      const marker =
        !INCLUDE_APPLIED &&
        (row.invoice_id != null || row.payment_id != null || String(row.status || '').trim().toUpperCase() === 'APPLIED')
          ? '[SKIP]'
          : '[DEL]';
      console.log(
        `${marker} AR ${row.ack_receipt_id} | ${row.prospect_student_name || 'N/A'} | ${row.ar_type || 'N/A'} | status=${row.status || 'N/A'} | invoice_id=${row.invoice_id ?? 'null'} | payment_id=${row.payment_id ?? 'null'}`
      );
    }

    if (!APPLY) {
      console.log('');
      console.log('Dry run only. No rows were deleted.');
      console.log('Add --apply to execute.');
      await client.query('ROLLBACK');
      return;
    }

    if (deletableRows.length === 0) {
      console.log('');
      console.log('No rows eligible for deletion with current flags.');
      await client.query('ROLLBACK');
      return;
    }

    const ids = deletableRows.map((row) => row.ack_receipt_id);
    const deleteResult = await client.query(
      `DELETE FROM acknowledgement_receiptstbl
       WHERE ack_receipt_id = ANY($1::int[])`,
      [ids]
    );

    await client.query('COMMIT');
    console.log('');
    console.log(`Deleted ${deleteResult.rowCount || 0} acknowledgement receipt row(s).`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

main().catch((error) => {
  console.error('Failed to delete acknowledgement receipts by date:', error?.message || error);
  process.exit(1);
});

