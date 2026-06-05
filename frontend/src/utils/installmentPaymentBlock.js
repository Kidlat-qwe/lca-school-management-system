/**
 * User-facing messages when installment payment is blocked by prior partial balance.
 */

/**
 * @param {object} invoiceData - GET /invoices/:id payload
 * @returns {string|null}
 */
export function getInstallmentPaymentBlockAlert(invoiceData) {
  const prior = invoiceData?.prior_partial_balance_block;
  if (prior?.blocked && prior.message) {
    return prior.message;
  }

  if (invoiceData?.balance_invoice_id || invoiceData?.can_record_payment === false) {
    const tip = invoiceData?.continued_to_invoice;
    const label =
      tip?.display_description ||
      tip?.invoice_description ||
      (tip?.invoice_id ? `INV-${tip.invoice_id}` : 'the balance invoice');
    return `This invoice is not payable after a partial payment. Record payments on ${label} instead.`;
  }

  return null;
}
