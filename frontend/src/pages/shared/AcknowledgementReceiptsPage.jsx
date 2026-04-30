import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import API_BASE_URL, { apiRequest } from '../../config/api';
import { todayManilaYMD, formatDateManila } from '../../utils/dateUtils';
import { useAuth } from '../../contexts/AuthContext';
import { useGlobalBranchFilter } from '../../contexts/GlobalBranchFilterContext';
import { appAlert, appConfirm, appPrompt } from '../../utils/appAlert';
import FixedTablePagination from '../../components/table/FixedTablePagination';
import PaymentAttachmentViewerModal from '../../components/paymentLogs/PaymentAttachmentViewerModal';
import { BranchPaymentLogTabs } from '../../components/paymentLogs/PaymentLogsViewTabs';

const LEVEL_TAG_OPTIONS = ['Playgroup', 'Nursery', 'Pre-Kindergarten', 'Kindergarten', 'Grade School'];
const AR_PAYMENT_METHOD_OPTIONS = ['Cash', 'Online Banking', 'Credit Card', 'E-wallets'];

const AcknowledgementReceiptsPage = () => {
  const { userInfo } = useAuth();
  const { selectedBranchId: globalBranchId } = useGlobalBranchFilter();
  const userType = userInfo?.user_type || userInfo?.userType;
  const isSuperadmin = userType === 'Superadmin';
  const isAdminOrSuperadmin = userType === 'Superadmin' || userType === 'Admin';
  const isFinanceOrSuperfinance = userType === 'Finance' || userType === 'Superfinance';
  const currentUserId = Number(userInfo?.user_id || userInfo?.userId || 0) || null;
  const userBranchId = userInfo?.branch_id || userInfo?.branchId || null;
  const [searchParams, setSearchParams] = useSearchParams();
  const initialStatus = searchParams.get('status') || '';
  const initialSearch = searchParams.get('search') || '';
  const initialPaymentMethod = searchParams.get('payment_method') || '';
  const initialArAdminTab =
    (userType === 'Superadmin' || userType === 'Admin') && searchParams.get('tab') === 'return'
      ? 'return'
      : 'main';
  const initialPageRaw = parseInt(searchParams.get('page') || '1', 10);
  const initialPage = Number.isFinite(initialPageRaw) && initialPageRaw > 0 ? initialPageRaw : 1;
  const initialLimitRaw = parseInt(searchParams.get('limit') || '10', 10);
  const initialLimit = [10, 20, 50, 100].includes(initialLimitRaw) ? initialLimitRaw : 10;
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [searchTerm, setSearchTerm] = useState(initialSearch);
  const [paymentMethodFilter, setPaymentMethodFilter] = useState(initialPaymentMethod);
  const searchHydratedRef = useRef(false);
  const statusHydratedRef = useRef(false);
  const paymentMethodHydratedRef = useRef(false);
  const [arAdminTab, setArAdminTab] = useState(initialArAdminTab);
  const arAdminTabHydratedRef = useRef(false);
  const [pagination, setPagination] = useState({
    page: initialPage,
    limit: initialLimit,
    total: 0,
    totalPages: 1,
  });

  const [packages, setPackages] = useState([]);
  const [packagesLoading, setPackagesLoading] = useState(false);
  const [merchandise, setMerchandise] = useState([]);
  const [merchandiseLoading, setMerchandiseLoading] = useState(false);
  const [branches, setBranches] = useState([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [selectedBranchId, setSelectedBranchId] = useState(
    !isSuperadmin && userBranchId ? String(userBranchId) : ''
  );

  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerUrl, setViewerUrl] = useState('');

  /** Returned-queue count (Finance/Superfinance returns) — Admin/Superadmin tabs badge */
  const [returnedArCount, setReturnedArCount] = useState(null);
  const [actionMenuRect, setActionMenuRect] = useState(null);
  const [viewReceipt, setViewReceipt] = useState(null);
  const [viewFormData, setViewFormData] = useState({
    package_id: '',
    prospect_student_name: '',
    prospect_student_contact: '',
    prospect_student_email: '',
    prospect_student_notes: '',
    level_tag: '',
    reference_number: '',
    payment_method: 'Cash',
    issue_date: todayManilaYMD(),
    tip_amount: '',
  });
  const [viewPayableAmount, setViewPayableAmount] = useState(0);
  const [viewModalAttachmentUrl, setViewModalAttachmentUrl] = useState('');
  const [viewModalAttachmentUploading, setViewModalAttachmentUploading] = useState(false);
  const [viewResubmitSaving, setViewResubmitSaving] = useState(false);
  const [editAttachmentUploading, setEditAttachmentUploading] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [branchModalStep, setBranchModalStep] = useState(1);
  const [arType, setArType] = useState('Package');
  const [selectedPackage, setSelectedPackage] = useState(null);
  const [merchandiseSelections, setMerchandiseSelections] = useState([]);
  const [createFormData, setCreateFormData] = useState({
    prospect_student_name: '',
    prospect_student_contact: '',
    prospect_student_email: '',
    prospect_student_notes: '',
    package_id: '',
    payment_amount: '',
    tip_amount: '',
    payment_method: 'Cash',
    level_tag: '',
    reference_number: '',
    payment_attachment_url: '',
    installment_option: 'downpayment_only',
    issue_date: todayManilaYMD(),
  });
  const [createFormErrors, setCreateFormErrors] = useState({});
  const [creating, setCreating] = useState(false);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [verifyLoadingId, setVerifyLoadingId] = useState(null);
  const [openActionMenuId, setOpenActionMenuId] = useState(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingReceiptId, setEditingReceiptId] = useState(null);
  const [editingReceiptMeta, setEditingReceiptMeta] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [isResubmitFlow, setIsResubmitFlow] = useState(false);
  const [financeReturnNote, setFinanceReturnNote] = useState('');
  const [deleteLoadingId, setDeleteLoadingId] = useState(null);
  const [editFormData, setEditFormData] = useState({
    package_id: '',
    prospect_student_name: '',
    prospect_student_contact: '',
    prospect_student_email: '',
    prospect_student_notes: '',
    level_tag: '',
    reference_number: '',
    payment_method: 'Cash',
    issue_date: todayManilaYMD(),
    tip_amount: '',
    payment_attachment_url: '',
  });
  const [editPayableAmount, setEditPayableAmount] = useState(0);
  const [editFormErrors, setEditFormErrors] = useState({});

  const extractLatestTagNote = (notes, tag) => {
    const text = String(notes || '');
    if (!text) return '';
    const safeTag = String(tag || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\[${safeTag}\\]\\s*([^\\n\\r]*)`, 'gi');
    let match;
    let latest = '';
    while ((match = regex.exec(text)) !== null) {
      latest = String(match[1] || '').trim();
    }
    return latest;
  };

  useEffect(() => {
    fetchReceipts(initialPage);

    if (isSuperadmin) {
      fetchBranches();
    } else if (userBranchId) {
      fetchPackages(userBranchId);
    } else {
      fetchPackages(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperadmin, userBranchId]);

  useEffect(() => {
    if (!isSuperadmin) return;
    setSelectedBranchId(globalBranchId ? String(globalBranchId) : '');
  }, [isSuperadmin, globalBranchId]);

  useEffect(() => {
    if (!isSuperadmin) return;
    if (selectedBranchId) {
      const branchId = parseInt(selectedBranchId, 10);
      if (!Number.isNaN(branchId)) {
        fetchPackages(branchId);
        if (arType === 'Merchandise') fetchMerchandise(branchId);
      }
    } else {
      fetchPackages(null);
      fetchMerchandise(null);
    }
    fetchReceipts(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperadmin, selectedBranchId]);

  const fetchReceipts = async (page = 1, limitOverride) => {
    try {
      setLoading(true);
      setError('');
      const effectiveLimit = Number.isFinite(limitOverride) ? limitOverride : pagination.limit;

      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(effectiveLimit));
      if (isAdminOrSuperadmin && arAdminTab === 'return') {
        params.set('status', 'Returned');
      } else {
        if (statusFilter) params.set('status', statusFilter);
        if (isAdminOrSuperadmin && arAdminTab === 'main') {
          params.set('exclude_status', 'Returned');
        }
      }
      if (searchTerm.trim()) params.set('search', searchTerm.trim());
      if (paymentMethodFilter) params.set('payment_method', paymentMethodFilter);
      if (isSuperadmin && selectedBranchId) params.set('branch_id', selectedBranchId);

      const response = await apiRequest(`/acknowledgement-receipts?${params.toString()}`);
      setReceipts(response.data || []);
      if (response.pagination) {
        setPagination({
          page: response.pagination.page,
          limit: response.pagination.limit,
          total: response.pagination.total,
          totalPages:
            response.pagination.totalPages ??
            Math.ceil((response.pagination.total || 0) / response.pagination.limit),
        });
      }
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (isAdminOrSuperadmin && arAdminTab === 'return') {
          next.delete('status');
          next.set('tab', 'return');
        } else {
          if (statusFilter) next.set('status', statusFilter);
          else next.delete('status');
          next.delete('tab');
        }
        if (searchTerm.trim()) next.set('search', searchTerm.trim());
        else next.delete('search');
        if (paymentMethodFilter) next.set('payment_method', paymentMethodFilter);
        else next.delete('payment_method');
        next.set('page', String(page));
        next.set('limit', String(effectiveLimit));
        return next;
      });
    } catch (err) {
      console.error('Error fetching acknowledgement receipts:', err);
      setError('Failed to load acknowledgement receipts. Please try again.');
    } finally {
      setLoading(false);
    }
  };
  const handleLimitChange = (nextLimit) => {
    setPagination((prev) => ({ ...prev, limit: nextLimit, page: 1 }));
    fetchReceipts(1, nextLimit);
  };

  const fetchPackages = async (branchId) => {
    try {
      setPackagesLoading(true);
      let url = '/packages?limit=100';
      if (branchId) {
        url = `/packages?branch_id=${branchId}&limit=100`;
      }
      const response = await apiRequest(url);
      setPackages(response.data || []);
    } catch (err) {
      console.error('Error fetching packages for AR:', err);
    } finally {
      setPackagesLoading(false);
    }
  };

  const fetchMerchandise = async (branchId) => {
    try {
      setMerchandiseLoading(true);
      const url = branchId ? `/merchandise?branch_id=${branchId}&limit=100` : '/merchandise?limit=100';
      const response = await apiRequest(url);
      setMerchandise(response.data || []);
    } catch (err) {
      console.error('Error fetching merchandise for AR:', err);
      setMerchandise([]);
    } finally {
      setMerchandiseLoading(false);
    }
  };

  const fetchBranches = async () => {
    try {
      setBranchesLoading(true);
      const response = await apiRequest('/branches?limit=100');
      setBranches(response.data || []);
    } catch (err) {
      console.error('Error fetching branches for AR:', err);
    } finally {
      setBranchesLoading(false);
    }
  };

  useEffect(() => {
    if (!searchHydratedRef.current) {
      searchHydratedRef.current = true;
      return;
    }
    const timer = setTimeout(() => {
      fetchReceipts(1);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm]);

  useEffect(() => {
    if (!statusHydratedRef.current) {
      statusHydratedRef.current = true;
      return;
    }
    fetchReceipts(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  useEffect(() => {
    if (!paymentMethodHydratedRef.current) {
      paymentMethodHydratedRef.current = true;
      return;
    }
    fetchReceipts(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentMethodFilter]);

  useEffect(() => {
    if (!isAdminOrSuperadmin) return;
    if (!arAdminTabHydratedRef.current) {
      arAdminTabHydratedRef.current = true;
      return;
    }
    fetchReceipts(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arAdminTab, isAdminOrSuperadmin]);

  const fetchReturnedCount = async () => {
    if (!isAdminOrSuperadmin) return;
    try {
      const params = new URLSearchParams({ page: '1', limit: '1', status: 'Returned' });
      if (paymentMethodFilter) params.set('payment_method', paymentMethodFilter);
      if (isSuperadmin && selectedBranchId) params.set('branch_id', selectedBranchId);
      const response = await apiRequest(`/acknowledgement-receipts?${params.toString()}`);
      const raw = response.pagination?.total;
      const total = typeof raw === 'number' ? raw : parseInt(raw, 10) || 0;
      setReturnedArCount(total);
    } catch (err) {
      console.error('fetchReturnedCount:', err);
      setReturnedArCount(0);
    }
  };

  useEffect(() => {
    if (!isAdminOrSuperadmin) return;
    fetchReturnedCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdminOrSuperadmin, selectedBranchId, paymentMethodFilter]);

  useEffect(() => {
    if (!openActionMenuId) return;
    const closeOnOutside = (e) => {
      if (e.target.closest?.('.ar-action-menu-trigger') || e.target.closest?.('.ar-action-menu-portal')) return;
      setOpenActionMenuId(null);
      setActionMenuRect(null);
    };
    document.addEventListener('mousedown', closeOnOutside);
    return () => document.removeEventListener('mousedown', closeOnOutside);
  }, [openActionMenuId]);

  useEffect(() => {
    if (viewReceipt?.ack_receipt_id) {
      setViewModalAttachmentUrl(viewReceipt.payment_attachment_url || '');
    }
  }, [viewReceipt]);

  const resetCreateForm = () => {
    setArType('Package');
    setSelectedPackage(null);
    setMerchandiseSelections([]);
    setCreateFormData({
      prospect_student_name: '',
      prospect_student_contact: '',
      prospect_student_email: '',
      prospect_student_notes: '',
      package_id: '',
      payment_amount: '',
      tip_amount: '',
      payment_method: 'Cash',
      level_tag: '',
      reference_number: '',
      payment_attachment_url: '',
      installment_option: 'downpayment_only',
      issue_date: todayManilaYMD(),
    });
    setCreateFormErrors({});
    setAttachmentUploading(false);
  };

  const openAttachmentViewer = (url) => {
    if (!url) return;
    setViewerUrl(url);
    setViewerOpen(true);
  };

  const closeAttachmentViewer = () => {
    setViewerOpen(false);
    setViewerUrl('');
  };

  const openCreateModal = (preserveArType) => {
    resetCreateForm();
    if (preserveArType) {
      setArType(preserveArType);
    }
    setShowCreateModal(true);
  };

  const handleArTypeChange = (newType) => {
    setArType(newType);
    setSelectedPackage(null);
    setMerchandiseSelections([]);
    setCreateFormData((prev) => ({
      ...prev,
      package_id: '',
      payment_amount: '',
      prospect_student_contact: newType === 'Package' ? prev.prospect_student_contact : '',
    }));
    const branchId = isSuperadmin ? parseInt(selectedBranchId, 10) : userBranchId;
    if (newType === 'Merchandise' && branchId) {
      fetchMerchandise(branchId);
    } else if (newType === 'Package' && branchId) {
      fetchPackages(branchId);
    }
  };

  const uniqueMerchandiseNames = () => {
    const names = [...new Set(merchandise.filter((m) => m.quantity == null || m.quantity > 0).map((m) => m.merchandise_name))];
    return names.sort((a, b) => a.localeCompare(b));
  };

  const merchandiseTotalAmount = () => {
    return merchandiseSelections.reduce((sum, sel) => {
      if (!sel.selectedMerchandiseId) return sum;
      const m = merchandise.find((x) => x.merchandise_id === sel.selectedMerchandiseId);
      const price = m ? (parseFloat(m.price) || 0) : 0;
      return sum + price * (sel.quantity || 1);
    }, 0);
  };

  const isUniformMerchandise = (name) => (name || '').toLowerCase().includes('uniform');

  const addMerchandiseByName = (merchandiseName) => {
    const sizeOptions = merchandise.filter(
      (m) => m.merchandise_name === merchandiseName && (m.quantity == null || m.quantity > 0)
    );
    if (sizeOptions.length === 0) return;
    const autoSelect = sizeOptions.length === 1 ? sizeOptions[0].merchandise_id : null;
    setMerchandiseSelections((prev) => [
      ...prev,
      {
        id: `sel-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        merchandise_name: merchandiseName,
        sizeOptions,
        selectedMerchandiseId: autoSelect,
        quantity: 1,
      },
    ]);
  };

  const removeMerchandiseSelection = (selectionId) => {
    setMerchandiseSelections((prev) => prev.filter((s) => s.id !== selectionId));
  };

  const updateMerchandiseSelectionSize = (selectionId, merchandiseId) => {
    setMerchandiseSelections((prev) =>
      prev.map((s) => (s.id === selectionId ? { ...s, selectedMerchandiseId: merchandiseId ? parseInt(merchandiseId, 10) : null } : s))
    );
  };

  const updateMerchandiseSelectionQuantity = (selectionId, qty) => {
    const num = Math.max(1, parseInt(qty, 10) || 1);
    setMerchandiseSelections((prev) =>
      prev.map((s) => (s.id === selectionId ? { ...s, quantity: num } : s))
    );
  };

  const handleCreateClick = () => {
    if (isSuperadmin) {
      setBranchModalStep(1);
      setShowBranchModal(true);
    } else {
      openCreateModal();
    }
  };

  const closeCreateModal = () => {
    if (creating) return;
    setShowCreateModal(false);
  };

  const handleCreateInputChange = (e) => {
    const { name, value } = e.target;
    setCreateFormData((prev) => ({ ...prev, [name]: value }));
    if (createFormErrors[name]) {
      setCreateFormErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  const handlePackageChange = (e) => {
    const value = e.target.value;
    const pkg = packages.find((p) => String(p.package_id) === value);
    setSelectedPackage(pkg || null);

    let amount = 0;
    if (pkg) {
      const isInstallment = (pkg.package_type || '').toLowerCase() === 'installment' || (pkg.package_type === 'Phase' && (pkg.payment_option || '').toLowerCase() === 'installment');
      const downpayment = pkg.downpayment_amount != null
        ? (typeof pkg.downpayment_amount === 'number' ? pkg.downpayment_amount : parseFloat(pkg.downpayment_amount) || 0)
        : 0;
      if (isInstallment && downpayment > 0) {
        amount = downpayment;
      } else {
        const price = pkg.package_price != null
          ? (typeof pkg.package_price === 'number' ? pkg.package_price : parseFloat(pkg.package_price) || 0)
          : (typeof pkg.price === 'number' ? pkg.price : parseFloat(pkg.price || '0') || 0);
        amount = price;
      }
    }
    const paymentAmount = pkg && amount > 0 ? String(amount) : '';

    const nextLevelTag = pkg && LEVEL_TAG_OPTIONS.includes(pkg.level_tag) ? pkg.level_tag : '';
    setCreateFormData((prev) => ({
      ...prev,
      package_id: value,
      payment_amount: paymentAmount,
      level_tag: nextLevelTag,
      installment_option: 'downpayment_only',
    }));
    setCreateFormErrors((prev) => {
      const next = { ...prev };
      delete next.package_id;
      delete next.payment_amount;
      return next;
    });
  };

  const handleInstallmentOptionChange = (option) => {
    if (!selectedPackage) return;
    const downpayment = parseFloat(selectedPackage.downpayment_amount || 0);
    const monthly = parseFloat(selectedPackage.package_price || 0);
    const amount = option === 'downpayment_plus_phase1'
      ? String(downpayment + monthly)
      : String(downpayment);
    setCreateFormData((prev) => ({
      ...prev,
      installment_option: option,
      payment_amount: amount,
    }));
  };

  const handleAttachmentChange = async (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.type)) {
      appAlert('Please select an image (JPEG, PNG, WebP, or GIF).');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      appAlert('Image must be 5 MB or less.');
      return;
    }
    setAttachmentUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      const token = localStorage.getItem('firebase_token');
      const res = await fetch(`${API_BASE_URL}/upload/invoice-payment-image`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const contentType = res.headers.get('content-type') || '';
      let data = null;
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        if (!res.ok) {
          const msg =
            res.status === 413
              ? 'Image is too large for the server. Please compress the image and try again.'
              : `Upload failed (HTTP ${res.status}).`;
          throw new Error(msg);
        }
        // Unexpected non-JSON success response; fail safely
        throw new Error('Upload failed: unexpected server response.');
      }
      if (!res.ok || !data?.success) throw new Error(data?.message || 'Upload failed');
      setCreateFormData((prev) => ({ ...prev, payment_attachment_url: data.imageUrl || '' }));
    } catch (err) {
      console.error('AR attachment upload error:', err);
      appAlert(err.message || 'Failed to upload image. Please try again.');
    } finally {
      setAttachmentUploading(false);
      e.target.value = '';
    }
  };

  const clearAttachment = () => {
    setCreateFormData((prev) => ({ ...prev, payment_attachment_url: '' }));
  };

  const handleEditAttachmentChange = async (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.type)) {
      appAlert('Please select an image (JPEG, PNG, WebP, or GIF).');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      appAlert('Image must be 5 MB or less.');
      return;
    }
    setEditAttachmentUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      const token = localStorage.getItem('firebase_token');
      const res = await fetch(`${API_BASE_URL}/upload/invoice-payment-image`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const contentType = res.headers.get('content-type') || '';
      let data = null;
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        if (!res.ok) {
          const msg =
            res.status === 413
              ? 'Image is too large for the server. Please compress the image and try again.'
              : `Upload failed (HTTP ${res.status}).`;
          throw new Error(msg);
        }
        throw new Error('Upload failed: unexpected server response.');
      }
      if (!res.ok || !data?.success) throw new Error(data?.message || 'Upload failed');
      setEditFormData((prev) => ({ ...prev, payment_attachment_url: data.imageUrl || '' }));
      setEditFormErrors((prev) => {
        const next = { ...prev };
        delete next.payment_attachment_url;
        return next;
      });
    } catch (err) {
      console.error('AR edit attachment upload error:', err);
      appAlert(err.message || 'Failed to upload image. Please try again.');
    } finally {
      setEditAttachmentUploading(false);
      e.target.value = '';
    }
  };

  const clearEditAttachment = () => {
    setEditFormData((prev) => ({ ...prev, payment_attachment_url: '' }));
  };

  const handleViewModalAttachmentChange = async (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.type)) {
      appAlert('Please select an image (JPEG, PNG, WebP, or GIF).');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      appAlert('Image must be 5 MB or less.');
      return;
    }
    setViewModalAttachmentUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      const token = localStorage.getItem('firebase_token');
      const res = await fetch(`${API_BASE_URL}/upload/invoice-payment-image`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const contentType = res.headers.get('content-type') || '';
      let data = null;
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        if (!res.ok) {
          const msg =
            res.status === 413
              ? 'Image is too large for the server. Please compress the image and try again.'
              : `Upload failed (HTTP ${res.status}).`;
          throw new Error(msg);
        }
        throw new Error('Upload failed: unexpected server response.');
      }
      if (!res.ok || !data?.success) throw new Error(data?.message || 'Upload failed');
      setViewModalAttachmentUrl(data.imageUrl || '');
    } catch (err) {
      console.error('AR view modal attachment upload error:', err);
      appAlert(err.message || 'Failed to upload image. Please try again.');
    } finally {
      setViewModalAttachmentUploading(false);
      e.target.value = '';
    }
  };

  const clearViewModalAttachment = () => setViewModalAttachmentUrl('');

  const canResubmitViewReceipt =
    viewReceipt &&
    viewReceipt.ar_type === 'Package' &&
    viewReceipt.status === 'Returned';

  const handleViewInputChange = (e) => {
    const { name, value } = e.target;
    if (name === 'issue_date') return;
    if (name === 'package_id') {
      const pkg = packages.find((p) => String(p.package_id) === String(value));
      const packagePrice = Number(pkg?.package_price || 0);
      const downpayment = Number(pkg?.downpayment_amount || 0);
      const packageType = String(pkg?.package_type || '').toLowerCase();
      const paymentOption = String(pkg?.payment_option || '').toLowerCase();
      const isInstallmentLike = packageType === 'installment' || (packageType === 'phase' && paymentOption === 'installment');
      const useDownpayment = String(viewReceipt?.installment_option || '').toLowerCase() === 'downpayment_only';
      const nextPayable = isInstallmentLike && useDownpayment && downpayment > 0 ? downpayment : packagePrice;
      setViewPayableAmount(Number.isFinite(nextPayable) ? nextPayable : 0);
    }
    setViewFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleViewModalResubmit = async () => {
    if (!viewReceipt?.ack_receipt_id || !canResubmitViewReceipt) return;
    const attach = (viewModalAttachmentUrl || '').trim();
    if (!attach) {
      appAlert('Please upload an attachment image before resubmitting.');
      return;
    }
    const id = viewReceipt.ack_receipt_id;
    const email = (viewFormData.prospect_student_email || '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      appAlert('Please enter a valid client email before resubmitting.');
      return;
    }
    if (!(viewFormData.prospect_student_name || '').trim()) {
      appAlert('Student name is required.');
      return;
    }
    if (!(viewFormData.package_id || '').trim()) {
      appAlert('Package is required.');
      return;
    }
    if (!AR_PAYMENT_METHOD_OPTIONS.includes(viewFormData.payment_method || '')) {
      appAlert('Invalid payment method on this receipt.');
      return;
    }
    const issueToday = todayManilaYMD();
    const tipNum =
      viewFormData.tip_amount == null || viewFormData.tip_amount === ''
        ? 0
        : Math.max(0, parseFloat(String(viewFormData.tip_amount)));
    let pkgId = viewFormData.package_id ? parseInt(viewFormData.package_id, 10) : NaN;
    if (!Number.isFinite(pkgId)) {
      appAlert('Package is missing on this receipt. Please choose a package, then resubmit.');
      return;
    }

    setViewResubmitSaving(true);
    try {
      const payload = {
        prospect_student_name: (viewFormData.prospect_student_name || '').trim(),
        prospect_student_contact: (viewFormData.prospect_student_contact || '').trim() || null,
        prospect_student_email: email || null,
        prospect_student_notes: (viewFormData.prospect_student_notes || '').trim() || null,
        level_tag: (viewFormData.level_tag || '').trim() || null,
        reference_number: (viewFormData.reference_number || '').trim() || null,
        payment_method: viewFormData.payment_method || 'Cash',
        issue_date: issueToday,
        tip_amount: tipNum,
        payment_attachment_url: attach,
        package_id: pkgId,
      };

      await apiRequest(`/acknowledgement-receipts/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      await apiRequest(`/acknowledgement-receipts/${id}/resubmit`, {
        method: 'PUT',
        body: JSON.stringify({}),
      });
      appAlert('Acknowledgement receipt updated and resubmitted successfully.');
      setViewReceipt(null);
      setViewModalAttachmentUrl('');
      await fetchReceipts(pagination.page || 1);
      if (isAdminOrSuperadmin) await fetchReturnedCount();
    } catch (err) {
      console.error('AR view resubmit error:', err);
      appAlert(err?.message || 'Failed to resubmit acknowledgement receipt.');
    } finally {
      setViewResubmitSaving(false);
    }
  };

  const validateCreateForm = () => {
    const errors = {};
    const name = (createFormData.prospect_student_name || '').trim();
    const isMerch = arType === 'Merchandise';
    const arEmail = (createFormData.prospect_student_email || '').trim();

    if (!name) {
      errors.prospect_student_name = 'Student name is required';
    }
    if (isSuperadmin && !selectedBranchId) {
      errors.branch_id = 'Branch is required';
    }

    if (isMerch) {
      // Issue/payment date is always today (Manila) — no user validation needed
      const configuredCount = merchandiseSelections.filter((s) => s.selectedMerchandiseId).length;
      if (merchandiseSelections.length === 0 || configuredCount === 0) {
        errors.merchandise = 'Select at least one merchandise item and configure size';
      } else if (merchandiseTotalAmount() <= 0) {
        errors.merchandise = 'Total payment must be greater than 0';
      }
      const levelTag = (createFormData.level_tag || '').trim();
      if (!levelTag) {
        errors.level_tag = 'Level tag is required';
      }
    } else {
      const guardianName = (createFormData.prospect_student_contact || '').trim();
      if (!guardianName) {
        errors.prospect_student_contact = 'Guardian name is required';
      }
      if (!createFormData.package_id) {
        errors.package_id = 'Package is required';
      }
      const levelTag = (createFormData.level_tag || '').trim();
      if (!levelTag) {
        errors.level_tag = 'Level tag is required';
      }
      const amount = parseFloat(createFormData.payment_amount || '0');
      if (!amount || amount <= 0) {
        errors.payment_amount = 'Payment amount must be greater than 0';
      }
    }

    if (arEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(arEmail)) {
      errors.prospect_student_email = 'Please enter a valid email address';
    }
    if (createFormData.tip_amount !== '' && Number(createFormData.tip_amount) < 0) {
      errors.tip_amount = 'Tip amount cannot be negative';
    }
    if (!AR_PAYMENT_METHOD_OPTIONS.includes(createFormData.payment_method || '')) {
      errors.payment_method = 'Payment method is required';
    }
    if (!(createFormData.payment_attachment_url || '').trim()) {
      errors.payment_attachment_url = 'Attachment image is required';
    }

    setCreateFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    if (!validateCreateForm()) return;

    setCreating(true);
    try {
      const isMerch = arType === 'Merchandise';
      const branchId = isSuperadmin && selectedBranchId
        ? parseInt(selectedBranchId, 10)
        : !isSuperadmin && userBranchId
        ? userBranchId
        : null;

      let payload;
      if (isMerch) {
        payload = {
          ar_type: 'Merchandise',
          prospect_student_name: (createFormData.prospect_student_name || '').trim(),
          prospect_student_email: (createFormData.prospect_student_email || '').trim() || undefined,
          prospect_student_notes: (createFormData.prospect_student_notes || '').trim(),
          level_tag: (createFormData.level_tag || '').trim() || undefined,
          merchandise_items: merchandiseSelections
            .filter((s) => s.selectedMerchandiseId)
            .map((s) => ({
              merchandise_id: s.selectedMerchandiseId,
              quantity: s.quantity || 1,
            })),
          reference_number: (createFormData.reference_number || '').trim() || undefined,
          payment_attachment_url: createFormData.payment_attachment_url || undefined,
          tip_amount:
            createFormData.tip_amount === '' ? undefined : Math.max(0, parseFloat(createFormData.tip_amount || '0')),
          payment_method: createFormData.payment_method || 'Cash',
          issue_date: todayManilaYMD(),
          branch_id: branchId,
        };
        if (!payload.reference_number) delete payload.reference_number;
        if (!payload.level_tag) delete payload.level_tag;
      } else {
        const isInstallmentPkg =
          !!selectedPackage &&
          (((selectedPackage.package_type || '').toLowerCase() === 'installment') ||
            (selectedPackage.package_type === 'Phase' &&
              (selectedPackage.payment_option || '').toLowerCase() === 'installment'));
        payload = {
          ar_type: 'Package',
          prospect_student_name: (createFormData.prospect_student_name || '').trim(),
          prospect_student_contact: (createFormData.prospect_student_contact || '').trim(),
          prospect_student_email: (createFormData.prospect_student_email || '').trim() || undefined,
          prospect_student_notes: (createFormData.prospect_student_notes || '').trim(),
          package_id: parseInt(createFormData.package_id, 10),
          payment_amount: parseFloat(createFormData.payment_amount),
          tip_amount:
            createFormData.tip_amount === '' ? undefined : Math.max(0, parseFloat(createFormData.tip_amount || '0')),
          payment_method: createFormData.payment_method || 'Cash',
          issue_date: todayManilaYMD(),
          installment_option: isInstallmentPkg ? createFormData.installment_option : undefined,
          level_tag: (createFormData.level_tag || '').trim() || undefined,
          reference_number: (createFormData.reference_number || '').trim() || undefined,
          payment_attachment_url: createFormData.payment_attachment_url || undefined,
          branch_id: branchId,
        };
        if (!payload.prospect_student_notes) delete payload.prospect_student_notes;
        if (!payload.level_tag) delete payload.level_tag;
        if (!payload.reference_number) delete payload.reference_number;
      }

      const result = await apiRequest('/acknowledgement-receipts', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      appAlert(isMerch && result.message
        ? result.message
        : 'Acknowledgement Receipt created successfully.');
      setShowCreateModal(false);
      await fetchReceipts(1);
    } catch (err) {
      console.error('Error creating acknowledgement receipt:', err);
      appAlert(err.message || 'Failed to create acknowledgement receipt. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  const handleVerifyReceipt = async (receipt, approve) => {
    if (!receipt?.ack_receipt_id || verifyLoadingId) return;
    const confirmed = await appConfirm({
      title: approve ? 'Verify Acknowledgement Receipt' : 'Return Acknowledgement Receipt',
      message: approve
        ? 'Are you sure you want to verify this acknowledgement receipt?'
        : 'Are you sure you want to return this acknowledgement receipt to the branch?',
      confirmLabel: approve ? 'Verify' : 'Return',
      cancelLabel: 'Cancel',
      variant: 'info',
      destructive: !approve,
    });
    if (!confirmed) return;

    const promptedRemarks = !approve
      ? await appPrompt({
          title: 'Return Acknowledgement Receipt',
          message: 'Add a note for the AR creator (required).',
          placeholder: 'Reason for return...',
          confirmLabel: 'Return',
          cancelLabel: 'Cancel',
          variant: 'info',
          required: true,
        })
      : '';
    if (!approve && promptedRemarks === null) return;
    const remarks = (promptedRemarks || '').trim();
    setVerifyLoadingId(receipt.ack_receipt_id);
    try {
      await apiRequest(`/acknowledgement-receipts/${receipt.ack_receipt_id}/verify`, {
        method: 'PUT',
        body: JSON.stringify({ approve, remarks: remarks || undefined }),
      });
      appAlert(approve ? 'Acknowledgement receipt verified.' : 'Acknowledgement receipt returned.');
      await fetchReceipts(pagination.page || 1);
    } catch (err) {
      console.error('AR verify/return error:', err);
      appAlert(err?.message || `Failed to ${approve ? 'verify' : 'return'} acknowledgement receipt.`);
    } finally {
      setVerifyLoadingId(null);
    }
  };

  const closeEditModal = () => {
    if (editSaving) return;
    setEditModalOpen(false);
    setEditingReceiptId(null);
    setEditingReceiptMeta(null);
    setEditFormErrors({});
    setIsResubmitFlow(false);
    setFinanceReturnNote('');
    setEditAttachmentUploading(false);
  };

  const openEditModalForReceipt = (receipt, { asResubmit = false } = {}) => {
    if (!receipt?.ack_receipt_id) return;
    setOpenActionMenuId(null);
    setActionMenuRect(null);
    setEditingReceiptId(receipt.ack_receipt_id);
    setEditingReceiptMeta(receipt);
    setIsResubmitFlow(asResubmit);
    setFinanceReturnNote(asResubmit ? extractLatestTagNote(receipt.prospect_student_notes, 'Returned') : '');
    setEditPayableAmount(Number(receipt.payment_amount || 0) || 0);
    if (asResubmit && receipt.branch_id) {
      fetchPackages(receipt.branch_id);
    }
    setEditFormData({
      package_id: receipt.package_id ? String(receipt.package_id) : '',
      prospect_student_name: receipt.prospect_student_name || '',
      prospect_student_contact: receipt.prospect_student_contact || '',
      prospect_student_email: receipt.prospect_student_email || '',
      prospect_student_notes: receipt.prospect_student_notes || '',
      level_tag: receipt.level_tag || '',
      reference_number: receipt.reference_number || '',
      payment_method: receipt.payment_method || 'Cash',
      issue_date: asResubmit
        ? todayManilaYMD()
        : receipt.issue_date
          ? String(receipt.issue_date).slice(0, 10)
          : todayManilaYMD(),
      tip_amount:
        receipt.tip_amount == null || Number(receipt.tip_amount) === 0
          ? ''
          : String(Number(receipt.tip_amount)),
      payment_attachment_url: receipt.payment_attachment_url || '',
    });
    setEditFormErrors({});
    setEditModalOpen(true);
  };

  const openResubmitModalForReceipt = (receipt) => {
    openEditModalForReceipt(receipt, { asResubmit: true });
  };

  const openViewReceiptModal = (receipt) => {
    if (!receipt?.ack_receipt_id) return;
    setOpenActionMenuId(null);
    setActionMenuRect(null);
    if (receipt.ar_type === 'Package' && receipt.branch_id) {
      fetchPackages(receipt.branch_id);
    }
    setViewFormData({
      package_id: receipt.package_id ? String(receipt.package_id) : '',
      prospect_student_name: receipt.prospect_student_name || '',
      prospect_student_contact: receipt.prospect_student_contact || '',
      prospect_student_email: receipt.prospect_student_email || '',
      prospect_student_notes: receipt.prospect_student_notes || '',
      level_tag: receipt.level_tag || '',
      reference_number: receipt.reference_number || '',
      payment_method: receipt.payment_method || 'Cash',
      issue_date: todayManilaYMD(),
      tip_amount:
        receipt.tip_amount == null || Number(receipt.tip_amount) === 0
          ? ''
          : String(Number(receipt.tip_amount)),
    });
    setViewPayableAmount(Number(receipt.payment_amount || 0) || 0);
    setViewReceipt(receipt);
  };

  const closeViewReceiptModal = () => {
    setViewReceipt(null);
    setViewFormData({
      package_id: '',
      prospect_student_name: '',
      prospect_student_contact: '',
      prospect_student_email: '',
      prospect_student_notes: '',
      level_tag: '',
      reference_number: '',
      payment_method: 'Cash',
      issue_date: todayManilaYMD(),
      tip_amount: '',
    });
    setViewPayableAmount(0);
    setViewModalAttachmentUrl('');
    setViewModalAttachmentUploading(false);
    setViewResubmitSaving(false);
  };

  const handleEditInputChange = (e) => {
    const { name, value } = e.target;
    if (isResubmitFlow && name === 'issue_date') return;
    if (name === 'package_id') {
      const pkg = packages.find((p) => String(p.package_id) === String(value));
      const packagePrice = Number(pkg?.package_price || 0);
      const downpayment = Number(pkg?.downpayment_amount || 0);
      const packageType = String(pkg?.package_type || '').toLowerCase();
      const paymentOption = String(pkg?.payment_option || '').toLowerCase();
      const isInstallmentLike = packageType === 'installment' || (packageType === 'phase' && paymentOption === 'installment');
      const useDownpayment = String(editingReceiptMeta?.installment_option || '').toLowerCase() === 'downpayment_only';
      const nextPayable = isInstallmentLike && useDownpayment && downpayment > 0 ? downpayment : packagePrice;
      setEditPayableAmount(Number.isFinite(nextPayable) ? nextPayable : 0);
    }
    setEditFormData((prev) => ({ ...prev, [name]: value }));
    if (editFormErrors[name]) {
      setEditFormErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  const validateEditForm = () => {
    const errors = {};
    if (isResubmitFlow && editingReceiptMeta?.ar_type === 'Package' && !(editFormData.package_id || '').trim()) {
      errors.package_id = 'Package is required';
    }
    if (!(editFormData.prospect_student_name || '').trim()) {
      errors.prospect_student_name = 'Student name is required';
    }
    const email = (editFormData.prospect_student_email || '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.prospect_student_email = 'Please enter a valid email address';
    }
    if (!AR_PAYMENT_METHOD_OPTIONS.includes(editFormData.payment_method || '')) {
      errors.payment_method = 'Payment method is required';
    }
    if (!(editFormData.issue_date || '').trim()) {
      errors.issue_date = 'Issue date is required';
    }
    if (editFormData.tip_amount !== '' && Number(editFormData.tip_amount) < 0) {
      errors.tip_amount = 'Tip amount cannot be negative';
    }
    if (!(editFormData.payment_attachment_url || '').trim()) {
      errors.payment_attachment_url = 'Attachment image is required';
    }
    setEditFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editingReceiptId) return;
    if (!validateEditForm()) return;

    setEditSaving(true);
    try {
      const payload = {
        prospect_student_name: (editFormData.prospect_student_name || '').trim(),
        prospect_student_contact: (editFormData.prospect_student_contact || '').trim() || null,
        prospect_student_email: (editFormData.prospect_student_email || '').trim() || null,
        prospect_student_notes: (editFormData.prospect_student_notes || '').trim() || null,
        level_tag: (editFormData.level_tag || '').trim() || null,
        reference_number: (editFormData.reference_number || '').trim() || null,
        payment_method: editFormData.payment_method || 'Cash',
        issue_date: isResubmitFlow ? todayManilaYMD() : editFormData.issue_date,
        tip_amount: editFormData.tip_amount === '' ? 0 : Math.max(0, parseFloat(editFormData.tip_amount || '0')),
        payment_attachment_url: (editFormData.payment_attachment_url || '').trim() || null,
      };
      if (isResubmitFlow && editingReceiptMeta?.ar_type === 'Package') {
        payload.package_id = parseInt(editFormData.package_id, 10);
      }

      await apiRequest(`/acknowledgement-receipts/${editingReceiptId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });

      if (isResubmitFlow) {
        await apiRequest(`/acknowledgement-receipts/${editingReceiptId}/resubmit`, {
          method: 'PUT',
          body: JSON.stringify({}),
        });
        appAlert('Acknowledgement receipt updated and resubmitted successfully.');
      } else {
        appAlert('Acknowledgement receipt updated successfully.');
      }
      closeEditModal();
      await fetchReceipts(pagination.page || 1);
      if (isAdminOrSuperadmin) await fetchReturnedCount();
    } catch (err) {
      console.error('AR update error:', err);
      appAlert(err?.message || 'Failed to update acknowledgement receipt.');
    } finally {
      setEditSaving(false);
    }
  };

  const handleDeleteReceipt = async (receipt) => {
    if (!receipt?.ack_receipt_id || deleteLoadingId) return;
    const ok = await appConfirm({
      title: 'Delete Acknowledgement Receipt',
      message: `Delete acknowledgement receipt #${receipt.ack_receipt_id}? This cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      destructive: true,
      variant: 'error',
    });
    if (!ok) return;

    setOpenActionMenuId(null);
    setActionMenuRect(null);
    setDeleteLoadingId(receipt.ack_receipt_id);
    try {
      await apiRequest(`/acknowledgement-receipts/${receipt.ack_receipt_id}`, {
        method: 'DELETE',
      });
      appAlert('Acknowledgement receipt deleted successfully.');
      await fetchReceipts(pagination.page || 1);
      if (isAdminOrSuperadmin) await fetchReturnedCount();
    } catch (err) {
      console.error('AR delete error:', err);
      appAlert(err?.message || 'Failed to delete acknowledgement receipt.');
    } finally {
      setDeleteLoadingId(null);
    }
  };

  const uniqueStatuses = () => {
    const set = new Set();
    receipts.forEach((r) => {
      if (r.status) set.add(r.status);
    });
    return Array.from(set);
  };

  const actionMenuReceipt = receipts.find((x) => x.ack_receipt_id === openActionMenuId);
  const canResubmitFromActionMenu =
    actionMenuReceipt &&
    actionMenuReceipt.ar_type === 'Package' &&
    actionMenuReceipt.status === 'Returned' &&
    (arAdminTab === 'return' ||
      (currentUserId != null && Number(actionMenuReceipt.created_by) === Number(currentUserId)));
  const actionMenuWidthPx = 176;

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Acknowledgement Receipts</h1>
          <p className="text-sm text-gray-600 mt-1">
            Record upfront payments quickly and link them to invoices later.
          </p>
        </div>
        <button
          type="button"
          onClick={handleCreateClick}
          className="inline-flex items-center justify-center px-4 py-2 text-sm font-semibold rounded-md shadow-sm text-gray-900 bg-[#F7C844] hover:bg-[#F5B82E] transition-colors"
        >
          Create Acknowledgement Receipt
        </button>
      </div>

      {isAdminOrSuperadmin ? (
        <BranchPaymentLogTabs
          value={arAdminTab}
          onChange={(v) => {
            setArAdminTab(v);
            setStatusFilter('');
          }}
          mainLabel="Acknowledgement receipts"
          returnLabel="Return"
          ariaLabel="Acknowledgement receipt views"
          returnBadgeCount={returnedArCount}
        />
      ) : null}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-5 space-y-4">
        {isAdminOrSuperadmin && arAdminTab === 'return' ? (
          <p className="text-sm text-gray-700 rounded-md border border-orange-100 bg-orange-50/90 px-3 py-2">
            These package ARs were <span className="font-semibold">returned by Finance or Superfinance</span> for
            correction. Use <span className="font-semibold">Resubmit</span> after you fix details.
          </p>
        ) : null}
        <div className="flex flex-col md:flex-row gap-3 md:items-end">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-700 mb-1">Search</label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input-field text-sm"
              placeholder="Search by name, contact, or reference number"
            />
          </div>
          <div className="w-full md:w-48">
            <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
            {isAdminOrSuperadmin && arAdminTab === 'return' ? (
              <div className="input-field text-sm bg-gray-50 text-gray-800">Returned only</div>
            ) : (
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="input-field text-sm"
              >
                <option value="">All</option>
                <option value="Verified,Applied">Verified (Verified + Applied)</option>
                <option value="Submitted,Pending,Paid">Unverified (Submitted + Pending + Paid)</option>
                {uniqueStatuses().map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="w-full md:w-48">
            <label className="block text-xs font-medium text-gray-700 mb-1">Payment Method</label>
            <select
              value={paymentMethodFilter}
              onChange={(e) => setPaymentMethodFilter(e.target.value)}
              className="input-field text-sm"
            >
              <option value="">All</option>
              {AR_PAYMENT_METHOD_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-2">
          {loading ? (
            <p className="text-sm text-gray-600">Loading acknowledgement receipts?</p>
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : (
            <div
              className="overflow-x-auto rounded-lg"
              style={{
                scrollbarWidth: 'thin',
                scrollbarColor: '#cbd5e0 #f7fafc',
                WebkitOverflowScrolling: 'touch',
              }}
            >
              <table
                className="min-w-full divide-y divide-gray-200 text-sm"
                style={{ width: '100%', minWidth: '1340px' }}
              >
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Student Name</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Guardian Name</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Package / Items</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Level Tag</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Total Amount</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Branch</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Status</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Payment Method</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Ref. No.</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Attachment</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Issue Date</th>
                    {(isFinanceOrSuperfinance || isAdminOrSuperadmin) && (
                      <th className="px-4 py-3 text-left font-semibold text-gray-700">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {receipts.length === 0 ? (
                    <tr>
                      <td colSpan={isFinanceOrSuperfinance || isAdminOrSuperadmin ? 12 : 11} className="px-6 py-12 text-center">
                        <p className="text-gray-500">No acknowledgement receipts found.</p>
                      </td>
                    </tr>
                  ) : (
                    receipts.map((r) => (
                    <tr
                      key={r.ack_receipt_id}
                      className={r.status === 'Returned' ? 'bg-red-50/70' : ''}
                    >
                      <td className="px-4 py-3">
                        <div className="text-gray-900 font-medium">
                          {r.prospect_student_name || '-'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-900">
                        {r.prospect_student_contact || <span className="text-gray-300">–</span>}
                      </td>
                      <td className="px-4 py-3">
                        {r.ar_type === 'Merchandise' ? (
                          <div className="text-gray-900 text-xs">
                            {(() => {
                              const items = typeof r.merchandise_items_snapshot === 'string'
                                ? (() => { try { return JSON.parse(r.merchandise_items_snapshot); } catch { return []; } })()
                                : r.merchandise_items_snapshot;
                              return items && Array.isArray(items)
                              ? items.map((i, idx) => (
                                  <span key={idx}>
                                    {i.merchandise_name}
                                    {i.size ? ` (${i.size})` : ''} × {i.quantity || 1}
                                    {idx < items.length - 1 ? ', ' : ''}
                                  </span>
                                ))
                              : 'Merchandise';
                            })()}
                          </div>
                        ) : (
                          <>
                            <div className="text-gray-900">
                              {r.package_name_snapshot || r.package_name || 'N/A'}
                            </div>
                            <div className="text-xs text-gray-500">
                              ₱
                              {Number(r.package_amount_snapshot || 0).toLocaleString('en-US', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </div>
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {r.level_tag || <span className="text-gray-300">?</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-900 font-medium">
                        ₱
                        {(Number(r.payment_amount || 0) + Number(r.tip_amount || 0)).toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td className="px-4 py-3 text-gray-900">
                        {r.branch_name || '-'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                            r.status === 'Verified' || r.status === 'Applied' || r.status === 'Enrolled'
                              ? 'bg-green-100 text-green-800'
                              : r.status === 'Returned'
                              ? 'bg-red-100 text-red-800'
                              : r.status === 'Rejected' || r.status === 'Cancelled'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-yellow-100 text-yellow-800'
                          }`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {r.payment_method || <span className="text-gray-300">?</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-sm">
                        {r.reference_number || <span className="text-gray-300">?</span>}
                      </td>
                      <td className="px-4 py-3">
                        {r.payment_attachment_url ? (
                          <button
                            type="button"
                            onClick={() => openAttachmentViewer(r.payment_attachment_url)}
                            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                              />
                            </svg>
                            <span>View</span>
                          </button>
                        ) : (
                          <span className="text-gray-300">?</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-900">
                        {r.issue_date ? formatDateManila(r.issue_date) : '-'}
                      </td>
                      {(isFinanceOrSuperfinance || isAdminOrSuperadmin) && (
                        <td className="px-4 py-3">
                          {isFinanceOrSuperfinance && r.ar_type === 'Package' && (r.status === 'Submitted' || r.status === 'Paid') ? (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleVerifyReceipt(r, true)}
                                disabled={verifyLoadingId === r.ack_receipt_id}
                                className="px-2 py-1 text-xs font-medium rounded bg-green-100 text-green-800 hover:bg-green-200 disabled:opacity-50"
                              >
                                Verify
                              </button>
                              <button
                                type="button"
                                onClick={() => handleVerifyReceipt(r, false)}
                                disabled={verifyLoadingId === r.ack_receipt_id}
                                className="px-2 py-1 text-xs font-medium rounded bg-red-100 text-red-800 hover:bg-red-200 disabled:opacity-50"
                              >
                                Return
                              </button>
                            </div>
                          ) : isAdminOrSuperadmin ? (
                            <div className="relative inline-block text-left">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const id = r.ack_receipt_id;
                                  if (openActionMenuId === id) {
                                    setOpenActionMenuId(null);
                                    setActionMenuRect(null);
                                  } else {
                                    setOpenActionMenuId(id);
                                    setActionMenuRect(e.currentTarget.getBoundingClientRect());
                                  }
                                }}
                                className="ar-action-menu-trigger inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50"
                                aria-label={`Open actions for acknowledgement receipt ${r.ack_receipt_id}`}
                                aria-expanded={openActionMenuId === r.ack_receipt_id}
                              >
                                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                  <path d="M10 6a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 5.5A1.5 1.5 0 1010 8.5a1.5 1.5 0 000 3zm0 5.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" />
                                </svg>
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">-</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <PaymentAttachmentViewerModal open={viewerOpen} url={viewerUrl} onClose={closeAttachmentViewer} />

        {openActionMenuId && actionMenuRect && actionMenuReceipt && isAdminOrSuperadmin
          ? createPortal(
              (() => {
                const w = typeof window !== 'undefined' ? window.innerWidth : 1200;
                const h = typeof window !== 'undefined' ? window.innerHeight : 800;
                const itemCount =
                  arAdminTab === 'return'
                    ? 1 + (canResubmitFromActionMenu ? 1 : 0)
                    : 2 + (canResubmitFromActionMenu ? 1 : 0);
                const approxH = Math.min(200, itemCount * 40 + 8);
                const pad = 4;
                let top = actionMenuRect.bottom + pad;
                if (top + approxH > h - 8) {
                  top = Math.max(8, actionMenuRect.top - approxH - pad);
                }
                const left = Math.max(8, Math.min(actionMenuRect.right - actionMenuWidthPx, w - actionMenuWidthPx - 8));
                return (
                  <div
                    className="ar-action-menu-portal fixed z-[300] w-44 rounded-md border border-gray-200 bg-white py-1 shadow-lg"
                    style={{ top, left }}
                    role="menu"
                  >
                    {arAdminTab === 'return' ? (
                      <>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => openViewReceiptModal(actionMenuReceipt)}
                          className="block w-full px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-50"
                        >
                          View
                        </button>
                        {canResubmitFromActionMenu ? (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setOpenActionMenuId(null);
                              setActionMenuRect(null);
                              openResubmitModalForReceipt(actionMenuReceipt);
                            }}
                            className="block w-full px-3 py-2 text-left text-xs text-orange-700 hover:bg-orange-50"
                          >
                            Resubmit
                          </button>
                        ) : null}
                      </>
                    ) : (
                      <>
                        {canResubmitFromActionMenu ? (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setOpenActionMenuId(null);
                              setActionMenuRect(null);
                              openResubmitModalForReceipt(actionMenuReceipt);
                            }}
                            className="block w-full px-3 py-2 text-left text-xs text-orange-700 hover:bg-orange-50"
                          >
                            Resubmit
                          </button>
                        ) : null}
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setOpenActionMenuId(null);
                            setActionMenuRect(null);
                            openEditModalForReceipt(actionMenuReceipt);
                          }}
                          className="block w-full px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-50"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setOpenActionMenuId(null);
                            setActionMenuRect(null);
                            handleDeleteReceipt(actionMenuReceipt);
                          }}
                          disabled={deleteLoadingId === actionMenuReceipt.ack_receipt_id}
                          className="block w-full px-3 py-2 text-left text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          {deleteLoadingId === actionMenuReceipt.ack_receipt_id ? 'Deleting...' : 'Delete'}
                        </button>
                      </>
                    )}
                  </div>
                );
              })(),
              document.body
            )
          : null}

        {pagination.total > 0 && (
          <div className="pt-3 border-t border-gray-200 space-y-3">
            <FixedTablePagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              totalItems={pagination.total}
              itemsPerPage={pagination.limit}
              itemLabel="receipts"
              onPageChange={fetchReceipts}
            />
          </div>
        )}
      </div>

      {isSuperadmin &&
        showBranchModal &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center backdrop-blur-sm bg-black/5 p-4"
            onClick={() => { setShowBranchModal(false); setBranchModalStep(1); }}
          >
            <div
              className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 pt-6 pb-4 border-b border-gray-200 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">
                  {branchModalStep === 1 ? 'Select Branch' : 'Select Issue Type'}
                </h2>
                <button
                  type="button"
                  onClick={() => { setShowBranchModal(false); setBranchModalStep(1); }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="px-6 pt-4 pb-6 space-y-4">
                {branchModalStep === 1 ? (
                  <div>
                    <label className="label-field text-xs">
                      Select Branch <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={selectedBranchId}
                      onChange={(e) => setSelectedBranchId(e.target.value)}
                      className="input-field text-sm"
                      disabled={branchesLoading}
                    >
                      <option value="">Choose a branch...</option>
                      {branches.map((b) => (
                        <option key={b.branch_id} value={b.branch_id}>
                          {b.branch_nickname || b.branch_name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="label-field text-xs">
                      Issue Type <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={arType}
                      onChange={(e) => setArType(e.target.value)}
                      className="input-field text-sm"
                    >
                      <option value="Package">Package</option>
                      <option value="Merchandise">Merchandise</option>
                    </select>
                  </div>
                )}
                <div className="flex justify-end gap-3 pt-2 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={() => {
                      if (branchModalStep === 2) {
                        setBranchModalStep(1);
                      } else {
                        setShowBranchModal(false);
                      }
                    }}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                  >
                    {branchModalStep === 2 ? 'Back' : 'Cancel'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (branchModalStep === 1) {
                        if (!selectedBranchId) {
                          appAlert('Please select a branch.');
                          return;
                        }
                        setBranchModalStep(2);
                      } else {
                        const branchId = parseInt(selectedBranchId, 10);
                        fetchPackages(branchId);
                        if (arType === 'Merchandise') {
                          fetchMerchandise(branchId);
                        }
                        setShowBranchModal(false);
                        setBranchModalStep(1);
                        openCreateModal(arType);
                      }
                    }}
                    className="px-4 py-2 text-sm font-medium text-white bg-gray-800 rounded-md hover:bg-gray-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Continue
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {showCreateModal &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center backdrop-blur-sm bg-black/5 p-4"
            onClick={closeCreateModal}
          >
            <div
              className={`bg-white rounded-lg shadow-xl w-full max-h-[90vh] overflow-y-auto ${arType === 'Merchandise' ? 'max-w-4xl' : 'max-w-2xl'}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 pt-6 pb-4 border-b border-gray-200 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">Create Acknowledgement Receipt</h2>
                  <p className="text-xs text-gray-500 mt-1">
                    Record a payment for a package without creating the full student record yet.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeCreateModal}
                  className="text-gray-400 hover:text-gray-600"
                  disabled={creating}
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleCreateSubmit} className="px-6 pb-6 pt-4 space-y-4">
                {isSuperadmin && (
                  <div>
                    <label className="label-field text-xs">
                      Branch <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={selectedBranchId}
                      onChange={(e) => {
                        const value = e.target.value;
                        setSelectedBranchId(value);
                        setCreateFormErrors((prev) => {
                          const next = { ...prev };
                          delete next.branch_id;
                          return next;
                        });
                        setSelectedPackage(null);
                        setMerchandiseSelections([]);
                        setCreateFormData((prev) => ({
                          ...prev,
                          package_id: '',
                          payment_amount: '',
                          installment_option: 'downpayment_only',
                        }));
                        if (value) {
                          const bid = parseInt(value, 10);
                          fetchPackages(bid);
                          if (arType === 'Merchandise') fetchMerchandise(bid);
                        } else {
                          setPackages([]);
                          setMerchandise([]);
                        }
                      }}
                      className={`input-field text-sm ${createFormErrors.branch_id ? 'border-red-500' : ''}`}
                      disabled={branchesLoading}
                    >
                      <option value="">Select branch?</option>
                      {branches.map((b) => (
                        <option key={b.branch_id} value={b.branch_id}>
                          {b.branch_nickname || b.branch_name}
                        </option>
                      ))}
                    </select>
                    {createFormErrors.branch_id && (
                      <p className="text-xs text-red-500 mt-1">{createFormErrors.branch_id}</p>
                    )}
                  </div>
                )}
                {(isSuperadmin || isAdminOrSuperadmin) && (
                  <div>
                    <label className="label-field text-xs">
                      Issue Type <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={arType}
                      onChange={(e) => handleArTypeChange(e.target.value)}
                      className="input-field text-sm"
                    >
                      <option value="Package">Package</option>
                      {isAdminOrSuperadmin && <option value="Merchandise">Merchandise</option>}
                    </select>
                  </div>
                )}
                {arType === 'Merchandise' ? (
                  <>
                    <div>
                      <label className="label-field text-xs">
                        Student Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        name="prospect_student_name"
                        value={createFormData.prospect_student_name}
                        onChange={handleCreateInputChange}
                        className={`input-field text-sm ${createFormErrors.prospect_student_name ? 'border-red-500' : ''}`}
                      />
                      {createFormErrors.prospect_student_name && (
                        <p className="text-xs text-red-500 mt-1">{createFormErrors.prospect_student_name}</p>
                      )}
                    </div>
                    <div>
                      <label className="label-field text-xs">Client Email (for paid confirmation)</label>
                      <input
                        type="email"
                        name="prospect_student_email"
                        value={createFormData.prospect_student_email}
                        onChange={handleCreateInputChange}
                        className={`input-field text-sm ${createFormErrors.prospect_student_email ? 'border-red-500' : ''}`}
                        placeholder="client@example.com"
                      />
                      {createFormErrors.prospect_student_email && (
                        <p className="text-xs text-red-500 mt-1">{createFormErrors.prospect_student_email}</p>
                      )}
                    </div>
                    <div>
                      <label className="label-field text-xs">
                        Select Merchandise <span className="text-red-500">*</span>
                      </label>
                      <select
                        className={`input-field text-sm ${createFormErrors.merchandise ? 'border-red-500' : ''}`}
                        disabled={merchandiseLoading}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val) {
                            addMerchandiseByName(val);
                            e.target.value = '';
                          }
                        }}
                      >
                        <option value="">Add merchandise...</option>
                        {uniqueMerchandiseNames().map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                      {createFormErrors.merchandise && (
                        <p className="text-xs text-red-500 mt-1">{createFormErrors.merchandise}</p>
                      )}
                      {merchandiseSelections.length > 0 && (
                        <ul className="mt-2 space-y-3">
                          {merchandiseSelections.map((sel) => {
                            const selectedItem = sel.selectedMerchandiseId
                              ? merchandise.find((x) => x.merchandise_id === sel.selectedMerchandiseId)
                              : sel.sizeOptions.length === 1
                              ? sel.sizeOptions[0]
                              : null;
                            const price = selectedItem ? parseFloat(selectedItem.price) || 0 : 0;
                            const lineTotal = price * (sel.quantity || 1);
                            const imageUrl = selectedItem?.image_url || sel.sizeOptions.find((o) => o.image_url)?.image_url || sel.sizeOptions[0]?.image_url;
                            return (
                              <li
                                key={sel.id}
                                className="flex flex-row items-center gap-4 p-3 bg-gray-50 rounded-lg border border-gray-200"
                              >
                                <div className="flex items-center gap-3 flex-shrink-0">
                                  {imageUrl && (
                                    <img
                                      src={imageUrl}
                                      alt={sel.merchandise_name}
                                      className="w-12 h-12 object-cover rounded border border-gray-200 bg-white"
                                    />
                                  )}
                                  <div>
                                    <p className="font-medium text-gray-900 text-sm">{sel.merchandise_name}</p>
                                    <p className="text-xs text-gray-500">
                                      {selectedItem
                                        ? [
                                            `₱${price.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
                                            selectedItem.size && selectedItem.size,
                                            selectedItem.gender && selectedItem.gender,
                                            selectedItem.type && selectedItem.type,
                                            !isUniformMerchandise(sel.merchandise_name) && selectedItem.remarks?.trim() && selectedItem.remarks.trim(),
                                          ]
                                            .filter(Boolean)
                                            .join(' • ')
                                        : isUniformMerchandise(sel.merchandise_name)
                                          ? 'Select size'
                                          : 'Select type'}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-3 flex-1 flex-wrap min-w-0">
                                  {sel.sizeOptions.length > 1 ? (
                                    <div className="min-w-[180px]">
                                      <label className="sr-only">{isUniformMerchandise(sel.merchandise_name) ? 'Size' : 'Type'}</label>
                                      <select
                                        value={sel.selectedMerchandiseId || ''}
                                        onChange={(e) => updateMerchandiseSelectionSize(sel.id, e.target.value)}
                                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
                                      >
                                        <option value="">
                                          {isUniformMerchandise(sel.merchandise_name) ? 'Select size' : 'Select type'}
                                        </option>
                                        {sel.sizeOptions.map((opt) => (
                                          <option key={opt.merchandise_id} value={opt.merchandise_id}>
                                            {[
                                              opt.size || (isUniformMerchandise(sel.merchandise_name) ? 'One Size' : 'One Type'),
                                              opt.gender && opt.gender,
                                              opt.type && opt.type,
                                              !isUniformMerchandise(sel.merchandise_name) && opt.remarks?.trim(),
                                              `₱${Number(opt.price || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
                                            ]
                                              .filter(Boolean)
                                              .join(' - ')}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                  ) : (
                                    sel.sizeOptions.length === 1 && (
                                      <span className="text-xs text-gray-500">
                                        {[
                                          sel.sizeOptions[0].size && `Size: ${sel.sizeOptions[0].size}`,
                                          sel.sizeOptions[0].gender && `Gender: ${sel.sizeOptions[0].gender}`,
                                          sel.sizeOptions[0].type && `Type: ${sel.sizeOptions[0].type}`,
                                          !isUniformMerchandise(sel.merchandise_name) && sel.sizeOptions[0].remarks?.trim() && `Remarks: ${sel.sizeOptions[0].remarks.trim()}`,
                                        ]
                                          .filter(Boolean)
                                          .join(' • ') || (isUniformMerchandise(sel.merchandise_name) ? 'One Size' : 'One Type')}
                                      </span>
                                    )
                                  )}
                                  <div>
                                    <label className="sr-only">Quantity</label>
                                    <input
                                      type="number"
                                      min="1"
                                      value={sel.quantity || 1}
                                      onChange={(e) => updateMerchandiseSelectionQuantity(sel.id, e.target.value)}
                                      className="w-16 px-2 py-1.5 text-sm border border-gray-300 rounded"
                                    />
                                  </div>
                                  <span className="text-sm font-medium text-gray-700">
                                    ₱{lineTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => removeMerchandiseSelection(sel.id)}
                                    className="p-1 text-red-600 hover:text-red-700 hover:bg-red-50 rounded"
                                    title="Remove"
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                    <div>
                      <label className="label-field text-xs">
                        Level Tag <span className="text-red-500">*</span>
                      </label>
                      <select
                        name="level_tag"
                        value={createFormData.level_tag}
                        onChange={handleCreateInputChange}
                        className={`input-field text-sm ${createFormErrors.level_tag ? 'border-red-500' : ''}`}
                      >
                        <option value="">Select Level Tag</option>
                        {LEVEL_TAG_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                      {createFormErrors.level_tag && (
                        <p className="text-xs text-red-500 mt-1">{createFormErrors.level_tag}</p>
                      )}
                    </div>
                    <div>
                      <label className="label-field text-xs">
                        Payment Date <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        name="issue_date"
                        readOnly
                        tabIndex={-1}
                        value={todayManilaYMD()}
                        className="input-field text-sm bg-gray-100 cursor-not-allowed"
                        aria-readonly="true"
                      />
                      <p className="mt-1 text-xs text-gray-500">Always set to today (Manila time).</p>
                    </div>
                    <div>
                      <label className="label-field text-xs">Amount</label>
                      <input
                        type="text"
                        readOnly
                        value={`₱${merchandiseTotalAmount().toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                        className="input-field text-sm bg-gray-100 cursor-not-allowed"
                      />
                    </div>
                    <div>
                      <label className="label-field text-xs">Tip / Excess Amount (Optional)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        name="tip_amount"
                        value={createFormData.tip_amount}
                        onChange={handleCreateInputChange}
                        placeholder="0.00"
                        className={`input-field text-sm ${createFormErrors.tip_amount ? 'border-red-500' : ''}`}
                      />
                      {createFormErrors.tip_amount && (
                        <p className="text-xs text-red-500 mt-1">{createFormErrors.tip_amount}</p>
                      )}
                    </div>
                    <div>
                      <label className="label-field text-xs">
                        Payment Method <span className="text-red-500">*</span>
                      </label>
                      <select
                        name="payment_method"
                        value={createFormData.payment_method}
                        onChange={handleCreateInputChange}
                        className={`input-field text-sm ${createFormErrors.payment_method ? 'border-red-500' : ''}`}
                      >
                        {AR_PAYMENT_METHOD_OPTIONS.map((method) => (
                          <option key={method} value={method}>{method}</option>
                        ))}
                      </select>
                      {createFormErrors.payment_method && (
                        <p className="text-xs text-red-500 mt-1">{createFormErrors.payment_method}</p>
                      )}
                    </div>
                    <div>
                      <label className="label-field text-xs">Reference Number <span className="text-red-500">*</span></label>
                      <input
                        type="text"
                        name="reference_number"
                        value={createFormData.reference_number}
                        onChange={handleCreateInputChange}
                        placeholder="e.g. GCash transaction ID, bank ref"
                        className="input-field text-sm"
                        required
                      />
                    </div>
                    <div>
                      <label className="label-field text-xs">Attachment (image) <span className="text-red-600">*</span></label>
                      <p className="text-xs text-gray-500 mb-1">Required: upload receipt/proof (JPEG, PNG, WebP, GIF – max 5 MB)</p>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        onChange={handleAttachmentChange}
                        disabled={attachmentUploading || creating}
                        className="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-3 file:rounded file:border-0 file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
                      />
                      {attachmentUploading && <p className="text-xs text-amber-600 mt-1">Uploading…</p>}
                      {createFormErrors.payment_attachment_url && (
                        <p className="mt-1 text-xs text-red-500">{createFormErrors.payment_attachment_url}</p>
                      )}
                      {createFormData.payment_attachment_url && !attachmentUploading && (
                        <div className="mt-2">
                          <img
                            src={createFormData.payment_attachment_url}
                            alt="Preview"
                            className="max-h-48 w-auto rounded-lg border border-gray-200 object-contain bg-gray-50"
                          />
                          <div className="mt-2 flex gap-2">
                            <button type="button" onClick={() => openAttachmentViewer(createFormData.payment_attachment_url)} className="text-sm text-blue-600 hover:underline">
                              View
                            </button>
                            <button type="button" onClick={clearAttachment} className="text-xs text-red-600 hover:text-red-700">
                              Remove
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="label-field text-xs">
                      Student Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      name="prospect_student_name"
                      value={createFormData.prospect_student_name}
                      onChange={handleCreateInputChange}
                      className={`input-field text-sm ${
                        createFormErrors.prospect_student_name ? 'border-red-500' : ''
                      }`}
                    />
                    {createFormErrors.prospect_student_name && (
                      <p className="text-xs text-red-500 mt-1">{createFormErrors.prospect_student_name}</p>
                    )}
                  </div>
                  <div>
                    <label className="label-field text-xs">
                      Guardian Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      name="prospect_student_contact"
                      value={createFormData.prospect_student_contact}
                      onChange={handleCreateInputChange}
                      className={`input-field text-sm ${
                        createFormErrors.prospect_student_contact ? 'border-red-500' : ''
                      }`}
                    />
                    {createFormErrors.prospect_student_contact && (
                      <p className="text-xs text-red-500 mt-1">{createFormErrors.prospect_student_contact}</p>
                    )}
                  </div>
                </div>

                <div>
                  <label className="label-field text-xs">Client Email (for paid confirmation)</label>
                  <input
                    type="email"
                    name="prospect_student_email"
                    value={createFormData.prospect_student_email}
                    onChange={handleCreateInputChange}
                    className={`input-field text-sm ${createFormErrors.prospect_student_email ? 'border-red-500' : ''}`}
                    placeholder="client@example.com"
                  />
                  {createFormErrors.prospect_student_email && (
                    <p className="text-xs text-red-500 mt-1">{createFormErrors.prospect_student_email}</p>
                  )}
                </div>

                <div>
                  <label className="label-field text-xs">Notes (optional)</label>
                  <textarea
                    name="prospect_student_notes"
                    value={createFormData.prospect_student_notes}
                    onChange={handleCreateInputChange}
                    rows="2"
                    className="input-field text-sm"
                  />
                </div>

                <div>
                  <label className="label-field text-xs">
                    Level Tag <span className="text-red-500">*</span>
                  </label>
                  <select
                    name="level_tag"
                    value={createFormData.level_tag}
                    onChange={handleCreateInputChange}
                    className={`input-field text-sm ${createFormErrors.level_tag ? 'border-red-500' : ''}`}
                  >
                    <option value="">Select Level Tag</option>
                    <option value="Playgroup">Playgroup</option>
                    <option value="Nursery">Nursery</option>
                    <option value="Pre-Kindergarten">Pre-Kindergarten</option>
                    <option value="Kindergarten">Kindergarten</option>
                    <option value="Grade School">Grade School</option>
                  </select>
                  {createFormErrors.level_tag && (
                    <p className="text-xs text-red-500 mt-1">{createFormErrors.level_tag}</p>
                  )}
                  {selectedPackage?.level_tag && (
                    <p className="text-xs text-gray-500 mt-1">
                      Package level: {selectedPackage.level_tag}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="label-field text-xs">
                      Package <span className="text-red-500">*</span>
                    </label>
                    <select
                      name="package_id"
                      value={createFormData.package_id}
                      onChange={handlePackageChange}
                      className={`input-field text-sm ${
                        createFormErrors.package_id ? 'border-red-500' : ''
                      }`}
                      disabled={packagesLoading}
                    >
                      <option value="">Select package?</option>
                      {packages.map((pkg) => (
                        <option key={pkg.package_id} value={pkg.package_id}>
                          {pkg.package_name}
                        </option>
                      ))}
                    </select>
                    {createFormErrors.package_id && (
                      <p className="text-xs text-red-500 mt-1">{createFormErrors.package_id}</p>
                    )}
                  </div>

                  <div>
                    <label className="label-field text-xs">
                      Payment Amount <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      readOnly
                      tabIndex={-1}
                      name="payment_amount"
                      value={
                        createFormData.payment_amount === '' || createFormData.payment_amount == null
                          ? ''
                          : `₱${Number(createFormData.payment_amount).toLocaleString('en-PH', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}`
                      }
                      className={`input-field text-sm bg-gray-100 cursor-not-allowed ${
                        createFormErrors.payment_amount ? 'border-red-500' : ''
                      }`}
                      aria-readonly="true"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Amount is set from the selected package (and installment option if applicable); it cannot be edited.
                    </p>
                    {createFormErrors.payment_amount && (
                      <p className="text-xs text-red-500 mt-1">{createFormErrors.payment_amount}</p>
                    )}
                  </div>
                  <div>
                    <label className="label-field text-xs">Tip / Excess Amount (Optional)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      name="tip_amount"
                      value={createFormData.tip_amount}
                      onChange={handleCreateInputChange}
                      placeholder="0.00"
                      className={`input-field text-sm ${createFormErrors.tip_amount ? 'border-red-500' : ''}`}
                    />
                    {createFormErrors.tip_amount && (
                      <p className="text-xs text-red-500 mt-1">{createFormErrors.tip_amount}</p>
                    )}
                  </div>
                </div>

                {selectedPackage &&
                  ((selectedPackage.package_type || '').toLowerCase() === 'installment' || (selectedPackage.package_type === 'Phase' && (selectedPackage.payment_option || '').toLowerCase() === 'installment')) && (() => {
                    const downpayment = parseFloat(selectedPackage.downpayment_amount || 0);
                    const monthly = parseFloat(selectedPackage.package_price || 0);
                    return (
                      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
                        <p className="text-xs font-semibold text-blue-800 uppercase tracking-wide">
                          Installment Payment Option
                        </p>
                        <div className="space-y-2">
                          <label className="flex items-start gap-3 cursor-pointer group">
                            <input
                              type="radio"
                              name="installment_option"
                              value="downpayment_only"
                              checked={createFormData.installment_option === 'downpayment_only'}
                              onChange={() => handleInstallmentOptionChange('downpayment_only')}
                              className="mt-0.5 accent-blue-600"
                            />
                            <span className="flex-1">
                              <span className="block text-sm font-medium text-gray-800 group-hover:text-blue-700">
                                Downpayment Only
                              </span>
                              <span className="block text-xs text-gray-500 mt-0.5">
                                Amount: ₱{downpayment.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                                &nbsp;&mdash; Phase 1 invoice will be generated separately after enrollment.
                              </span>
                            </span>
                          </label>
                          <label className="flex items-start gap-3 cursor-pointer group">
                            <input
                              type="radio"
                              name="installment_option"
                              value="downpayment_plus_phase1"
                              checked={createFormData.installment_option === 'downpayment_plus_phase1'}
                              onChange={() => handleInstallmentOptionChange('downpayment_plus_phase1')}
                              className="mt-0.5 accent-blue-600"
                            />
                            <span className="flex-1">
                              <span className="block text-sm font-medium text-gray-800 group-hover:text-blue-700">
                                Downpayment + Phase 1
                              </span>
                              <span className="block text-xs text-gray-500 mt-0.5">
                                Amount: ₱{(downpayment + monthly).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                                &nbsp;(₱{downpayment.toLocaleString('en-PH', { minimumFractionDigits: 2 })} downpayment
                                &nbsp;+ ₱{monthly.toLocaleString('en-PH', { minimumFractionDigits: 2 })} Phase 1)
                                &nbsp;&mdash; Phase 2 will be auto-generated.
                              </span>
                            </span>
                          </label>
                        </div>
                      </div>
                    );
                  })()
                }

                {arType === 'Package' && (
                  <div>
                    <label className="label-field text-xs">
                      Payment Method <span className="text-red-500">*</span>
                    </label>
                    <select
                      name="payment_method"
                      value={createFormData.payment_method}
                      onChange={handleCreateInputChange}
                      className={`input-field text-sm ${createFormErrors.payment_method ? 'border-red-500' : ''}`}
                    >
                      {AR_PAYMENT_METHOD_OPTIONS.map((method) => (
                        <option key={method} value={method}>{method}</option>
                      ))}
                    </select>
                    {createFormErrors.payment_method && (
                      <p className="text-xs text-red-500 mt-1">{createFormErrors.payment_method}</p>
                    )}
                    {createFormData.payment_method === 'Cash' && isAdminOrSuperadmin && (
                      <p className="text-xs text-emerald-600 mt-1">
                        Cash AR by Admin/Superadmin is auto-verified and can be used immediately for enrollment.
                      </p>
                    )}
                  </div>
                )}

                {arType === 'Package' && (
                  <div>
                    <label className="label-field text-xs">
                      Issue Date <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      readOnly
                      tabIndex={-1}
                      value={todayManilaYMD()}
                      className="input-field text-sm bg-gray-100 cursor-not-allowed"
                      aria-readonly="true"
                    />
                    <p className="mt-1 text-xs text-gray-500">Always set to today (Manila time).</p>
                  </div>
                )}

                <div>
                  <label className="label-field text-xs">Reference Number <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    name="reference_number"
                    value={createFormData.reference_number}
                    onChange={handleCreateInputChange}
                    placeholder="e.g. GCash transaction ID, bank ref, etc."
                    className="input-field text-sm"
                    required
                    disabled={creating}
                  />
                </div>

                <div>
                  <label className="label-field text-xs">Attachment (image) <span className="text-red-600">*</span></label>
                  <p className="text-xs text-gray-500 mb-1">
                    Required: upload a receipt or proof of payment (JPEG, PNG, WebP, GIF - max 5 MB)
                  </p>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={handleAttachmentChange}
                    disabled={attachmentUploading || creating}
                    className="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-3 file:rounded file:border-0 file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
                  />
                  {attachmentUploading && (
                    <p className="text-xs text-amber-600 mt-1">Uploading?</p>
                  )}
                  {createFormData.payment_attachment_url && !attachmentUploading && (
                    <div className="mt-2">
                      <img
                        src={createFormData.payment_attachment_url}
                        alt="Payment attachment preview"
                        className="max-h-48 w-auto rounded-lg border border-gray-200 object-contain bg-gray-50"
                      />
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => openAttachmentViewer(createFormData.payment_attachment_url)}
                          className="text-sm text-blue-600 hover:underline"
                        >
                          View attached image
                        </button>
                        <button
                          type="button"
                          onClick={clearAttachment}
                          className="text-xs text-red-600 hover:text-red-700"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  )}
                  {createFormErrors.payment_attachment_url && (
                    <p className="mt-1 text-xs text-red-500">{createFormErrors.payment_attachment_url}</p>
                  )}
                </div>

                  </>
                )}

                <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={closeCreateModal}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                    disabled={creating}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={
                      creating ||
                      attachmentUploading ||
                      !(createFormData.payment_attachment_url || '').trim() ||
                      (arType === 'Package' &&
                        (!createFormData.package_id ||
                          !(parseFloat(createFormData.payment_amount) > 0))) ||
                      (arType === 'Merchandise' && merchandiseTotalAmount() <= 0)
                    }
                  >
                    {creating ? 'Saving?' : 'Done'}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {editModalOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 p-4"
            onClick={closeEditModal}
          >
            <div
              className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-lg bg-white shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
                <h3 className="text-base font-semibold text-gray-900">
                  {isResubmitFlow ? 'Review & Resubmit Acknowledgement Receipt' : 'Edit Acknowledgement Receipt'}
                </h3>
                <button
                  type="button"
                  onClick={closeEditModal}
                  className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                  disabled={editSaving}
                >
                  <span className="sr-only">Close</span>
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleEditSubmit} className="space-y-4 px-5 py-4">
                {isResubmitFlow && financeReturnNote ? (
                  <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2">
                    <p className="text-xs font-semibold text-orange-900">Noted from Finance / Superfinance</p>
                    <p className="mt-1 text-sm text-orange-800">{financeReturnNote}</p>
                  </div>
                ) : null}
                <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Receipt details</p>
                  <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-gray-700 sm:grid-cols-2">
                    <p><span className="font-semibold">Type:</span> {editingReceiptMeta?.ar_type || '-'}</p>
                    <p><span className="font-semibold">Status:</span> {editingReceiptMeta?.status || '-'}</p>
                    <p><span className="font-semibold">Package / Items:</span> {editingReceiptMeta?.ar_type === 'Merchandise' ? 'Merchandise' : (editingReceiptMeta?.package_name_snapshot || editingReceiptMeta?.package_name || '-')}</p>
                    <p>
                      <span className="font-semibold">Total Amount:</span>{' '}
                      ₱{(Number(editingReceiptMeta?.payment_amount || 0) + Number(editingReceiptMeta?.tip_amount || 0)).toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                    <p><span className="font-semibold">Branch:</span> {editingReceiptMeta?.branch_name || '-'}</p>
                    <p><span className="font-semibold">Reference No.:</span> {editingReceiptMeta?.reference_number || '-'}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="label-field text-xs">Package</label>
                    {isResubmitFlow && editingReceiptMeta?.ar_type === 'Package' ? (
                      <>
                        <select
                          name="package_id"
                          value={editFormData.package_id}
                          onChange={handleEditInputChange}
                          className={`input-field text-sm ${editFormErrors.package_id ? 'border-red-500' : ''}`}
                          disabled={editSaving}
                        >
                          <option value="">Select package</option>
                          {packages.map((pkg) => (
                            <option key={pkg.package_id} value={pkg.package_id}>
                              {pkg.package_name} - ₱{Number(pkg.package_price || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </option>
                          ))}
                        </select>
                        {editFormErrors.package_id && <p className="mt-1 text-xs text-red-500">{editFormErrors.package_id}</p>}
                      </>
                    ) : (
                      <input
                        type="text"
                        value={editingReceiptMeta?.ar_type === 'Merchandise'
                          ? 'Merchandise'
                          : (editingReceiptMeta?.package_name_snapshot || editingReceiptMeta?.package_name || 'N/A')}
                        className="input-field text-sm bg-gray-100"
                        disabled
                        readOnly
                      />
                    )}
                  </div>

                  <div>
                    <label className="label-field text-xs">Payable Amount</label>
                    <input
                      type="text"
                      value={`₱${Number(editPayableAmount || 0).toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`}
                      className="input-field text-sm bg-gray-100"
                      disabled
                      readOnly
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="label-field text-xs">Student Name <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      name="prospect_student_name"
                      value={editFormData.prospect_student_name}
                      onChange={handleEditInputChange}
                      className={`input-field text-sm ${editFormErrors.prospect_student_name ? 'border-red-500' : ''}`}
                      disabled={editSaving}
                    />
                    {editFormErrors.prospect_student_name && (
                      <p className="mt-1 text-xs text-red-500">{editFormErrors.prospect_student_name}</p>
                    )}
                  </div>

                  <div>
                    <label className="label-field text-xs">Guardian Name</label>
                    <input
                      type="text"
                      name="prospect_student_contact"
                      value={editFormData.prospect_student_contact}
                      onChange={handleEditInputChange}
                      className="input-field text-sm"
                      disabled={editSaving}
                    />
                  </div>

                  <div>
                    <label className="label-field text-xs">Email</label>
                    <input
                      type="email"
                      name="prospect_student_email"
                      value={editFormData.prospect_student_email}
                      onChange={handleEditInputChange}
                      className={`input-field text-sm ${editFormErrors.prospect_student_email ? 'border-red-500' : ''}`}
                      disabled={editSaving}
                    />
                    {editFormErrors.prospect_student_email && (
                      <p className="mt-1 text-xs text-red-500">{editFormErrors.prospect_student_email}</p>
                    )}
                  </div>

                  <div>
                    <label className="label-field text-xs">Level Tag</label>
                    <select
                      name="level_tag"
                      value={editFormData.level_tag}
                      onChange={handleEditInputChange}
                      className="input-field text-sm"
                      disabled={editSaving}
                    >
                      <option value="">Select level tag</option>
                      {LEVEL_TAG_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="label-field text-xs">Issue Date <span className="text-red-500">*</span></label>
                    <input
                      type="date"
                      name="issue_date"
                      value={isResubmitFlow ? todayManilaYMD() : editFormData.issue_date}
                      onChange={handleEditInputChange}
                      readOnly={isResubmitFlow}
                      tabIndex={isResubmitFlow ? -1 : undefined}
                      className={`input-field text-sm ${editFormErrors.issue_date ? 'border-red-500' : ''} ${isResubmitFlow ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                      disabled={editSaving}
                    />
                    {isResubmitFlow ? (
                      <p className="mt-1 text-xs text-gray-500">Always set to today (Manila time) when resubmitting.</p>
                    ) : null}
                    {editFormErrors.issue_date && <p className="mt-1 text-xs text-red-500">{editFormErrors.issue_date}</p>}
                  </div>

                  <div>
                    <label className="label-field text-xs">Payment Method</label>
                    <select
                      name="payment_method"
                      value={editFormData.payment_method}
                      onChange={handleEditInputChange}
                      className={`input-field text-sm ${editFormErrors.payment_method ? 'border-red-500' : ''}`}
                      disabled={editSaving}
                    >
                      {AR_PAYMENT_METHOD_OPTIONS.map((method) => (
                        <option key={method} value={method}>{method}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="label-field text-xs">Tip Amount</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      name="tip_amount"
                      value={editFormData.tip_amount}
                      onChange={handleEditInputChange}
                      className={`input-field text-sm ${editFormErrors.tip_amount ? 'border-red-500' : ''}`}
                      disabled={editSaving}
                    />
                    {editFormErrors.tip_amount && <p className="mt-1 text-xs text-red-500">{editFormErrors.tip_amount}</p>}
                  </div>

                  <div>
                    <label className="label-field text-xs">Reference Number</label>
                    <input
                      type="text"
                      name="reference_number"
                      value={editFormData.reference_number}
                      onChange={handleEditInputChange}
                      className="input-field text-sm"
                      disabled={editSaving}
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="label-field text-xs">Attachment <span className="text-red-600">*</span></label>
                    <p className="text-xs text-gray-500 mb-1">
                      Upload or replace proof of payment (JPEG, PNG, WebP, GIF — max 5 MB)
                    </p>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      onChange={handleEditAttachmentChange}
                      disabled={editSaving || editAttachmentUploading}
                      className="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-3 file:rounded file:border-0 file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
                    />
                    {editAttachmentUploading && (
                      <p className="text-xs text-amber-600 mt-1">Uploading...</p>
                    )}
                    {editFormData.payment_attachment_url ? (
                      <div className="rounded-md border border-gray-200 bg-white p-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="text-xs text-gray-600">Preview of attached file</div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openAttachmentViewer(editFormData.payment_attachment_url)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                            >
                              View full preview
                            </button>
                            <button
                              type="button"
                              onClick={clearEditAttachment}
                              disabled={editSaving || editAttachmentUploading}
                              className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                        <div className="mt-2 overflow-hidden rounded border border-gray-200 bg-gray-50">
                          {/\.((png|jpe?g|webp|gif))(\\?.*)?$/i.test(editFormData.payment_attachment_url) ? (
                            <img
                              src={editFormData.payment_attachment_url}
                              alt="Receipt attachment preview"
                              className="max-h-48 w-full object-contain"
                            />
                          ) : (
                            <div className="p-3 text-xs text-gray-600">
                              Non-image attachment. Click "View full preview" to open.
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-xs text-gray-500">
                        No attachment uploaded. Please upload an image before saving.
                        {editFormErrors.payment_attachment_url && (
                          <div className="mt-2 text-xs text-red-500">{editFormErrors.payment_attachment_url}</div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="sm:col-span-2">
                    <label className="label-field text-xs">Notes</label>
                    <textarea
                      name="prospect_student_notes"
                      value={editFormData.prospect_student_notes}
                      onChange={handleEditInputChange}
                      rows={3}
                      className="input-field text-sm"
                      disabled={editSaving}
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 border-t border-gray-200 pt-4">
                  <button
                    type="button"
                    onClick={closeEditModal}
                    className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    disabled={editSaving}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
                      isResubmitFlow ? 'bg-orange-600 hover:bg-orange-700' : 'bg-blue-600 hover:bg-blue-700'
                    }`}
                    disabled={editSaving}
                  >
                    {editSaving ? 'Saving...' : isResubmitFlow ? 'Save & Resubmit' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {viewReceipt &&
        createPortal(
          <div
            className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/30 p-4"
            onClick={closeViewReceiptModal}
          >
            <div
              className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-lg bg-white shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
                <h3 className="text-base font-semibold text-gray-900">View acknowledgement receipt</h3>
                <button
                  type="button"
                  onClick={closeViewReceiptModal}
                  className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                >
                  <span className="sr-only">Close</span>
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4 px-5 py-4">
                {extractLatestTagNote(viewReceipt.prospect_student_notes, 'Returned') ? (
                  <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2">
                    <p className="text-xs font-semibold text-orange-900">Noted from Finance / Superfinance</p>
                    <p className="mt-1 text-sm text-orange-800">
                      {extractLatestTagNote(viewReceipt.prospect_student_notes, 'Returned')}
                    </p>
                  </div>
                ) : null}

                <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                  <span className="font-semibold">Status:</span>{' '}
                  <span className="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 font-medium text-orange-800">
                    {viewReceipt.status || '—'}
                  </span>
                  <span className="mx-2 text-gray-300">|</span>
                  <span className="font-semibold">Branch:</span> {viewReceipt.branch_name || '—'}
                </div>

                {viewReceipt.ar_type === 'Merchandise' ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label-field text-xs">Type</label>
                        <input type="text" readOnly className="input-field text-sm bg-gray-100 cursor-not-allowed" value="Merchandise" />
                      </div>
                      <div>
                        <label className="label-field text-xs">Total</label>
                        <input
                          type="text"
                          readOnly
                          className="input-field text-sm bg-gray-100 cursor-not-allowed"
                          value={`₱${(
                            Number(viewReceipt.payment_amount || 0) + Number(viewReceipt.tip_amount || 0)
                          ).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label-field text-xs">Student Name</label>
                        <input
                          type="text"
                          readOnly
                          className="input-field text-sm bg-gray-100 cursor-not-allowed"
                          value={viewReceipt.prospect_student_name || ''}
                        />
                      </div>
                      <div>
                        <label className="label-field text-xs">Guardian Name</label>
                        <input
                          type="text"
                          readOnly
                          className="input-field text-sm bg-gray-100 cursor-not-allowed"
                          value={viewReceipt.prospect_student_contact || ''}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="label-field text-xs">Client Email (for paid confirmation)</label>
                      <input
                        type="email"
                        readOnly
                        className="input-field text-sm bg-gray-100 cursor-not-allowed"
                        value={viewReceipt.prospect_student_email || ''}
                      />
                    </div>
                    <div>
                      <label className="label-field text-xs">Notes</label>
                      <textarea
                        readOnly
                        rows={3}
                        className="input-field text-sm bg-gray-100 cursor-not-allowed"
                        value={viewReceipt.prospect_student_notes || ''}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label-field text-xs">Student Name</label>
                        <input
                          type="text"
                          name="prospect_student_name"
                          className="input-field text-sm"
                          value={viewFormData.prospect_student_name}
                          onChange={handleViewInputChange}
                          disabled={viewResubmitSaving}
                        />
                      </div>
                      <div>
                        <label className="label-field text-xs">Guardian Name</label>
                        <input
                          type="text"
                          name="prospect_student_contact"
                          className="input-field text-sm"
                          value={viewFormData.prospect_student_contact}
                          onChange={handleViewInputChange}
                          disabled={viewResubmitSaving}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="label-field text-xs">Client Email (for paid confirmation)</label>
                      <input
                        type="email"
                        name="prospect_student_email"
                        className="input-field text-sm"
                        value={viewFormData.prospect_student_email}
                        onChange={handleViewInputChange}
                        disabled={viewResubmitSaving}
                      />
                    </div>
                    <div>
                      <label className="label-field text-xs">Notes</label>
                      <textarea
                        name="prospect_student_notes"
                        rows={2}
                        className="input-field text-sm"
                        value={viewFormData.prospect_student_notes}
                        onChange={handleViewInputChange}
                        disabled={viewResubmitSaving}
                      />
                    </div>
                    <div>
                      <label className="label-field text-xs">Level Tag</label>
                      <select
                        name="level_tag"
                        value={viewFormData.level_tag}
                        onChange={handleViewInputChange}
                        disabled={viewResubmitSaving}
                        className="input-field text-sm"
                      >
                        <option value="">—</option>
                        {LEVEL_TAG_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label-field text-xs">Package</label>
                        <select
                          name="package_id"
                          value={viewFormData.package_id}
                          onChange={handleViewInputChange}
                          className="input-field text-sm"
                          disabled={viewResubmitSaving || packagesLoading}
                        >
                          <option value="">{packagesLoading ? 'Loading packages...' : 'Select package'}</option>
                          {viewFormData.package_id && !packages.some((pkg) => String(pkg.package_id) === String(viewFormData.package_id)) ? (
                            <option value={viewFormData.package_id}>
                              {viewReceipt.package_name_snapshot || viewReceipt.package_name || 'Current package'}
                            </option>
                          ) : null}
                          {packages.map((pkg) => (
                            <option key={pkg.package_id} value={pkg.package_id}>
                              {pkg.package_name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="label-field text-xs">Payment amount</label>
                        <input
                          type="text"
                          readOnly
                          className="input-field text-sm bg-gray-100 cursor-not-allowed"
                          value={
                            viewPayableAmount == null
                              ? ''
                              : `₱${Number(viewPayableAmount).toLocaleString('en-PH', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}`
                          }
                        />
                        <p className="mt-1 text-xs text-gray-500">Set from the package; not editable here.</p>
                      </div>
                    </div>
                    {String(viewReceipt.installment_option || '').toLowerCase() === 'downpayment_only' ? (
                      <p className="text-xs text-gray-600">
                        <span className="font-semibold">Installment:</span> Down payment only
                      </p>
                    ) : null}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label-field text-xs">Tip / Excess Amount</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          name="tip_amount"
                          className="input-field text-sm"
                          value={viewFormData.tip_amount}
                          onChange={handleViewInputChange}
                          disabled={viewResubmitSaving}
                        />
                      </div>
                      <div>
                        <label className="label-field text-xs">Issue Date</label>
                        <input
                          type="date"
                          name="issue_date"
                          readOnly
                          tabIndex={-1}
                          className="input-field text-sm bg-gray-100 cursor-not-allowed"
                          value={todayManilaYMD()}
                          aria-readonly="true"
                          disabled={viewResubmitSaving}
                        />
                        <p className="mt-1 text-xs text-gray-500">Always set to today (Manila time).</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="label-field text-xs">Payment Method</label>
                        <select
                          name="payment_method"
                          value={viewFormData.payment_method}
                          onChange={handleViewInputChange}
                          disabled={viewResubmitSaving}
                          className="input-field text-sm"
                        >
                          {AR_PAYMENT_METHOD_OPTIONS.map((method) => (
                            <option key={method} value={method}>
                              {method}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="label-field text-xs">Reference Number</label>
                        <input
                          type="text"
                          name="reference_number"
                          className="input-field text-sm"
                          value={viewFormData.reference_number}
                          onChange={handleViewInputChange}
                          disabled={viewResubmitSaving}
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div className="sm:col-span-2">
                  <label className="label-field text-xs">
                    Attachment (image) <span className="text-red-600">*</span>
                  </label>
                  <p className="mb-1 text-xs text-gray-500">
                    Upload or replace proof of payment before resubmitting (JPEG, PNG, WebP, GIF — max 5 MB).
                  </p>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={handleViewModalAttachmentChange}
                    disabled={viewResubmitSaving || viewModalAttachmentUploading}
                    className="block w-full text-sm text-gray-600 file:mr-3 file:rounded file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-gray-700 hover:file:bg-gray-200"
                  />
                  {viewModalAttachmentUploading ? (
                    <p className="mt-1 text-xs text-amber-600">Uploading…</p>
                  ) : null}
                  {viewModalAttachmentUrl ? (
                    <div className="mt-3 rounded-md border border-gray-200 bg-white p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openAttachmentViewer(viewModalAttachmentUrl)}
                          className="text-sm font-medium text-blue-600 hover:underline"
                        >
                          View attachment
                        </button>
                        <button
                          type="button"
                          onClick={clearViewModalAttachment}
                          disabled={viewResubmitSaving || viewModalAttachmentUploading}
                          className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </div>
                      <div className="mt-2 overflow-hidden rounded border border-gray-200 bg-gray-50">
                        {/\.((png|jpe?g|webp|gif))(\?.*)?$/i.test(viewModalAttachmentUrl) ? (
                          <img
                            src={viewModalAttachmentUrl}
                            alt="Receipt attachment preview"
                            className="max-h-48 w-full object-contain"
                          />
                        ) : (
                          <div className="p-3 text-xs text-gray-600">
                            Non-image file. Use View attachment to open.
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 rounded-md border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-xs text-gray-500">
                      No attachment yet. Upload an image to resubmit.
                    </div>
                  )}
                </div>
              </div>

              <div className="flex border-t border-gray-200 px-5 py-4 sm:justify-end">
                <button
                  type="button"
                  onClick={handleViewModalResubmit}
                  disabled={!canResubmitViewReceipt || viewResubmitSaving || viewModalAttachmentUploading || !viewModalAttachmentUrl?.trim()}
                  className="w-full rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50 sm:w-auto"
                >
                  {viewResubmitSaving ? 'Resubmitting…' : 'Resubmit'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default AcknowledgementReceiptsPage;

