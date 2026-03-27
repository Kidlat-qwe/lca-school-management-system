import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';
import { useGlobalBranchFilter } from '../../contexts/GlobalBranchFilterContext';
import { formatDateManila } from '../../utils/dateUtils';
import FixedTablePagination from '../../components/table/FixedTablePagination';

const TAB_END_OF_SHIFT = 'endOfShift';
const TAB_CASH_DEPOSIT = 'cashDeposit';

const DailySummarySalesApprovalPage = () => {
  const { selectedBranchId: globalBranchId } = useGlobalBranchFilter();
  const [activeTab, setActiveTab] = useState(TAB_END_OF_SHIFT);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [approvingId, setApprovingId] = useState(null);
  const [rejectModal, setRejectModal] = useState({ open: false, id: null, remarks: '' });
  const [detailModal, setDetailModal] = useState({ open: false, record: null });
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [verifyModal, setVerifyModal] = useState({ open: false, record: null });
  const [verifyData, setVerifyData] = useState(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });

  const isCashDepositTab = activeTab === TAB_CASH_DEPOSIT;
  const recordIdField = isCashDepositTab ? 'cash_deposit_summary_id' : 'daily_summary_id';
  const itemLabel = isCashDepositTab ? 'cash deposit summaries' : 'summaries';
  const effectiveBranchFilter = globalBranchId || '';

  const formatCurrency = (amount) =>
    `₱${(Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const formatPeriod = (record) => {
    if (!record) return '-';
    if (isCashDepositTab) {
      return `${formatDateManila(record.start_date)} - ${formatDateManila(record.end_date)}`;
    }
    return formatDateManila(record.summary_date);
  };

  const fetchRecordDetails = useCallback(async (id) => {
    if (!id) return null;
    if (isCashDepositTab) {
      const res = await apiRequest(`/cash-deposit-summaries/${id}/payments`);
      return res?.data || null;
    }
    const res = await apiRequest(`/daily-summary-sales/${id}/payments`);
    return {
      payments: Array.isArray(res?.data) ? res.data : [],
    };
  }, [isCashDepositTab]);

  const fetchRecords = useCallback(async (page = 1) => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ page: String(page), limit: '10' });
      if (effectiveBranchFilter) params.set('branch_id', effectiveBranchFilter);
      if (filterStatus) params.set('status', filterStatus);
      if (filterDate) params.set(isCashDepositTab ? 'date' : 'summary_date', filterDate);

      const endpoint = isCashDepositTab ? '/cash-deposit-summaries' : '/daily-summary-sales';
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
      setError(
        err.message || (isCashDepositTab ? 'Failed to load cash deposit summaries' : 'Failed to load daily summaries')
      );
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [effectiveBranchFilter, filterStatus, filterDate, isCashDepositTab]);

  useEffect(() => {
    setOpenMenuId(null);
    setDetailModal({ open: false, record: null });
    setVerifyModal({ open: false, record: null });
    setRejectModal({ open: false, id: null, remarks: '' });
    setDetailData(null);
    setVerifyData(null);
    fetchRecords(1);
  }, [activeTab, filterStatus, filterDate, globalBranchId, fetchRecords]);

  useEffect(() => {
    if (!detailModal.open || !detailModal.record?.[recordIdField]) {
      setDetailData(null);
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    fetchRecordDetails(detailModal.record[recordIdField])
      .then((data) => {
        if (!cancelled) setDetailData(data);
      })
      .catch(() => {
        if (!cancelled) setDetailData(null);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [detailModal.open, detailModal.record, recordIdField, fetchRecordDetails, activeTab]);

  useEffect(() => {
    if (!verifyModal.open || !verifyModal.record?.[recordIdField]) {
      setVerifyData(null);
      return;
    }

    let cancelled = false;
    setVerifyLoading(true);
    fetchRecordDetails(verifyModal.record[recordIdField])
      .then((data) => {
        if (!cancelled) setVerifyData(data);
      })
      .catch(() => {
        if (!cancelled) setVerifyData(null);
      })
      .finally(() => {
        if (!cancelled) setVerifyLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [verifyModal.open, verifyModal.record, recordIdField, fetchRecordDetails, activeTab]);

  const handleVerify = async (id) => {
    setApprovingId(id);
    try {
      const endpoint = isCashDepositTab ? `/cash-deposit-summaries/${id}/approve` : `/daily-summary-sales/${id}/approve`;
      await apiRequest(endpoint, {
        method: 'PUT',
        body: JSON.stringify({ approve: true }),
      });
      await fetchRecords(pagination.page);
    } catch (err) {
      alert(err.response?.data?.message || err.message || 'Failed to verify');
    } finally {
      setApprovingId(null);
    }
  };

  const handleFlag = async () => {
    const { id, remarks } = rejectModal;
    if (!id) return;
    setApprovingId(id);
    try {
      const endpoint = isCashDepositTab ? `/cash-deposit-summaries/${id}/approve` : `/daily-summary-sales/${id}/approve`;
      await apiRequest(endpoint, {
        method: 'PUT',
        body: JSON.stringify({ approve: false, remarks: remarks.trim() || undefined }),
      });
      setRejectModal({ open: false, id: null, remarks: '' });
      await fetchRecords(pagination.page);
    } catch (err) {
      alert(err.response?.data?.message || err.message || 'Failed to flag');
    } finally {
      setApprovingId(null);
    }
  };

  const statusBadge = (status) => {
    const classes = {
      Submitted: 'bg-yellow-100 text-yellow-800',
      Approved: 'bg-green-100 text-green-800',
      Rejected: 'bg-amber-100 text-amber-800',
    };
    const label = status === 'Approved' ? 'Verified' : status === 'Rejected' ? 'Flagged' : status;
    return (
      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${classes[status] || 'bg-gray-100 text-gray-800'}`}>
        {label}
      </span>
    );
  };

  const openMenuForRecord = (event, id) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const top = rect.bottom + 4;
    const right = viewportWidth - rect.right;
    setMenuPosition({ top, right });
    setOpenMenuId((prev) => (prev === id ? null : id));
  };

  const selectedRecord = records.find((record) => record[recordIdField] === openMenuId) || null;
  const detailPayments = detailData?.payments || [];
  const verifyPayments = verifyData?.payments || [];
  const detailMetrics = isCashDepositTab
    ? [
        { label: 'Period', value: formatPeriod(detailModal.record) },
        { label: 'Cash to Deposit', value: formatCurrency(detailModal.record?.total_deposit_amount) },
        { label: 'All Cash in Range', value: formatCurrency(detailModal.record?.total_cash_amount) },
        { label: 'Completed Cash Rows', value: detailModal.record?.completed_cash_count ?? 0 },
        { label: 'Cash Rows', value: detailModal.record?.payment_count ?? 0 },
      ]
    : [
        { label: 'Date', value: formatPeriod(detailModal.record) },
        { label: 'Total Amount', value: formatCurrency(detailModal.record?.total_amount) },
        { label: 'Payments Count', value: detailModal.record?.payment_count ?? 0 },
      ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Daily Summary Sales</h1>
        <p className="mt-1 text-sm text-gray-600">
          Verify branch submissions for both end-of-shift closing and cash deposit confirmation.
        </p>
      </div>

      <div className="border-b border-gray-200">
        <nav className="flex flex-wrap gap-4" aria-label="Summary type tabs">
          <button
            type="button"
            onClick={() => setActiveTab(TAB_END_OF_SHIFT)}
            className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === TAB_END_OF_SHIFT
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            End of Shift
          </button>
          <button
            type="button"
            onClick={() => setActiveTab(TAB_CASH_DEPOSIT)}
            className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === TAB_CASH_DEPOSIT
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Cash Deposit Summary
          </button>
        </nav>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="flex flex-wrap gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="input-field text-sm py-2 min-w-[140px]"
          >
            <option value="">All</option>
            <option value="Submitted">Submitted</option>
            <option value="Approved">Verified</option>
            <option value="Rejected">Flagged</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            {isCashDepositTab ? 'Date in Period' : 'Date'}
          </label>
          <input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="input-field text-sm py-2"
          />
        </div>
      </div>

      <div
        className="overflow-x-auto rounded-lg"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}
      >
        <table className="min-w-full divide-y divide-gray-200" style={{ width: '100%', minWidth: isCashDepositTab ? '980px' : '800px' }}>
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">Branch</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">
                {isCashDepositTab ? 'Period' : 'Date'}
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">
                {isCashDepositTab ? 'Cash to Deposit' : 'Amount'}
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">
                {isCashDepositTab ? 'Completed Cash' : 'Payments'}
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">
                {isCashDepositTab ? 'Cash Rows' : 'Status'}
              </th>
              {isCashDepositTab ? (
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">Status</th>
              ) : null}
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">Submitted By</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">Approved By</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={isCashDepositTab ? 9 : 8} className="px-4 py-8 text-center text-gray-500">
                  Loading...
                </td>
              </tr>
            ) : records.length === 0 ? (
              <tr>
                <td colSpan={isCashDepositTab ? 9 : 8} className="px-4 py-8 text-center text-gray-500">
                  {isCashDepositTab ? 'No cash deposit summaries found.' : 'No daily summaries found.'}
                </td>
              </tr>
            ) : (
              records.map((record) => (
                <tr key={record[recordIdField]}>
                  <td className="px-4 py-3 text-sm text-gray-900">{record.branch_name || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-900">{formatPeriod(record)}</td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">
                    {formatCurrency(isCashDepositTab ? record.total_deposit_amount : record.total_amount)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {isCashDepositTab ? (record.completed_cash_count ?? 0) : (record.payment_count ?? 0)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {isCashDepositTab ? (record.payment_count ?? 0) : statusBadge(record.status)}
                  </td>
                  {isCashDepositTab ? (
                    <td className="px-4 py-3">{statusBadge(record.status)}</td>
                  ) : null}
                  <td className="px-4 py-3 text-sm text-gray-600">{record.submitted_by_name || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{record.approved_by_name || '-'}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap align-middle">
                    <div className="inline-flex items-center justify-end">
                      <button
                        type="button"
                        onClick={(event) => openMenuForRecord(event, record[recordIdField])}
                        className="inline-flex items-center justify-center w-8 h-8 rounded-full hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                        aria-label="Actions"
                      >
                        <svg className="w-4 h-4 text-gray-500" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M10 3a1.5 1.5 0 110-3 1.5 1.5 0 010 3zM10 11.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3zM10 20a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination.total > 0 && (
        <FixedTablePagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          totalItems={pagination.total}
          itemsPerPage={10}
          itemLabel={itemLabel}
          onPageChange={fetchRecords}
        />
      )}

      {openMenuId &&
        typeof document !== 'undefined' &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[9998] bg-transparent" onClick={() => setOpenMenuId(null)} />
            <div
              className="fixed z-[9999] w-44 bg-white rounded-md shadow-lg border border-gray-200 text-left py-1"
              style={{ top: menuPosition.top, right: menuPosition.right }}
            >
              <button
                type="button"
                onClick={() => {
                  if (selectedRecord) {
                    setDetailModal({ open: true, record: selectedRecord });
                  }
                  setOpenMenuId(null);
                }}
                className="block w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 text-left"
              >
                View details
              </button>
              {selectedRecord?.status === 'Submitted' ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setVerifyModal({ open: true, record: selectedRecord });
                      setOpenMenuId(null);
                    }}
                    disabled={!!approvingId}
                    className="block w-full px-3 py-2 text-sm text-green-600 hover:bg-green-50 text-left disabled:opacity-50"
                  >
                    Verify
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRejectModal({ open: true, id: selectedRecord[recordIdField], remarks: '' });
                      setOpenMenuId(null);
                    }}
                    disabled={!!approvingId}
                    className="block w-full px-3 py-2 text-sm text-amber-600 hover:bg-amber-50 text-left disabled:opacity-50"
                  >
                    Flag for review
                  </button>
                </>
              ) : null}
            </div>
          </>,
          document.body
        )}

      {rejectModal.open && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center backdrop-blur-sm bg-black/5 p-4"
          onClick={() => setRejectModal({ open: false, id: null, remarks: '' })}
        >
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900">Flag for review</h3>
            <p className="mt-2 text-sm text-gray-600">
              Optional: Add a reason so the branch admin understands what needs to be rechecked.
            </p>
            <textarea
              value={rejectModal.remarks}
              onChange={(e) => setRejectModal((prev) => ({ ...prev, remarks: e.target.value }))}
              className="input-field mt-2 w-full min-h-[80px]"
              placeholder="Reason (optional)"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setRejectModal({ open: false, id: null, remarks: '' })}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleFlag}
                className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700"
              >
                Flag for review
              </button>
            </div>
          </div>
        </div>
      )}

      {verifyModal.open && verifyModal.record && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center backdrop-blur-sm bg-black/5 p-4"
          onClick={() => !approvingId && setVerifyModal({ open: false, record: null })}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-gray-900 shrink-0">
              {isCashDepositTab ? 'Verify cash deposit summary' : 'Verify end-of-shift summary'}
            </h3>
            <p className="mt-1 text-sm text-gray-600 shrink-0">
              {isCashDepositTab
                ? 'Review the cash payment lines below, then verify the deposit that the branch admin submitted.'
                : 'Confirm the payment records below, then click Verify to mark this submission as verified.'}
            </p>
            <div className="mt-3 flex flex-wrap gap-4 text-sm shrink-0">
              <span className="font-medium text-gray-800">{verifyModal.record.branch_name || '-'}</span>
              <span className="text-gray-600">{formatPeriod(verifyModal.record)}</span>
              <span className="font-semibold text-green-600">
                {isCashDepositTab
                  ? `Deposit: ${formatCurrency(verifyModal.record.total_deposit_amount)}`
                  : `Total: ${formatCurrency(verifyModal.record.total_amount)} (${verifyModal.record.payment_count ?? 0} payment(s))`}
              </span>
              {isCashDepositTab ? (
                <span className="text-gray-600">
                  All Cash: {formatCurrency(verifyModal.record.total_cash_amount)} ({verifyModal.record.payment_count ?? 0} row(s))
                </span>
              ) : null}
            </div>
            <div className="mt-4 shrink-0">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                {isCashDepositTab ? 'Cash payment records (from payment logs)' : 'Payment records (from payment logs)'}
              </p>
              {verifyLoading ? (
                <p className="text-sm text-gray-500 py-4">Loading payment records...</p>
              ) : (
                <div
                  className="overflow-x-auto rounded-lg border border-gray-200 max-h-56"
                  style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}
                >
                  <table className="text-sm" style={{ width: '100%', minWidth: isCashDepositTab ? '760px' : '520px' }}>
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Invoice</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Student</th>
                        {!isCashDepositTab ? (
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
                        ) : (
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Issue Date</th>
                        )}
                        {isCashDepositTab ? (
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
                        ) : null}
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                        {isCashDepositTab ? (
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        ) : null}
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Reference</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                      {verifyPayments.length === 0 ? (
                        <tr>
                          <td colSpan={isCashDepositTab ? 7 : 5} className="px-3 py-4 text-center text-gray-500">
                            No payment records found for this submission.
                          </td>
                        </tr>
                      ) : (
                        verifyPayments.map((payment) => (
                          <tr key={payment.payment_id} className="hover:bg-gray-50/80">
                            <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">
                              {payment.invoice_id ? `INV-${payment.invoice_id}` : '-'}
                            </td>
                            <td className="px-3 py-2 text-gray-700 min-w-0 max-w-[160px]">
                              <span className="truncate block" title={payment.student_name || '-'}>
                                {payment.student_name || '-'}
                              </span>
                            </td>
                            {!isCashDepositTab ? (
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{payment.payment_method || '-'}</td>
                            ) : (
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{formatDateManila(payment.issue_date)}</td>
                            )}
                            {isCashDepositTab ? (
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{payment.payment_method || '-'}</td>
                            ) : null}
                            <td className="px-3 py-2 text-right font-semibold text-green-600 whitespace-nowrap">
                              {formatCurrency(payment.payable_amount)}
                            </td>
                            {isCashDepositTab ? (
                              <td className="px-3 py-2 whitespace-nowrap">{statusBadge(payment.status)}</td>
                            ) : null}
                            <td className="px-3 py-2 text-gray-500 min-w-0 max-w-[120px]">
                              <span className="truncate block" title={payment.reference_number || '-'}>
                                {payment.reference_number || '-'}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="mt-6 flex justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => !approvingId && setVerifyModal({ open: false, record: null })}
                disabled={!!approvingId}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await handleVerify(verifyModal.record[recordIdField]);
                  setVerifyModal({ open: false, record: null });
                }}
                disabled={!!approvingId}
                className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {approvingId === verifyModal.record[recordIdField] ? 'Verifying...' : 'Verify'}
              </button>
            </div>
          </div>
        </div>
      )}

      {detailModal.open && detailModal.record && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center backdrop-blur-sm bg-black/5 p-4"
          onClick={() => setDetailModal({ open: false, record: null })}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 shrink-0">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {isCashDepositTab ? 'Cash Deposit Summary Details' : 'Daily Summary Details'}
                </h3>
                <p className="mt-1 text-xs text-gray-500">
                  {isCashDepositTab
                    ? 'Overview of the branch cash deposit submission and the payment log lines that support it.'
                    : 'Overview of this branch end-of-shift submission and payment records from payment logs.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailModal({ open: false, record: null })}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Close details"
              >
                <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm shrink-0">
              <div>
                <p className="text-xs font-medium text-gray-500">Branch</p>
                <p className="mt-0.5 text-gray-900">{detailModal.record.branch_name || '-'}</p>
              </div>
              {detailMetrics.map((metric) => (
                <div key={metric.label}>
                  <p className="text-xs font-medium text-gray-500">{metric.label}</p>
                  <p className="mt-0.5 text-gray-900 font-semibold">{metric.value}</p>
                </div>
              ))}
              <div>
                <p className="text-xs font-medium text-gray-500">Status</p>
                <div className="mt-1">{statusBadge(detailModal.record.status)}</div>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">Submitted By</p>
                <p className="mt-0.5 text-gray-900">{detailModal.record.submitted_by_name || '-'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">Submitted At</p>
                <p className="mt-0.5 text-gray-900">
                  {detailModal.record.submitted_at ? formatDateManila(detailModal.record.submitted_at) : '-'}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">Verified By</p>
                <p className="mt-0.5 text-gray-900">{detailModal.record.approved_by_name || '-'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">Verified At</p>
                <p className="mt-0.5 text-gray-900">
                  {detailModal.record.approved_at ? formatDateManila(detailModal.record.approved_at) : '-'}
                </p>
              </div>
            </div>

            <div className="mt-4 shrink-0">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                {isCashDepositTab ? 'Cash payment records (from payment logs)' : 'Payment records (from payment logs)'}
              </p>
              {detailLoading ? (
                <p className="text-sm text-gray-500 py-4">Loading payment records...</p>
              ) : (
                <div
                  className="overflow-x-auto rounded-lg border border-gray-200 max-h-48"
                  style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}
                >
                  <table className="text-sm" style={{ width: '100%', minWidth: isCashDepositTab ? '760px' : '520px' }}>
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Invoice</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Student</th>
                        {!isCashDepositTab ? (
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
                        ) : (
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Issue Date</th>
                        )}
                        {isCashDepositTab ? (
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
                        ) : null}
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                        {isCashDepositTab ? (
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        ) : null}
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Reference</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                      {detailPayments.length === 0 ? (
                        <tr>
                          <td colSpan={isCashDepositTab ? 7 : 5} className="px-3 py-4 text-center text-gray-500">
                            No payment records found for this submission.
                          </td>
                        </tr>
                      ) : (
                        detailPayments.map((payment) => (
                          <tr key={payment.payment_id} className="hover:bg-gray-50/80">
                            <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">
                              {payment.invoice_id ? `INV-${payment.invoice_id}` : '-'}
                            </td>
                            <td className="px-3 py-2 text-gray-700 min-w-0 max-w-[160px]">
                              <span className="truncate block" title={payment.student_name || '-'}>
                                {payment.student_name || '-'}
                              </span>
                            </td>
                            {!isCashDepositTab ? (
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{payment.payment_method || '-'}</td>
                            ) : (
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{formatDateManila(payment.issue_date)}</td>
                            )}
                            {isCashDepositTab ? (
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{payment.payment_method || '-'}</td>
                            ) : null}
                            <td className="px-3 py-2 text-right font-semibold text-green-600 whitespace-nowrap">
                              {formatCurrency(payment.payable_amount)}
                            </td>
                            {isCashDepositTab ? (
                              <td className="px-3 py-2 whitespace-nowrap">{statusBadge(payment.status)}</td>
                            ) : null}
                            <td className="px-3 py-2 text-gray-500 min-w-0 max-w-[120px]">
                              <span className="truncate block" title={payment.reference_number || '-'}>
                                {payment.reference_number || '-'}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="mt-4 shrink-0">
              <p className="text-xs font-medium text-gray-500">
                {detailModal.record.status === 'Rejected' ? 'Flag reason' : 'Remarks'}
              </p>
              <p className="mt-1 text-sm text-gray-800 whitespace-pre-line">
                {detailModal.record.remarks && detailModal.record.remarks.trim()
                  ? detailModal.record.remarks
                  : 'No remarks.'}
              </p>
            </div>

            <div className="mt-5 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setDetailModal({ open: false, record: null })}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DailySummarySalesApprovalPage;
