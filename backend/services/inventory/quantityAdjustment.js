/**
 * RHET stock-request quantity adjustment (warehouse reduces qty before ship).
 * Webhook: stock_request.quantity_adjusted
 */

import { pickApproverName } from './inventoryFieldMapping.js';

export function parseRemoteQuantity(value) {
  if (value == null || value === '') return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Approved ship qty for fulfill / announcements — prefer webhook payload, else stored row.
 */
export function resolveFulfillQuantity(request, payload = {}) {
  const fromPayload = parseRemoteQuantity(payload?.quantity);
  if (fromPayload != null && fromPayload > 0) return fromPayload;
  const fromRow = parseRemoteQuantity(request?.requested_quantity);
  return fromRow != null && fromRow > 0 ? fromRow : 0;
}

export function isQuantityAdjustedEvent(payload) {
  const event = String(payload?.event || '').toLowerCase();
  return (
    event === 'stock_request.quantity_adjusted' ||
    event.endsWith('.quantity_adjusted')
  );
}

export function hasStoredQuantityAdjustment(request) {
  const original = parseRemoteQuantity(request?.inventory_original_quantity);
  const current = parseRemoteQuantity(request?.requested_quantity);
  if (original == null || current == null) return false;
  return original > current;
}

/**
 * Build UPDATE values from RHET webhook or GET /stock-requests response.
 */
export function buildQuantityAdjustmentPatch(request, payload = {}) {
  const adjustedQty = parseRemoteQuantity(payload?.quantity);
  if (adjustedQty == null || adjustedQty <= 0) return null;

  const payloadOriginal = parseRemoteQuantity(payload?.originalQuantity);
  const originalQty =
    payloadOriginal != null && payloadOriginal > 0
      ? payloadOriginal
      : parseRemoteQuantity(request?.inventory_original_quantity) ??
        parseRemoteQuantity(request?.requested_quantity);

  const remarks = String(
    payload?.quantityAdjustmentRemarks || payload?.adjustmentRemarks || ''
  ).trim();
  const adjustedBy =
    pickApproverName(payload) ||
    String(payload?.adjustedBy || '').trim() ||
    null;
  const adjustedAt =
    payload?.quantityAdjustedAt || payload?.timestamp || null;

  return {
    adjustedQty,
    originalQty: originalQty != null && originalQty > 0 ? originalQty : null,
    remarks: remarks || null,
    adjustedBy,
    adjustedAt,
  };
}

export function isQuantityAdjustmentNoOp(request, patch) {
  if (!patch) return true;
  const currentQty = parseRemoteQuantity(request?.requested_quantity);
  const currentRemarks = String(request?.inventory_adjustment_remarks || '').trim();
  const nextRemarks = String(patch.remarks || '').trim();
  return currentQty === patch.adjustedQty && currentRemarks === nextRemarks;
}

/**
 * Merge fulfill quantity from payload into a request row copy.
 */
export function withFulfillQuantity(request, payload = {}) {
  const qty = resolveFulfillQuantity(request, payload);
  return qty > 0 ? { ...request, requested_quantity: qty } : { ...request };
}

/**
 * Apply quantity adjustment columns (shared by webhook + sync-inventory).
 * Returns true when row was updated.
 */
export async function applyQuantityAdjustmentUpdate(run, requestId, request, patch) {
  if (!patch || isQuantityAdjustmentNoOp(request, patch)) return false;

  await run(
    `UPDATE merchandiserequestlogtbl
     SET requested_quantity = $1,
         inventory_original_quantity = COALESCE(inventory_original_quantity, $2),
         inventory_adjustment_remarks = COALESCE($3, inventory_adjustment_remarks),
         inventory_adjusted_by = COALESCE($4, inventory_adjusted_by),
         inventory_adjusted_at = COALESCE($5::timestamptz, inventory_adjusted_at, CURRENT_TIMESTAMP),
         inventory_synced_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE request_id = $6`,
    [
      patch.adjustedQty,
      patch.originalQty,
      patch.remarks,
      patch.adjustedBy,
      patch.adjustedAt,
      requestId,
    ]
  );
  return true;
}
