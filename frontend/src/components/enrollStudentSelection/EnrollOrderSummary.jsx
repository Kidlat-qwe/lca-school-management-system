const SCROLL_STYLE = {
  scrollbarWidth: 'thin',
  scrollbarColor: '#cbd5e0 #f7fafc',
  WebkitOverflowScrolling: 'touch',
};

function Money({ value }) {
  const n = parseFloat(value);
  const text = Number.isFinite(n)
    ? `₱${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '₱0.00';
  return <span>{text}</span>;
}

/**
 * Right-rail order summary for Select students / Configure items / Review.
 */
export default function EnrollOrderSummary({
  packageName,
  packagePrice,
  promoName,
  totalPrice,
  students = [],
  items = [],
  slotsAvailable = null,
  configuredCount = null,
  showInvoiceNote = false,
  classLabel = '',
}) {
  return (
    <aside
      className="rounded-xl border border-gray-200 bg-slate-50/80 p-4 space-y-4 min-h-0 lg:overflow-y-auto"
      style={SCROLL_STYLE}
    >
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Order summary
        </p>
        <p className="text-sm font-semibold text-gray-900 mt-0.5">
          {packageName || 'No package selected'}
        </p>
        {classLabel ? <p className="text-xs text-gray-500 mt-0.5">{classLabel}</p> : null}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs font-semibold text-gray-700">Students</p>
          <p className="text-[11px] text-gray-500">
            {students.length} student{students.length === 1 ? '' : 's'}
          </p>
        </div>
        {students.length === 0 ? (
          <p className="text-xs text-gray-500">None selected yet.</p>
        ) : (
          <ul className="space-y-1">
            {students.map((student) => (
              <li key={student.user_id} className="text-sm font-medium text-gray-900 truncate">
                {student.full_name}
              </li>
            ))}
          </ul>
        )}
        {configuredCount != null && students.length > 0 ? (
          <p className="text-[11px] font-medium text-emerald-700 mt-1.5">
            {configuredCount} of {students.length} configured
          </p>
        ) : null}
        {slotsAvailable != null ? (
          <p className="text-[11px] text-gray-500 mt-1">
            {slotsAvailable} slot{slotsAvailable === 1 ? '' : 's'} remaining
          </p>
        ) : null}
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-700 mb-1.5">Included items</p>
        {items.length === 0 ? (
          <p className="text-xs text-gray-500">No merchandise in this package.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((item, idx) => (
              <li key={`${item.name}-${idx}`} className="flex items-start gap-2">
                <div className="h-9 w-9 flex-shrink-0 overflow-hidden rounded-md bg-white ring-1 ring-gray-200">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-gray-400">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                      </svg>
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-1">
                    <p className="text-xs font-semibold text-gray-900 truncate">{item.name}</p>
                    <span className="flex-shrink-0 text-[10px] font-semibold text-emerald-700">
                      Included
                    </span>
                  </div>
                  {item.detail ? (
                    <p className="text-[11px] text-gray-500 truncate">{item.detail}</p>
                  ) : null}
                  {item.stockLabel ? (
                    <p
                      className={`text-[11px] font-medium ${
                        item.stockQty === 0 ? 'text-amber-700' : 'text-gray-600'
                      }`}
                    >
                      {item.stockLabel}
                    </p>
                  ) : null}
                  {item.swapped && item.replaces ? (
                    <p className="text-[10px] text-blue-700 mt-0.5">Replaces: {item.replaces}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="pt-3 border-t border-dashed border-gray-300 space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-600">Package price</span>
          <span className="font-medium text-gray-900">
            <Money value={packagePrice} />
          </span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-600">Promotion</span>
          <span className="font-medium text-gray-900 truncate max-w-[55%] text-right">
            {promoName || 'None'}
          </span>
        </div>
        <div className="flex items-center justify-between pt-1">
          <span className="text-sm font-semibold text-gray-900">Total</span>
          <span className="text-base font-bold text-gray-900">
            <Money value={totalPrice != null ? totalPrice : packagePrice} />
          </span>
        </div>
      </div>

      {showInvoiceNote ? (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
          <svg className="w-4 h-4 text-emerald-700 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <p className="text-[11px] text-emerald-900 leading-snug">
            An invoice will be generated automatically after enrollment.
          </p>
        </div>
      ) : null}
    </aside>
  );
}
