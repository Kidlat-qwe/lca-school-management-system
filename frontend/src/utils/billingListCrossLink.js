/**
 * Helpers for AR ↔ Invoice list cross-navigation (search init, fetch guards).
 */

/** Initial invoice list search when landing with ?invoice_id= */
export function getInitialInvoiceSearchFromParams(searchParams) {
  const raw = searchParams.get('invoice_id');
  const id = Number(raw);
  if (Number.isFinite(id) && id > 0) return `INV-${id}`;
  return '';
}

/** Initial AR list search when landing from Invoice cross-link (prefer AR# in ?search=). */
export function getInitialArSearchFromParams(searchParams) {
  const searchTrim = String(searchParams.get('search') || '').trim();
  if (searchTrim && hasArCrossLinkParam(searchParams)) {
    return searchTrim;
  }
  const ackId = Number(searchParams.get('ack_receipt_id'));
  if (Number.isFinite(ackId) && ackId > 0 && hasArCrossLinkParam(searchParams)) {
    return String(ackId);
  }
  return searchTrim;
}

export function hasInvoiceCrossLinkParam(searchParams) {
  const id = Number(searchParams.get('invoice_id'));
  return Number.isFinite(id) && id > 0;
}

/** Invoice → AR via AR# search (?search=&ar_focus=1). */
export function isArSearchCrossLinkParam(searchParams) {
  if (searchParams.get('ar_focus') !== '1') return false;
  return Boolean(String(searchParams.get('search') || '').trim());
}

/** Invoice → AR via invoice row when ack_receipt_id is missing (?invoice_id=&ar_focus=1). */
export function isArInvoiceCrossLinkParam(searchParams) {
  if (searchParams.get('ar_focus') !== '1') return false;
  const id = Number(searchParams.get('invoice_id'));
  return Number.isFinite(id) && id > 0;
}

/** Landing from Invoice page cross-link. */
export function hasArCrossLinkParam(searchParams) {
  const ackId = Number(searchParams.get('ack_receipt_id'));
  if (Number.isFinite(ackId) && ackId > 0) return true;
  if (searchParams.get('ar_focus') !== '1') return false;
  return isArInvoiceCrossLinkParam(searchParams) || isArSearchCrossLinkParam(searchParams);
}

/** Boot with no month filter when opening a cross-linked AR row. */
export function shouldClearArDateFiltersOnLanding(searchParams) {
  return hasArCrossLinkParam(searchParams);
}
