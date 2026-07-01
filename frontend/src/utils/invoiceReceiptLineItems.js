/**
 * Net line amounts for payment-recorded acknowledgement receipt preview.
 * Matches backend invoiceReceiptLineItems (amount − discount + penalty + tax).
 */

export function getInvoiceItemNetAmount(item) {
  if (!item) return 0;
  const amt = Number(item.amount) || 0;
  const discount = Number(item.discount_amount) || 0;
  const penalty = Number(item.penalty_amount) || 0;
  const taxPct = Number(item.tax_percentage) || 0;
  const taxableBase = amt - discount + penalty;
  const tax = taxableBase * (taxPct / 100);
  return Math.round((taxableBase + tax + Number.EPSILON) * 100) / 100;
}

/**
 * @param {Array} items - invoice.items from GET /invoices/:id
 * @returns {{ description: string, rate: number, amount: number }[]}
 */
export function buildReceiptTableRowsFromInvoiceItems(items) {
  return (Array.isArray(items) ? items : []).map((row) => {
    const net = getInvoiceItemNetAmount(row);
    const description = (row.description || '').trim() || '—';
    return {
      description,
      rate: net,
      amount: net,
    };
  });
}

export function sumReceiptTableRows(tableRows) {
  return (tableRows || []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
}
