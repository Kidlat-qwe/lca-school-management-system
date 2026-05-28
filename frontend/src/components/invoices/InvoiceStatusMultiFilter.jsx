import { useEffect, useRef, useState } from 'react';

const STATUS_SORT_ORDER = [
  'Paid',
  'Partially Paid',
  'Unpaid',
  'Pending',
  'Draft',
  'Cancelled',
  'Rejected',
];

function sortStatuses(statuses) {
  return [...statuses].sort((a, b) => {
    const ia = STATUS_SORT_ORDER.indexOf(a);
    const ib = STATUS_SORT_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return String(a).localeCompare(String(b));
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

/**
 * Multi-select status filter for Invoice list pages.
 * Empty `selectedStatuses` = all statuses (no filter).
 */
export default function InvoiceStatusMultiFilter({
  id = 'invoice-status-filter',
  label = 'Status',
  statuses = [],
  statusCounts = {},
  selectedStatuses = [],
  onChange,
  totalInScope = 0,
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const sortedStatuses = sortStatuses(statuses);
  const allSelected = selectedStatuses.length === 0;

  useEffect(() => {
    if (!open) return undefined;
    const onDocMouseDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  const toggleStatus = (status) => {
    if (selectedStatuses.includes(status)) {
      onChange(selectedStatuses.filter((s) => s !== status));
    } else {
      onChange([...selectedStatuses, status]);
    }
  };

  const buttonLabel = allSelected
    ? `All statuses (${totalInScope})`
    : selectedStatuses.length === 1
      ? `${selectedStatuses[0]} (${statusCounts[selectedStatuses[0]] || 0})`
      : `${selectedStatuses.length} statuses selected`;

  return (
    <div ref={wrapRef} className="relative status-filter-dropdown min-w-0">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-gray-700">
        {label}
      </label>
      <button
        id={id}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="truncate">{buttonLabel}</span>
        <svg
          className={`h-4 w-4 shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open ? (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="absolute left-0 right-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}
        >
          <button
            type="button"
            onClick={() => {
              onChange([]);
              setOpen(false);
            }}
            className={`block w-full px-3 py-2 text-left text-xs hover:bg-gray-100 ${
              allSelected ? 'bg-gray-100 font-medium text-gray-900' : 'text-gray-700'
            }`}
          >
            All statuses ({totalInScope})
          </button>
          {sortedStatuses.length > 0 ? (
            <>
              <div className="my-1 border-t border-gray-100" />
              <div className="flex items-center justify-between gap-2 px-3 py-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Select statuses
                </span>
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="text-[10px] font-semibold text-primary-600 hover:underline"
                >
                  Clear
                </button>
              </div>
              {sortedStatuses.map((status) => {
                const checked = selectedStatuses.includes(status);
                return (
                  <label
                    key={status}
                    className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                  >
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      checked={checked}
                      onChange={() => toggleStatus(status)}
                    />
                    <span className="flex-1 truncate">
                      {status}{' '}
                      <span className="text-gray-400">({statusCounts[status] || 0})</span>
                    </span>
                  </label>
                );
              })}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
