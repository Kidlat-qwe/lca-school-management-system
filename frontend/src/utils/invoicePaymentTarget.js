/**
 * Invoice list Pay action rules.
 * After a partial payment, the parent row (e.g. INV-566) is closed — Pay is disabled there.
 * Staff record the remaining balance on the balance continuation row (e.g. INV-567).
 */

/** Remaining amount payable on this invoice row (0 on superseded parents). */
export function getInvoicePayableRemaining(invoice) {
  if (!invoice || invoice.balance_invoice_id) return 0;
  const amount = Number(invoice.amount ?? 0);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

/** True when this row is the open balance continuation (child of a partial payment). */
export function isBalanceContinuationInvoice(invoice) {
  return Boolean(invoice?.parent_invoice_id) && !invoice?.balance_invoice_id;
}

/**
 * @param {object} invoice - Invoice list or detail row
 * @returns {{ invoice_id: number|string }}
 */
export function getPayableInvoiceTarget(invoice) {
  return { invoice_id: invoice?.invoice_id };
}

/** Whether the row actions menu should show an enabled Pay action. */
export function canShowInvoicePayAction(invoice) {
  if (!invoice) return false;
  if (invoice.status === 'Paid' || invoice.status === 'Cancelled') return false;
  // Parent after partial payment: amount already recorded here — not payable on this row.
  if (invoice.balance_invoice_id) return false;
  if (invoice.can_record_payment === false) return false;
  return getInvoicePayableRemaining(invoice) > 0.009;
}

export function invoicePayActionLabel(invoice) {
  return isBalanceContinuationInvoice(invoice) ? 'Pay balance' : 'Pay';
}
