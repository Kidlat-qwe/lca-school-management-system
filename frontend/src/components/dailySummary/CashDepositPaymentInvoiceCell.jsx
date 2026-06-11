/**
 * Invoice column for cash-deposit payment tables — clickable when edits are allowed.
 */
export default function CashDepositPaymentInvoiceCell({ payment, canEdit, onEdit }) {
  const label = payment?.invoice_id ? `INV-${payment.invoice_id}` : '—';
  const description = String(payment?.invoice_description || '').trim();
  const title = description ? `${label} — ${description}` : label;

  if (!canEdit || !payment?.invoice_id || !payment?.payment_id) {
    return (
      <span className="font-medium text-gray-900" title={title}>
        {label}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onEdit(payment)}
      className="font-medium text-primary-700 hover:text-primary-900 hover:underline text-left"
      title={description ? `Update payment — ${description}` : 'Update payment details'}
    >
      {label}
    </button>
  );
}
