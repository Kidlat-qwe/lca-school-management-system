/**
 * Horizontal status modules for Merchandise request lists
 * (Pending / Shipped / Delivered / Returned / Rejected) — RHET Inventory-style.
 */

import {
  REQUEST_STATUS_MODULES,
  countRequestsByStatusModule,
  DEFAULT_REQUEST_STATUS_MODULE,
} from '../../utils/merchandiseRequests/requestStatusModules';

/**
 * @param {{
 *   requests?: Array<{ status?: string }>,
 *   value?: string,
 *   onChange?: (key: string) => void,
 *   className?: string,
 * }} props
 */
export default function MerchandiseRequestStatusModules({
  requests = [],
  value = DEFAULT_REQUEST_STATUS_MODULE,
  onChange,
  className = '',
}) {
  const counts = countRequestsByStatusModule(requests);
  const selected = value || DEFAULT_REQUEST_STATUS_MODULE;

  return (
    <div
      className={`flex flex-wrap gap-2 sm:gap-3 ${className}`}
      role="tablist"
      aria-label="Filter requests by status"
    >
      {REQUEST_STATUS_MODULES.map((mod) => {
        const isActive = selected === mod.key;
        const count = counts[mod.key] || 0;
        return (
          <button
            key={mod.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange?.(mod.key)}
            className={`inline-flex items-center gap-1.5 sm:gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors min-h-[40px] ${
              isActive
                ? mod.activeClass
                : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300'
            }`}
          >
            <span className="tabular-nums font-semibold">{count}</span>
            <span>{mod.label}</span>
          </button>
        );
      })}
    </div>
  );
}
