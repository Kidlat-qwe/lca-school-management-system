import { AR_PAGE_LEGEND_ITEMS } from '../../utils/acknowledgementReceiptStatus';

/**
 * Status legend for the Acknowledgement Receipts list — matches row display labels only.
 */
const AcknowledgementReceiptStatusLegend = ({ className = '' }) => (
  <div
    className={`rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 sm:px-4 sm:py-3 ${className}`}
  >
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Legend</span>
      {AR_PAGE_LEGEND_ITEMS.map((item) => (
        <div key={item.key} className="flex items-center gap-1.5" title={item.description}>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${item.tone}`}
          >
            {item.label}
          </span>
        </div>
      ))}
    </div>
  </div>
);

export default AcknowledgementReceiptStatusLegend;
