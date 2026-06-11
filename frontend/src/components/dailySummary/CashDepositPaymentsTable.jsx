import { formatDateManila } from '../../utils/dateUtils';
import {
  getPaymentLogTableAmountColumn,
  getPaymentLogTableTotalAmountColumn,
} from '../../utils/paymentLogTableAmounts';
import CashDepositPaymentInvoiceCell from './CashDepositPaymentInvoiceCell';

const formatCurrency = (amount) =>
  `₱${(Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const paymentStatusBadge = (status) => {
  const colors = {
    Completed: 'bg-green-100 text-green-800',
    Pending: 'bg-yellow-100 text-yellow-800',
    Failed: 'bg-red-100 text-red-800',
    Cancelled: 'bg-gray-100 text-gray-800',
  };
  const key = String(status || '').trim();
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${colors[key] || 'bg-gray-100 text-gray-800'}`}
    >
      {key || 'N/A'}
    </span>
  );
};

const paymentRowKey = (payment, index) => {
  const id = payment?.payment_id;
  if (id != null && id !== '') return `cash-dep-pay-${id}`;
  return `cash-dep-pay-${index}-${payment?.invoice_id || 'na'}`;
};

/**
 * Cash payment lines table — same columns as Payment Logs → Deposit Cash modal.
 */
export default function CashDepositPaymentsTable({
  payments = [],
  emptyMessage = 'No payments in this date range.',
  canEditInvoices = false,
  onEditPayment,
}) {
  const rows = Array.isArray(payments) ? payments : [];

  return (
    <div
      className="overflow-x-auto rounded-lg border border-gray-200"
      style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}
    >
      <table className="divide-y divide-gray-200 text-sm" style={{ width: '100%', minWidth: '1060px' }}>
        <thead className="bg-gray-50">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
              Payment date
            </th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
              Invoice
            </th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
              Student
            </th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
              Payment Method
            </th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
              Amount
            </th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
              Total Amount
            </th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
              Status
            </th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
              Acknowledgement Receipt#
            </th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
              Reference
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((p, idx) => (
              <tr key={paymentRowKey(p, idx)} className="hover:bg-gray-50/80">
                <td className="px-3 py-2 whitespace-nowrap text-gray-700">
                  {formatDateManila(p.payment_date || p.issue_date)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <CashDepositPaymentInvoiceCell
                    payment={p}
                    canEdit={canEditInvoices}
                    onEdit={onEditPayment}
                  />
                </td>
                <td className="px-3 py-2 text-gray-800 min-w-0 max-w-[200px]">
                  <span className="truncate block" title={p.student_name || '-'}>
                    {p.student_name || '-'}
                  </span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-gray-700">{p.payment_method || '-'}</td>
                <td className="px-3 py-2 text-right font-semibold text-green-600 whitespace-nowrap">
                  {formatCurrency(getPaymentLogTableAmountColumn(p))}
                </td>
                <td className="px-3 py-2 text-right font-semibold text-emerald-700 whitespace-nowrap">
                  {formatCurrency(getPaymentLogTableTotalAmountColumn(p))}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{paymentStatusBadge(p.status)}</td>
                <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{p.invoice_ar_number || '—'}</td>
                <td className="px-3 py-2 text-gray-600 min-w-0 max-w-[140px]">
                  <span className="truncate block" title={p.reference_number || '-'}>
                    {p.reference_number || '-'}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
