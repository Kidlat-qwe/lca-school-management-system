import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';
import { formatDateManila, formatDateTimeManila } from '../../utils/dateUtils';
import FixedTablePagination from '../../components/table/FixedTablePagination';
import { appAlert } from '../../utils/appAlert';
import { BranchPaymentLogTabs } from '../../components/paymentLogs/PaymentLogsViewTabs';
import { uploadInvoicePaymentImage } from '../../utils/uploadInvoicePaymentImage';

const TAB_EOD = 'eod';
const TAB_CASH = 'cash';
const VIEW_MAIN = 'main';
const VIEW_RETURN = 'return';

const isReturnedSummaryStatus = (status) => status === 'Returned' || status === 'Rejected';

const statusBadge = (status) => {
  const s = String(status || '');
  if (s === 'Approved') return 'bg-emerald-100 text-emerald-800';
  if (s === 'Submitted') return 'bg-amber-100 text-amber-800';
  if (isReturnedSummaryStatus(s)) return 'bg-red-100 text-red-800';
  return 'bg-gray-100 text-gray-700';
};

const AdminDailySummary = () => {
  const location = useLocation();
  const { userInfo } = useAuth();
  const branchId = userInfo?.branch_id || userInfo?.branchId;
  const branchName = userInfo?.branch_nickname || userInfo?.branch_name || 'Your branch';

  const [summaryKind, setSummaryKind] = useState(TAB_EOD);
  const [viewTab, setViewTab] = useState(VIEW_MAIN);

  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });

  const [returnBadgeCount, setReturnBadgeCount] = useState(0);

  const [eodResubmit, setEodResubmit] = useState({ open: false, record: null });
  /** GET /daily-summary-sales/:id/payments — payments + AR + totals for this summary date only */
  const [eodResubmitDetail, setEodResubmitDetail] = useState(null);
  const [eodResubmitRecalcLoading, setEodResubmitRecalcLoading] = useState(false);
  const [eodResubmitLoading, setEodResubmitLoading] = useState(false);

  const [cashResubmit, setCashResubmit] = useState({ open: false, record: null });
  const [cashDetail, setCashDetail] = useState(null);
  const [cashDetailLoading, setCashDetailLoading] = useState(false);
  const [cashRef, setCashRef] = useState('');
  const [cashAttach, setCashAttach] = useState('');
  const [cashUploading, setCashUploading] = useState(false);
  const [cashResubmitLoading, setCashResubmitLoading] = useState(false);

  const isCash = summaryKind === TAB_CASH;

  /** Same as superadmin Daily Summary list: prefer live EOD totals from GET (payments + AR for date). */
  const endOfShiftListAmount = (record) => {
    if (record?.live_grand_total != null && Number.isFinite(Number(record.live_grand_total))) {
      return Number(record.live_grand_total);
    }
    return Number(record?.total_amount ?? 0);
  };

  const endOfShiftListPaymentCount = (record) => {
    if (record?.live_grand_count != null && Number.isFinite(Number(record.live_grand_count))) {
      return Number(record.live_grand_count);
    }
    return Number(record?.payment_count ?? 0);
  };

  /**
   * One count per returned row. Backend maps ?status=Returned to IN ('Returned','Rejected'), so do not add a second
   * Rejected-only request (that double-counted legacy rows). Count only the active tab (EOD vs cash deposit).
   */
  const fetchReturnBadge = useCallback(async () => {
    if (!branchId) return;
    try {
      if (summaryKind === TAB_EOD) {
        const res = await apiRequest('/daily-summary-sales?status=Returned&limit=1&page=1');
        setReturnBadgeCount(Number(res.pagination?.total ?? 0));
      } else {
        const res = await apiRequest('/cash-deposit-summaries?status=Returned&limit=1&page=1');
        setReturnBadgeCount(Number(res.pagination?.total ?? 0));
      }
    } catch {
      setReturnBadgeCount(0);
    }
  }, [branchId, summaryKind]);

  const fetchRecords = useCallback(
    async (page = 1) => {
      if (!branchId) {
        setError('Branch is not assigned to your account.');
        setRecords([]);
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const params = new URLSearchParams({ page: String(page), limit: '10' });
        if (viewTab === VIEW_RETURN) {
          params.set('status', 'Returned');
        } else if (filterStatus) {
          params.set('status', filterStatus);
        }
        if (filterDate) {
          if (isCash) params.set('date', filterDate);
          else params.set('summary_date', filterDate);
        }
        const endpoint = isCash ? '/cash-deposit-summaries' : '/daily-summary-sales';
        const res = await apiRequest(`${endpoint}?${params.toString()}`);
        setRecords(res.data || []);
        if (res.pagination) {
          setPagination({
            page: res.pagination.page,
            limit: res.pagination.limit,
            total: res.pagination.total,
            totalPages: res.pagination.totalPages || 1,
          });
        }
        setError('');
      } catch (err) {
        setError(err.message || 'Failed to load records');
        setRecords([]);
      } finally {
        setLoading(false);
      }
    },
    [branchId, isCash, viewTab, filterStatus, filterDate]
  );

  useEffect(() => {
    fetchReturnBadge();
  }, [fetchReturnBadge]);

  useEffect(() => {
    setPagination((p) => ({ ...p, page: 1 }));
    setFilterStatus('');
    setFilterDate('');
  }, [summaryKind, viewTab]);

  useEffect(() => {
    fetchRecords(1);
  }, [fetchRecords, summaryKind, viewTab, filterStatus, filterDate]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('notificationTab') === 'return') {
      setViewTab(VIEW_RETURN);
    }
  }, [location.search]);

  const formatMoney = (n) =>
    `₱${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const loadEodResubmitPayments = async (dailySummaryId) => {
    const res = await apiRequest(`/daily-summary-sales/${dailySummaryId}/payments`);
    setEodResubmitDetail(res.data || null);
  };

  const openEodResubmit = (record) => {
    setEodResubmit({ open: true, record });
    setEodResubmitDetail(null);
  };

  const recalculateEodResubmitDetail = async () => {
    const id = eodResubmit.record?.daily_summary_id;
    if (!id) return;
    setEodResubmitRecalcLoading(true);
    try {
      await loadEodResubmitPayments(id);
    } catch (err) {
      appAlert(err.message || 'Failed to recalculate');
    } finally {
      setEodResubmitRecalcLoading(false);
    }
  };

  const submitEodResubmit = async () => {
    const id = eodResubmit.record?.daily_summary_id;
    if (!id) return;
    if (!eodResubmitDetail?.totals) {
      appAlert('Click Re-calculate first to preview updated totals and line items, then confirm resubmit.');
      return;
    }
    setEodResubmitLoading(true);
    try {
      await apiRequest(`/daily-summary-sales/${id}/resubmit`, { method: 'PUT' });
      appAlert('End of day resubmitted for verification.');
      setEodResubmit({ open: false, record: null });
      setEodResubmitDetail(null);
      await fetchRecords(pagination.page);
      await fetchReturnBadge();
    } catch (err) {
      appAlert(err.message || 'Resubmit failed');
    } finally {
      setEodResubmitLoading(false);
    }
  };

  const openCashResubmit = async (record) => {
    setCashResubmit({ open: true, record });
    setCashRef(String(record.reference_number || '').trim());
    setCashAttach(String(record.deposit_attachment_url || '').trim());
    setCashDetail(null);
    setCashDetailLoading(true);
    try {
      const res = await apiRequest(`/cash-deposit-summaries/${record.cash_deposit_summary_id}/payments`);
      const d = res?.data;
      if (d && typeof d === 'object' && !Array.isArray(d)) {
        setCashDetail(d);
      } else {
        setCashDetail({ totals: null, payments: Array.isArray(res?.data) ? res.data : [] });
      }
    } catch (err) {
      appAlert(err.message || 'Failed to load deposit detail');
    } finally {
      setCashDetailLoading(false);
    }
  };

  const submitCashResubmit = async () => {
    const id = cashResubmit.record?.cash_deposit_summary_id;
    if (!id) return;
    const refTrim = String(cashRef || '').trim();
    const attTrim = String(cashAttach || '').trim();
    if (!refTrim) {
      appAlert('Reference number is required.');
      return;
    }
    if (!attTrim) {
      appAlert('Please upload or keep a deposit proof attachment.');
      return;
    }
    setCashResubmitLoading(true);
    try {
      await apiRequest(`/cash-deposit-summaries/${id}/resubmit`, {
        method: 'PUT',
        body: JSON.stringify({
          reference_number: refTrim,
          deposit_attachment_url: attTrim,
        }),
      });
      appAlert('Cash deposit summary resubmitted for verification.');
      setCashResubmit({ open: false, record: null });
      setCashDetail(null);
      await fetchRecords(pagination.page);
      await fetchReturnBadge();
    } catch (err) {
      appAlert(err.message || 'Resubmit failed');
    } finally {
      setCashResubmitLoading(false);
    }
  };

  const cashTotals = cashDetail?.totals;
  const tableScrollStyle = { scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' };

  const statusOptions = useMemo(
    () => [
      { value: '', label: 'All statuses' },
      { value: 'Submitted', label: 'Submitted' },
      { value: 'Approved', label: 'Approved' },
      { value: 'Returned', label: 'Returned' },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Daily summary</h1>
        <p className="mt-1 text-sm text-gray-600">
          Submission history and returned items for <span className="font-semibold text-gray-800">{branchName}</span>.
        </p>
      </div>

      <div className="border-b border-gray-200">
        <nav className="flex flex-wrap gap-4" aria-label="Summary type">
          <button
            type="button"
            onClick={() => setSummaryKind(TAB_EOD)}
            className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
              summaryKind === TAB_EOD
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            End of day (EOD)
          </button>
          <button
            type="button"
            onClick={() => setSummaryKind(TAB_CASH)}
            className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
              summaryKind === TAB_CASH
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Cash deposit (EOS)
          </button>
        </nav>
      </div>

      <BranchPaymentLogTabs
        value={viewTab}
        onChange={setViewTab}
        mainLabel="Submission history"
        returnLabel="Return"
        ariaLabel="Daily summary views"
        returnBadgeCount={returnBadgeCount}
      />

      {viewTab === VIEW_MAIN && (
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="input-field text-sm min-w-[160px]"
            >
              {statusOptions.map((o) => (
                <option key={o.value || 'all'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              {isCash ? 'Date in period' : 'Summary date'}
            </label>
            <input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="input-field text-sm"
            />
          </div>
          {(filterStatus || filterDate) && (
            <button
              type="button"
              className="text-sm text-primary-600 hover:underline"
              onClick={() => {
                setFilterStatus('');
                setFilterDate('');
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {viewTab === VIEW_RETURN && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Finance returned these submissions. Review notes, update proof if needed (cash deposit), then resubmit for
          verification.
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
        </div>
      ) : !isCash ? (
        <div className="overflow-x-auto rounded-lg" style={tableScrollStyle}>
          <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '920px' }}>
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-gray-600">Summary date</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-gray-600">Total</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-gray-600">Count</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-gray-600">Status</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-gray-600">Submitted</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-gray-600">Finance notes</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {records.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-sm text-gray-500">
                    No end of day records found.
                  </td>
                </tr>
              ) : (
                records.map((row) => (
                  <tr key={row.daily_summary_id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-sm text-gray-900 whitespace-nowrap">
                      {row.summary_date ? formatDateManila(row.summary_date) : '-'}
                    </td>
                    <td className="px-3 py-2 text-sm text-right font-medium text-gray-900 whitespace-nowrap">
                      {formatMoney(endOfShiftListAmount(row))}
                    </td>
                    <td className="px-3 py-2 text-sm text-right text-gray-700">{endOfShiftListPaymentCount(row)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(row.status)}`}>
                        {isReturnedSummaryStatus(row.status) ? 'Returned' : row.status || '-'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">
                      {row.submitted_at ? formatDateTimeManila(row.submitted_at) : '-'}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700 max-w-[220px] truncate" title={row.remarks || ''}>
                      {row.remarks || '—'}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {viewTab === VIEW_RETURN && isReturnedSummaryStatus(row.status) ? (
                        <button
                          type="button"
                          onClick={() => openEodResubmit(row)}
                          className="text-sm font-medium text-primary-600 hover:text-primary-800"
                        >
                          Review &amp; resubmit
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg" style={tableScrollStyle}>
          <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '1040px' }}>
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-gray-600">Period</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-gray-600">Deposit total</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-gray-600">Cash (range)</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-gray-600">Reference</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-gray-600">Status</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-gray-600">Submitted</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-gray-600">Finance notes</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {records.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-sm text-gray-500">
                    No cash deposit records found.
                  </td>
                </tr>
              ) : (
                records.map((row) => (
                  <tr key={row.cash_deposit_summary_id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-sm text-gray-900 whitespace-nowrap">
                      {row.start_date && row.end_date
                        ? `${formatDateManila(row.start_date)} – ${formatDateManila(row.end_date)}`
                        : '-'}
                    </td>
                    <td className="px-3 py-2 text-sm text-right font-medium text-gray-900 whitespace-nowrap">
                      {formatMoney(row.total_deposit_amount)}
                    </td>
                    <td className="px-3 py-2 text-sm text-right text-gray-700 whitespace-nowrap">
                      {formatMoney(row.total_cash_amount)}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700 max-w-[140px] truncate" title={row.reference_number}>
                      {row.reference_number || '—'}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(row.status)}`}>
                        {isReturnedSummaryStatus(row.status) ? 'Returned' : row.status || '-'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">
                      {row.submitted_at ? formatDateTimeManila(row.submitted_at) : '-'}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700 max-w-[200px] truncate" title={row.remarks || ''}>
                      {row.remarks || '—'}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {viewTab === VIEW_RETURN && isReturnedSummaryStatus(row.status) ? (
                        <button
                          type="button"
                          onClick={() => openCashResubmit(row)}
                          className="text-sm font-medium text-primary-600 hover:text-primary-800"
                        >
                          Review &amp; resubmit
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {!loading && records.length > 0 && (
        <FixedTablePagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          totalItems={pagination.total}
          itemsPerPage={pagination.limit}
          itemLabel={isCash ? 'deposits' : 'summaries'}
          onPageChange={(p) => fetchRecords(p)}
        />
      )}

      {eodResubmit.open &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4"
            onClick={() => {
              if (eodResubmitLoading || eodResubmitRecalcLoading) return;
              setEodResubmit({ open: false, record: null });
              setEodResubmitDetail(null);
            }}
          >
            <div
              className="flex max-h-[min(90vh,calc(100dvh-2rem))] w-full max-w-[min(56rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg bg-white shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="shrink-0 border-b border-gray-200 px-5 py-4">
                <h3 className="text-lg font-semibold text-gray-900">Review &amp; resubmit — end of day</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Summary date:{' '}
                  <span className="font-medium text-gray-800">
                    {eodResubmit.record?.summary_date ? formatDateManila(eodResubmit.record.summary_date) : '—'}
                  </span>
                </p>
                <p className="mt-2 text-xs text-gray-600">
                  Only completed payments and standalone AR with{' '}
                  <strong>issue date</strong> equal to this summary date are included. Future or other dates are not part of
                  this resubmit.
                </p>
              </div>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
                {eodResubmit.record?.remarks ? (
                  <div>
                    <p className="text-xs font-semibold text-gray-600">Finance notes</p>
                    <p className="mt-1 rounded-md bg-gray-50 p-3 text-sm text-gray-800 whitespace-pre-wrap">
                      {eodResubmit.record.remarks}
                    </p>
                  </div>
                ) : null}

                <div className="rounded-md border border-dashed border-gray-300 bg-gray-50/80 p-3 text-sm text-gray-800">
                  <p className="font-medium text-gray-900">Stored summary (current row)</p>
                  <p className="mt-1">
                    Total: {formatMoney(eodResubmit.record?.total_amount)} · Records: {eodResubmit.record?.payment_count ?? '—'}
                  </p>
                  <p className="mt-2 text-xs text-gray-600">
                    Click <strong>Re-calculate</strong> to load current payment and AR lines for this date. Totals and tables appear only
                    after that step.
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-gray-800">Preview after re-calculate</p>
                  <button
                    type="button"
                    onClick={recalculateEodResubmitDetail}
                    disabled={eodResubmitRecalcLoading}
                    className="rounded-lg border border-primary-600 bg-white px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-primary-50 disabled:opacity-50"
                  >
                    {eodResubmitRecalcLoading ? 'Recalculating…' : 'Re-calculate'}
                  </button>
                </div>

                {eodResubmitRecalcLoading ? (
                  <p className="text-sm text-gray-500">Loading current transactions…</p>
                ) : null}

                {!eodResubmitRecalcLoading && eodResubmitDetail?.totals ? (
                  <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800">
                    <p className="font-medium text-gray-900">Recalculated totals (this date, this branch)</p>
                    <p className="mt-1">
                      <span className="font-semibold">Grand total:</span> {formatMoney(eodResubmitDetail.totals.grand_total)} ·{' '}
                      <span className="font-semibold">Records:</span> {eodResubmitDetail.totals.grand_count ?? 0}
                    </p>
                    <p className="mt-1 text-xs text-gray-600">
                      Payments: {formatMoney(eodResubmitDetail.totals.completed_total)} ({eodResubmitDetail.totals.completed_count ?? 0}{' '}
                      row(s)) · AR: {formatMoney(eodResubmitDetail.totals.ar_total)} ({eodResubmitDetail.totals.ar_count ?? 0}{' '}
                      receipt(s))
                    </p>
                    {eodResubmitDetail.submitted_snapshot ? (
                      <p className="mt-2 text-xs text-amber-800">
                        Previously stored in row: {formatMoney(eodResubmitDetail.submitted_snapshot.total_amount)} ·{' '}
                        {eodResubmitDetail.submitted_snapshot.payment_count ?? 0} record(s). Confirm resubmit saves the recalculated
                        figures above.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {eodResubmitDetail?.totals && eodResubmitDetail?.payments?.length > 0 ? (
                  <div>
                    <p className="text-xs font-semibold text-gray-700 mb-2">Completed payments (issue date = summary date)</p>
                    <div
                      className="overflow-x-auto rounded-lg"
                      style={{
                        scrollbarWidth: 'thin',
                        scrollbarColor: '#cbd5e0 #f7fafc',
                        WebkitOverflowScrolling: 'touch',
                      }}
                    >
                      <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '640px' }}>
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">Student / payer</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">Invoice</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">Method</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">Amount</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">Ref.</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                          {eodResubmitDetail.payments.map((p) => (
                            <tr key={p.payment_id}>
                              <td className="px-3 py-2 text-sm text-gray-900">{p.student_name || '—'}</td>
                              <td className="px-3 py-2 text-sm text-gray-700">
                                {p.invoice_description || (p.invoice_id ? `INV-${p.invoice_id}` : '—')}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-600">{p.payment_method || '—'}</td>
                              <td className="px-3 py-2 text-right text-sm font-medium text-gray-900">
                                {formatMoney((Number(p.payable_amount) || 0) + (Number(p.tip_amount) || 0))}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-500">{p.reference_number || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                {eodResubmitDetail?.totals && eodResubmitDetail?.ar_receipts?.length > 0 ? (
                  <div>
                    <p className="text-xs font-semibold text-gray-700 mb-2">Standalone AR (same date)</p>
                    <div
                      className="overflow-x-auto rounded-lg"
                      style={{
                        scrollbarWidth: 'thin',
                        scrollbarColor: '#cbd5e0 #f7fafc',
                        WebkitOverflowScrolling: 'touch',
                      }}
                    >
                      <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '600px' }}>
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">Receipt</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">Prospect</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">Method</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">Amount</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">Ref.</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                          {eodResubmitDetail.ar_receipts.map((a) => (
                            <tr key={a.ack_receipt_id}>
                              <td className="px-3 py-2 text-sm text-gray-800">{a.ack_receipt_number || a.ack_receipt_id}</td>
                              <td className="px-3 py-2 text-sm text-gray-700">{a.prospect_student_name || '—'}</td>
                              <td className="px-3 py-2 text-sm text-gray-600">{a.payment_method || '—'}</td>
                              <td className="px-3 py-2 text-right text-sm font-medium text-gray-900">
                                {formatMoney((Number(a.payment_amount) || 0) + (Number(a.tip_amount) || 0))}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-500">{a.reference_number || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                {eodResubmitDetail?.totals &&
                !eodResubmitDetail.payments?.length &&
                !eodResubmitDetail.ar_receipts?.length ? (
                  <p className="text-sm text-gray-600">No payment rows for this date after filters. You may still resubmit to refresh totals.</p>
                ) : null}
              </div>
              <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 px-5 py-4">
                <button
                  type="button"
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  disabled={eodResubmitLoading || eodResubmitRecalcLoading}
                  onClick={() => {
                    setEodResubmit({ open: false, record: null });
                    setEodResubmitDetail(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
                  disabled={
                    eodResubmitLoading ||
                    eodResubmitRecalcLoading ||
                    !eodResubmitDetail?.totals
                  }
                  onClick={submitEodResubmit}
                  title={
                    !eodResubmitDetail?.totals ? 'Run Re-calculate first to preview updates' : undefined
                  }
                >
                  {eodResubmitLoading ? 'Submitting…' : 'Confirm resubmit'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {cashResubmit.open &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4"
            onClick={() => !cashResubmitLoading && setCashResubmit({ open: false, record: null })}
          >
            <div
              className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg bg-white shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-b border-gray-200 px-5 py-4">
                <h3 className="text-lg font-semibold text-gray-900">Resubmit cash deposit</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Period:{' '}
                  <span className="font-medium text-gray-800">
                    {cashResubmit.record?.start_date && cashResubmit.record?.end_date
                      ? `${formatDateManila(cashResubmit.record.start_date)} – ${formatDateManila(
                          cashResubmit.record.end_date
                        )}`
                      : '—'}
                  </span>
                </p>
              </div>
              <div className="space-y-4 px-5 py-4">
                {cashResubmit.record?.remarks ? (
                  <div>
                    <p className="text-xs font-semibold text-gray-600">Finance notes</p>
                    <p className="mt-1 rounded-md bg-gray-50 p-3 text-sm text-gray-800 whitespace-pre-wrap">
                      {cashResubmit.record.remarks}
                    </p>
                  </div>
                ) : null}

                <div>
                  <label className="label-field text-xs">Reference number</label>
                  <input
                    type="text"
                    value={cashRef}
                    onChange={(e) => setCashRef(e.target.value)}
                    className="input-field text-sm w-full"
                    disabled={cashResubmitLoading}
                  />
                </div>
                <div>
                  <label className="label-field text-xs">Deposit proof (image)</label>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    disabled={cashResubmitLoading || cashUploading}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setCashUploading(true);
                      try {
                        const url = await uploadInvoicePaymentImage(file);
                        if (url) setCashAttach(url);
                      } catch (err) {
                        appAlert(err?.message || 'Upload failed');
                      } finally {
                        setCashUploading(false);
                      }
                    }}
                    className="block w-full text-sm text-gray-600"
                  />
                  {cashAttach ? (
                    <p className="mt-2 text-xs text-gray-600 break-all">Attached: {cashAttach}</p>
                  ) : null}
                </div>

                {cashDetailLoading ? (
                  <p className="text-sm text-gray-500">Loading current totals…</p>
                ) : cashTotals ? (
                  <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
                    <p className="font-semibold text-gray-800">Current snapshot</p>
                    <ul className="mt-2 space-y-1 text-gray-700">
                      <li>Deposit total: {formatMoney(cashTotals.total_deposit_amount)}</li>
                      <li>Cash in range: {formatMoney(cashTotals.total_cash_amount)}</li>
                    </ul>
                  </div>
                ) : null}
              </div>
              <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
                <button
                  type="button"
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  disabled={cashResubmitLoading}
                  onClick={() => setCashResubmit({ open: false, record: null })}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
                  disabled={cashResubmitLoading || cashUploading}
                  onClick={submitCashResubmit}
                >
                  {cashResubmitLoading ? 'Submitting…' : 'Confirm resubmit'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default AdminDailySummary;
