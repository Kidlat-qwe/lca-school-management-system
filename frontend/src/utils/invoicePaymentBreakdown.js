/**
 * Invoice breakdown for payment edit / record-payment modals (payable + discount toward invoice).
 */
export function getInvoicePaymentBreakdown(invoice) {
  const items = Array.isArray(invoice?.items) ? invoice.items : [];
  const subtotal = items.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
  const discount = items.reduce((sum, item) => sum + (parseFloat(item.discount_amount) || 0), 0);
  const penalty = items.reduce((sum, item) => sum + (parseFloat(item.penalty_amount) || 0), 0);
  const tax = items.reduce((sum, item) => {
    const amount = parseFloat(item.amount) || 0;
    const taxPercentage = parseFloat(item.tax_percentage) || 0;
    return sum + (amount * taxPercentage) / 100;
  }, 0);
  const totalDue = subtotal - discount + penalty + tax;
  const remaining = parseFloat(invoice?.amount || 0);
  const paidAmount = Math.max(0, totalDue - remaining);
  return {
    subtotal,
    discount,
    penalty,
    tax,
    totalDue,
    paidAmount,
    remaining,
  };
}
