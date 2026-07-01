/**
 * On-screen preview styled like the printed Acknowledgement Receipt (A4 portrait AR PDF).
 * Uses PHP formatting and bordered table to match finance documents.
 */

export function formatPhpReceiptLine(amount) {
  const n = Number(amount) || 0;
  return `PHP ${n.toFixed(2)}`;
}

const DEFAULT_LOGO = '/LCA Icon.png';
const MIN_DATA_ROWS = 6;

export default function AcknowledgementReceiptStylePreview({
  companyName = 'Little Champions Academy Inc.',
  branchAddress,
  branchPhone,
  branchEmail,
  /** When address/phone/email missing, show this as a location line (e.g. branch nickname) */
  branchFallbackLine,
  receiptNo = '—',
  studentName = '—',
  classLabel = '-',
  receiptDateDisplay = '—',
  /** Prepared by signature text (should include the issuer name and issued date). */
  preparedByText = '',
  /** Received by signature text (usually parent/guardian name). */
  receivedByText = '',
  /** { description, rate, amount } numeric rate/amount for PHP display */
  tableRows = [],
  /** Grand total for footer (PHP); if omitted, sums table row amounts */
  totalAmount,
  emptyRowCount = MIN_DATA_ROWS,
}) {
  const rows = Array.isArray(tableRows) ? tableRows : [];
  const sumFromRows = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const total = totalAmount != null && !Number.isNaN(Number(totalAmount)) ? Number(totalAmount) : sumFromRows;
  const padCount =
    rows.length > 0 && rows.length < (emptyRowCount || MIN_DATA_ROWS)
      ? Math.max(0, (emptyRowCount || MIN_DATA_ROWS) - rows.length)
      : 0;

  const addrLine = (branchAddress || '').trim() || (branchFallbackLine || '').trim() || '—';
  const phoneLine = (branchPhone || '').trim() || '—';
  const emailLine = (branchEmail || '').trim() || '—';

  const cellBorder =
    'border border-gray-900 px-2 py-2 align-top text-[11px] leading-snug sm:text-xs sm:leading-normal';
  const descCellClass = `${cellBorder} break-words whitespace-normal`;

  return (
    <div
      className="border-2 border-gray-900 bg-white text-gray-900"
      style={{
        fontFamily: 'Helvetica Neue, Helvetica, ui-sans-serif, system-ui, sans-serif',
      }}
    >
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div className="flex min-w-0 flex-1 gap-3">
          <img
            src={DEFAULT_LOGO}
            alt=""
            className="h-12 w-12 shrink-0 object-contain sm:h-14 sm:w-14"
            onError={(e) => {
              e.target.style.display = 'none';
            }}
          />
          <div className="min-w-0 text-[11px] leading-snug sm:text-xs sm:leading-relaxed">
            <div className="text-sm font-bold leading-tight sm:text-[15px]">{companyName}</div>
            <div className="mt-0.5 break-words">{addrLine}</div>
            <div className="mt-0.5">Contact: {phoneLine}</div>
            <div className="mt-0.5 break-all">Email: {emailLine}</div>
          </div>
        </div>
        <div className="shrink-0 text-left sm:text-right">
          <div className="text-[15px] font-bold tracking-wide sm:text-lg">ACKNOWLEDGEMENT RECEIPT</div>
          <div className="mt-1 text-sm font-bold sm:text-base">No. {receiptNo}</div>
        </div>
      </div>

      <div className="border-t-2 border-gray-900 px-4 py-3 text-[11px] sm:px-6 sm:text-xs">
        <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
          <div className="min-w-0 sm:max-w-[65%]">
            <span className="font-bold">STUDENT NAME:</span>{' '}
            <span className="break-words">{studentName}</span>
          </div>
          <div className="shrink-0 sm:text-right">
            <span className="font-bold">DATE:</span> {receiptDateDisplay}
          </div>
        </div>
        <div className="mt-1">
          <span className="font-bold">CLASS:</span> {classLabel || '-'}
        </div>
      </div>

      <div
        className="overflow-x-auto px-2 pb-2 sm:px-4"
        style={{
          scrollbarWidth: 'thin',
          scrollbarColor: '#cbd5e0 #f7fafc',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <table className="w-full border-collapse text-[11px] sm:text-xs" style={{ minWidth: '520px', width: '100%' }}>
          <thead>
            <tr className="bg-gray-200">
              <th className={`${cellBorder} text-left font-bold`}>DESCRIPTION</th>
              <th className={`${cellBorder} w-[120px] text-right font-bold sm:w-[140px]`}>RATE</th>
              <th className={`${cellBorder} w-[120px] text-right font-bold sm:w-[140px]`}>AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3} className={`${cellBorder} text-center text-gray-500`}>
                  No line items
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr key={idx} className={row.excludeFromTotal ? 'text-gray-600' : undefined}>
                  <td className={descCellClass}>{row.description || '—'}</td>
                  <td className={`${cellBorder} whitespace-nowrap text-right`}>
                    {formatPhpReceiptLine(row.rate)}
                  </td>
                  <td className={`${cellBorder} whitespace-nowrap text-right`}>
                    {formatPhpReceiptLine(row.amount)}
                  </td>
                </tr>
              ))
            )}
            {rows.length > 0 &&
              Array.from({ length: padCount }).map((_, i) => (
                <tr key={`pad-${i}`}>
                  <td className={cellBorder}>&nbsp;</td>
                  <td className={cellBorder}>&nbsp;</td>
                  <td className={cellBorder}>&nbsp;</td>
                </tr>
              ))}
            <tr>
              <td
                className={`${cellBorder} bg-white text-center text-[10px] font-semibold tracking-[0.25em] sm:text-xs`}
                colSpan={2}
              >
                THANK YOU !
              </td>
              <td className={`${cellBorder} bg-white text-right text-[10px] font-bold sm:text-xs`}>
                TOTAL {formatPhpReceiptLine(total)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex flex-col justify-between gap-6 px-4 pb-6 pt-4 text-[11px] sm:flex-row sm:px-6 sm:text-xs">
        <div className="flex-1">
          <span className="font-semibold">Prepared by:</span>
          <span className="ml-2 inline-block min-w-[12rem] border-b border-gray-900 align-bottom sm:min-w-[16rem]">
            {preparedByText || ''}
          </span>
        </div>
        <div className="flex-1 sm:text-right">
          <span className="font-semibold">Received by:</span>
          <span className="ml-2 inline-block min-w-[10rem] border-b border-gray-900 align-bottom sm:min-w-[12rem]">
            {receivedByText || ''}
          </span>
        </div>
      </div>
    </div>
  );
}
