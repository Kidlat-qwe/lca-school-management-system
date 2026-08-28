/**
 * RHET stock-request status lifecycle (warehouse → branch).
 *
 * PENDING → SHIPPED (warehouse deducted) → DELIVERED (branch received / credit CMS)
 *        ↘ REJECTED
 * DELIVERED → RETURNED (optional; reverse CMS credit when wasDelivered)
 *
 * FULFILLED is a legacy alias for DELIVERED (credit once, idempotent).
 */

/** Local merchandiserequestlogtbl.status values shown in CMS UI */
export const LOCAL_REQUEST_STATUS = {
  PENDING: 'Pending',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  RETURNED: 'Returned',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  /** Legacy Superadmin / pre-lifecycle RHET fulfill */
  APPROVED: 'Approved',
};

export function normalizeRemoteStatus(status) {
  return String(status || '').toUpperCase();
}

export function normalizeEventName(event) {
  return String(event || '').toLowerCase();
}

/** True when CMS branch stock has already been credited for this request. */
export function isStockCreditedLocalStatus(status) {
  const s = String(status || '');
  return s === LOCAL_REQUEST_STATUS.DELIVERED || s === LOCAL_REQUEST_STATUS.APPROVED;
}

/** RHET statuses that mean "branch received" — credit CMS stock once. */
export function isDeliveredRemoteStatus(status) {
  const s = normalizeRemoteStatus(status);
  return s === 'DELIVERED' || s === 'FULFILLED';
}

export function isShippedRemoteStatus(status) {
  return normalizeRemoteStatus(status) === 'SHIPPED';
}

export function isReturnedRemoteStatus(status) {
  return normalizeRemoteStatus(status) === 'RETURNED';
}

export function isRejectedRemoteStatus(status) {
  const s = normalizeRemoteStatus(status);
  return s === 'REJECTED' || s === 'FAILED';
}

export function isShippedEvent(payload) {
  const event = normalizeEventName(payload?.event);
  const status = normalizeRemoteStatus(payload?.status);
  return status === 'SHIPPED' || event.includes('shipped') || event.endsWith('.shipped');
}

export function isDeliveredEvent(payload) {
  const event = normalizeEventName(payload?.event);
  const status = normalizeRemoteStatus(payload?.status);
  return (
    status === 'DELIVERED' ||
    status === 'FULFILLED' ||
    event.includes('delivered') ||
    event.endsWith('.delivered') ||
    event.includes('fulfilled') ||
    event.endsWith('.fulfilled')
  );
}

export function isReturnedEvent(payload) {
  const event = normalizeEventName(payload?.event);
  const status = normalizeRemoteStatus(payload?.status);
  return status === 'RETURNED' || event.includes('returned') || event.endsWith('.returned');
}

export function isRejectedEvent(payload) {
  const event = normalizeEventName(payload?.event);
  const status = normalizeRemoteStatus(payload?.status);
  return (
    status === 'REJECTED' ||
    status === 'FAILED' ||
    event.includes('rejected') ||
    event.endsWith('.rejected') ||
    event.includes('failed') ||
    event.endsWith('.failed')
  );
}

/**
 * Parse wasDelivered from RHET returned webhook.
 * true → reverse CMS branch credit; false/missing with local Delivered → still reverse.
 */
export function resolveWasDelivered(payload, localStatus) {
  const raw = payload?.wasDelivered;
  if (raw === true || raw === 'true' || raw === 1 || raw === '1') return true;
  if (raw === false || raw === 'false' || raw === 0 || raw === '0') return false;
  // Infer: if CMS already credited, treat as delivered for reverse safety
  if (isStockCreditedLocalStatus(localStatus)) return true;
  return false;
}

/**
 * Infer inventory_status string to store when event implies status.
 */
export function inferInventoryStatusFromPayload(payload) {
  const event = normalizeEventName(payload?.event);
  if (event.includes('stock_return.accepted') || (event.includes('stock_return') && event.includes('accepted'))) {
    return 'RETURNED';
  }
  if (event.includes('stock_return.received') || (event.includes('stock_return') && event.includes('received'))) {
    return 'RECEIVED';
  }

  let status = normalizeRemoteStatus(payload?.status);
  if (status) {
    // Normalize legacy fulfill → DELIVERED for storage going forward
    if (status === 'FULFILLED') return 'DELIVERED';
    if (status === 'FAILED') return 'REJECTED';
    if (status === 'APPROVED') return 'DELIVERED';
    if (status === 'RECEIVED') return 'RECEIVED';
    return status;
  }

  if (event.includes('delivered') || event.endsWith('.delivered')) return 'DELIVERED';
  if (event.includes('fulfilled') || event.endsWith('.fulfilled')) return 'DELIVERED';
  if (event.includes('shipped') || event.endsWith('.shipped')) return 'SHIPPED';
  if (event.includes('returned') || event.endsWith('.returned')) return 'RETURNED';
  if (event.includes('rejected') || event.endsWith('.rejected')) return 'REJECTED';
  if (event.includes('failed') || event.endsWith('.failed')) return 'REJECTED';
  if (event.includes('created') || event.endsWith('.created')) return 'PENDING';
  return 'PENDING';
}

export function isStockReturnWebhookEvent(payload) {
  const event = normalizeEventName(payload?.event);
  const kind = String(payload?.requestKind || payload?.request_kind || '').toUpperCase();
  if (event.includes('stock_return')) return true;
  if (kind === 'RETURN') return true;
  return false;
}

export function isStockReturnAcceptedEvent(payload) {
  const event = normalizeEventName(payload?.event);
  if (event.includes('stock_return') && event.includes('accepted')) return true;
  return isStockReturnWebhookEvent(payload) && normalizeRemoteStatus(payload?.status) === 'RETURNED';
}

export function isStockReturnReceivedEvent(payload) {
  const event = normalizeEventName(payload?.event);
  if (event.includes('stock_return') && event.includes('received')) return true;
  return isStockReturnWebhookEvent(payload) && !isStockReturnAcceptedEvent(payload);
}

export function isQuantityAdjustedEvent(payload) {
  const event = normalizeEventName(payload?.event);
  return (
    event === 'stock_request.quantity_adjusted' || event.endsWith('.quantity_adjusted')
  );
}
