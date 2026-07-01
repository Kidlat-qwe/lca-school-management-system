/** Remaining + paid on list row (billed face for Amount column). */
export function getInvoiceDisplayAmount(invoice) {
  if (!invoice) return 0;
  const remainingAmount = Number(invoice.amount ?? 0);
  const paidAmount = Number(invoice.paid_amount ?? 0);
  const billedAmount = remainingAmount + paidAmount;
  return billedAmount > 0 ? billedAmount : remainingAmount;
}

/** Total received including tips (Total Amount column). */
export function getInvoiceTotalReceivedAmount(invoice) {
  if (!invoice) return 0;
  return Number(
    invoice.total_received_amount ||
      (Number(invoice.paid_amount || 0) + Number(invoice.total_tip_amount || 0))
  );
}
