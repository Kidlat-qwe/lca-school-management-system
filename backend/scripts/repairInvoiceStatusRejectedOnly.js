/**
 * Set invoicestbl.status = 'Rejected' when the invoice has rejected payment(s)
 * and no completed non-rejected settlement (fixes Unpaid after finance rejection).
 *
 * Usage (from backend/):
 *   node scripts/repairInvoiceStatusRejectedOnly.js --dry-run
 *   node scripts/repairInvoiceStatusRejectedOnly.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { deriveInvoiceStatusForInvoice } from '../utils/invoicePaymentStatus.js';

const dryRun = !process.argv.includes('--apply');

async function main() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const candidates = await client.query(
      `SELECT i.invoice_id, i.status, i.amount,
              COALESCE((
                SELECT SUM(COALESCE(p.payable_amount, 0) + COALESCE(p.discount_amount, 0))
                FROM paymenttbl p
                WHERE p.invoice_id = i.invoice_id
                  AND p.status = 'Completed'
                  AND COALESCE(p.approval_status, 'Pending') <> 'Rejected'
              ), 0) AS total_settled
       FROM invoicestbl i
       WHERE EXISTS (
         SELECT 1 FROM paymenttbl pr
         WHERE pr.invoice_id = i.invoice_id
           AND COALESCE(pr.approval_status, '') = 'Rejected'
       )
       ORDER BY i.invoice_id`
    );

    let updated = 0;
    for (const row of candidates.rows) {
      const items = await client.query(
        `SELECT COALESCE(SUM(amount), 0) AS subtotal,
                COALESCE(SUM(discount_amount), 0) AS discount,
                COALESCE(SUM(penalty_amount), 0) AS penalty,
                COALESCE(SUM(amount * COALESCE(tax_percentage, 0) / 100), 0) AS tax
         FROM invoiceitemstbl WHERE invoice_id = $1`,
        [row.invoice_id]
      );
      const it = items.rows[0] || {};
      const originalAmount =
        parseFloat(it.subtotal || 0) -
        parseFloat(it.discount || 0) +
        parseFloat(it.penalty || 0) +
        parseFloat(it.tax || 0);

      const expected = await deriveInvoiceStatusForInvoice(client, row.invoice_id, {
        totalSettled: row.total_settled,
        originalInvoiceAmount: originalAmount,
        previousStatus: row.status,
      });

      if (expected === row.status) continue;

      console.log(
        `  Invoice ${row.invoice_id}: ${row.status} → ${expected} (settled=${row.total_settled})`
      );
      updated++;
      if (!dryRun) {
        await client.query(`UPDATE invoicestbl SET status = $1 WHERE invoice_id = $2`, [
          expected,
          row.invoice_id,
        ]);
      }
    }

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log(`\nDry run: ${updated} invoice(s) would change (rolled back).`);
    } else {
      await client.query('COMMIT');
      console.log(`\nCommitted: ${updated} invoice(s) updated.`);
    }
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
