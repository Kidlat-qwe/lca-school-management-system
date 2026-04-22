import '../config/loadEnv.js';

const APPLY = process.argv.includes('--apply');

/**
 * Target adjustments requested:
 * - Althea Hera F. Evangelista -> 2026-04-06
 * - Everyone else in this list -> 2026-04-05
 */
const TARGET_DATES_BY_STUDENT = {
  'Althea Hera F. Evangelista': '2026-04-06',
  'Jacob V. Mateo': '2026-04-05',
  'Skyler Dawson L. Villanueva': '2026-04-05',
  'Anaiah Cali T. Mecija': '2026-04-05',
};

async function main() {
  const { getClient } = await import('../config/database.js');
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const names = Object.keys(TARGET_DATES_BY_STUDENT);
    const arRows = await client.query(
      `SELECT ack_receipt_id, prospect_student_name, ar_type, issue_date, invoice_id
       FROM acknowledgement_receiptstbl
       WHERE ar_type = 'Merchandise'
         AND prospect_student_name = ANY($1::text[])
       ORDER BY ack_receipt_id ASC`,
      [names]
    );

    if (arRows.rows.length === 0) {
      console.log('No matching merchandise acknowledgement receipts found.');
      await client.query('ROLLBACK');
      return;
    }

    console.log(`Matched ${arRows.rows.length} acknowledgement receipt(s):`);
    for (const row of arRows.rows) {
      const newDate = TARGET_DATES_BY_STUDENT[row.prospect_student_name];
      console.log(
        `- AR ${row.ack_receipt_id} | ${row.prospect_student_name} | old issue_date=${formatDate(row.issue_date)} | new issue_date=${newDate} | invoice_id=${row.invoice_id ?? 'N/A'}`
      );
    }

    if (!APPLY) {
      console.log('');
      console.log('Dry run only. No changes were saved.');
      console.log('Run with --apply to execute updates.');
      await client.query('ROLLBACK');
      return;
    }

    let updatedArCount = 0;
    let updatedInvoiceCount = 0;

    for (const row of arRows.rows) {
      const newDate = TARGET_DATES_BY_STUDENT[row.prospect_student_name];
      if (!newDate) continue;

      const arUpdate = await client.query(
        `UPDATE acknowledgement_receiptstbl
         SET issue_date = $1::date
         WHERE ack_receipt_id = $2`,
        [newDate, row.ack_receipt_id]
      );
      updatedArCount += arUpdate.rowCount || 0;

      if (row.invoice_id) {
        const invoiceUpdate = await client.query(
          `UPDATE invoicestbl
           SET issue_date = $1::date,
               due_date = $1::date
           WHERE invoice_id = $2`,
          [newDate, row.invoice_id]
        );
        updatedInvoiceCount += invoiceUpdate.rowCount || 0;
      }
    }

    await client.query('COMMIT');
    console.log('');
    console.log(`Done. Updated AR rows: ${updatedArCount}`);
    console.log(`Done. Updated Invoice rows: ${updatedInvoiceCount}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function formatDate(value) {
  if (!value) return 'N/A';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toISOString().slice(0, 10);
}

main().catch((error) => {
  console.error('Failed to update merchandise AR/invoice dates:', error?.message || error);
  process.exit(1);
});
