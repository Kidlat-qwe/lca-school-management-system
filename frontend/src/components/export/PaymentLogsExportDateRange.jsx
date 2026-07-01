/**
 * Payment date range controls for Payment Logs export modal.
 * Values are YYYY-MM-DD; sent to API as payment_date_from / payment_date_to (Manila calendar day).
 */
export default function PaymentLogsExportDateRange({
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onClear,
  disabled = false,
  idPrefix = 'pl-export',
}) {
  return (
    <div className="space-y-3 border-b border-gray-100 pb-4">
      <p className="text-sm font-medium text-gray-900">Payment date</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${idPrefix}-from`} className="mb-1 block text-xs font-medium text-gray-600">
            From
          </label>
          <input
            id={`${idPrefix}-from`}
            type="date"
            value={dateFrom}
            onChange={(e) => onDateFromChange(e.target.value)}
            disabled={disabled}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:opacity-60"
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-to`} className="mb-1 block text-xs font-medium text-gray-600">
            To
          </label>
          <input
            id={`${idPrefix}-to`}
            type="date"
            value={dateTo}
            onChange={(e) => onDateToChange(e.target.value)}
            disabled={disabled}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:opacity-60"
          />
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={onClear}
          disabled={disabled}
          className="text-left text-sm font-medium text-primary-600 hover:text-primary-800 hover:underline disabled:opacity-50"
        >
          Clear dates
        </button>
        <p className="text-xs leading-relaxed text-gray-500 sm:max-w-md">
          Inclusive range on payment date (Manila). Leave both empty to include all dates.
        </p>
      </div>
    </div>
  );
}
