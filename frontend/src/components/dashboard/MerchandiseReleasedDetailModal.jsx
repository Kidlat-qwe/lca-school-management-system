import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';
import { formatDateManila } from '../../utils/dateUtils';

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
 * Drill-down: merchandise release log lines for daily/monthly operational dashboard.
 */
export default function MerchandiseReleasedDetailModal({
  open,
  onClose,
  periodMode = 'daily',
  summaryDate = '',
  summaryMonth = '',
  branchId = '',
  branchName = '',
  cardQuantity = 0,
  cardEvents = 0,
}) {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [periodLabel, setPeriodLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    setSourceFilter('all');

    const params = new URLSearchParams();
    if (branchId) params.set('branch_id', String(branchId));
    if (periodMode === 'monthly' && summaryMonth) {
      params.set('summary_month', summaryMonth);
    } else if (summaryDate) {
      params.set('summary_date', summaryDate);
    }

    apiRequest(`/dashboard/merchandise-released-details?${params.toString()}`)
      .then((res) => {
        if (cancelled) return;
        setRows(res.data?.rows ?? []);
        setSummary(res.data?.summary ?? null);
        setPeriodLabel(res.data?.period_label ?? '');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || 'Failed to load merchandise release details.');
        setRows([]);
        setSummary(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, periodMode, summaryDate, summaryMonth, branchId]);

  const filteredRows = useMemo(() => {
    if (sourceFilter === 'all') return rows;
    return rows.filter((r) => r.source === sourceFilter);
  }, [rows, sourceFilter]);

  const periodTitle =
    periodMode === 'monthly'
      ? summaryMonth
        ? `Month ${summaryMonth}`
        : 'Selected month'
      : summaryDate
        ? formatDateManila(summaryDate)
        : 'Selected date';

  const scopeSubtitle = [
    periodLabel ? `Period: ${periodLabel}` : periodTitle,
    branchName ? `Branch: ${branchName}` : branchId ? `Branch ID ${branchId}` : 'All branches',
  ].join(' · ');

  const totalQty = summary?.total_quantity ?? cardQuantity;
  const eventCount = summary?.release_event_count ?? cardEvents;

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/50 backdrop-blur-[1px]"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="merch-released-detail-title"
        className="relative z-[201] flex max-h-[min(92vh,880px)] w-full max-w-[min(96vw,1280px)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-200 bg-gradient-to-r from-amber-50/80 to-white px-5 py-4 sm:px-7">
          <div className="min-w-0 flex-1">
            <h2 id="merch-released-detail-title" className="text-xl font-semibold tracking-tight text-gray-900">
              Merchandise Released
            </h2>
            <p className="mt-1 text-sm text-gray-500">{scopeSubtitle}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <div className="rounded-xl border border-amber-200/60 bg-amber-50/80 px-4 py-2.5 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-900/70">Total units</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-gray-900">{formatNumber(totalQty)}</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Release events</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-gray-900">{formatNumber(eventCount)}</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Merchandise AR</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-gray-900">
                  {formatNumber(summary?.merchandise_ar_quantity ?? 0)}
                </p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Package issue</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-gray-900">
                  {formatNumber(summary?.package_enroll_quantity ?? 0)}
                </p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-200/60 hover:text-gray-800"
            aria-label="Close dialog"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-100 bg-gray-50/50 px-5 py-3 sm:px-7">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 shadow-sm">
            {[
              { id: 'all', label: 'All' },
              { id: 'package_enroll', label: 'Package' },
              { id: 'merchandise_ar', label: 'Merchandise AR' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSourceFilter(tab.id)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors sm:px-4 ${
                  sourceFilter === tab.id ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500 sm:ml-auto">
            {formatNumber(filteredRows.length)} line(s) · Top + bottom uniform = 2 units when both issued
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden px-5 py-4 sm:px-7 sm:py-5">
          {error ? (
            <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
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
            <div
              className="max-h-[min(58vh,520px)] overflow-x-auto overflow-y-auto rounded-xl border border-gray-200 bg-white"
              style={tableScrollStyle}
            >
              <table style={{ width: '100%', minWidth: '960px' }}>
                <thead className="sticky top-0 z-[1] border-b border-gray-200 bg-gray-50 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-3 py-3">Released</th>
                    <th className="px-3 py-3">Branch</th>
                    <th className="px-3 py-3">Source</th>
                    <th className="px-3 py-3">Item</th>
                    <th className="px-3 py-3 text-right">Qty</th>
                    <th className="px-3 py-3">Student</th>
                    <th className="px-3 py-3">Package / class</th>
                    <th className="px-3 py-3">Reference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-sm text-gray-800">
                  {filteredRows.map((row) => (
                    <tr key={row.release_log_id} className="transition-colors hover:bg-amber-50/40">
                      <td className="whitespace-nowrap px-3 py-2.5 align-top text-xs tabular-nums text-gray-600">
                        {row.released_at_manila || row.released_date_manila || '—'}
                      </td>
                      <td className="px-3 py-2.5 align-top text-xs text-gray-700">{row.branch_name || '—'}</td>
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
                      <td className="max-w-[200px] px-3 py-2.5 align-top text-xs leading-snug text-gray-800">
                        <span className="line-clamp-2 break-words" title={itemLabel(row)}>
                          {itemLabel(row)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 align-top text-right font-semibold tabular-nums">
                        {formatNumber(row.quantity)}
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <p className="text-xs font-medium text-gray-900">{row.student_name || '—'}</p>
                        {row.student_email ? (
                          <p className="mt-0.5 truncate text-[11px] text-gray-500" title={row.student_email}>
                            {row.student_email}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 align-top text-xs text-gray-600">
                        <p className="break-words">{row.package_name || '—'}</p>
                        {row.class_level_tag ? (
                          <p className="mt-0.5 text-[11px] text-gray-500">Class: {row.class_level_tag}</p>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 align-top text-xs font-medium text-gray-700">
                        {referenceLabel(row)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-end border-t border-gray-200 bg-gray-50/80 px-5 py-3 sm:px-7">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-gray-900 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
