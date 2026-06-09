import MatrixInfoTooltip from './MatrixInfoTooltip';

const formatNumber = (value) => (Number(value) || 0).toLocaleString('en-PH');
const formatRate = (value) => `${(Number(value) || 0).toFixed(2)}%`;

const OperationalReEnrollmentRateTable = ({
  breakdown = null,
  tooltip = '',
  emptyMessage = 'No re-enrollment rate breakdown available.',
}) => {
  const rows = breakdown?.rows || [];
  const totals = breakdown?.totals || null;
  const priorLabel = breakdown?.prior_period_label;
  const formula = breakdown?.formula;

  if (!rows.length && !totals) {
    return (
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100">
        <p className="flex items-center gap-0.5 text-sm font-semibold text-gray-700">
          <span>Re-enrollment rate breakdown</span>
          {tooltip ? (
            <MatrixInfoTooltip label="About re-enrollment rate breakdown">{tooltip}</MatrixInfoTooltip>
          ) : null}
        </p>
        <p className="mt-3 text-sm text-gray-500">{emptyMessage}</p>
      </div>
    );
  }

  const tableRows = totals ? [...rows, totals] : rows;

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="flex flex-wrap items-center gap-0.5 text-sm font-semibold text-gray-700">
            <span>Re-enrollment rate breakdown</span>
            {tooltip ? (
              <MatrixInfoTooltip label="About re-enrollment rate breakdown">{tooltip}</MatrixInfoTooltip>
            ) : null}
          </p>
          {priorLabel ? (
            <p className="mt-1 text-xs text-gray-500">Prior period: {priorLabel}</p>
          ) : null}
          {formula ? (
            <p className="mt-1 text-xs text-gray-500">{formula}</p>
          ) : null}
        </div>
      </div>

      <div
        className="overflow-x-auto rounded-lg"
        style={{
          scrollbarWidth: 'thin',
          scrollbarColor: '#cbd5e0 #f7fafc',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <table style={{ width: '100%', minWidth: '520px' }} className="border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2.5">Branch</th>
              <th className="px-3 py-2.5 text-right">Re-enrolled (KPI)</th>
              <th className="px-3 py-2.5 text-right">Retention base</th>
              <th className="px-3 py-2.5 text-right">Rate</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row, index) => {
              const isTotal = totals && index === tableRows.length - 1;
              return (
                <tr
                  key={`${row.branch_id ?? 'total'}-${row.branch_name}-${index}`}
                  className={`border-b border-gray-100 ${isTotal ? 'bg-amber-50/60 font-semibold' : 'hover:bg-gray-50'}`}
                >
                  <td className="px-3 py-2.5 text-gray-900">{row.branch_name || '—'}</td>
                  <td className="px-3 py-2.5 text-right text-gray-700">
                    {formatNumber(row.re_enrollment_kpi_count)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-gray-700">
                    {formatNumber(row.retention_base_count)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-indigo-700">
                    {formatRate(row.re_enrollment_rate)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default OperationalReEnrollmentRateTable;
