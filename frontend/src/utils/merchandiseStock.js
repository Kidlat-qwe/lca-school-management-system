/**
 * Merchandise stock helpers for enrollment and AR flows.
 */

/** True when quantity is untracked or strictly greater than zero. */
export function merchandiseHasAvailableStock(item) {
  if (!item) return false;
  if (item.quantity === null || item.quantity === undefined) return true;
  return (parseInt(item.quantity, 10) || 0) > 0;
}

/** Prefer the first in-stock variant; fall back to the first row when all are out of stock. */
export function pickFirstInStockMerchandiseItem(items = []) {
  if (!items?.length) return null;
  const inStock = items.filter(merchandiseHasAvailableStock);
  return inStock[0] || items[0];
}
