/**
 * Read-only: how many invoices lost invoice_ar_number and whether we can infer values.
 * Run: node backend/scripts/analyzeClearedInvoiceArNumbers.js
 */

import '../config/loadEnv.js';
import { query } from '../config/database.js';

const INVOICE_ONLY_NOT_LINKED_SQL = `
  NOT EXISTS (
    SELECT 1 FROM acknowledgement_receiptstbl ar
    WHERE ar.invoice_id = i.invoice_id
       OR (i.ack_receipt_id IS NOT NULL AND ar.ack_receipt_id = i.ack_receipt_id)
       OR EXISTS (
         SELECT 1 FROM paymenttbl pay
         WHERE pay.invoice_id = i.invoice_id AND pay.payment_id = ar.payment_id
       )
       OR (
         TRIM(COALESCE(ar.ack_receipt_number, '')) <> ''
         AND TRIM(ar.ack_receipt_number) = TRIM(i.invoice_ar_number)
       )
       OR (
         i.ack_receipt_id IS NOT NULL
         AND ar.paired_ack_receipt_id IS NOT NULL
         AND ar.paired_ack_receipt_id = i.ack_receipt_id
       )
  )
`;

async function main() {
  const nullArPaid = await query(`
    SELECT COUNT(*)::int AS n
    FROM invoicestbl i
    WHERE (i.invoice_ar_number IS NULL OR TRIM(i.invoice_ar_number) = '')
      AND UPPER(TRIM(COALESCE(i.status, ''))) = 'PAID'
  `);

  const nullArPaidWithPayment = await query(`
    SELECT COUNT(DISTINCT i.invoice_id)::int AS n
    FROM invoicestbl i
    INNER JOIN paymenttbl p ON p.invoice_id = i.invoice_id
      AND UPPER(TRIM(COALESCE(p.status, ''))) = 'COMPLETED'
    WHERE (i.invoice_ar_number IS NULL OR TRIM(i.invoice_ar_number) = '')
  `);

  const stillGhost = await query(`
    SELECT COUNT(*)::int AS n
    FROM invoicestbl i
    WHERE i.invoice_ar_number IS NOT NULL
      AND TRIM(i.invoice_ar_number) <> ''
      AND ${INVOICE_ONLY_NOT_LINKED_SQL.replace(/\n/g, ' ')}
  `);

  const paymentRefSixDigit = await query(`
    SELECT COUNT(DISTINCT i.invoice_id)::int AS n
    FROM invoicestbl i
    INNER JOIN paymenttbl p ON p.invoice_id = i.invoice_id
    WHERE (i.invoice_ar_number IS NULL OR TRIM(i.invoice_ar_number) = '')
      AND p.reference_number ~ '(^|[^0-9])([0-9]{6})([^0-9]|$)'
  `);

  const ackNumberOnLinkedInvoice = await query(`
    SELECT COUNT(DISTINCT i.invoice_id)::int AS n
    FROM invoicestbl i
    INNER JOIN acknowledgement_receiptstbl ar ON ar.invoice_id = i.invoice_id
    WHERE (i.invoice_ar_number IS NULL OR TRIM(i.invoice_ar_number) = '')
      AND TRIM(COALESCE(ar.ack_receipt_number, '')) ~ '^[0-9]{6}$'
  `);

  const sample = await query(`
    SELECT i.invoice_id,
           i.invoice_description,
           i.status,
           p.reference_number,
           ar.ack_receipt_number
    FROM invoicestbl i
    LEFT JOIN LATERAL (
      SELECT reference_number
      FROM paymenttbl
      WHERE invoice_id = i.invoice_id
        AND UPPER(TRIM(COALESCE(status, ''))) = 'COMPLETED'
      ORDER BY payment_id DESC
      LIMIT 1
    ) p ON TRUE
    LEFT JOIN acknowledgement_receiptstbl ar ON ar.invoice_id = i.invoice_id
    WHERE (i.invoice_ar_number IS NULL OR TRIM(i.invoice_ar_number) = '')
      AND UPPER(TRIM(COALESCE(i.status, ''))) = 'PAID'
    ORDER BY i.invoice_id DESC
    LIMIT 8
  `);

  console.log('=== Cleared invoice_ar_number analysis (read-only) ===\n');
  console.log(`Paid invoices with NULL invoice_ar_number: ${nullArPaid.rows[0].n}`);
  console.log(`NULL AR# with completed payment: ${nullArPaidWithPayment.rows[0].n}`);
  console.log(`Still ghost (AR# set, no AR record): ${stillGhost.rows[0].n}`);
  console.log(`NULL AR# — payment ref contains 6-digit number: ${paymentRefSixDigit.rows[0].n}`);
  console.log(`NULL AR# — linked ack_receipt_number (6-digit): ${ackNumberOnLinkedInvoice.rows[0].n}`);
  console.log('\nSample recent paid invoices with NULL AR#:');
  for (const row of sample.rows) {
    console.log(
      `  INV-${row.invoice_id} | ${String(row.invoice_description || '').slice(0, 50)} | ref=${row.reference_number || '—'} | ack=${row.ack_receipt_number || '—'}`
    );
  }
  console.log(
    '\nConclusion: invoice_ar_number for ghost rows existed only on invoicestbl — full revert needs Neon PITR or dry-run backup export.'
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
