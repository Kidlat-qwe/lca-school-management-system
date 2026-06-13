/**
 * Display helpers for GET /acknowledgement-receipts list rows.
 * Downpayment + Phase 1 uses two AR rows; each row shows its own line total
 * (downpayment on the leader, Phase 1 on the paired row).
 */

/** Synthetic invoice-only rows — hidden on the AR page (AR# still on Invoice page). */
export const AR_INVOICE_ONLY_PACKAGE_LABEL = 'Invoice payment (no AR record)';

/** True when the row is not a real acknowledgement receipt (invoice-only ghost). */
export function isArInvoiceOnlyGhostListRow(r) {
  if (!r) return false;
  if (r.invoice_only_payment) return true;
  return getArListPackagePrimaryLabel(r).trim() === AR_INVOICE_ONLY_PACKAGE_LABEL;
}

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
