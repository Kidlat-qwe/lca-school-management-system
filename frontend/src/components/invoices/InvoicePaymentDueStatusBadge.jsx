import { resolveInvoicePaymentDueStatusLabel } from '../../utils/invoicePaymentDueStatus';

/**
 * Shows "Under grace period" or "Overdue for penalty" on invoice / payment modals.
 * Pass `label` directly, or an invoice/phase object with payment_due_status_label / status.
 */
export default function InvoicePaymentDueStatusBadge({ label, invoice, className = '' }) {
  const resolved =
    normalizeDisplayLabel(label) || resolveInvoicePaymentDueStatusLabel(invoice);
  if (!resolved) return null;

  const isGrace = resolved === 'Under grace period';

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
        isGrace
          ? 'bg-amber-100 text-amber-800 border-amber-200'
          : 'bg-red-100 text-red-800 border-red-200'
      } ${className}`}
    >
      {resolved}
    </span>
  );
}

function normalizeDisplayLabel(raw) {
  const normalized = String(raw || '').trim().toLowerCase();
  if (normalized === 'under grace period') return 'Under grace period';
  if (normalized === 'overdue for penalty' || normalized === 'overdue') {
    return 'Overdue for penalty';
  }
  return null;
}
