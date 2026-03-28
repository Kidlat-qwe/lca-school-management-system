import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';
import * as XLSX from 'xlsx';
import { formatDateManila, formatDateTimeManila } from '../../utils/dateUtils';
import FixedTablePagination from '../../components/table/FixedTablePagination';

const AdminPaymentLogs = () => {
  const { userInfo } = useAuth();
  // Get admin's branch_id from userInfo
  const adminBranchId = userInfo?.branch_id || userInfo?.branchId;
  const [selectedBranchName, setSelectedBranchName] = useState(userInfo?.branch_nickname || userInfo?.branch_name || 'Your Branch');
  const [exportLoading, setExportLoading] = useState(false);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  // Removed filterBranch - admin only sees their branch
  const [filterStatus, setFilterStatus] = useState('');
  const [filterIssueDateFrom, setFilterIssueDateFrom] = useState('');
  const [filterIssueDateTo, setFilterIssueDateTo] = useState('');
  const [filterPaymentMethod, setFilterPaymentMethod] = useState('');
  // Removed openBranchDropdown - admin only sees their branch
  const [openStatusDropdown, setOpenStatusDropdown] = useState(false);
  const [openPaymentMethodDropdown, setOpenPaymentMethodDropdown] = useState(false);
  const [statusDropdownRect, setStatusDropdownRect] = useState(null);
  const [paymentMethodDropdownRect, setPaymentMethodDropdownRect] = useState(null);
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
  const [endOfShiftLoading, setEndOfShiftLoading] = useState(false);
  const [todaySubmitted, setTodaySubmitted] = useState(false);
  const [endOfShiftModalOpen, setEndOfShiftModalOpen] = useState(false);
  const [endOfShiftPreview, setEndOfShiftPreview] = useState(null);
  const [endOfShiftSuccess, setEndOfShiftSuccess] = useState('');
  const [openActionsDropdown, setOpenActionsDropdown] = useState(false);
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [depositStartDate, setDepositStartDate] = useState('');
  const [depositEndDate, setDepositEndDate] = useState('');
  const [depositLoading, setDepositLoading] = useState(false);
  const [depositError, setDepositError] = useState('');
  const [depositData, setDepositData] = useState(null);
  const [depositSubmitLoading, setDepositSubmitLoading] = useState(false);
  const [depositExistingRanges, setDepositExistingRanges] = useState([]);
  const [depositRangesLoading, setDepositRangesLoading] = useState(false);
  const depositAlertRef = useRef('');

  // Today in Manila (YYYY-MM-DD) for end-of-shift
  const todayManila = () => {
    const now = new Date();
    const manila = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
    return manila.toISOString().split('T')[0];
  };

  const openDepositCashModal = () => {
    setDepositError('');
    setDepositData(null);
    setDepositExistingRanges([]);
    setDepositStartDate('');
    setDepositEndDate('');
    depositAlertRef.current = '';
    setDepositModalOpen(true);
  };

  const showDepositAlert = (message) => {
    setDepositError(message);
    if (depositAlertRef.current === message) return;
    depositAlertRef.current = message;
    alert(message);
  };

  const fetchExistingDepositRanges = async () => {
    setDepositRangesLoading(true);
    try {
      const res = await apiRequest('/cash-deposit-summaries?limit=200');
      setDepositExistingRanges(Array.isArray(res?.data) ? res.data : []);
    } catch (err) {
      console.error('Error fetching cash deposit ranges:', err);
      setDepositExistingRanges([]);
    } finally {
      setDepositRangesLoading(false);
    }
  };

  const getOverlappingDepositRange = (startDate, endDate) =>
    depositExistingRanges.find(
      (range) => range.start_date <= endDate && range.end_date >= startDate
    ) || null;

  const getRangeLabel = (range) =>
    range ? `${formatDateManila(range.start_date)} - ${formatDateManila(range.end_date)}` : '';

  const isDepositDateBlocked = (dateValue) =>
    !!depositExistingRanges.find(
      (range) => range.start_date <= dateValue && range.end_date >= dateValue
    );

  useEffect(() => {
    if (!depositModalOpen) return;
    fetchExistingDepositRanges();
  }, [depositModalOpen]);

  const fetchDepositCashSummary = async (startDate, endDate) => {
    setDepositLoading(true);
    setDepositError('');
    depositAlertRef.current = '';
    setDepositData(null);
    try {
      const params = new URLSearchParams({
        start_date: startDate,
        end_date: endDate,
      });
      const res = await apiRequest(`/payments/cash-deposit-summary?${params.toString()}`);
      setDepositData(res.data || null);
    } catch (err) {
      showDepositAlert(err?.message || 'Unable to load the cash deposit summary right now. Please try again.');
    } finally {
      setDepositLoading(false);
    }
  };

  useEffect(() => {
    if (!depositModalOpen) return;

    if (!depositStartDate || !depositEndDate) {
      setDepositError('');
      depositAlertRef.current = '';
      setDepositData(null);
      return;
    }

    if (depositStartDate > depositEndDate) {
      showDepositAlert('The start date must be earlier than or the same as the end date.');
      setDepositData(null);
      return;
    }

    const overlappingRange = getOverlappingDepositRange(depositStartDate, depositEndDate);
    if (overlappingRange) {
      showDepositAlert(
        `These dates were already included in a previous cash deposit summary (${getRangeLabel(overlappingRange)}). Please choose dates outside that deposited period.`
      );
      setDepositData(null);
      return;
    }

    fetchDepositCashSummary(depositStartDate, depositEndDate);
  }, [depositModalOpen, depositStartDate, depositEndDate, depositExistingRanges]);

  const submitDepositCashSummary = async () => {
    if (!depositData) {
      showDepositAlert('Please select a valid uncovered date range first.');
      return;
    }

    setDepositSubmitLoading(true);
    setDepositError('');
    depositAlertRef.current = '';

    try {
      await apiRequest('/cash-deposit-summaries', {
        method: 'POST',
        body: JSON.stringify({
          start_date: depositStartDate,
          end_date: depositEndDate,
        }),
      });

      alert('Cash deposit summary submitted successfully. Superadmin and Superfinance will verify your deposited cash.');
    } catch (err) {
      showDepositAlert(err?.message || 'Unable to submit this cash deposit summary. Please try again.');
    } finally {
      setDepositSubmitLoading(false);
    }
  };

  // Fetch branch name if not in userInfo
  useEffect(() => {
    const fetchBranchName = async () => {
      if (!userInfo?.branch_name && adminBranchId) {
        try {
          const response = await apiRequest(`/branches/${adminBranchId}`);
          if (response?.data) {
            const d = response.data;
            setSelectedBranchName(d.branch_nickname || d.branch_name || 'Your Branch');
          }
        } catch (err) {
          console.error('Error fetching branch name:', err);
        }
      } else if (userInfo?.branch_name || userInfo?.branch_nickname) {
        setSelectedBranchName(userInfo.branch_nickname || userInfo.branch_name);
      }
    };

    fetchBranchName();
  }, [userInfo, adminBranchId]);

  useEffect(() => {
    if (adminBranchId) {
      fetchPayments(1);
    }
  }, [adminBranchId]);

  const fetchEndOfShiftStatus = async () => {
    try {
      const [checkRes, previewRes] = await Promise.all([
        apiRequest('/daily-summary-sales/check-today'),
        apiRequest(`/daily-summary-sales/preview?date=${todayManila()}`),
      ]);
      setTodaySubmitted(checkRes?.success && checkRes?.data?.submitted === true);
      setEndOfShiftPreview(previewRes?.data || null);
    } catch (err) {
      console.error('End of shift status error:', err);
      setTodaySubmitted(false);
      setEndOfShiftPreview(null);
    }
  };

  useEffect(() => {
    if (adminBranchId) {
      fetchEndOfShiftStatus();
    }
  }, [adminBranchId]);

  const handleEndOfShiftClick = () => {
    setEndOfShiftSuccess('');
    setEndOfShiftModalOpen(true);
  };

  const handleEndOfShiftSubmit = async () => {
    setEndOfShiftLoading(true);
    setEndOfShiftSuccess('');
    try {
      await apiRequest('/daily-summary-sales', {
        method: 'POST',
        body: JSON.stringify({ summary_date: todayManila() }),
      });
      setEndOfShiftSuccess('Daily summary submitted successfully. Superadmin and Superfinance will verify your submission.');
      setTodaySubmitted(true);
      setEndOfShiftModalOpen(false);
      await fetchEndOfShiftStatus();
    } catch (err) {
      setEndOfShiftSuccess('');
      setError(err?.message || 'Failed to submit daily summary.');
    } finally {
      setEndOfShiftLoading(false);
    }
  };

  const isInitialMount = useRef(true);
  useEffect(() => {
    if (!adminBranchId) return;
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    fetchPayments(1);
  }, [filterStatus, filterIssueDateFrom, filterIssueDateTo]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      // Removed branch dropdown - admin only sees their branch
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
      if (openActionsDropdown && !event.target.closest('.actions-dropdown-container')) {
        setOpenActionsDropdown(false);
      }
    };

    if (openStatusDropdown || openPaymentMethodDropdown || openApprovalMenuId || openActionsDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [openStatusDropdown, openPaymentMethodDropdown, openApprovalMenuId, openActionsDropdown]);

  const userType = userInfo?.user_type || userInfo?.userType;
  const canApprovePayment = () => false;

  const openReferenceModal = (payment) => {
    setSelectedPaymentForReference(payment);
    setReferenceModalInput(''); // Re-typing enforces that the image is checked
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

    if (!originalRef) {
      alert('This payment has no reference number recorded yet. Please update it from the Record Payment modal.');
      return;
    }
    if (!enteredRef) {
      alert('Please enter the reference number exactly as shown on the receipt image.');
      return;
    }

    if (enteredRef !== originalRef) {
      alert('Reference number does not match the one originally recorded for this payment.\n\nPlease double-check the receipt and correct it before saving.');
      return;
    }

    const paymentId = selectedPaymentForReference.payment_id;
    setReferenceModalUpdating(true);
    try {
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
    } catch (err) {
      alert(err.message || 'Failed to save and approve payment.');
    } finally {
      setReferenceModalUpdating(false);
    }
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
    } catch (err) {
      setError(err.message || (approve ? 'Failed to approve payment' : 'Failed to revoke approval'));
    } finally {
      setApprovalLoadingId(null);
    }
  };

  const fetchPayments = async (page = 1) => {
    try {
      setLoading(true);
      const limit = 100;
      const params = new URLSearchParams({ limit: String(limit), page: String(page) });
      if (filterStatus) params.set('status', filterStatus);
      if (filterIssueDateFrom) params.set('issue_date_from', filterIssueDateFrom);
      if (filterIssueDateTo) params.set('issue_date_to', filterIssueDateTo);
      const response = await apiRequest(`/payments?${params.toString()}`);
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
      console.error('Error fetching payments:', err);
      setError('Failed to load payments. Please try again.');
      setPayments([]);
    } finally {
      setLoading(false);
    }
  };

  // Removed fetchBranches - admin only sees their branch
  // Removed getBranchName and formatBranchName - admin only sees their branch

  const formatDate = (dateString) => formatDateManila(dateString) || '-';

  const formatCurrency = (amount) => {
    if (!amount) return '₱0.00';
    return `₱${parseFloat(amount).toFixed(2)}`;
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
      'Credit Card': 'bg-purple-100 text-purple-800',
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

  const getUniqueStatuses = () => {
    const statuses = [...new Set(payments.map(p => p.status).filter(Boolean))];
    return statuses.sort();
  };

  const getUniquePaymentMethods = () => {
    const methods = [...new Set(payments.map(p => p.payment_method).filter(Boolean))];
    return methods.sort();
  };

  const filteredPayments = payments.filter((payment) => {
    const matchesSearch = !searchTerm || 
      payment.invoice_description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.student_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.reference_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.payment_id?.toString().includes(searchTerm);
    
    // Removed matchesBranch - admin only sees their branch
    const matchesStatus = !filterStatus || payment.status === filterStatus;
    const matchesPaymentMethod = !filterPaymentMethod || payment.payment_method === filterPaymentMethod;
    
    return matchesSearch && matchesStatus && matchesPaymentMethod;
  });

  const handleExportToExcel = async () => {
    try {
      setExportLoading(true);
      
      // Fetch all payments for admin's branch (paginate: backend limit max 100)
      const limit = 100;
      const allPayments = [];
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const params = new URLSearchParams({ limit: String(limit), page: String(page) });
        if (filterIssueDateFrom) params.set('issue_date_from', filterIssueDateFrom);
        if (filterIssueDateTo) params.set('issue_date_to', filterIssueDateTo);
        const res = await apiRequest(`/payments?${params.toString()}`);
        const data = res.data || [];
        allPayments.push(...data);
        const total = res.pagination?.total ?? 0;
        hasMore = allPayments.length < total;
        page += 1;
      }

      if (allPayments.length === 0) {
        alert('No payment records found to export.');
        setExportLoading(false);
        return;
      }

      // Prepare data for Excel
      const excelData = allPayments.map(payment => ({
        'Invoice ID': payment.invoice_id ? `INV-${payment.invoice_id}` : '-',
        'Invoice Description': payment.invoice_description || '-',
        'Student Name': payment.student_name || 'N/A',
        'Student Email': payment.student_email || '-',
        'Payment Method': payment.payment_method || '-',
        'Payment Type': payment.payment_type || '-',
        'Amount (₱)': payment.payable_amount ? parseFloat(payment.payable_amount).toFixed(2) : '0.00',
        'Status': payment.status || 'N/A',
        'Issue Date': payment.issue_date ? formatDate(payment.issue_date) : '-',
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
        { wch: 18 },  // Payment Method
        { wch: 18 },  // Payment Type
        { wch: 15 },  // Amount
        { wch: 12 },  // Status
        { wch: 15 },  // Issue Date
        { wch: 20 },  // Reference Number
        { wch: 30 },  // Remarks
      ];

      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(wb, ws, 'Payment Logs');

      // Generate filename with branch name
      const branchName = selectedBranchName.replace(/[^a-zA-Z0-9]/g, '_');
      const date = new Date().toISOString().split('T')[0];
      const filename = `Payment_Logs_${branchName}_${date}.xlsx`;

      // Save file
      XLSX.writeFile(wb, filename);

      setExportLoading(false);
    } catch (error) {
      console.error('Export error:', error);
      alert('Failed to export payment logs. Please try again.');
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Payment Logs</h1>
          <p className="text-sm text-gray-500 mt-1">View and manage all payment records</p>
        </div>
        <div className="relative actions-dropdown-container">
          <button
            type="button"
            onClick={() => setOpenActionsDropdown((prev) => !prev)}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors"
            aria-expanded={openActionsDropdown}
            aria-haspopup="true"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
            Actions
            <svg className={`w-4 h-4 transition-transform ${openActionsDropdown ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {openActionsDropdown && (
            <div
              className="absolute right-0 top-full mt-1 z-50 min-w-[200px] py-1 bg-white rounded-lg shadow-lg border border-gray-200"
              role="menu"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpenActionsDropdown(false);
                  handleEndOfShiftClick();
                }}
                disabled={todaySubmitted || endOfShiftLoading}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-amber-50 hover:text-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
                title={todaySubmitted ? 'Today\'s summary already submitted' : 'Submit all today\'s sales for closure'}
              >
                {endOfShiftLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-amber-600 border-t-transparent" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5 text-amber-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    End of Shift
                  </>
                )}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpenActionsDropdown(false);
                  handleExportToExcel();
                }}
                disabled={exportLoading}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-green-50 hover:text-green-700 disabled:opacity-50"
              >
                {exportLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-green-600 border-t-transparent" />
                    Exporting...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5 text-green-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Export to Excel
                  </>
                )}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpenActionsDropdown(false);
                  openDepositCashModal();
                }}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-sky-50 hover:text-sky-800"
              >
                <svg className="w-5 h-5 text-sky-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a1 1 0 11-2 0 1 1 0 012 0z" />
                </svg>
                Deposit Cash
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Deposit Cash — date range summary (server-side from payment logs) */}
      {depositModalOpen && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center backdrop-blur-sm bg-black/50 p-4"
          onClick={() => !depositLoading && !depositSubmitLoading && setDepositModalOpen(false)}
        >
          <div
            className="deposit-cash-modal-root bg-white rounded-xl shadow-xl max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-gray-200 shrink-0 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Deposit Cash</h3>
                <p className="mt-1 text-sm text-gray-600">
                  Sum of <strong>Cash</strong> payments by <strong>issue date</strong> for{' '}
                  <span className="whitespace-nowrap">{selectedBranchName}</span>. Matches your payment logs (same source as this page).
                </p>
              </div>
              <button
                type="button"
                onClick={() => !depositLoading && !depositSubmitLoading && setDepositModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-md self-start"
                aria-label="Close"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-5 py-4 border-b border-gray-100 shrink-0 space-y-3">
              <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:items-end">
                <div className="flex-1 min-w-[140px]">
                  <label className="block text-xs font-medium text-gray-600 mb-1">From (issue date)</label>
                  <input
                    type="date"
                    value={depositStartDate}
                    onChange={(e) => {
                      const nextValue = e.target.value;
                      if (nextValue && isDepositDateBlocked(nextValue)) {
                        const blockedRange = depositExistingRanges.find(
                          (range) => range.start_date <= nextValue && range.end_date >= nextValue
                        );
                        showDepositAlert(
                          `This date already belongs to a deposited period (${getRangeLabel(blockedRange)}). Please choose another date.`
                        );
                        return;
                      }
                      setDepositError('');
                      depositAlertRef.current = '';
                      setDepositStartDate(nextValue);
                      setDepositData(null);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    disabled={depositLoading || depositSubmitLoading || depositRangesLoading}
                  />
                </div>
                <div className="flex-1 min-w-[140px]">
                  <label className="block text-xs font-medium text-gray-600 mb-1">To (issue date)</label>
                  <input
                    type="date"
                    value={depositEndDate}
                    onChange={(e) => {
                      const nextValue = e.target.value;
                      if (nextValue && isDepositDateBlocked(nextValue)) {
                        const blockedRange = depositExistingRanges.find(
                          (range) => range.start_date <= nextValue && range.end_date >= nextValue
                        );
                        showDepositAlert(
                          `This date already belongs to a deposited period (${getRangeLabel(blockedRange)}). Please choose another date.`
                        );
                        return;
                      }
                      setDepositError('');
                      depositAlertRef.current = '';
                      setDepositEndDate(nextValue);
                      setDepositData(null);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    disabled={depositLoading || depositSubmitLoading || depositRangesLoading}
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500">
                <strong>Deposit amount</strong> uses Cash payments with status <strong>Completed</strong> only (ready to bank). The summary refreshes automatically after both dates are selected.
              </p>
              {depositExistingRanges.length > 0 && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Deposited periods cannot be reused:
                  {' '}
                  {depositExistingRanges
                    .map((range) => getRangeLabel(range))
                    .join(', ')}
                </div>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
              {depositData && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                    <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3">
                      <p className="text-xs font-medium text-sky-800 uppercase tracking-wide">Cash to deposit</p>
                      <p className="text-xl font-bold text-sky-900 mt-1">
                        {formatCurrency(depositData.total_cash_deposit_amount)}
                      </p>
                      <p className="text-xs text-sky-700 mt-1">{depositData.completed_cash_count ?? 0} completed payment(s)</p>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                      <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">All Cash (in range)</p>
                      <p className="text-xl font-bold text-gray-900 mt-1">
                        {formatCurrency(depositData.total_cash_all_amount)}
                      </p>
                      <p className="text-xs text-gray-600 mt-1">{depositData.payment_count ?? 0} row(s)</p>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
                      <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Period</p>
                      <p className="text-sm font-semibold text-gray-900 mt-2">
                        {depositData.start_date} → {depositData.end_date}
                      </p>
                    </div>
                  </div>

                  <p className="text-sm font-medium text-gray-800 mb-2">Payment lines (Cash only)</p>
                  <div
                    className="overflow-x-auto rounded-lg border border-gray-200"
                    style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}
                  >
                    <table className="divide-y divide-gray-200 text-sm" style={{ width: '100%', minWidth: '860px' }}>
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Issue date</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Invoice</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Student</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Payment Method</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Amount</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Status</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Reference</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {(depositData.payments || []).length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                              No Cash payments in this date range.
                            </td>
                          </tr>
                        ) : (
                          depositData.payments.map((p) => (
                            <tr key={p.payment_id} className="hover:bg-gray-50/80">
                              <td className="px-3 py-2 whitespace-nowrap text-gray-700">{formatDate(p.issue_date)}</td>
                              <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-900">
                                {p.invoice_id ? `INV-${p.invoice_id}` : '-'}
                              </td>
                              <td className="px-3 py-2 text-gray-800 min-w-0 max-w-[200px]">
                                <span className="truncate block" title={p.student_name || '-'}>{p.student_name || '-'}</span>
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap text-gray-700">
                                {p.payment_method || '-'}
                              </td>
                              <td className="px-3 py-2 text-right font-semibold text-green-600 whitespace-nowrap">
                                {formatCurrency(p.payable_amount)}
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap">{getStatusBadge(p.status)}</td>
                              <td className="px-3 py-2 text-gray-600 min-w-0 max-w-[140px]">
                                <span className="truncate block" title={p.reference_number || '-'}>{p.reference_number || '-'}</span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {!depositData && !depositLoading && !depositError && (
                <p className="text-sm text-gray-500 text-center py-8">Choose both dates to load totals from the server automatically.</p>
              )}
            </div>

            <div className="px-5 py-3 border-t border-gray-200 shrink-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <p className="text-xs text-gray-500">
                After you confirm this period, submit it so Superadmin can review the actual office cash deposit.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={submitDepositCashSummary}
                  disabled={depositLoading || depositSubmitLoading || !depositData}
                  className="px-4 py-2 text-sm font-medium text-white bg-sky-600 rounded-lg hover:bg-sky-700 disabled:opacity-50"
                >
                  {depositSubmitLoading ? 'Submitting...' : 'Submit for Confirmation'}
                </button>
                <button
                  type="button"
                  onClick={() => !depositLoading && !depositSubmitLoading && setDepositModalOpen(false)}
                  disabled={depositLoading || depositSubmitLoading}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* End of Shift Success */}
      {endOfShiftSuccess && (
        <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg">
          {endOfShiftSuccess}
        </div>
      )}

      {/* End of Shift Confirmation Modal */}
      {endOfShiftModalOpen && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center backdrop-blur-sm bg-black/50 p-4" onClick={() => !endOfShiftLoading && setEndOfShiftModalOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 shrink-0">End of Shift</h3>
            <p className="mt-2 text-sm text-gray-600 shrink-0">
              Submit all today&apos;s sales for proper closure? This will send the daily summary to Superadmin, Finance, and Superfinance for verification.
            </p>
            <p className="mt-1 text-sm font-medium text-gray-700 shrink-0">
              Date & time: {formatDateTimeManila(new Date())} (Manila)
            </p>
            {endOfShiftPreview && (
              <>
                <p className="mt-2 text-sm font-medium text-gray-800 shrink-0">
                  Today&apos;s total: ₱{(endOfShiftPreview.total_amount ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({endOfShiftPreview.payment_count ?? 0} payment(s))
                </p>
                {Array.isArray(endOfShiftPreview.payments) && endOfShiftPreview.payments.length > 0 && (
                  <div className="mt-4 shrink-0">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Records to be submitted</p>
                    <div
                      className="overflow-x-auto rounded-lg border border-gray-200"
                      style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}
                    >
                      <table className="text-sm" style={{ width: '100%', minWidth: '520px' }}>
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Invoice</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Student</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Reference</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 bg-white">
                          {endOfShiftPreview.payments.map((p) => (
                            <tr key={p.payment_id} className="hover:bg-gray-50/80">
                              <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">
                                {p.invoice_id ? `INV-${p.invoice_id}` : '-'}
                              </td>
                              <td className="px-3 py-2 text-gray-700 min-w-0 max-w-[140px]">
                                <span className="truncate block" title={p.student_name || '-'}>{p.student_name || '-'}</span>
                              </td>
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{p.payment_method || '-'}</td>
                              <td className="px-3 py-2 text-right font-semibold text-green-600 whitespace-nowrap">
                                {formatCurrency(p.payable_amount)}
                              </td>
                              <td className="px-3 py-2 text-gray-500 min-w-0 max-w-[100px]">
                                <span className="truncate block" title={p.reference_number || '-'}>{p.reference_number || '-'}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {Array.isArray(endOfShiftPreview.payments) && endOfShiftPreview.payments.length === 0 && endOfShiftPreview.payment_count === 0 && (
                  <p className="mt-3 text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    No payments recorded for today. You can still submit to close the day with zero sales.
                  </p>
                )}
              </>
            )}
            <div className="mt-6 flex justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => !endOfShiftLoading && setEndOfShiftModalOpen(false)}
                disabled={endOfShiftLoading}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleEndOfShiftSubmit}
                disabled={endOfShiftLoading}
                className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50"
              >
                {endOfShiftLoading ? 'Submitting...' : 'Submit'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Payment Logs List */}
      <div className="bg-white rounded-lg shadow">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end px-3 sm:px-4 py-3 border-b border-gray-200 bg-gray-50/90">
          <div className="flex flex-col gap-1 min-w-0">
            <label htmlFor="admin-payment-logs-issue-date-from" className="text-xs font-medium text-gray-600">
              From
            </label>
            <input
              id="admin-payment-logs-issue-date-from"
              type="date"
              value={filterIssueDateFrom}
              onChange={(e) => setFilterIssueDateFrom(e.target.value)}
              className="min-h-[40px] px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white w-full max-w-[11rem]"
            />
          </div>
          <div className="flex flex-col gap-1 min-w-0">
            <label htmlFor="admin-payment-logs-issue-date-to" className="text-xs font-medium text-gray-600">
              To
            </label>
            <input
              id="admin-payment-logs-issue-date-to"
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
        <div className="rounded-lg overflow-hidden">
          <table className="divide-y divide-gray-200 w-full" style={{ tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '12%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '14%' }} />
              </colgroup>
              <thead className="bg-gray-50 table-header-stable">
                <tr>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[12%]">
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
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[14%]">
                    STUDENT
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
                    TYPE
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[8%]">
                    AMOUNT
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[14%]">
                    <div className="relative status-filter-dropdown">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          setStatusDropdownRect(rect);
                          setOpenStatusDropdown(!openStatusDropdown);
                          setOpenPaymentMethodDropdown(false);
                          setPaymentMethodDropdownRect(null);
                        }}
                        className="flex items-center space-x-1 hover:text-gray-700"
                      >
                        <span>Payment Status</span>
                        <span className={`inline-flex items-center justify-center w-1.5 h-1.5 rounded-full flex-shrink-0 ${filterStatus ? 'bg-primary-600' : 'invisible'}`} aria-hidden />
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[12%]">
                    Branch
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[9%]">
                    DATE
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[14%]">
                    REFERENCE
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredPayments.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-12 text-center">
                      <p className="text-gray-500">
                        {searchTerm || filterStatus || filterPaymentMethod
                          ? 'No matching payments. Try adjusting your search or filters.'
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
                    <td className="px-3 py-2.5 text-sm text-gray-900 min-w-0">
                      <div className="flex flex-col min-w-0">
                        <span className="font-medium truncate" title={payment.student_name || 'N/A'}>{payment.student_name || 'N/A'}</span>
                        {payment.student_email && (
                          <span className="text-xs text-gray-500 truncate" title={payment.student_email}>{payment.student_email}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-sm min-w-0">
                      {getPaymentMethodBadge(payment.payment_method)}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-sm text-gray-900 min-w-0">
                      {payment.payment_type || '-'}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-sm font-semibold text-green-600 min-w-0">
                      {formatCurrency(payment.payable_amount)}
                    </td>
                    <td className="px-3 py-2.5 text-sm payment-status-cell align-top min-w-0 overflow-hidden">
                      <div className="min-w-0 max-w-full">
                        {approvalLoadingId === payment.payment_id ? (
                          <span className="text-gray-400 text-xs">Updating...</span>
                        ) : (() => {
                          const isApproved = (payment.approval_status || 'Pending') === 'Approved';
                          const canApprove = canApprovePayment(payment);
                          const showDropdown = openApprovalMenuId === payment.payment_id;
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
                                className={`inline-flex items-center gap-1 max-w-full px-2 py-1 rounded-md text-xs font-medium cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1 shrink-0 hover:ring-2 hover:ring-primary-300 ${isApproved ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}
                                title={isApproved ? 'Only Superadmin, Superfinance, or Finance can approve' : 'Click to update reference number'}
                              >
                                <span className="truncate">{isApproved ? 'Approved' : 'Pending Approval'}</span>
                                {!isApproved && (
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
                    <td className="px-3 py-2.5 text-sm text-gray-900 align-top min-w-0">
                      <span className="truncate block" title={selectedBranchName || '-'}>{selectedBranchName || '-'}</span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-sm text-gray-500 min-w-0">
                      {formatDate(payment.issue_date)}
                    </td>
                    <td className="px-3 py-2.5 text-sm text-gray-500 min-w-0">
                      <span className="truncate block" title={payment.reference_number || '-'}>{payment.reference_number || '-'}</span>
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
                  <label className="block text-sm font-medium text-gray-700 mb-2">Reference Number</label>
                  <input
                    type="text"
                    value={referenceModalInput}
                    onChange={(e) => setReferenceModalInput(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    placeholder="Enter reference number (e.g. cash voucher, receipt no.)"
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

      {/* Attachment viewer modal (portaled so overlay covers header) */}
      {showAttachmentViewer && attachmentViewerUrl && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center backdrop-blur-sm bg-black/5 p-4"
          onClick={() => { setShowAttachmentViewer(false); setAttachmentViewerUrl(null); }}
        >
          <div
            className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center px-4 py-2 border-b border-gray-200">
              <span className="text-sm font-medium text-gray-700">Payment attachment</span>
              <button
                type="button"
                onClick={() => { setShowAttachmentViewer(false); setAttachmentViewerUrl(null); }}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 min-h-0 p-4 overflow-auto flex items-center justify-center">
              {/\.(jpe?g|png|gif|webp|bmp)(\?|$)/i.test(attachmentViewerUrl) ? (
                <img
                  src={attachmentViewerUrl}
                  alt="Payment attachment"
                  className="max-w-full max-h-[75vh] w-auto object-contain rounded-lg"
                />
              ) : (
                <iframe
                  src={attachmentViewerUrl}
                  title="Payment attachment"
                  className="w-full min-h-[70vh] border-0 rounded-lg bg-gray-100"
                />
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

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

      {/* Status filter dropdown - portaled to avoid table overflow clipping */}
      {openStatusDropdown && statusDropdownRect && createPortal(
        <div
          className="fixed status-filter-dropdown-portal w-48 bg-white rounded-md shadow-lg z-[100] border border-gray-200 max-h-60 overflow-y-auto py-1"
          style={{
            top: `${statusDropdownRect.bottom + 4}px`,
            left: `${statusDropdownRect.left}px`,
            minWidth: `${Math.max(statusDropdownRect.width, 192)}px`,
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setFilterStatus('');
              setOpenStatusDropdown(false);
              setStatusDropdownRect(null);
            }}
            className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
              !filterStatus ? 'bg-gray-100 font-medium' : 'text-gray-700'
            }`}
          >
            All Statuses
          </button>
          {getUniqueStatuses().map((status) => (
            <button
              key={status}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setFilterStatus(status);
                setOpenStatusDropdown(false);
                setStatusDropdownRect(null);
              }}
              className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
                filterStatus === status ? 'bg-gray-100 font-medium' : 'text-gray-700'
              }`}
            >
              {status}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
};

export default AdminPaymentLogs;

