import { Link } from 'react-router-dom';
import {
  buildAcknowledgementReceiptsListLink,
  buildInvoiceListLink,
  isInvoiceLinkedToAcknowledgementReceipt,
  resolveInvoiceAckReceiptIdForCrossLink,
} from '../../utils/arInvoiceCrossLink';
import { formatArLinkedInvoiceArNumber, formatArLinkedInvoiceLabel } from '../../utils/acknowledgementReceiptDisplay';

const linkClassName =
  'font-medium text-primary-600 hover:text-primary-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 rounded';

export function ArInvoiceIdLink({ userType, receipt, className = '' }) {
  const label = formatArLinkedInvoiceLabel(receipt);
  const to = buildInvoiceListLink(userType, receipt?.linked_invoice_id);
  if (!label || !to) {
    return (
      <span className="text-gray-300" title="No invoice yet — appears after enrollment or when an invoice is linked on the Invoice page">
        —
      </span>
    );
  }
  return (
    <Link
      to={to}
      className={`${linkClassName} ${className}`.trim()}
      title={`View ${label} on Invoice page`}
    >
      {label}
    </Link>
  );
}

export function ArNumberLink({ userType, receipt, className = '' }) {
  const arNumber = formatArLinkedInvoiceArNumber(receipt);
  if (!arNumber) {
    return (
      <span className="text-gray-300" title="No acknowledgement receipt number">
        —
      </span>
    );
  }
  const to = buildAcknowledgementReceiptsListLink(userType, {
    ackReceiptId: receipt?.ack_receipt_id,
    arNumber,
    invoiceId: receipt?.linked_invoice_id,
  });
  if (!to) {
    return <span title={arNumber}>{arNumber}</span>;
  }
  return (
    <Link
      to={to}
      className={`${linkClassName} ${className}`.trim()}
      title={`View acknowledgement receipt ${arNumber}`}
    >
      {arNumber}
    </Link>
  );
}

export function InvoiceArNumberLink({ userType, invoice, className = '' }) {
  const arNumber = String(invoice?.invoice_ar_number ?? '').trim();
  if (!arNumber) {
    return <span className="text-gray-300">—</span>;
  }
  if (!isInvoiceLinkedToAcknowledgementReceipt(invoice)) {
    return (
      <span className={className} title={arNumber}>
        {arNumber}
      </span>
    );
  }
  const to = buildAcknowledgementReceiptsListLink(userType, {
    ackReceiptId: resolveInvoiceAckReceiptIdForCrossLink(invoice),
    invoiceId: invoice?.invoice_id,
    arNumber,
  });
  if (!to) {
    return <span title={arNumber}>{arNumber}</span>;
  }
  const invLabel = invoice?.invoice_id ? `INV-${invoice.invoice_id}` : 'invoice';
  return (
    <Link
      to={to}
      className={`${linkClassName} ${className}`.trim()}
      title={`View acknowledgement receipt ${arNumber} for ${invLabel} on Acknowledgement Receipts`}
    >
      {arNumber}
    </Link>
  );
}

export function InvoiceIdLink({ userType, invoice, className = '' }) {
  const label = invoice?.invoice_id ? `INV-${invoice.invoice_id}` : null;
  const to = buildInvoiceListLink(userType, invoice?.invoice_id);
  if (!label || !to) return null;
  return (
    <Link
      to={to}
      className={`${linkClassName} ${className}`.trim()}
      title={`View ${label}`}
    >
      {label}
    </Link>
  );
}
