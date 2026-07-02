import { AR_STATUS } from '../utils/acknowledgementReceiptStatus.js';
import { paymenttblHasActionOwnerUserIdColumn } from '../utils/paymentSchema.js';
import { LCGT_EVENT_NAME } from '../utils/lcgtEventAr.js';

async function resolveWalkInStudentId(client) {
  const walkInResult = await client.query(
    `SELECT user_id FROM userstbl WHERE email = 'walkin@merchandise.psms.internal' LIMIT 1`
  );
  if (walkInResult.rows.length > 0) {
    return walkInResult.rows[0].user_id;
  }
  const insertResult = await client.query(
    `INSERT INTO userstbl (email, full_name, user_type)
     VALUES ('walkin@merchandise.psms.internal', 'Walk-in Customer', 'Student')
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING user_id`
  );
  return insertResult.rows[0].user_id;
}

/**
 * Create paid invoice + payment for LCGT Event AR (no stock deduction).
 */
export async function createLcgtEventArInvoiceAndPayment({
  client,
  ackReceipt,
  branchId,
  createdBy,
  prospectStudentName,
  issueDate,
  totalPaymentAmount,
  normalizedPaymentMethod,
  referenceNumber,
  paymentAttachmentUrl,
  tipAmount = 0,
  linkedStudentId = null,
  hasVerifierCols,
}) {
  let studentIdForInvoice = linkedStudentId;
  if (!studentIdForInvoice) {
    studentIdForInvoice = await resolveWalkInStudentId(client);
  }

  const invoiceResult = await client.query(
    `INSERT INTO invoicestbl (invoice_description, branch_id, amount, status, remarks, issue_date, due_date, created_by, ack_receipt_id, invoice_ar_number)
     VALUES ($1, $2, $3, 'Unpaid', $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      `${LCGT_EVENT_NAME} (acknowledgement receipt)`,
      branchId,
      totalPaymentAmount,
      `${LCGT_EVENT_NAME} ticket — ${prospectStudentName}`,
      issueDate,
      issueDate,
      createdBy,
      ackReceipt.ack_receipt_id,
      ackReceipt.ack_receipt_number,
    ]
  );

  const newInvoice = invoiceResult.rows[0];

  await client.query(
    `INSERT INTO invoiceitemstbl (invoice_id, description, amount) VALUES ($1, $2, $3)`,
    [newInvoice.invoice_id, `${LCGT_EVENT_NAME} ticket`, totalPaymentAmount]
  );

  await client.query('INSERT INTO invoicestudentstbl (invoice_id, student_id) VALUES ($1, $2)', [
    newInvoice.invoice_id,
    studentIdForInvoice,
  ]);

  await client.query(`UPDATE acknowledgement_receiptstbl SET invoice_id = $1 WHERE ack_receipt_id = $2`, [
    newInvoice.invoice_id,
    ackReceipt.ack_receipt_id,
  ]);

  ackReceipt.invoice_id = newInvoice.invoice_id;

  const itemsSumResult = await client.query(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM invoiceitemstbl WHERE invoice_id = $1`,
    [newInvoice.invoice_id]
  );
  const itemTotal = parseFloat(itemsSumResult.rows[0].s) || 0;

  const actionOwnerAck = newInvoice.created_by != null ? newInvoice.created_by : createdBy;
  const hasActionOwnerCol = await paymenttblHasActionOwnerUserIdColumn();

  const paymentInsert = hasActionOwnerCol
    ? await client.query(
        `INSERT INTO paymenttbl (
           invoice_id, student_id, branch_id, payment_method, payment_type,
           payable_amount, tip_amount, issue_date, status, reference_number, remarks, created_by, payment_attachment_url, action_owner_user_id
         )
         VALUES ($1, $2, $3, $4, 'Full Payment', $5, $6, $7::date, 'Completed', $8, $9, $10, $11, $12)
         RETURNING *`,
        [
          newInvoice.invoice_id,
          studentIdForInvoice,
          branchId,
          normalizedPaymentMethod,
          itemTotal,
          tipAmount || 0,
          issueDate,
          referenceNumber?.trim() || null,
          `${LCGT_EVENT_NAME} payment (acknowledgement receipt)`,
          createdBy,
          paymentAttachmentUrl || null,
          actionOwnerAck,
        ]
      )
    : await client.query(
        `INSERT INTO paymenttbl (
           invoice_id, student_id, branch_id, payment_method, payment_type,
           payable_amount, tip_amount, issue_date, status, reference_number, remarks, created_by, payment_attachment_url
         )
         VALUES ($1, $2, $3, $4, 'Full Payment', $5, $6, $7::date, 'Completed', $8, $9, $10, $11)
         RETURNING *`,
        [
          newInvoice.invoice_id,
          studentIdForInvoice,
          branchId,
          normalizedPaymentMethod,
          itemTotal,
          tipAmount || 0,
          issueDate,
          referenceNumber?.trim() || null,
          `${LCGT_EVENT_NAME} payment (acknowledgement receipt)`,
          createdBy,
          paymentAttachmentUrl || null,
        ]
      );

  const newPayment = paymentInsert.rows[0];
  const isCash = String(normalizedPaymentMethod || '').trim().toLowerCase() === 'cash';

  await client.query(`UPDATE invoicestbl SET status = 'Paid', amount = 0 WHERE invoice_id = $1`, [
    newInvoice.invoice_id,
  ]);

  if (isCash) {
    if (hasVerifierCols) {
      await client.query(
        `UPDATE acknowledgement_receiptstbl
         SET status = 'Verified',
             payment_id = $1,
             verified_by_user_id = $2,
             verified_at = CURRENT_TIMESTAMP
         WHERE ack_receipt_id = $3`,
        [newPayment.payment_id, createdBy, ackReceipt.ack_receipt_id]
      );
      ackReceipt.verified_by_user_id = createdBy;
    } else {
      await client.query(
        `UPDATE acknowledgement_receiptstbl SET status = 'Verified', payment_id = $1 WHERE ack_receipt_id = $2`,
        [newPayment.payment_id, ackReceipt.ack_receipt_id]
      );
    }
    ackReceipt.status = 'Verified';
  } else {
    await client.query(
      `UPDATE acknowledgement_receiptstbl SET status = $1, payment_id = $2 WHERE ack_receipt_id = $3`,
      [AR_STATUS.UNVERIFIED, newPayment.payment_id, ackReceipt.ack_receipt_id]
    );
    ackReceipt.status = AR_STATUS.UNVERIFIED;
  }

  ackReceipt.payment_id = newPayment.payment_id;

  return {
    invoiceId: newInvoice.invoice_id,
    paymentId: newPayment.payment_id,
  };
}
