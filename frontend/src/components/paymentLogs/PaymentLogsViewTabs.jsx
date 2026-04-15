/**
 * Tab strip aligned with Daily Summary Sales (underline active tab, border-b container).
 * @see frontend/src/pages/shared/DailySummarySalesApprovalPage.jsx
 */
export function BranchPaymentLogTabs({ value, onChange }) {
  return (
    <div className="border-b border-gray-200">
      <nav className="flex flex-wrap gap-4" aria-label="Payment log views">
        <button
          type="button"
          onClick={() => onChange('main')}
          className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
            value === 'main'
              ? 'border-primary-600 text-primary-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          Payment logs
        </button>
        <button
          type="button"
          onClick={() => onChange('return')}
          className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
            value === 'return'
              ? 'border-primary-600 text-primary-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          Return
        </button>
      </nav>
    </div>
  );
}

/** Finance and Superfinance use {@link BranchPaymentLogTabs} (Payment logs + Return) with the same values: main | return. */
