import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { apiRequest } from '../../config/api';
import { useGlobalBranchFilter } from '../../contexts/GlobalBranchFilterContext';
import { useAuth } from '../../contexts/AuthContext';
import { formatDateManila } from '../../utils/dateUtils';
import FixedTablePagination from '../../components/table/FixedTablePagination';
import { appAlert } from '../../utils/appAlert';
import PaymentAttachmentViewerModal from '../../components/paymentLogs/PaymentAttachmentViewerModal';

const TAB_END_OF_SHIFT = 'endOfShift';
const TAB_CASH_DEPOSIT = 'cashDeposit';
const PIE_COLORS = ['#16A34A', '#2563EB', '#F59E0B', '#A855F7', '#EF4444', '#14B8A6', '#6366F1', '#EC4899'];

/** Superadmin/Finance "reject" stores Returned (legacy rows may still be Rejected until migrated). */
const isFinanceReturnedSummaryStatus = (s) => s === 'Returned' || s === 'Rejected';

/** Normalize GET /daily-summary-sales/:id/payments (object with payments + AR + totals). */
const parseDailySummaryPaymentsResponse = (res) => {
  const d = res?.data;
  if (d && typeof d === 'object' && !Array.isArray(d) && Array.isArray(d.payments)) {
    return {
      payments: d.payments || [],
      arReceipts: d.ar_receipts || [],
      totals: d.totals || null,
      submittedSnapshot: d.submitted_snapshot || null,
    };
  }
  if (Array.isArray(d)) {
    return {
      payments: d,
      arReceipts: [],
      totals: null,
      submittedSnapshot: null,
    };
  }
  return {
    payments: [],
    arReceipts: [],
    totals: null,
    submittedSnapshot: null,
  };
};

/** Normalize GET /cash-deposit-summaries/:id/payments (payments + live totals + submitted snapshot). */
const parseCashDepositPaymentsResponse = (res) => {
  const d = res?.data;
  if (d && typeof d === 'object' && !Array.isArray(d) && Array.isArray(d.payments)) {
    return {
      payments: d.payments || [],
      totals: d.totals || null,
      submittedSnapshot: d.submitted_snapshot || null,
    };
  }
  if (Array.isArray(d)) {
    return { payments: d, totals: null, submittedSnapshot: null };
  }
  return { payments: [], totals: null, submittedSnapshot: null };
};

const DailySummarySalesApprovalPage = () => {
  const location = useLocation();
  const { userInfo } = useAuth();
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
  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState('');
  const [paymentAttachmentViewerUrl, setPaymentAttachmentViewerUrl] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const openedNotificationDetailRef = useRef(null);
  const openedNotificationFallbackRef = useRef('');

  const isCashDepositTab = activeTab === TAB_CASH_DEPOSIT;
  const currentUserType = userInfo?.user_type || userInfo?.userType || '';
  const canVerifyEndOfShift = ['Superadmin', 'Finance', 'Superfinance'].includes(currentUserType);
  const canVerifyCashDeposit = currentUserType === 'Finance' || currentUserType === 'Superfinance';
  const canVerifySummary = isCashDepositTab ? canVerifyCashDeposit : canVerifyEndOfShift;
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
      return parseCashDepositPaymentsResponse(res);
    }
    const res = await apiRequest(`/daily-summary-sales/${id}/payments`);
    return parseDailySummaryPaymentsResponse(res);
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
    const params = new URLSearchParams(location.search);
    const notificationTab = params.get('notificationTab');
    const fromNotification = params.get('fromNotification') === '1';

    if (fromNotification) {
      setFilterStatus('');
      setFilterDate('');
      setOpenMenuId(null);
    }

    if (notificationTab === TAB_CASH_DEPOSIT) {
      setActiveTab(TAB_CASH_DEPOSIT);
    } else if (notificationTab === TAB_END_OF_SHIFT) {
      setActiveTab(TAB_END_OF_SHIFT);
    }
  }, [location.search]);

  useEffect(() => {
    if (activeTab !== TAB_CASH_DEPOSIT || loading || records.length === 0) return;

    const params = new URLSearchParams(location.search);
    const targetIdRaw = params.get('cashDepositSummaryId');
    if (!targetIdRaw) return;

    const targetId = Number(targetIdRaw);
    if (!Number.isFinite(targetId)) return;
    if (openedNotificationDetailRef.current === targetId) return;

    const targetRecord = records.find((record) => Number(record.cash_deposit_summary_id) === targetId);
    if (!targetRecord) return;

    setDetailModal({ open: true, record: targetRecord });
    openedNotificationDetailRef.current = targetId;
  }, [activeTab, loading, records, location.search]);

  useEffect(() => {
    if (activeTab !== TAB_END_OF_SHIFT || loading || records.length === 0) return;

    const params = new URLSearchParams(location.search);
    const targetIdRaw = params.get('dailySummaryId');
    if (!targetIdRaw) return;

    const targetId = Number(targetIdRaw);
    if (!Number.isFinite(targetId)) return;
    if (openedNotificationDetailRef.current === targetId) return;

    const targetRecord = records.find((record) => Number(record.daily_summary_id) === targetId);
    if (!targetRecord) return;

    setDetailModal({ open: true, record: targetRecord });
    openedNotificationDetailRef.current = targetId;
  }, [activeTab, loading, records, location.search]);

  useEffect(() => {
    if (loading || records.length === 0) return;

    const params = new URLSearchParams(location.search);
    const fromNotification = params.get('fromNotification') === '1';
    if (!fromNotification) return;

    const notificationTab = params.get('notificationTab');
    const targetDailySummaryId = params.get('dailySummaryId');
    const targetCashDepositId = params.get('cashDepositSummaryId');

    // If an explicit target ID exists, the dedicated effects above handle opening.
    if (targetDailySummaryId || targetCashDepositId) return;

    const shouldOpenEod = notificationTab === TAB_END_OF_SHIFT && activeTab === TAB_END_OF_SHIFT;
    const shouldOpenCash = notificationTab === TAB_CASH_DEPOSIT && activeTab === TAB_CASH_DEPOSIT;
    if (!shouldOpenEod && !shouldOpenCash) return;

    const notificationTs = params.get('notificationTs') || '';
    const dedupeKey = `${notificationTab}:${notificationTs}`;
    if (openedNotificationFallbackRef.current === dedupeKey) return;

    setDetailModal({ open: true, record: records[0] });
    openedNotificationFallbackRef.current = dedupeKey;
  }, [activeTab, loading, records, location.search]);

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
      appAlert(err.response?.data?.message || err.message || 'Failed to verify');
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
      appAlert(err.response?.data?.message || err.message || 'Failed to reject');
    } finally {
      setApprovingId(null);
    }
  };

  const statusBadge = (status) => {
    const classes = {
      Submitted: 'bg-yellow-100 text-yellow-800',
      Approved: 'bg-green-100 text-green-800',
      Returned: 'bg-amber-100 text-amber-800',
      Rejected: 'bg-amber-100 text-amber-800',
    };
    const key = isFinanceReturnedSummaryStatus(status) ? 'Returned' : status;
    const label =
      status === 'Approved' ? 'Verified' : isFinanceReturnedSummaryStatus(status) ? 'Returned' : status;
    return (
      <span
        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${classes[key] || classes[status] || 'bg-gray-100 text-gray-800'}`}
      >
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

  /** Returned / legacy Rejected rows are not “verified approved”; also clears misleading approved_by from old data. */
  const summaryVerificationActorLabel = (record) => {
    if (!record) return '—';
    if (isFinanceReturnedSummaryStatus(record.status)) return '—';
    return record.approved_by_name || '—';
  };

  /**
   * List uses stored total_amount / payment_count only (API does not send live_grand_*).
   */
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

  const selectedRecord = records.find((record) => record[recordIdField] === openMenuId) || null;
  const detailPayments = detailData?.payments || [];
  const detailArReceipts = detailData?.arReceipts || [];
  const detailTotals = detailData?.totals;
  const detailSubmittedSnapshot = detailData?.submittedSnapshot;
  const cashDetailTotals = isCashDepositTab ? detailData?.totals : null;
  const verifyPayments = verifyData?.payments || [];
  const verifyArReceipts = verifyData?.arReceipts || [];
  const verifyTotals = verifyData?.totals;

  const detailPieLines = useMemo(() => {
    if (isCashDepositTab) return [];
    const fromPay = detailPayments.map((p) => ({
      payment_method: p.payment_method,
      program_level_tag: (p.program_level_tag || 'Unassigned').trim() || 'Unassigned',
      payable_amount: Number(p.payable_amount) || 0,
      tip_amount: Number(p.tip_amount) || 0,
    }));
    const fromAr = detailArReceipts.map((a) => ({
      payment_method: a.payment_method,
      program_level_tag: (a.program_level_tag || a.level_tag || 'Unassigned').trim() || 'Unassigned',
      payable_amount: Number(a.payment_amount) || 0,
      tip_amount: Number(a.tip_amount) || 0,
    }));
    return [...fromPay, ...fromAr];
  }, [detailPayments, detailArReceipts, isCashDepositTab]);

  const detailMethodPieData = useMemo(() => {
    if (isCashDepositTab || detailPieLines.length === 0) return [];
    const totals = detailPieLines.reduce((acc, payment) => {
      const key = (payment.payment_method || 'Unknown').trim() || 'Unknown';
      const line = (Number(payment.payable_amount) || 0) + (Number(payment.tip_amount) || 0);
      acc[key] = (acc[key] || 0) + line;
      return acc;
    }, {});
    return Object.entries(totals).map(([name, value]) => ({ name, value }));
  }, [detailPieLines, isCashDepositTab]);

  const detailLevelPieData = useMemo(() => {
    if (isCashDepositTab || detailPieLines.length === 0) return [];
    const totals = detailPieLines.reduce((acc, payment) => {
      const key = (payment.program_level_tag || 'Unassigned').trim() || 'Unassigned';
      const line = (Number(payment.payable_amount) || 0) + (Number(payment.tip_amount) || 0);
      acc[key] = (acc[key] || 0) + line;
      return acc;
    }, {});
    return Object.entries(totals).map(([name, value]) => ({ name, value }));
  }, [detailPieLines, isCashDepositTab]);

  const detailPieSum = useMemo(
    () => detailMethodPieData.reduce((s, x) => s + (Number(x.value) || 0), 0),
    [detailMethodPieData]
  );

  const cashDepositTotalsDrift =
    isCashDepositTab &&
    cashDetailTotals &&
    detailSubmittedSnapshot &&
    (Math.abs(
      Number(detailSubmittedSnapshot.total_deposit_amount ?? 0) - Number(cashDetailTotals.total_deposit_amount ?? 0)
    ) > 0.01 ||
      Math.abs(
        Number(detailSubmittedSnapshot.total_cash_amount ?? 0) - Number(cashDetailTotals.total_cash_amount ?? 0)
      ) > 0.01 ||
      Number(detailSubmittedSnapshot.payment_count ?? 0) !== Number(cashDetailTotals.payment_count ?? 0) ||
      Number(detailSubmittedSnapshot.completed_cash_count ?? 0) !== Number(cashDetailTotals.completed_cash_count ?? 0));

  const detailMetrics = isCashDepositTab
    ? [
        { label: 'Period', value: formatPeriod(detailModal.record) },
        {
          label: 'Cash to Deposit',
          value: formatCurrency(cashDetailTotals?.total_deposit_amount ?? detailModal.record?.total_deposit_amount),
        },
        {
          label: 'All Cash in Range',
          value: formatCurrency(cashDetailTotals?.total_cash_amount ?? detailModal.record?.total_cash_amount),
        },
        {
          label: 'Completed Cash Rows',
          value: cashDetailTotals?.completed_cash_count ?? detailModal.record?.completed_cash_count ?? 0,
        },
        {
          label: 'Cash Rows',
          value: cashDetailTotals?.payment_count ?? detailModal.record?.payment_count ?? 0,
        },
      ]
    : [
        { label: 'Date', value: formatPeriod(detailModal.record) },
        {
          label: 'Total amount',
          value: formatCurrency(
            detailTotals?.grand_total ?? detailModal.record?.total_amount
          ),
        },
        {
          label: 'Records',
          value:
            detailTotals?.grand_count ?? detailModal.record?.payment_count ?? 0,
        },
        ...(detailTotals && !detailLoading
          ? [
              {
                label: 'Completed payments',
                value: `${formatCurrency(detailTotals.completed_total)} · ${detailTotals.completed_count} row(s)`,
              },
              {
                label: 'AR sales (standalone)',
                value: `${formatCurrency(detailTotals.ar_total)} · ${detailTotals.ar_count} receipt(s)`,
              },
            ]
          : []),
      ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Daily Summary Sales</h1>
        <p className="mt-1 text-sm text-gray-600">
          Branch admin submissions appear here as Submitted. End of Shift: Superadmin, Finance, or Superfinance can verify or reject.
          Cash deposit: Finance or Superfinance can verify or reject.
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
            <option value="Returned">Returned</option>
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
        <table className="min-w-full divide-y divide-gray-200" style={{ width: '100%', minWidth: isCashDepositTab ? '980px' : '900px' }}>
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
              {!isCashDepositTab ? (
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">Approved By</th>
              ) : null}
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  Loading...
                </td>
              </tr>
            ) : records.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  {isCashDepositTab ? 'No cash deposit summaries found.' : 'No daily summaries found.'}
                </td>
              </tr>
            ) : (
              records.map((record) => (
                <tr key={record[recordIdField]}>
                  <td className="px-4 py-3 text-sm text-gray-900">{record.branch_name || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-900">{formatPeriod(record)}</td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">
                    {formatCurrency(
                      isCashDepositTab ? record.total_deposit_amount : endOfShiftListAmount(record)
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {isCashDepositTab ? (record.completed_cash_count ?? 0) : endOfShiftListPaymentCount(record)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {isCashDepositTab ? (record.payment_count ?? 0) : statusBadge(record.status)}
                  </td>
                  {isCashDepositTab ? (
                    <td className="px-4 py-3">{statusBadge(record.status)}</td>
                  ) : null}
                  <td className="px-4 py-3 text-sm text-gray-600">{record.submitted_by_name || '-'}</td>
                  {!isCashDepositTab ? (
                    <td className="px-4 py-3 text-sm text-gray-600">{summaryVerificationActorLabel(record)}</td>
                  ) : null}
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
              {canVerifySummary &&
              selectedRecord &&
              ['Submitted', 'Returned', 'Rejected'].includes(String(selectedRecord.status || '')) ? (
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
                    Reject
                  </button>
                </>
              ) : null}
            </div>
          </>,
          document.body
        )}

      {rejectModal.open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center backdrop-blur-sm bg-black/5 p-4"
            onClick={() => setRejectModal({ open: false, id: null, remarks: '' })}
          >
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-gray-900">Reject submission</h3>
              <p className="mt-2 text-sm text-gray-600">
                Optional: Add a reason so the branch admin understands why this submission was rejected.
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
                  Reject
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {verifyModal.open &&
        verifyModal.record &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center backdrop-blur-sm bg-black/5 p-4"
            onClick={() => !approvingId && setVerifyModal({ open: false, record: null })}
          >
          <div
            className={`bg-white rounded-lg shadow-xl w-full max-h-[90vh] flex flex-col p-6 min-w-0 ${
              isCashDepositTab ? 'max-w-4xl' : 'max-w-[min(1440px,calc(100vw-2rem))]'
            }`}
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
                  ? !verifyLoading && verifyTotals
                    ? `Deposit: ${formatCurrency(verifyTotals.total_deposit_amount)} · All cash: ${formatCurrency(
                        verifyTotals.total_cash_amount
                      )} (${verifyTotals.completed_cash_count ?? 0} completed / ${verifyTotals.payment_count ?? 0} rows)`
                    : `Deposit: ${formatCurrency(verifyModal.record.total_deposit_amount)} · All cash: ${formatCurrency(
                        verifyModal.record.total_cash_amount
                      )} (${verifyModal.record.completed_cash_count ?? 0} completed / ${verifyModal.record.payment_count ?? 0} rows at submit)`
                  : !verifyLoading && verifyTotals
                    ? `Total: ${formatCurrency(verifyTotals.grand_total)} (${verifyTotals.grand_count} lines: ${verifyTotals.completed_count} payments + ${verifyTotals.ar_count} AR)`
                    : `Total: ${formatCurrency(verifyModal.record.total_amount)} (${verifyModal.record.payment_count ?? 0} at submit)`}
              </span>
            </div>
            <div className="mt-4 shrink-0">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                {isCashDepositTab ? 'Cash payment records (from payment logs)' : 'Completed payments (payment logs)'}
              </p>
              {verifyLoading ? (
                <p className="text-sm text-gray-500 py-4">Loading payment records...</p>
              ) : isCashDepositTab ? (
                <div
                  className="overflow-x-auto rounded-lg border border-gray-200 max-h-56"
                  style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}
                >
                  <table className="text-sm" style={{ width: '100%', minWidth: '760px' }}>
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Invoice</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Student</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Issue Date</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Collected</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Reference</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                      {verifyPayments.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-3 py-4 text-center text-gray-500">
                            No payment records found for this submission.
                          </td>
                        </tr>
                      ) : (
                        verifyPayments.map((payment) => {
                          const tip = Number(payment.tip_amount) || 0;
                          const payable = Number(payment.payable_amount) || 0;
                          const collected = payable + tip;
                          return (
                          <tr key={`verify-cash-${payment.payment_id}`} className="hover:bg-gray-50/80">
                            <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">
                              {payment.invoice_id ? `INV-${payment.invoice_id}` : '-'}
                            </td>
                            <td className="px-3 py-2 text-gray-700 min-w-0 max-w-[160px]">
                              <span className="truncate block" title={payment.student_name || '-'}>
                                {payment.student_name || '-'}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{formatDateManila(payment.issue_date)}</td>
                            <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{payment.payment_method || '-'}</td>
                            <td className="px-3 py-2 text-right font-semibold text-green-600 whitespace-nowrap align-top">
                              <div>{formatCurrency(collected)}</div>
                              {tip > 0 ? (
                                <div className="text-[10px] text-gray-500 font-normal mt-0.5">
                                  {formatCurrency(payable)} + tip {formatCurrency(tip)}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">{statusBadge(payment.status)}</td>
                            <td className="px-3 py-2 text-gray-500 min-w-0 max-w-[120px]">
                              <span className="truncate block" title={payment.reference_number || '-'}>
                                {payment.reference_number || '-'}
                              </span>
                            </td>
                          </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <>
                <div
                  className="rounded-lg border border-gray-200 max-h-56 overflow-y-auto min-w-0"
                  style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}
                >
                  <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
                  <table className="border-collapse text-[11px] sm:text-xs" style={{ width: '100%', minWidth: '960px' }}>
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="w-[8%] py-2 ps-4 pe-2 text-left font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Invoice</th>
                        <th className="w-[9%] py-2 px-2 text-left font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Pay date</th>
                        <th className="w-[15%] py-2 px-2 text-left font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Student</th>
                        <th className="w-[10%] py-2 px-2 text-left font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Level tag</th>
                        <th className="w-[10%] py-2 px-2 text-left font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Payment method</th>
                        <th className="w-[11%] py-2 px-2 text-right font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Inv total</th>
                        <th className="w-[11%] py-2 px-2 text-right font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Collected</th>
                        <th className="w-[10%] py-2 px-2 text-center font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Attached image</th>
                        <th className="w-[16%] py-2 ps-2 pe-4 text-left font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Reference</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white">
                      {verifyPayments.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="px-3 py-4 text-center text-gray-500 border-b border-gray-100">
                            No completed payment rows for this summary date.
                          </td>
                        </tr>
                      ) : (
                        verifyPayments.map((payment) => {
                          const tip = Number(payment.tip_amount) || 0;
                          const payable = Number(payment.payable_amount) || 0;
                          const collected = payable + tip;
                          const invTotal = payment.invoice_document_total;
                          const attUrl = (payment.payment_attachment_url || '').trim();
                          return (
                            <tr key={payment.payment_id} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50/80">
                              <td className="py-2 ps-4 pe-2 font-medium text-gray-900 truncate align-top">
                                {payment.invoice_id ? `INV-${payment.invoice_id}` : '-'}
                              </td>
                              <td className="py-2 px-2 text-gray-700 truncate align-top">
                                {payment.issue_date ? formatDateManila(payment.issue_date) : '-'}
                              </td>
                              <td className="py-2 px-2 text-gray-700 min-w-0 align-top">
                                <span className="truncate block" title={payment.student_name || '-'}>
                                  {payment.student_name || '-'}
                                </span>
                              </td>
                              <td className="py-2 px-2 text-gray-700 min-w-0 align-top">
                                <span className="truncate block" title={payment.program_level_tag || '-'}>
                                  {payment.program_level_tag || '-'}
                                </span>
                              </td>
                              <td className="py-2 px-2 text-gray-700 truncate align-top">{payment.payment_method || '-'}</td>
                              <td className="py-2 px-2 text-right font-medium text-gray-800 tabular-nums align-top truncate">
                                {invTotal != null && invTotal !== '' ? formatCurrency(invTotal) : '—'}
                              </td>
                              <td className="py-2 px-2 text-right align-top min-w-0">
                                <div className="font-semibold text-green-600 tabular-nums">{formatCurrency(collected)}</div>
                                {tip > 0 ? (
                                  <div className="text-[10px] text-gray-500 mt-0.5 leading-tight">
                                    {formatCurrency(payable)} + tip {formatCurrency(tip)}
                                  </div>
                                ) : null}
                              </td>
                              <td className="py-2 px-2 text-center align-top whitespace-nowrap">
                                {attUrl ? (
                                  <button
                                    type="button"
                                    onClick={() => setPaymentAttachmentViewerUrl(attUrl)}
                                    className="text-xs font-medium text-primary-600 hover:text-primary-800 hover:underline"
                                  >
                                    View
                                  </button>
                                ) : (
                                  <span className="text-gray-400">—</span>
                                )}
                              </td>
                              <td className="py-2 ps-2 pe-4 text-gray-500 min-w-0 align-top">
                                <span className="truncate block" title={payment.reference_number || '-'}>
                                  {payment.reference_number || '-'}
                                </span>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                  </div>
                </div>

                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2 mt-6">
                  Standalone AR receipts
                </p>
                <div
                  className="rounded-lg border border-gray-200 max-h-40 overflow-y-auto min-w-0"
                  style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}
                >
                  <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
                    <table className="border-collapse text-[11px] sm:text-xs" style={{ width: '100%', minWidth: '720px' }}>
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">AR #</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Pay date</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Prospect</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Level</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Collected</th>
                          <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Image</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Reference</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {verifyArReceipts.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="px-3 py-3 text-center text-gray-500">
                              No standalone AR receipts for this date.
                            </td>
                          </tr>
                        ) : (
                          verifyArReceipts.map((ar) => {
                            const tip = Number(ar.tip_amount) || 0;
                            const pam = Number(ar.payment_amount) || 0;
                            const collected = pam + tip;
                            const attUrl = (ar.payment_attachment_url || '').trim();
                            return (
                              <tr key={`verify-ar-${ar.ack_receipt_id}`}>
                                <td className="px-3 py-2 font-medium whitespace-nowrap">{ar.ack_receipt_number || `#${ar.ack_receipt_id}`}</td>
                                <td className="px-3 py-2 whitespace-nowrap">{ar.issue_date ? formatDateManila(ar.issue_date) : '-'}</td>
                                <td className="px-3 py-2 min-w-0 max-w-[160px] truncate" title={ar.prospect_student_name || ''}>
                                  {ar.prospect_student_name || '-'}
                                </td>
                                <td className="px-3 py-2 min-w-0 max-w-[100px] truncate">{ar.program_level_tag || '-'}</td>
                                <td className="px-3 py-2 whitespace-nowrap">{ar.payment_method || '-'}</td>
                                <td className="px-3 py-2 text-right font-semibold text-green-600">{formatCurrency(collected)}</td>
                                <td className="px-3 py-2 text-center">
                                  {attUrl ? (
                                    <button
                                      type="button"
                                      onClick={() => setPaymentAttachmentViewerUrl(attUrl)}
                                      className="text-xs text-primary-600 hover:underline"
                                    >
                                      View
                                    </button>
                                  ) : (
                                    '—'
                                  )}
                                </td>
                                <td className="px-3 py-2 text-gray-500 truncate max-w-[120px]" title={ar.reference_number || ''}>
                                  {ar.reference_number || '-'}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                </>
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
          </div>,
          document.body
        )}

      {detailModal.open &&
        detailModal.record &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center backdrop-blur-sm bg-black/5 p-4"
            onClick={() => setDetailModal({ open: false, record: null })}
          >
          <div
            className={`bg-white rounded-xl shadow-xl w-full max-h-[92vh] flex flex-col overflow-hidden min-w-0 ${
              isCashDepositTab ? 'max-w-5xl' : 'max-w-[min(1440px,calc(100vw-2rem))]'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4 shrink-0">
              <div className="min-w-0">
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

            <div className="px-5 py-4 overflow-y-auto min-h-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-sm">
                <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                  <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Branch</p>
                  <p className="mt-1 text-gray-900 font-medium truncate">{detailModal.record.branch_name || '-'}</p>
                </div>
                {detailMetrics.map((metric) => (
                  <div key={metric.label} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                    <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{metric.label}</p>
                    <p className="mt-1 text-gray-900 font-semibold">{metric.value}</p>
                  </div>
                ))}
                <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                  <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Status</p>
                  <div className="mt-1">{statusBadge(detailModal.record.status)}</div>
                </div>
                <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                  <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Submitted By</p>
                  <p className="mt-1 text-gray-900 font-medium truncate">{detailModal.record.submitted_by_name || '-'}</p>
                </div>
                <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                  <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Submitted At</p>
                  <p className="mt-1 text-gray-900 font-medium">
                    {detailModal.record.submitted_at ? formatDateManila(detailModal.record.submitted_at) : '-'}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                  <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Verified By</p>
                  <p className="mt-1 text-gray-900 font-medium truncate">
                    {summaryVerificationActorLabel(detailModal.record)}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                  <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Verified At</p>
                  <p className="mt-1 text-gray-900 font-medium">
                    {detailModal.record.approved_at ? formatDateManila(detailModal.record.approved_at) : '-'}
                  </p>
                </div>
                {isCashDepositTab ? (
                  <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                    <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Reference Number</p>
                    <p className="mt-1 text-gray-900 font-medium break-all">{detailModal.record.reference_number || '-'}</p>
                  </div>
                ) : null}
                {isCashDepositTab ? (
                  <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                    <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Deposit Proof</p>
                    {detailModal.record.deposit_attachment_url ? (
                      <button
                        type="button"
                        onClick={() => setAttachmentPreviewUrl(detailModal.record.deposit_attachment_url)}
                        className="mt-1 inline-block text-sm text-primary-700 hover:text-primary-800 underline break-all text-left"
                      >
                        View attachment
                      </button>
                    ) : (
                      <p className="mt-1 text-gray-900 font-medium">-</p>
                    )}
                  </div>
                ) : null}
              </div>

              {isCashDepositTab && !detailLoading && cashDepositTotalsDrift ? (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Submitted amounts: Cash to Deposit{' '}
                  <span className="font-semibold">
                    {formatCurrency(detailSubmittedSnapshot.total_deposit_amount)}
                  </span>
                  , All cash{' '}
                  <span className="font-semibold">{formatCurrency(detailSubmittedSnapshot.total_cash_amount)}</span>
                  {' '}
                  ({detailSubmittedSnapshot.completed_cash_count ?? 0} completed / {detailSubmittedSnapshot.payment_count ?? 0}{' '}
                  rows). Current recalculated for this period: Cash to Deposit{' '}
                  <span className="font-semibold">{formatCurrency(cashDetailTotals.total_deposit_amount)}</span>, All cash{' '}
                  <span className="font-semibold">{formatCurrency(cashDetailTotals.total_cash_amount)}</span>
                  {' '}
                  ({cashDetailTotals.completed_cash_count ?? 0} completed / {cashDetailTotals.payment_count ?? 0} rows) — payment
                  lines may have changed after submission (includes payable + tip on cash rows).
                </div>
              ) : null}

              <div className="mt-4">
              {!isCashDepositTab && (
                <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-lg border border-gray-200 p-3">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Sales by Payment Method</p>
                    {detailMethodPieData.length === 0 ? (
                      <p className="text-sm text-gray-500 py-8 text-center">No data available.</p>
                    ) : (
                      <>
                        <div className="h-36">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie data={detailMethodPieData} dataKey="value" nameKey="name" outerRadius={64} innerRadius={32}>
                                {detailMethodPieData.map((entry, idx) => (
                                  <Cell key={entry.name} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                                ))}
                              </Pie>
                              <Tooltip formatter={(value) => formatCurrency(value)} />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="space-y-1 text-xs">
                          {detailMethodPieData.map((entry, idx) => (
                            <div key={entry.name} className="flex items-center justify-between">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }} />
                                <span className="truncate text-gray-700">{entry.name}</span>
                              </div>
                              <span className="font-medium text-gray-900">{formatCurrency(entry.value)}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                  <div className="rounded-lg border border-gray-200 p-3">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Sales by Program/Level Tag</p>
                    {detailLevelPieData.length === 0 ? (
                      <p className="text-sm text-gray-500 py-8 text-center">No data available.</p>
                    ) : (
                      <>
                        <div className="h-36">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie data={detailLevelPieData} dataKey="value" nameKey="name" outerRadius={64} innerRadius={32}>
                                {detailLevelPieData.map((entry, idx) => (
                                  <Cell key={entry.name} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                                ))}
                              </Pie>
                              <Tooltip formatter={(value) => formatCurrency(value)} />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="space-y-1 text-xs">
                          {detailLevelPieData.map((entry, idx) => (
                            <div key={entry.name} className="flex items-center justify-between">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }} />
                                <span className="truncate text-gray-700">{entry.name}</span>
                              </div>
                              <span className="font-medium text-gray-900">{formatCurrency(entry.value)}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
              {!isCashDepositTab && detailTotals && detailMethodPieData.length > 0 ? (
                <p className="mb-4 text-[11px] text-gray-500">
                  Segment totals match <span className="font-medium text-gray-700">total amount</span> (
                  {formatCurrency(detailTotals.grand_total)}
                  {Math.abs(detailPieSum - Number(detailTotals.grand_total || 0)) > 0.02
                    ? ` · segment sum ${formatCurrency(detailPieSum)}`
                    : ''}
                  ) for this summary date (completed payments + standalone AR).
                </p>
              ) : null}
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                {isCashDepositTab ? 'Cash payment records (from payment logs)' : 'Completed payments (payment logs)'}
              </p>
              {detailLoading ? (
                <p className="text-sm text-gray-500 py-4">Loading payment records...</p>
              ) : isCashDepositTab ? (
                <div
                  className="overflow-x-auto rounded-lg border border-gray-200 max-h-56"
                  style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}
                >
                  <table className="text-sm" style={{ width: '100%', minWidth: '760px' }}>
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Invoice</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Student</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Program/Level Tag</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Issue Date</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Collected</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Reference</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                      {detailPayments.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-3 py-4 text-center text-gray-500">
                            No payment records found for this submission.
                          </td>
                        </tr>
                      ) : (
                        detailPayments.map((payment) => {
                          const tip = Number(payment.tip_amount) || 0;
                          const payable = Number(payment.payable_amount) || 0;
                          const collected = payable + tip;
                          return (
                          <tr key={`cash-detail-${payment.payment_id}`} className="hover:bg-gray-50/80">
                            <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">
                              {payment.invoice_id ? `INV-${payment.invoice_id}` : '-'}
                            </td>
                            <td className="px-3 py-2 text-gray-700 min-w-0 max-w-[160px]">
                              <span className="truncate block" title={payment.student_name || '-'}>
                                {payment.student_name || '-'}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-gray-700 min-w-0 max-w-[150px]">
                              <span className="truncate block" title={payment.program_level_tag || '-'}>
                                {payment.program_level_tag || '-'}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{formatDateManila(payment.issue_date)}</td>
                            <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{payment.payment_method || '-'}</td>
                            <td className="px-3 py-2 text-right font-semibold text-green-600 whitespace-nowrap align-top">
                              <div>{formatCurrency(collected)}</div>
                              {tip > 0 ? (
                                <div className="text-[10px] text-gray-500 font-normal mt-0.5">
                                  {formatCurrency(payable)} + tip {formatCurrency(tip)}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">{statusBadge(payment.status)}</td>
                            <td className="px-3 py-2 text-gray-500 min-w-0 max-w-[120px]">
                              <span className="truncate block" title={payment.reference_number || '-'}>
                                {payment.reference_number || '-'}
                              </span>
                            </td>
                          </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <>
                <div
                  className="rounded-lg border border-gray-200 max-h-56 overflow-y-auto min-w-0"
                  style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}
                >
                  <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
                  <table className="border-collapse text-[11px] sm:text-xs" style={{ width: '100%', minWidth: '960px' }}>
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="w-[8%] py-2 ps-4 pe-2 text-left font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Invoice</th>
                        <th className="w-[9%] py-2 px-2 text-left font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Pay date</th>
                        <th className="w-[15%] py-2 px-2 text-left font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Student</th>
                        <th className="w-[10%] py-2 px-2 text-left font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Level tag</th>
                        <th className="w-[10%] py-2 px-2 text-left font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Payment method</th>
                        <th className="w-[11%] py-2 px-2 text-right font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Inv total</th>
                        <th className="w-[11%] py-2 px-2 text-right font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Collected</th>
                        <th className="w-[10%] py-2 px-2 text-center font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Attached image</th>
                        <th className="w-[16%] py-2 ps-2 pe-4 text-left font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Reference</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white">
                      {detailPayments.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="px-3 py-4 text-center text-gray-500 border-b border-gray-100">
                            No completed payment rows for this summary date (payments with status Completed).
                          </td>
                        </tr>
                      ) : (
                        detailPayments.map((payment) => {
                          const tip = Number(payment.tip_amount) || 0;
                          const payable = Number(payment.payable_amount) || 0;
                          const collected = payable + tip;
                          const invTotal = payment.invoice_document_total;
                          const attUrl = (payment.payment_attachment_url || '').trim();
                          return (
                            <tr key={payment.payment_id} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50/80">
                              <td className="py-2 ps-4 pe-2 font-medium text-gray-900 truncate align-top">
                                {payment.invoice_id ? `INV-${payment.invoice_id}` : '-'}
                              </td>
                              <td className="py-2 px-2 text-gray-700 truncate align-top">
                                {payment.issue_date ? formatDateManila(payment.issue_date) : '-'}
                              </td>
                              <td className="py-2 px-2 text-gray-700 min-w-0 align-top">
                                <span className="truncate block" title={payment.student_name || '-'}>
                                  {payment.student_name || '-'}
                                </span>
                              </td>
                              <td className="py-2 px-2 text-gray-700 min-w-0 align-top">
                                <span className="truncate block" title={payment.program_level_tag || '-'}>
                                  {payment.program_level_tag || '-'}
                                </span>
                              </td>
                              <td className="py-2 px-2 text-gray-700 truncate align-top">{payment.payment_method || '-'}</td>
                              <td className="py-2 px-2 text-right font-medium text-gray-800 tabular-nums align-top truncate">
                                {invTotal != null && invTotal !== '' ? formatCurrency(invTotal) : '—'}
                              </td>
                              <td className="py-2 px-2 text-right align-top min-w-0">
                                <div className="font-semibold text-green-600 tabular-nums">{formatCurrency(collected)}</div>
                                {tip > 0 ? (
                                  <div className="text-[10px] text-gray-500 mt-0.5 leading-tight">
                                    {formatCurrency(payable)} + tip {formatCurrency(tip)}
                                  </div>
                                ) : null}
                              </td>
                              <td className="py-2 px-2 text-center align-top whitespace-nowrap">
                                {attUrl ? (
                                  <button
                                    type="button"
                                    onClick={() => setPaymentAttachmentViewerUrl(attUrl)}
                                    className="text-xs font-medium text-primary-600 hover:text-primary-800 hover:underline"
                                  >
                                    View
                                  </button>
                                ) : (
                                  <span className="text-gray-400">—</span>
                                )}
                              </td>
                              <td className="py-2 ps-2 pe-4 text-gray-500 min-w-0 align-top">
                                <span className="truncate block" title={payment.reference_number || '-'}>
                                  {payment.reference_number || '-'}
                                </span>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                  </div>
                </div>

                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2 mt-6">
                  Standalone AR receipts (included in total; not yet posted as invoice payments)
                </p>
                <div
                  className="rounded-lg border border-gray-200 max-h-48 overflow-y-auto min-w-0"
                  style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}
                >
                  <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
                    <table className="border-collapse text-[11px] sm:text-xs" style={{ width: '100%', minWidth: '720px' }}>
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">AR #</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Pay date</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Prospect / student</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Level</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Collected</th>
                          <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Image</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Reference</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {detailArReceipts.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="px-3 py-4 text-center text-gray-500">
                              No standalone AR receipts for this summary date.
                            </td>
                          </tr>
                        ) : (
                          detailArReceipts.map((ar) => {
                            const tip = Number(ar.tip_amount) || 0;
                            const pam = Number(ar.payment_amount) || 0;
                            const collected = pam + tip;
                            const attUrl = (ar.payment_attachment_url || '').trim();
                            return (
                              <tr key={`ar-${ar.ack_receipt_id}`} className="hover:bg-gray-50/80">
                                <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">
                                  {ar.ack_receipt_number || `#${ar.ack_receipt_id}`}
                                </td>
                                <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                                  {ar.issue_date ? formatDateManila(ar.issue_date) : '-'}
                                </td>
                                <td className="px-3 py-2 text-gray-700 min-w-0 max-w-[180px]">
                                  <span className="truncate block" title={ar.prospect_student_name || '-'}>
                                    {ar.prospect_student_name || '-'}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-gray-700 min-w-0 max-w-[120px]">
                                  <span className="truncate block" title={ar.program_level_tag || '-'}>
                                    {ar.program_level_tag || '-'}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{ar.payment_method || '-'}</td>
                                <td className="px-3 py-2 text-right font-semibold text-green-600 tabular-nums whitespace-nowrap">
                                  <div>{formatCurrency(collected)}</div>
                                  {tip > 0 ? (
                                    <div className="text-[10px] text-gray-500 mt-0.5">
                                      {formatCurrency(pam)} + tip {formatCurrency(tip)}
                                    </div>
                                  ) : null}
                                </td>
                                <td className="px-3 py-2 text-center whitespace-nowrap">
                                  {attUrl ? (
                                    <button
                                      type="button"
                                      onClick={() => setPaymentAttachmentViewerUrl(attUrl)}
                                      className="text-xs font-medium text-primary-600 hover:text-primary-800 hover:underline"
                                    >
                                      View
                                    </button>
                                  ) : (
                                    <span className="text-gray-400">—</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-gray-500 min-w-0 max-w-[140px]">
                                  <span className="truncate block" title={ar.reference_number || '-'}>
                                    {ar.reference_number || '-'}
                                  </span>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                </>
              )}
              </div>

              <div className="mt-4">
                <p className="text-xs font-medium text-gray-500">
                  {isFinanceReturnedSummaryStatus(detailModal.record.status) ? 'Return reason' : 'Remarks'}
                </p>
                <p className="mt-1 text-sm text-gray-800 whitespace-pre-line">
                  {detailModal.record.remarks && detailModal.record.remarks.trim()
                    ? detailModal.record.remarks
                    : 'No remarks.'}
                </p>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-gray-100 flex justify-end shrink-0 bg-white">
              <button
                type="button"
                onClick={() => setDetailModal({ open: false, record: null })}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                Close
              </button>
            </div>
          </div>
          </div>,
          document.body
        )}

      <PaymentAttachmentViewerModal
        open={Boolean(paymentAttachmentViewerUrl)}
        url={paymentAttachmentViewerUrl}
        onClose={() => setPaymentAttachmentViewerUrl(null)}
      />

      {attachmentPreviewUrl && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center backdrop-blur-sm bg-black/60 p-4"
          onClick={() => setAttachmentPreviewUrl('')}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between shrink-0">
              <h4 className="text-sm font-semibold text-gray-900">Deposit Attachment Preview</h4>
              <button
                type="button"
                onClick={() => setAttachmentPreviewUrl('')}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-md"
                aria-label="Close attachment preview"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-auto bg-gray-50 flex items-center justify-center p-3">
              <img
                src={attachmentPreviewUrl}
                alt="Deposit attachment"
                className="max-w-full max-h-[75vh] object-contain rounded border border-gray-200 bg-white"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DailySummarySalesApprovalPage;
