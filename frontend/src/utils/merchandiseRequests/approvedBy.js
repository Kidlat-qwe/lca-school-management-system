/**
 * Resolves who approved/rejected a merchandise stock request for UI display.
 *
 * Preference order:
 * 1. API `approved_by` (computed server-side)
 * 2. RHET Inventory approver (`inventory_processed_by` / camelCase)
 * 3. CMS Superadmin reviewer (`reviewed_by_name`)
 * 4. Fallback label when inventory-fulfilled but name was never stored
 *
 * Note: some RHET payloads send a user UUID in processedBy — those are ignored.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function looksLikeUserId(value) {
  return UUID_RE.test(String(value || '').trim());
}

function firstDisplayName(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text && !looksLikeUserId(text)) return text;
  }
  return '';
}

export function getMerchandiseRequestApprovedBy(request) {
  if (!request) return '—';

  const approvedBy = firstDisplayName(
    request.approved_by,
    request.approvedBy,
    request.inventory_processed_by,
    request.inventoryProcessedBy
  );
  if (approvedBy) return approvedBy;

  const cmsReviewer = firstDisplayName(
    request.reviewed_by_name,
    request.reviewedByName
  );
  if (cmsReviewer) return cmsReviewer;

  const status = String(request.status || '');
  const hasInventoryLink = Boolean(
    request.inventory_request_id || request.inventoryRequestId
  );
  if ((status === 'Approved' || status === 'Rejected') && hasInventoryLink) {
    return 'RHET Inventory';
  }

  return '—';
}
