/**
 * Net line amounts for acknowledgement receipts (amount − discount + penalty + tax).
 */

export const roundCurrency = (value) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

export function getInvoiceItemNetAmount(item) {
  if (!item) return 0;
  const amt = Number(item.amount) || 0;
  const discount = Number(item.discount_amount) || 0;
  const penalty = Number(item.penalty_amount) || 0;
  const taxPct = Number(item.tax_percentage) || 0;
  const taxableBase = amt - discount + penalty;
  const tax = taxableBase * (taxPct / 100);
  return roundCurrency(taxableBase + tax);
}

/**
 * @param {Array<{ description?: string, amount?: number, discount_amount?: number, penalty_amount?: number, tax_percentage?: number }>} items
 * @param {{ fallbackDescription?: string, fallbackAmount?: number }} [options]
 */
export function buildArReceiptLineRows(items, options = {}) {
  const rows = (items || []).map((item) => ({
    description: (item.description || '').trim() || '—',
    netAmount: getInvoiceItemNetAmount(item),
  }));

  if (rows.length > 0) {
    return rows;
  }

  const fallbackAmount = roundCurrency(options.fallbackAmount || 0);
  if (fallbackAmount !== 0 || options.fallbackDescription) {
    return [
      {
        description: options.fallbackDescription || 'Payment',
        netAmount: fallbackAmount,
      },
    ];
  }

  return [];
}
