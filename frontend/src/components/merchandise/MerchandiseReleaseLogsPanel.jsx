import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../config/api';
import { formatDateManila, manilaMonthYYYYMM, todayManilaYMD } from '../../utils/dateUtils';

const tableScrollStyle = {
  scrollbarWidth: 'thin',
  scrollbarColor: '#cbd5e0 #f7fafc',
  WebkitOverflowScrolling: 'touch',
};

const formatNumber = (value) => (Number(value) || 0).toLocaleString('en-PH');

const sourceLabel = (source) => {
  if (source === 'merchandise_ar') return 'Merchandise AR';
  if (source === 'package_enroll') return 'Package (first payment)';
  return source || '—';
};

const itemLabel = (row) => {
  const name = row.merchandise_name || `Item #${row.merchandise_id || '—'}`;
  const size = row.size ? ` (${row.size})` : '';
  const cat = row.category ? ` · ${row.category}` : '';
  return `${name}${size}${cat}`;
};

const referenceLabel = (row) => {
  if (row.payment_id) return `PAY-${row.payment_id}`;
  if (row.ack_receipt_id) return `AR-${row.ack_receipt_id}`;
  return '—';
};

/**
 * Merchandise page tab: release log for issued/released stocks.
 * Uses GET /dashboard/merchandise-released-details (day or month).
 */
const MerchandiseReleaseLogsPanel = ({
  branchId = '',
  branchName = '',
  showBranchColumn = true,
}) => {
  const [periodMode, setPeriodMode] = useState('monthly');
  const [summaryMonth, setSummaryMonth] = useState(manilaMonthYYYYMM());
  const [summaryDate, setSummaryDate] = useState(todayManilaYMD());
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [periodLabel, setPeriodLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [search, setSearch] = useState('');

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const params = new URLSearchParams();
      if (branchId) params.set('branch_id', String(branchId));
      if (periodMode === 'monthly') {
        params.set('summary_month', summaryMonth || manilaMonthYYYYMM());
      } else {
        params.set('summary_date', summaryDate || todayManilaYMD());
      }
      const response = await apiRequest(
        `/dashboard/merchandise-released-details?${params.toString()}`
      );
      setRows(response.data?.rows ?? []);
      setSummary(response.data?.summary ?? null);
      setPeriodLabel(response.data?.period_label ?? '');
    } catch (err) {
      setError(err?.message || 'Failed to load merchandise release logs.');
      setRows([]);
      setSummary(null);
      setPeriodLabel('');
    } finally {
      setLoading(false);
    }
  }, [branchId, periodMode, summaryMonth, summaryDate]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const filteredRows = useMemo(() => {
    let list = rows;
    if (sourceFilter !== 'all') {
      list = list.filter((r) => r.source === sourceFilter);
    }
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) => {
      const hay = [
        r.merchandise_name,
        r.size,
        r.category,
        r.student_name,
        r.student_email,
        r.package_name,
        r.class_level_tag,
        r.branch_name,
        r.issued_by_name,
        referenceLabel(r),
        sourceLabel(r.source),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, sourceFilter, search]);

  const scopeSubtitle = [
    periodLabel ||
      (periodMode === 'monthly'
        ? `Month ${summaryMonth}`
        : formatDateManila(summaryDate)),
    branchName
      ? `Branch: ${branchName}`
      : branchId
        ? `Branch ID ${branchId}`
        : 'All branches',
  ].join(' · ');

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900">Merchandise Logs</h2>
            <p className="mt-1 text-sm text-gray-500">
              All released stocks from package first payment and Merchandise AR issue —
              deducted from inventory when stock was issued.
            </p>
            <p className="mt-1 text-xs text-gray-400">{scopeSubtitle}</p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
              {[
                { id: 'monthly', label: 'Month' },
                { id: 'daily', label: 'Day' },
              ].map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setPeriodMode(mode.id)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    periodMode === mode.id
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            {periodMode === 'monthly' ? (
              <label className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Month
                </span>
                <input
                  type="month"
                  value={summaryMonth}
                  max={manilaMonthYYYYMM()}
                  onChange={(e) => setSummaryMonth(e.target.value)}
                  className="min-w-0 border-0 bg-transparent p-0 text-sm font-medium text-gray-900 focus:outline-none focus:ring-0"
                />
              </label>
            ) : (
              <label className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Date
                </span>
                <input
                  type="date"
                  value={summaryDate}
                  max={todayManilaYMD()}
                  onChange={(e) => setSummaryDate(e.target.value)}
                  className="min-w-0 border-0 bg-transparent p-0 text-sm font-medium text-gray-900 focus:outline-none focus:ring-0"
                />
              </label>
            )}

            <button
              type="button"
              onClick={fetchLogs}
              className="rounded-lg bg-[#F7C844] px-4 py-2 text-sm font-semibold text-gray-900 transition-colors hover:bg-[#F5B82E]"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <div className="rounded-xl border border-amber-200/60 bg-amber-50/80 px-4 py-2.5 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-900/70">
              Total units
            </p>
            <p className="mt-0.5 text-lg font-bold tabular-nums text-gray-900">
              {formatNumber(summary?.total_quantity ?? 0)}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Release events
            </p>
            <p className="mt-0.5 text-lg font-bold tabular-nums text-gray-900">
              {formatNumber(summary?.release_event_count ?? 0)}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Merchandise AR
            </p>
            <p className="mt-0.5 text-lg font-bold tabular-nums text-gray-900">
              {formatNumber(summary?.merchandise_ar_quantity ?? 0)}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Package issue
            </p>
            <p className="mt-0.5 text-lg font-bold tabular-nums text-gray-900">
              {formatNumber(summary?.package_enroll_quantity ?? 0)}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex flex-wrap rounded-lg border border-gray-200 bg-gray-50 p-0.5">
            {[
              { id: 'all', label: 'All' },
              { id: 'package_enroll', label: 'Package' },
              { id: 'merchandise_ar', label: 'Merchandise AR' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSourceFilter(tab.id)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  sourceFilter === tab.id
                    ? 'bg-gray-900 text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search student, item, package…"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-[#F7C844] focus:outline-none focus:ring-1 focus:ring-[#F7C844] sm:max-w-xs"
          />
        </div>

        {error ? (
          <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {loading ? (
          <div className="flex h-52 items-center justify-center rounded-xl bg-gray-50/80">
            <div className="h-9 w-9 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
          </div>
        ) : filteredRows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-200 bg-gray-50/80 py-12 text-center text-sm text-gray-500">
            No merchandise releases for this period.
          </p>
        ) : (
          <>
            <p className="mb-3 text-xs text-gray-500">
              {formatNumber(filteredRows.length)} line(s) shown
              {search.trim() || sourceFilter !== 'all' ? ' (filtered)' : ''}.
            </p>

            {/* Mobile cards */}
            <div className="space-y-3 md:hidden">
              {filteredRows.map((row) => (
                <div
                  key={row.release_log_id}
                  className="rounded-xl border border-gray-100 bg-gray-50/80 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{itemLabel(row)}</p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {row.released_at_manila || row.released_date_manila || '—'}
                      </p>
                    </div>
                    <span className="flex-shrink-0 text-sm font-bold tabular-nums text-gray-900">
                      ×{formatNumber(row.quantity)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        row.source === 'merchandise_ar'
                          ? 'bg-violet-100 text-violet-800'
                          : 'bg-amber-100 text-amber-900'
                      }`}
                    >
                      {sourceLabel(row.source)}
                    </span>
                    {showBranchColumn && row.branch_name ? (
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] text-gray-600 ring-1 ring-gray-200">
                        {row.branch_name}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-xs text-gray-700">
                    {row.student_name || '—'}
                    {row.package_name ? ` · ${row.package_name}` : ''}
                  </p>
                  <p className="mt-0.5 text-[11px] text-gray-500">{referenceLabel(row)}</p>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden overflow-x-auto rounded-lg md:block" style={tableScrollStyle}>
              <table style={{ width: '100%', minWidth: '960px' }} className="border-collapse text-sm">
                <thead className="bg-gray-50 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-3 py-3">Released</th>
                    {showBranchColumn ? <th className="px-3 py-3">Branch</th> : null}
                    <th className="px-3 py-3">Source</th>
                    <th className="px-3 py-3">Item</th>
                    <th className="px-3 py-3 text-right">Qty</th>
                    <th className="px-3 py-3">Student</th>
                    <th className="px-3 py-3">Package / class</th>
                    <th className="px-3 py-3">Issued by</th>
                    <th className="px-3 py-3">Reference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-800">
                  {filteredRows.map((row) => (
                    <tr key={row.release_log_id} className="transition-colors hover:bg-amber-50/40">
                      <td className="whitespace-nowrap px-3 py-2.5 align-top text-xs tabular-nums text-gray-600">
                        {row.released_at_manila || row.released_date_manila || '—'}
                      </td>
                      {showBranchColumn ? (
                        <td className="px-3 py-2.5 align-top text-xs text-gray-700">
                          {row.branch_name || '—'}
                        </td>
                      ) : null}
                      <td className="px-3 py-2.5 align-top">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            row.source === 'merchandise_ar'
                              ? 'bg-violet-100 text-violet-800'
                              : 'bg-amber-100 text-amber-900'
                          }`}
                        >
                          {sourceLabel(row.source)}
                        </span>
                      </td>
                      <td className="max-w-[200px] px-3 py-2.5 align-top text-xs leading-snug">
                        <span className="line-clamp-2 break-words" title={itemLabel(row)}>
                          {itemLabel(row)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 align-top text-right font-semibold tabular-nums">
                        {formatNumber(row.quantity)}
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <p className="text-xs font-medium text-gray-900">
                          {row.student_name || '—'}
                        </p>
                        {row.student_email ? (
                          <p
                            className="mt-0.5 truncate text-[11px] text-gray-500"
                            title={row.student_email}
                          >
                            {row.student_email}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 align-top text-xs text-gray-600">
                        <p className="break-words">{row.package_name || '—'}</p>
                        {row.class_level_tag ? (
                          <p className="mt-0.5 text-[11px] text-gray-500">
                            Class: {row.class_level_tag}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 align-top text-xs text-gray-600">
                        {row.issued_by_name || '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 align-top text-xs font-medium text-gray-700">
                        {referenceLabel(row)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default MerchandiseReleaseLogsPanel;
