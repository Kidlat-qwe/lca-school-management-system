/**
 * Tab strip aligned with Daily Summary Sales (underline active tab, border-b container).
 * @see frontend/src/pages/shared/DailySummarySalesApprovalPage.jsx
 */
export function BranchPaymentLogTabs({
  value,
  onChange,
  mainLabel = 'Payment logs',
  returnLabel = 'Return',
  ariaLabel = 'Payment log views',
  /** When set (e.g. number), shown as a superscript count on the Return tab (return queue size). */
  returnBadgeCount,
}) {
  const showReturnBadge = returnBadgeCount != null && Number(returnBadgeCount) > 0;
  return (
    <div className="border-b border-gray-200">
      <nav className="flex flex-wrap gap-4" aria-label={ariaLabel}>
        <button
          type="button"
          onClick={() => onChange('main')}
          className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
            value === 'main'
              ? 'border-primary-600 text-primary-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          {mainLabel}
        </button>
        <button
          type="button"
          onClick={() => onChange('return')}
          className={`inline-flex items-center gap-2 py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
            value === 'return'
              ? 'border-primary-600 text-primary-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          <span>{returnLabel}</span>
          {showReturnBadge ? (
            <span
              className="inline-flex min-h-[1.5rem] min-w-[1.5rem] shrink-0 items-center justify-center rounded-full bg-red-600 px-2 text-sm font-bold leading-none text-white tabular-nums shadow-sm"
              title={`${returnBadgeCount} returned`}
            >
              {Number(returnBadgeCount) > 99 ? '99+' : returnBadgeCount}
            </span>
          ) : null}
        </button>
      </nav>
    </div>
  );
}

/** Finance and Superfinance use {@link BranchPaymentLogTabs} (Payment logs + Return) with the same values: main | return. */
