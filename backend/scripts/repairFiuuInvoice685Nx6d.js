/**
 * One-off repair: FIUU portal shows Captured for PSMS-I-685-NX6D but CMS never got notify
 * (gateway row still pending, raw_webhook null).
 *
 * Usage: node scripts/repairFiuuInvoice685Nx6d.js
 */
import '../config/loadEnv.js';
import { query, getClient } from '../config/database.js';
import {
  applyGatewayInvoiceFullPayment,
  runPostCommitInstallmentJobs,
} from '../services/fiuu/applyGatewayInvoicePayment.js';
import { sendInvoicePaymentConfirmationByInvoiceId } from '../utils/paymentConfirmationEmailService.js';

const ORDERID = 'PSMS-I-685-NX6D';
const TRAN_ID = '3967371593';

async function main() {
  const found = await query(
    `SELECT * FROM gateway_paymentstbl WHERE orderid = $1 LIMIT 1`,
    [ORDERID]
  );
  const row = found.rows[0];
  if (!row) {
    console.error('Gateway row not found:', ORDERID);
    process.exit(1);
  }
  console.log('Before:', {
    status: row.status,
    amount: row.amount,
    payment_id: row.payment_id,
    has_webhook: Boolean(row.raw_webhook),
  });

  if (row.status === 'paid' && row.payment_id) {
    console.log('Already paid in CMS. Nothing to do.');
    process.exit(0);
  }

  const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const tipApplied = Math.max(0, parseFloat(meta.tip_amount) || 0);
  const discountApplied = Math.max(0, parseFloat(meta.discount_amount) || 0);
  const netPayable =
    meta.net_payable != null
      ? Math.max(0, parseFloat(meta.net_payable) || 0)
      : Math.max(0, (parseFloat(row.amount) || 0) - tipApplied);

  const client = await getClient();
  let applyResult;
  try {
    await client.query('BEGIN');
    applyResult = await applyGatewayInvoiceFullPayment(client, {
      invoice_id: row.invoice_id,
      student_id: row.student_id,
      payable_amount: netPayable,
      discount_amount: discountApplied,
      tip_amount: tipApplied,
      reference_number: TRAN_ID,
      payment_method: 'FIUU Online',
      fiuu_channel: meta.channel || 'QRPH',
      created_by: row.created_by,
      issue_date: new Date(),
      remarks: row.description_sent || `Repaired FIUU payment ${ORDERID}`,
    });

    await client.query(
      `UPDATE gateway_paymentstbl
       SET status = 'paid',
           fiuu_tran_id = $1,
           fiuu_channel = $2,
           payment_id = $3,
           raw_webhook = $4::jsonb,
           paid_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE gateway_payment_id = $5`,
      [
        TRAN_ID,
        meta.channel || 'QRPH',
        applyResult.payment_id || null,
        JSON.stringify({
          repaired: true,
          source: 'repairFiuuInvoice685Nx6d.js',
          orderid: ORDERID,
          tranID: TRAN_ID,
          status: '00',
          amount: row.amount,
          note: 'Manual repair: FIUU portal Captured but notify never reached CMS',
        }),
        row.gateway_payment_id,
      ]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  if (applyResult && !applyResult.alreadyProcessed) {
    await runPostCommitInstallmentJobs(applyResult);
    try {
      const emailClient = await getClient();
      try {
        await sendInvoicePaymentConfirmationByInvoiceId(emailClient, applyResult.invoice_id);
      } finally {
        emailClient.release();
      }
    } catch (emailErr) {
      console.warn('Payment confirmation email skipped:', emailErr?.message || emailErr);
    }
  }

  const inv = await query(`SELECT invoice_id, status, amount FROM invoicestbl WHERE invoice_id = $1`, [
    row.invoice_id,
  ]);
  console.log('After invoice:', inv.rows[0]);
  console.log('Payment id:', applyResult?.payment_id);
  console.log('Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
