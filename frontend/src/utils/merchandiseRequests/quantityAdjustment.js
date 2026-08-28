/**
 * RHET quantity adjustment display helpers (Request Stock / My Requests).
 */

export function hasInventoryQuantityAdjustment(request) {
  const original = parseInt(request?.inventory_original_quantity, 10);
  const current = parseInt(request?.requested_quantity, 10);
  if (!Number.isFinite(original) || !Number.isFinite(current)) return false;
  return original > current;
}

/**
 * Primary quantity label for tables and detail views.
 */
export function formatRequestQuantityLabel(request) {
  const current = request?.requested_quantity;
  if (!hasInventoryQuantityAdjustment(request)) {
    return current != null && current !== '' ? String(current) : '—';
  }
  return `Requested ${request.inventory_original_quantity} · Approved for ship ${current}`;
}

export function getRequestQuantityAdjustmentRemarks(request) {
  return String(request?.inventory_adjustment_remarks || '').trim() || null;
}

export function getRequestQuantityAdjustedBy(request) {
  return String(request?.inventory_adjusted_by || '').trim() || null;
}
