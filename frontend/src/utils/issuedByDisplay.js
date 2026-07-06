/**
 * Invoice Issued by / Received by display helpers.
 *
 * Issued by:
 *   - Auto-generated invoices (created_by null or Auto-generated remarks) → "System Generated"
 *   - Manually generated invoices → user who created the invoice
 *
 * Received by:
 *   - Staff who recorded the latest completed payment (paymenttbl.created_by)
 */

export function formatIssuedByDisplayName(name) {
  const trimmed = String(name || '').trim();
  return trimmed || '—';
}

export function isSystemGeneratedInvoice(invoice) {
  if (!invoice) return false;
  const createdBy = invoice.created_by;
  if (createdBy == null || createdBy === '' || createdBy === 0) {
    return true;
  }
  const remarks = String(invoice.remarks || '');
  if (/Auto-generated/i.test(remarks)) {
    return true;
  }
  return false;
}

export function getInvoiceIssuedByLabel(invoice) {
  if (!invoice) return '—';
  if (isSystemGeneratedInvoice(invoice)) {
    return 'System Generated';
  }
  const name = String(
    invoice.created_by_name || invoice.issued_by_name || invoice.prepared_by_name || ''
  ).trim();
  if (name) return name;
  if (invoice.created_by) return `User #${invoice.created_by}`;
  return 'System Generated';
}

export function getInvoiceReceivedByLabel(invoice) {
  if (!invoice) return '—';
  const name = String(
    invoice.payment_recorded_by_name ||
      invoice.received_by_name ||
      invoice.payment_created_by_name ||
      ''
  ).trim();
  return name || '—';
}

export function getArIssuedByLabel(receipt) {
  return formatIssuedByDisplayName(receipt?.prepared_by_name);
}
