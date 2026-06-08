/**
 * Build acknowledgement receipt PDF attachments for payment confirmation emails.
 */
import {
  generateAckReceiptPdfBuffer,
  renderAckReceiptPdfToBuffer,
} from '../lib/ackReceiptPdfGenerator.js';

/** Resolve the best acknowledgement_receipt_id for an invoice payment. */
export async function resolveAckReceiptIdForInvoice(client, invoiceId) {
  const invId = Number(invoiceId);
  if (!Number.isFinite(invId) || invId <= 0) return null;

  const r = await client.query(
    `SELECT COALESCE(
       (SELECT i.ack_receipt_id FROM invoicestbl i WHERE i.invoice_id = $1 AND i.ack_receipt_id IS NOT NULL),
       (
         SELECT ar.ack_receipt_id
         FROM acknowledgement_receiptstbl ar
         WHERE ar.invoice_id = $1
         ORDER BY ar.ack_receipt_id DESC
         LIMIT 1
       ),
       (
         SELECT ar.ack_receipt_id
         FROM paymenttbl p
         INNER JOIN acknowledgement_receiptstbl ar ON ar.payment_id = p.payment_id
         WHERE p.invoice_id = $1
         ORDER BY ar.ack_receipt_id DESC
         LIMIT 1
       ),
       (
         SELECT ar_lead.ack_receipt_id
         FROM invoicestbl i
         INNER JOIN acknowledgement_receiptstbl ar_lead ON ar_lead.ack_receipt_id = i.ack_receipt_id
         WHERE i.invoice_id = $1 AND i.ack_receipt_id IS NOT NULL
         LIMIT 1
       )
     ) AS ack_receipt_id`,
    [invId]
  );
  const id = Number(r.rows[0]?.ack_receipt_id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** Synthetic AR row when invoice has invoice_ar_number but no acknowledgement_receiptstbl row. */
export async function buildSyntheticArRowFromInvoice(client, invoiceId) {
  const invId = Number(invoiceId);
  const invoiceRes = await client.query(
    `SELECT i.invoice_id, i.invoice_ar_number, i.invoice_description, i.branch_id, i.amount,
            TO_CHAR(i.issue_date, 'YYYY-MM-DD') AS issue_date,
            b.branch_address, b.branch_phone_number, b.branch_email
     FROM invoicestbl i
     LEFT JOIN branchestbl b ON b.branch_id = i.branch_id
     WHERE i.invoice_id = $1`,
    [invId]
  );
  if (invoiceRes.rows.length === 0) return null;
  const invoice = invoiceRes.rows[0];
  const arNumber = String(invoice.invoice_ar_number || '').trim();
  if (!arNumber) return null;

  const studentsRes = await client.query(
    `SELECT u.full_name
     FROM invoicestudentstbl ist
     JOIN userstbl u ON u.user_id = ist.student_id
     WHERE ist.invoice_id = $1
     ORDER BY ist.student_id
     LIMIT 1`,
    [invId]
  );
  let studentName = String(studentsRes.rows[0]?.full_name || '').trim();
  if (!studentName) {
    const arNameRes = await client.query(
      `SELECT NULLIF(TRIM(ar.prospect_student_name), '') AS prospect_student_name
       FROM acknowledgement_receiptstbl ar
       WHERE ar.invoice_id = $1
       ORDER BY ar.ack_receipt_id DESC
       LIMIT 1`,
      [invId]
    );
    studentName = String(arNameRes.rows[0]?.prospect_student_name || '').trim() || 'Student';
  }

  let classLabel = '-';
  const classLabelRes = await client.query(
    `SELECT DISTINCT ON (cs.student_id)
        NULLIF(TRIM(p.program_code), '') AS program_code,
        NULLIF(TRIM(c.level_tag), '') AS level_tag
     FROM invoicestudentstbl ist
     INNER JOIN classstudentstbl cs ON cs.student_id = ist.student_id
     INNER JOIN classestbl c ON cs.class_id = c.class_id
     LEFT JOIN programstbl p ON c.program_id = p.program_id
     WHERE ist.invoice_id = $1
     ORDER BY cs.student_id, cs.classstudent_id DESC
     LIMIT 1`,
    [invId]
  );
  if (classLabelRes.rows.length > 0) {
    const row = classLabelRes.rows[0];
    const code = row.program_code || '-';
    const lvl = row.level_tag || '-';
    classLabel = `${code} - ${lvl}`;
  }

  const itemsRes = await client.query(
    `SELECT description FROM invoiceitemstbl WHERE invoice_id = $1`,
    [invId]
  );
  const itemDescriptions = (itemsRes.rows || [])
    .map((item) => String(item.description || '').trim())
    .filter(Boolean);
  const invDesc = String(invoice.invoice_description || '').trim();
  const looksLikeCodeOnly = /^INV-\d+$/i.test(invDesc);
  const packageDesc =
    itemDescriptions.join(' | ') ||
    (!looksLikeCodeOnly ? invDesc : '') ||
    `Invoice INV-${invoice.invoice_id}`;

  const payRes = await client.query(
    `SELECT COALESCE(SUM(payable_amount), 0)::numeric AS total_paid,
            COALESCE(SUM(discount_amount), 0)::numeric AS total_discount,
            COALESCE(SUM(tip_amount), 0)::numeric AS total_tip,
            TO_CHAR(MAX(issue_date), 'YYYY-MM-DD') AS last_payment_ymd
     FROM paymenttbl
     WHERE invoice_id = $1 AND status = 'Completed'
       AND COALESCE(approval_status, 'Pending') <> 'Rejected'`,
    [invId]
  );
  const amountPaid = Number(payRes.rows[0]?.total_paid || 0);
  const paymentDiscount = Number(payRes.rows[0]?.total_discount || 0);
  const paymentTip = Number(payRes.rows[0]?.total_tip || 0);
  const issueDateFmt = String(payRes.rows[0]?.last_payment_ymd || invoice.issue_date || '').slice(0, 10);
  const invoiceGross = Number(invoice.amount || 0) || amountPaid + paymentDiscount;

  const preparedByRes = await client.query(
    `SELECT
       u.full_name AS prepared_by_name,
       TO_CHAR(p.issue_date, 'YYYY-MM-DD') AS prepared_by_date_ymd
     FROM paymenttbl p
     LEFT JOIN userstbl u ON u.user_id = p.created_by
     WHERE p.invoice_id = $1
       AND p.status = 'Completed'
       AND COALESCE(p.approval_status, 'Pending') <> 'Rejected'
     ORDER BY p.issue_date DESC, p.payment_id DESC
     LIMIT 1`,
    [invId]
  );
  const preparedByName = String(preparedByRes.rows[0]?.prepared_by_name || '').trim();
  const preparedByDateYmd = preparedByRes.rows[0]?.prepared_by_date_ymd || issueDateFmt;

  const receivedByRes = await client.query(
    `SELECT COALESCE(
       (
         SELECT NULLIF(TRIM(ar.prospect_student_contact), '')
         FROM acknowledgement_receiptstbl ar
         WHERE ar.invoice_id = $1
         ORDER BY ar.ack_receipt_id DESC
         LIMIT 1
       ),
       (
         SELECT NULLIF(TRIM(gg.guardian_name), '')
         FROM invoicestudentstbl ist
         LEFT JOIN LATERAL (
           SELECT guardian_name
           FROM guardianstbl
           WHERE student_id = ist.student_id
           ORDER BY guardian_id ASC
           LIMIT 1
         ) gg ON TRUE
         WHERE ist.invoice_id = $1
         ORDER BY ist.student_id ASC
         LIMIT 1
       )
     ) AS guardian_name`,
    [invId]
  );
  const receivedByName = String(receivedByRes.rows[0]?.guardian_name || '').trim();

  return {
    ack_receipt_number: arNumber,
    prospect_student_name: studentName,
    prospect_student_contact: receivedByName,
    level_tag: classLabel,
    issue_date_fmt: issueDateFmt,
    prepared_by_name: preparedByName,
    prepared_by_date_ymd: preparedByDateYmd,
    payment_amount: amountPaid,
    tip_amount: paymentTip,
    package_amount_snapshot: invoiceGross,
    package_name_snapshot: packageDesc,
    branch_address: invoice.branch_address,
    branch_phone_number: invoice.branch_phone_number,
    branch_email: invoice.branch_email,
    ar_type: 'package',
  };
}

/**
 * @returns {Promise<{ buffer: Buffer, filename: string }|null>}
 */
export async function buildArPdfAttachmentForPaymentConfirmation(
  client,
  { invoiceId = null, ackReceiptId = null } = {}
) {
  const queryFn = client.query.bind(client);

  let ackId = Number(ackReceiptId);
  if (!Number.isFinite(ackId) || ackId <= 0) {
    if (invoiceId) {
      ackId = await resolveAckReceiptIdForInvoice(client, invoiceId);
    }
  }

  if (Number.isFinite(ackId) && ackId > 0) {
    try {
      return await generateAckReceiptPdfBuffer(ackId, queryFn);
    } catch (err) {
      console.error(`buildArPdfAttachmentForPaymentConfirmation AR ${ackId}:`, err?.message || err);
      return null;
    }
  }

  const invId = Number(invoiceId);
  if (!Number.isFinite(invId) || invId <= 0) return null;

  try {
    const synthetic = await buildSyntheticArRowFromInvoice(client, invId);
    if (!synthetic) return null;
    const buffer = await renderAckReceiptPdfToBuffer([synthetic]);
    const filename = `acknowledgement-receipt-${synthetic.ack_receipt_number}.pdf`;
    return { buffer, filename };
  } catch (err) {
    console.error(`buildArPdfAttachmentForPaymentConfirmation invoice ${invId}:`, err?.message || err);
    return null;
  }
}
