import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';
import * as XLSX from 'xlsx';
import { appendPaymentLogsAmountTotalRow } from '../../utils/paymentLogsExcelExport';
import { formatDateManila, formatDateTimeManila } from '../../utils/dateUtils';
import FixedTablePagination from '../../components/table/FixedTablePagination';
import { appAlert } from '../../utils/appAlert';
import { uploadInvoicePaymentImage } from '../../utils/uploadInvoicePaymentImage';
import { BranchPaymentLogTabs } from '../../components/paymentLogs/PaymentLogsViewTabs';
import PaymentAttachmentViewerModal from '../../components/paymentLogs/PaymentAttachmentViewerModal';
import StandardExportModal from '../../components/export/StandardExportModal';
import PaymentLogsExportDateRange from '../../components/export/PaymentLogsExportDateRange';

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

const CASH_DEPOSIT_WARNING_THRESHOLD = 100000;

const AdminPaymentLogs = () => {
  const location = useLocation();
  const { userInfo } = useAuth();
  // Get admin's branch_id from userInfo
  const adminBranchId = userInfo?.branch_id || userInfo?.branchId;
  const [branchLogTab, setBranchLogTab] = useState(() => {
    const params = new URLSearchParams(location.search);
    return params.get('notificationTab') === 'return' ? 'return' : 'main';
  });
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
  const [returnFixRemarks, setReturnFixRemarks] = useState('');
  const [selectedBranchName, setSelectedBranchName] = useState(userInfo?.branch_nickname || userInfo?.branch_name || 'Your Branch');
  const [exportLoading, setExportLoading] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportPaymentDateFrom, setExportPaymentDateFrom] = useState('');
  const [exportPaymentDateTo, setExportPaymentDateTo] = useState('');
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  // Removed filterBranch - admin only sees their branch
  const [filterFinanceApproval, setFilterFinanceApproval] = useState('');
  const [filterIssueDateFrom, setFilterIssueDateFrom] = useState('');
  const [filterIssueDateTo, setFilterIssueDateTo] = useState('');
  const [filterPaymentMethod, setFilterPaymentMethod] = useState('');
  const [showAdvancedPaymentLogFilters, setShowAdvancedPaymentLogFilters] = useState(false);
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
  const [filterTotalLineAmount, setFilterTotalLineAmount] = useState(null);
  const [listRefreshing, setListRefreshing] = useState(false);
  const initialDataLoadedRef = useRef(false);
  /** Total items in Return queue for current filters — Return tab badge */
  const [returnedPaymentLogCount, setReturnedPaymentLogCount] = useState(null);
  const [endOfShiftLoading, setEndOfShiftLoading] = useState(false);
  const [endOfShiftModalOpen, setEndOfShiftModalOpen] = useState(false);
  const [endOfShiftPreview, setEndOfShiftPreview] = useState(null);
  const [endOfShiftSuccess, setEndOfShiftSuccess] = useState('');
  const [endOfShiftAlreadySubmitted, setEndOfShiftAlreadySubmitted] = useState(false);
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
  const [depositReferenceNumber, setDepositReferenceNumber] = useState('');
  const [depositAttachmentUrl, setDepositAttachmentUrl] = useState('');
  const [depositAttachmentUploading, setDepositAttachmentUploading] = useState(false);
  const depositAlertRef = useRef('');
  const depositThresholdAlertRef = useRef('');
  const latestFetchIdRef = useRef(0);
  const quickActionHandledRef = useRef(false);

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
    setDepositReferenceNumber('');
    setDepositAttachmentUrl('');
    setDepositAttachmentUploading(false);
    depositAlertRef.current = '';
    depositThresholdAlertRef.current = '';
    setDepositModalOpen(true);
  };

  const uploadDepositAttachment = async (file) => {
    if (!file) return;
    setDepositAttachmentUploading(true);
    try {
      const imageUrl = await uploadInvoicePaymentImage(file);
      if (!imageUrl) throw new Error('Upload returned empty URL');
      setDepositAttachmentUrl(imageUrl);
      appAlert('Deposit proof image uploaded.');
    } catch (err) {
      console.error('Deposit attachment upload:', err);
      appAlert(err?.message || 'Failed to upload deposit proof image.');
    } finally {
      setDepositAttachmentUploading(false);
    }
  };

  const showDepositAlert = (message) => {
    setDepositError(message);
    if (depositAlertRef.current === message) return;
    depositAlertRef.current = message;
    appAlert(message);
  };

  const fetchExistingDepositRanges = async () => {
    setDepositRangesLoading(true);
    try {
      const [res, defaultsRes] = await Promise.all([
        apiRequest('/cash-deposit-summaries?limit=200'),
        apiRequest('/cash-deposit-summaries/deposit-defaults'),
      ]);
      const ranges = Array.isArray(res?.data) ? res.data : [];
      setDepositExistingRanges(ranges);

      const today = todayManila();
      const serverDefaultStart = defaultsRes?.data?.default_start_date || '';
      const latestRange = [...ranges].sort((a, b) => String(b.end_date).localeCompare(String(a.end_date)))[0] || null;
      const computedStart = serverDefaultStart || latestRange?.end_date || today;
      const finalStart = computedStart && computedStart <= today ? computedStart : today;

      setDepositStartDate(finalStart);
      setDepositEndDate(today);
    } catch (err) {
      console.error('Error fetching cash deposit ranges:', err);
      setDepositExistingRanges([]);
      const today = todayManila();
      setDepositStartDate(today);
      setDepositEndDate(today);
    } finally {
      setDepositRangesLoading(false);
    }
  };

  const getOverlappingDepositRange = (startDate, endDate) =>
    depositExistingRanges.find(
      (range) => range.start_date < endDate && range.end_date > startDate
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

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const notificationTab = params.get('notificationTab');
    if (notificationTab === 'main' || notificationTab === 'return') {
      setBranchLogTab(notificationTab);
    }
    const financeApproval = params.get('financeApproval');
    if (financeApproval === 'approved' || financeApproval === 'pending') {
      setFilterFinanceApproval(financeApproval);
    } else if (financeApproval === 'all' || financeApproval === '') {
      setFilterFinanceApproval('');
    }
    const payFrom = (params.get('payment_date_from') || params.get('issue_date_from') || '').trim().slice(0, 10);
    const payTo = (params.get('payment_date_to') || params.get('issue_date_to') || '').trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(payFrom)) {
      setFilterIssueDateFrom(payFrom);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(payTo)) {
      setFilterIssueDateTo(payTo);
    }
  }, [location.search]);

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

  useEffect(() => {
    if (!depositModalOpen || !depositData) return;
    const totalDepositAmount = Number(depositData.total_cash_deposit_amount || 0);
    if (totalDepositAmount < CASH_DEPOSIT_WARNING_THRESHOLD) return;

    const rangeKey = `${depositData.start_date || ''}_${depositData.end_date || ''}_${totalDepositAmount}`;
    if (depositThresholdAlertRef.current === rangeKey) return;
    depositThresholdAlertRef.current = rangeKey;

    appAlert(
      `Alert: Your branch is now holding ${formatCurrency(totalDepositAmount)} in cash for deposit, which is at/above the ₱${CASH_DEPOSIT_WARNING_THRESHOLD.toLocaleString('en-US')} threshold. Please process bank deposit submission promptly.`
    );
  }, [depositModalOpen, depositData]);

  const submitDepositCashSummary = async () => {
    if (!depositData) {
      showDepositAlert('Please select a valid uncovered date range first.');
      return;
    }

    const refTrim = depositReferenceNumber.trim();
    const attTrim = depositAttachmentUrl.trim();

    if (!refTrim) {
      showDepositAlert('Reference number is required before submitting cash deposit.');
      return;
    }

    if (!attTrim) {
      showDepositAlert('Deposit proof image is required before submitting cash deposit.');
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
          reference_number: refTrim,
          deposit_attachment_url: attTrim,
        }),
      });

      appAlert('Cash deposit summary submitted successfully. Superadmin and Superfinance will verify your deposited cash.');
      setDepositModalOpen(false);
      setDepositData(null);
      setDepositStartDate('');
      setDepositEndDate('');
      setDepositReferenceNumber('');
      setDepositAttachmentUrl('');
      setDepositAttachmentUploading(false);
      setDepositError('');
      depositAlertRef.current = '';
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
      setEndOfShiftPreview(previewRes?.data || null);
      setEndOfShiftAlreadySubmitted(!!checkRes?.data?.submitted);
    } catch (err) {
      console.error('End of shift status error:', err);
      setEndOfShiftPreview(null);
      setEndOfShiftAlreadySubmitted(false);
    }
  };

  useEffect(() => {
    if (adminBranchId) {
      fetchEndOfShiftStatus();
    }
  }, [adminBranchId]);

  useEffect(() => {
    if (!adminBranchId || quickActionHandledRef.current) return;

    const params = new URLSearchParams(location.search);
    const quickAction = (params.get('quickAction') || '').trim();
    if (!quickAction) return;

    if (quickAction === 'cashDeposit') {
      openDepositCashModal();
      quickActionHandledRef.current = true;
      return;
    }

    if (quickAction === 'endOfShift') {
      handleEndOfShiftClick();
      quickActionHandledRef.current = true;
    }
  }, [adminBranchId, location.search, endOfShiftAlreadySubmitted]);

  const handleEndOfShiftClick = () => {
    if (endOfShiftAlreadySubmitted) {
      appAlert('End of day has already been submitted for today. Only one submission per branch per day is allowed.');
      return;
    }
    setEndOfShiftSuccess('');
    setEndOfShiftModalOpen(true);
  };

  const buildEodSummaryAlertMessage = (previewData) => {
    const summaryDate = todayManila();
    const totalAmount = Number(previewData?.total_amount || 0).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const paymentCount = Number(previewData?.completed_payment_count ?? previewData?.payment_count ?? 0);
    const arCount = Number(previewData?.ar_sales_count || 0);

    return [
      'End of Shift submitted successfully.',
      '',
      'Summary Notes',
      `Branch: ${selectedBranchName || 'Your Branch'}`,
      `Date: ${formatDateManila(summaryDate)}`,
      `Completed Payments: ${paymentCount}`,
      `Acknowledgement Receipt Sales: ${arCount}`,
      `Total Sales: ₱${totalAmount}`,
      '',
      'Your EOD has been forwarded to Superadmin and Finance for monitoring.',
    ].join('\n');
  };

  const handleEndOfShiftSubmit = async () => {
    setEndOfShiftLoading(true);
    setEndOfShiftSuccess('');
    try {
      await apiRequest('/daily-summary-sales', {
        method: 'POST',
        body: JSON.stringify({ summary_date: todayManila() }),
      });
      setEndOfShiftSuccess('Daily summary submitted successfully and is awaiting verification.');
      setEndOfShiftAlreadySubmitted(true);
      setEndOfShiftModalOpen(false);
      appAlert(buildEodSummaryAlertMessage(endOfShiftPreview));
      await fetchEndOfShiftStatus();
    } catch (err) {
      setEndOfShiftSuccess('');
      const msg = err?.response?.data?.message || err?.message || 'Failed to submit daily summary.';
      setError(msg);
      if (err?.response?.status === 409) {
        setEndOfShiftAlreadySubmitted(true);
      }
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
  }, [filterFinanceApproval, filterIssueDateFrom, filterIssueDateTo, branchLogTab, filterPaymentMethod]);

  useEffect(() => {
    if (branchLogTab === 'return') {
      setOpenStatusDropdown(false);
      setStatusDropdownRect(null);
    }
  }, [branchLogTab]);

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
      appAlert('This payment has no reference number recorded yet. Please update it from the Record Payment modal.');
      return;
    }
    if (!enteredRef) {
      appAlert('Please enter the reference number exactly as shown on the receipt image.');
      return;
    }

    if (enteredRef !== originalRef) {
      appAlert('Reference number does not match the one originally recorded for this payment.\n\nPlease double-check the receipt and correct it before saving.');
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
      await fetchReturnedPaymentLogCount();
    } catch (err) {
      appAlert(err.message || 'Failed to save and approve payment.');
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
      await fetchReturnedPaymentLogCount();
    } catch (err) {
      setError(err.message || (approve ? 'Failed to approve payment' : 'Failed to revoke approval'));
    } finally {
      setApprovalLoadingId(null);
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
    setReturnFixRemarks('');
  };

  const getReturnFixReleaseCap = () => {
    if (!returnFixInvoiceSummary || !returnFixPayment) return null;
    const b = getInvoiceBreakdownForReturnFix(returnFixInvoiceSummary);
    const linePayable = parseFloat(returnFixPayment.payable_amount) || 0;
    return Math.max(0, b.remaining + linePayable);
  };

  const handleReturnFixInputChange = (e) => {
    const { name, value } = e.target;
    const inv = returnFixInvoiceSummary;
    const payment = returnFixPayment;
    const releaseCap = inv && payment ? getReturnFixReleaseCap() : null;

    if (name === 'payment_type') {
      if (value === 'Full Payment' && releaseCap != null && releaseCap > 0) {
        setReturnFixPaymentType(value);
        setReturnFixPayableAmount(releaseCap.toFixed(2));
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
      if (returnFixPaymentType === 'Partial Payment' && releaseCap != null && releaseCap > 0 && Number(value) >= releaseCap) {
        return;
      }
      setReturnFixPayableAmount(value);
      return;
    }

    if (name === 'tip_amount') {
      setReturnFixTipAmount(value);
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
    const cap = Math.max(0, b.remaining + linePayable);
    if (cap > 0) {
      setReturnFixPayableAmount(cap.toFixed(2));
    }
  }, [returnFixInvoiceSummary, returnFixPayment, returnFixPaymentType]);

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
        const releaseCap = Math.max(0, b.remaining + linePayable);
        if (releaseCap > 0 && payableNum >= releaseCap) {
          appAlert('For partial payment, amount must be less than the remaining invoice amount for this line.');
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
      if (adminBranchId) params.set('branch_id', String(adminBranchId));
      if (filterIssueDateFrom) params.set('payment_date_from', filterIssueDateFrom);
      if (filterIssueDateTo) params.set('payment_date_to', filterIssueDateTo);
      if (filterPaymentMethod) params.set('payment_method', filterPaymentMethod);
      if (branchLogTab === 'return') {
        params.set('my_return_queue', 'true');
      } else if (filterFinanceApproval === 'approved') {
        params.set('status', 'Completed');
        params.set('approval_status', 'Approved');
        params.set('exclude_approval_status', 'Returned');
      } else if (filterFinanceApproval === 'pending') {
        params.set('status', 'Completed');
        params.set('exclude_approval_status', 'Approved,Returned');
      } else {
        params.set('status', 'Completed');
      }
      const response = await apiRequest(`/payments?${params.toString()}`);
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

  const fetchReturnedPaymentLogCount = async () => {
    if (!adminBranchId) return;
    try {
      const params = new URLSearchParams({ limit: '1', page: '1' });
      params.set('branch_id', String(adminBranchId));
      if (filterIssueDateFrom) params.set('payment_date_from', filterIssueDateFrom);
      if (filterIssueDateTo) params.set('payment_date_to', filterIssueDateTo);
      if (filterPaymentMethod) params.set('payment_method', filterPaymentMethod);
      params.set('my_return_queue', 'true');
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
    if (!adminBranchId) return;
    fetchReturnedPaymentLogCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminBranchId, filterIssueDateFrom, filterIssueDateTo, filterPaymentMethod]);

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

  const formatInvoiceIssuedBy = (payment) => {
    const invoiceName = (payment?.invoice_issued_by_name || '').trim();
    const invoiceEmail = (payment?.invoice_issued_by_email || '').trim();
    const paymentName = (payment?.payment_created_by_name || '').trim();
    const paymentEmail = (payment?.payment_created_by_email || '').trim();
    if (invoiceName) return invoiceName;
    if (invoiceEmail) return invoiceEmail;
    if (paymentName) return paymentName;
    if (paymentEmail) return paymentEmail;
    if (payment?.created_by) return `User #${payment.created_by}`;
    if (!payment?.student_id) return 'Walk-in / Acknowledgement Receipt';
    return 'System';
  };

  const getUniquePaymentMethods = () => {
    const methods = [...new Set(payments.map(p => p.payment_method).filter(Boolean))];
    return methods.sort();
  };

  const filteredPayments = payments.filter((payment) => {
    const matchesSearch = !searchTerm || 
      payment.invoice_description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.student_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.invoice_ar_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.reference_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.payment_id?.toString().includes(searchTerm);
    
    // Removed matchesBranch - admin only sees their branch
    const matchesFinanceApproval =
      branchLogTab === 'return' ||
      !filterFinanceApproval ||
      (filterFinanceApproval === 'approved' &&
        (payment.approval_status || 'Pending') === 'Approved') ||
      (filterFinanceApproval === 'pending' &&
        (payment.approval_status || 'Pending') !== 'Approved');
    return matchesSearch && matchesFinanceApproval;
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
    searchTerm || filterPaymentMethod || filterFinanceApproval || filterIssueDateFrom || filterIssueDateTo
  );

  const resetPaymentLogFilters = () => {
    setSearchTerm('');
    setFilterPaymentMethod('');
    setFilterFinanceApproval('');
    setFilterIssueDateFrom('');
    setFilterIssueDateTo('');
    fetchPayments(1);
  };

  const exportPaymentDateRangeInvalid =
    Boolean(exportPaymentDateFrom && exportPaymentDateTo) && exportPaymentDateFrom > exportPaymentDateTo;

  const handleExportToExcel = async (opts = {}) => {
    const { closeModalAfter = false } = opts;
    let wroteFile = false;
    if (exportPaymentDateRangeInvalid) {
      appAlert('"From" date must be on or before "To" date.');
      return;
    }
    if (branchLogTab === 'return') {
      appAlert('Returned payments are not included in exports. Please switch to the main tab to export.');
      return;
    }
    try {
      setExportLoading(true);

      // Fetch all payments for admin's branch (paginate: backend limit max 100)
      const limit = 100;
      const allPayments = [];
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const params = new URLSearchParams({ limit: String(limit), page: String(page) });
        if (adminBranchId) params.set('branch_id', String(adminBranchId));
        if (exportPaymentDateFrom) params.set('payment_date_from', exportPaymentDateFrom);
        if (exportPaymentDateTo) params.set('payment_date_to', exportPaymentDateTo);
        // Always exclude payments returned by Finance.
        params.set('exclude_approval_status', 'Returned');
        if (filterFinanceApproval === 'approved') {
          params.set('status', 'Completed');
          params.set('approval_status', 'Approved');
        } else if (filterFinanceApproval === 'pending') {
          params.set('status', 'Completed');
          params.set('exclude_approval_status', 'Approved,Returned');
        } else {
          params.set('status', 'Completed');
        }
        const res = await apiRequest(`/payments?${params.toString()}`);
        const data = res.data || [];
        allPayments.push(...data);
        const total = res.pagination?.total ?? 0;
        hasMore = allPayments.length < total;
        page += 1;
      }

      if (allPayments.length === 0) {
        appAlert('No payment records found to export.');
        return;
      }

      // Prepare data for Excel
      const excelData = allPayments.map((payment) => {
        const payable = parseFloat(payment.payable_amount) || 0;
        const tip = parseFloat(payment.tip_amount) || 0;
        const uiStatus =
          branchLogTab === 'return'
            ? (payment.approval_status || payment.status || 'Returned')
            : ((payment.approval_status || 'Pending') === 'Approved' ? 'Approved' : 'Pending Approval');
        const row = {
          'Invoice ID': payment.invoice_id ? `INV-${payment.invoice_id}` : '-',
          BRANCH: selectedBranchName || getBranchName(payment.branch_id) || payment.branch_name || 'N/A',
          'Issue Date': payment.issue_date ? formatDate(payment.issue_date) : '-',
          'Payment Date': payment.payment_date ? formatDate(payment.payment_date) : '-',
          'Student Name': payment.student_name || 'N/A',
          'PACKAGE/ITEM': payment.invoice_description || '-',
          'LEVEL TAG': payment.student_level_tag || '-',
          'PAYMENT METHOD': payment.payment_method || '-',
          AMOUNT: Math.round(payable * 100) / 100,
          'TOTAL AMOUNT': Math.round((payable + tip) * 100) / 100,
          Status: uiStatus,
        };
        if (branchLogTab === 'return') {
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

      // Set column widths
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
      widthList.push(
        22, // Reference#
        24, // Acknowledgement Receipt#
        22 // Issued by
      );
      ws['!cols'] = widthList.map((wch) => ({ wch }));

      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(wb, ws, 'Payment Logs');

      // Generate filename with branch name
      const branchName = selectedBranchName.replace(/[^a-zA-Z0-9]/g, '_');
      const date = new Date().toISOString().split('T')[0];
      const filename = `Payment_Logs_${branchName}_${date}.xlsx`;

      // Save file
      XLSX.writeFile(wb, filename);
      wroteFile = true;
    } catch (error) {
      console.error('Export error:', error);
      appAlert('Failed to export payment logs. Please try again.');
    } finally {
      setExportLoading(false);
      if (closeModalAfter && wroteFile) setShowExportModal(false);
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
            View and manage payment records for your branch. Use the <span className="font-medium text-gray-800">Return</span>{' '}
            tab when Finance sent a payment back for a reference or attachment fix — update the details, then resubmit for
            verification.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => {
              setExportPaymentDateFrom(filterIssueDateFrom || '');
              setExportPaymentDateTo(filterIssueDateTo || '');
              setShowExportModal(true);
            }}
            disabled={exportLoading}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-60"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 16V4m0 12l-4-4m4 4l4-4M4 20h16" />
            </svg>
            {exportLoading ? 'Exporting...' : 'Export to Excel'}
          </button>
          <div className="relative actions-dropdown-container shrink-0">
          <button
            type="button"
            onClick={() => setOpenActionsDropdown((prev) => !prev)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors"
            aria-expanded={openActionsDropdown}
            aria-haspopup="true"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                disabled={endOfShiftLoading || endOfShiftAlreadySubmitted}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-amber-50 hover:text-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
                title={
                  endOfShiftAlreadySubmitted
                    ? 'EOD already submitted for today'
                    : "Submit all today's sales for closure"
                }
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
      </div>

      <div className="w-full">
        <BranchPaymentLogTabs value={branchLogTab} onChange={setBranchLogTab} returnBadgeCount={returnedPaymentLogCount} />
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">Search Filter</p>
            <p className="text-xs text-gray-500">
              Filter payment logs before the table. Branch scope is limited to your assigned branch.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="xl:col-span-2">
            <label htmlFor="admin-payment-log-search" className="mb-1 block text-xs font-medium text-gray-700">
              Search
            </label>
            <input
              id="admin-payment-log-search"
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Invoice, student, reference, acknowledgement receipt, or issued by"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
          <div>
            <label htmlFor="admin-payment-method-filter" className="mb-1 block text-xs font-medium text-gray-700">
              Payment Method
            </label>
            <select
              id="admin-payment-method-filter"
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
            <label htmlFor="admin-payment-status-filter" className="mb-1 block text-xs font-medium text-gray-700">
              Status
            </label>
            {branchLogTab === 'return' ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                Returned only
              </div>
            ) : (
              <select
                id="admin-payment-status-filter"
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
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <label htmlFor="admin-payment-date-from" className="mb-1 block text-xs font-medium text-gray-700">
                Payment date from
              </label>
              <input
                id="admin-payment-date-from"
                type="date"
                value={filterIssueDateFrom}
                onChange={(e) => setFilterIssueDateFrom(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
            <div>
              <label htmlFor="admin-payment-date-to" className="mb-1 block text-xs font-medium text-gray-700">
                Payment date to
              </label>
              <input
                id="admin-payment-date-to"
                type="date"
                value={filterIssueDateTo}
                onChange={(e) => setFilterIssueDateTo(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
          </div>
        ) : null}
        <div className="mt-4 flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-gray-500">
            Date range is inclusive on payment date. Leave both dates empty for all dates.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={() => setShowAdvancedPaymentLogFilters((current) => !current)}
              className="inline-flex items-center justify-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-primary-700 hover:bg-primary-50"
              aria-expanded={showAdvancedPaymentLogFilters}
            >
              {showAdvancedPaymentLogFilters ? 'Hide advanced filters' : 'Advanced filters'}
              <svg className={`h-4 w-4 transition-transform ${showAdvancedPaymentLogFilters ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={resetPaymentLogFilters}
              disabled={!hasPaymentLogFilters}
              className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => fetchPayments(1)}
              className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
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
                  Sum of <strong>Cash</strong> payments by <strong>payment date</strong> for{' '}
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
                  <label className="block text-xs font-medium text-gray-600 mb-1">From (payment date)</label>
                  <input
                    type="date"
                    value={depositStartDate}
                    readOnly
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    disabled
                  />
                </div>
                <div className="flex-1 min-w-[140px]">
                  <label className="block text-xs font-medium text-gray-600 mb-1">To (payment date)</label>
                  <input
                    type="date"
                    value={depositEndDate}
                    readOnly
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    disabled
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Reference Number <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={depositReferenceNumber}
                    onChange={(e) => setDepositReferenceNumber(e.target.value)}
                    placeholder="Enter deposit slip / transaction number"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    disabled={depositSubmitLoading}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Deposit Proof Image <span className="text-red-500">*</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <label className={`px-3 py-2 text-xs sm:text-sm rounded-lg border border-gray-300 bg-white hover:bg-gray-50 cursor-pointer ${depositSubmitLoading ? 'opacity-50 cursor-not-allowed' : ''}`}>
                      {depositAttachmentUploading ? 'Uploading...' : (depositAttachmentUrl ? 'Replace Image' : 'Upload Image')}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={depositSubmitLoading || depositAttachmentUploading}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (file) await uploadDepositAttachment(file);
                          e.target.value = '';
                        }}
                      />
                    </label>
                    {depositAttachmentUrl && (
                      <button
                        type="button"
                        onClick={() => {
                          setAttachmentViewerUrl(depositAttachmentUrl);
                          setShowAttachmentViewer(true);
                        }}
                        className="px-3 py-2 text-xs sm:text-sm rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200"
                      >
                        View
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    Upload the deposit slip / bank proof image before submission.
                  </p>
                  {depositAttachmentUrl && (
                    <div className="mt-2">
                      <img
                        src={depositAttachmentUrl}
                        alt="Deposit proof preview"
                        className="h-24 w-24 object-cover rounded-lg border border-gray-200"
                      />
                    </div>
                  )}
                </div>
              </div>
              <p className="text-xs text-gray-500">
                <strong>Deposit amount</strong> uses Cash payments with status <strong>Completed</strong> only (ready to bank). The selected range follows the payment date shown in payment logs. Cash rows already included in prior submitted or verified deposits are excluded.
              </p>
              {depositExistingRanges.length > 0 && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Previous deposited periods:
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
                  {Number(depositData.total_cash_deposit_amount || 0) >= CASH_DEPOSIT_WARNING_THRESHOLD && (
                    <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                      <p className="text-sm font-semibold text-red-800">Cash Deposit Threshold Alert</p>
                      <p className="text-xs text-red-700 mt-1">
                        This branch is currently holding {formatCurrency(depositData.total_cash_deposit_amount)} in cash for deposit
                        (threshold: ₱{CASH_DEPOSIT_WARNING_THRESHOLD.toLocaleString('en-US')}). Please submit the deposit promptly.
                      </p>
                    </div>
                  )}
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
                    <table className="divide-y divide-gray-200 text-sm" style={{ width: '100%', minWidth: '940px' }}>
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Payment date</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Invoice</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Student</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Payment Method</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Amount</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Status</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Acknowledgement Receipt#</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Reference</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {(depositData.payments || []).length === 0 ? (
                          <tr>
                            <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                              No Cash payments in this date range.
                            </td>
                          </tr>
                        ) : (
                          depositData.payments.map((p) => (
                            <tr key={p.payment_id} className="hover:bg-gray-50/80">
                              <td className="px-3 py-2 whitespace-nowrap text-gray-700">{formatDate(p.payment_date || p.issue_date)}</td>
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
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                                {p.invoice_ar_number || '—'}
                              </td>
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
                  disabled={depositLoading || depositSubmitLoading || depositAttachmentUploading || !depositData}
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center backdrop-blur-sm bg-black/50 p-3 sm:p-4" onClick={() => !endOfShiftLoading && setEndOfShiftModalOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-[min(1440px,calc(100vw-2rem))] max-h-[92vh] flex flex-col p-5 sm:p-7 min-w-0" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 shrink-0">End of Shift</h3>
            <p className="mt-2 text-sm text-gray-600 shrink-0">
              Submit all today&apos;s sales for proper closure? This will submit your branch EOD for Finance/Superfinance verification, email Superadmin and Finance (org-wide summary: submitted branches and branches not yet submitted), and send a confirmation to branch Admin email(s) on file.
            </p>
            <p className="mt-1 text-xs text-primary-700 bg-primary-50 border border-primary-200 rounded-lg px-3 py-2 shrink-0">
              One submission per day: totals include completed payments and standalone acknowledgement receipts with{' '}
              <strong>issue date today</strong> for your branch. You cannot submit again until tomorrow.
            </p>
            <p className="mt-1 text-sm font-medium text-gray-700 shrink-0">
              Date & time: {formatDateTimeManila(new Date())} (Manila)
            </p>
            {endOfShiftPreview && (
              <>
                <p className="mt-2 text-sm font-medium text-gray-800 shrink-0">
                  Today&apos;s total: ₱{(endOfShiftPreview.total_amount ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({Number(endOfShiftPreview.completed_payment_count ?? 0)} completed payment row(s),{' '}
                  {Number(endOfShiftPreview.ar_sales_count ?? 0)} standalone acknowledgement receipt(s))
                </p>
                <p className="mt-1 text-xs text-gray-500 shrink-0">
                  Collected per row is payable plus tip (matches today&apos;s total). Invoice total is the invoice document amount from line items (or manual invoice amount).
                </p>
                {Array.isArray(endOfShiftPreview.payments) && endOfShiftPreview.payments.length > 0 && (
                  <div className="mt-4 shrink-0 min-w-0 flex flex-col overflow-hidden">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                      Payment records (issue date today)
                    </p>
                    <div className="rounded-lg border border-gray-200 min-w-0 overflow-hidden">
                      <table className="w-full table-fixed border-collapse text-[11px] sm:text-xs">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="w-[9%] py-2.5 ps-4 pe-3 text-left text-[10px] sm:text-[11px] font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Invoice</th>
                            <th className="w-[9%] py-2.5 px-3 text-left text-[10px] sm:text-[11px] font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Date</th>
                            <th className="w-[17%] py-2.5 px-3 text-left text-[10px] sm:text-[11px] font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Student</th>
                            <th className="w-[10%] py-2.5 px-3 text-left text-[10px] sm:text-[11px] font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Level tag</th>
                            <th className="w-[11%] py-2.5 px-3 text-left text-[10px] sm:text-[11px] font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Payment method</th>
                            <th className="w-[11%] py-2.5 px-3 text-right text-[10px] sm:text-[11px] font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Inv total</th>
                            <th className="w-[12%] py-2.5 px-3 text-right text-[10px] sm:text-[11px] font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Collected</th>
                            <th className="w-[11%] py-2.5 px-3 text-center text-[10px] sm:text-[11px] font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Attached image</th>
                            <th className="w-[10%] py-2.5 ps-3 pe-4 text-left text-[10px] sm:text-[11px] font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">Reference</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white">
                          {endOfShiftPreview.payments.map((p) => {
                            const tip = parseFloat(p.tip_amount) || 0;
                            const payable = parseFloat(p.payable_amount) || 0;
                            const collected = payable + tip;
                            const invTotal = p.invoice_document_total;
                            const attUrl = (p.payment_attachment_url || '').trim();
                            return (
                              <tr key={p.payment_id} className="hover:bg-gray-50/80 border-b border-gray-100 last:border-b-0">
                                <td className="py-2.5 ps-4 pe-3 font-medium text-gray-900 truncate align-top" title={p.invoice_id ? `INV-${p.invoice_id}` : ''}>
                                  {p.invoice_id ? `INV-${p.invoice_id}` : '-'}
                                </td>
                                <td className="py-2.5 px-3 text-gray-700 truncate align-top" title={p.invoice_date ? formatDate(p.invoice_date) : ''}>
                                  {p.invoice_date ? formatDate(p.invoice_date) : '-'}
                                </td>
                                <td className="py-2.5 px-3 text-gray-700 min-w-0 align-top">
                                  <span className="truncate block" title={p.student_name || '-'}>{p.student_name || '-'}</span>
                                </td>
                                <td className="py-2.5 px-3 text-gray-700 min-w-0 align-top">
                                  <span className="truncate block" title={p.student_level_tag || '-'}>{p.student_level_tag || '-'}</span>
                                </td>
                                <td className="py-2.5 px-3 text-gray-700 truncate align-top" title={p.payment_method || ''}>{p.payment_method || '-'}</td>
                                <td className="py-2.5 px-3 text-right font-medium text-gray-800 tabular-nums align-top truncate" title={invTotal != null && invTotal !== '' ? formatCurrency(invTotal) : ''}>
                                  {invTotal != null && invTotal !== '' ? formatCurrency(invTotal) : '—'}
                                </td>
                                <td className="py-2.5 px-3 text-right align-top min-w-0">
                                  <div className="font-semibold text-green-600 tabular-nums">{formatCurrency(collected)}</div>
                                  {tip > 0 && (
                                    <div className="text-[10px] text-gray-500 mt-0.5 leading-tight">
                                      {formatCurrency(payable)} + tip {formatCurrency(tip)}
                                    </div>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-center align-top whitespace-nowrap">
                                  {attUrl ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setAttachmentViewerUrl(attUrl);
                                        setShowAttachmentViewer(true);
                                      }}
                                      className="text-xs font-medium text-primary-600 hover:text-primary-800 hover:underline"
                                    >
                                      View
                                    </button>
                                  ) : (
                                    <span className="text-gray-400">—</span>
                                  )}
                                </td>
                                <td className="py-2.5 ps-3 pe-4 text-gray-500 min-w-0 align-top">
                                  <span className="truncate block" title={p.reference_number || '-'}>{p.reference_number || '-'}</span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {Array.isArray(endOfShiftPreview.ar_receipts) && endOfShiftPreview.ar_receipts.length > 0 && (
                  <div className="mt-4 shrink-0 min-w-0 flex flex-col overflow-hidden">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                      Standalone Acknowledgement Receipt sales (issue date today)
                    </p>
                    <div
                      className="rounded-lg border border-gray-200 min-w-0 overflow-x-auto"
                      style={{
                        scrollbarWidth: 'thin',
                        scrollbarColor: '#cbd5e0 #f7fafc',
                        WebkitOverflowScrolling: 'touch',
                      }}
                    >
                      <table className="w-full border-collapse text-[11px] sm:text-xs" style={{ minWidth: '680px' }}>
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="py-2.5 ps-4 pe-3 text-left text-[10px] sm:text-[11px] font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
                              Receipt
                            </th>
                            <th className="py-2.5 px-3 text-left text-[10px] sm:text-[11px] font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
                              Issue date
                            </th>
                            <th className="py-2.5 px-3 text-left text-[10px] sm:text-[11px] font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
                              Prospect
                            </th>
                            <th className="py-2.5 px-3 text-left text-[10px] sm:text-[11px] font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
                              Level tag
                            </th>
                            <th className="py-2.5 px-3 text-left text-[10px] sm:text-[11px] font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
                              Method
                            </th>
                            <th className="py-2.5 px-3 text-right text-[10px] sm:text-[11px] font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
                              Collected
                            </th>
                            <th className="py-2.5 px-3 text-center text-[10px] sm:text-[11px] font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
                              Attached image
                            </th>
                            <th className="py-2.5 ps-3 pe-4 text-left text-[10px] sm:text-[11px] font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
                              Reference
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white">
                          {endOfShiftPreview.ar_receipts.map((a) => {
                            const tip = parseFloat(a.tip_amount) || 0;
                            const pamt = parseFloat(a.payment_amount) || 0;
                            const collected = pamt + tip;
                            const attUrl = (a.payment_attachment_url || '').trim();
                            return (
                              <tr key={a.ack_receipt_id} className="hover:bg-gray-50/80 border-b border-gray-100 last:border-b-0">
                                <td className="py-2.5 ps-4 pe-3 font-medium text-gray-900 truncate align-top" title={a.ack_receipt_number || ''}>
                                  {a.ack_receipt_number || `#${a.ack_receipt_id}`}
                                </td>
                                <td className="py-2.5 px-3 text-gray-700 truncate align-top" title={a.issue_date ? formatDate(a.issue_date) : ''}>
                                  {a.issue_date ? formatDate(a.issue_date) : '—'}
                                </td>
                                <td className="py-2.5 px-3 text-gray-700 min-w-0 align-top">
                                  <span className="truncate block" title={a.prospect_student_name || '-'}>
                                    {a.prospect_student_name || '—'}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 text-gray-700 min-w-0 align-top">
                                  <span className="truncate block" title={a.program_level_tag || a.level_tag || '-'}>
                                    {a.program_level_tag || a.level_tag || '—'}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 text-gray-700 truncate align-top">{a.payment_method || '—'}</td>
                                <td className="py-2.5 px-3 text-right align-top min-w-0">
                                  <div className="font-semibold text-green-600 tabular-nums">{formatCurrency(collected)}</div>
                                  {tip > 0 && (
                                    <div className="text-[10px] text-gray-500 mt-0.5 leading-tight">
                                      {formatCurrency(pamt)} + tip {formatCurrency(tip)}
                                    </div>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-center align-top whitespace-nowrap">
                                  {attUrl ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setAttachmentViewerUrl(attUrl);
                                        setShowAttachmentViewer(true);
                                      }}
                                      className="text-xs font-medium text-primary-600 hover:text-primary-800 hover:underline"
                                    >
                                      View
                                    </button>
                                  ) : (
                                    <span className="text-gray-400">—</span>
                                  )}
                                </td>
                                <td className="py-2.5 ps-3 pe-4 text-gray-500 min-w-0 align-top">
                                  <span className="truncate block" title={a.reference_number || '-'}>
                                    {a.reference_number || '—'}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {Number(endOfShiftPreview.completed_payment_count ?? 0) === 0 &&
                  Number(endOfShiftPreview.ar_sales_count ?? 0) === 0 && (
                  <p className="mt-3 text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    No completed payments or standalone acknowledgement receipt for today. You can still submit to close the day with zero sales.
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
                disabled={endOfShiftLoading || endOfShiftAlreadySubmitted}
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
              {branchLogTab === 'return' ? (
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
                    {branchLogTab === 'return' ? 'Return Status' : 'Status'}
                  </th>
                  {branchLogTab === 'return' ? (
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
                    ISSUED BY
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredPayments.length === 0 ? (
                  <tr>
                    <td colSpan={branchLogTab === 'return' ? 15 : 14} className="px-6 py-12 text-center">
                      <p className="text-gray-500">
                        {searchTerm || filterFinanceApproval || filterPaymentMethod
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
                    <td className="px-3 py-2.5 text-sm text-gray-900 align-top min-w-0">
                      <span className="truncate block" title={selectedBranchName || '-'}>{selectedBranchName || '-'}</span>
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
                        ) : approvalLoadingId === payment.payment_id ? (
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
                    {branchLogTab === 'return' ? (
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
                      id="admin_return_fix_payment_method"
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

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                        returnFixPaymentType === 'Partial Payment' && getReturnFixReleaseCap() != null && getReturnFixReleaseCap() > 0
                          ? Math.max(0, getReturnFixReleaseCap() - 0.01).toFixed(2)
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
                    {returnFixPaymentType === 'Partial Payment' && getReturnFixReleaseCap() != null && getReturnFixReleaseCap() > 0 && (
                      <p className="text-xs text-amber-600 mt-1">
                        Partial payment must be lower than{' '}
                        <span className="font-medium">₱{getReturnFixReleaseCap().toFixed(2)}</span> (remaining + this line).
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="label-field text-xs">Tip / Excess Amount (Optional)</label>
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
                  <div className="sm:col-span-2">
                    <label className="label-field text-xs">
                      Issue Date <span className="text-red-500">*</span>
                    </label>
                    <p className="text-xs text-gray-500 mb-1">
                      Defaults to the original payment date; change only if the receipt shows a different date.
                    </p>
                    <input
                      id="admin_return_fix_issue_date"
                      type="date"
                      value={returnFixIssueDate}
                      onChange={(e) => setReturnFixIssueDate(e.target.value)}
                      disabled={returnFixLoading || returnFixAttachmentUploading}
                      className="input-field text-sm"
                      required
                    />
                  </div>
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
                    const enteredAmount = parseFloat(returnFixPayableAmount || 0) || 0;
                    const payableToApply = Math.max(0, Math.min(enteredAmount, breakdown.remaining + linePayable));
                    const projectedPaid = breakdown.paidAmount - linePayable + payableToApply;
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
                          <div className="flex justify-between gap-2">
                            <span className="text-gray-600">Discount</span>
                            <span className="text-gray-900 shrink-0">- ₱{breakdown.discount.toFixed(2)}</span>
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
                            <span className="text-gray-900 shrink-0">₱{payableToApply.toFixed(2)}</span>
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

      <StandardExportModal
        open={showExportModal}
        onClose={() => setShowExportModal(false)}
        title="Export Payment Logs"
        description={
          <>
            Exports payment rows for <span className="font-medium">{selectedBranchName}</span> using the same tab
            (main or return) and approval filters as this page. Set payment dates below for this export only (optional).
          </>
        }
        exportLoading={exportLoading}
        onExport={() => handleExportToExcel({ closeModalAfter: true })}
        exportDisabled={exportPaymentDateRangeInvalid}
        maxWidthClass="max-w-lg"
        scrollable
        overlayZClass="z-[9999]"
      >
        <PaymentLogsExportDateRange
          idPrefix="admin-pl-export"
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
      </StandardExportModal>
    </div>
  );
};

export default AdminPaymentLogs;

