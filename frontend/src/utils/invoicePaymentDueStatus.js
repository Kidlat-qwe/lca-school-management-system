/** Normalize API / phase status strings to modal payment-due labels. */
export function normalizePaymentDueStatusLabel(source) {
  const normalized = String(source || '').trim().toLowerCase();
  if (normalized === 'under grace period') return 'Under grace period';
  if (normalized === 'overdue for penalty' || normalized === 'overdue') {
    return 'Overdue for penalty';
  }
  return null;
}

/** Prefer API field; fall back to installment phase display status. */
export function resolveInvoicePaymentDueStatusLabel(invoiceOrPhase) {
  if (!invoiceOrPhase) return null;
  return (
    normalizePaymentDueStatusLabel(invoiceOrPhase.payment_due_status_label) ||
    normalizePaymentDueStatusLabel(invoiceOrPhase.status)
  );
}
