/** User-facing label for Issued by columns (invoice payment encoder / AR creator). */
export function formatIssuedByDisplayName(name) {
  const trimmed = String(name || '').trim();
  return trimmed || '—';
}

export function getInvoiceIssuedByLabel(invoice) {
  return formatIssuedByDisplayName(invoice?.payment_recorded_by_name);
}

export function getArIssuedByLabel(receipt) {
  return formatIssuedByDisplayName(receipt?.prepared_by_name);
}
