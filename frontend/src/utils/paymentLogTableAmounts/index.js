/**
 * @param {{ payable_amount?: unknown; discount_amount?: unknown }} p
 * @returns {number}
 */
export function getPaymentLogTableAmountColumn(p) {
  const payable = parseFloat(p?.payable_amount) || 0;
  const discount = parseFloat(p?.discount_amount) || 0;
  return payable + discount;
}

/**
 * @param {{ payable_amount?: unknown; tip_amount?: unknown }} p
 * @returns {number}
 */
export function getPaymentLogTableTotalAmountColumn(p) {
  const payable = parseFloat(p?.payable_amount) || 0;
  const tip = parseFloat(p?.tip_amount) || 0;
  return payable + tip;
}
