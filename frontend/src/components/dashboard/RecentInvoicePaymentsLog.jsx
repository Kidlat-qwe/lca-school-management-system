import MatrixInfoTooltip from './MatrixInfoTooltip';
import { PaymentLogPackageItemCell } from '../paymentLogs/PaymentLogPackageItemCell';

const VISIBLE_ROW_COUNT = 3;
const ROW_HEIGHT_REM = 2.5;
/** Header + three visible body rows */
const SCROLL_MAX_HEIGHT = `${(VISIBLE_ROW_COUNT + 1) * ROW_HEIGHT_REM}rem`;

const formatCurrency = (amount) =>
  `Php ${(Number(amount) || 0).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatDate = (value) => {
  if (!value) return '—';
  const text = String(value).slice(0, 10);
  const [year, month, day] = text.split('-');
  if (!year || !month || !day) return text;
  return `${month}/${day}/${year}`;
};

const RecentInvoicePaymentsLog = ({
  title = 'Recent invoice payments',
  tooltip,
  payments = [],
  emptyMessage = 'No invoice payments for this period.',
  onViewAll,
  viewAllLabel = 'View all in Payment Logs',
}) => {
  const rows = payments || [];
  const hasScroll = rows.length > VISIBLE_ROW_COUNT;

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100">
      <div className="mb-3 flex flex-shrink-0 items-start justify-between gap-3">
        <p className="flex min-w-0 flex-wrap items-center gap-0.5 text-sm font-semibold leading-tight text-gray-700">
          <span>{title}</span>
          {tooltip ? <MatrixInfoTooltip label={`About ${title}`}>{tooltip}</MatrixInfoTooltip> : null}
        </p>
        {onViewAll ? (
          <button
            type="button"
            onClick={onViewAll}
            className="flex-shrink-0 text-xs font-medium text-indigo-600 hover:text-indigo-800"
          >
            {viewAllLabel}
          </button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">{emptyMessage}</p>
      ) : (
        <div
          className="min-h-0 flex-1 overflow-y-auto rounded-lg"
          style={{
            maxHeight: SCROLL_MAX_HEIGHT,
            scrollbarWidth: 'thin',
            scrollbarColor: '#cbd5e0 #f7fafc',
            WebkitOverflowScrolling: 'touch',
          }}
          aria-label={hasScroll ? 'Scroll for more invoice payments' : undefined}
        >
          <table style={{ width: '100%' }} className="border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-white text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <th className="sticky top-0 z-10 w-[72px] bg-white px-2 py-2 shadow-[inset_0_-1px_0_#f3f4f6]">
                  Invoice
                </th>
                <th className="sticky top-0 z-10 bg-white px-2 py-2 shadow-[inset_0_-1px_0_#f3f4f6]">
                  <span className="leading-tight">Package/<br />item</span>
                </th>
                <th className="sticky top-0 z-10 w-[22%] bg-white px-2 py-2 shadow-[inset_0_-1px_0_#f3f4f6]">
                  Student
                </th>
                <th className="sticky top-0 z-10 w-[88px] bg-white px-2 py-2 text-right shadow-[inset_0_-1px_0_#f3f4f6]">
                  Amount
                </th>
                <th className="sticky top-0 z-10 w-[76px] bg-white px-2 py-2 text-right shadow-[inset_0_-1px_0_#f3f4f6]">
                  Date
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr key={row.payment_id} className="text-gray-800">
                  <td className="px-2 py-2 whitespace-nowrap font-medium text-gray-900">
                    {row.invoice_label || '—'}
                  </td>
                  <PaymentLogPackageItemCell payment={row} className="px-2 py-2 min-w-0" />
                  <td className="px-2 py-2 min-w-0">
                    <span className="block truncate" title={row.student_name || '—'}>
                      {row.student_name || '—'}
                    </span>
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap text-right font-semibold tabular-nums text-gray-900">
                    {formatCurrency(row.amount)}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap text-right text-xs text-gray-600">
                    {formatDate(row.issue_date)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 h-1 bg-indigo-500" />
    </div>
  );
};

export default RecentInvoicePaymentsLog;
