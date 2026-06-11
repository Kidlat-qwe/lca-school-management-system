/**
 * Display helpers for GET /acknowledgement-receipts list rows.
 * Downpayment + Phase 1 uses two AR rows; each row shows its own line total
 * (downpayment on the leader, Phase 1 on the paired row).
 */

export function getArListLineTotal(r) {
  const v = r?.list_line_total_amount;
  if (v != null && v !== '' && !Number.isNaN(Number(v))) return Number(v);
  return Number(r?.payment_amount || 0) + Number(r?.tip_amount || 0);
}

export function getArListPackagePrimaryLabel(r) {
  return r?.list_package_primary_label || r?.package_name_snapshot || r?.package_name || 'N/A';
}

export function getArListCombinedPackageAmount(r) {
  const v = r?.list_combined_package_amount;
  if (v != null && v !== '' && !Number.isNaN(Number(v))) return Number(v);
  return Number(r?.package_amount_snapshot || 0);
}

/** INV-{id} — only when a row exists in invoicestbl (same as Invoice page). */
export function formatArLinkedInvoiceLabel(row) {
  const id = Number(row?.linked_invoice_id);
  if (!Number.isFinite(id) || id <= 0) return null;
  return `INV-${id}`;
}

/** AR# for list: linked invoice_ar_number (Invoice page), else receipt number issued at AR creation. */
export function formatArLinkedInvoiceArNumber(row) {
  const display = String(row?.display_ar_number ?? '').trim();
  if (display) return display;
  const fromInvoice = String(row?.invoice_ar_number ?? '').trim();
  if (fromInvoice) return fromInvoice;
  const fromReceipt = String(row?.receipt_ar_number ?? '').trim();
  return fromReceipt || null;
}
