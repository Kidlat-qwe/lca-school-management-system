import { getInvoiceDisplayAmount } from '../../utils/invoiceListAmount';

/**
 * Amount column for invoice list tables.
 * Single-line rows use vertical middle alignment; multi-line partial-payment parents use align-top.
 */
export function InvoiceListAmountCell({
  invoice,
  rejectedOverlay,
  className = 'px-6 py-4',
  style,
}) {
  const isMultiLine = Boolean(invoice?.balance_invoice_id);
  const tdClass = `${className} ${isMultiLine ? 'align-top' : 'align-middle'} whitespace-nowrap`;

  return (
    <td className={tdClass} style={style}>
      {invoice.balance_invoice_id ? (
        <div className="text-xs text-gray-900 space-y-2 leading-snug">
          <div>
            <div className="text-gray-500">
              Remaining (INV-{invoice.continued_to_invoice_id || invoice.balance_invoice_id}):
            </div>
            <div className="font-medium tabular-nums text-gray-900">
              ₱{Number(invoice.balance_invoice_amount ?? invoice.amount ?? 0).toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-gray-500">Paid on this invoice:</div>
            <div className="font-medium tabular-nums text-gray-900">
              ₱{Number(invoice.paid_amount ?? 0).toFixed(2)}
            </div>
          </div>
        </div>
      ) : rejectedOverlay ? (
        <div className="text-sm font-medium text-gray-900 tabular-nums">
          ₱{rejectedOverlay.amount.toFixed(2)}
        </div>
      ) : (
        <div className="text-sm text-gray-900 tabular-nums">
          {invoice.amount !== null && invoice.amount !== undefined
            ? `₱${getInvoiceDisplayAmount(invoice).toFixed(2)}`
            : '-'}
        </div>
      )}
    </td>
  );
}

/** Total Amount column — always vertically centered with tabular figures. */
export function InvoiceListTotalAmountCell({
  invoice,
  rejectedOverlay,
  className = 'px-6 py-4',
  style,
}) {
  const total = rejectedOverlay
    ? rejectedOverlay.totalAmount
    : Number(
        invoice.total_received_amount ||
          (Number(invoice.paid_amount || 0) + Number(invoice.total_tip_amount || 0))
      );

  return (
    <td className={`${className} align-middle whitespace-nowrap`} style={style}>
      <div className="text-sm font-medium text-gray-900 tabular-nums">
        ₱{Number(total).toFixed(2)}
      </div>
    </td>
  );
}
