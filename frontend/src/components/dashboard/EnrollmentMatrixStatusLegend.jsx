import { ENROLLMENT_MATRIX_STATUS_ITEMS } from '../../utils/programEnrollmentStatus';
import {
  hasMatrixStatusFilters,
  normalizeMatrixStatusFilters,
} from '../../utils/enrollmentMatrixSort';

/**
 * Status legend for phase/month enrollment matrix tables.
 * Click one or more statuses to show only matching cells; click again to remove from filter.
 */
const EnrollmentMatrixStatusLegend = ({
  className = '',
  activeStatusFilters = [],
  onStatusFilterChange,
}) => {
  const isInteractive = typeof onStatusFilterChange === 'function';
  const selectedKeys = normalizeMatrixStatusFilters(activeStatusFilters);
  const hasFilter = hasMatrixStatusFilters(selectedKeys);

  const activeLabels = selectedKeys
    .map((key) => ENROLLMENT_MATRIX_STATUS_ITEMS.find((i) => i.key === key)?.label || key)
    .join(', ');

  const handleStatusClick = (statusKey) => {
    if (!isInteractive) return;
    const next = selectedKeys.includes(statusKey)
      ? selectedKeys.filter((k) => k !== statusKey)
      : [...selectedKeys, statusKey];
    onStatusFilterChange(next);
  };

  return (
    <div
      className={`rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 sm:px-4 sm:py-3 ${className}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Legend</span>
        {isInteractive && hasFilter ? (
          <button
            type="button"
            onClick={() => onStatusFilterChange([])}
            className="rounded-md border border-gray-300 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-[#F7C844]/50"
          >
            Clear filter
          </button>
        ) : null}
        {ENROLLMENT_MATRIX_STATUS_ITEMS.map((item) => {
          const isActive = selectedKeys.includes(item.key);
          const badgeSymbol = item.key === 'not_enrolled' ? '—' : 'n';

          if (!isInteractive) {
            return (
              <div key={item.key} className="flex items-center gap-1.5" title={item.description}>
                <span
                  className={`inline-flex min-w-[1.75rem] items-center justify-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${item.tone}`}
                >
                  {badgeSymbol}
                </span>
                <span className="text-xs font-medium text-gray-700">{item.label}</span>
              </div>
            );
          }

          return (
            <button
              key={item.key}
              type="button"
              onClick={() => handleStatusClick(item.key)}
              aria-pressed={isActive}
              title={
                isActive
                  ? `Remove ${item.label} from filter`
                  : `${item.description} Click to add ${item.label} to the matrix filter.`
              }
              className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-[#F7C844]/50 ${
                isActive
                  ? 'bg-white ring-2 ring-[#F7C844] shadow-sm'
                  : 'hover:bg-white/80'
              }`}
            >
              <span
                className={`inline-flex min-w-[1.75rem] items-center justify-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${item.tone}`}
              >
                {badgeSymbol}
              </span>
              <span
                className={`text-xs font-medium ${isActive ? 'text-gray-900' : 'text-gray-700'}`}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
      {isInteractive && hasFilter ? (
        <p className="mt-2 text-[11px] text-gray-600">
          Showing only{' '}
          <span className="font-semibold text-gray-800">{activeLabels}</span> cells. Other statuses
          appear blank. Students with no matching cells are hidden. Click a selected status again or
          use Clear filter to restore the full matrix.
        </p>
      ) : isInteractive ? (
        <p className="mt-2 text-[11px] text-gray-500">
          Click one or more statuses to filter the matrix (all months or phases). Multiple selections
          are combined.
        </p>
      ) : null}
    </div>
  );
};

export default EnrollmentMatrixStatusLegend;
