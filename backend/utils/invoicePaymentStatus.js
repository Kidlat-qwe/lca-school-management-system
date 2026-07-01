/**
 * Derive invoicestbl.status from completed (non-rejected) payment settlement.
 * When settlement is zero but the invoice has rejected payment(s), status stays Rejected.
 */

const SETTLEMENT_TOLERANCE = 0.01;

export async function invoiceHasRejectedPayment(client, invoiceId) {
  const result = await client.query(
    `SELECT EXISTS (
       SELECT 1
       FROM paymenttbl
       WHERE invoice_id = $1
         AND COALESCE(approval_status, '') = 'Rejected'
     ) AS has_rejected`,
    [invoiceId]
  );
  return Boolean(result.rows[0]?.has_rejected);
}

/**
 * @param {object} args
 * @param {number|string} args.totalSettled - Completed, non-rejected settlement total
 * @param {number|string} args.originalInvoiceAmount
 * @param {boolean} args.hasRejectedPayment
 * @param {string} [args.previousStatus] - Current invoicestbl.status
 */
export function deriveInvoiceStatusFromSettlement({
  totalSettled,
  originalInvoiceAmount,
  hasRejectedPayment,
  previousStatus = 'Unpaid',
}) {
  const original = parseFloat(originalInvoiceAmount) || 0;
  const settled = parseFloat(totalSettled) || 0;

  if (settled >= original - SETTLEMENT_TOLERANCE) {
    return 'Paid';
  }
  if (settled > SETTLEMENT_TOLERANCE) {
    return 'Partially Paid';
  }

  if (hasRejectedPayment) {
    return 'Rejected';
  }

  if (previousStatus === 'Paid' || previousStatus === 'Partially Paid') {
    return 'Unpaid';
  }

  return previousStatus || 'Unpaid';
}

/**
 * Load rejected flag + derive status in one call (common after payment CRUD).
 */
export async function deriveInvoiceStatusForInvoice(client, invoiceId, {
  totalSettled,
  originalInvoiceAmount,
  previousStatus,
}) {
  const hasRejectedPayment = await invoiceHasRejectedPayment(client, invoiceId);
  return deriveInvoiceStatusFromSettlement({
    totalSettled,
    originalInvoiceAmount,
    hasRejectedPayment,
    previousStatus,
  });
}
