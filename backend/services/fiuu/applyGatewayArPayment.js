/**
 * Apply FIUU success to a pending Merchandise/Package acknowledgement receipt.
 */
import { paymenttblHasActionOwnerUserIdColumn } from '../../utils/paymentSchema.js';
import { AR_STATUS } from '../../utils/acknowledgementReceiptStatus.js';
import {
  MERCH_RELEASE_SOURCE,
  buildMerchandiseArReleaseBatchId,
  insertMerchandiseReleaseLog,
} from '../../lib/merchandiseReleaseLog.js';
import { query } from '../../config/database.js';
import { FIUU_AR_PAYMENT_METHOD } from './createFiuuArPayment.js';

let ackVerifierColumnsKnownTrue = false;

async function ackReceiptHasVerifierColumns() {
  if (ackVerifierColumnsKnownTrue) return true;
  try {
    const r = await query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'acknowledgement_receiptstbl'
         AND column_name IN ('verified_by_user_id', 'verified_at')
       GROUP BY table_name
       HAVING COUNT(DISTINCT column_name) = 2
       LIMIT 1`
    );
    if (r.rows.length > 0) {
      ackVerifierColumnsKnownTrue = true;
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function parseMerchSnapshot(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * @param {import('pg').PoolClient} client
 * @param {object} params
 */
export async function applyGatewayArPayment(client, params) {
  const {
    ack_receipt_id,
    reference_number,
    fiuu_channel,
    created_by,
    issue_date,
  } = params;

  const ackId = parseInt(ack_receipt_id, 10);
  if (!ackId) {
    throw Object.assign(new Error('ack_receipt_id is required'), { statusCode: 400 });
  }

  const ackRes = await client.query(
    `SELECT * FROM acknowledgement_receiptstbl WHERE ack_receipt_id = $1 FOR UPDATE`,
    [ackId]
  );
  if (ackRes.rows.length === 0) {
    throw Object.assign(new Error('Acknowledgement receipt not found'), { statusCode: 404 });
  }

  const ack = ackRes.rows[0];
  const arType = String(ack.ar_type || '').trim();
  const hasVerifierCols = await ackReceiptHasVerifierColumns();
  const tipAmount = parseFloat(ack.tip_amount || 0) || 0;
  const payAmt = parseFloat(ack.payment_amount || 0) || 0;
  const issueDate =
    issue_date ||
    (ack.issue_date
      ? String(ack.issue_date).slice(0, 10)
      : new Date().toISOString().slice(0, 10));
  const createdBy = created_by != null ? created_by : ack.created_by;

  if (ack.payment_id && String(ack.status || '') === AR_STATUS.VERIFIED) {
    return {
      alreadyProcessed: true,
      payment_id: ack.payment_id,
      invoice_id: ack.invoice_id,
      ack_receipt_id: ackId,
    };
  }

  let paymentId = ack.payment_id;
  let invoiceId = ack.invoice_id;

  if (arType === 'Merchandise') {
    const merchandiseItemsSnapshot = parseMerchSnapshot(ack.merchandise_items_snapshot);
    if (!merchandiseItemsSnapshot || merchandiseItemsSnapshot.length === 0) {
      throw Object.assign(new Error('Merchandise AR has no items snapshot'), { statusCode: 400 });
    }

    if (!invoiceId) {
      let studentIdForInvoice = ack.student_id;
      if (!studentIdForInvoice) {
        const walkInResult = await client.query(
          `SELECT user_id FROM userstbl WHERE email = 'walkin@merchandise.psms.internal' LIMIT 1`
        );
        if (walkInResult.rows.length > 0) {
          studentIdForInvoice = walkInResult.rows[0].user_id;
        } else {
          const insertResult = await client.query(
            `INSERT INTO userstbl (email, full_name, user_type)
             VALUES ('walkin@merchandise.psms.internal', 'Walk-in Customer', 'Student')
             ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
             RETURNING user_id`
          );
          studentIdForInvoice = insertResult.rows[0].user_id;
        }
      }

      const itemsGross = merchandiseItemsSnapshot.reduce(
        (sum, item) => sum + (parseFloat(item.price) || 0) * (parseInt(item.quantity, 10) || 1),
        0
      );

      const invoiceResult = await client.query(
        `INSERT INTO invoicestbl (
           invoice_description, branch_id, amount, status, remarks,
           issue_date, due_date, created_by, ack_receipt_id, invoice_ar_number
         ) VALUES ($1, $2, $3, 'Unpaid', $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          'Merchandise (acknowledgement receipt)',
          ack.branch_id,
          itemsGross > 0 ? itemsGross : payAmt,
          `Merchandise purchase (acknowledgement receipt) — ${ack.prospect_student_name}`,
          issueDate,
          issueDate,
          createdBy,
          ackId,
          ack.ack_receipt_number,
        ]
      );
      const newInvoice = invoiceResult.rows[0];
      invoiceId = newInvoice.invoice_id;

      for (const item of merchandiseItemsSnapshot) {
        const desc = `Merchandise: ${item.merchandise_name}${item.size ? ` (${item.size})` : ''}`;
        const itemAmount = (item.price || 0) * (item.quantity || 1);
        await client.query(
          `INSERT INTO invoiceitemstbl (invoice_id, description, amount) VALUES ($1, $2, $3)`,
          [invoiceId, desc, itemAmount]
        );
      }

      await client.query(
        'INSERT INTO invoicestudentstbl (invoice_id, student_id) VALUES ($1, $2)',
        [invoiceId, studentIdForInvoice]
      );

      await client.query(
        `UPDATE acknowledgement_receiptstbl SET invoice_id = $1 WHERE ack_receipt_id = $2`,
        [invoiceId, ackId]
      );

      const itemsSumResult = await client.query(
        `SELECT COALESCE(SUM(amount), 0) AS s FROM invoiceitemstbl WHERE invoice_id = $1`,
        [invoiceId]
      );
      const itemTotal = parseFloat(itemsSumResult.rows[0].s) || 0;
      const hasActionOwnerCol = await paymenttblHasActionOwnerUserIdColumn();
      const actionOwnerAck = createdBy;

      const paymentInsert = hasActionOwnerCol
        ? await client.query(
            `INSERT INTO paymenttbl (
               invoice_id, student_id, branch_id, payment_method, payment_type,
               payable_amount, tip_amount, issue_date, status, reference_number, remarks,
               created_by, payment_attachment_url, action_owner_user_id
             )
             VALUES ($1, $2, $3, $4, 'Full Payment', $5, $6, $7::date, 'Completed', $8, $9, $10, NULL, $11)
             RETURNING *`,
            [
              invoiceId,
              studentIdForInvoice,
              ack.branch_id,
              FIUU_AR_PAYMENT_METHOD,
              itemTotal,
              tipAmount,
              issueDate,
              reference_number || null,
              `Merchandise payment via FIUU${fiuu_channel ? ` (${fiuu_channel})` : ''}`,
              createdBy,
              actionOwnerAck,
            ]
          )
        : await client.query(
            `INSERT INTO paymenttbl (
               invoice_id, student_id, branch_id, payment_method, payment_type,
               payable_amount, tip_amount, issue_date, status, reference_number, remarks,
               created_by, payment_attachment_url
             )
             VALUES ($1, $2, $3, $4, 'Full Payment', $5, $6, $7::date, 'Completed', $8, $9, $10, NULL)
             RETURNING *`,
            [
              invoiceId,
              studentIdForInvoice,
              ack.branch_id,
              FIUU_AR_PAYMENT_METHOD,
              itemTotal,
              tipAmount,
              issueDate,
              reference_number || null,
              `Merchandise payment via FIUU${fiuu_channel ? ` (${fiuu_channel})` : ''}`,
              createdBy,
            ]
          );

      paymentId = paymentInsert.rows[0].payment_id;

      await client.query(`UPDATE invoicestbl SET status = 'Paid', amount = 0 WHERE invoice_id = $1`, [
        invoiceId,
      ]);

      const merchArReleaseBatchId = buildMerchandiseArReleaseBatchId(ackId);
      for (const item of merchandiseItemsSnapshot) {
        const merchId = item.merchandise_id;
        const qty = parseInt(item.quantity, 10) || 1;
        await client.query(
          `UPDATE merchandisestbl SET quantity = GREATEST(0, COALESCE(quantity, 0) - $1) WHERE merchandise_id = $2`,
          [qty, merchId]
        );
        await insertMerchandiseReleaseLog(client, {
          releaseBatchId: merchArReleaseBatchId,
          source: MERCH_RELEASE_SOURCE.MERCHANDISE_AR,
          merchandiseId: merchId,
          quantity: qty,
          branchId: ack.branch_id,
          merchandiseName: item.merchandise_name,
          size: item.size,
          ackReceiptId: ackId,
          paymentId,
          createdBy,
        });
      }
    } else if (!paymentId) {
      throw Object.assign(new Error('Merchandise AR has invoice but no payment'), {
        statusCode: 400,
      });
    }
  }

  if (hasVerifierCols) {
    await client.query(
      `UPDATE acknowledgement_receiptstbl
       SET status = $1,
           payment_method = $2,
           reference_number = COALESCE($3, reference_number),
           payment_id = COALESCE($4, payment_id),
           invoice_id = COALESCE($5, invoice_id),
           verified_by_user_id = $6,
           verified_at = CURRENT_TIMESTAMP
       WHERE ack_receipt_id = $7`,
      [
        AR_STATUS.VERIFIED,
        FIUU_AR_PAYMENT_METHOD,
        reference_number || null,
        paymentId || null,
        invoiceId || null,
        createdBy || null,
        ackId,
      ]
    );
  } else {
    await client.query(
      `UPDATE acknowledgement_receiptstbl
       SET status = $1,
           payment_method = $2,
           reference_number = COALESCE($3, reference_number),
           payment_id = COALESCE($4, payment_id),
           invoice_id = COALESCE($5, invoice_id)
       WHERE ack_receipt_id = $6`,
      [
        AR_STATUS.VERIFIED,
        FIUU_AR_PAYMENT_METHOD,
        reference_number || null,
        paymentId || null,
        invoiceId || null,
        ackId,
      ]
    );
  }

  return {
    alreadyProcessed: false,
    payment_id: paymentId || null,
    invoice_id: invoiceId || null,
    ack_receipt_id: ackId,
    ar_type: arType,
  };
}
