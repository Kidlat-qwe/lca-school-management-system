import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';
import * as XLSX from 'xlsx';
import { appendPaymentLogsAmountTotalRow } from '../../utils/paymentLogsExcelExport';
import { formatDateManila } from '../../utils/dateUtils';
import FixedTablePagination from '../../components/table/FixedTablePagination';
import { appAlert } from '../../utils/appAlert';
import { BranchPaymentLogTabs } from '../../components/paymentLogs/PaymentLogsViewTabs';
import PaymentAttachmentViewerModal from '../../components/paymentLogs/PaymentAttachmentViewerModal';
import StandardExportModal from '../../components/export/StandardExportModal';
import PaymentLogsExportDateRange from '../../components/export/PaymentLogsExportDateRange';

const FinancePaymentLogs = () => {
  const [filterMonth, setFilterMonth] = useState(''); // YYYY-MM
  const location = useLocation();
  const { userInfo } = useAuth();
  /** main = pending + approved (excludes Returned); return = payments you sent back to the branch */
  const [financeLogTab, setFinanceLogTab] = useState(() => {
    const params = new URLSearchParams(location.search);
    return params.get('notificationTab') === 'return' ? 'return' : 'main';
  });
  const [returnReasonInput, setReturnReasonInput] = useState('');
  const [returnActionLoading, setReturnActionLoading] = useState(false);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterBranch, setFilterBranch] = useState('');
  const [filterFinanceApproval, setFilterFinanceApproval] = useState('');
  const [filterIssueDateFrom, setFilterIssueDateFrom] = useState('');
  const [filterIssueDateTo, setFilterIssueDateTo] = useState('');
  const [filterPaymentMethod, setFilterPaymentMethod] = useState('');
  const [showAdvancedPaymentLogFilters, setShowAdvancedPaymentLogFilters] = useState(false);
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
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [selectedPaymentForReference, setSelectedPaymentForReference] = useState(null);
  const [referenceModalInput, setReferenceModalInput] = useState('');
  const [paymentDateInput, setPaymentDateInput] = useState('');
  const [referenceModalUpdating, setReferenceModalUpdating] = useState(false);
  const [showAttachmentViewer, setShowAttachmentViewer] = useState(false);
  const [attachmentViewerUrl, setAttachmentViewerUrl] = useState(null);
  const [showReturnDetailsModal, setShowReturnDetailsModal] = useState(false);
  const [selectedReturnDetailsPayment, setSelectedReturnDetailsPayment] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  /** Total Returned payments for current filters — Return tab badge */
  const [returnedPaymentLogCount, setReturnedPaymentLogCount] = useState(null);
  /** Sum of (payable + tip) for all rows matching server filters (not just this page). */
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
    if (notificationTab === 'main' || notificationTab === 'return') {
      setFinanceLogTab(notificationTab);
    }
  }, [location.search]);

  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    fetchPayments(1);
  }, [filterBranch, filterFinanceApproval, filterIssueDateFrom, filterIssueDateTo, financeLogTab, filterPaymentMethod]);

  const applyMonthFilter = (monthValue) => {
    const month = String(monthValue || '').trim();
    setFilterMonth(month);
    if (!month) return;
    const [yy, mm] = month.split('-').map((v) => parseInt(v, 10));
    if (!Number.isInteger(yy) || !Number.isInteger(mm) || mm < 1 || mm > 12) return;
    const first = `${month}-01`;
    const last = new Date(yy, mm, 0).getDate(); // day 0 of next month => last day of this month
    const lastYmd = `${month}-${String(last).padStart(2, '0')}`;
    setFilterIssueDateFrom(first);
    setFilterIssueDateTo(lastYmd);
  };

  useEffect(() => {
    if (financeLogTab === 'return') {
      setOpenStatusDropdown(false);
      setStatusDropdownRect(null);
    }
  }, [financeLogTab]);

  const fetchReturnedPaymentLogCount = async () => {
    try {
      const params = new URLSearchParams({ limit: '1', page: '1' });
      if (filterBranch) params.set('branch_id', filterBranch);
      if (filterIssueDateFrom) params.set('payment_date_from', filterIssueDateFrom);
      if (filterIssueDateTo) params.set('payment_date_to', filterIssueDateTo);
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
  }, [filterBranch, filterIssueDateFrom, filterIssueDateTo, filterPaymentMethod]);

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
  }, [openBranchDropdown, openStatusDropdown, openPaymentMethodDropdown]);

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
      if (filterIssueDateFrom) params.set('payment_date_from', filterIssueDateFrom);
      if (filterIssueDateTo) params.set('payment_date_to', filterIssueDateTo);
      const useUnifiedEndpoint = financeLogTab !== 'return';
      if (financeLogTab === 'return') {
        params.set('approval_status', 'Returned');
      } else if (filterFinanceApproval === 'approved') {
        params.set('status', 'Completed');
        params.set('approval_status', 'Approved');
        params.set('exclude_approval_status', 'Returned');
      } else if (filterFinanceApproval === 'pending') {
        params.set('pending_only', '1');
      } else {
        params.set('pending_only', '0');
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

  const openReferenceModal = (payment) => {
    setSelectedPaymentForReference(payment);
    setReferenceModalInput('');
    setReturnReasonInput('');
    // Pre-fill the editable Payment Date with the payment's current date.
    // The list query exposes the same column under both payment_date and
    // issue_date aliases; prefer payment_date and fall back to issue_date.
    const initialDate =
      (payment?.payment_date || payment?.issue_date || '').toString().slice(0, 10);
    setPaymentDateInput(initialDate);
    setShowReferenceModal(true);
  };

  const closeReferenceModal = () => {
    setShowReferenceModal(false);
    setSelectedPaymentForReference(null);
    setReferenceModalInput('');
    setReturnReasonInput('');
    setPaymentDateInput('');
  };

  const openReturnModal = () => {
    if (!selectedPaymentForReference) return;
    setShowReturnModal(true);
  };

  const closeReturnModal = () => {
    setShowReturnModal(false);
    setReturnReasonInput('');
  };

  const openReturnDetailsModal = (payment) => {
    setSelectedReturnDetailsPayment(payment);
    setShowReturnDetailsModal(true);
  };

  const closeReturnDetailsModal = () => {
    setShowReturnDetailsModal(false);
    setSelectedReturnDetailsPayment(null);
  };

  const handleReturnToBranch = async () => {
    if (!selectedPaymentForReference) return;
    const note = returnReasonInput.trim();
    if (!note) {
      appAlert('Please enter notes explaining why the payment is being returned.');
      return;
    }
    setReturnActionLoading(true);
    try {
      await apiRequest(`/payments/${selectedPaymentForReference.payment_id}/return`, {
        method: 'PUT',
        body: JSON.stringify({ reason: note }),
      });
      closeReturnModal();
      closeReferenceModal();
      await fetchPayments(pagination.page);
      await fetchReturnedPaymentLogCount();
      appAlert('Payment returned to branch for correction.');
    } catch (err) {
      appAlert(err.message || 'Failed to return payment.');
    } finally {
      setReturnActionLoading(false);
    }
  };

  const handleUpdateReferenceNumber = async (e) => {
    e.preventDefault();
    if (!selectedPaymentForReference) return;
    const enteredRef = referenceModalInput.trim();
    const originalRef = (selectedPaymentForReference.reference_number || '').trim();
    if (!enteredRef) {
      appAlert('Please enter your Finance/Superfinance reference number before approval.');
      return;
    }
    if (!originalRef) {
      appAlert(
        'This payment has no issued reference number. Please Return to branch and ask encoder to provide/fix it first.'
      );
      return;
    }
    if (enteredRef !== originalRef) {
      appAlert(
        'Reference number does not match the issued reference number. You cannot approve this payment.\n\nPlease use Return to branch.'
      );
      return;
    }

    // Validate the optional updated payment date. We always send what is in the
    // form; the backend only changes issue_date when this value is present and
    // valid, so the no-edit case is still a safe re-affirmation of the date.
    const trimmedDate = (paymentDateInput || '').trim();
    if (trimmedDate && !/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
      appAlert('Payment date must be a valid date (YYYY-MM-DD).');
      return;
    }

    const paymentId = selectedPaymentForReference.payment_id;
    setReferenceModalUpdating(true);
    try {
      const requestBody = {
        approve: true,
        finance_verified_reference_number: enteredRef,
      };
      if (trimmedDate) requestBody.payment_date = trimmedDate;

      await apiRequest(`/payments/${paymentId}/approve`, {
        method: 'PUT',
        body: JSON.stringify(requestBody),
      });
      setPayments((prev) =>
        prev.map((p) =>
          p.payment_id === paymentId
            ? {
                ...p,
                approval_status: 'Approved',
                ...(trimmedDate
                  ? { payment_date: trimmedDate, issue_date: trimmedDate }
                  : {}),
              }
            : p
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

  const handleApprovePayment = async (paymentId, approve) => {
    if (String(paymentId).startsWith('AR-')) {
      appAlert('Unapplied acknowledgement receipt entries cannot be directly approved in Payment Logs. Attach them during enrollment first.');
      return;
    }
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
    const methodLabel = method === 'Acknowledgement Receipt' ? 'Acknowledgement Receipt' : method;
    const methodColors = {
      'Cash': 'bg-blue-100 text-blue-800',
      'Credit Card': 'bg-purple-100 text-purple-800',
      'Debit Card': 'bg-indigo-100 text-indigo-800',
      'Bank Transfer': 'bg-teal-100 text-teal-800',
      'Check': 'bg-orange-100 text-orange-800',
      'Online Payment': 'bg-pink-100 text-pink-800',
      'Acknowledgement Receipt': 'bg-blue-100 text-blue-800',
      'Other': 'bg-gray-100 text-gray-800',
    };
    const colorClass = methodColors[method] || 'bg-gray-100 text-gray-800';
    return (
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
        {methodLabel || 'N/A'}
      </span>
    );
  };

  const getUniquePaymentMethods = () => {
    const methods = [...new Set(payments.map(p => p.payment_method).filter(Boolean))];
    return methods.sort();
  };

  const filteredPayments = payments.filter((payment) => {
    const matchesSearch = !searchTerm || 
      payment.invoice_description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.student_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.invoice_issued_by_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.invoice_issued_by_email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.payment_created_by_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.payment_created_by_email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.invoice_ar_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.reference_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.payment_id?.toString().includes(searchTerm);
    
    const matchesBranch = !filterBranch || payment.branch_id?.toString() === filterBranch;
    const matchesFinanceApproval =
      financeLogTab === 'return' ||
      !filterFinanceApproval ||
      (filterFinanceApproval === 'approved' &&
        (payment.approval_status || 'Pending') === 'Approved') ||
      (filterFinanceApproval === 'pending' &&
        (payment.approval_status || 'Pending') !== 'Approved');

    return matchesSearch && matchesBranch && matchesFinanceApproval;
  });

  const summaryLineTotal = useMemo(() => {
    const line = (p) => (parseFloat(p.payable_amount) || 0) + (parseFloat(p.tip_amount) || 0);
    if (searchTerm.trim()) {
      return filteredPayments.reduce((s, p) => s + line(p), 0);
    }
    if (filterTotalLineAmount != null && !Number.isNaN(Number(filterTotalLineAmount))) {
      return Number(filterTotalLineAmount);
    }
    return filteredPayments.reduce((s, p) => s + line(p), 0);
  }, [searchTerm, filteredPayments, filterTotalLineAmount]);

  const summaryPaymentLogCount = searchTerm.trim()
    ? filteredPayments.length
    : Number(pagination.total) || 0;
  const hasPaymentLogFilters = Boolean(
    searchTerm || filterPaymentMethod || filterFinanceApproval || filterIssueDateFrom || filterIssueDateTo || filterMonth
  );

  const resetPaymentLogFilters = () => {
    setSearchTerm('');
    setFilterPaymentMethod('');
    setFilterFinanceApproval('');
    setFilterIssueDateFrom('');
    setFilterIssueDateTo('');
    setFilterMonth('');
    fetchPayments(1);
  };

  const exportPaymentDateRangeInvalid =
    Boolean(exportPaymentDateFrom && exportPaymentDateTo) && exportPaymentDateFrom > exportPaymentDateTo;

  const handleExportClick = () => {
    setExportPaymentDateFrom(filterIssueDateFrom || '');
    setExportPaymentDateTo(filterIssueDateTo || '');
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
    if (financeLogTab === 'return') {
      appAlert('Returned payments are not included in exports. Please switch to the main tab to export.');
      return;
    }
    try {
      setExportLoading(true);
      
      const limit = 100;
      const fetchPage = async (branchId, page = 1) => {
        const params = new URLSearchParams({
          branch_id: String(branchId),
          limit: String(limit),
          page: String(page),
        });
        if (exportPaymentDateFrom) params.set('payment_date_from', exportPaymentDateFrom);
        if (exportPaymentDateTo) params.set('payment_date_to', exportPaymentDateTo);
        // Always exclude payments returned by Finance.
        params.set('exclude_approval_status', 'Returned');
        if (filterFinanceApproval === 'approved') {
          params.set('status', 'Completed');
          params.set('approval_status', 'Approved');
          return apiRequest(`/payments?${params.toString()}`);
        }
        if (filterFinanceApproval === 'pending') {
          params.set('pending_only', '1');
          return apiRequest(`/payments/finance-unified?${params.toString()}`);
        }
        params.set('status', 'Completed');
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
      const allPayments = results.flat();

      if (allPayments.length === 0) {
        appAlert('No payment records found to export.');
        setExportLoading(false);
        return;
      }

      // Prepare data for Excel (match Payment Logs table columns)
      const excelData = allPayments.map((payment) => {
        const payable = parseFloat(payment.payable_amount) || 0;
        const tip = parseFloat(payment.tip_amount) || 0;
        const uiStatus =
          financeLogTab === 'return'
            ? (payment.approval_status || payment.status || 'Returned')
            : ((payment.approval_status || 'Pending') === 'Approved' ? 'Approved' : 'Pending Approval');
        const row = {
          'Invoice ID': payment.invoice_id ? `INV-${payment.invoice_id}` : '-',
          BRANCH: getBranchName(payment.branch_id) || payment.branch_name || 'N/A',
          'Issue Date': payment.issue_date ? formatDate(payment.issue_date) : '-',
          'Payment Date': payment.payment_date ? formatDate(payment.payment_date) : '-',
          'Student Name': payment.student_name || 'N/A',
          'PACKAGE/ITEM': payment.invoice_description || '-',
          'LEVEL TAG': payment.student_level_tag || '-',
          'PAYMENT METHOD':
            payment.payment_method === 'Acknowledgement Receipt'
              ? 'Acknowledgement Receipt'
              : (payment.payment_method || '-'),
          AMOUNT: Math.round(payable * 100) / 100,
          'TOTAL AMOUNT': Math.round((payable + tip) * 100) / 100,
          Status: uiStatus,
        };
        if (financeLogTab === 'return') {
          row['Returned by'] = payment.returned_by_name || '—';
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

      // Set column widths (match Payment Logs table column order)
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
      if (financeLogTab === 'return') widthList.push(18); // Returned by
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
            <span className="font-medium text-gray-800">Payment logs</span> lists all active records (pending verification
            and approved). Use <span className="font-medium text-gray-800">Return to branch</span> in the verification modal
            when the reference and attachment do not match. <span className="font-medium text-gray-800">Return</span> shows
            payments you sent back to the branch for correction.
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
        <BranchPaymentLogTabs value={financeLogTab} onChange={setFinanceLogTab} returnBadgeCount={returnedPaymentLogCount} />
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">Search Filter</p>
            <p className="text-xs text-gray-500">
              Filter payment logs before the table.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="xl:col-span-2">
            <label htmlFor="finance-payment-log-search" className="mb-1 block text-xs font-medium text-gray-700">
              Search
            </label>
            <input
              id="finance-payment-log-search"
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Invoice, student, reference, acknowledgement receipt, or issued by"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
          <div>
            <label htmlFor="finance-payment-method-filter" className="mb-1 block text-xs font-medium text-gray-700">
              Payment Method
            </label>
            <select
              id="finance-payment-method-filter"
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
            <label htmlFor="finance-payment-status-filter" className="mb-1 block text-xs font-medium text-gray-700">
              Status
            </label>
            {financeLogTab === 'return' ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                Returned only
              </div>
            ) : (
              <select
                id="finance-payment-status-filter"
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
        </div>
        {showAdvancedPaymentLogFilters ? (
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div>
              <label htmlFor="finance-payment-date-from" className="mb-1 block text-xs font-medium text-gray-700">
                Payment date from
              </label>
              <input id="finance-payment-date-from" type="date" value={filterIssueDateFrom} onChange={(e) => { setFilterIssueDateFrom(e.target.value); if (filterMonth) setFilterMonth(''); }} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500" />
            </div>
            <div>
              <label htmlFor="finance-payment-date-to" className="mb-1 block text-xs font-medium text-gray-700">
                Payment date to
              </label>
              <input id="finance-payment-date-to" type="date" value={filterIssueDateTo} onChange={(e) => { setFilterIssueDateTo(e.target.value); if (filterMonth) setFilterMonth(''); }} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500" />
            </div>
            <div>
              <label htmlFor="finance-payment-month-filter" className="mb-1 block text-xs font-medium text-gray-700">
                Payment month
              </label>
              <input id="finance-payment-month-filter" type="month" value={filterMonth} onChange={(e) => applyMonthFilter(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500" />
            </div>
          </div>
        ) : null}
        <div className="mt-4 flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-gray-500">
            Date range is inclusive on payment date. Leave both dates empty for all dates.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <button type="button" onClick={() => setShowAdvancedPaymentLogFilters((current) => !current)} className="inline-flex items-center justify-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-primary-700 hover:bg-primary-50" aria-expanded={showAdvancedPaymentLogFilters}>
              {showAdvancedPaymentLogFilters ? 'Hide advanced filters' : 'Advanced filters'}
              <svg className={`h-4 w-4 transition-transform ${showAdvancedPaymentLogFilters ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <button type="button" onClick={resetPaymentLogFilters} disabled={!hasPaymentLogFilters} className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50">
              Reset
            </button>
            <button type="button" onClick={() => fetchPayments(1)} className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
              Search
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-700">
        <span>
          <span className="font-semibold text-gray-900">Payment logs:</span>{' '}
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
        <div
          className="overflow-x-auto rounded-lg"
          style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}
        >
          <table className="divide-y divide-gray-200 w-full" style={{ tableLayout: 'fixed', minWidth: '1820px' }}>
              {financeLogTab === 'return' ? (
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
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[11%]">
                    Invoice
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[11%]">
                    Branch
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Issue Date
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Payment Date
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[13%]">
                    Student Name
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[9%]">
                    <span className="leading-tight">package/<br />item</span>
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    LEVEL TAG
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[9%]">
                    Payment Method
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[8%]">
                    AMOUNT
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[8%]">
                    TOTAL AMOUNT
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[14%]">
                    {financeLogTab === 'return' ? 'Return Status' : 'Status'}
                  </th>
                  {financeLogTab === 'return' ? (
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Returned by
                    </th>
                  ) : null}
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[11%]">
                    Reference#
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <span className="block">Acknowledgement</span>
                    <span className="block">Receipt#</span>
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Issued By
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredPayments.length === 0 ? (
                  <tr>
                    <td colSpan={financeLogTab === 'return' ? 15 : 14} className="px-6 py-12 text-center">
                      <p className="text-gray-500">
                        {searchTerm || filterBranch || filterFinanceApproval || filterPaymentMethod
                          ? 'No matching payments. Try adjusting your search or filters.'
                          : financeLogTab === 'return'
                            ? 'No returned payments found for this branch.'
                            : 'No payment records found.'}
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredPayments.map((payment) => (
                  <tr key={payment.payment_id} className="hover:bg-gray-50/80">
                    <td className="px-3 py-2.5 whitespace-nowrap text-sm font-semibold text-gray-900 min-w-0">
                      {payment.invoice_id ? `INV-${payment.invoice_id}` : '-'}
                    </td>
                    <td className="px-3 py-2.5 text-sm text-gray-900 align-top min-w-0">
                      {(() => {
                        const branchName = getBranchName(payment.branch_id) || payment.branch_name || 'N/A';
                        if (!branchName || branchName === 'N/A') return <span className="text-gray-400">-</span>;
                        const formatted = formatBranchName(branchName);
                        const fullText = formatted.location ? `${formatted.company} - ${formatted.location}` : formatted.company;
                        return (
                          <div className="flex flex-col leading-tight min-w-0">
                            <span className="font-medium truncate" title={fullText}>{formatted.company}</span>
                            {formatted.location && <span className="text-xs text-gray-500 truncate" title={formatted.location}>{formatted.location}</span>}
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
                    <td className="px-3 py-2.5 whitespace-nowrap text-sm text-gray-900 min-w-0">
                      <span className="truncate block" title={payment.invoice_description || '-'}>
                        {payment.invoice_description || '-'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-sm text-gray-700 min-w-0">
                      <span className="truncate block" title={payment.student_level_tag || '-'}>
                        {payment.student_level_tag || '-'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-sm min-w-0">
                      {getPaymentMethodBadge(payment.payment_method)}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-sm font-semibold text-green-600 min-w-0">
                      {formatCurrency(payment.payable_amount)}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-sm font-semibold text-emerald-700 min-w-0">
                      {formatCurrency((parseFloat(payment.payable_amount) || 0) + (parseFloat(payment.tip_amount) || 0))}
                    </td>
                    <td className="px-3 py-2.5 text-sm payment-status-cell align-top min-w-0 overflow-hidden">
                      <div className="min-w-0 max-w-full">
                        {financeLogTab === 'return' ? (
                          <div className="space-y-1">
                            <button
                              type="button"
                              onClick={() => openReturnDetailsModal(payment)}
                              className="text-xs font-semibold text-primary-700 hover:text-primary-900 underline"
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
                              <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-blue-100 text-blue-800">
                                Awaiting attachment
                              </span>
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
                    {financeLogTab === 'return' ? (
                      <td className="px-3 py-2.5 text-sm text-gray-800 align-top min-w-0">
                        <span className="truncate block" title={payment.returned_by_name || ''}>
                          {payment.returned_by_name || '—'}
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
          {pagination.total > 0 && filteredPayments.length > 0 && (
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
              {method === 'Acknowledgement Receipt' ? 'Acknowledgement Receipt' : method}
            </button>
          ))}
        </div>,
        document.body
      )}

      {/* Approval filter (finance verification) — portaled to avoid table overflow clipping */}
      {financeLogTab === 'main' && openStatusDropdown && statusDropdownRect && createPortal(
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

      {/* Reference Number modal (portaled so overlay covers header) */}
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
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Payment Date
                  </label>
                  <input
                    type="date"
                    value={paymentDateInput}
                    onChange={(e) => setPaymentDateInput(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    disabled={referenceModalUpdating || returnActionLoading}
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Adjust the date if needed. Saving will update the payment date everywhere it is shown.
                  </p>
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Finance/Superfinance Reference Number
                  </label>
                  <input
                    type="text"
                    value={referenceModalInput}
                    onChange={(e) => setReferenceModalInput(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    placeholder="Enter verification reference number"
                    required
                  />
                </div>
                <div className="mb-4 pt-4 border-t border-gray-200">
                  <p className="text-xs text-gray-600 mb-2">
                    If the reference and attachment do not match, use <span className="font-medium text-gray-800">Return to branch</span>. You will be asked for a required note in the next step.
                  </p>
                  <button
                    type="button"
                    onClick={openReturnModal}
                    className="mt-3 w-full sm:w-auto px-4 py-2 text-sm font-medium text-amber-900 bg-amber-100 hover:bg-amber-200 rounded-md border border-amber-200 disabled:opacity-50"
                    disabled={referenceModalUpdating || returnActionLoading}
                  >
                    Return to branch
                  </button>
                </div>
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={closeReferenceModal}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
                    disabled={referenceModalUpdating || returnActionLoading}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={referenceModalUpdating || returnActionLoading}
                  >
                    {referenceModalUpdating ? 'Saving...' : 'Verify & approve'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showReturnModal && selectedPaymentForReference && createPortal(
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center backdrop-blur-sm bg-black/20 p-4"
          onClick={closeReturnModal}
        >
          <div
            className="bg-white rounded-lg shadow-xl w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Return to branch</h2>
                <button
                  type="button"
                  onClick={closeReturnModal}
                  className="text-gray-400 hover:text-gray-600"
                  disabled={returnActionLoading}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <p className="text-sm text-gray-600 mb-3">
                Add a note so the branch knows exactly what to fix for INV-{selectedPaymentForReference.invoice_id}.
              </p>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Note to branch <span className="text-red-500">*</span>
              </label>
              <textarea
                value={returnReasonInput}
                onChange={(e) => setReturnReasonInput(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm"
                placeholder="e.g. Reference on image does not match encoded reference"
                disabled={returnActionLoading}
              />
              <div className="mt-4 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={handleReturnToBranch}
                  className="px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-md disabled:opacity-50"
                  disabled={returnActionLoading}
                >
                  {returnActionLoading ? 'Returning...' : 'Confirm return'}
                </button>
                <button
                  type="button"
                  onClick={closeReturnModal}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
                  disabled={returnActionLoading}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showReturnDetailsModal && selectedReturnDetailsPayment && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center backdrop-blur-sm bg-black/5 p-4"
          onClick={closeReturnDetailsModal}
        >
          <div
            className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-gray-900">Returned payment details</h2>
                <button
                  type="button"
                  onClick={closeReturnDetailsModal}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="space-y-3 text-sm">
                <p className="text-gray-700">
                  <span className="font-medium">Payment:</span>{' '}
                  {selectedReturnDetailsPayment.invoice_id
                    ? `INV-${selectedReturnDetailsPayment.invoice_id}`
                    : '-'}{' '}
                  · {selectedReturnDetailsPayment.student_name || 'N/A'}
                </p>
                <p className="text-gray-700">
                  <span className="font-medium">Returned by:</span>{' '}
                  {selectedReturnDetailsPayment.returned_by_name || '—'}
                </p>
                <p className="text-gray-700">
                  <span className="font-medium">Returned at:</span>{' '}
                  {selectedReturnDetailsPayment.returned_at || '—'}
                </p>
                <p className="text-gray-700">
                  <span className="font-medium">Reference number:</span>{' '}
                  {selectedReturnDetailsPayment.reference_number || '—'}
                </p>
                <div>
                  <p className="font-medium text-gray-700 mb-1">Return reason</p>
                  <p className="text-gray-600 whitespace-pre-wrap">
                    {selectedReturnDetailsPayment.return_reason || '—'}
                  </p>
                </div>
                {selectedReturnDetailsPayment.payment_attachment_url ? (
                  <button
                    type="button"
                    onClick={() => {
                      setAttachmentViewerUrl(selectedReturnDetailsPayment.payment_attachment_url);
                      setShowAttachmentViewer(true);
                    }}
                    className="text-xs font-semibold text-primary-700 hover:text-primary-900 underline"
                  >
                    View attachment
                  </button>
                ) : null}
              </div>
            </div>
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
          idPrefix="finance-pl-export"
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

export default FinancePaymentLogs;

