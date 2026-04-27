import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';
import { useGlobalBranchFilter } from '../../contexts/GlobalBranchFilterContext';
import * as XLSX from 'xlsx';
import { formatDateManila } from '../../utils/dateUtils';
import FixedTablePagination from '../../components/table/FixedTablePagination';
import { appAlert } from '../../utils/appAlert';
import { BranchPaymentLogTabs } from '../../components/paymentLogs/PaymentLogsViewTabs';
import PaymentAttachmentViewerModal from '../../components/paymentLogs/PaymentAttachmentViewerModal';

const SuperfinancePaymentLogs = () => {
  const location = useLocation();
  const { userInfo } = useAuth();
  const { selectedBranchId: globalBranchId } = useGlobalBranchFilter();
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
  const [openBranchDropdown, setOpenBranchDropdown] = useState(false);
  const [openStatusDropdown, setOpenStatusDropdown] = useState(false);
  const [openPaymentMethodDropdown, setOpenPaymentMethodDropdown] = useState(false);
  const [branchDropdownRect, setBranchDropdownRect] = useState(null);
  const [statusDropdownRect, setStatusDropdownRect] = useState(null);
  const [paymentMethodDropdownRect, setPaymentMethodDropdownRect] = useState(null);
  const [branches, setBranches] = useState([]);
  const [showExportModal, setShowExportModal] = useState(false);
  const [selectedExportBranches, setSelectedExportBranches] = useState([]);
  const [exportLoading, setExportLoading] = useState(false);
  const [openApprovalMenuId, setOpenApprovalMenuId] = useState(null);
  const [approvalMenuPosition, setApprovalMenuPosition] = useState({ top: 0, left: 0 });
  const [approvalLoadingId, setApprovalLoadingId] = useState(null);
  const [showReferenceModal, setShowReferenceModal] = useState(false);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [selectedPaymentForReference, setSelectedPaymentForReference] = useState(null);
  const [referenceModalInput, setReferenceModalInput] = useState('');
  const [referenceModalUpdating, setReferenceModalUpdating] = useState(false);
  const [showAttachmentViewer, setShowAttachmentViewer] = useState(false);
  const [attachmentViewerUrl, setAttachmentViewerUrl] = useState(null);
  const [showReturnDetailsModal, setShowReturnDetailsModal] = useState(false);
  const [selectedReturnDetailsPayment, setSelectedReturnDetailsPayment] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
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

  useEffect(() => {
    setFilterBranch(globalBranchId || '');
    setOpenBranchDropdown(false);
    setBranchDropdownRect(null);
  }, [globalBranchId]);

  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    fetchPayments(1);
  }, [filterBranch, filterFinanceApproval, filterIssueDateFrom, filterIssueDateTo, financeLogTab]);

  useEffect(() => {
    if (financeLogTab === 'return') {
      setOpenStatusDropdown(false);
      setStatusDropdownRect(null);
    }
  }, [financeLogTab]);

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
      setLoading(true);
      const limit = 10;
      const params = new URLSearchParams({ limit: String(limit), page: String(page) });
      if (filterBranch) params.set('branch_id', filterBranch);
      if (filterIssueDateFrom) params.set('issue_date_from', filterIssueDateFrom);
      if (filterIssueDateTo) params.set('issue_date_to', filterIssueDateTo);
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
      const endpoint = useUnifiedEndpoint ? '/payments/finance-unified' : '/payments';
      const response = await apiRequest(`${endpoint}?${params.toString()}`);
      if (fetchId !== latestFetchIdRef.current) return;
      setPayments(response.data || []);
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
    } finally {
      if (fetchId !== latestFetchIdRef.current) return;
      setLoading(false);
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
    setShowReferenceModal(true);
  };

  const closeReferenceModal = () => {
    setShowReferenceModal(false);
    setSelectedPaymentForReference(null);
    setReferenceModalInput('');
    setReturnReasonInput('');
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

    const paymentId = selectedPaymentForReference.payment_id;
    setReferenceModalUpdating(true);
    try {
      await apiRequest(`/payments/${paymentId}/approve`, {
        method: 'PUT',
        body: JSON.stringify({
          approve: true,
          finance_verified_reference_number: enteredRef,
        }),
      });
      setPayments((prev) =>
        prev.map((p) =>
          p.payment_id === paymentId ? { ...p, approval_status: 'Approved' } : p
        )
      );
      closeReferenceModal();
      await fetchPayments(pagination.page);
    } catch (err) {
      appAlert(err.message || 'Failed to save and approve payment.');
    } finally {
      setReferenceModalUpdating(false);
    }
  };

  const handleApprovePayment = async (paymentId, approve) => {
    if (String(paymentId).startsWith('AR-')) {
      appAlert('Unapplied AR entries cannot be directly approved in Payment Logs. Attach them during enrollment first.');
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

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return formatDateManila(dateString) || '-';
  };

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
    if (!payment?.student_id) return 'Walk-in / AR';
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
    const methodLabel = method === 'Acknowledgement Receipt' ? 'AR' : method;
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
    const matchesPaymentMethod = !filterPaymentMethod || payment.payment_method === filterPaymentMethod;
    
    return matchesSearch && matchesBranch && matchesFinanceApproval && matchesPaymentMethod;
  });
  const filteredTotalAmount = filteredPayments.reduce(
    (sum, payment) => sum + (parseFloat(payment.payable_amount) || 0),
    0
  );

  const handleExportClick = () => {
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
    try {
      setExportLoading(true);
      
      const limit = 100;
      const fetchPage = async (branchId, page = 1) => {
        const params = new URLSearchParams({
          branch_id: String(branchId),
          limit: String(limit),
          page: String(page),
        });
        if (filterIssueDateFrom) params.set('issue_date_from', filterIssueDateFrom);
        if (filterIssueDateTo) params.set('issue_date_to', filterIssueDateTo);
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
        const endpoint = useUnifiedEndpoint ? '/payments/finance-unified' : '/payments';
        return apiRequest(`${endpoint}?${params.toString()}`);
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

      // Prepare data for Excel
      const excelData = allPayments.map(payment => ({
        'Invoice ID': payment.invoice_id ? `INV-${payment.invoice_id}` : '-',
        'Invoice Description': payment.invoice_description || '-',
        'Student Name': payment.student_name || 'N/A',
        'Student Email': payment.student_email || '-',
        'Issued by': formatInvoiceIssuedBy(payment),
        'Payment Method': payment.payment_method === 'Acknowledgement Receipt' ? 'AR' : (payment.payment_method || '-'),
        'Package/Item': payment.invoice_description || '-',
        'Level Tag': payment.student_level_tag || '-',
        'Amount (₱)': payment.payable_amount ? parseFloat(payment.payable_amount).toFixed(2) : '0.00',
        'Status': payment.status || 'N/A',
        'Branch': getBranchName(payment.branch_id) || payment.branch_name || 'N/A',
        'Issue Date': payment.issue_date ? formatDate(payment.issue_date) : '-',
        'AR#': payment.invoice_ar_number || '-',
        'Reference Number': payment.reference_number || '-',
        'Remarks': payment.remarks || '-',
      }));

      // Create workbook and worksheet
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(excelData);

      // Set column widths
      ws['!cols'] = [
        { wch: 12 },  // Invoice ID
        { wch: 30 },  // Invoice Description
        { wch: 25 },  // Student Name
        { wch: 30 },  // Student Email
        { wch: 22 },  // Issued by
        { wch: 18 },  // Payment Method
        { wch: 18 },  // Payment Type
        { wch: 15 },  // Amount
        { wch: 12 },  // Status
        { wch: 25 },  // Branch
        { wch: 15 },  // Issue Date
        { wch: 10 },  // AR#
        { wch: 20 },  // Reference Number
        { wch: 30 },  // Remarks
      ];

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


  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Payment Logs</h1>
          <p className="mt-1 text-sm text-gray-600 max-w-2xl">
            View and manage payment records across all branches. <span className="font-medium text-gray-800">Payment logs</span>{' '}
            lists active records (pending verification and approved). Use{' '}
            <span className="font-medium text-gray-800">Return to branch</span> in the verification modal when the reference
            and attachment do not match. <span className="font-medium text-gray-800">Return</span> lists payments you sent back
            to a branch for correction.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExportClick}
          className="flex shrink-0 items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Export to Excel
        </button>
      </div>

      <BranchPaymentLogTabs value={financeLogTab} onChange={setFinanceLogTab} />

      {/* Error Message */}
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Payment Logs List */}
      <div className="bg-white rounded-lg shadow">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end px-3 sm:px-4 py-3 border-b border-gray-200 bg-gray-50/90">
          <div className="flex flex-col gap-1 min-w-0">
            <label htmlFor="superfinance-payment-logs-issue-date-from" className="text-xs font-medium text-gray-600">
              From
            </label>
            <input
              id="superfinance-payment-logs-issue-date-from"
              type="date"
              value={filterIssueDateFrom}
              onChange={(e) => setFilterIssueDateFrom(e.target.value)}
              className="min-h-[40px] px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white w-full max-w-[11rem]"
            />
          </div>
          <div className="flex flex-col gap-1 min-w-0">
            <label htmlFor="superfinance-payment-logs-issue-date-to" className="text-xs font-medium text-gray-600">
              To
            </label>
            <input
              id="superfinance-payment-logs-issue-date-to"
              type="date"
              value={filterIssueDateTo}
              onChange={(e) => setFilterIssueDateTo(e.target.value)}
              className="min-h-[40px] px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white w-full max-w-[11rem]"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 pb-0.5">
            {filterIssueDateFrom || filterIssueDateTo ? (
              <button
                type="button"
                onClick={() => {
                  setFilterIssueDateFrom('');
                  setFilterIssueDateTo('');
                }}
                className="text-sm font-medium text-primary-600 hover:text-primary-800 px-2 py-1.5 rounded-md hover:bg-primary-50"
              >
                Clear dates
              </button>
            ) : null}
          </div>
          <p className="text-xs text-gray-500 sm:ml-auto sm:pb-2 w-full sm:w-auto">
            Inclusive range on payment date. Leave both empty for all dates.
          </p>
        </div>
        <div className="mb-2 px-1">
          <p className="text-sm font-semibold text-gray-700">
            Total Amount: <span className="text-emerald-700">₱{filteredTotalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </p>
        </div>
        <div className="rounded-lg overflow-x-auto">
          <table className="divide-y divide-gray-200 w-full" style={{ tableLayout: 'fixed', minWidth: '1360px' }}>
              <colgroup>
                <col style={{ width: '11%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '8%' }} />
              </colgroup>
              <thead className="bg-gray-50 table-header-stable">
                <tr>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[11%]">
                    <div className="flex flex-col space-y-2 max-w-[160px]">
                      <div className="flex items-center space-x-1 min-h-[6px]">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${searchTerm ? 'bg-primary-600' : 'invisible'}`} aria-hidden />
                      </div>
                      <div className="relative min-h-[28px]">
                        <input
                          type="text"
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          placeholder="Search payments..."
                          className="px-2 py-1 pr-6 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 w-full max-w-full"
                          onClick={(e) => e.stopPropagation()}
                        />
                        {searchTerm && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSearchTerm('');
                            }}
                            className="absolute right-1 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[11%]">
                    Branch
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[8%]">
                    Date
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
                    <div className="relative payment-method-filter-dropdown">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          setPaymentMethodDropdownRect(rect);
                          setOpenPaymentMethodDropdown(!openPaymentMethodDropdown);
                          setOpenStatusDropdown(false);
                          setStatusDropdownRect(null);
                          setOpenBranchDropdown(false);
                          setBranchDropdownRect(null);
                        }}
                        className="flex items-center space-x-1 hover:text-gray-700"
                      >
                        <span>Payment Method</span>
                        <span className={`inline-flex items-center justify-center w-1.5 h-1.5 rounded-full flex-shrink-0 ${filterPaymentMethod ? 'bg-primary-600' : 'invisible'}`} aria-hidden />
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[8%]">
                    AMOUNT
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[8%]">
                    TOTAL AMOUNT
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[14%]">
                    <div className="relative status-filter-dropdown">
                      {financeLogTab === 'return' ? (
                        <span className="inline-flex items-center space-x-1 text-gray-500">Return status</span>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
                            setStatusDropdownRect(rect);
                            setOpenStatusDropdown(!openStatusDropdown);
                            setOpenPaymentMethodDropdown(false);
                            setPaymentMethodDropdownRect(null);
                            setOpenBranchDropdown(false);
                            setBranchDropdownRect(null);
                          }}
                          className="flex items-center space-x-1 hover:text-gray-700"
                        >
                          <span title="Finance approval — same as Financial Dashboard verified / unverified">
                            Status
                          </span>
                          {filterFinanceApproval ? (
                            <span className="inline-flex items-center justify-center w-1.5 h-1.5 bg-primary-600 rounded-full" aria-hidden />
                          ) : null}
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </th>
                  {financeLogTab === 'return' ? (
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Returned by
                    </th>
                  ) : null}
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[11%]">
                    Reference#
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[7%]">
                    AR#
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Issued By
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredPayments.length === 0 ? (
                  <tr>
                    <td colSpan={financeLogTab === 'return' ? 14 : 13} className="px-6 py-12 text-center">
                      <p className="text-gray-500">
                        {searchTerm || filterBranch || filterFinanceApproval || filterPaymentMethod
                          ? 'No matching payments. Try adjusting your search or filters.'
                          : financeLogTab === 'return'
                            ? 'No payments you have returned to a branch yet.'
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
                      {formatDate(payment.issue_date)}
                    </td>
                    <td className="px-3 py-2.5 text-sm text-gray-900 min-w-0">
                      <div className="flex flex-col min-w-0">
                        <span className="font-medium truncate" title={payment.student_name || 'N/A'}>{payment.student_name || 'N/A'}</span>
                        {payment.student_email && (
                          <span className="text-xs text-gray-500 truncate" title={payment.student_email}>{payment.student_email}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-sm text-gray-700 min-w-0">
                      <span className="truncate block" title={payment.student_level_tag || '-'}>
                        {payment.student_level_tag || '-'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-sm text-gray-900 min-w-0">
                      <span className="truncate block" title={payment.invoice_description || '-'}>
                        {payment.invoice_description || '-'}
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
              {method === 'Acknowledgement Receipt' ? 'AR' : method}
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

      {/* Payment Status approval dropdown - portaled */}
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

      {/* Attachment viewer modal (portaled so overlay covers header) */}
      <PaymentAttachmentViewerModal
        open={showAttachmentViewer && Boolean(attachmentViewerUrl)}
        url={attachmentViewerUrl}
        onClose={() => {
          setShowAttachmentViewer(false);
          setAttachmentViewerUrl(null);
        }}
      />

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

      {/* Export Modal (portaled so overlay covers header) */}
      {showExportModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center backdrop-blur-sm bg-black/5 p-4" onClick={() => setShowExportModal(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Export Payment Logs</h2>
                <button
                  onClick={() => setShowExportModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                  disabled={exportLoading}
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Select Branches to Export</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Select at least one branch to include in the export. The Export button is disabled until you select a branch.
                </p>

                {/* Select All Button */}
                <div className="mb-4">
                  <button
                    onClick={handleSelectAllBranches}
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors text-sm font-medium"
                    disabled={exportLoading}
                  >
                    {selectedExportBranches.length === branches.length ? 'Deselect All' : 'Select All'}
                  </button>
                </div>

                {/* Branch List */}
                <div className="space-y-2 max-h-64 overflow-y-auto border border-gray-200 rounded-lg p-4">
                  {branches.length === 0 ? (
                    <p className="text-gray-500 text-center py-4">No branches available</p>
                  ) : (
                    branches.map((branch) => (
                      <label
                        key={branch.branch_id}
                        className="flex items-center gap-3 p-3 hover:bg-gray-50 rounded-lg cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedExportBranches.includes(branch.branch_id)}
                          onChange={() => handleExportBranchToggle(branch.branch_id)}
                          disabled={exportLoading}
                          className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                        />
                        <span className="text-gray-900">{branch.branch_nickname || branch.branch_name}</span>
                      </label>
                    ))
                  )}
                </div>

                {/* Export Info */}
                <div className={`mt-4 p-4 rounded-lg ${selectedExportBranches.length === 0 ? 'bg-amber-50' : 'bg-blue-50'}`}>
                  <p className={`text-sm ${selectedExportBranches.length === 0 ? 'text-amber-800' : 'text-blue-800'}`}>
                    <strong>Selected:</strong>{' '}
                    {selectedExportBranches.length === 0
                      ? 'No branches selected — select at least one to export'
                      : selectedExportBranches.length === branches.length
                      ? 'All Branches'
                      : `${selectedExportBranches.length} Branch${selectedExportBranches.length !== 1 ? 'es' : ''}`}
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowExportModal(false)}
                  disabled={exportLoading}
                  className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleExportToExcel}
                  disabled={exportLoading || branches.length === 0 || selectedExportBranches.length === 0}
                  className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {exportLoading ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Exporting...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Export to Excel
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default SuperfinancePaymentLogs;
