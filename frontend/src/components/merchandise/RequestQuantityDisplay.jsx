import {
  formatRequestQuantityLabel,
  getRequestQuantityAdjustmentRemarks,
  getRequestQuantityAdjustedBy,
  hasInventoryQuantityAdjustment,
} from '../../utils/merchandiseRequests/quantityAdjustment';

/**
 * Read-only quantity cell for My Requests (RHET may reduce qty before ship).
 */
export default function RequestQuantityDisplay({ request, className = '' }) {
  if (!request) return <span className={className}>—</span>;

  const label = formatRequestQuantityLabel(request);
  const adjusted = hasInventoryQuantityAdjustment(request);
  const remarks = getRequestQuantityAdjustmentRemarks(request);
  const adjustedBy = getRequestQuantityAdjustedBy(request);
  const title = [remarks, adjustedBy ? `Adjusted by ${adjustedBy}` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={className}>
      <div className="text-sm text-gray-900">{label}</div>
      {adjusted ? (
        <span
          className="inline-flex items-center mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-900"
          title={title || 'Quantity adjusted by warehouse'}
        >
          Qty adjusted by warehouse
        </span>
      ) : null}
      {adjusted && remarks ? (
        <div className="text-xs text-gray-500 mt-0.5 max-w-[220px] truncate" title={remarks}>
          {remarks}
        </div>
      ) : null}
    </div>
  );
}
