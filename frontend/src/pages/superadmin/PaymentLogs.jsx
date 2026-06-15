import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';
import { useGlobalBranchFilter } from '../../contexts/GlobalBranchFilterContext';
import * as XLSX from 'xlsx';
import { appendPaymentLogsAmountTotalRow } from '../../utils/paymentLogsExcelExport';
import {
  getPaymentLogTableAmountColumn,
  getPaymentLogTableTotalAmountColumn,
} from '../../utils/paymentLogTableAmounts';
import { buildPaymentLogsTableSortAccessors } from '../../utils/paymentLogsTableSortAccessors';
import { formatDateManila, formatDateTimeManila } from '../../utils/dateUtils';
import {
  PAYMENT_LOG_DATE_MODES,
  PAYMENT_LOG_DATE_MODE_LABELS,
  DEFAULT_PAYMENT_LOG_DATE_MODE,
  defaultPaymentLogFilterMonth,
  buildPaymentLogDateParams,
  buildPaymentLogListDateParams,
} from '../../utils/paymentLogDateFilters';
import FixedTablePagination, { TablePaginationSummary } from '../../components/table/FixedTablePagination';
import useDebouncedValue from '../../hooks/useDebouncedValue';
import { appAlert } from '../../utils/appAlert';
import { uploadInvoicePaymentImage } from '../../utils/uploadInvoicePaymentImage';
import { BranchPaymentLogTabs } from '../../components/paymentLogs/PaymentLogsViewTabs';
import PaymentAttachmentViewerModal from '../../components/paymentLogs/PaymentAttachmentViewerModal';
import { PaymentLogPackageItemCell } from '../../components/paymentLogs/PaymentLogPackageItemCell';
import { getPaymentLogPackageItemDisplayText } from '../../utils/paymentLogPackageItem';
import UnappliedArPaymentLogStatus from '../../components/payments/UnappliedArPaymentLogStatus';
import {
  isUnappliedArPaymentLogRow,
  verifyUnappliedArFromPaymentLog,
} from '../../utils/unappliedArPaymentLog';
import StandardExportModal from '../../components/export/StandardExportModal';
import PaymentLogsExportDateRange from '../../components/export/PaymentLogsExportDateRange';
import SortableHeader from '../../components/table/SortableHeader';
import { sortRows, toggleSortConfig } from '../../utils/tableSorting';
import { buildInvoiceNavigateStateFromRejectedPayment } from '../../utils/invoiceFocusNavigation';

/** Same options as Record Payment on Invoice page (see Invoice.jsx payment_method select) */
const RETURN_FIX_PAYMENT_METHOD_OPTIONS = [
  'Cash',
  'Online Banking',
  'Credit Card',
  'E-wallets',
];

const getReturnFixPaymentMethodOptions = (currentValue) => {
  const c = (currentValue || '').trim();
  if (!c) return RETURN_FIX_PAYMENT_METHOD_OPTIONS;
  if (RETURN_FIX_PAYMENT_METHOD_OPTIONS.includes(c)) return RETURN_FIX_PAYMENT_METHOD_OPTIONS;
  return [c, ...RETURN_FIX_PAYMENT_METHOD_OPTIONS];
};

/** Same breakdown logic as Record Payment (adminInvoice.jsx) — for invoice summary + validation */
const getInvoiceBreakdownForReturnFix = (invoice) => {
  const items = Array.isArray(invoice?.items) ? invoice.items : [];
  const subtotal = items.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
  const discount = items.reduce((sum, item) => sum + (parseFloat(item.discount_amount) || 0), 0);
  const penalty = items.reduce((sum, item) => sum + (parseFloat(item.penalty_amount) || 0), 0);
  const tax = items.reduce((sum, item) => {
    const amount = parseFloat(item.amount) || 0;
    const taxPercentage = parseFloat(item.tax_percentage) || 0;
    return sum + (amount * taxPercentage) / 100;
  }, 0);
  const totalDue = subtotal - discount + penalty + tax;
  const remaining = parseFloat(invoice?.amount || 0);
  const paidAmount = Math.max(0, totalDue - remaining);
  return {
    subtotal,
    discount,
    penalty,
    tax,
    totalDue,
    paidAmount,
    remaining,
  };
};

const PaymentLogs = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { userInfo } = useAuth();
  const { selectedBranchId: globalBranchId } = useGlobalBranchFilter();
  /** main = all except Returned; return = finance sent back for reference/attachment fix */
  const [branchLogTab, setBranchLogTab] = useState(() => {
    const params = new URLSearchParams(location.search);
    const notificationTab = params.get('notificationTab');
    return notificationTab === 'return' || notificationTab === 'rejected' ? notificationTab : 'main';
  });
  const [selectedRejectedPayment, setSelectedRejectedPayment] = useState(null);
  const [returnFixPayment, setReturnFixPayment] = useState(null);
  const [returnFixRef, setReturnFixRef] = useState('');
  const [returnFixAttachment, setReturnFixAttachment] = useState('');
  const [returnFixPaymentMethod, setReturnFixPaymentMethod] = useState('Cash');
  const [returnFixIssueDate, setReturnFixIssueDate] = useState('');
  const [returnFixAttachmentUploading, setReturnFixAttachmentUploading] = useState(false);
  const [returnFixLoading, setReturnFixLoading] = useState(false);
  const [returnFixInvoiceSummary, setReturnFixInvoiceSummary] = useState(null);
  const [returnFixInvoiceLoading, setReturnFixInvoiceLoading] = useState(false);
  const [returnFixPaymentType, setReturnFixPaymentType] = useState('');
  const [returnFixPayableAmount, setReturnFixPayableAmount] = useState('');
  const [returnFixTipAmount, setReturnFixTipAmount] = useState('');
  const [returnFixDiscountAmount, setReturnFixDiscountAmount] = useState('');
  const [returnFixRemarks, setReturnFixRemarks] = useState('');
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  // Debounced search value sent to the API. The visible input updates instantly
  // while the network request is held back, so typing doesn't fire a request
  // (or the perceived "page refresh") on every keystroke.
  const debouncedSearchTerm = useDebouncedValue(searchTerm, 300);
  const [filterBranch, setFilterBranch] = useState('');
  const [sortConfig, setSortConfig] = useState(null);
  /** Finance approval filter — matches the Approval column and dashboard "verified" (Approved) vs pending */
  const [filterFinanceApproval, setFilterFinanceApproval] = useState('');
  /** YYYY-MM-DD Manila payment-date range (API: payment_date_from / payment_date_to) */
  const [filterIssueDateFrom, setFilterIssueDateFrom] = useState('');
  const [filterIssueDateTo, setFilterIssueDateTo] = useState('');
  // Date-filter mode switcher (Month / Payment date / Issue date).
  // Default mode is "month" pre-loaded with the current Manila month so the
  // page boots with a reasonable, narrow range.
  const [dateFilterMode, setDateFilterMode] = useState(DEFAULT_PAYMENT_LOG_DATE_MODE);
  const [filterIssueMonth, setFilterIssueMonth] = useState(() => defaultPaymentLogFilterMonth());
  const [filterCreatedDateFrom, setFilterCreatedDateFrom] = useState('');
  const [filterCreatedDateTo, setFilterCreatedDateTo] = useState('');
  const [filterPaymentMethod, setFilterPaymentMethod] = useState('');
  const [openBranchDropdown, setOpenBranchDropdown] = useState(false);
  const [openStatusDropdown, setOpenStatusDropdown] = useState(false);
  const [openPaymentMethodDropdown, setOpenPaymentMethodDropdown] = useState(false);
  const [branchDropdownRect, setBranchDropdownRect] = useState(null);
  const [statusDropdownRect, setStatusDropdownRect] = useState(null);
  const [paymentMethodDropdownRect, setPaymentMethodDropdownRect] = useState(null);
  const [branches, setBranches] = useState([]);
  const [showExportModal, setShowExportModal] = useState(false);
  const [selectedExportBranches, setSelectedExportBranches] = useState([]);
  const [exportPaymentDateFrom, setExportPaymentDateFrom] = useState('');
  const [exportPaymentDateTo, setExportPaymentDateTo] = useState('');
  const [exportLoading, setExportLoading] = useState(false);
  const [openApprovalMenuId, setOpenApprovalMenuId] = useState(null);
  const [approvalMenuPosition, setApprovalMenuPosition] = useState({ top: 0, left: 0 });
  const [approvalLoadingId, setApprovalLoadingId] = useState(null);
  const [showReferenceModal, setShowReferenceModal] = useState(false);
  const [selectedPaymentForReference, setSelectedPaymentForReference] = useState(null);
  const [referenceModalInput, setReferenceModalInput] = useState('');
  const [referenceModalUpdating, setReferenceModalUpdating] = useState(false);
  const [showAttachmentViewer, setShowAttachmentViewer] = useState(false);
  const [attachmentViewerUrl, setAttachmentViewerUrl] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  /** Total Returned payments for current filters — Return tab badge */
  const [returnedPaymentLogCount, setReturnedPaymentLogCount] = useState(null);
  const [filterTotalLineAmount, setFilterTotalLineAmount] = useState(null);
  const [listRefreshing, setListRefreshing] = useState(false);
  const initialDataLoadedRef = useRef(false);
  const latestFetchIdRef = useRef(0);

  useEffect(() => {
    fetchPayments(1);
    fetchBranches();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const notificationTab = params.get('notificationTab');
    const financeApproval = params.get('financeApproval');
    if (notificationTab === 'main' || notificationTab === 'return' || notificationTab === 'rejected') {
      setBranchLogTab(notificationTab);
    }
    if (financeApproval === 'approved' || financeApproval === 'pending') {
      setFilterFinanceApproval(financeApproval);
    } else if (financeApproval === 'all' || financeApproval === '') {
      setFilterFinanceApproval('');
    }
    const payFrom = (params.get('payment_date_from') || params.get('issue_date_from') || '').trim().slice(0, 10);
    const payTo = (params.get('payment_date_to') || params.get('issue_date_to') || '').trim().slice(0, 10);
    const hasUrlPayFrom = /^\d{4}-\d{2}-\d{2}$/.test(payFrom);
    const hasUrlPayTo = /^\d{4}-\d{2}-\d{2}$/.test(payTo);
    if (hasUrlPayFrom) {
      setFilterIssueDateFrom(payFrom);
    }
    if (hasUrlPayTo) {
      setFilterIssueDateTo(payTo);
    }
    // Deep-link compatibility: when an explicit date range is supplied via the
    // URL, switch into Payment-date mode so the inputs reflect what filters.
    if (hasUrlPayFrom || hasUrlPayTo) {
      setDateFilterMode(PAYMENT_LOG_DATE_MODES.PAYMENT_DATE);
    }
  }, [location.search]);

  useEffect(() => {
    setFilterBranch(globalBranchId || '');
    setOpenBranchDropdown(false);
    setBranchDropdownRect(null);
  }, [globalBranchId]);

  useEffect(() => {
    if (branchLogTab !== 'main') {
      setOpenStatusDropdown(false);
      setStatusDropdownRect(null);
    }
  }, [branchLogTab]);

  const fetchReturnedPaymentLogCount = async () => {
    try {
      const params = new URLSearchParams({ limit: '1', page: '1' });
      if (filterBranch) params.set('branch_id', filterBranch);
      const dateParams = buildPaymentLogListDateParams({
        logTab: 'return',
        mode: dateFilterMode,
        month: filterIssueMonth,
        paymentFrom: filterIssueDateFrom,
        paymentTo: filterIssueDateTo,
        createdFrom: filterCreatedDateFrom,
        createdTo: filterCreatedDateTo,
      });
      Object.entries(dateParams).forEach(([k, v]) => params.set(k, v));
      params.set('approval_status', 'Returned');
      if (filterPaymentMethod) params.set('payment_method', filterPaymentMethod);
      const response = await apiRequest(`/payments?${params.toString()}`);
      const raw = response.pagination?.total;
      const total = typeof raw === 'number' ? raw : parseInt(raw, 10) || 0;
      setReturnedPaymentLogCount(total);
    } catch (err) {
      console.error('fetchReturnedPaymentLogCount:', err);
      setReturnedPaymentLogCount(0);
    }
  };

  useEffect(() => {
    fetchReturnedPaymentLogCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filterBranch,
    filterPaymentMethod,
    dateFilterMode,
    filterIssueMonth,
    filterIssueDateFrom,
    filterIssueDateTo,
    filterCreatedDateFrom,
    filterCreatedDateTo,
    debouncedSearchTerm,
  ]);

  // Refetch when branch or status filter changes (server-side filter), reset to page 1
  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    fetchPayments(1);
  }, [
    filterBranch,
    filterFinanceApproval,
    branchLogTab,
    filterPaymentMethod,
    dateFilterMode,
    filterIssueMonth,
    filterIssueDateFrom,
    filterIssueDateTo,
    filterCreatedDateFrom,
    filterCreatedDateTo,
    debouncedSearchTerm,
  ]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (openBranchDropdown && !event.target.closest('.branch-filter-dropdown') && !event.target.closest('.branch-filter-dropdown-portal')) {
        setOpenBranchDropdown(false);
        setBranchDropdownRect(null);
      }
      if (openStatusDropdown && !event.target.closest('.status-filter-dropdown') && !event.target.closest('.status-filter-dropdown-portal')) {
        setOpenStatusDropdown(false);
        setStatusDropdownRect(null);
      }
      if (openPaymentMethodDropdown && !event.target.closest('.payment-method-filter-dropdown') && !event.target.closest('.payment-method-filter-dropdown-portal')) {
        setOpenPaymentMethodDropdown(false);
        setPaymentMethodDropdownRect(null);
      }
      if (openApprovalMenuId && !event.target.closest('.payment-status-cell') && !event.target.closest('.payment-status-approval-portal')) {
        setOpenApprovalMenuId(null);
      }
    };

    if (openBranchDropdown || openStatusDropdown || openPaymentMethodDropdown || openApprovalMenuId) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [openBranchDropdown, openStatusDropdown, openPaymentMethodDropdown, openApprovalMenuId]);

  const fetchPayments = async (page = 1) => {
    const fetchId = ++latestFetchIdRef.current;
    try {
      if (!initialDataLoadedRef.current) {
        setLoading(true);
      } else {
        setListRefreshing(true);
      }
      const limit = 10;
      const params = new URLSearchParams({ limit: String(limit), page: String(page) });
      if (filterBranch) params.set('branch_id', filterBranch);
      if (debouncedSearchTerm.trim()) params.set('search', debouncedSearchTerm.trim());
      const dateParams = buildPaymentLogListDateParams({
        logTab: branchLogTab,
        mode: dateFilterMode,
        month: filterIssueMonth,
        paymentFrom: filterIssueDateFrom,
        paymentTo: filterIssueDateTo,
        createdFrom: filterCreatedDateFrom,
        createdTo: filterCreatedDateTo,
      });
      Object.entries(dateParams).forEach(([k, v]) => params.set(k, v));
      const useUnifiedEndpoint = branchLogTab === 'main';
      if (branchLogTab === 'return') {
        params.set('approval_status', 'Returned');
      } else if (branchLogTab === 'rejected') {
        params.set('approval_status', 'Rejected');
      } else if (filterFinanceApproval === 'approved') {
        if (useUnifiedEndpoint) {
          params.set('approval_status', 'Approved');
        } else {
          params.set('status', 'Completed');
          params.set('approval_status', 'Approved');
          params.set('exclude_approval_status', 'Returned,Rejected');
        }
      } else if (filterFinanceApproval === 'pending') {
        if (useUnifiedEndpoint) {
          params.set('pending_only', '1');
        } else {
          params.set('status', 'Completed');
          params.set('exclude_approval_status', 'Approved,Returned,Rejected');
        }
      } else {
        if (useUnifiedEndpoint) {
          params.set('pending_only', '0');
        } else {
          params.set('status', 'Completed');
          params.set('exclude_approval_status', 'Returned,Rejected');
        }
      }
      if (filterPaymentMethod) params.set('payment_method', filterPaymentMethod);
      const endpoint = useUnifiedEndpoint ? '/payments/finance-unified' : '/payments';
      const response = await apiRequest(`${endpoint}?${params.toString()}`);
      if (fetchId !== latestFetchIdRef.current) return;
      setPayments(response.data || []);
      if (response.filterTotalLineAmount != null && response.filterTotalLineAmount !== undefined) {
        setFilterTotalLineAmount(Number(response.filterTotalLineAmount));
      } else {
        setFilterTotalLineAmount(null);
      }
      if (response.pagination) {
        setPagination({
          page: response.pagination.page,
          limit: response.pagination.limit,
          total: response.pagination.total,
          totalPages: response.pagination.totalPages ?? Math.ceil((response.pagination.total || 0) / limit),
        });
      }
      setError('');
    } catch (err) {
      if (fetchId !== latestFetchIdRef.current) return;
      console.error('Error fetching payments:', err);
      setError('Failed to load payments. Please try again.');
      setPayments([]);
      setFilterTotalLineAmount(null);
    } finally {
      if (fetchId !== latestFetchIdRef.current) return;
      setLoading(false);
      setListRefreshing(false);
      initialDataLoadedRef.current = true;
    }
  };

  const fetchBranches = async () => {
    try {
      const response = await apiRequest('/branches');
      setBranches(response.data || []);
    } catch (err) {
      console.error('Error fetching branches:', err);
    }
  };

  const userType = userInfo?.user_type || userInfo?.userType;
  const userBranchId = userInfo?.branch_id ?? userInfo?.branchId;
  const canApprovePayment = (payment) => {
    if (!userType) return false;
    if (userType === 'Superadmin') return true;
    if (userType === 'Finance' && (userBranchId == null || userBranchId === undefined)) return true;
    if (userType === 'Superfinance') return true;
    if (userType === 'Finance' && payment.branch_id === userBranchId) return true;
    return false;
  };

  const handleApprovePayment = async (paymentId, approve) => {
    setApprovalLoadingId(paymentId);
    setOpenApprovalMenuId(null);
    try {
      await apiRequest(`/payments/${paymentId}/approve`, {
        method: 'PUT',
        body: JSON.stringify({ approve }),
      });
      await fetchPayments(pagination.page);
      await fetchReturnedPaymentLogCount();
    } catch (err) {
      setError(err.message || (approve ? 'Failed to approve payment' : 'Failed to revoke approval'));
    } finally {
      setApprovalLoadingId(null);
    }
  };

  const openReferenceModal = (payment) => {
    setSelectedPaymentForReference(payment);
    setReferenceModalInput(''); // Finance must retype the reference number from the image
    setShowReferenceModal(true);
  };

  const closeReferenceModal = () => {
    setShowReferenceModal(false);
    setSelectedPaymentForReference(null);
    setReferenceModalInput('');
  };

  const handleUpdateReferenceNumber = async (e) => {
    e.preventDefault();
    if (!selectedPaymentForReference) return;
    const enteredRef = referenceModalInput.trim();
    const originalRef = (selectedPaymentForReference.reference_number || '').trim();

    // Require both values
    if (!originalRef) {
      appAlert('This payment has no reference number recorded. Please ask the encoder to update it from the Record Payment modal.');
      return;
    }
    if (!enteredRef) {
      appAlert('Please enter the reference number exactly as shown on the receipt image.');
      return;
    }

    // Enforce match between encoded reference and verifier input
    if (enteredRef !== originalRef) {
      appAlert('Reference number does not match the one originally recorded for this payment.\n\nPlease double-check the receipt and coordinate with the encoder before approving.');
      return;
    }

    const paymentId = selectedPaymentForReference.payment_id;
    setReferenceModalUpdating(true);
    try {
      if (isUnappliedArPaymentLogRow(selectedPaymentForReference)) {
        await verifyUnappliedArFromPaymentLog(selectedPaymentForReference);
        closeReferenceModal();
        await fetchPayments(pagination.page);
        await fetchReturnedPaymentLogCount();
        return;
      }

      await apiRequest(`/payments/${paymentId}/approve`, {
        method: 'PUT',
        body: JSON.stringify({ approve: true }),
      });
      setPayments((prev) =>
        prev.map((p) =>
          p.payment_id === paymentId ? { ...p, approval_status: 'Approved' } : p
        )
      );
      closeReferenceModal();
      await fetchPayments(pagination.page);
      await fetchReturnedPaymentLogCount();
    } catch (err) {
      appAlert(err.message || 'Failed to save and approve payment.');
    } finally {
      setReferenceModalUpdating(false);
    }
  };

  const openReturnFixModal = (payment) => {
    setReturnFixPayment(payment);
    setReturnFixRef((payment.reference_number || '').trim());
    setReturnFixAttachment(payment.payment_attachment_url || '');
    setReturnFixPaymentMethod((payment.payment_method || 'Cash').trim() || 'Cash');
    setReturnFixIssueDate((payment.issue_date || '').slice(0, 10));
    setReturnFixPaymentType((payment.payment_type || '').trim() || '');
    const pa = payment.payable_amount;
    setReturnFixPayableAmount(pa != null && pa !== '' ? String(pa) : '');
    const tip = payment.tip_amount;
    setReturnFixTipAmount(tip != null && tip !== '' ? Number(tip).toFixed(2) : '0.00');
    const disc = payment.discount_amount;
    setReturnFixDiscountAmount(disc != null && disc !== '' ? Number(disc).toFixed(2) : '');
    setReturnFixRemarks((payment.remarks || '').trim());
    setReturnFixInvoiceSummary(null);
    setReturnFixInvoiceLoading(true);
    (async () => {
      try {
        const res = await apiRequest(`/invoices/${payment.invoice_id}`);
        setReturnFixInvoiceSummary(res.data || null);
      } catch (err) {
        console.error('Return-fix invoice fetch:', err);
        setReturnFixInvoiceSummary(null);
        appAlert(err.message || 'Could not load invoice details for the summary.');
      } finally {
        setReturnFixInvoiceLoading(false);
      }
    })();
  };

  const closeReturnFixModal = () => {
    setReturnFixPayment(null);
    setReturnFixRef('');
    setReturnFixAttachment('');
    setReturnFixPaymentMethod('Cash');
    setReturnFixIssueDate('');
    setReturnFixAttachmentUploading(false);
    setReturnFixInvoiceSummary(null);
    setReturnFixInvoiceLoading(false);
    setReturnFixPaymentType('');
    setReturnFixPayableAmount('');
    setReturnFixTipAmount('');
    setReturnFixDiscountAmount('');
    setReturnFixRemarks('');
  };

  /** Max toward invoice this payment line can represent (current outstanding + this line's payable) */
  const getReturnFixReleaseCap = () => {
    if (!returnFixInvoiceSummary || !returnFixPayment) return null;
    const b = getInvoiceBreakdownForReturnFix(returnFixInvoiceSummary);
    const linePayable = parseFloat(returnFixPayment.payable_amount) || 0;
    const lineDisc = parseFloat(returnFixPayment.discount_amount || 0) || 0;
    return Math.max(0, b.remaining + linePayable + lineDisc);
  };

  const handleReturnFixInputChange = (e) => {
    const { name, value } = e.target;
    const inv = returnFixInvoiceSummary;
    const payment = returnFixPayment;
    const releaseCap = inv && payment ? getReturnFixReleaseCap() : null;
    const discountNum =
      returnFixDiscountAmount === '' ? 0 : Math.max(0, parseFloat(returnFixDiscountAmount) || 0);

    if (name === 'payment_type') {
      if (value === 'Full Payment' && releaseCap != null && releaseCap > 0) {
        setReturnFixPaymentType(value);
        const disc =
          returnFixDiscountAmount === '' ? 0 : Math.max(0, parseFloat(returnFixDiscountAmount) || 0);
        setReturnFixPayableAmount(Math.max(0.01, releaseCap - disc).toFixed(2));
        return;
      }
      if (value === 'Partial Payment' && releaseCap != null && releaseCap > 0) {
        const currentAmount = parseFloat(returnFixPayableAmount || 0);
        if (currentAmount >= releaseCap) {
          setReturnFixPaymentType(value);
          setReturnFixPayableAmount('');
          return;
        }
      }
      setReturnFixPaymentType(value);
      return;
    }

    if (name === 'payable_amount') {
      if (
        returnFixPaymentType === 'Partial Payment' &&
        releaseCap != null &&
        releaseCap > 0 &&
        Number(value) + discountNum >= releaseCap
      ) {
        return;
      }
      setReturnFixPayableAmount(value);
      return;
    }

    if (name === 'tip_amount') {
      setReturnFixTipAmount(value);
      return;
    }

    if (name === 'discount_amount') {
      const nextDisc = value === '' ? 0 : Math.max(0, parseFloat(value) || 0);
      const payableVal = parseFloat(returnFixPayableAmount || 0) || 0;
      if (
        returnFixPaymentType === 'Partial Payment' &&
        releaseCap != null &&
        releaseCap > 0 &&
        payableVal + nextDisc >= releaseCap
      ) {
        return;
      }
      setReturnFixDiscountAmount(value);
      return;
    }

    if (name === 'remarks') {
      setReturnFixRemarks(value);
    }
  };

  useEffect(() => {
    if (!returnFixInvoiceSummary || !returnFixPayment) return;
    if (returnFixPaymentType !== 'Full Payment') return;
    const b = getInvoiceBreakdownForReturnFix(returnFixInvoiceSummary);
    const linePayable = parseFloat(returnFixPayment.payable_amount) || 0;
    const lineDisc = parseFloat(returnFixPayment.discount_amount || 0) || 0;
    const cap = Math.max(0, b.remaining + linePayable + lineDisc);
    const disc =
      returnFixDiscountAmount === '' ? 0 : Math.max(0, parseFloat(returnFixDiscountAmount) || 0);
    if (cap > 0) {
      const nextPayable = Math.max(0.01, cap - disc);
      setReturnFixPayableAmount(nextPayable.toFixed(2));
    }
  }, [
    returnFixInvoiceSummary,
    returnFixPayment,
    returnFixPaymentType,
    returnFixDiscountAmount,
  ]);

  const handleReturnFixAttachmentChange = async (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.type)) {
      appAlert('Please select an image (JPEG, PNG, WebP, or GIF).');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      appAlert('Image must be 50MB or less.');
      return;
    }
    setReturnFixAttachmentUploading(true);
    try {
      const imageUrl = await uploadInvoicePaymentImage(file);
      setReturnFixAttachment(imageUrl);
    } catch (err) {
      console.error('Return-fix attachment upload:', err);
      appAlert(err.message || 'Failed to upload image. Please try again.');
    } finally {
      setReturnFixAttachmentUploading(false);
      e.target.value = '';
    }
  };

  const clearReturnFixAttachment = () => {
    setReturnFixAttachment('');
  };

  const submitReturnFix = async (e) => {
    e?.preventDefault();
    if (!returnFixPayment) return;
    setReturnFixLoading(true);
    try {
      const remarksHadReturned = String(returnFixPayment.remarks || '').includes('[Returned]');
      const refTrim = returnFixRef.trim();
      const attTrim = returnFixAttachment.trim();
      const issueDateTrim = String(returnFixIssueDate || '').trim();
      if (!issueDateTrim) {
        appAlert('Please select the correct payment date before resubmitting.');
        return;
      }
      if (remarksHadReturned) {
        const nextRemarks = String(returnFixRemarks || '');
        if (!nextRemarks.includes('[Returned]')) {
          appAlert('Remarks must keep the Finance return marker ([Returned]).');
          return;
        }
      }
      if (!String(returnFixPaymentType || '').trim()) {
        appAlert('Please select a payment type.');
        return;
      }
      const payableNum = parseFloat(returnFixPayableAmount);
      if (!returnFixPayableAmount || Number.isNaN(payableNum) || payableNum <= 0) {
        appAlert('Payable amount must be greater than 0.');
        return;
      }
      const tipNum = returnFixTipAmount === '' ? 0 : parseFloat(returnFixTipAmount);
      if (Number.isNaN(tipNum) || tipNum < 0) {
        appAlert('Tip amount must be 0 or greater.');
        return;
      }
      const discountNum = returnFixDiscountAmount === '' ? 0 : parseFloat(returnFixDiscountAmount);
      if (returnFixDiscountAmount !== '' && (Number.isNaN(discountNum) || discountNum < 0)) {
        appAlert('Discount amount must be 0 or greater.');
        return;
      }
      if (returnFixDiscountAmount !== '' && discountNum >= payableNum) {
        appAlert('Discount amount must be less than payable amount.');
        return;
      }
      if (!refTrim) {
        appAlert('Reference number is required.');
        return;
      }
      if (!attTrim) {
        appAlert('Please keep or upload a proof-of-payment image.');
        return;
      }
      if (returnFixPaymentType === 'Partial Payment') {
        if (!returnFixInvoiceSummary) {
          appAlert(
            returnFixInvoiceLoading
              ? 'Please wait for the invoice summary to finish loading.'
              : 'Invoice details are required to validate a partial payment. Close and reopen this modal, then try again.'
          );
          return;
        }
        const b = getInvoiceBreakdownForReturnFix(returnFixInvoiceSummary);
        const linePayable = parseFloat(returnFixPayment.payable_amount) || 0;
        const lineDisc = parseFloat(returnFixPayment.discount_amount || 0) || 0;
        const releaseCap = Math.max(0, b.remaining + linePayable + lineDisc);
        if (releaseCap > 0 && payableNum + discountNum >= releaseCap) {
          appAlert(
            'For partial payment, combined payable and discount must be less than the remaining invoice amount for this line.'
          );
          return;
        }
      }
      const payload = {
        reference_number: refTrim,
        attachment_url: attTrim,
        payment_method: returnFixPaymentMethod.trim() || undefined,
        payment_type: returnFixPaymentType.trim(),
        payable_amount: payableNum,
        tip_amount: tipNum,
        discount_amount: discountNum,
        issue_date: issueDateTrim,
      };
      if (returnFixRemarks.trim()) {
        payload.remarks = returnFixRemarks.trim();
      }
      await apiRequest(`/payments/${returnFixPayment.payment_id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      await apiRequest(`/payments/${returnFixPayment.payment_id}/resubmit-for-verification`, {
        method: 'PUT',
      });
      appAlert('Payment updated and sent back to Finance for verification.');
      closeReturnFixModal();
      await fetchPayments(pagination.page);
      await fetchReturnedPaymentLogCount();
    } catch (err) {
      appAlert(err.message || 'Failed to update and resubmit.');
    } finally {
      setReturnFixLoading(false);
    }
  };

  const getBranchName = (branchId) => {
    if (!branchId) return null;
    const branch = branches.find((b) => b.branch_id === branchId);
    if (!branch) return 'N/A';
    return branch.branch_nickname || branch.branch_name || 'N/A';
  };

  const formatBranchName = (branchName) => {
    if (!branchName) return null;

    if (branchName.includes(' - ')) {
      const parts = branchName.split(' - ');
      return {
        company: parts[0].trim(),
        location: parts.slice(1).join(' - ').trim(),
      };
    }

    if (branchName.includes('-')) {
      const parts = branchName.split('-');
      return {
        company: parts[0].trim(),
        location: parts.slice(1).join('-').trim(),
      };
    }

    return {
      company: branchName,
      location: '',
    };
  };

  const formatDate = (dateString) => formatDateManila(dateString) || '-';

  const formatCurrency = (amount) => {
    if (!amount) return '₱0.00';
    return `₱${parseFloat(amount).toFixed(2)}`;
  };

  const formatInvoiceIssuedBy = (payment) => {
    const name = (payment.invoice_issued_by_name || '').trim();
    const email = (payment.invoice_issued_by_email || '').trim();
    if (name) return name;
    if (email) return email;
    const recorderName = (payment.payment_created_by_name || '').trim();
    const recorderEmail = (payment.payment_created_by_email || '').trim();
    if (recorderName) return recorderName;
    if (recorderEmail) return recorderEmail;
    if (payment?.created_by) return `User #${payment.created_by}`;
    if (!payment?.student_id) return 'Walk-in / Acknowledgement Receipt';
    return 'System';
  };

  const getStatusBadge = (status) => {
    const statusColors = {
      'Completed': 'bg-green-100 text-green-800',
      'Pending': 'bg-yellow-100 text-yellow-800',
      'Failed': 'bg-red-100 text-red-800',
      'Cancelled': 'bg-gray-100 text-gray-800',
    };
    const colorClass = statusColors[status] || 'bg-gray-100 text-gray-800';
    return (
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
        {status || 'N/A'}
      </span>
    );
  };

  const getPaymentMethodBadge = (method) => {
    const methodColors = {
      'Cash': 'bg-blue-100 text-blue-800',
      'Online Banking': 'bg-pink-100 text-pink-800',
      'Credit Card': 'bg-purple-100 text-purple-800',
      'E-wallets': 'bg-indigo-100 text-indigo-800',
      'Debit Card': 'bg-indigo-100 text-indigo-800',
      'Bank Transfer': 'bg-teal-100 text-teal-800',
      'Check': 'bg-orange-100 text-orange-800',
      'Online Payment': 'bg-pink-100 text-pink-800',
      'Other': 'bg-gray-100 text-gray-800',
    };
    const colorClass = methodColors[method] || 'bg-gray-100 text-gray-800';
    return (
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
        {method || 'N/A'}
      </span>
    );
  };

  const getUniquePaymentMethods = () => {
    const methods = [...new Set(payments.map(p => p.payment_method).filter(Boolean))];
    return methods.sort();
  };

  const filteredPayments = payments.filter((payment) => {
    const matchesBranch = !filterBranch || payment.branch_id?.toString() === filterBranch;
    const matchesFinanceApproval =
      branchLogTab === 'return' ||
      branchLogTab === 'rejected' ||
      !filterFinanceApproval ||
      (filterFinanceApproval === 'approved' &&
        (payment.approval_status || 'Pending') === 'Approved') ||
      (filterFinanceApproval === 'pending' &&
        (payment.approval_status || 'Pending') !== 'Approved');
    return matchesBranch && matchesFinanceApproval;
  });
  const sortedPayments = sortRows(
    filteredPayments,
    sortConfig,
    buildPaymentLogsTableSortAccessors({
      branchAccessor: (payment) => getBranchName(payment.branch_id) || payment.branch_name || '',
      issuedByAccessor: formatInvoiceIssuedBy,
      logTab: branchLogTab,
    })
  );

  const summaryLineTotal = useMemo(() => {
    const line = (p) => (parseFloat(p.payable_amount) || 0) + (parseFloat(p.tip_amount) || 0);
    if (filterTotalLineAmount != null && !Number.isNaN(Number(filterTotalLineAmount))) {
      return Number(filterTotalLineAmount);
    }
    return filteredPayments.reduce((s, p) => s + line(p), 0);
  }, [filteredPayments, filterTotalLineAmount]);

  const summaryPaymentLogCount = Number(pagination.total) || 0;

  const handleSort = (key) => {
    setSortConfig((current) => toggleSortConfig(current, key));
  };

  const exportPaymentDateRangeInvalid =
    Boolean(exportPaymentDateFrom && exportPaymentDateTo) && exportPaymentDateFrom > exportPaymentDateTo;

  const handleExportClick = () => {
    // Seed export modal with the resolved payment-date range of the active
    // mode. Created-date mode resolves to empty payment-date params here on
    // purpose — export only filters on payment date.
    const seedDateParams = buildPaymentLogDateParams({
      mode: dateFilterMode,
      month: filterIssueMonth,
      paymentFrom: filterIssueDateFrom,
      paymentTo: filterIssueDateTo,
      createdFrom: filterCreatedDateFrom,
      createdTo: filterCreatedDateTo,
    });
    setExportPaymentDateFrom(seedDateParams.payment_date_from || '');
    setExportPaymentDateTo(seedDateParams.payment_date_to || '');
    setSelectedExportBranches([]);
    setShowExportModal(true);
  };

  const handleExportBranchToggle = (branchId) => {
    setSelectedExportBranches(prev => {
      if (prev.includes(branchId)) {
        return prev.filter(id => id !== branchId);
      } else {
        return [...prev, branchId];
      }
    });
  };

  const handleSelectAllBranches = () => {
    if (selectedExportBranches.length === branches.length) {
      setSelectedExportBranches([]);
    } else {
      setSelectedExportBranches(branches.map(b => b.branch_id));
    }
  };

  const handleExportToExcel = async () => {
    if (selectedExportBranches.length === 0) return;
    if (exportPaymentDateRangeInvalid) {
      appAlert('"From" date must be on or before "To" date.');
      return;
    }
    if (branchLogTab === 'return' || branchLogTab === 'rejected') {
      appAlert('Returned and rejected payments are not included in exports. Please switch to the main tab to export.');
      return;
    }
    try {
      setExportLoading(true);
      
      // Fetch all payments for selected branches (paginate: backend limit max 100)
      let allPayments = [];
      const limit = 100;
      
      const fetchPage = async (branchId, page = 1) => {
        const params = new URLSearchParams({
          limit: String(limit),
          page: String(page),
        });
        if (branchId) params.set('branch_id', String(branchId));
        if (exportPaymentDateFrom) params.set('payment_date_from', exportPaymentDateFrom);
        if (exportPaymentDateTo) params.set('payment_date_to', exportPaymentDateTo);
        // Always exclude payments returned/rejected by Finance.
        params.set('exclude_approval_status', 'Returned,Rejected');
        if (filterFinanceApproval === 'approved') {
          params.set('status', 'Completed');
          params.set('approval_status', 'Approved');
        } else if (filterFinanceApproval === 'pending') {
          params.set('status', 'Completed');
          params.set('exclude_approval_status', 'Approved,Returned,Rejected'); // keep existing behavior
        } else {
          params.set('status', 'Completed');
        }
        return apiRequest(`/payments?${params.toString()}`);
      };

      const fetchAllForBranch = async (branchId) => {
        const result = [];
        let page = 1;
        let hasMore = true;
        while (hasMore) {
          const res = await fetchPage(branchId, page);
          const data = res.data || [];
          result.push(...data);
          const total = res.pagination?.total ?? 0;
          hasMore = result.length < total;
          page += 1;
        }
        return result;
      };

      const promises = selectedExportBranches.map(bid => fetchAllForBranch(bid));
      const results = await Promise.all(promises);
      allPayments = results.flat();

      if (allPayments.length === 0) {
        appAlert('No payment records found to export.');
        setExportLoading(false);
        return;
      }

      // Prepare data for Excel
      const excelData = allPayments.map((payment) => {
        const uiStatus =
          branchLogTab === 'return' || branchLogTab === 'rejected'
            ? (payment.approval_status || payment.status || (branchLogTab === 'rejected' ? 'Rejected' : 'Returned'))
            : ((payment.approval_status || 'Pending') === 'Approved' ? 'Approved' : 'Pending Approval');
        const row = {
          'Invoice ID': payment.invoice_id ? `INV-${payment.invoice_id}` : '-',
          BRANCH: getBranchName(payment.branch_id) || payment.branch_name || 'N/A',
          'Issue Date': payment.issue_date ? formatDate(payment.issue_date) : '-',
          'Payment Date': payment.payment_date ? formatDate(payment.payment_date) : '-',
          'Student Name': payment.student_name || 'N/A',
          'PACKAGE/ITEM': getPaymentLogPackageItemDisplayText(payment),
          'LEVEL TAG': payment.student_level_tag || '-',
          'PAYMENT METHOD': payment.payment_method || '-',
          AMOUNT: Math.round(getPaymentLogTableAmountColumn(payment) * 100) / 100,
          'TOTAL AMOUNT': Math.round(getPaymentLogTableTotalAmountColumn(payment) * 100) / 100,
          Status: uiStatus,
        };
        if (branchLogTab === 'return') {
          row['Returned by'] = payment.returned_by_name || '—';
        } else if (branchLogTab === 'rejected') {
          row['Rejected by'] = payment.rejected_by_name || '—';
        }
        row['REFERENCE#'] = payment.reference_number || '-';
        row['Acknowledgement Receipt#'] = payment.invoice_ar_number || '—';
        row['ISSUED BY'] = formatInvoiceIssuedBy(payment);
        return row;
      });

      // Create workbook and worksheet
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(excelData);
      appendPaymentLogsAmountTotalRow(ws, excelData);

      // Set column widths
      // Match Payment Logs table column order
      const widthList = [
        12, // Invoice ID
        22, // Branch
        12, // Issue date
        12, // Payment date
        24, // Student Name
        28, // Package/Item
        14, // Level tag
        16, // Payment method
        14, // Amount
        16, // Total amount
        16, // Status
      ];
      if (branchLogTab === 'return') widthList.push(18); // Returned by
      if (branchLogTab === 'rejected') widthList.push(18); // Rejected by
      widthList.push(
        22, // Reference#
        24, // Acknowledgement Receipt#
        22 // Issued by
      );
      ws['!cols'] = widthList.map((wch) => ({ wch }));

      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(wb, ws, 'Payment Logs');

      // Generate filename
      const branchName = selectedExportBranches.length === 1
        ? (() => { const b = branches.find(b => b.branch_id === selectedExportBranches[0]); return (b?.branch_nickname || b?.branch_name || '').replace(/[^a-zA-Z0-9]/g, '_') || 'Selected_Branch'; })()
        : 'Selected_Branches';
      const date = new Date().toISOString().split('T')[0];
      const filename = `Payment_Logs_${branchName}_${date}.xlsx`;

      // Save file
      XLSX.writeFile(wb, filename);

      setShowExportModal(false);
      setExportLoading(false);
    } catch (error) {
      console.error('Export error:', error);
      appAlert('Failed to export payment logs. Please try again.');
      setExportLoading(false);
    }
  };


  if (loading && !initialDataLoadedRef.current) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Payment Logs</h1>
          <p className="mt-1 text-sm text-gray-600 max-w-2xl">
            View and manage all payment records. Use the <span className="font-medium text-gray-800">Return</span> tab for
            items Finance sent back when the reference did not match the attachment — update details, then resubmit for
            verification.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExportClick}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 16V4m0 12l-4-4m4 4l4-4M4 20h16" />
          </svg>
          Export to Excel
        </button>
      </div>

      <div className="w-full">
        <BranchPaymentLogTabs
          value={branchLogTab}
          onChange={setBranchLogTab}
          returnBadgeCount={returnedPaymentLogCount}
          showRejected
        />
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">Search Filter</p>
            <p className="text-xs text-gray-500">
              Filter payment logs before the table. Branch scope follows the global branch selector.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <label htmlFor="payment-log-search" className="mb-1 block text-xs font-medium text-gray-700">
              Search
            </label>
            <input
              id="payment-log-search"
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Invoice, student, reference, AR..."
              title="Invoice, student, reference, acknowledgement receipt, or issued by"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
          <div>
            <label htmlFor="payment-method-filter" className="mb-1 block text-xs font-medium text-gray-700">
              Payment Method
            </label>
            <select
              id="payment-method-filter"
              value={filterPaymentMethod}
              onChange={(e) => setFilterPaymentMethod(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              <option value="">All methods</option>
              {getUniquePaymentMethods().map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="payment-status-filter" className="mb-1 block text-xs font-medium text-gray-700">
              Status
            </label>
            {branchLogTab !== 'main' ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                {branchLogTab === 'rejected' ? 'Rejected only' : 'Returned only'}
              </div>
            ) : (
              <select
                id="payment-status-filter"
                value={filterFinanceApproval}
                onChange={(e) => setFilterFinanceApproval(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                <option value="">All statuses</option>
                <option value="approved">Approved</option>
                <option value="pending">Pending Approval</option>
              </select>
            )}
          </div>
          {/*
            Date filter cell — column 4 (aligned next to Status).
            Mode tabs render at the top; the conditional input(s) render
            directly underneath in the same column. See
            utils/paymentLogDateFilters.js for mode → API param mapping.
          */}
          <div className="space-y-2">
            <span className="mb-1 block text-xs font-medium text-gray-700">Date filter</span>
            <div
              role="tablist"
              aria-label="Date filter mode"
              className="inline-flex flex-wrap rounded-lg border border-gray-300 bg-gray-50 p-0.5"
            >
              {Object.values(PAYMENT_LOG_DATE_MODES).map((modeKey) => {
                const active = dateFilterMode === modeKey;
                return (
                  <button
                    key={modeKey}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setDateFilterMode(modeKey)}
                    className={
                      'rounded-md px-2.5 py-1 text-xs font-medium transition-colors ' +
                      (active
                        ? 'bg-white text-primary-700 shadow-sm ring-1 ring-primary-200'
                        : 'text-gray-600 hover:text-gray-900')
                    }
                  >
                    {PAYMENT_LOG_DATE_MODE_LABELS[modeKey]}
                  </button>
                );
              })}
            </div>

            {dateFilterMode === PAYMENT_LOG_DATE_MODES.MONTH ? (
              <input
                id="superadmin-payment-month"
                type="month"
                aria-label="Month"
                value={filterIssueMonth}
                onChange={(e) => setFilterIssueMonth(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            ) : null}

            {dateFilterMode === PAYMENT_LOG_DATE_MODES.PAYMENT_DATE ? (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label
                    htmlFor="payment-date-from"
                    className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500"
                  >
                    From
                  </label>
                  <input
                    id="payment-date-from"
                    type="date"
                    title="Payment date from"
                    value={filterIssueDateFrom}
                    onChange={(e) => setFilterIssueDateFrom(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label
                    htmlFor="payment-date-to"
                    className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500"
                  >
                    To
                  </label>
                  <input
                    id="payment-date-to"
                    type="date"
                    title="Payment date to"
                    value={filterIssueDateTo}
                    onChange={(e) => setFilterIssueDateTo(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
              </div>
            ) : null}

            {dateFilterMode === PAYMENT_LOG_DATE_MODES.CREATED_DATE ? (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label
                    htmlFor="superadmin-created-date-from"
                    className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500"
                  >
                    From
                  </label>
                  <input
                    id="superadmin-created-date-from"
                    type="date"
                    title="Issue Date from"
                    value={filterCreatedDateFrom}
                    onChange={(e) => setFilterCreatedDateFrom(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label
                    htmlFor="superadmin-created-date-to"
                    className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500"
                  >
                    To
                  </label>
                  <input
                    id="superadmin-created-date-to"
                    type="date"
                    title="Issue Date to"
                    value={filterCreatedDateTo}
                    onChange={(e) => setFilterCreatedDateTo(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>
        <div className="mt-4 border-t border-gray-100 pt-4">
          <p className="text-xs text-gray-500">
            {branchLogTab === 'rejected' || branchLogTab === 'return'
              ? 'Returned and Rejected tabs list all matching audit rows (no month filter). Use search or branch to narrow results.'
              : dateFilterMode === PAYMENT_LOG_DATE_MODES.MONTH
              ? 'Month filter uses payment issue date (paymenttbl.issue_date), same field as the Superadmin Financial Dashboard month scope. Clear the month to show all dates.'
              : dateFilterMode === PAYMENT_LOG_DATE_MODES.PAYMENT_DATE
              ? 'Date range is inclusive on payment date. Leave both dates empty for all dates.'
              : 'Date range is inclusive on the payment issue date (same as the Issue Date column). Leave both empty for all dates.'}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-700">
        <span>
          <span className="font-semibold text-gray-900">Total Payment Logs:</span>{' '}
          <span className="font-medium text-gray-900">{summaryPaymentLogCount.toLocaleString('en-US')}</span>
        </span>
        <span className="text-gray-300">·</span>
        <span>
          <span className="font-semibold text-gray-900">Total amount:</span>{' '}
          <span className="font-semibold text-emerald-700">
            ₱{summaryLineTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </span>
      </div>

      {/* Error Message */}
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Payment Logs List */}
      <div className="relative bg-white rounded-lg shadow">
        {listRefreshing ? (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/60 backdrop-blur-[1px]"
            aria-busy="true"
            aria-label="Refreshing payment list"
          >
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
          </div>
        ) : null}
          {pagination.total > 0 && (
            <TablePaginationSummary
              page={pagination.page}
              totalItems={pagination.total}
              itemsPerPage={10}
              itemLabel="payments"
              className="px-4 pt-4 pb-2"
            />
          )}
          <div
            className="overflow-x-auto rounded-lg"
            style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}
          >
            <table className="divide-y divide-gray-200 w-full" style={{ tableLayout: 'fixed', minWidth: '1820px' }}>
              {branchLogTab !== 'main' ? (
                <colgroup>
                  <col style={{ width: '120px' }} />
                  <col style={{ width: '150px' }} />
                  <col style={{ width: '115px' }} />
                  <col style={{ width: '115px' }} />
                  <col style={{ width: '200px' }} />
                  <col style={{ width: '180px' }} />
                  <col style={{ width: '130px' }} />
                  <col style={{ width: '145px' }} />
                  <col style={{ width: '120px' }} />
                  <col style={{ width: '130px' }} />
                  <col style={{ width: '170px' }} />
                  <col style={{ width: '145px' }} />
                  <col style={{ width: '160px' }} />
                  <col style={{ width: '150px' }} />
                  <col style={{ width: '170px' }} />
                </colgroup>
              ) : (
                <colgroup>
                  <col style={{ width: '120px' }} />
                  <col style={{ width: '150px' }} />
                  <col style={{ width: '115px' }} />
                  <col style={{ width: '115px' }} />
                  <col style={{ width: '200px' }} />
                  <col style={{ width: '180px' }} />
                  <col style={{ width: '130px' }} />
                  <col style={{ width: '145px' }} />
                  <col style={{ width: '120px' }} />
                  <col style={{ width: '130px' }} />
                  <col style={{ width: '170px' }} />
                  <col style={{ width: '160px' }} />
                  <col style={{ width: '150px' }} />
                  <col style={{ width: '170px' }} />
                </colgroup>
              )}
              <thead className="bg-gray-50 table-header-stable">
                <tr>
                  <SortableHeader label="Invoice" sortKey="invoice" sortConfig={sortConfig} onSort={handleSort} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[11%]" />
                  <SortableHeader label="Branch" sortKey="branch" sortConfig={sortConfig} onSort={handleSort} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[11%]" />
                  <SortableHeader label="Issue Date" sortKey="issue_date" sortConfig={sortConfig} onSort={handleSort} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" />
                  <SortableHeader label="Payment Date" sortKey="payment_date" sortConfig={sortConfig} onSort={handleSort} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" />
                  <SortableHeader label="Student Name" sortKey="student_name" sortConfig={sortConfig} onSort={handleSort} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[13%]" />
                  <SortableHeader sortKey="package_item" sortConfig={sortConfig} onSort={handleSort} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <span className="leading-tight">package/<br />item</span>
                  </SortableHeader>
                  <SortableHeader label="Level Tag" sortKey="level_tag" sortConfig={sortConfig} onSort={handleSort} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" />
                  <SortableHeader label="Payment Method" sortKey="payment_method" sortConfig={sortConfig} onSort={handleSort} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[9%]" />
                  <SortableHeader label="AMOUNT" sortKey="amount" sortConfig={sortConfig} onSort={handleSort} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[8%]" />
                  <SortableHeader label="TOTAL AMOUNT" sortKey="total_amount" sortConfig={sortConfig} onSort={handleSort} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[8%]" />
                  <SortableHeader label={branchLogTab === 'return' ? 'Return Status' : branchLogTab === 'rejected' ? 'Rejected Status' : 'Status'} sortKey="status" sortConfig={sortConfig} onSort={handleSort} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[14%]" />
                  {branchLogTab !== 'main' ? (
                    <SortableHeader
                      label={branchLogTab === 'rejected' ? 'Rejected by' : 'Returned by'}
                      sortKey="returned_by"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                      className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    />
                  ) : null}
                  <SortableHeader label="REFERENCE" sortKey="reference" sortConfig={sortConfig} onSort={handleSort} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[11%]" />
                  <SortableHeader sortKey="ack_receipt" sortConfig={sortConfig} onSort={handleSort} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <span className="block">Acknowledgement</span>
                    <span className="block">Receipt#</span>
                  </SortableHeader>
                  <SortableHeader label="Issued By" sortKey="issued_by" sortConfig={sortConfig} onSort={handleSort} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" />
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredPayments.length === 0 ? (
                  <tr>
                    <td colSpan={branchLogTab !== 'main' ? 15 : 14} className="px-6 py-12 text-center">
                      <p className="text-gray-500">
                        {searchTerm || filterBranch || filterFinanceApproval || filterPaymentMethod
                          ? 'No matching payments. Try adjusting your search or filters.'
                          : 'No payment records yet.'}
                      </p>
                    </td>
                  </tr>
                ) : (
                sortedPayments.map((payment) => (
                  <tr key={payment.payment_id} className="hover:bg-gray-50/80">
                    <td className="px-3 py-2.5 whitespace-nowrap text-sm font-semibold text-gray-900 min-w-0">
                      {payment.invoice_id ? `INV-${payment.invoice_id}` : '-'}
                    </td>
                    <td className="px-3 py-2.5 text-sm text-gray-900 align-top min-w-0">
                      {(() => {
                        const branchName = getBranchName(payment.branch_id) || payment.branch_name || 'N/A';
                        if (!branchName || branchName === 'N/A') {
                          return <span className="text-gray-400">-</span>;
                        }
                        const formatted = formatBranchName(branchName);
                        const fullText = formatted.location ? `${formatted.company} - ${formatted.location}` : formatted.company;
                        return (
                          <div className="flex flex-col leading-tight min-w-0">
                            <span className="font-medium truncate" title={fullText}>{formatted.company}</span>
                            {formatted.location && (
                              <span className="text-xs text-gray-500 truncate" title={formatted.location}>{formatted.location}</span>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-sm text-gray-500 min-w-0">
                      {payment.issue_date ? formatDate(payment.issue_date) : '-'}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-sm text-gray-500 min-w-0">
                      {payment.payment_date ? formatDate(payment.payment_date) : '-'}
                    </td>
                    <td className="px-3 py-2.5 text-sm text-gray-900 min-w-0">
                      <div className="flex flex-col min-w-0">
                        <span className="font-medium truncate" title={payment.student_name || 'N/A'}>{payment.student_name || 'N/A'}</span>
                        {payment.student_email && (
                          <span className="text-xs text-gray-500 truncate" title={payment.student_email}>{payment.student_email}</span>
                        )}
                      </div>
                    </td>
                    <PaymentLogPackageItemCell payment={payment} />
                    <td className="px-3 py-2.5 text-sm text-gray-700 min-w-0">
                      <span className="truncate block" title={payment.student_level_tag || '-'}>
                        {payment.student_level_tag || '-'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-sm min-w-0">
                      {getPaymentMethodBadge(payment.payment_method)}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-sm font-semibold text-green-600 min-w-0">
                      {formatCurrency(getPaymentLogTableAmountColumn(payment))}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-sm font-semibold text-emerald-700 min-w-0">
                      {formatCurrency(getPaymentLogTableTotalAmountColumn(payment))}
                    </td>
                    <td className="px-3 py-2.5 text-sm payment-status-cell align-top min-w-0 overflow-hidden">
                      <div className="min-w-0 max-w-full">
                        {branchLogTab === 'return' ? (
                          <div className="space-y-1">
                            <button
                              type="button"
                              onClick={() => openReturnFixModal(payment)}
                              className="text-xs font-semibold text-primary-700 hover:text-primary-900 underline"
                            >
                              Update reference and resubmit
                            </button>
                          </div>
                        ) : branchLogTab === 'rejected' ? (
                          <div className="space-y-1">
                            <span className="inline-flex rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-800">
                              Rejected
                            </span>
                            <button
                              type="button"
                              onClick={() => setSelectedRejectedPayment(payment)}
                              className="block text-xs font-semibold text-primary-700 hover:text-primary-900 underline"
                            >
                              View details
                            </button>
                          </div>
                        ) : approvalLoadingId === payment.payment_id ? (
                          <span className="text-gray-400 text-xs">Updating...</span>
                        ) : (() => {
                          const isUnappliedAr = payment.source_type === 'UNAPPLIED_AR';
                          const isApproved = (payment.approval_status || 'Pending') === 'Approved';
                          const canApprove = canApprovePayment(payment);
                          const showDropdown = openApprovalMenuId === payment.payment_id;
                          if (isUnappliedAr) {
                            return (
                              <UnappliedArPaymentLogStatus
                                payment={payment}
                                canApprove={canApprove}
                                onPendingClick={openReferenceModal}
                                isLoading={approvalLoadingId === payment.payment_id}
                              />
                            );
                          }
                          return (
                            <div className="relative min-w-0 max-w-full">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isApproved) {
                                    if (!canApprove) return;
                                    if (showDropdown) {
                                      setOpenApprovalMenuId(null);
                                    } else {
                                      const rect = e.currentTarget.getBoundingClientRect();
                                      setApprovalMenuPosition({ top: rect.bottom + 4, left: rect.left });
                                      setOpenApprovalMenuId(payment.payment_id);
                                    }
                                  } else {
                                    openReferenceModal(payment);
                                  }
                                }}
                                className={`inline-flex items-center gap-1 max-w-full px-2 py-1 rounded-md text-xs font-medium cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1 shrink-0 ${
                                  isApproved ? (canApprove ? 'hover:ring-2 hover:ring-primary-300' : 'cursor-default') : 'hover:ring-2 hover:ring-primary-300'
                                } ${isApproved ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}
                                title={isApproved ? (canApprove ? 'Click to change approval' : 'No permission') : 'Click to update reference number'}
                              >
                                <span className="truncate">{isApproved ? 'Approved' : 'Pending Approval'}</span>
                                {(isApproved ? canApprove : true) && (
                                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                )}
                              </button>
                              {isApproved && payment.approved_by_name && (
                                <div className="text-xs text-gray-500 mt-0.5 truncate" title={payment.approved_at ? `Approved at ${payment.approved_at}` : ''}>
                                  by <span className="truncate inline-block max-w-[100px] align-bottom" title={payment.approved_by_name}>{payment.approved_by_name}</span>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </td>
                    {branchLogTab !== 'main' ? (
                      <td className="px-3 py-2.5 text-sm text-gray-800 align-top min-w-0">
                        <span className="truncate block" title={(branchLogTab === 'rejected' ? payment.rejected_by_name : payment.returned_by_name) || ''}>
                          {(branchLogTab === 'rejected' ? payment.rejected_by_name : payment.returned_by_name) || '—'}
                        </span>
                      </td>
                    ) : null}
                    <td className="px-3 py-2.5 text-sm text-gray-500 min-w-0">
                      <span className="truncate block" title={payment.reference_number || '-'}>{payment.reference_number || '-'}</span>
                    </td>
                    <td className="px-3 py-2.5 text-sm text-gray-600 min-w-0">
                      <span className="truncate block" title={payment.invoice_ar_number || ''}>
                        {payment.invoice_ar_number || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-sm text-gray-800 min-w-0">
                      <span className="truncate block" title={formatInvoiceIssuedBy(payment)}>
                        {formatInvoiceIssuedBy(payment)}
                      </span>
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
              itemLabel="payments"
              onPageChange={fetchPayments}
            />
          )}
        </div>

      {/* Payment Method filter dropdown - portaled to avoid table overflow clipping */}
      {openPaymentMethodDropdown && paymentMethodDropdownRect && createPortal(
        <div
          className="fixed payment-method-filter-dropdown-portal w-48 bg-white rounded-md shadow-lg z-[100] border border-gray-200 max-h-60 overflow-y-auto py-1"
          style={{
            top: `${paymentMethodDropdownRect.bottom + 4}px`,
            left: `${paymentMethodDropdownRect.left}px`,
            minWidth: `${Math.max(paymentMethodDropdownRect.width, 192)}px`,
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setFilterPaymentMethod('');
              setOpenPaymentMethodDropdown(false);
              setPaymentMethodDropdownRect(null);
            }}
            className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
              !filterPaymentMethod ? 'bg-gray-100 font-medium' : 'text-gray-700'
            }`}
          >
            All Methods
          </button>
          {getUniquePaymentMethods().map((method) => (
            <button
              key={method}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setFilterPaymentMethod(method);
                setOpenPaymentMethodDropdown(false);
                setPaymentMethodDropdownRect(null);
              }}
              className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
                filterPaymentMethod === method ? 'bg-gray-100 font-medium' : 'text-gray-700'
              }`}
            >
              {method}
            </button>
          ))}
        </div>,
        document.body
      )}

      {/* Approval filter (finance verification) — portaled to avoid table overflow clipping */}
      {branchLogTab === 'main' && openStatusDropdown && statusDropdownRect && createPortal(
        <div
          className="fixed status-filter-dropdown-portal w-52 bg-white rounded-md shadow-lg z-[100] border border-gray-200 max-h-60 overflow-y-auto py-1"
          style={{
            top: `${statusDropdownRect.bottom + 4}px`,
            left: `${statusDropdownRect.left}px`,
            minWidth: `${Math.max(statusDropdownRect.width, 208)}px`,
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setFilterFinanceApproval('');
              setOpenStatusDropdown(false);
              setStatusDropdownRect(null);
            }}
            className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
              !filterFinanceApproval ? 'bg-gray-100 font-medium' : 'text-gray-700'
            }`}
          >
            All approvals
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setFilterFinanceApproval('approved');
              setOpenStatusDropdown(false);
              setStatusDropdownRect(null);
            }}
            className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
              filterFinanceApproval === 'approved' ? 'bg-gray-100 font-medium' : 'text-gray-700'
            }`}
          >
            Approved (verified)
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setFilterFinanceApproval('pending');
              setOpenStatusDropdown(false);
              setStatusDropdownRect(null);
            }}
            className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
              filterFinanceApproval === 'pending' ? 'bg-gray-100 font-medium' : 'text-gray-700'
            }`}
          >
            Pending approval
          </button>
        </div>,
        document.body
      )}

      {/* Reference Number modal - for Pending payments (portaled so overlay covers header) */}
      {showReferenceModal && selectedPaymentForReference && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center backdrop-blur-sm bg-black/5 p-4"
          onClick={closeReferenceModal}
        >
          <div
            className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-gray-900">Payment Status info</h2>
                <button
                  type="button"
                  onClick={closeReferenceModal}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <p className="text-sm text-gray-600 mb-4">
                Payment INV-{selectedPaymentForReference.invoice_id} · {selectedPaymentForReference.student_name || 'N/A'}
              </p>
              {selectedPaymentForReference.payment_attachment_url && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Attached Image</label>
                  <button
                    type="button"
                    onClick={() => {
                      setAttachmentViewerUrl(selectedPaymentForReference.payment_attachment_url);
                      setShowAttachmentViewer(true);
                    }}
                    className="block cursor-pointer text-left rounded-lg border border-gray-200 hover:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1"
                  >
                    <img
                      src={selectedPaymentForReference.payment_attachment_url}
                      alt="Payment attachment"
                      className="max-h-48 w-auto rounded-lg object-contain"
                    />
                  </button>
                </div>
              )}
              <form onSubmit={handleUpdateReferenceNumber}>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Reference Number</label>
                  <input
                    type="text"
                    value={referenceModalInput}
                    onChange={(e) => setReferenceModalInput(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    placeholder="Enter reference number (e.g. cash voucher, receipt no.)"
                    required
                  />
                </div>
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={closeReferenceModal}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
                    disabled={referenceModalUpdating}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={referenceModalUpdating}
                  >
                    {referenceModalUpdating ? 'Saving...' : 'Done'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Returned payment: fix fields & resubmit — layout aligned with Record Payment modal */}
      {returnFixPayment && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center backdrop-blur-sm bg-black/5 p-4"
          onClick={closeReturnFixModal}
        >
          <div
            className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center z-10">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Fix &amp; resubmit for verification</h2>
                <p className="text-sm text-gray-600 mt-1">
                  INV-{returnFixPayment.invoice_id}
                  {returnFixPayment.student_name ? ` · ${returnFixPayment.student_name}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={closeReturnFixModal}
                className="text-gray-400 hover:text-gray-600 transition-colors shrink-0"
                disabled={returnFixLoading}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={submitReturnFix} className="p-6 space-y-6">
              {returnFixPayment.return_reason && (
                <div className="rounded-md bg-amber-50 border border-amber-100 px-3 py-2 text-sm text-amber-900">
                  <span className="font-medium">Finance note: </span>
                  {returnFixPayment.return_reason}
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="label-field text-xs">
                    Student <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={
                      `${returnFixPayment.student_name || 'N/A'}` +
                      (returnFixPayment.student_email ? ` (${returnFixPayment.student_email})` : '')
                    }
                    className="input-field text-sm bg-gray-50 text-gray-700 cursor-not-allowed"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="label-field text-xs">
                      Payment Type <span className="text-red-500">*</span>
                    </label>
                    <select
                      name="payment_type"
                      value={returnFixPaymentType}
                      onChange={handleReturnFixInputChange}
                      disabled={returnFixLoading || returnFixAttachmentUploading}
                      className="input-field text-sm"
                      required
                    >
                      <option value="">Select Payment Type</option>
                      <option value="Full Payment">Full Payment</option>
                      <option value="Partial Payment">Partial Payment</option>
                      <option value="Advance Payment">Advance Payment</option>
                    </select>
                  </div>
                  <div>
                    <label className="label-field text-xs">
                      Payment Method <span className="text-red-500">*</span>
                    </label>
                    <select
                      id="return_fix_payment_method"
                      value={returnFixPaymentMethod}
                      onChange={(e) => setReturnFixPaymentMethod(e.target.value)}
                      disabled={returnFixLoading || returnFixAttachmentUploading}
                      className="input-field text-sm"
                      required
                    >
                      {getReturnFixPaymentMethodOptions(returnFixPaymentMethod).map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="label-field text-xs">
                      Payable Amount <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      name="payable_amount"
                      step="0.01"
                      min="0.01"
                      max={
                        returnFixPaymentType === 'Partial Payment' &&
                        getReturnFixReleaseCap() != null &&
                        getReturnFixReleaseCap() > 0
                          ? Math.max(
                              0.01,
                              getReturnFixReleaseCap() -
                                (returnFixDiscountAmount === ''
                                  ? 0
                                  : Math.max(0, parseFloat(returnFixDiscountAmount) || 0)) -
                                0.01
                            ).toFixed(2)
                          : undefined
                      }
                      value={returnFixPayableAmount}
                      onChange={handleReturnFixInputChange}
                      disabled={
                        returnFixLoading ||
                        returnFixAttachmentUploading ||
                        returnFixPaymentType === 'Full Payment'
                      }
                      className={`input-field text-sm ${
                        returnFixPaymentType === 'Full Payment' ? 'bg-gray-100 text-gray-600 cursor-not-allowed' : ''
                      }`}
                      placeholder="0.00"
                      required
                    />
                    {returnFixPaymentType === 'Partial Payment' &&
                      getReturnFixReleaseCap() != null &&
                      getReturnFixReleaseCap() > 0 && (
                      <p className="text-xs text-amber-600 mt-1">
                        Partial payment: combined payable + discount must be lower than{' '}
                        <span className="font-medium">₱{getReturnFixReleaseCap().toFixed(2)}</span> (remaining + this
                        line&apos;s payable and discount).
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="label-field text-xs">Tip/Payment Adjustment</label>
                    <input
                      type="number"
                      name="tip_amount"
                      step="0.01"
                      min="0"
                      value={returnFixTipAmount}
                      onChange={handleReturnFixInputChange}
                      disabled={returnFixLoading || returnFixAttachmentUploading}
                      className="input-field text-sm"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className="label-field text-xs">Discount/Payment Adjustment</label>
                    <input
                      type="number"
                      name="discount_amount"
                      step="0.01"
                      min="0"
                      max={
                        parseFloat(returnFixPayableAmount || 0) > 0
                          ? Math.max(0, parseFloat(returnFixPayableAmount || 0) - 0.01).toFixed(2)
                          : undefined
                      }
                      value={returnFixDiscountAmount}
                      onChange={handleReturnFixInputChange}
                      disabled={returnFixLoading || returnFixAttachmentUploading}
                      className="input-field text-sm"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div>
                  <label className="label-field text-xs">
                    Issue Date <span className="text-red-500">*</span>
                  </label>
                  <p className="text-xs text-gray-500 mb-1">
                    Defaults to the original payment date; change only if the receipt shows a different date.
                  </p>
                  <input
                    id="return_fix_issue_date"
                    type="date"
                    value={returnFixIssueDate}
                    onChange={(e) => setReturnFixIssueDate(e.target.value)}
                    disabled={returnFixLoading || returnFixAttachmentUploading}
                    className="input-field text-sm max-w-md"
                    required
                  />
                </div>

                <div>
                  <label className="label-field text-xs">
                    Attachment (image) <span className="text-red-500">*</span>
                  </label>
                  <p className="text-xs text-gray-500 mb-1">
                    Upload a receipt or proof of payment (JPEG, PNG, WebP, GIF, max 50MB).
                  </p>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={handleReturnFixAttachmentChange}
                    disabled={returnFixLoading || returnFixAttachmentUploading}
                    className="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-3 file:rounded file:border-0 file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
                  />
                  {returnFixAttachmentUploading && (
                    <p className="text-xs text-amber-600 mt-1">Uploading…</p>
                  )}
                  {returnFixAttachment && !returnFixAttachmentUploading && (
                    <div className="mt-2">
                      <img
                        src={returnFixAttachment}
                        alt="Payment attachment preview"
                        className="max-h-48 w-auto rounded-lg border border-gray-200 object-contain bg-gray-50"
                      />
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setAttachmentViewerUrl(returnFixAttachment);
                            setShowAttachmentViewer(true);
                          }}
                          className="text-sm text-primary-600 hover:underline"
                        >
                          View attached image
                        </button>
                        <button
                          type="button"
                          onClick={clearReturnFixAttachment}
                          className="text-xs text-red-600 hover:text-red-700"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <label className="label-field text-xs">
                    Reference Number <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={returnFixRef}
                    onChange={(e) => setReturnFixRef(e.target.value)}
                    disabled={returnFixLoading || returnFixAttachmentUploading}
                    className="input-field text-sm"
                    placeholder="Enter reference number (e.g. cash voucher, receipt no.)"
                  />
                </div>

                <div>
                  <label className="label-field text-xs">Remarks</label>
                  <textarea
                    name="remarks"
                    rows={3}
                    value={returnFixRemarks}
                    onChange={handleReturnFixInputChange}
                    disabled={returnFixLoading || returnFixAttachmentUploading}
                    className="input-field text-sm"
                    placeholder="Optional remarks or notes"
                  />
                </div>

                {returnFixInvoiceLoading && (
                  <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600">Loading invoice summary…</div>
                )}
                {!returnFixInvoiceLoading &&
                  returnFixInvoiceSummary &&
                  (() => {
                    const inv = returnFixInvoiceSummary;
                    const breakdown = getInvoiceBreakdownForReturnFix(inv);
                    const linePayable = parseFloat(returnFixPayment.payable_amount) || 0;
                    const lineDiscount = parseFloat(returnFixPayment.discount_amount || 0) || 0;
                    const oldSettlement = linePayable + lineDiscount;
                    const enteredPayable = parseFloat(returnFixPayableAmount || 0) || 0;
                    const enteredDiscount =
                      returnFixDiscountAmount === '' ? 0 : Math.max(0, parseFloat(returnFixDiscountAmount) || 0);
                    const newSettlement = enteredPayable + enteredDiscount;
                    const releaseCap = Math.max(0, breakdown.remaining + oldSettlement);
                    const settlementToApply =
                      releaseCap > 0 ? Math.max(0, Math.min(newSettlement, releaseCap)) : newSettlement;
                    const projectedPaid = breakdown.paidAmount - oldSettlement + settlementToApply;
                    const projectedRemaining = Math.max(0, breakdown.totalDue - projectedPaid);
                    return (
                      <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                        <h3 className="text-sm font-semibold text-gray-700">Invoice Information</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                          <div>
                            <p className="text-xs text-gray-600">Invoice ID</p>
                            <p className="font-medium text-gray-900 break-words">
                              {inv.display_description || inv.invoice_description || `INV-${inv.invoice_id}`}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-600">Issue Date</p>
                            <p className="font-medium text-gray-900">{formatDateManila(inv.issue_date)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-600">Due Date</p>
                            <p className="font-medium text-gray-900">{formatDateManila(inv.due_date)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-600">Remaining Balance</p>
                            <p className="font-semibold text-blue-700">₱{breakdown.remaining.toFixed(2)}</p>
                          </div>
                        </div>
                        <div className="border-t border-gray-200 pt-3 space-y-1 text-sm">
                          <div className="flex justify-between gap-2">
                            <span className="text-gray-600">Subtotal</span>
                            <span className="text-gray-900 shrink-0">₱{breakdown.subtotal.toFixed(2)}</span>
                          </div>
                          {breakdown.discount > 0.005 ? (
                            <div className="flex justify-between gap-2">
                              <span className="text-gray-600">Invoice discount (line items)</span>
                              <span className="text-gray-900 shrink-0">- ₱{breakdown.discount.toFixed(2)}</span>
                            </div>
                          ) : null}
                          <div className="flex justify-between gap-2">
                            <span className="text-gray-600">Discount</span>
                            <span className="text-gray-900 shrink-0">- ₱{enteredDiscount.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-gray-600">Penalty</span>
                            <span className="text-gray-900 shrink-0">₱{breakdown.penalty.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-gray-600">Tax</span>
                            <span className="text-gray-900 shrink-0">₱{breakdown.tax.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between font-semibold border-t border-gray-200 pt-2 mt-2 gap-2">
                            <span className="text-gray-800">Total Invoice Amount</span>
                            <span className="text-gray-900 shrink-0">₱{breakdown.totalDue.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-gray-600">Total Paid</span>
                            <span className="text-emerald-700 shrink-0">₱{breakdown.paidAmount.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-gray-600">Payment to apply (this line)</span>
                            <span className="text-gray-900 shrink-0">₱{settlementToApply.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-gray-600">Projected Total Paid</span>
                            <span className="text-emerald-700 shrink-0">₱{projectedPaid.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between font-semibold gap-2">
                            <span className="text-gray-800">Projected Remaining After Payment</span>
                            <span className="text-blue-700 shrink-0">₱{projectedRemaining.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
              </div>

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={closeReturnFixModal}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                  disabled={returnFixLoading || returnFixAttachmentUploading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={returnFixLoading || returnFixAttachmentUploading || returnFixInvoiceLoading}
                >
                  {returnFixLoading ? 'Saving...' : 'Save & resubmit to Finance'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      <PaymentAttachmentViewerModal
        open={showAttachmentViewer && Boolean(attachmentViewerUrl)}
        url={attachmentViewerUrl}
        onClose={() => {
          setShowAttachmentViewer(false);
          setAttachmentViewerUrl(null);
        }}
      />

      {/* Payment Status approval dropdown - portaled */}
      {openApprovalMenuId && createPortal(
        (() => {
          const payment = payments.find((p) => p.payment_id === openApprovalMenuId);
          if (!payment || !canApprovePayment(payment)) return null;
          const isApproved = (payment.approval_status || 'Pending') === 'Approved';
          return (
            <div
              className="fixed payment-status-approval-portal bg-white rounded-md shadow-lg z-[100] border border-gray-200 py-1"
              style={{
                top: `${approvalMenuPosition.top}px`,
                left: `${approvalMenuPosition.left}px`,
              }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {isApproved ? (
                <button
                  type="button"
                  onClick={() => handleApprovePayment(payment.payment_id, false)}
                  className="block w-full text-left px-4 py-2 text-xs text-gray-700 hover:bg-gray-100"
                >
                  Revoke approval
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleApprovePayment(payment.payment_id, true)}
                  className="block w-full text-left px-4 py-2 text-xs text-gray-700 hover:bg-gray-100"
                >
                  Approve
                </button>
              )}
            </div>
          );
        })(),
        document.body
      )}

      {/* Branch filter dropdown - portaled to avoid table overflow clipping */}
      {openBranchDropdown && branchDropdownRect && createPortal(
        <div
          className="fixed branch-filter-dropdown-portal w-48 bg-white rounded-md shadow-lg z-[100] border border-gray-200 max-h-60 overflow-y-auto py-1"
          style={{
            top: `${branchDropdownRect.bottom + 4}px`,
            left: `${branchDropdownRect.left}px`,
            minWidth: `${Math.max(branchDropdownRect.width, 192)}px`,
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setFilterBranch('');
              setOpenBranchDropdown(false);
              setBranchDropdownRect(null);
            }}
            className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
              !filterBranch ? 'bg-gray-100 font-medium' : 'text-gray-700'
            }`}
          >
            All Branches
          </button>
          {branches.map((branch) => (
            <button
              key={branch.branch_id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setFilterBranch(branch.branch_id.toString());
                setOpenBranchDropdown(false);
                setBranchDropdownRect(null);
              }}
              className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
                filterBranch === branch.branch_id.toString() ? 'bg-gray-100 font-medium' : 'text-gray-700'
              }`}
            >
              {branch.branch_nickname || branch.branch_name}
            </button>
          ))}
        </div>,
        document.body
      )}

      {selectedRejectedPayment && createPortal(
        <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl">
            <div className="border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Rejected payment details</h2>
              <p className="mt-1 text-sm text-gray-500">
                Review the rejected payment, then go to the invoice to record a new payment.
              </p>
            </div>
            <div className="grid gap-3 px-6 py-5 text-sm sm:grid-cols-2">
              <div><span className="font-medium text-gray-700">Invoice:</span> INV-{selectedRejectedPayment.invoice_id || '-'}</div>
              <div><span className="font-medium text-gray-700">Student:</span> {selectedRejectedPayment.student_name || '-'}</div>
              <div>
                <span className="font-medium text-gray-700">Amount:</span>{' '}
                {formatCurrency(getPaymentLogTableAmountColumn(selectedRejectedPayment))}
              </div>
              <div>
                <span className="font-medium text-gray-700">Total amount:</span>{' '}
                {formatCurrency(getPaymentLogTableTotalAmountColumn(selectedRejectedPayment))}
              </div>
              <div><span className="font-medium text-gray-700">Payment method:</span> {selectedRejectedPayment.payment_method || '-'}</div>
              <div><span className="font-medium text-gray-700">Payment date:</span> {selectedRejectedPayment.payment_date ? formatDate(selectedRejectedPayment.payment_date) : '-'}</div>
              <div><span className="font-medium text-gray-700">Reference#:</span> {selectedRejectedPayment.reference_number || '-'}</div>
              <div><span className="font-medium text-gray-700">Rejected by:</span> {selectedRejectedPayment.rejected_by_name || '-'}</div>
              <div><span className="font-medium text-gray-700">Rejected at:</span> {selectedRejectedPayment.rejected_at ? formatDateTimeManila(selectedRejectedPayment.rejected_at) : '-'}</div>
              <div className="sm:col-span-2">
                <span className="font-medium text-gray-700">Package/Item:</span> {getPaymentLogPackageItemDisplayText(selectedRejectedPayment)}
              </div>
              <div className="sm:col-span-2">
                <span className="font-medium text-gray-700">Reason:</span>
                <p className="mt-1 rounded-lg bg-red-50 p-3 text-red-800">
                  {selectedRejectedPayment.reject_reason || 'No reason provided.'}
                </p>
              </div>
            </div>
            <div className="flex flex-col-reverse gap-3 border-t border-gray-200 px-6 py-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setSelectedRejectedPayment(null)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  const navState = buildInvoiceNavigateStateFromRejectedPayment(selectedRejectedPayment);
                  setSelectedRejectedPayment(null);
                  navigate('/superadmin/invoice', { state: navState });
                }}
                className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
              >
                Go to invoice
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <StandardExportModal
        open={showExportModal}
        onClose={() => setShowExportModal(false)}
        title="Export Payment Logs"
        description="Choose a payment date range (optional), then branches. Exported rows follow the current tab and approval filters on this page; dates apply only to this export."
        exportLoading={exportLoading}
        onExport={handleExportToExcel}
        exportDisabled={
          branches.length === 0 || selectedExportBranches.length === 0 || exportPaymentDateRangeInvalid
        }
        maxWidthClass="max-w-2xl"
        overlayZClass="z-[9999]"
        closeOnOverlayClick
        scrollable
      >
        <PaymentLogsExportDateRange
          idPrefix="superadmin-pl-export"
          dateFrom={exportPaymentDateFrom}
          dateTo={exportPaymentDateTo}
          onDateFromChange={setExportPaymentDateFrom}
          onDateToChange={setExportPaymentDateTo}
          onClear={() => {
            setExportPaymentDateFrom('');
            setExportPaymentDateTo('');
          }}
          disabled={exportLoading}
        />
        <div className="mt-4">
          <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <label className="text-sm font-medium text-gray-700">Select Branches to Export</label>
            <button
              type="button"
              onClick={handleSelectAllBranches}
              className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 sm:self-start"
              disabled={exportLoading}
            >
              {selectedExportBranches.length === branches.length ? 'Clear All' : 'Select All'}
            </button>
          </div>
          <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2">
            {branches.length === 0 ? (
              <p className="px-2 py-1 text-xs text-gray-500">No branches available.</p>
            ) : (
              branches.map((branch) => (
                <label
                  key={branch.branch_id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    checked={selectedExportBranches.includes(branch.branch_id)}
                    onChange={() => handleExportBranchToggle(branch.branch_id)}
                    disabled={exportLoading}
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-gray-700">{branch.branch_nickname || branch.branch_name}</span>
                </label>
              ))
            )}
          </div>
        </div>
        <div className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Selected: <span className="font-semibold">{selectedExportBranches.length}</span> branch(es)
          {selectedExportBranches.length === 0 ? ' — select at least one to export.' : ''}
        </div>
      </StandardExportModal>
    </div>
  );
};

export default PaymentLogs;

