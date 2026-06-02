import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import API_BASE_URL, { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';
import {
  downloadInvoiceExportXlsx,
  fetchUnpaidInvoicesForPaymentDateExport,
  getInvoiceExportCollectedAmount,
  INVOICE_EXPORT_COL_WIDTHS,
  INVOICE_EXPORT_DEFAULT_STATUSES,
  mapCompletedPaymentsToExportRows,
  mapUnpaidInvoiceToPaymentExportRow,
  PAYMENT_DATE_EXPORT_COL_WIDTHS,
  shouldIncludeInvoiceByStatuses,
  shouldIncludePaymentByInvoiceStatuses,
} from '../../utils/invoiceExcelExport.js';
import { fetchAllPaymentsForExport, PaymentExportAlignMode } from '../../utils/fetchAllPaymentsForExport.js';
import {
  formatDateManila,
  todayManilaYMD,
} from '../../utils/dateUtils';
import { paymentAndIssueDateFilterUtil as invoiceDateFilterUtil, DATE_FILTER_MODES, clearInactivePaymentIssueDateModeFields } from '../../utils/dateFilterModes';
import { buildInvoiceListRequestParams } from '../../utils/invoiceListApiParams';
import useDebouncedValue from '../../hooks/useDebouncedValue';
import FixedTablePagination from '../../components/table/FixedTablePagination';
import { appAlert, appConfirm } from '../../utils/appAlert';
import StandardExportModal from '../../components/export/StandardExportModal';
import SortableHeader from '../../components/table/SortableHeader';
import PaymentRecordedInvoiceSummaryModal from '../../components/invoices/PaymentRecordedInvoiceSummaryModal';
import InvoiceStatusMultiFilter from '../../components/invoices/InvoiceStatusMultiFilter';
import { sortRows, toggleSortConfig } from '../../utils/tableSorting';
import {
  getInvoiceRowRejectedPaymentOverlay,
  isInvoiceFocusedFromPaymentLogs,
  isInvoiceListFocused,
  useInvoiceFocusFromQuery,
  useOpenInvoiceFromPaymentLogsNavigation,
  useScrollToFocusedInvoiceRow,
} from '../../utils/invoiceFocusNavigation';
import { InvoiceArNumberLink } from '../../components/billing/BillingCrossLinks';
import {
  getInitialInvoiceSearchFromParams,
  hasInvoiceCrossLinkParam,
} from '../../utils/billingListCrossLink';

const ITEMS_PER_PAGE = 10;

const DEFAULT_INVOICE_FILTER_MONTH = invoiceDateFilterUtil.defaultMonth();

const getInvoiceDisplayAmount = (invoice) => {
  if (!invoice) return 0;
  const remainingAmount = Number(invoice.amount ?? 0);
  const paidAmount = Number(invoice.paid_amount ?? 0);
  const billedAmount = remainingAmount + paidAmount;
  return billedAmount > 0 ? billedAmount : remainingAmount;
};

/** Header summary total: billed face + all tips on completed payments for this invoice. */
const getInvoiceSummaryAmountIncludingTips = (invoice) =>
  getInvoiceDisplayAmount(invoice) + (Number(invoice?.total_tip_amount) || 0);

const AdminInvoice = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { userInfo } = useAuth();
  const billingUserType = userInfo?.user_type || userInfo?.userType || 'Admin';
  // Get admin's branch_id from userInfo
  const adminBranchId = userInfo?.branch_id || userInfo?.branchId;
  const [selectedBranchName, setSelectedBranchName] = useState(userInfo?.branch_nickname || userInfo?.branch_name || 'Your Branch');
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nameSearchTerm, setNameSearchTerm] = useState(() =>
    getInitialInvoiceSearchFromParams(searchParams)
  );
  const [studentNameSearch, setStudentNameSearch] = useState('');
  const debouncedNameSearch = useDebouncedValue(nameSearchTerm, 300);
  const debouncedStudentNameSearch = useDebouncedValue(studentNameSearch, 300);
  // Removed filterBranch - admin only sees their branch
  const [filterStatuses, setFilterStatuses] = useState([]);
  // Date filter: Month | Payment date | Issue Date.
  // Default mode = MONTH, default month = current Manila month.
  const [dateFilterMode, setDateFilterMode] = useState(invoiceDateFilterUtil.DEFAULT_MODE);
  const [filterIssueMonth, setFilterIssueMonth] = useState(DEFAULT_INVOICE_FILTER_MONTH);
  const [filterPaymentDateFrom, setFilterPaymentDateFrom] = useState('');
  const [filterPaymentDateTo, setFilterPaymentDateTo] = useState('');
  const [filterIssueDateFrom, setFilterIssueDateFrom] = useState('');
  const [filterIssueDateTo, setFilterIssueDateTo] = useState('');

  const handleInvoiceListDateFilterModeChange = (nextMode) => {
    if (nextMode === dateFilterMode) return;
    setDateFilterMode(nextMode);
    clearInactivePaymentIssueDateModeFields(nextMode, {
      setPaymentFrom: setFilterPaymentDateFrom,
      setPaymentTo: setFilterPaymentDateTo,
      setIssueFrom: setFilterIssueDateFrom,
      setIssueTo: setFilterIssueDateTo,
    });
  };

  const clearInvoiceListDateFilters = useCallback(() => {
    setDateFilterMode(invoiceDateFilterUtil.DEFAULT_MODE);
    setFilterIssueMonth('');
    setFilterPaymentDateFrom('');
    setFilterPaymentDateTo('');
    setFilterIssueDateFrom('');
    setFilterIssueDateTo('');
  }, []);

  const mergeInvoiceIntoList = useCallback((invoice) => {
    setInvoices((prev) => {
      if (prev.some((row) => Number(row.invoice_id) === Number(invoice.invoice_id))) {
        return prev;
      }
      return [invoice, ...prev];
    });
  }, []);

  const [sortConfig, setSortConfig] = useState(null);

  const [openMenuId, setOpenMenuId] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  // Removed openBranchDropdown - admin only sees their branch
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState(null);
  // Removed branches state - admin only sees their branch
  const [students, setStudents] = useState([]);
  const [formData, setFormData] = useState({
    branch_id: '',
    amount: '',
    status: 'Draft',
    remarks: '',
    issue_date: '',
    due_date: '',
    items: [],
    students: [],
  });
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedInvoiceForDetails, setSelectedInvoiceForDetails] = useState(null);
  const [newItem, setNewItem] = useState({
    description: '',
    amount: '',
    tax_item: '',
    tax_percentage: '',
    discount_amount: '',
    penalty_amount: '',
  });
  const [newStudentId, setNewStudentId] = useState('');
  const [packageDetails, setPackageDetails] = useState({}); // Store package details by package name
  const [editingStatus, setEditingStatus] = useState(false);
  const [tempStatus, setTempStatus] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedInvoiceForPayment, setSelectedInvoiceForPayment] = useState(null);
  const [paymentFormData, setPaymentFormData] = useState({
    student_id: '',
    payment_method: 'Cash',
    payment_type: '',
    payable_amount: '',
    tip_amount: '',
    discount_amount: '',
    issue_date: todayManilaYMD(),
    reference_number: '',
    remarks: '',
    attachment_url: '',
  });
  const [paymentFormErrors, setPaymentFormErrors] = useState({});
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [paymentAttachmentUploading, setPaymentAttachmentUploading] = useState(false);
  const [paymentRecordedSummary, setPaymentRecordedSummary] = useState(null);
  const [paymentRecordedPdfLoading, setPaymentRecordedPdfLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [listPagination, setListPagination] = useState({
    page: 1,
    limit: ITEMS_PER_PAGE,
    total: 0,
    totalPages: 1,
  });
  const [serverStatusCounts, setServerStatusCounts] = useState({});
  const [listFilterSummary, setListFilterSummary] = useState(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportDateFrom, setExportDateFrom] = useState('');
  const [exportDateTo, setExportDateTo] = useState('');
  const [exportSelectedStatuses, setExportSelectedStatuses] = useState(
    INVOICE_EXPORT_DEFAULT_STATUSES
  );
  const [exportLoading, setExportLoading] = useState(false);
  const invoiceListFetchSeqRef = useRef(0);
  const suppressAutoListFetchRef = useRef(hasInvoiceCrossLinkParam(searchParams));

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
    // Don't fetch branches for admin - they only see their branch
    if (adminBranchId) {
      fetchStudents();
    }
  }, [adminBranchId]);

  // Auto-set branch_id from adminBranchId when available
  useEffect(() => {
    if (adminBranchId && isModalOpen && !editingInvoice) {
      setFormData(prev => ({
        ...prev,
        branch_id: adminBranchId.toString(),
      }));
    }
  }, [adminBranchId, isModalOpen, editingInvoice]);

  // Fetch package details by package name
  const fetchPackageDetails = async (packageName) => {
    if (packageDetails[packageName]) {
      return packageDetails[packageName];
    }

    try {
      const response = await apiRequest('/packages?limit=1000');
      const packages = response.data || [];
      const packageData = packages.find(pkg => pkg.package_name === packageName);
      
      if (packageData) {
        setPackageDetails(prev => ({
          ...prev,
          [packageName]: packageData.details || []
        }));
        return packageData.details || [];
      }
      return [];
    } catch (err) {
      console.error('Error fetching package details:', err);
      return [];
    }
  };

  // Get expanded invoice items (package + inclusions)
  const getExpandedInvoiceItems = async (items) => {
    const expandedItems = [];
    
    for (const item of items) {
      // Check if item is a package
      if (item.description && item.description.startsWith('Package:')) {
        const packageName = item.description.replace('Package:', '').trim();
        expandedItems.push(item); // Add the package item itself
        
        // Fetch and add package details
        const details = await fetchPackageDetails(packageName);
        for (const detail of details) {
          if (detail.pricing_name) {
            expandedItems.push({
              invoice_item_id: `pricing-${detail.packagedtl_id}`,
              description: `Pricing: ${detail.pricing_name}`,
              amount: null, // No price for pricing list
              isInclusion: true
            });
          } else if (detail.merchandise_name) {
            expandedItems.push({
              invoice_item_id: `merchandise-${detail.packagedtl_id}`,
              description: `Merchandise: ${detail.merchandise_name}${detail.size ? ` (${detail.size})` : ''}`,
              amount: null, // No price for merchandise
              isInclusion: true
            });
          }
        }
      } else {
        expandedItems.push(item);
      }
    }
    
    return expandedItems;
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (openMenuId && !event.target.closest('.action-menu-container') && !event.target.closest('.action-menu-overlay')) {
        setOpenMenuId(null);
      }
      // Removed openBranchDropdown - admin only sees their branch
    };

    if (openMenuId) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [openMenuId]);

  const handleMenuClick = (invoiceId, event) => {
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    
    if (openMenuId === invoiceId) {
      setOpenMenuId(null);
      setMenuPosition({ top: 0, right: 0 });
    } else {
      // Calculate available space
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;
      const estimatedDropdownHeight = 250; // Approximate height for 5 menu items
      const dropdownWidth = 192; // w-48 = 12rem = 192px
      
      // Determine vertical position (above or below)
      let top, bottom;
      if (spaceBelow >= estimatedDropdownHeight) {
        // Enough space below - position below button with small gap (4px)
        top = rect.bottom + 4;
        bottom = 'auto';
      } else if (spaceAbove >= estimatedDropdownHeight) {
        // Not enough space below, but enough above - position above button
        bottom = viewportHeight - rect.top + 4;
        top = 'auto';
      } else {
        // Not enough space in either direction - use the side with more space
        if (spaceBelow > spaceAbove) {
          top = rect.bottom + 4;
          bottom = 'auto';
        } else {
          bottom = viewportHeight - rect.top + 4;
          top = 'auto';
        }
      }
      
      // Determine horizontal position (right or left)
      let right, left;
      right = viewportWidth - rect.right;
      left = 'auto';
      
      setMenuPosition({
        top: top !== 'auto' ? top : undefined,
        bottom: bottom !== 'auto' ? bottom : undefined,
        right: right !== 'auto' ? right : undefined,
        left: left !== 'auto' ? left : undefined,
      });
      setOpenMenuId(invoiceId);
    }
  };

  const fetchInvoices = useCallback(
    async (page = 1, options = {}) => {
      invoiceListFetchSeqRef.current += 1;
      const fetchSeq = invoiceListFetchSeqRef.current;
      try {
        setLoading(true);
        const params = buildInvoiceListRequestParams({
          page,
          limit: ITEMS_PER_PAGE,
          branchId: adminBranchId,
          statuses: filterStatuses,
          dateFilterMode: options.skipDateFilters ? invoiceDateFilterUtil.DEFAULT_MODE : dateFilterMode,
          month: options.skipDateFilters ? '' : filterIssueMonth,
          paymentFrom: options.skipDateFilters ? '' : filterPaymentDateFrom,
          paymentTo: options.skipDateFilters ? '' : filterPaymentDateTo,
          issueFrom: options.skipDateFilters ? '' : filterIssueDateFrom,
          issueTo: options.skipDateFilters ? '' : filterIssueDateTo,
          search: options.searchOverride ?? debouncedNameSearch,
          studentSearch: options.skipStudentSearch ? '' : debouncedStudentNameSearch,
        });
        const response = await apiRequest(`/invoices?${params.toString()}`);
        if (fetchSeq !== invoiceListFetchSeqRef.current) return;
        setInvoices(response.data || []);
        setServerStatusCounts(response.statusCounts || {});
        setListFilterSummary(response.filterSummary || null);
        if (response.pagination) {
          setListPagination({
            page: response.pagination.page,
            limit: response.pagination.limit,
            total: response.pagination.total,
            totalPages: response.pagination.totalPages || 1,
          });
          setCurrentPage(response.pagination.page);
        } else {
          setListPagination({
            page: 1,
            limit: ITEMS_PER_PAGE,
            total: (response.data || []).length,
            totalPages: 1,
          });
          setCurrentPage(1);
        }
        setError('');
      } catch (err) {
        if (fetchSeq !== invoiceListFetchSeqRef.current) return;
        setError(err.message || 'Failed to fetch invoices');
        console.error('Error fetching invoices:', err);
        setInvoices([]);
        setServerStatusCounts({});
        setListFilterSummary(null);
        setListPagination({ page: 1, limit: ITEMS_PER_PAGE, total: 0, totalPages: 1 });
      } finally {
        if (fetchSeq === invoiceListFetchSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [
      adminBranchId,
      filterStatuses,
      dateFilterMode,
      filterIssueMonth,
      filterPaymentDateFrom,
      filterPaymentDateTo,
      filterIssueDateFrom,
      filterIssueDateTo,
      debouncedNameSearch,
      debouncedStudentNameSearch,
    ]
  );

  const refetchInvoiceListForCrossLink = useCallback(
    (search) =>
      fetchInvoices(1, {
        searchOverride: search,
        skipDateFilters: true,
        skipStudentSearch: true,
      }),
    [fetchInvoices]
  );

  // Removed fetchBranches - admin only sees their branch

  const fetchStudents = async () => {
    try {
      // Fetch users with user_type = 'Student' filtered by admin's branch
      const response = await apiRequest('/users?limit=100');
      const studentUsers = (response.data || []).filter(user => 
        user.user_type === 'Student' && 
        (adminBranchId ? (user.branch_id === adminBranchId) : true)
      );
      setStudents(studentUsers);
    } catch (err) {
      console.error('Error fetching students:', err);
    }
  };

  const openCreateModal = () => {
    setEditingInvoice(null);
    setError('');
    setFormData({
      branch_id: adminBranchId ? adminBranchId.toString() : '',
      amount: '',
      status: 'Draft',
      remarks: '',
      issue_date: '',
      due_date: '',
      items: [],
      students: [],
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = (invoice) => {
    setOpenMenuId(null);
    
    // Verify invoice belongs to admin's branch
    if (invoice.branch_id !== adminBranchId) {
      appAlert('You can only edit invoices from your branch.');
      return;
    }
    
    setEditingInvoice(invoice);
    setError('');
    // Format dates for date input (YYYY-MM-DD format)
    const formatDateForInput = (dateString) => {
      if (!dateString) return '';
      try {
        const date = new Date(dateString);
        return date.toISOString().split('T')[0];
      } catch {
        return '';
      }
    };
    
    setFormData({
      branch_id: invoice.branch_id?.toString() || '',
      amount: invoice.amount?.toString() || '',
      status: invoice.status || 'Draft',
      remarks: invoice.remarks || '',
      issue_date: formatDateForInput(invoice.issue_date),
      due_date: formatDateForInput(invoice.due_date),
      items: invoice.items || [],
      students: invoice.students?.map(s => s.student_id) || [],
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingInvoice(null);
    setFormErrors({});
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    if (formErrors[name]) {
      setFormErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
  };

  const addItem = () => {
    if (!newItem.description || !newItem.amount) {
      appAlert('Please fill in description and amount');
      return;
    }

    const item = {
      description: newItem.description.trim(),
      amount: parseFloat(newItem.amount) || 0,
      tax_item: newItem.tax_item?.trim() || null,
      tax_percentage: newItem.tax_percentage ? parseFloat(newItem.tax_percentage) : null,
      discount_amount: newItem.discount_amount ? parseFloat(newItem.discount_amount) : null,
      penalty_amount: newItem.penalty_amount ? parseFloat(newItem.penalty_amount) : null,
    };

    setFormData((prev) => ({
      ...prev,
      items: [...prev.items, item],
    }));

    setNewItem({
      description: '',
      amount: '',
      tax_item: '',
      tax_percentage: '',
      discount_amount: '',
      penalty_amount: '',
    });
  };

  const removeItem = (index) => {
    setFormData((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }));
  };

  const addStudent = () => {
    if (!newStudentId) {
      appAlert('Please select a student');
      return;
    }

    const studentId = parseInt(newStudentId);
    if (formData.students.includes(studentId)) {
      appAlert('Student is already added');
      return;
    }

    setFormData((prev) => ({
      ...prev,
      students: [...prev.students, studentId],
    }));

    setNewStudentId('');
  };

  const removeStudent = (studentId) => {
    setFormData((prev) => ({
      ...prev,
      students: prev.students.filter(id => id !== studentId),
    }));
  };

  const validateForm = () => {
    const errors = {};
    
    if (formData.issue_date && formData.due_date) {
      const issueDate = new Date(formData.issue_date);
      const dueDate = new Date(formData.due_date);
      if (issueDate > dueDate) {
        errors.due_date = 'Due date must be after issue date';
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      if (editingInvoice) {
        // When editing, only update invoice info (not items/students - they're managed separately)
        const payload = {
          amount: formData.amount && formData.amount !== '' ? parseFloat(formData.amount) : null,
          status: formData.status || 'Draft',
          remarks: formData.remarks?.trim() || null,
          issue_date: formData.issue_date || null,
          due_date: formData.due_date || null,
        };
        await apiRequest(`/invoices/${editingInvoice.invoice_id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        // When creating, include items and students
        // Ensure branch_id is set to admin's branch
        const payload = {
          branch_id: adminBranchId || (formData.branch_id && formData.branch_id !== '' ? parseInt(formData.branch_id) : null),
          amount: formData.amount && formData.amount !== '' ? parseFloat(formData.amount) : null,
          status: formData.status || 'Draft',
          remarks: formData.remarks?.trim() || null,
          issue_date: formData.issue_date || null,
          due_date: formData.due_date || null,
          items: formData.items,
          students: formData.students,
        };
        await apiRequest('/invoices', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      
      closeModal();
      fetchInvoices(currentPage);
    } catch (err) {
      setError(err.message || `Failed to ${editingInvoice ? 'update' : 'create'} invoice`);
      console.error('Error saving invoice:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const openViewEditInvoice = async (invoice) => {
    setOpenMenuId(null);
    // Fetch the latest invoice data with details
    try {
      const response = await apiRequest(`/invoices/${invoice.invoice_id}`);
      const invoiceData = response.data;
      
      // Expand invoice items with package details
      if (invoiceData.items && invoiceData.items.length > 0) {
        const expandedItems = await getExpandedInvoiceItems(invoiceData.items);
        invoiceData.expandedItems = expandedItems;
      }
      
      setSelectedInvoiceForDetails(invoiceData);
    } catch (err) {
      console.error('Error fetching invoice details:', err);
      setSelectedInvoiceForDetails(invoice);
    }
    setNewItem({
      description: '',
      amount: '',
      tax_item: '',
      tax_percentage: '',
      discount_amount: '',
      penalty_amount: '',
    });
    setNewStudentId('');
    setShowDetailsModal(true);
  };

  const openDetailsModal = async (invoice) => {
    // Fetch the latest invoice data with details
    try {
      const response = await apiRequest(`/invoices/${invoice.invoice_id}`);
      setSelectedInvoiceForDetails(response.data);
    } catch (err) {
      console.error('Error fetching invoice details:', err);
      setSelectedInvoiceForDetails(invoice);
    }
    setNewItem({
      description: '',
      amount: '',
      tax_item: '',
      tax_percentage: '',
      discount_amount: '',
      penalty_amount: '',
    });
    setNewStudentId('');
    setShowDetailsModal(true);
  };

  const { paymentLogsFocus } = useOpenInvoiceFromPaymentLogsNavigation({
    location,
    navigate,
    apiRequest,
    mergeInvoiceIntoList,
    clearListDateFilters: clearInvoiceListDateFilters,
    setFilterStatuses,
  });

  const queryInvoiceFocus = useInvoiceFocusFromQuery({
    searchParams,
    setSearchParams,
    setNameSearchTerm,
    mergeInvoiceIntoList,
    clearListDateFilters: clearInvoiceListDateFilters,
    refetchListForCrossLink: refetchInvoiceListForCrossLink,
    suppressAutoListFetchRef,
    apiRequest,
  });

  const invoiceListFocus = paymentLogsFocus?.invoiceId
    ? paymentLogsFocus
    : queryInvoiceFocus?.invoiceId
      ? queryInvoiceFocus
      : null;

  useEffect(() => {
    if (!adminBranchId) return;
    if (suppressAutoListFetchRef.current) return;
    fetchInvoices(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    adminBranchId,
    dateFilterMode,
    filterIssueMonth,
    filterPaymentDateFrom,
    filterPaymentDateTo,
    filterIssueDateFrom,
    filterIssueDateTo,
    filterStatuses,
    debouncedNameSearch,
    debouncedStudentNameSearch,
  ]);

  const handleDownloadPDF = async (invoice) => {
    setOpenMenuId(null);
    try {
      const token = localStorage.getItem('firebase_token');
      const response = await fetch(`${API_BASE_URL}/invoices/${invoice.invoice_id}/pdf`, {
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || 'Failed to download invoice PDF');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      // Optional: revoke later
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      console.error('Download invoice PDF failed:', err);
      appAlert(err.message || 'Failed to download invoice PDF');
    }
  };

  const handleDownloadSOA = async (invoice) => {
    setOpenMenuId(null);
    try {
      const token = localStorage.getItem('firebase_token');
      const response = await fetch(`${API_BASE_URL}/invoices/${invoice.invoice_id}/pdf?doc_type=soa`, {
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || 'Failed to download SOA PDF');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      console.error('Download SOA PDF failed:', err);
      appAlert(err.message || 'Failed to download SOA PDF');
    }
  };

  const handleDownloadAR = async (invoice) => {
    setOpenMenuId(null);
    try {
      const token = localStorage.getItem('firebase_token');
      const response = await fetch(`${API_BASE_URL}/invoices/${invoice.invoice_id}/pdf?doc_type=ar`, {
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || 'Failed to download acknowledgement receipt PDF');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      console.error('Download acknowledgement receipt PDF failed:', err);
      appAlert(err.message || 'Failed to download acknowledgement receipt PDF');
    }
  };

  const handleViewEditReceipt = async (invoice) => {
    setOpenMenuId(null);
    appAlert('Receipt management is not yet implemented.');
  };

  const handleViewInstallmentInvoice = (invoice) => {
    setOpenMenuId(null);
    setMenuPosition({ top: 0, right: 0 });

    if (!invoice?.installmentinvoiceprofiles_id) {
      appAlert('This invoice is not linked to an installment invoice profile.');
      return;
    }

    const params = new URLSearchParams();
    params.set('profile_id', String(invoice.installmentinvoiceprofiles_id));
    const studentName = invoice.students?.[0]?.full_name || '';
    if (studentName) {
      params.set('student_name', studentName);
    }

    navigate(`/admin/installment-invoice?${params.toString()}`);
  };

  const handleOpenPaymentModal = async (invoice) => {
    setOpenMenuId(null);
    try {
      // Fetch the latest invoice data with details
      const response = await apiRequest(`/invoices/${invoice.invoice_id}`);
      const invoiceData = response.data;

      if (
        invoiceData.can_record_payment === false ||
        invoiceData.balance_invoice_id
      ) {
        const tip = invoiceData.continued_to_invoice;
        const label = tip?.display_description || tip?.invoice_description || (tip?.invoice_id ? `INV-${tip.invoice_id}` : 'the balance invoice');
        appAlert(
          `This invoice is not payable after a partial payment. Record payments on ${label} instead.`
        );
        return;
      }

      setSelectedInvoiceForPayment(invoiceData);
      
      // Pre-select first student if available
      const defaultStudentId = invoiceData.students && invoiceData.students.length > 0 
        ? invoiceData.students[0].student_id 
        : '';
      
      setPaymentFormData({
        student_id: defaultStudentId,
        payment_method: 'Cash',
        payment_type: '',
        payable_amount: invoiceData.amount || '',
        tip_amount: '',
        discount_amount: '',
        issue_date: todayManilaYMD(),
        reference_number: '',
        remarks: '',
      });
      setPaymentFormErrors({});
      setShowPaymentModal(true);
    } catch (err) {
      console.error('Error fetching invoice details:', err);
      appAlert('Error loading invoice details. Please try again.');
    }
  };

  // Check if invoice is overdue and not paid
  const isInvoiceOverdue = (invoice) => {
    if (!invoice.due_date) return false;
    if (invoice.status === 'Paid') return false;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueDate = new Date(invoice.due_date);
    dueDate.setHours(0, 0, 0, 0);
    
    return dueDate < today;
  };

  const handleSendOverdueEmail = async (invoice) => {
    setOpenMenuId(null);
    
    if (
      !(await appConfirm({
        title: 'Send overdue reminder',
        message: `Send overdue payment reminder email to student(s) for invoice ${invoice.invoice_description || `INV-${invoice.invoice_id}`}?`,
        confirmLabel: 'Send',
      }))
    ) {
      return;
    }

    try {
      setLoading(true);
      const response = await apiRequest(`/invoices/${invoice.invoice_id}/send-overdue-email`, {
        method: 'POST',
      });
      
      if (response.success) {
        appAlert(response.message || 'Email sent successfully!');
      } else {
        appAlert(response.message || 'Failed to send email');
      }
    } catch (err) {
      console.error('Error sending overdue email:', err);
      const errorMessage = err.response?.data?.message || err.message || 'Failed to send email';
      appAlert(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleClosePaymentModal = () => {
    setShowPaymentModal(false);
    setSelectedInvoiceForPayment(null);
    setPaymentFormData({
      student_id: '',
      payment_method: 'Cash',
      payment_type: '',
      payable_amount: '',
      tip_amount: '',
      discount_amount: '',
      issue_date: todayManilaYMD(),
      reference_number: '',
      remarks: '',
      attachment_url: '',
    });
    setPaymentFormErrors({});
  };

  const closePaymentRecordedInvoiceSummary = () => {
    if (paymentRecordedPdfLoading) return;
    setPaymentRecordedSummary(null);
  };

  const handlePrintPaymentRecordedAckPdf = async () => {
    const inv = paymentRecordedSummary?.invoice;
    if (!inv?.invoice_id) return;
    setPaymentRecordedPdfLoading(true);
    try {
      const token = localStorage.getItem('firebase_token');
      const response = await fetch(`${API_BASE_URL}/invoices/${inv.invoice_id}/pdf?doc_type=ar`, {
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || 'Failed to download acknowledgement receipt PDF');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      console.error('Download acknowledgement receipt PDF failed:', err);
      appAlert(err.message || 'Failed to download acknowledgement receipt PDF');
    } finally {
      setPaymentRecordedPdfLoading(false);
    }
  };

  const getInvoiceBreakdown = (invoice) => {
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

  const handlePaymentAttachmentChange = async (e) => {
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
    setPaymentAttachmentUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      const token = localStorage.getItem('firebase_token');
      const res = await fetch(`${API_BASE_URL}/upload/invoice-payment-image`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Upload failed');
      }
      setPaymentFormData((prev) => ({ ...prev, attachment_url: data.imageUrl || '' }));
    } catch (err) {
      console.error('Payment attachment upload error:', err);
      appAlert(err.message || 'Failed to upload image. Please try again.');
    } finally {
      setPaymentAttachmentUploading(false);
      e.target.value = '';
    }
  };

  const clearPaymentAttachment = () => {
    setPaymentFormData((prev) => ({ ...prev, attachment_url: '' }));
  };

  const handlePaymentInputChange = (e) => {
    const { name, value } = e.target;
    const invoiceOutstandingAmount = parseFloat(selectedInvoiceForPayment?.amount || 0);
    setPaymentFormData((prev) => {
      let nextValue = value;

      if (
        name === 'payable_amount' &&
        prev.payment_type === 'Partial Payment' &&
        invoiceOutstandingAmount > 0 &&
        Number(value) >= invoiceOutstandingAmount
      ) {
        nextValue = prev.payable_amount;
      }

      if (name === 'payment_type' && value === 'Partial Payment') {
        const currentAmount = parseFloat(prev.payable_amount || 0);
        if (invoiceOutstandingAmount > 0 && currentAmount >= invoiceOutstandingAmount) {
          return { ...prev, [name]: value, payable_amount: '' };
        }
      }
      if (name === 'payment_type' && value === 'Full Payment') {
        return {
          ...prev,
          [name]: value,
          payable_amount:
            invoiceOutstandingAmount > 0 ? invoiceOutstandingAmount.toFixed(2) : prev.payable_amount,
        };
      }

      return { ...prev, [name]: nextValue };
    });
    // Clear error for this field
    if (paymentFormErrors[name]) {
      setPaymentFormErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
  };

  const validatePaymentForm = () => {
    const errors = {};
    
    if (!paymentFormData.student_id) {
      errors.student_id = 'Student is required';
    }
    // Payment method is now fixed to "Cash" and cannot be changed
    if (!paymentFormData.payment_type) {
      errors.payment_type = 'Payment type is required';
    }
    if (!paymentFormData.payable_amount || parseFloat(paymentFormData.payable_amount) <= 0) {
      errors.payable_amount = 'Payable amount must be greater than 0';
    }
    const invoiceOutstandingAmount = parseFloat(selectedInvoiceForPayment?.amount || 0);
    const payableAmount = parseFloat(paymentFormData.payable_amount || 0);
    const tipAmount = parseFloat(paymentFormData.tip_amount || 0);
    if (
      paymentFormData.payment_type === 'Partial Payment' &&
      invoiceOutstandingAmount > 0 &&
      payableAmount >= invoiceOutstandingAmount
    ) {
      errors.payable_amount = 'For partial payment, amount must be less than the remaining invoice amount.';
    }
    if (!paymentFormData.issue_date) {
      errors.issue_date = 'Payment date is required';
    }
    if (paymentFormData.tip_amount !== '' && (Number.isNaN(tipAmount) || tipAmount < 0)) {
      errors.tip_amount = 'Tip amount must be 0 or greater';
    }
    const discountAmount = parseFloat(paymentFormData.discount_amount || 0);
    if (paymentFormData.discount_amount !== '' && (Number.isNaN(discountAmount) || discountAmount < 0)) {
      errors.discount_amount = 'Discount amount must be 0 or greater';
    }
    if (paymentFormData.discount_amount !== '' && discountAmount >= payableAmount) {
      errors.discount_amount = 'Discount amount must be less than payable amount';
    }
    const refNum = (paymentFormData.reference_number || '').trim();
    if (!refNum) {
      errors.reference_number = 'Reference number is required';
    }
    const attachmentUrl = (paymentFormData.attachment_url || '').trim();
    if (!attachmentUrl) {
      errors.attachment_url = 'Attachment is required';
    }

    setPaymentFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmitPayment = async (e) => {
    e.preventDefault();
    
    if (!validatePaymentForm()) {
      return;
    }
    
    setSubmittingPayment(true);
    
    try {
      // Net cash to record = Payable Amount minus optional Discount Amount.
      // Discount applied at point of payment is deducted from the recorded amount;
      // it is also sent separately so the backend can close the invoice without
      // counting the discount as revenue.
      const grossPayable = parseFloat(paymentFormData.payable_amount) || 0;
      const discountApplied = paymentFormData.discount_amount === ''
        ? 0
        : Math.max(0, parseFloat(paymentFormData.discount_amount) || 0);
      const netPayable = Math.max(0, grossPayable - discountApplied);
      const paidInvoiceId = selectedInvoiceForPayment.invoice_id;
      const paymentSnapshot = {
        student_id: parseInt(paymentFormData.student_id, 10),
        payable_amount: netPayable,
        discount_amount: discountApplied,
        tip_amount: paymentFormData.tip_amount === '' ? 0 : Math.max(0, parseFloat(paymentFormData.tip_amount)),
        issue_date: paymentFormData.issue_date,
        reference_number: (paymentFormData.reference_number || '').trim(),
      };

      const payload = {
        invoice_id: paidInvoiceId,
        student_id: parseInt(paymentFormData.student_id, 10),
        payment_method: paymentFormData.payment_method,
        payment_type: paymentFormData.payment_type,
        payable_amount: netPayable,
        discount_amount: discountApplied,
        tip_amount: paymentFormData.tip_amount === '' ? 0 : Math.max(0, parseFloat(paymentFormData.tip_amount)),
        issue_date: paymentFormData.issue_date,
        reference_number: (paymentFormData.reference_number || '').trim(),
      };

      const userRemarks = (paymentFormData.remarks || '').trim();
      const remarkParts = [];
      if (userRemarks) remarkParts.push(userRemarks);
      if (discountApplied > 0) {
        remarkParts.push(`Discount applied at payment: ₱${discountApplied.toFixed(2)} (Original payable: ₱${grossPayable.toFixed(2)})`);
      }
      if (remarkParts.length > 0) {
        payload.remarks = remarkParts.join(' | ');
      }
      if (paymentFormData.attachment_url && paymentFormData.attachment_url.trim() !== '') {
        payload.attachment_url = paymentFormData.attachment_url.trim();
      }

      await apiRequest('/payments', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      handleClosePaymentModal();
      await fetchInvoices(currentPage);

      try {
        const invRes = await apiRequest(`/invoices/${paidInvoiceId}`);
        setPaymentRecordedSummary({
          invoice: invRes.data,
          paymentSnapshot,
        });
      } catch (fetchErr) {
        console.error('Error loading invoice after payment:', fetchErr);
        appAlert('Payment recorded successfully, but the summary could not be loaded. Refresh the page if needed.');
      }
    } catch (err) {
      console.error('Error submitting payment:', err);
      const errorMessage = err.response?.data?.message || err.message || 'Error recording payment. Please try again.';
      appAlert(`Error: ${errorMessage}`);
    } finally {
      setSubmittingPayment(false);
    }
  };

  const closeDetailsModal = () => {
    setShowDetailsModal(false);
    setSelectedInvoiceForDetails(null);
    setEditingStatus(false);
    setTempStatus('');
  };

  const handleStatusChange = (newStatus) => {
    setTempStatus(newStatus);
  };

  const updateInvoiceStatus = async () => {
    if (!selectedInvoiceForDetails || !tempStatus) {
      return;
    }

    if (tempStatus === selectedInvoiceForDetails.status) {
      setEditingStatus(false);
      return;
    }

    setUpdatingStatus(true);
    try {
      await apiRequest(`/invoices/${selectedInvoiceForDetails.invoice_id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: tempStatus }),
      });

      // Update local state
      setSelectedInvoiceForDetails({
        ...selectedInvoiceForDetails,
        status: tempStatus,
      });

      // Refresh invoices list
      await fetchInvoices(currentPage);

      setEditingStatus(false);
    } catch (err) {
      appAlert(err.message || 'Failed to update invoice status');
      setTempStatus(selectedInvoiceForDetails.status); // Revert on error
    } finally {
      setUpdatingStatus(false);
    }
  };

  const startEditingStatus = () => {
    setTempStatus(selectedInvoiceForDetails.status || 'Pending');
    setEditingStatus(true);
  };

  const cancelEditingStatus = () => {
    setTempStatus('');
    setEditingStatus(false);
  };

  const addInvoiceItem = async () => {
    if (!newItem.description || !newItem.amount) {
      appAlert('Please fill in description and amount');
      return;
    }

    try {
      const payload = {
        description: newItem.description.trim(),
        amount: parseFloat(newItem.amount) || 0,
        tax_item: newItem.tax_item?.trim() || null,
        tax_percentage: newItem.tax_percentage ? parseFloat(newItem.tax_percentage) : null,
        discount_amount: newItem.discount_amount ? parseFloat(newItem.discount_amount) : null,
        penalty_amount: newItem.penalty_amount ? parseFloat(newItem.penalty_amount) : null,
      };

      await apiRequest(`/invoices/${selectedInvoiceForDetails.invoice_id}/items`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setNewItem({
        description: '',
        amount: '',
        tax_item: '',
        tax_percentage: '',
        discount_amount: '',
        penalty_amount: '',
      });
      
      // Refresh invoice data
      await fetchInvoices(currentPage);
      const updatedInvoice = await apiRequest(`/invoices/${selectedInvoiceForDetails.invoice_id}`);
      const invoiceData = updatedInvoice.data;
      
      // Expand invoice items with package details
      if (invoiceData.items && invoiceData.items.length > 0) {
        const expandedItems = await getExpandedInvoiceItems(invoiceData.items);
        invoiceData.expandedItems = expandedItems;
      }
      
      setSelectedInvoiceForDetails(invoiceData);
    } catch (err) {
      appAlert(err.message || 'Failed to add invoice item');
    }
  };

  const removeInvoiceItem = async (itemId) => {
    if (
      !(await appConfirm({
        title: 'Remove item',
        message: 'Are you sure you want to remove this item?',
        destructive: true,
        confirmLabel: 'Remove',
      }))
    ) {
      return;
    }

    try {
      await apiRequest(`/invoices/${selectedInvoiceForDetails.invoice_id}/items/${itemId}`, {
        method: 'DELETE',
      });
      
      // Refresh invoice data
      await fetchInvoices(currentPage);
      const updatedInvoice = await apiRequest(`/invoices/${selectedInvoiceForDetails.invoice_id}`);
      const invoiceData = updatedInvoice.data;
      
      // Expand invoice items with package details
      if (invoiceData.items && invoiceData.items.length > 0) {
        const expandedItems = await getExpandedInvoiceItems(invoiceData.items);
        invoiceData.expandedItems = expandedItems;
      }
      
      setSelectedInvoiceForDetails(invoiceData);
    } catch (err) {
      appAlert(err.message || 'Failed to remove invoice item');
    }
  };

  const addInvoiceStudent = async () => {
    if (!newStudentId) {
      appAlert('Please select a student');
      return;
    }

    try {
      await apiRequest(`/invoices/${selectedInvoiceForDetails.invoice_id}/students`, {
        method: 'POST',
        body: JSON.stringify({ student_id: parseInt(newStudentId) }),
      });

      setNewStudentId('');
      
      // Refresh invoice data
      await fetchInvoices(currentPage);
      const updatedInvoice = await apiRequest(`/invoices/${selectedInvoiceForDetails.invoice_id}`);
      setSelectedInvoiceForDetails(updatedInvoice.data);
    } catch (err) {
      appAlert(err.message || 'Failed to add student to invoice');
    }
  };

  const removeInvoiceStudent = async (studentId) => {
    if (
      !(await appConfirm({
        title: 'Remove student',
        message: 'Are you sure you want to remove this student from the invoice?',
        destructive: true,
        confirmLabel: 'Remove',
      }))
    ) {
      return;
    }

    try {
      await apiRequest(`/invoices/${selectedInvoiceForDetails.invoice_id}/students/${studentId}`, {
        method: 'DELETE',
      });
      
      // Refresh invoice data
      await fetchInvoices(currentPage);
      const updatedInvoice = await apiRequest(`/invoices/${selectedInvoiceForDetails.invoice_id}`);
      setSelectedInvoiceForDetails(updatedInvoice.data);
    } catch (err) {
      appAlert(err.message || 'Failed to remove student from invoice');
    }
  };

  // Helper functions
  // Removed getBranchName, formatBranchName, getUniqueBranches - admin only sees their branch
  const getStudentName = (studentId) => {
    if (!studentId) return null;
    const student = students.find(s => s.user_id === studentId);
    return student ? student.full_name : null;
  };

  const getUniqueStatuses = Object.keys(serverStatusCounts).sort();
  const invoicesInScopeTotal = Object.values(serverStatusCounts).reduce(
    (sum, n) => sum + (Number(n) || 0),
    0
  );

  const sortedInvoices = sortRows(invoices, sortConfig, {
    branch: { accessor: (invoice) => selectedBranchName || invoice.branch_name || '', type: 'string' },
    status: { accessor: 'status', type: 'string' },
    issue_date: { accessor: 'issue_date', type: 'date' },
    payment_date: { accessor: 'payment_date', type: 'date' },
  });
  const paginatedInvoices = sortedInvoices;

  const invoiceStatusCounts = serverStatusCounts;
  const unpaidInvoiceCount = invoiceStatusCounts['Unpaid'] || 0;

  useScrollToFocusedInvoiceRow(
    invoiceListFocus,
    sortedInvoices,
    currentPage,
    setCurrentPage,
    ITEMS_PER_PAGE
  );
  const summaryInvoiceCount = listPagination.total;
  const summaryInvoiceTotal = invoices.reduce(
    (sum, invoice) => sum + getInvoiceSummaryAmountIncludingTips(invoice),
    0
  );
  const isPaymentDateScope =
    dateFilterMode === DATE_FILTER_MODES.PAYMENT_DATE ||
    dateFilterMode === DATE_FILTER_MODES.MONTH;
  const summaryAmountDisplay =
    listFilterSummary != null ? listFilterSummary.totalAmount : summaryInvoiceTotal;
  const summaryPaymentLineCount = listFilterSummary?.paymentLineCount ?? null;
  const handleSort = (key) => {
    setSortConfig((current) => toggleSortConfig(current, key));
  };

  const calculateItemTotal = (item) => {
    const amount = parseFloat(item.amount) || 0;
    const discount = parseFloat(item.discount_amount) || 0;
    const penalty = parseFloat(item.penalty_amount) || 0;
    const taxPercent = parseFloat(item.tax_percentage) || 0;
    const subtotal = amount - discount + penalty;
    const tax = subtotal * (taxPercent / 100);
    return subtotal + tax;
  };

  const handleExportToExcel = async () => {
    if (exportDateFrom && exportDateTo && exportDateFrom > exportDateTo) {
      appAlert('Export "From" date must be on or before "To" date.');
      return;
    }
    try {
      setExportLoading(true);
      const usePaymentDateExport = Boolean(exportDateFrom?.trim() || exportDateTo?.trim());

      let exportRows;
      let colWidths;
      let emptyMessage;

      if (usePaymentDateExport) {
        const fromTrim = exportDateFrom?.trim() || '';
        const toTrim = exportDateTo?.trim() || '';
        const payments = await fetchAllPaymentsForExport(apiRequest, {
          branchId: adminBranchId || null,
          paymentDateFrom: fromTrim,
          paymentDateTo: toTrim,
          align: PaymentExportAlignMode.ADMIN,
        });
        const filteredPayments = (payments || []).filter((p) =>
          shouldIncludePaymentByInvoiceStatuses(p, exportSelectedStatuses)
        );
        const paymentRows = mapCompletedPaymentsToExportRows(filteredPayments);

        // Merge unpaid invoices issued in the same date window when
        // "Unpaid" is checked — keeps the export reconciled to AR.
        let unpaidRows = [];
        if (exportSelectedStatuses.includes('Unpaid')) {
          const unpaid = await fetchUnpaidInvoicesForPaymentDateExport(apiRequest, {
            branchIds: adminBranchId ? [adminBranchId] : [],
            issueDateFrom: fromTrim,
            issueDateTo: toTrim,
          });
          unpaidRows = unpaid.map((inv) =>
            mapUnpaidInvoiceToPaymentExportRow({
              ...inv,
              branch_name: selectedBranchName || inv.branch_name || 'Your Branch',
            })
          );
        }

        exportRows = [...paymentRows, ...unpaidRows];
        colWidths = PAYMENT_DATE_EXPORT_COL_WIDTHS;
        emptyMessage =
          'No payments or unpaid invoices found for the selected date range.';
      } else {
        const collected = [];
        let page = 1;
        let totalPages = 1;
        do {
          const params = buildInvoiceListRequestParams({
            page,
            limit: 100,
            branchId: adminBranchId,
            statuses: exportSelectedStatuses,
            dateFilterMode,
            month: filterIssueMonth,
            paymentFrom: filterPaymentDateFrom,
            paymentTo: filterPaymentDateTo,
            issueFrom: filterIssueDateFrom,
            issueTo: filterIssueDateTo,
          });
          const response = await apiRequest(`/invoices?${params.toString()}`);
          collected.push(...(response.data || []));
          totalPages = response.pagination?.totalPages || 1;
          page += 1;
        } while (page <= totalPages);

        exportRows = collected.map((invoice) => ({
            'Invoice ID': `INV-${invoice.invoice_id}`,
            'Acknowledgement Receipt#': invoice.invoice_ar_number || '-',
            'Student Name(s)': (invoice.students || []).map((s) => s?.full_name).filter(Boolean).join(', ') || '-',
            Branch: selectedBranchName || 'Your Branch',
            Status: invoice.status || '-',
            'Amount (PHP)': Number(getInvoiceExportCollectedAmount(invoice) || 0).toFixed(2),
            'Issue Date': invoice.issue_date ? formatDateManila(invoice.issue_date) : '-',
            'Due Date': invoice.due_date ? formatDateManila(invoice.due_date) : '-',
          }));
        colWidths = INVOICE_EXPORT_COL_WIDTHS;
        emptyMessage = 'No invoice records found for export.';
      }

      if (exportRows.length === 0) {
        appAlert(emptyMessage);
        return;
      }

      downloadInvoiceExportXlsx(exportRows, `Admin_Invoice_Export_${exportDateFrom || 'all'}_to_${exportDateTo || 'all'}.xlsx`, {
        colWidths,
      });
      setShowExportModal(false);
      setExportSelectedStatuses(INVOICE_EXPORT_DEFAULT_STATUSES);
      appAlert('Invoice export completed successfully.');
    } catch (err) {
      console.error('Error exporting invoices:', err);
      appAlert('Failed to export invoices. Please try again.');
    } finally {
      setExportLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Invoices</h1>
          <p className="mt-1 text-sm text-gray-600">
            Review invoices, payments, due dates, and exported billing records.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowExportModal(true)}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 16V4m0 12l-4-4m4 4l4-4M4 20h16" />
          </svg>
          Export to Excel
        </button>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">Search Filter</p>
            <p className="text-xs text-gray-500">
              Filter invoices before the table. Branch scope is limited to your assigned branch.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <label htmlFor="admin-invoice-search" className="mb-1 block text-xs font-medium text-gray-700">
              Invoice, AR, or description
            </label>
            <input
              id="admin-invoice-search"
              type="text"
              value={nameSearchTerm}
              onChange={(e) => setNameSearchTerm(e.target.value)}
              placeholder="Invoice, AR, description..."
              title="Search by invoice ID, acknowledgement receipt #, or description"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
          <div>
            <label htmlFor="admin-invoice-student-search" className="mb-1 block text-xs font-medium text-gray-700">
              Student name
            </label>
            <input
              id="admin-invoice-student-search"
              type="text"
              value={studentNameSearch}
              onChange={(e) => setStudentNameSearch(e.target.value)}
              placeholder="Search student..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
          <InvoiceStatusMultiFilter
            id="admin-invoice-status-filter"
            statuses={getUniqueStatuses}
            statusCounts={invoiceStatusCounts}
            selectedStatuses={filterStatuses}
            onChange={setFilterStatuses}
            totalInScope={invoicesInScopeTotal}
          />
          <div className="space-y-2">
            <span className="block text-xs font-medium text-gray-700">Date filter</span>
            <div
              role="tablist"
              aria-label="Invoice date filter mode"
              className="inline-flex flex-wrap gap-1 rounded-md border border-gray-200 bg-gray-50 p-0.5"
            >
              {[
                { mode: DATE_FILTER_MODES.MONTH, label: invoiceDateFilterUtil.MODE_LABELS[DATE_FILTER_MODES.MONTH] },
                { mode: DATE_FILTER_MODES.PAYMENT_DATE, label: invoiceDateFilterUtil.MODE_LABELS[DATE_FILTER_MODES.PAYMENT_DATE] },
                { mode: DATE_FILTER_MODES.ISSUE_DATE, label: invoiceDateFilterUtil.MODE_LABELS[DATE_FILTER_MODES.ISSUE_DATE] },
              ].map(({ mode, label }) => {
                const isActive = dateFilterMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => handleInvoiceListDateFilterModeChange(mode)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
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
            {dateFilterMode === DATE_FILTER_MODES.MONTH && (
              <input
                type="month"
                aria-label="Issue month"
                value={filterIssueMonth}
                onChange={(e) => setFilterIssueMonth(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            )}
            {dateFilterMode === DATE_FILTER_MODES.PAYMENT_DATE && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="admin-invoice-payment-from" className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-500">From</label>
                  <input
                    id="admin-invoice-payment-from"
                    type="date"
                    value={filterPaymentDateFrom}
                    onChange={(e) => setFilterPaymentDateFrom(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label htmlFor="admin-invoice-payment-to" className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-500">To</label>
                  <input
                    id="admin-invoice-payment-to"
                    type="date"
                    value={filterPaymentDateTo}
                    onChange={(e) => setFilterPaymentDateTo(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
              </div>
            )}
            {dateFilterMode === DATE_FILTER_MODES.ISSUE_DATE && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="admin-invoice-issue-from" className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">From</label>
                  <input
                    id="admin-invoice-issue-from"
                    type="date"
                    value={filterIssueDateFrom}
                    onChange={(e) => setFilterIssueDateFrom(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label htmlFor="admin-invoice-issue-to" className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">To</label>
                  <input
                    id="admin-invoice-issue-to"
                    type="date"
                    value={filterIssueDateTo}
                    onChange={(e) => setFilterIssueDateTo(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2 border-t border-gray-100 pt-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          <p className="text-xs text-gray-500">
            {dateFilterMode === DATE_FILTER_MODES.MONTH
              ? 'Month uses payment date (same as Payment Logs). Totals match Payment Logs for that month.'
              : dateFilterMode === DATE_FILTER_MODES.PAYMENT_DATE
                ? 'Payment date range (inclusive). Totals match Payment Logs for the same range.'
                : 'Issue date range (inclusive). Invoice list is loaded page by page from the server.'}
          </p>
          {filterStatuses.includes('Unpaid') && (
            <button
              type="button"
              onClick={() => setFilterStatuses((prev) => prev.filter((s) => s !== 'Unpaid'))}
              aria-pressed={true}
              title="Clear unpaid filter"
              className="relative inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-100 px-3 py-1 text-xs font-semibold text-red-800 transition-colors hover:bg-red-200"
            >
              <span>Unpaid</span>
              <sup
                className="ml-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white"
                aria-label={`${unpaidInvoiceCount} unpaid invoices`}
              >
                {unpaidInvoiceCount > 99 ? '99+' : unpaidInvoiceCount}
              </sup>
            </button>
          )}
        </div>
      </div>

      {/* Summary line — sits between the filter container and the table */}
      <div className="flex flex-col gap-1 text-sm text-gray-700">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>
            <span className="font-semibold text-gray-900">Total Invoice:</span>{' '}
            <span className="font-medium text-gray-900">{summaryInvoiceCount.toLocaleString('en-US')}</span>
          </span>
          {isPaymentDateScope && summaryPaymentLineCount != null ? (
            <>
              <span className="text-gray-300">·</span>
              <span>
                <span className="font-semibold text-gray-900">Total payment lines:</span>{' '}
                <span className="font-medium text-gray-900">
                  {summaryPaymentLineCount.toLocaleString('en-US')}
                </span>
              </span>
            </>
          ) : null}
          <span className="text-gray-300">·</span>
          <span>
            <span className="font-semibold text-gray-900">Total amount (incl. tips):</span>{' '}
            <span className="font-semibold text-emerald-700">
              ₱{summaryAmountDisplay.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </span>
        </div>
        {isPaymentDateScope ? (
          <p className="text-[11px] text-gray-500 leading-snug">
            Payment date filter: total amount and payment lines follow your status selection.
            All statuses includes rejected-approval payments in this period when that month has them.
          </p>
        ) : (
          <p className="text-[11px] text-gray-500 leading-snug">
            Amount shown sums invoice rows on the current page. Use Payment date or Month to reconcile with Payment Logs.
          </p>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Invoices List */}
      <div className="bg-white rounded-lg shadow">
        {/* Desktop Table View */}
        <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
            <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '1280px', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '170px' }} />
                <col style={{ width: '150px' }} />
                <col style={{ width: '170px' }} />
                <col style={{ width: '130px' }} />
                <col style={{ width: '100px' }} />
                <col style={{ width: '110px' }} />
                <col style={{ width: '120px' }} />
                <col style={{ width: '120px' }} />
                <col style={{ width: '130px' }} />
                <col style={{ width: '120px' }} />
                <col style={{ width: '90px' }} />
              </colgroup>
              <thead className="bg-white table-header-stable">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '170px', minWidth: '170px' }}>
                    Invoice
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '150px', minWidth: '150px' }}>
                    <span className="block">Acknowledgement</span>
                    <span className="block">Receipt#</span>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '170px', minWidth: '170px' }}>
                    Student Name
                  </th>
                  <SortableHeader label="Branch" sortKey="branch" sortConfig={sortConfig} onSort={handleSort} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" />
                  <SortableHeader label="Status" sortKey="status" sortConfig={sortConfig} onSort={handleSort} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" />
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '110px', minWidth: '110px' }}>
                    Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '120px', minWidth: '120px' }}>
                    Total Amount
                  </th>
                  <SortableHeader label="Issue Date" sortKey="issue_date" sortConfig={sortConfig} onSort={handleSort} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '120px', minWidth: '120px' }} />
                  <SortableHeader label="Payment Date" sortKey="payment_date" sortConfig={sortConfig} onSort={handleSort} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '130px', minWidth: '130px' }} />
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '120px', minWidth: '120px' }}>
                    Due Date
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '90px', minWidth: '90px' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-[#ffffff] divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={11} className="px-6 py-10 text-center">
                      <div className="inline-flex items-center gap-2 text-sm text-gray-600">
                        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-primary-600" />
                        Loading invoices...
                      </div>
                    </td>
                  </tr>
                ) : sortedInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-6 py-12 text-center">
                      <p className="text-gray-500">
                        {nameSearchTerm || studentNameSearch || filterStatuses.length > 0
                          ? 'No matching invoices. Try adjusting your search or filters.'
                          : 'No invoices yet. Add your first invoice to get started.'}
                      </p>
                    </td>
                  </tr>
                ) : (
                  paginatedInvoices.map((invoice) => {
                  const rejectedOverlay = getInvoiceRowRejectedPaymentOverlay(invoice, paymentLogsFocus);
                  const isFocusedFromPaymentLogs = isInvoiceFocusedFromPaymentLogs(invoice, paymentLogsFocus);
                  const isFocusedFromCrossLink = isInvoiceListFocused(invoice, queryInvoiceFocus);
                  return (
                  <tr
                    key={invoice.invoice_id}
                    id={`invoice-row-${invoice.invoice_id}`}
                    className={
                      isFocusedFromPaymentLogs
                        ? 'bg-red-50 ring-2 ring-inset ring-red-300'
                        : isFocusedFromCrossLink
                          ? 'bg-primary-50 ring-2 ring-inset ring-primary-300'
                          : undefined
                    }
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                        <span>INV-{invoice.invoice_id}</span>
                        {invoice.status === 'Partially Paid' && (
                          <span className="px-1.5 py-0.5 text-xs rounded-full bg-yellow-100 text-yellow-800 border border-yellow-200">
                            Partial payment
                          </span>
                        )}
                      </div>
                      {(() => {
                        const invLabel = `INV-${invoice.invoice_id}`;
                        const secondary = String(
                          invoice.display_description || invoice.invoice_description || ''
                        )
                          .replace(/\s*-\s*AR\s+[A-Za-z0-9-]+/i, '')
                          .trim();
                        if (!secondary || secondary.toUpperCase() === invLabel.toUpperCase()) {
                          return null;
                        }
                        return <div className="text-xs text-gray-500 mt-1">{secondary}</div>;
                      })()}
                      {invoice.reservation && (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="px-1.5 py-0.5 text-xs rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                            Reservation
                          </span>
                          {invoice.reservation.is_expired && (
                            <span className="px-1.5 py-0.5 text-xs rounded-full bg-red-100 text-red-800 border border-red-200 font-semibold">
                              Expired
                            </span>
                          )}
                          {invoice.reservation.status === 'Expired' && (
                            <span className="px-1.5 py-0.5 text-xs rounded-full bg-red-100 text-red-800 border border-red-200 font-semibold">
                              Reservation Expired
                            </span>
                          )}
                          {invoice.reservation.due_date && !invoice.reservation.is_expired && invoice.reservation.status !== 'Expired' && (
                            <span className="text-xs text-gray-500">
                              Due: {formatDateManila(invoice.reservation.due_date)}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600" style={{ maxWidth: '140px' }}>
                      <InvoiceArNumberLink userType={billingUserType} invoice={invoice} />
                    </td>
                    <td className="px-6 py-4" style={{ maxWidth: '200px' }}>
                      <div className="text-sm text-gray-900 min-w-0">
                        {invoice.students && invoice.students.length > 0 ? (
                          <div className="space-y-1">
                            {invoice.students.slice(0, 2).map((student, idx) => (
                              <div key={student.invoice_student_id || idx} className="font-medium truncate" title={student.full_name || '-'}>
                                {student.full_name || '-'}
                              </div>
                            ))}
                            {invoice.students.length > 2 && (
                              <div className="text-xs text-gray-500">
                                +{invoice.students.length - 2} more
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-400 italic">No student</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4" style={{ maxWidth: '160px' }}>
                      <div className="text-sm text-gray-900 truncate" title={selectedBranchName}>
                        {selectedBranchName}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${
                          invoice.status === 'Paid'
                            ? 'bg-green-100 text-green-800'
                            : invoice.status === 'Pending'
                            ? 'bg-yellow-100 text-yellow-800'
                            : invoice.status === 'Unpaid'
                            ? 'bg-gray-200 text-gray-700'
                            : invoice.status === 'Rejected'
                            ? 'bg-red-100 text-red-800'
                            : invoice.status === 'Overdue'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {invoice.status || 'Draft'}
                      </span>
                      {rejectedOverlay?.rejectReason && (
                        <p className="mt-1 max-w-[200px] text-xs text-red-700 line-clamp-2" title={rejectedOverlay.rejectReason}>
                          {rejectedOverlay.rejectReason}
                        </p>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                        {invoice.balance_invoice_id ? (
                          <div className="text-xs text-gray-900 space-y-0.5">
                            <div>
                              <span className="text-gray-500">Remaining (INV-{invoice.continued_to_invoice_id || invoice.balance_invoice_id}):</span>{' '}
                              <span className="font-medium">
                                ₱{Number(invoice.balance_invoice_amount ?? invoice.amount ?? 0).toFixed(2)}
                              </span>
                            </div>
                            <div>
                              <span className="text-gray-500">Paid on this invoice:</span>{' '}
                              <span className="font-medium">
                                ₱{Number(invoice.paid_amount ?? 0).toFixed(2)}
                              </span>
                            </div>
                          </div>
                        ) : rejectedOverlay ? (
                          <div className="text-sm font-medium text-gray-900">
                            ₱{rejectedOverlay.amount.toFixed(2)}
                          </div>
                        ) : (
                          <div className="text-sm text-gray-900">
                            {invoice.amount !== null && invoice.amount !== undefined
                              ? `₱${getInvoiceDisplayAmount(invoice).toFixed(2)}`
                              : '-'}
                          </div>
                        )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {rejectedOverlay
                          ? `₱${rejectedOverlay.totalAmount.toFixed(2)}`
                          : `₱${Number(invoice.total_received_amount || ((invoice.paid_amount || 0) + (invoice.total_tip_amount || 0))).toFixed(2)}`}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {invoice.issue_date
                          ? formatDateManila(invoice.issue_date)
                          : '-'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {rejectedOverlay?.paymentDate
                          ? formatDateManila(rejectedOverlay.paymentDate)
                          : invoice.last_payment_date
                          ? formatDateManila(invoice.last_payment_date)
                          : '—'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {invoice.due_date
                          ? formatDateManila(invoice.due_date)
                          : '-'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="relative action-menu-container">
                        <button
                          onClick={(e) => handleMenuClick(invoice.invoice_id, e)}
                          className="p-2 rounded-full hover:bg-gray-100 transition-colors"
                        >
                          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })
                )}
              </tbody>
            </table>
          </div>
          <FixedTablePagination
            page={listPagination.page}
            totalPages={listPagination.totalPages}
            totalItems={listPagination.total}
            itemsPerPage={listPagination.limit}
            itemLabel="invoices"
            onPageChange={(page) => fetchInvoices(page)}
          />
        </div>

      {/* Action Menu Overlay */}
      {openMenuId && createPortal(
        <>
          <div 
            className="fixed inset-0 z-40 bg-transparent" 
            onClick={() => {
              setOpenMenuId(null);
              setMenuPosition({ top: 0, right: 0 });
            }}
          />
          <div
            className="fixed action-menu-overlay bg-white rounded-md shadow-lg z-50 border border-gray-200 w-48 max-h-[calc(100vh-2rem)] overflow-y-auto"
            style={{
              ...(menuPosition.top !== undefined && { top: `${menuPosition.top}px` }),
              ...(menuPosition.bottom !== undefined && { bottom: `${menuPosition.bottom}px` }),
              ...(menuPosition.right !== undefined && { right: `${menuPosition.right}px` }),
              ...(menuPosition.left !== undefined && { left: `${menuPosition.left}px` }),
              scrollbarWidth: 'thin',
              scrollbarColor: '#cbd5e0 #f7fafc',
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="py-1">
              {(() => {
                const selectedInvoice = invoices.find(i => i.invoice_id === openMenuId);
                if (!selectedInvoice) return null;
                return (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuId(null);
                        setMenuPosition({ top: 0, right: 0 });
                        handleDownloadPDF(selectedInvoice);
                      }}
                      className="flex items-center justify-between w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                    >
                      <span>Download Invoice PDF</span>
                      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuId(null);
                        setMenuPosition({ top: 0, right: 0 });
                        handleDownloadSOA(selectedInvoice);
                      }}
                      className="flex items-center justify-between w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                    >
                      <span>Download / Print SOA</span>
                      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 9V4h12v5m0 4h2v7H4v-7h2m2 0h8m-8 0v4h8v-4" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuId(null);
                        setMenuPosition({ top: 0, right: 0 });
                        handleDownloadAR(selectedInvoice);
                      }}
                      className="flex items-center justify-between w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                    >
                      <span>Download Acknowledgement Receipt</span>
                      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    </button>
                    {selectedInvoice.installmentinvoiceprofiles_id && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleViewInstallmentInvoice(selectedInvoice);
                        }}
                        className="flex items-center justify-between w-full text-left px-4 py-2 text-sm text-indigo-600 hover:bg-indigo-50 transition-colors"
                      >
                        <span>View Installment Invoice</span>
                        <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12H9m12 0A9 9 0 113 12a9 9 0 0118 0z" />
                        </svg>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (selectedInvoice.status === 'Paid') return;
                        if (
                          selectedInvoice.balance_invoice_id ||
                          selectedInvoice.can_record_payment === false
                        ) {
                          return;
                        }
                        setOpenMenuId(null);
                        setMenuPosition({ top: 0, right: 0 });
                        handleOpenPaymentModal(selectedInvoice);
                      }}
                      disabled={
                        selectedInvoice.status === 'Paid' ||
                        !!selectedInvoice.balance_invoice_id ||
                        selectedInvoice.can_record_payment === false
                      }
                      className={`flex items-center justify-between w-full text-left px-4 py-2 text-sm transition-colors ${
                        selectedInvoice.status === 'Paid' ||
                        !!selectedInvoice.balance_invoice_id ||
                        selectedInvoice.can_record_payment === false
                          ? 'text-gray-400 cursor-not-allowed opacity-60'
                          : 'text-green-600 hover:bg-green-50'
                      }`}
                    >
                      <span>Pay</span>
                      <svg className={`w-4 h-4 ${selectedInvoice.status === 'Paid' ? 'text-gray-400' : 'text-green-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!isInvoiceOverdue(selectedInvoice)) {
                          return;
                        }
                        setOpenMenuId(null);
                        setMenuPosition({ top: 0, right: 0 });
                        handleSendOverdueEmail(selectedInvoice);
                      }}
                      disabled={!isInvoiceOverdue(selectedInvoice)}
                      className={`flex items-center justify-between w-full text-left px-4 py-2 text-sm transition-colors ${
                        isInvoiceOverdue(selectedInvoice)
                          ? 'text-orange-600 hover:bg-orange-50 cursor-pointer'
                          : 'text-gray-400 cursor-not-allowed opacity-50'
                      }`}
                    >
                      <span>Send Email</span>
                      <svg className={`w-4 h-4 ${isInvoiceOverdue(selectedInvoice) ? 'text-orange-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    </button>
                  </>
                );
              })()}
            </div>
          </div>
        </>,
        document.body
      )}

      <StandardExportModal
        open={showExportModal}
        onClose={() => setShowExportModal(false)}
        title="Export Invoices"
        description={
          <>
            With a date range: exports payment lines by Manila <span className="font-medium">payment date</span>, using the
            same rules as <span className="font-medium">Payment Logs</span> for your branch (main list). Without dates:
            current table rows (invoice view) with optional unpaid filter.
          </>
        }
        exportLoading={exportLoading}
        onExport={handleExportToExcel}
        exportDisabled={exportSelectedStatuses.length === 0}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Payment date from</label>
            <input
              type="date"
              value={exportDateFrom}
              onChange={(e) => setExportDateFrom(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Payment date to</label>
            <input
              type="date"
              value={exportDateTo}
              onChange={(e) => setExportDateTo(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
        </div>
        {(() => {
          const hasDateRange = Boolean(exportDateFrom?.trim() || exportDateTo?.trim());
          return (
            <div>
              <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <label className="text-sm font-medium text-gray-700">
                  Statuses to include
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setExportSelectedStatuses(
                      exportSelectedStatuses.length === INVOICE_EXPORT_DEFAULT_STATUSES.length
                        ? []
                        : INVOICE_EXPORT_DEFAULT_STATUSES
                    )
                  }
                  className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 sm:self-start"
                >
                  {exportSelectedStatuses.length === INVOICE_EXPORT_DEFAULT_STATUSES.length
                    ? 'Clear All'
                    : 'Select All'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1 rounded-lg border border-gray-200 bg-white p-2 sm:grid-cols-3">
                {INVOICE_EXPORT_DEFAULT_STATUSES.map((status) => {
                  const checked = exportSelectedStatuses.includes(status);
                  return (
                    <label
                      key={status}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setExportSelectedStatuses((prev) =>
                            prev.includes(status)
                              ? prev.filter((s) => s !== status)
                              : [...prev, status]
                          )
                        }
                        className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      <span className="text-gray-700">{status}</span>
                    </label>
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {hasDateRange
                  ? 'Filters payments by their parent invoice status. Default: all statuses.'
                  : 'Filters invoice rows by status. Default: all statuses.'}
              </p>
            </div>
          );
        })()}
      </StandardExportModal>

      {/* Create/Edit Invoice Modal */}
      {isModalOpen && createPortal(
        <div 
          className="fixed inset-0 backdrop-blur-sm bg-black/5 flex items-center justify-center z-[9999] p-4"
          onClick={closeModal}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0 bg-white rounded-t-lg">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                  {editingInvoice ? 'Edit Invoice' : 'Create New Invoice'}
                </h2>
                {!editingInvoice && (
                  <p className="text-sm text-gray-500 mt-1">Fill in the details to create a new invoice</p>
                )}
              </div>
              <button
                onClick={closeModal}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
              <div className="p-6 overflow-y-auto flex-1">
                {error && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                    {error}
                  </div>
                )}
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                    {!editingInvoice && (
                      <div>
                        <label htmlFor="branch_id" className="label-field">
                          Branch
                        </label>
                        {/* Branch is auto-set to admin's branch - read-only display */}
                        <div>
                          <input
                            type="text"
                            value={selectedBranchName}
                            readOnly
                            className="input-field bg-gray-50 cursor-not-allowed"
                          />
                          <input
                            type="hidden"
                            id="branch_id"
                            name="branch_id"
                            value={formData.branch_id}
                          />
                          <p className="mt-1 text-xs text-gray-500">
                            Branch is automatically set to your branch
                          </p>
                        </div>
                      </div>
                    )}

                    <div>
                      <label htmlFor="status" className="label-field">
                        Status
                      </label>
                      <select
                        id="status"
                        name="status"
                        value={formData.status}
                        onChange={handleInputChange}
                        className="input-field"
                      >
                        <option value="Draft">Draft</option>
                        <option value="Pending">Pending</option>
                        <option value="Paid">Paid</option>
                        <option value="Overdue">Overdue</option>
                        <option value="Cancelled">Cancelled</option>
                      </select>
                    </div>

                    <div>
                      <label htmlFor="amount" className="label-field">
                        Total Amount
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        id="amount"
                        name="amount"
                        value={formData.amount}
                        onChange={handleInputChange}
                        className="input-field"
                        placeholder="0.00"
                      />
                    </div>

                    <div>
                      <label htmlFor="issue_date" className="label-field">
                        Issue Date
                      </label>
                      <input
                        type="date"
                        id="issue_date"
                        name="issue_date"
                        value={formData.issue_date}
                        onChange={handleInputChange}
                        className="input-field"
                      />
                    </div>

                    <div>
                      <label htmlFor="due_date" className="label-field">
                        Due Date
                      </label>
                      <input
                        type="date"
                        id="due_date"
                        name="due_date"
                        value={formData.due_date}
                        onChange={handleInputChange}
                        className={`input-field ${formErrors.due_date ? 'border-red-500' : ''}`}
                      />
                      {formErrors.due_date && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.due_date}</p>
                      )}
                    </div>

                    <div className="md:col-span-2">
                      <label htmlFor="remarks" className="label-field">
                        Remarks
                      </label>
                      <textarea
                        id="remarks"
                        name="remarks"
                        value={formData.remarks}
                        onChange={handleInputChange}
                        className="input-field"
                        rows="3"
                        placeholder="Additional notes or remarks..."
                      />
                    </div>
                  </div>

                  {/* Invoice Items Section - Only show when creating */}
                  {!editingInvoice && (
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold text-gray-900">Invoice Items</h3>
                        <button
                          type="button"
                          onClick={addItem}
                          className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                        >
                          + Add Item
                        </button>
                      </div>

                      {formData.items.length === 0 ? (
                        <p className="text-sm text-gray-500 italic">No items added yet. Click "Add Item" to add invoice line items.</p>
                      ) : (
                        <div className="space-y-3">
                          {formData.items.map((item, index) => (
                            <div key={index} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                              <div className="flex items-start justify-between">
                                <div className="flex-1 space-y-2">
                                  <div>
                                    <span className="text-xs text-gray-500">Description:</span>
                                    <span className="ml-2 text-sm font-medium text-gray-900">{item.description}</span>
                                  </div>
                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                                    <div>
                                      <span className="text-gray-500">Amount:</span>
                                      <span className="ml-1 font-medium">₱{parseFloat(item.amount || 0).toFixed(2)}</span>
                                    </div>
                                    {item.tax_percentage && (
                                      <div>
                                        <span className="text-gray-500">Tax ({item.tax_percentage}%):</span>
                                        <span className="ml-1 font-medium">₱{(parseFloat(item.amount || 0) * parseFloat(item.tax_percentage) / 100).toFixed(2)}</span>
                                      </div>
                                    )}
                                    {item.discount_amount && (
                                      <div>
                                        <span className="text-gray-500">Discount:</span>
                                        <span className="ml-1 font-medium text-green-600">-₱{parseFloat(item.discount_amount).toFixed(2)}</span>
                                      </div>
                                    )}
                                    {item.penalty_amount && (
                                      <div>
                                        <span className="text-gray-500">Penalty:</span>
                                        <span className="ml-1 font-medium text-red-600">+₱{parseFloat(item.penalty_amount).toFixed(2)}</span>
                                      </div>
                                    )}
                                  </div>
                                  <div>
                                    <span className="text-xs text-gray-500">Total:</span>
                                    <span className="ml-2 text-sm font-bold text-gray-900">₱{calculateItemTotal(item).toFixed(2)}</span>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => removeItem(index)}
                                  className="text-red-600 hover:text-red-700 ml-4"
                                >
                                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Add Item Form */}
                      <div className="mt-4 border border-gray-200 rounded-lg p-4 bg-gray-50">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="md:col-span-2">
                            <label className="label-field text-xs">Description *</label>
                            <input
                              type="text"
                              value={newItem.description}
                              onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                              className="input-field text-sm"
                              placeholder="Item description"
                            />
                          </div>
                          <div>
                            <label className="label-field text-xs">Amount *</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={newItem.amount}
                              onChange={(e) => setNewItem({ ...newItem, amount: e.target.value })}
                              className="input-field text-sm"
                              placeholder="0.00"
                            />
                          </div>
                          <div>
                            <label className="label-field text-xs">Tax Item</label>
                            <input
                              type="text"
                              value={newItem.tax_item}
                              onChange={(e) => setNewItem({ ...newItem, tax_item: e.target.value })}
                              className="input-field text-sm"
                              placeholder="e.g., VAT, GST"
                            />
                          </div>
                          <div>
                            <label className="label-field text-xs">Tax Percentage (%)</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              max="100"
                              value={newItem.tax_percentage}
                              onChange={(e) => setNewItem({ ...newItem, tax_percentage: e.target.value })}
                              className="input-field text-sm"
                              placeholder="0.00"
                            />
                          </div>
                          <div>
                            <label className="label-field text-xs">Discount Amount</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={newItem.discount_amount}
                              onChange={(e) => setNewItem({ ...newItem, discount_amount: e.target.value })}
                              className="input-field text-sm"
                              placeholder="0.00"
                            />
                          </div>
                          <div>
                            <label className="label-field text-xs">Penalty Amount</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={newItem.penalty_amount}
                              onChange={(e) => setNewItem({ ...newItem, penalty_amount: e.target.value })}
                              className="input-field text-sm"
                              placeholder="0.00"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Invoice Students Section - Only show when creating */}
                  {!editingInvoice && (
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold text-gray-900">Students</h3>
                        <button
                          type="button"
                          onClick={addStudent}
                          className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                        >
                          + Add Student
                        </button>
                      </div>

                      {formData.students.length === 0 ? (
                        <p className="text-sm text-gray-500 italic">No students added yet. Click "Add Student" to link students to this invoice.</p>
                      ) : (
                        <div className="space-y-2">
                          {formData.students.map((studentId) => (
                            <div key={studentId} className="flex items-center justify-between border border-gray-200 rounded-lg p-3 bg-gray-50">
                              <span className="text-sm text-gray-900">{getStudentName(studentId) || `Student ID: ${studentId}`}</span>
                              <button
                                type="button"
                                onClick={() => removeStudent(studentId)}
                                className="text-red-600 hover:text-red-700"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Add Student Form */}
                      <div className="mt-4">
                        <select
                          value={newStudentId}
                          onChange={(e) => setNewStudentId(e.target.value)}
                          className="input-field"
                        >
                          <option value="">Select Student</option>
                          {students
                            .filter(s => !formData.students.includes(s.user_id))
                            .map((student) => (
                              <option key={student.user_id} value={student.user_id}>
                                {student.full_name} {student.email ? `(${student.email})` : ''}
                              </option>
                            ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {editingInvoice && (
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-sm">
                      <p>To manage invoice items and students, use the "Manage Details" option from the action menu after saving.</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 flex-shrink-0 bg-white rounded-b-lg">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium text-gray-900 bg-[#F7C844] hover:bg-[#F5B82E] rounded-lg transition-colors"
                  disabled={submitting}
                >
                  {submitting ? (
                    <span className="flex items-center space-x-2">
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>Saving...</span>
                    </span>
                  ) : (
                    editingInvoice ? 'Update Invoice' : 'Create Invoice'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Manage Details Modal */}
      {showDetailsModal && selectedInvoiceForDetails && createPortal(
        <div 
          className="fixed inset-0 backdrop-blur-sm bg-black/5 flex items-center justify-center z-[9999] p-4"
          onClick={closeDetailsModal}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0 bg-white rounded-t-lg">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                  View & Edit Invoice
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  INV-{selectedInvoiceForDetails.invoice_id}
                  {selectedInvoiceForDetails.invoice_description && (
                    <span className="ml-2">- {selectedInvoiceForDetails.invoice_description}</span>
                  )}
                </p>
              </div>
              <button
                onClick={closeDetailsModal}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {(selectedInvoiceForDetails.balance_invoice_id ||
              selectedInvoiceForDetails.can_record_payment === false) && (
              <div className="px-6 pb-2">
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                  <p className="font-medium">Partial payment applied</p>
                  <p className="mt-1">
                    Further payments cannot be recorded on this invoice.
                    {selectedInvoiceForDetails.continued_to_invoice ? (
                      <>
                        {' '}
                        Record the remaining balance on{' '}
                        <span className="font-semibold">
                          {selectedInvoiceForDetails.continued_to_invoice.display_description ||
                            selectedInvoiceForDetails.continued_to_invoice.invoice_description ||
                            `INV-${selectedInvoiceForDetails.continued_to_invoice.invoice_id}`}
                        </span>
                        .
                      </>
                    ) : (
                      <span> Use the newest balance invoice in this chain from the list.</span>
                    )}
                  </p>
                </div>
              </div>
            )}

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-1">
              {/* Invoice Details Section */}
              <div className="mb-8">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Invoice Details</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <span className="text-xs text-gray-500">Branch:</span>
                    <p className="text-sm font-medium text-gray-900 mt-1">
                      {selectedBranchName || '-'}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Status:</span>
                    {editingStatus ? (
                      <div className="mt-1 flex items-center gap-2">
                        <select
                          value={tempStatus}
                          onChange={(e) => handleStatusChange(e.target.value)}
                          disabled={updatingStatus}
                          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:border-transparent bg-white"
                        >
                          <option value="Pending">Pending</option>
                          <option value="Unpaid">Unpaid</option>
                          <option value="Paid">Paid</option>
                        </select>
                        <button
                          onClick={updateInvoiceStatus}
                          disabled={updatingStatus}
                          className="px-3 py-1.5 text-xs font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {updatingStatus ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={cancelEditingStatus}
                          disabled={updatingStatus}
                          className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="mt-1 flex items-center gap-2">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${
                              selectedInvoiceForDetails.status === 'Paid'
                                ? 'bg-green-100 text-green-800'
                                : selectedInvoiceForDetails.status === 'Pending'
                                ? 'bg-yellow-100 text-yellow-800'
                                : selectedInvoiceForDetails.status === 'Unpaid'
                                ? 'bg-gray-200 text-gray-700'
                                : selectedInvoiceForDetails.status === 'Rejected'
                                ? 'bg-red-100 text-red-800'
                                : selectedInvoiceForDetails.status === 'Overdue'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {selectedInvoiceForDetails.status || 'Draft'}
                        </span>
                        <button
                          onClick={startEditingStatus}
                          className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                          title="Edit status"
                        >
                          Edit
                        </button>
                      </div>
                    )}
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Total Amount:</span>
                    <p className="text-sm font-medium text-gray-900 mt-1">
                      {selectedInvoiceForDetails.amount !== null && selectedInvoiceForDetails.amount !== undefined
                        ? `₱${getInvoiceDisplayAmount(selectedInvoiceForDetails).toFixed(2)}`
                        : '-'}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Issue Date:</span>
                    <p className="text-sm font-medium text-gray-900 mt-1">
                      {selectedInvoiceForDetails.issue_date
                        ? formatDateManila(selectedInvoiceForDetails.issue_date)
                        : '-'}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Due Date:</span>
                    <p className="text-sm font-medium text-gray-900 mt-1">
                      {selectedInvoiceForDetails.due_date
                        ? formatDateManila(selectedInvoiceForDetails.due_date)
                        : '-'}
                    </p>
                  </div>
                  {selectedInvoiceForDetails.remarks && (
                    <div className="md:col-span-2">
                      <span className="text-xs text-gray-500">Remarks:</span>
                      <p className="text-sm text-gray-900 mt-1">{selectedInvoiceForDetails.remarks}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Invoice Items Section */}
              <div className="mb-8">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Invoice Items</h3>
                {selectedInvoiceForDetails.expandedItems && selectedInvoiceForDetails.expandedItems.length > 0 ? (
                  <div className="space-y-3 mb-4">
                    {selectedInvoiceForDetails.expandedItems.map((item) => {
                      const isInclusion = item.isInclusion;
                      const isPackage = item.description && item.description.startsWith('Package:');
                      
                      return (
                        <div key={item.invoice_item_id} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                          <div className="flex items-start justify-between">
                            <div className="flex-1 space-y-2">
                              <div>
                                <span className="text-xs text-gray-500">Description:</span>
                                <span className="ml-2 text-sm font-medium text-gray-900">{item.description || '-'}</span>
                              </div>
                              {/* Only show amount and total for packages, not for inclusions */}
                              {!isInclusion && (
                                <>
                                  {item.amount !== null && item.amount !== undefined && (
                                    <div>
                                      <span className="text-xs text-gray-500">Amount:</span>
                                      <span className="ml-2 text-sm font-medium text-gray-900">₱{parseFloat(item.amount || 0).toFixed(2)}</span>
                                    </div>
                                  )}
                                  <div>
                                    <span className="text-xs text-gray-500">Total:</span>
                                    <span className="ml-2 text-sm font-bold text-gray-900">?{calculateItemTotal(item).toFixed(2)}</span>
                                  </div>
                                </>
                              )}
                            </div>
                            {/* Only show delete button for actual invoice items, not inclusions */}
                            {!isInclusion && (
                              <button
                                onClick={() => removeInvoiceItem(item.invoice_item_id)}
                                className="text-red-600 hover:text-red-700 ml-4"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : selectedInvoiceForDetails.items && selectedInvoiceForDetails.items.length > 0 ? (
                  <div className="space-y-3 mb-4">
                    {selectedInvoiceForDetails.items.map((item) => (
                      <div key={item.invoice_item_id} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 space-y-2">
                            <div>
                              <span className="text-xs text-gray-500">Description:</span>
                              <span className="ml-2 text-sm font-medium text-gray-900">{item.description || '-'}</span>
                            </div>
                            {item.amount !== null && item.amount !== undefined && (
                              <div>
                                <span className="text-xs text-gray-500">Amount:</span>
                                <span className="ml-2 text-sm font-medium text-gray-900">₱{parseFloat(item.amount || 0).toFixed(2)}</span>
                              </div>
                            )}
                            <div>
                              <span className="text-xs text-gray-500">Total:</span>
                              <span className="ml-2 text-sm font-bold text-gray-900">?{calculateItemTotal(item).toFixed(2)}</span>
                            </div>
                          </div>
                          <button
                            onClick={() => removeInvoiceItem(item.invoice_item_id)}
                            className="text-red-600 hover:text-red-700 ml-4"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 italic mb-4">No items added yet.</p>
                )}

                {/* Add New Item */}
                <div className="border-t border-gray-200 pt-4">
                  <h4 className="text-md font-semibold text-gray-900 mb-3">Add New Item</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <label className="label-field text-xs">Description *</label>
                      <input
                        type="text"
                        value={newItem.description}
                        onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                        className="input-field text-sm"
                        placeholder="Item description"
                      />
                    </div>
                    <div>
                      <label className="label-field text-xs">Amount *</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={newItem.amount}
                        onChange={(e) => setNewItem({ ...newItem, amount: e.target.value })}
                        className="input-field text-sm"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="label-field text-xs">Tax Item</label>
                      <input
                        type="text"
                        value={newItem.tax_item}
                        onChange={(e) => setNewItem({ ...newItem, tax_item: e.target.value })}
                        className="input-field text-sm"
                        placeholder="e.g., VAT, GST"
                      />
                    </div>
                    <div>
                      <label className="label-field text-xs">Tax Percentage (%)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={newItem.tax_percentage}
                        onChange={(e) => setNewItem({ ...newItem, tax_percentage: e.target.value })}
                        className="input-field text-sm"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="label-field text-xs">Discount Amount</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={newItem.discount_amount}
                        onChange={(e) => setNewItem({ ...newItem, discount_amount: e.target.value })}
                        className="input-field text-sm"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="label-field text-xs">Penalty Amount</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={newItem.penalty_amount}
                        onChange={(e) => setNewItem({ ...newItem, penalty_amount: e.target.value })}
                        className="input-field text-sm"
                        placeholder="0.00"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <button
                        type="button"
                        onClick={addInvoiceItem}
                        className="px-4 py-2 text-sm font-medium text-gray-900 bg-[#F7C844] hover:bg-[#F5B82E] rounded-lg transition-colors"
                      >
                        Add Item
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Invoice Students Section */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Students</h3>
                {selectedInvoiceForDetails.students && selectedInvoiceForDetails.students.length > 0 ? (
                  <div className="space-y-2 mb-4">
                    {selectedInvoiceForDetails.students.map((student) => (
                      <div key={student.invoice_student_id} className="flex items-center justify-between border border-gray-200 rounded-lg p-3 bg-gray-50">
                        <div>
                          <span className="text-sm font-medium text-gray-900">{student.full_name || `Student ID: ${student.student_id}`}</span>
                          {student.email && (
                            <span className="ml-2 text-sm text-gray-500">({student.email})</span>
                          )}
                        </div>
                        <button
                          onClick={() => removeInvoiceStudent(student.student_id)}
                          className="text-red-600 hover:text-red-700"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 italic mb-4">No students linked yet.</p>
                )}

                {/* Add New Student */}
                <div className="border-t border-gray-200 pt-4">
                  <h4 className="text-md font-semibold text-gray-900 mb-3">Add Student</h4>
                  <div className="flex gap-2">
                    <select
                      value={newStudentId}
                      onChange={(e) => setNewStudentId(e.target.value)}
                      className="input-field flex-1"
                    >
                      <option value="">Select Student</option>
                      {students
                        .filter(s => !selectedInvoiceForDetails.students?.some(linked => linked.student_id === s.user_id))
                        .map((student) => (
                          <option key={student.user_id} value={student.user_id}>
                            {student.full_name} {student.email ? `(${student.email})` : ''}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      onClick={addInvoiceStudent}
                      className="px-4 py-2 text-sm font-medium text-gray-900 bg-[#F7C844] hover:bg-[#F5B82E] rounded-lg transition-colors"
                    >
                      Add Student
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 flex-shrink-0 bg-white rounded-b-lg">
              <button
                type="button"
                onClick={closeDetailsModal}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Payment Modal */}
      {showPaymentModal && selectedInvoiceForPayment && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center backdrop-blur-sm bg-black/5">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
              <h2 className="text-xl font-semibold text-gray-900">Record Payment</h2>
              <button
                onClick={handleClosePaymentModal}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmitPayment} className="p-6 space-y-6">
              {/* Payment Form */}
              <div className="space-y-4">
                <div>
                  <label className="label-field text-xs">
                    Student <span className="text-red-500">*</span>
                  </label>
                  <select
                    name="student_id"
                    value={paymentFormData.student_id}
                    onChange={handlePaymentInputChange}
                    className={`input-field text-sm ${paymentFormErrors.student_id ? 'border-red-500' : ''}`}
                    required
                  >
                    <option value="">Select Student</option>
                    {selectedInvoiceForPayment.students && selectedInvoiceForPayment.students.map((student) => (
                      <option key={student.student_id} value={student.student_id}>
                        {student.full_name} {student.email ? `(${student.email})` : ''}
                      </option>
                    ))}
                  </select>
                  {paymentFormErrors.student_id && (
                    <p className="text-xs text-red-500 mt-1">{paymentFormErrors.student_id}</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label-field text-xs">
                      Payment Type <span className="text-red-500">*</span>
                    </label>
                    <select
                      name="payment_type"
                      value={paymentFormData.payment_type}
                      onChange={handlePaymentInputChange}
                      className={`input-field text-sm ${paymentFormErrors.payment_type ? 'border-red-500' : ''}`}
                      required
                    >
                      <option value="">Select Payment Type</option>
                      <option value="Full Payment">Full Payment</option>
                      <option value="Partial Payment">Partial Payment</option>
                      <option value="Advance Payment">Advance Payment</option>
                    </select>
                    {paymentFormErrors.payment_type && (
                      <p className="text-xs text-red-500 mt-1">{paymentFormErrors.payment_type}</p>
                    )}
                  </div>

                  <div>
                    <label className="label-field text-xs">
                      Payment Method <span className="text-red-500">*</span>
                    </label>
                    <select
                      name="payment_method"
                      value={paymentFormData.payment_method}
                      onChange={handlePaymentInputChange}
                      className={`input-field text-sm ${paymentFormErrors.payment_method ? 'border-red-500' : ''}`}
                      required
                    >
                      <option value="Cash">Cash</option>
                      <option value="Online Banking">Online Banking</option>
                      <option value="Credit Card">Credit Card</option>
                      <option value="E-wallets">E-wallets</option>
                    </select>
                    {paymentFormErrors.payment_method && (
                      <p className="text-xs text-red-500 mt-1">{paymentFormErrors.payment_method}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label-field text-xs">
                      Payable Amount <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      max={
                        paymentFormData.payment_type === 'Partial Payment'
                          ? Math.max(0, (parseFloat(selectedInvoiceForPayment.amount || 0) || 0) - 0.01).toFixed(2)
                          : undefined
                      }
                      name="payable_amount"
                      value={paymentFormData.payable_amount}
                      onChange={handlePaymentInputChange}
                      disabled={paymentFormData.payment_type === 'Full Payment'}
                      className={`input-field text-sm ${
                        paymentFormData.payment_type === 'Full Payment'
                          ? 'bg-gray-100 text-gray-600 cursor-not-allowed'
                          : ''
                      } ${paymentFormErrors.payable_amount ? 'border-red-500' : ''}`}
                      placeholder="0.00"
                      required
                    />
                    {paymentFormErrors.payable_amount && (
                      <p className="text-xs text-red-500 mt-1">{paymentFormErrors.payable_amount}</p>
                    )}
                    {paymentFormData.payment_type === 'Partial Payment' && (
                      <p className="text-xs text-amber-600 mt-1">
                        Partial payment must be lower than remaining amount
                        ({` ₱${parseFloat(selectedInvoiceForPayment.amount || 0).toFixed(2)}`}).
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="label-field text-xs">Tip / Excess Amount (Optional)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      name="tip_amount"
                      value={paymentFormData.tip_amount}
                      onChange={handlePaymentInputChange}
                      className={`input-field text-sm ${paymentFormErrors.tip_amount ? 'border-red-500' : ''}`}
                      placeholder="0.00"
                    />
                    {paymentFormErrors.tip_amount && (
                      <p className="text-xs text-red-500 mt-1">{paymentFormErrors.tip_amount}</p>
                    )}
                  </div>

                  <div className="col-span-full">
                    <label className="label-field text-xs">Discount Amount (Optional)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max={
                        parseFloat(paymentFormData.payable_amount || 0) > 0
                          ? Math.max(0, parseFloat(paymentFormData.payable_amount || 0) - 0.01).toFixed(2)
                          : undefined
                      }
                      name="discount_amount"
                      value={paymentFormData.discount_amount}
                      onChange={handlePaymentInputChange}
                      className={`input-field text-sm ${paymentFormErrors.discount_amount ? 'border-red-500' : ''}`}
                      placeholder="0.00"
                    />
                    {paymentFormErrors.discount_amount ? (
                      <p className="text-xs text-red-500 mt-1">{paymentFormErrors.discount_amount}</p>
                    ) : (
                      <p className="text-xs text-gray-500 mt-1">
                        Optional. When provided, this is deducted from what the student needs to pay (e.g. promo,
                        early-bird, scholarship). The discount closes the invoice balance but is not counted as revenue.
                      </p>
                    )}
                  </div>

                  <div className="col-span-full">
                    <label className="label-field text-xs">
                      Payment date <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      name="issue_date"
                      value={paymentFormData.issue_date}
                      onChange={handlePaymentInputChange}
                      className={`input-field text-sm ${paymentFormErrors.issue_date ? 'border-red-500' : ''}`}
                      required
                    />
                    {paymentFormErrors.issue_date && (
                      <p className="text-xs text-red-500 mt-1">{paymentFormErrors.issue_date}</p>
                    )}
                    <p className="text-xs text-gray-500 mt-1">
                      When the client actually paid (e.g. bank or e-wallet transfer date). Defaults to today if payment was today.
                      This date is stored as the payment record date and shown as <span className="font-medium">Payment Date</span>{' '}
                      in Payment Logs.
                    </p>
                  </div>
                </div>

                <div>
                  <label className="label-field text-xs">Attachment (image) *</label>
                  <p className="text-xs text-gray-500 mb-1">Upload a receipt or proof of payment (JPEG, PNG, WebP, GIF, max 50MB)</p>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={handlePaymentAttachmentChange}
                    disabled={paymentAttachmentUploading}
                    className="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-3 file:rounded file:border-0 file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
                  />
                  {paymentAttachmentUploading && (
                    <p className="text-xs text-amber-600 mt-1">Uploading?</p>
                  )}
                  {paymentFormErrors.attachment_url && (
                    <p className="text-xs text-red-500 mt-1">{paymentFormErrors.attachment_url}</p>
                  )}
                  {paymentFormData.attachment_url && !paymentAttachmentUploading && (
                    <div className="mt-2">
                      <img
                        src={paymentFormData.attachment_url}
                        alt="Payment attachment preview"
                        className="max-h-48 w-auto rounded-lg border border-gray-200 object-contain bg-gray-50"
                      />
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        <a
                          href={paymentFormData.attachment_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-primary-600 hover:underline"
                        >
                          View attached image
                        </a>
                        <button
                          type="button"
                          onClick={clearPaymentAttachment}
                          className="text-xs text-red-600 hover:text-red-700"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <label className="label-field text-xs">Reference Number *</label>
                  <input
                    type="text"
                    name="reference_number"
                    value={paymentFormData.reference_number}
                    onChange={handlePaymentInputChange}
                    className={`input-field text-sm ${paymentFormErrors.reference_number ? 'border-red-500' : ''}`}
                    placeholder="Enter reference number (e.g. cash voucher, receipt no.)"
                  />
                  {paymentFormErrors.reference_number && (
                    <p className="text-xs text-red-500 mt-1">{paymentFormErrors.reference_number}</p>
                  )}
                </div>

                <div>
                  <label className="label-field text-xs">Remarks</label>
                  <textarea
                    name="remarks"
                    value={paymentFormData.remarks}
                    onChange={handlePaymentInputChange}
                    className="input-field text-sm"
                    rows="3"
                    placeholder="Optional remarks or notes"
                  />
                </div>

                {(() => {
                  const breakdown = getInvoiceBreakdown(selectedInvoiceForPayment);
                  const enteredAmount = parseFloat(paymentFormData.payable_amount || 0) || 0;
                  const discountAtPayment = paymentFormData.discount_amount === ''
                    ? 0
                    : Math.max(0, parseFloat(paymentFormData.discount_amount) || 0);
                  const payableToApply = Math.max(0, Math.min(enteredAmount, breakdown.remaining));
                  const projectedRemaining = Math.max(0, breakdown.remaining - payableToApply);
                  const projectedTotalPaid = breakdown.paidAmount + payableToApply;
                  return (
                    <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                      <h3 className="text-sm font-semibold text-gray-700">Invoice Information</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-xs text-gray-600">Invoice ID</p>
                          <p className="font-medium text-gray-900">
                            {selectedInvoiceForPayment.display_description ||
                              selectedInvoiceForPayment.invoice_description ||
                              `INV-${selectedInvoiceForPayment.invoice_id}`}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-600">Issue Date</p>
                          <p className="font-medium text-gray-900">{formatDateManila(selectedInvoiceForPayment.issue_date)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-600">Due Date</p>
                          <p className="font-medium text-gray-900">{formatDateManila(selectedInvoiceForPayment.due_date)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-600">Remaining Balance</p>
                          <p className="font-semibold text-blue-700">₱{breakdown.remaining.toFixed(2)}</p>
                        </div>
                      </div>
                      <div className="border-t border-gray-200 pt-3 space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Subtotal</span>
                          <span className="text-gray-900">₱{breakdown.subtotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Discount</span>
                          <span className="text-gray-900">- ₱{breakdown.discount.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Penalty</span>
                          <span className="text-gray-900">₱{breakdown.penalty.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Tax</span>
                          <span className="text-gray-900">₱{breakdown.tax.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between font-semibold border-t border-gray-200 pt-2 mt-2">
                          <span className="text-gray-800">Total Invoice Amount</span>
                          <span className="text-gray-900">₱{breakdown.totalDue.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Total Paid</span>
                          <span className="text-emerald-700">₱{breakdown.paidAmount.toFixed(2)}</span>
                        </div>
                        {discountAtPayment > 0 && (
                          <>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Payable Entered</span>
                              <span className="text-gray-900">₱{enteredAmount.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Discount (at payment)</span>
                              <span className="text-rose-600">- ₱{discountAtPayment.toFixed(2)}</span>
                            </div>
                          </>
                        )}
                        <div className="flex justify-between">
                          <span className="text-gray-600">Payment to Record</span>
                          <span className="text-gray-900">₱{payableToApply.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Projected Total Paid</span>
                          <span className="text-emerald-700">₱{projectedTotalPaid.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between font-semibold">
                          <span className="text-gray-800">Projected Remaining After Payment</span>
                          <span className="text-blue-700">₱{projectedRemaining.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={handleClosePaymentModal}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                  disabled={submittingPayment}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={submittingPayment}
                >
                  {submittingPayment ? 'Recording...' : 'Record Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      <PaymentRecordedInvoiceSummaryModal
        open={!!paymentRecordedSummary}
        invoice={paymentRecordedSummary?.invoice}
        branchName={
          paymentRecordedSummary?.invoice?.branch_name || selectedBranchName || ''
        }
        paymentSnapshot={paymentRecordedSummary?.paymentSnapshot}
        onClose={closePaymentRecordedInvoiceSummary}
        onPrintAcknowledgementReceipt={handlePrintPaymentRecordedAckPdf}
        printLoading={paymentRecordedPdfLoading}
      />
    </div>
  );
};

export default AdminInvoice;

