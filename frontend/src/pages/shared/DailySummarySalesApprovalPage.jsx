import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { apiRequest } from '../../config/api';
import { useGlobalBranchFilter } from '../../contexts/GlobalBranchFilterContext';
import { useAuth } from '../../contexts/AuthContext';
import {
  formatDateManila,
  manilaMonthYYYYMM,
} from '../../utils/dateUtils';
import { PAYMENT_LOG_DATE_MODES } from '../../utils/paymentLogDateFilters';
import {
  buildDailySummaryListDateQueryParams,
  defaultDailySummaryFilterMonth,
  DEFAULT_DAILY_SUMMARY_DATE_FILTER_MODE,
  getDailySummaryDateFilterHint,
  getDailySummaryDateFilterTitle,
  getDailySummaryDateModeLabels,
  hasActiveDailySummaryListDateFilter,
} from '../../utils/dailySummaryListDateFilters';
import FixedTablePagination, { TablePaginationSummary } from '../../components/table/FixedTablePagination';
import { appAlert } from '../../utils/appAlert';
import PaymentAttachmentViewerModal from '../../components/paymentLogs/PaymentAttachmentViewerModal';
import SortableHeader from '../../components/table/SortableHeader';
import { sortRows, toggleSortConfig } from '../../utils/tableSorting';
import {
  canSuperfinanceVerifyCashDeposit,
  cashDepositStatusBadgeClass,
  formatCashDepositStatus,
  isSuperfinanceUser,
} from '../../utils/cashDepositStatus';
import {
  isFinanceReturnedSummaryStatus,
  parseCashDepositPaymentsResponse,
  parseDailySummaryPaymentsResponse,
} from '../../utils/dailySummaryPaymentsParse';
import {
  getPaymentLogTableAmountColumn,
  getPaymentLogTableTotalAmountColumn,
} from '../../utils/paymentLogTableAmounts';
import CashDepositPaymentEditModal from '../../components/dailySummary/CashDepositPaymentEditModal';
import CashDepositPaymentInvoiceCell from '../../components/dailySummary/CashDepositPaymentInvoiceCell';
import { canEditCashDepositPayments } from '../../utils/cashDepositPaymentEdit';

const TAB_END_OF_SHIFT = 'endOfShift';
const TAB_CASH_DEPOSIT = 'cashDeposit';
const PIE_COLORS = ['#16A34A', '#2563EB', '#F59E0B', '#A855F7', '#EF4444', '#14B8A6', '#6366F1', '#EC4899'];

const paymentLogRowKey = (payment, index, prefix) => {
  const id = payment?.payment_id;
  if (id != null && id !== '') return `${prefix}-${id}`;
  const invoiceId = payment?.invoice_id;
  const issueDate = payment?.issue_date || '';
  const ref = payment?.reference_number || '';
  return `${prefix}-${index}-${invoiceId || 'na'}-${issueDate}-${ref}`;
};

const DailySummarySalesApprovalPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { userInfo } = useAuth();
  const { selectedBranchId: globalBranchId } = useGlobalBranchFilter();
  const [activeTab, setActiveTab] = useState(TAB_END_OF_SHIFT);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [dateFilterMode, setDateFilterMode] = useState(DEFAULT_DAILY_SUMMARY_DATE_FILTER_MODE);
  const [filterIssueMonth, setFilterIssueMonth] = useState(() => defaultDailySummaryFilterMonth());
  const [filterIssueDateFrom, setFilterIssueDateFrom] = useState('');
  const [filterIssueDateTo, setFilterIssueDateTo] = useState('');
  const [filterCreatedDateFrom, setFilterCreatedDateFrom] = useState('');
  const [filterCreatedDateTo, setFilterCreatedDateTo] = useState('');
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [sortConfig, setSortConfig] = useState(null);
  const [submittedSummary, setSubmittedSummary] = useState({ count: 0, total_amount: 0 });
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
  const [cashPaymentEdit, setCashPaymentEdit] = useState(null);
  const [cashPaymentEditContext, setCashPaymentEditContext] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const openedNotificationDetailRef = useRef(null);

  const isCashDepositTab = activeTab === TAB_CASH_DEPOSIT;
  const declineActionLabel = isCashDepositTab ? 'Return' : 'Reject';
  const declineActionProgressLabel = isCashDepositTab ? 'Returning...' : 'Rejecting...';
  const declineModalTitle = isCashDepositTab ? 'Return submission' : 'Reject submission';
  const declineModalDescription = isCashDepositTab
    ? 'Optional: Add a reason so the branch admin understands why this cash deposit was returned.'
    : 'Optional: Add a reason so the branch admin understands why this submission was rejected.';
  const dateModeLabels = getDailySummaryDateModeLabels(isCashDepositTab);
  const currentUserType = userInfo?.user_type || userInfo?.userType || '';
  const canVerifyEndOfShift = ['Superadmin', 'Finance', 'Superfinance'].includes(currentUserType);
  const canVerifyCashDeposit = isSuperfinanceUser(userInfo);
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

  const openCashPaymentEdit = (payment, contextRecord) => {
    setCashPaymentEdit(payment);
    setCashPaymentEditContext(contextRecord || null);
  };

  const closeCashPaymentEdit = () => {
    setCashPaymentEdit(null);
    setCashPaymentEditContext(null);
  };

  const refreshCashPaymentEditContext = useCallback(async () => {
    const record = cashPaymentEditContext;
    if (!record?.[recordIdField]) return;
    const id = record[recordIdField];
    const data = await fetchRecordDetails(id);
    if (detailModal.open && detailModal.record?.[recordIdField] === id) {
      setDetailData(data);
    }
    if (verifyModal.open && verifyModal.record?.[recordIdField] === id) {
      setVerifyData(data);
    }
  }, [
    cashPaymentEditContext,
    recordIdField,
    fetchRecordDetails,
    detailModal.open,
    detailModal.record,
    verifyModal.open,
    verifyModal.record,
  ]);

  const cashDepositPaymentsEditableFor = (depositRecord) =>
    isCashDepositTab &&
    canEditCashDepositPayments({ userType: currentUserType, depositStatus: depositRecord?.status });

  const fetchRecords = useCallback(async (page = 1) => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ page: String(page), limit: '10' });
      if (effectiveBranchFilter) params.set('branch_id', effectiveBranchFilter);
      if (filterStatus) params.set('status', filterStatus);
      // Range params differ per tab: EOD uses summary_date_from/_to (single
      // calendar day per row), Cash Deposit uses date_from/_to (period overlap).
      // Cash deposit + month mode: never request with a blank month (avoids empty overlap → bad rows).
      const monthForRange =
        isCashDepositTab &&
        dateFilterMode === PAYMENT_LOG_DATE_MODES.MONTH &&
        !String(filterIssueMonth || '').trim()
          ? manilaMonthYYYYMM()
          : filterIssueMonth;

      const dateParams = buildDailySummaryListDateQueryParams(isCashDepositTab, {
        mode: dateFilterMode,
        month: monthForRange,
        paymentFrom: filterIssueDateFrom,
        paymentTo: filterIssueDateTo,
        createdFrom: filterCreatedDateFrom,
        createdTo: filterCreatedDateTo,
      });
      Object.entries(dateParams).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });

      const endpoint = isCashDepositTab ? '/cash-deposit-summaries' : '/daily-summary-sales';
      const res = await apiRequest(`${endpoint}?${params.toString()}`);

      setRecords(res.data || []);
      const summaryForFilters = (filterStatus || '').trim() ? res.filtered_summary : res.submitted_summary;
      setSubmittedSummary({
        count: Number(summaryForFilters?.count ?? 0),
        total_amount: Number(summaryForFilters?.total_amount ?? 0),
      });
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
      setSubmittedSummary({ count: 0, total_amount: 0 });
    } finally {
      setLoading(false);
    }
  }, [effectiveBranchFilter, filterStatus, dateFilterMode, filterIssueMonth, filterIssueDateFrom, filterIssueDateTo, filterCreatedDateFrom, filterCreatedDateTo, isCashDepositTab]);

  const closeDetailModal = useCallback(() => {
    setDetailModal({ open: false, record: null });
    openedNotificationDetailRef.current = null;

    const params = new URLSearchParams(location.search);
    const hadNotificationDeepLink =
      params.get('fromNotification') === '1' ||
      Boolean(params.get('cashDepositSummaryId')) ||
      Boolean(params.get('dailySummaryId'));

    const monthWasEmpty =
      dateFilterMode === PAYMENT_LOG_DATE_MODES.MONTH && !String(filterIssueMonth || '').trim();

    if (monthWasEmpty) {
      setFilterIssueMonth(defaultDailySummaryFilterMonth());
    }

    if (hadNotificationDeepLink) {
      params.delete('fromNotification');
      params.delete('notificationTs');
      params.delete('cashDepositSummaryId');
      params.delete('dailySummaryId');
      params.delete('notificationTab');
      const qs = params.toString();
      navigate(qs ? `${location.pathname}?${qs}` : location.pathname, { replace: true });
    }

    // Stripping the URL does not change filter deps, so refetch when we only removed notification params.
    if (hadNotificationDeepLink && !monthWasEmpty) {
      void fetchRecords(pagination.page);
    }
  }, [
    dateFilterMode,
    filterIssueMonth,
    location.pathname,
    location.search,
    navigate,
    fetchRecords,
    pagination.page,
  ]);

  useEffect(() => {
    setOpenMenuId(null);
    setDetailModal({ open: false, record: null });
    setVerifyModal({ open: false, record: null });
    setRejectModal({ open: false, id: null, remarks: '' });
    setDetailData(null);
    setVerifyData(null);
    fetchRecords(1);
  }, [activeTab, filterStatus, dateFilterMode, filterIssueMonth, filterIssueDateFrom, filterIssueDateTo, filterCreatedDateFrom, filterCreatedDateTo, globalBranchId, fetchRecords]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const notificationTab = params.get('notificationTab');
    const fromNotification = params.get('fromNotification') === '1';

    // Do not clear opened-notification ref on every search change — it breaks deep-link
    // dedupe and can race with the open-modal effect. Clear when not a notification entry.
    if (!fromNotification) {
      openedNotificationDetailRef.current = null;
    }

    if (fromNotification) {
      setOpenMenuId(null);
    }

    if (notificationTab === TAB_CASH_DEPOSIT) {
      setActiveTab(TAB_CASH_DEPOSIT);
    } else if (notificationTab === TAB_END_OF_SHIFT) {
      setActiveTab(TAB_END_OF_SHIFT);
    }
  }, [location.search]);

  useEffect(() => {
    setDateFilterMode(DEFAULT_DAILY_SUMMARY_DATE_FILTER_MODE);
    setFilterIssueMonth(defaultDailySummaryFilterMonth());
    setFilterIssueDateFrom('');
    setFilterIssueDateTo('');
    setFilterCreatedDateFrom('');
    setFilterCreatedDateTo('');
  }, [activeTab]);

  useEffect(() => {
    if (loading) return;

    const params = new URLSearchParams(location.search);
    if (params.get('fromNotification') !== '1') return;

    const targetIdRaw = isCashDepositTab
      ? params.get('cashDepositSummaryId')
      : params.get('dailySummaryId');
    if (!targetIdRaw) return;

    const targetId = Number(targetIdRaw);
    if (!Number.isFinite(targetId)) return;
    if (openedNotificationDetailRef.current === targetId) return;

    let cancelled = false;

    const openFromNotification = async () => {
      let targetRecord = records.find((record) => Number(record[recordIdField]) === targetId);

      if (!targetRecord) {
        try {
          const data = await fetchRecordDetails(targetId);
          if (cancelled) return;
          if (data?.summary) {
            targetRecord = data.summary;
          }
        } catch {
          return;
        }
      }

      if (!targetRecord || cancelled) return;

      openedNotificationDetailRef.current = targetId;
      setDetailModal({ open: true, record: targetRecord });
    };

    openFromNotification();

    return () => {
      cancelled = true;
    };
  }, [loading, records, location.search, isCashDepositTab, recordIdField, fetchRecordDetails]);

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
      return true;
    } catch (err) {
      appAlert(err.response?.data?.message || err.message || 'Failed to verify');
      return false;
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
      closeDetailModal();
      await fetchRecords(pagination.page);
    } catch (err) {
      appAlert(
        err.response?.data?.message ||
          err.message ||
          (isCashDepositTab ? 'Failed to return submission' : 'Failed to reject')
      );
    } finally {
      setApprovingId(null);
    }
  };

  const statusBadge = (status) => {
    if (isCashDepositTab) {
      return (
        <span
          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${cashDepositStatusBadgeClass(status)}`}
        >
          {formatCashDepositStatus(status)}
        </span>
      );
    }
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
    const menuWidth = 176; // w-44
    const top = rect.bottom + 4;
    let right = viewportWidth - rect.right;
    if (right < 8) right = 8;
    if (right > viewportWidth - menuWidth - 8) {
      right = Math.max(8, viewportWidth - rect.left - menuWidth);
    }
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
  const canActOnRecord = (record) => {
    if (!record) return false;
    if (isCashDepositTab) {
      return canVerifyCashDeposit && canSuperfinanceVerifyCashDeposit(record.status);
    }
    return (
      canVerifySummary &&
      ['Submitted', 'Returned', 'Rejected'].includes(String(record.status || ''))
    );
  };
  const livePayments = detailData?.payments || [];
  const detailArReceipts = detailData?.arReceipts || [];
  const detailTotals = detailData?.totals;
  const detailSubmittedSnapshot = detailData?.submittedSnapshot;
  const submittedSnapshotPayments = Array.isArray(detailSubmittedSnapshot?.payments)
    ? detailSubmittedSnapshot.payments
    : [];
  // Cash Deposit details: prefer live recalc (reflects current DB state), but
  // fall back to the audit snapshot rows when live is empty so the modal still
  // shows what was originally submitted (e.g. rows that were hard-deleted post-
  // submission). Non-cash tabs keep the current behavior.
  const detailPayments =
    isCashDepositTab && livePayments.length === 0 && submittedSnapshotPayments.length > 0
      ? submittedSnapshotPayments
      : livePayments;
  const detailIsUsingSubmittedSnapshot =
    isCashDepositTab && livePayments.length === 0 && submittedSnapshotPayments.length > 0;
  const cashDetailTotals = isCashDepositTab ? detailData?.totals : null;
  const liveVerifyPayments = verifyData?.payments || [];
  const verifyArReceipts = verifyData?.arReceipts || [];
  const verifyTotals = verifyData?.totals;
  const verifySubmittedSnapshotPayments = Array.isArray(verifyData?.submittedSnapshot?.payments)
    ? verifyData.submittedSnapshot.payments
    : [];
  const verifyPayments =
    isCashDepositTab && liveVerifyPayments.length === 0 && verifySubmittedSnapshotPayments.length > 0
      ? verifySubmittedSnapshotPayments
      : liveVerifyPayments;

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

  const sortedRecords = sortRows(records, sortConfig, {
    branch: { accessor: (record) => record.branch_nickname || record.branch_name || '', type: 'string' },
    status: { accessor: 'status', type: 'string' },
  });

  const handleSort = (key) => {
    setSortConfig((current) => toggleSortConfig(current, key));
  };

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
                label: 'Acknowledgement Receipt sales (standalone)',
                value: `${formatCurrency(detailTotals.ar_total)} · ${detailTotals.ar_count} receipt(s)`,
              },
            ]
          : []),
      ];

  return (
    <div className="min-w-0 max-w-full space-y-4 sm:space-y-6 px-1 sm:px-0">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Daily Summary Sales</h1>
        <p className="mt-1 text-xs sm:text-sm text-gray-600 leading-snug">
          Branch admin cash deposits appear as Pending until Superfinance verifies. End of Shift: Superadmin, Finance, or Superfinance can verify or reject.
          Cash deposit: Superfinance only can verify or return.
        </p>
      </div>

      <div className="border-b border-gray-200 -mx-1 px-1 sm:mx-0 sm:px-0">
        <nav
          className="flex gap-2 overflow-x-auto pb-px [-webkit-overflow-scrolling:touch] sm:flex-wrap sm:gap-4 sm:overflow-visible sm:pb-0"
          aria-label="Summary type tabs"
          style={{ scrollbarWidth: 'thin' }}
        >
          <button
            type="button"
            onClick={() => setActiveTab(TAB_END_OF_SHIFT)}
            className={`shrink-0 py-3 px-2 sm:px-1 border-b-2 font-medium text-sm transition-colors ${
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
            className={`shrink-0 py-3 px-2 sm:px-1 border-b-2 font-medium text-sm transition-colors whitespace-nowrap ${
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

      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:gap-x-3 sm:gap-y-2">
          <div className="shrink-0">
            <label className="mb-0.5 block text-xs font-medium text-gray-500">Status</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="input-field py-1.5 text-sm w-full min-w-[8.5rem] sm:w-auto"
            >
              <option value="">All</option>
              <option value="Pending">Pending</option>
              <option value="Approved">Verified</option>
              <option value="Returned">Returned</option>
            </select>
          </div>
          <div
            className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2 sm:gap-y-1 sm:py-1.5 sm:ps-3 sm:pe-2"
            title={getDailySummaryDateFilterTitle(isCashDepositTab, dateFilterMode)}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Date filter</span>
              <div
                role="tablist"
                aria-label="Daily summary date filter mode"
                className="inline-flex flex-wrap gap-0.5 rounded border border-gray-200 bg-gray-50 p-px"
              >
                {[
                  { mode: PAYMENT_LOG_DATE_MODES.MONTH, label: dateModeLabels[PAYMENT_LOG_DATE_MODES.MONTH] },
                  { mode: PAYMENT_LOG_DATE_MODES.PAYMENT_DATE, label: dateModeLabels[PAYMENT_LOG_DATE_MODES.PAYMENT_DATE] },
                  { mode: PAYMENT_LOG_DATE_MODES.CREATED_DATE, label: dateModeLabels[PAYMENT_LOG_DATE_MODES.CREATED_DATE] },
                ].map(({ mode, label }) => {
                  const isActive = dateFilterMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => setDateFilterMode(mode)}
                      className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                        isActive
                          ? 'bg-white text-primary-700 shadow-sm ring-1 ring-primary-200'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:flex-1">
              {dateFilterMode === PAYMENT_LOG_DATE_MODES.MONTH && (
                <input
                  type="month"
                  aria-label="Filter month"
                  value={filterIssueMonth}
                  max={manilaMonthYYYYMM()}
                  onChange={(e) => setFilterIssueMonth(e.target.value)}
                  className="input-field w-[9.75rem] shrink-0 py-1 text-sm"
                />
              )}
              {dateFilterMode === PAYMENT_LOG_DATE_MODES.PAYMENT_DATE && (
                <>
                  <input
                    id="ds-primary-from"
                    type="date"
                    aria-label={
                      isCashDepositTab ? 'Deposit date from' : 'End of shift date from'
                    }
                    value={filterIssueDateFrom}
                    max={filterIssueDateTo || undefined}
                    onChange={(e) => setFilterIssueDateFrom(e.target.value)}
                    className="input-field w-[9.75rem] shrink-0 py-1 text-sm"
                  />
                  <span className="text-xs text-gray-400" aria-hidden>
                    –
                  </span>
                  <input
                    id="ds-primary-to"
                    type="date"
                    aria-label={isCashDepositTab ? 'Deposit date to' : 'End of shift date to'}
                    value={filterIssueDateTo}
                    min={filterIssueDateFrom || undefined}
                    onChange={(e) => setFilterIssueDateTo(e.target.value)}
                    className="input-field w-[9.75rem] shrink-0 py-1 text-sm"
                  />
                </>
              )}
              {dateFilterMode === PAYMENT_LOG_DATE_MODES.CREATED_DATE && (
                <>
                  <input
                    id="ds-created-from"
                    type="date"
                    aria-label={isCashDepositTab ? 'Submit date from' : 'EOD submit date from'}
                    value={filterCreatedDateFrom}
                    max={filterCreatedDateTo || undefined}
                    onChange={(e) => setFilterCreatedDateFrom(e.target.value)}
                    className="input-field w-[9.75rem] shrink-0 py-1 text-sm"
                  />
                  <span className="text-xs text-gray-400" aria-hidden>
                    –
                  </span>
                  <input
                    id="ds-created-to"
                    type="date"
                    aria-label={isCashDepositTab ? 'Submit date to' : 'EOD submit date to'}
                    value={filterCreatedDateTo}
                    min={filterCreatedDateFrom || undefined}
                    onChange={(e) => setFilterCreatedDateTo(e.target.value)}
                    className="input-field w-[9.75rem] shrink-0 py-1 text-sm"
                  />
                </>
              )}
              {(hasActiveDailySummaryListDateFilter({
                mode: dateFilterMode,
                month: filterIssueMonth,
                paymentFrom: filterIssueDateFrom,
                paymentTo: filterIssueDateTo,
                createdFrom: filterCreatedDateFrom,
                createdTo: filterCreatedDateTo,
              }) ||
                dateFilterMode !== DEFAULT_DAILY_SUMMARY_DATE_FILTER_MODE) && (
                <button
                  type="button"
                  onClick={() => {
                    setDateFilterMode(DEFAULT_DAILY_SUMMARY_DATE_FILTER_MODE);
                    setFilterIssueMonth(defaultDailySummaryFilterMonth());
                    setFilterIssueDateFrom('');
                    setFilterIssueDateTo('');
                    setFilterCreatedDateFrom('');
                    setFilterCreatedDateTo('');
                  }}
                  className="shrink-0 text-[11px] font-semibold text-primary-600 hover:underline sm:ms-0.5"
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="inline-flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm w-full min-w-0 sm:w-auto sm:max-w-full sm:px-4 lg:shrink-0">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500 leading-tight">
              {isCashDepositTab ? 'Cash deposit' : 'End of Shift'}
            </p>
            <p className="text-base sm:text-lg font-semibold text-gray-900 leading-tight">
              {Number(submittedSummary.count || 0).toLocaleString('en-US')}
            </p>
          </div>
          <div className="hidden h-8 w-px bg-gray-200 sm:block" />
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500 leading-tight">
              {isCashDepositTab ? 'Total Amount' : 'Total amount'}
            </p>
            <p className="text-base sm:text-lg font-semibold text-emerald-700 leading-tight whitespace-nowrap">
              ₱{Number(submittedSummary.total_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-gray-500 leading-snug px-0.5 sm:px-0 -mt-1 sm:-mt-2">
        {getDailySummaryDateFilterHint(isCashDepositTab)}
      </p>

      {pagination.total > 0 && (
        <TablePaginationSummary
          page={pagination.page}
          totalItems={pagination.total}
          itemsPerPage={10}
          itemLabel={itemLabel}
          className="px-4 pt-4 pb-2"
        />
      )}
      <div
        className="overflow-x-auto rounded-lg"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}
      >
        <table className="min-w-full divide-y divide-gray-200" style={{ width: '100%', minWidth: isCashDepositTab ? '1100px' : '1020px' }}>
          <thead className="bg-gray-50">
            <tr>
              <SortableHeader label="Branch" sortKey="branch" sortConfig={sortConfig} onSort={handleSort} className="px-4 py-3 text-left text-xs font-semibold text-gray-700" />
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">
                {isCashDepositTab ? 'Period' : 'Summary Date'}
              </th>
              {!isCashDepositTab ? (
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">Submitted Date</th>
              ) : null}
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
                <SortableHeader label="Status" sortKey="status" sortConfig={sortConfig} onSort={handleSort} className="px-4 py-3 text-left text-xs font-semibold text-gray-700" />
              ) : null}
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">Submitted By</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">Approved By</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={isCashDepositTab ? 9 : 9} className="px-4 py-8 text-center text-gray-500">
                  Loading...
                </td>
              </tr>
            ) : records.length === 0 ? (
              <tr>
                <td colSpan={isCashDepositTab ? 9 : 9} className="px-4 py-8 text-center text-gray-500">
                  {isCashDepositTab ? 'No cash deposit summaries found.' : 'No daily summaries found.'}
                </td>
              </tr>
            ) : (
              sortedRecords.map((record, rowIndex) => (
                <tr key={record[recordIdField] ?? `summary-row-${rowIndex}`}>
                  <td className="px-4 py-3 text-sm text-gray-900">{record.branch_name || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-900">{formatPeriod(record)}</td>
                  {!isCashDepositTab ? (
                    <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                      {record.submitted_at ? formatDateManila(record.submitted_at) : '-'}
                    </td>
                  ) : null}
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
                  <td className="px-4 py-3 text-sm text-gray-600">{summaryVerificationActorLabel(record)}</td>
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
            <div key="actions-menu-overlay" className="fixed inset-0 z-[9998] bg-transparent" onClick={() => setOpenMenuId(null)} />
            <div
              key="actions-menu-panel"
              className="fixed z-[9999] w-48 bg-white rounded-md shadow-lg border border-gray-200 text-left py-1"
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
              {selectedRecord && canActOnRecord(selectedRecord) ? (
                <>
                  <button
                    key="action-verify"
                    type="button"
                    onClick={() => {
                      setVerifyModal({ open: true, record: selectedRecord });
                      setOpenMenuId(null);
                    }}
                    className="block w-full px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-50 text-left"
                  >
                    Verify
                  </button>
                  <button
                    key="action-reject"
                    type="button"
                    onClick={() => {
                      setRejectModal({
                        open: true,
                        id: selectedRecord[recordIdField],
                        remarks: '',
                      });
                      setOpenMenuId(null);
                    }}
                    className="block w-full px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 text-left"
                  >
                    {declineActionLabel}
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
            className="fixed inset-0 z-[10000] flex items-stretch justify-center backdrop-blur-sm bg-black/5 p-2 sm:items-center sm:p-4"
            onClick={() => !approvingId && setRejectModal({ open: false, id: null, remarks: '' })}
          >
            <div
              className="bg-white rounded-t-xl sm:rounded-lg shadow-xl max-w-md w-full max-h-[min(92dvh,90vh)] overflow-y-auto p-4 sm:p-6 my-auto sm:my-0"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-gray-900">{declineModalTitle}</h3>
              <p className="mt-2 text-sm text-gray-600">{declineModalDescription}</p>
              <textarea
                value={rejectModal.remarks}
                onChange={(e) => setRejectModal((prev) => ({ ...prev, remarks: e.target.value }))}
                className="input-field mt-2 w-full min-h-[80px]"
                placeholder="Reason (optional)"
              />
              <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  onClick={() => setRejectModal({ open: false, id: null, remarks: '' })}
                  disabled={!!approvingId}
                  className="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 sm:w-auto"
                >
                  Cancel
                </button>
                <button
                  onClick={handleFlag}
                  disabled={!!approvingId}
                  className="w-full px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50 sm:w-auto"
                >
                  {approvingId === rejectModal.id ? declineActionProgressLabel : declineActionLabel}
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
            className="fixed inset-0 z-[9999] flex items-stretch justify-center backdrop-blur-sm bg-black/5 p-2 sm:items-center sm:p-4"
            onClick={() => !approvingId && setVerifyModal({ open: false, record: null })}
          >
          <div
            className={`bg-white rounded-t-xl sm:rounded-lg shadow-xl w-full max-h-[min(92dvh,90vh)] flex flex-col p-4 sm:p-6 min-w-0 my-auto sm:my-0 ${
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
                    ? `Total: ${formatCurrency(verifyTotals.grand_total)} (${verifyTotals.grand_count} lines: ${verifyTotals.completed_count} payments + ${verifyTotals.ar_count} acknowledgement receipts)`
                    : `Total: ${formatCurrency(verifyModal.record.total_amount)} (${verifyModal.record.payment_count ?? 0} at submit)`}
              </span>
            </div>
            <div className="mt-4 shrink-0">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                {isCashDepositTab ? 'Cash payment records (from payment logs)' : 'Completed payments (payment logs)'}
              </p>
              {isCashDepositTab && cashDepositPaymentsEditableFor(verifyModal.record) ? (
                <p className="mb-2 text-[11px] text-primary-700">
                  Click an invoice to update payment details. Totals refresh automatically after you save.
                </p>
              ) : null}
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
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Total Amount</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Reference</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                      {verifyPayments.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-3 py-4 text-center text-gray-500">
                            No payment records found for this submission.
                          </td>
                        </tr>
                      ) : (
                        verifyPayments.map((payment, paymentIndex) => {
                          const tip = Number(payment.tip_amount) || 0;
                          const payable = Number(payment.payable_amount) || 0;
                          const collected = payable + tip;
                          return (
                          <tr key={paymentLogRowKey(payment, paymentIndex, 'verify-cash')} className="hover:bg-gray-50/80">
                            <td className="px-3 py-2 whitespace-nowrap">
                              <CashDepositPaymentInvoiceCell
                                payment={payment}
                                canEdit={cashDepositPaymentsEditableFor(verifyModal.record)}
                                onEdit={(p) => openCashPaymentEdit(p, verifyModal.record)}
                              />
                            </td>
                            <td className="px-3 py-2 text-gray-700 min-w-0 max-w-[160px]">
                              <span className="truncate block" title={payment.student_name || '-'}>
                                {payment.student_name || '-'}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{formatDateManila(payment.issue_date)}</td>
                            <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{payment.payment_method || '-'}</td>
                            <td className="px-3 py-2 text-right font-semibold text-green-600 whitespace-nowrap align-top">
                              {formatCurrency(getPaymentLogTableAmountColumn(payment))}
                            </td>
                            <td className="px-3 py-2 text-right font-semibold text-emerald-700 whitespace-nowrap align-top">
                              <div>{formatCurrency(getPaymentLogTableTotalAmountColumn(payment))}</div>
                              {tip > 0 ? <div className="text-[10px] text-gray-500 font-normal mt-0.5">{formatCurrency(payable)} + tip {formatCurrency(tip)}</div> : null}
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
                  <table className="border-collapse text-[11px] sm:text-xs" style={{ width: '100%', minWidth: '1080px' }}>
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="w-[8%] py-2 ps-4 pe-2 text-left font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Invoice</th>
                        <th className="w-[9%] py-2 px-2 text-left font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Pay date</th>
                        <th className="w-[15%] py-2 px-2 text-left font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Student</th>
                        <th className="w-[10%] py-2 px-2 text-left font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Level tag</th>
                        <th className="w-[10%] py-2 px-2 text-left font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Payment method</th>
                        <th className="w-[11%] py-2 px-2 text-right font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Inv total</th>
                        <th className="w-[10%] py-2 px-2 text-right font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Amount</th>
                        <th className="w-[11%] py-2 px-2 text-right font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Total Amount</th>
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
                        verifyPayments.map((payment, paymentIndex) => {
                          const tip = Number(payment.tip_amount) || 0;
                          const payable = Number(payment.payable_amount) || 0;
                          const amount = getPaymentLogTableAmountColumn(payment);
                          const totalAmount = getPaymentLogTableTotalAmountColumn(payment);
                          const invTotal = payment.invoice_document_total;
                          const attUrl = (payment.payment_attachment_url || '').trim();
                          return (
                            <tr key={paymentLogRowKey(payment, paymentIndex, 'verify-eod')} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50/80">
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
                                <div className="font-semibold text-gray-900 tabular-nums">{formatCurrency(amount)}</div>
                              </td>
                              <td className="py-2 px-2 text-right align-top min-w-0">
                                <div className="font-semibold text-green-600 tabular-nums">{formatCurrency(totalAmount)}</div>
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
                  Standalone Acknowledgement Receipts
                </p>
                <div
                  className="rounded-lg border border-gray-200 max-h-40 overflow-y-auto min-w-0"
                  style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}
                >
                  <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
                    <table className="border-collapse text-[11px] sm:text-xs" style={{ width: '100%', minWidth: '820px' }}>
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Acknowledgement Receipt #</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Pay date</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Prospect</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Level</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Total Amount</th>
                          <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Image</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Reference</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {verifyArReceipts.length === 0 ? (
                          <tr>
                            <td colSpan={9} className="px-3 py-3 text-center text-gray-500">
                              No standalone acknowledgement receipts for this date.
                            </td>
                          </tr>
                        ) : (
                          verifyArReceipts.map((ar) => {
                            const tip = Number(ar.tip_amount) || 0;
                            const pam = Number(ar.payment_amount) || 0;
                            const totalAmount = pam + tip;
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
                                <td className="px-3 py-2 text-right font-semibold text-gray-900">{formatCurrency(pam)}</td>
                                <td className="px-3 py-2 text-right font-semibold text-green-600">{formatCurrency(totalAmount)}</td>
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
            <div className="mt-6 flex flex-col-reverse gap-2 shrink-0 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => !approvingId && setVerifyModal({ open: false, record: null })}
                disabled={!!approvingId}
                className="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 sm:w-auto"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const verified = await handleVerify(verifyModal.record[recordIdField]);
                  if (verified) setVerifyModal({ open: false, record: null });
                }}
                disabled={!!approvingId}
                className="w-full px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 sm:w-auto"
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
            className="fixed inset-0 z-[9999] flex items-stretch justify-center backdrop-blur-sm bg-black/5 p-2 sm:items-center sm:p-4"
            onClick={() => !approvingId && closeDetailModal()}
          >
          <div
            className={`bg-white rounded-t-xl sm:rounded-xl shadow-xl w-full max-h-[min(92dvh,92vh)] flex flex-col overflow-hidden min-w-0 my-auto sm:my-0 ${
              isCashDepositTab ? 'max-w-5xl' : 'max-w-[min(1440px,calc(100vw-2rem))]'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-3 shrink-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:px-5 sm:py-4">
              <div className="min-w-0 order-2 sm:order-1">
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
                onClick={closeDetailModal}
                disabled={!!approvingId}
                className="self-end text-gray-400 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50 sm:self-auto order-1 sm:order-2"
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

            <div className="px-4 py-3 overflow-y-auto min-h-0 sm:px-5 sm:py-4">
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
                                  <Cell key={`method-pie-${idx}-${entry.name}`} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                                ))}
                              </Pie>
                              <Tooltip formatter={(value) => formatCurrency(value)} />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="space-y-1 text-xs">
                          {detailMethodPieData.map((entry, idx) => (
                            <div key={`pie-legend-${idx}-${entry.name}`} className="flex items-center justify-between">
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
                                  <Cell key={`level-pie-${idx}-${entry.name}`} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                                ))}
                              </Pie>
                              <Tooltip formatter={(value) => formatCurrency(value)} />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="space-y-1 text-xs">
                          {detailLevelPieData.map((entry, idx) => (
                            <div key={`pie-legend-${idx}-${entry.name}`} className="flex items-center justify-between">
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
                  ) for this summary date (completed payments + standalone acknowledgement receipts).
                </p>
              ) : null}
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                {isCashDepositTab ? 'Cash payment records (from payment logs)' : 'Completed payments (payment logs)'}
              </p>
              {isCashDepositTab && cashDepositPaymentsEditableFor(detailModal.record) ? (
                <p className="mb-2 text-[11px] text-primary-700">
                  Click an invoice to update payment details. Totals refresh automatically after you save.
                </p>
              ) : null}
              {isCashDepositTab && detailIsUsingSubmittedSnapshot ? (
                <p className="mb-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
                  Showing the original submitted snapshot — the live recalc found no matching payment rows for this period (rows may have been deleted after submission).
                </p>
              ) : null}
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
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Total Amount</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Reference</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                      {detailPayments.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="px-3 py-4 text-center text-gray-500">
                            No payment records found for this submission.
                          </td>
                        </tr>
                      ) : (
                        detailPayments.map((payment, paymentIndex) => {
                          const tip = Number(payment.tip_amount) || 0;
                          const payable = Number(payment.payable_amount) || 0;
                          const collected = payable + tip;
                          return (
                          <tr key={paymentLogRowKey(payment, paymentIndex, 'cash-detail')} className="hover:bg-gray-50/80">
                            <td className="px-3 py-2 whitespace-nowrap">
                              <CashDepositPaymentInvoiceCell
                                payment={payment}
                                canEdit={cashDepositPaymentsEditableFor(detailModal.record)}
                                onEdit={(p) => openCashPaymentEdit(p, detailModal.record)}
                              />
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
                              {formatCurrency(getPaymentLogTableAmountColumn(payment))}
                            </td>
                            <td className="px-3 py-2 text-right font-semibold text-emerald-700 whitespace-nowrap align-top">
                              <div>{formatCurrency(getPaymentLogTableTotalAmountColumn(payment))}</div>
                              {tip > 0 ? <div className="text-[10px] text-gray-500 font-normal mt-0.5">{formatCurrency(payable)} + tip {formatCurrency(tip)}</div> : null}
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
                  <table className="border-collapse text-[11px] sm:text-xs" style={{ width: '100%', minWidth: '1080px' }}>
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="w-[8%] py-2 ps-4 pe-2 text-left font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Invoice</th>
                        <th className="w-[9%] py-2 px-2 text-left font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Pay date</th>
                        <th className="w-[15%] py-2 px-2 text-left font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Student</th>
                        <th className="w-[10%] py-2 px-2 text-left font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Level tag</th>
                        <th className="w-[10%] py-2 px-2 text-left font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Payment method</th>
                        <th className="w-[11%] py-2 px-2 text-right font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Inv total</th>
                        <th className="w-[10%] py-2 px-2 text-right font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Amount</th>
                        <th className="w-[11%] py-2 px-2 text-right font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Total Amount</th>
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
                        detailPayments.map((payment, paymentIndex) => {
                          const tip = Number(payment.tip_amount) || 0;
                          const payable = Number(payment.payable_amount) || 0;
                          const amount = getPaymentLogTableAmountColumn(payment);
                          const totalAmount = getPaymentLogTableTotalAmountColumn(payment);
                          const invTotal = payment.invoice_document_total;
                          const attUrl = (payment.payment_attachment_url || '').trim();
                          return (
                            <tr key={paymentLogRowKey(payment, paymentIndex, 'eod-detail')} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50/80">
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
                                <div className="font-semibold text-gray-900 tabular-nums">{formatCurrency(amount)}</div>
                              </td>
                              <td className="py-2 px-2 text-right align-top min-w-0">
                                <div className="font-semibold text-green-600 tabular-nums">{formatCurrency(totalAmount)}</div>
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
                  Standalone Acknowledgement Receipts (included in total; not yet posted as invoice payments)
                </p>
                <div
                  className="rounded-lg border border-gray-200 max-h-48 overflow-y-auto min-w-0"
                  style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}
                >
                  <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
                    <table className="border-collapse text-[11px] sm:text-xs" style={{ width: '100%', minWidth: '820px' }}>
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Acknowledgement Receipt #</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Pay date</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Prospect / student</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Level</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Total Amount</th>
                          <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Image</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Reference</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {detailArReceipts.length === 0 ? (
                          <tr>
                            <td colSpan={9} className="px-3 py-4 text-center text-gray-500">
                              No standalone acknowledgement receipts for this summary date.
                            </td>
                          </tr>
                        ) : (
                          detailArReceipts.map((ar) => {
                            const tip = Number(ar.tip_amount) || 0;
                            const pam = Number(ar.payment_amount) || 0;
                            const totalAmount = pam + tip;
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
                                <td className="px-3 py-2 text-right font-semibold text-gray-900 tabular-nums whitespace-nowrap">
                                  <div>{formatCurrency(pam)}</div>
                                </td>
                                <td className="px-3 py-2 text-right font-semibold text-green-600 tabular-nums whitespace-nowrap">
                                  <div>{formatCurrency(totalAmount)}</div>
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

            <div className="px-4 py-3 border-t border-gray-100 flex flex-col-reverse gap-2 bg-white shrink-0 sm:px-5 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={closeDetailModal}
                disabled={!!approvingId}
                className="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                Close
              </button>
              {canActOnRecord(detailModal.record) ? (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setRejectModal({
                        open: true,
                        id: detailModal.record[recordIdField],
                        remarks: '',
                      })
                    }
                    disabled={!!approvingId}
                    className="w-full px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                  >
                    {declineActionLabel}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const verified = await handleVerify(detailModal.record[recordIdField]);
                      if (verified) closeDetailModal();
                    }}
                    disabled={!!approvingId}
                    className="w-full px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                  >
                    {approvingId === detailModal.record[recordIdField] ? 'Verifying...' : 'Verify'}
                  </button>
                </>
              ) : null}
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

      {cashPaymentEdit ? (
        <CashDepositPaymentEditModal
          payment={cashPaymentEdit}
          onClose={closeCashPaymentEdit}
          onSaved={refreshCashPaymentEditContext}
        />
      ) : null}

      {attachmentPreviewUrl && (
        <div
          className="fixed inset-0 z-[10000] flex items-stretch justify-center backdrop-blur-sm bg-black/60 p-2 sm:items-center sm:p-4"
          onClick={() => setAttachmentPreviewUrl('')}
        >
          <div
            className="bg-white rounded-t-xl sm:rounded-xl shadow-xl max-w-4xl w-full max-h-[min(92dvh,90vh)] flex flex-col overflow-hidden my-auto sm:my-0"
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
