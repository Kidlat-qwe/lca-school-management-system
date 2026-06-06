import MatrixInfoTooltip from './MatrixInfoTooltip';

const VISIBLE_ROW_COUNT = 3;
const ROW_HEIGHT_REM = 2.5;
const SCROLL_MAX_HEIGHT = `${(VISIBLE_ROW_COUNT + 1) * ROW_HEIGHT_REM}rem`;

const formatNumber = (value) => (Number(value) || 0).toLocaleString('en-PH');

const formatDate = (value) => {
  if (!value) return '—';
  const text = String(value).slice(0, 10);
  const [year, month, day] = text.split('-');
  if (!year || !month || !day) return text;
  return `${month}/${day}/${year}`;
};

const RecentMerchandiseReleasesLog = ({
  title = 'Recent merchandise releases',
  tooltip,
  releases = [],
  emptyMessage = 'No merchandise releases for this period.',
  onViewAll,
  viewAllLabel = 'View all details',
}) => {
  const rows = releases || [];
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
            className="flex-shrink-0 text-xs font-medium text-amber-700 hover:text-amber-900"
          >
            {viewAllLabel}
          </button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">{emptyMessage}</p>
      ) : (
        <div
          className="min-h-0 flex-1 overflow-x-auto overflow-y-auto rounded-lg"
          style={{
            maxHeight: SCROLL_MAX_HEIGHT,
            scrollbarWidth: 'thin',
            scrollbarColor: '#cbd5e0 #f7fafc',
            WebkitOverflowScrolling: 'touch',
          }}
          aria-label={hasScroll ? 'Scroll for more merchandise releases' : undefined}
        >
          <table style={{ width: '100%', minWidth: '360px' }} className="border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-white text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <th className="sticky top-0 z-10 bg-white px-2 py-2 shadow-[inset_0_-1px_0_#f3f4f6]">Item</th>
                <th className="sticky top-0 z-10 bg-white px-2 py-2 shadow-[inset_0_-1px_0_#f3f4f6]">Student</th>
                <th className="sticky top-0 z-10 bg-white px-2 py-2 text-right shadow-[inset_0_-1px_0_#f3f4f6]">Qty</th>
                <th className="sticky top-0 z-10 bg-white px-2 py-2 text-right shadow-[inset_0_-1px_0_#f3f4f6]">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr key={row.release_log_id} className="text-gray-800">
                  <td className="px-2 py-2 min-w-0 max-w-[160px]">
                    <span className="block truncate" title={row.item_label || '—'}>
                      {row.item_label || '—'}
                    </span>
                  </td>
                  <td className="px-2 py-2 min-w-0 max-w-[120px]">
                    <span className="block truncate" title={row.student_name || '—'}>
                      {row.student_name || '—'}
                    </span>
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap text-right font-semibold tabular-nums text-gray-900">
                    {formatNumber(row.quantity)}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap text-right text-gray-600">
                    {formatDate(row.released_date)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 h-1 bg-amber-400" />
    </div>
  );
};

export default RecentMerchandiseReleasesLog;
