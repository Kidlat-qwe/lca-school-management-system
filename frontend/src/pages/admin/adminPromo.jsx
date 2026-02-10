import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';

const PROMO_TYPES = [
  { value: 'percentage_discount', label: 'Percentage Discount' },
  { value: 'fixed_discount', label: 'Fixed Amount Discount' },
  { value: 'free_merchandise', label: 'Free Merchandise' },
  { value: 'combined', label: 'Combined (Discount + Merchandise)' },
];

const ELIGIBILITY_TYPES = [
  { value: 'all', label: 'All Students' },
  { value: 'new_students_only', label: 'New Students Only' },
  { value: 'existing_students_only', label: 'Existing Students Only' },
  { value: 'referral_only', label: 'Referral Only' },
];

const MERCHANDISE_TYPES = [
  'LCA Uniform',
  'LCA Learning Kit',
  'LCA Bag',
  'LCA Keychain',
  'LCA Totebag',
];

const AdminPromo = () => {
  const { userInfo } = useAuth();
  // Get admin's branch_id from userInfo
  const adminBranchId = userInfo?.branch_id || userInfo?.branchId;
  const [selectedBranchName, setSelectedBranchName] = useState(userInfo?.branch_name || 'Your Branch');
  const [promos, setPromos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nameSearchTerm, setNameSearchTerm] = useState('');
  // Removed filterBranch - admin only sees their branch
  const [filterPackage, setFilterPackage] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [openMenuId, setOpenMenuId] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  // Removed openBranchDropdown - admin only sees their branch
  const [openPackageDropdown, setOpenPackageDropdown] = useState(false);
  const [openStatusDropdown, setOpenStatusDropdown] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPromo, setEditingPromo] = useState(null);
  // Removed branches state - admin only sees their branch
  const [packages, setPackages] = useState([]);
  const [merchandise, setMerchandise] = useState([]);
  const [formData, setFormData] = useState({
    promo_name: '',
    package_ids: [], // Array of package IDs (changed from single package_id)
    branch_id: '',
    promo_type: 'percentage_discount',
    promo_code: '', // Optional promo code
    discount_percentage: '',
    discount_amount: '',
    min_payment_amount: '',
    start_date: '',
    end_date: '',
    max_uses: '',
    eligibility_type: 'all',
    status: 'Active',
    description: '',
    selectedMerchandise: [], // Array of {merchandise_id, quantity}
    installment_apply_scope: 'downpayment', // For Installment packages: downpayment, monthly, or both
    installment_months_to_apply: '', // Number of months to apply promo for monthly scope
  });
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedPromoForDetails, setSelectedPromoForDetails] = useState(null);
  const [newMerchandise, setNewMerchandise] = useState({
    merchandise_id: '',
    quantity: 1,
  });
  const [combinedDiscountType, setCombinedDiscountType] = useState('percentage'); // 'percentage' or 'fixed' for combined promos

  // Fetch branch name if not in userInfo
  useEffect(() => {
    const fetchBranchName = async () => {
      if (!userInfo?.branch_name && adminBranchId) {
        try {
          const response = await apiRequest(`/branches/${adminBranchId}`);
          if (response && response.data && response.data.branch_name) {
            setSelectedBranchName(response.data.branch_name);
          }
        } catch (err) {
          console.error('Error fetching branch name:', err);
        }
      } else if (userInfo?.branch_name) {
        setSelectedBranchName(userInfo.branch_name);
      }
    };

    fetchBranchName();
  }, [userInfo, adminBranchId]);

  useEffect(() => {
    fetchPromos();
    // Don't fetch branches for admin - they only see their branch
    fetchPackages();
    fetchMerchandise();
  }, []);

  // Auto-set branch_id from adminBranchId when available
  useEffect(() => {
    if (adminBranchId && isModalOpen && !editingPromo) {
      setFormData(prev => ({
        ...prev,
        branch_id: adminBranchId.toString(),
      }));
    }
  }, [adminBranchId, isModalOpen, editingPromo]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (openMenuId && !event.target.closest('.action-menu-container') && !event.target.closest('.action-menu-overlay')) {
        setOpenMenuId(null);
      }
      // Removed branch dropdown - admin only sees their branch
      if (openPackageDropdown && !event.target.closest('.package-filter-dropdown')) {
        setOpenPackageDropdown(false);
      }
      if (openStatusDropdown && !event.target.closest('.status-filter-dropdown')) {
        setOpenStatusDropdown(false);
      }
    };

    if (openMenuId || openPackageDropdown || openStatusDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [openMenuId, openPackageDropdown, openStatusDropdown]);

  const handleMenuClick = (promoId, event) => {
    event.stopPropagation();
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    
    if (openMenuId === promoId) {
      setOpenMenuId(null);
      setMenuPosition({ top: undefined, bottom: undefined, right: undefined, left: undefined });
    } else {
      // Calculate available space
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;
      const estimatedDropdownHeight = 150; // Approximate height for 3 menu items
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
      setOpenMenuId(promoId);
    }
  };

  const fetchPromos = async () => {
    try {
      setLoading(true);
      // Filter by admin's branch
      const response = await apiRequest(`/promos?branch_id=${adminBranchId}&limit=100`);
      setPromos(response.data || []);
    } catch (err) {
      setError(err.message || 'Failed to fetch promos');
      console.error('Error fetching promos:', err);
    } finally {
      setLoading(false);
    }
  };

  // Removed fetchBranches - admin only sees their branch

  const fetchPackages = async () => {
    try {
      // Filter by admin's branch
      const response = await apiRequest(`/packages?branch_id=${adminBranchId}&limit=100`);
      setPackages(response.data || []);
    } catch (err) {
      console.error('Error fetching packages:', err);
    }
  };

  const fetchMerchandise = async () => {
    try {
      // Filter by admin's branch
      const response = await apiRequest(`/merchandise?branch_id=${adminBranchId}&limit=100`);
      setMerchandise(response.data || []);
    } catch (err) {
      console.error('Error fetching merchandise:', err);
    }
  };

  const handleDelete = async (promoId) => {
    setOpenMenuId(null);
    
    // Verify promo belongs to admin's branch
    const promo = promos.find(p => p.promo_id === promoId);
    if (promo && promo.branch_id !== adminBranchId) {
      alert('You can only delete promos from your branch.');
      return;
    }
    
    if (!window.confirm('Are you sure you want to delete this promo? This will also delete all promo merchandise and usage records.')) {
      return;
    }

    try {
      await apiRequest(`/promos/${promoId}`, {
        method: 'DELETE',
      });
      fetchPromos();
    } catch (err) {
      alert(err.message || 'Failed to delete promo');
    }
  };

  const openCreateModal = () => {
    setEditingPromo(null);
    setError('');
    setFormData({
      promo_name: '',
      package_ids: [],
      branch_id: adminBranchId ? adminBranchId.toString() : '',
      promo_type: 'percentage_discount',
      discount_percentage: '',
      discount_amount: '',
      min_payment_amount: '',
      start_date: '',
      end_date: '',
      max_uses: '',
      eligibility_type: 'all',
      status: 'Active',
      description: '',
      selectedMerchandise: [],
      installment_apply_scope: 'downpayment',
      installment_months_to_apply: '',
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const formatDateForInput = (dateValue) => {
    if (!dateValue) return '';
    if (typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateValue)) {
      return dateValue.split('T')[0];
    }
    try {
      const date = new Date(dateValue);
      if (isNaN(date.getTime())) return '';
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    } catch (e) {
      return '';
    }
  };

  const openEditModal = (promoItem) => {
    setOpenMenuId(null);
    
    // Verify promo belongs to admin's branch
    if (promoItem.branch_id !== adminBranchId) {
      alert('You can only edit promos from your branch.');
      return;
    }
    
    setEditingPromo(promoItem);
    setError('');
    
    // Fetch full promo details with merchandise
    fetchPromoDetails(promoItem.promo_id).then((fullPromo) => {
      // Determine which discount type to show for combined promos
      if (fullPromo.promo_type === 'combined') {
        if (fullPromo.discount_percentage && parseFloat(fullPromo.discount_percentage) > 0) {
          setCombinedDiscountType('percentage');
        } else if (fullPromo.discount_amount && parseFloat(fullPromo.discount_amount) > 0) {
          setCombinedDiscountType('fixed');
        } else {
          setCombinedDiscountType('percentage'); // Default
        }
      }
      
      // Extract package_ids from packages array or fall back to package_id for backward compatibility
      const packageIds = fullPromo.packages && fullPromo.packages.length > 0
        ? fullPromo.packages.map(p => p.package_id)
        : fullPromo.package_ids && fullPromo.package_ids.length > 0
        ? fullPromo.package_ids
        : fullPromo.package_id
        ? [fullPromo.package_id]
        : [];
      
      setFormData({
        promo_name: fullPromo.promo_name || '',
        package_ids: packageIds.map(id => id.toString()),
        branch_id: fullPromo.branch_id?.toString() || '',
        promo_type: fullPromo.promo_type || 'percentage_discount',
        promo_code: fullPromo.promo_code || '',
        discount_percentage: fullPromo.discount_percentage?.toString() || '',
        discount_amount: fullPromo.discount_amount?.toString() || '',
        min_payment_amount: fullPromo.min_payment_amount?.toString() || '',
        start_date: formatDateForInput(fullPromo.start_date),
        end_date: formatDateForInput(fullPromo.end_date),
        max_uses: fullPromo.max_uses?.toString() || '',
        eligibility_type: fullPromo.eligibility_type || 'all',
        status: fullPromo.status || 'Active',
        description: fullPromo.description || '',
        selectedMerchandise: (fullPromo.merchandise || []).map(m => ({
          merchandise_id: m.merchandise_id,
          quantity: m.quantity || 1,
        })),
        installment_apply_scope: fullPromo.installment_apply_scope || 'downpayment',
        installment_months_to_apply: fullPromo.installment_months_to_apply?.toString() || '',
      });
      setFormErrors({});
      setIsModalOpen(true);
    });
  };

  const fetchPromoDetails = async (promoId) => {
    try {
      const response = await apiRequest(`/promos/${promoId}`);
      return response.data;
    } catch (err) {
      console.error('Error fetching promo details:', err);
      return null;
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingPromo(null);
    setFormErrors({});
    setCombinedDiscountType('percentage');
    setFormData({
      promo_name: '',
      package_ids: [],
      branch_id: '',
      promo_type: 'percentage_discount',
      discount_percentage: '',
      discount_amount: '',
      min_payment_amount: '',
      start_date: '',
      end_date: '',
      max_uses: '',
      eligibility_type: 'all',
      status: 'Active',
      description: '',
      selectedMerchandise: [],
    });
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    
    // Reset combined discount type when promo type changes
    if (name === 'promo_type') {
      if (value === 'combined') {
        // Keep current selection or default to percentage
        if (!combinedDiscountType) {
          setCombinedDiscountType('percentage');
        }
      } else {
        setCombinedDiscountType('percentage');
      }
    }
    
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

  const getMerchandiseItemsByType = (typeName) =>
    merchandise.filter((item) => item.merchandise_name === typeName);

  const handleAddMerchandise = () => {
    if (!newMerchandise.merchandise_id) {
      alert('Please select merchandise');
      return;
    }

    const merchItem = merchandise.find(m => m.merchandise_id === parseInt(newMerchandise.merchandise_id));
    if (!merchItem) {
      alert('Merchandise not found');
      return;
    }

    // Check if already added
    if (formData.selectedMerchandise.some(m => m.merchandise_id === parseInt(newMerchandise.merchandise_id))) {
      alert('This merchandise is already added');
      return;
    }

    setFormData((prev) => ({
      ...prev,
      selectedMerchandise: [
        ...prev.selectedMerchandise,
        {
          merchandise_id: parseInt(newMerchandise.merchandise_id),
          quantity: parseInt(newMerchandise.quantity) || 1,
        },
      ],
    }));

    setNewMerchandise({
      merchandise_id: '',
      quantity: 1,
    });
  };

  const handleRemoveMerchandise = (merchandiseId) => {
    setFormData((prev) => ({
      ...prev,
      selectedMerchandise: prev.selectedMerchandise.filter(m => m.merchandise_id !== merchandiseId),
    }));
  };

  const validateForm = () => {
    const errors = {};
    
    if (!formData.promo_name.trim()) {
      errors.promo_name = 'Promo name is required';
    }

    // Promo code is now required
    if (!formData.promo_code || !formData.promo_code.trim()) {
      errors.promo_code = 'Promo code is required';
    } else {
      const code = formData.promo_code.trim();
      if (code.length < 4 || code.length > 20) {
        errors.promo_code = 'Promo code must be 4-20 characters';
      } else if (!/^[A-Z0-9-]+$/.test(code)) {
        errors.promo_code = 'Promo code must contain only uppercase letters, numbers, and hyphens';
      }
    }

    // At least one package is required for admin (they always have a specific branch)
    if (!formData.package_ids || formData.package_ids.length === 0) {
      errors.package_ids = 'Please select at least one package.';
    }

    if (!formData.start_date) {
      errors.start_date = 'Start date is required';
    }

    if (!formData.end_date) {
      errors.end_date = 'End date is required';
    }

    if (formData.start_date && formData.end_date) {
      if (new Date(formData.start_date) > new Date(formData.end_date)) {
        errors.end_date = 'End date must be after or equal to start date';
      }
    }

    // Validate promo type requirements
    if (formData.promo_type === 'percentage_discount') {
      if (!formData.discount_percentage || parseFloat(formData.discount_percentage) <= 0 || parseFloat(formData.discount_percentage) > 100) {
        errors.discount_percentage = 'Discount percentage must be between 0 and 100';
      }
    }

    if (formData.promo_type === 'fixed_discount') {
      if (!formData.discount_amount || parseFloat(formData.discount_amount) <= 0) {
        errors.discount_amount = 'Discount amount must be greater than 0';
      }
    }

    if (formData.promo_type === 'free_merchandise') {
      if (!formData.selectedMerchandise || formData.selectedMerchandise.length === 0) {
        errors.merchandise = 'At least one merchandise item is required for free merchandise promo';
      }
    }

    if (formData.promo_type === 'combined') {
      const hasDiscount = (formData.discount_percentage && parseFloat(formData.discount_percentage) > 0) ||
                         (formData.discount_amount && parseFloat(formData.discount_amount) > 0);
      const hasMerchandise = formData.selectedMerchandise && formData.selectedMerchandise.length > 0;
      
      if (!hasDiscount && !hasMerchandise) {
        errors.promo_type = 'Combined promo requires at least a discount or merchandise';
      }
    }

    // Validate installment scope fields if any selected package is Installment
    const hasInstallmentPackage = formData.package_ids.some((id) => {
      const p = packages.find((pkg) => pkg.package_id.toString() === id);
      return p && p.package_type === 'Installment';
    });
    
    if (hasInstallmentPackage) {
      if (!formData.installment_apply_scope) {
        errors.installment_apply_scope = 'Please select where to apply the promo for Installment packages';
      }
      
      if ((formData.installment_apply_scope === 'monthly' || formData.installment_apply_scope === 'both') && 
          (!formData.installment_months_to_apply || parseInt(formData.installment_months_to_apply) < 1)) {
        errors.installment_months_to_apply = 'Number of months to apply must be at least 1 when scope includes monthly';
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
      const payload = {
        promo_name: formData.promo_name.trim(),
        package_ids: formData.package_ids.map(id => parseInt(id)), // Send array of package IDs
        branch_id: adminBranchId || (formData.branch_id && formData.branch_id !== '' ? parseInt(formData.branch_id) : null),
        promo_type: formData.promo_type,
        promo_code: formData.promo_code?.trim() || null, // Send promo code (null if empty)
        discount_percentage: formData.promo_type === 'percentage_discount' || formData.promo_type === 'combined' 
          ? (formData.discount_percentage ? parseFloat(formData.discount_percentage) : null) 
          : null,
        discount_amount: formData.promo_type === 'fixed_discount' || formData.promo_type === 'combined'
          ? (formData.discount_amount ? parseFloat(formData.discount_amount) : null)
          : null,
        min_payment_amount: formData.min_payment_amount ? parseFloat(formData.min_payment_amount) : null,
        start_date: formData.start_date,
        end_date: formData.end_date,
        max_uses: formData.max_uses ? parseInt(formData.max_uses) : null,
        eligibility_type: formData.eligibility_type,
        status: formData.status,
        description: formData.description?.trim() || null,
        merchandise: formData.selectedMerchandise,
        installment_apply_scope: formData.package_ids.some((id) => {
          const p = packages.find((pkg) => pkg.package_id.toString() === id);
          return p && p.package_type === 'Installment';
        }) ? formData.installment_apply_scope : null,
        installment_months_to_apply: (formData.installment_apply_scope === 'monthly' || formData.installment_apply_scope === 'both') && formData.installment_months_to_apply
          ? parseInt(formData.installment_months_to_apply)
          : null,
      };

      if (editingPromo) {
        await apiRequest(`/promos/${editingPromo.promo_id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await apiRequest('/promos', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      
      closeModal();
      fetchPromos();
    } catch (err) {
      console.error('Error saving promo:', err);
      console.error('Error response:', err.response?.data);
      
      let errorMessage = `Failed to ${editingPromo ? 'update' : 'create'} promo`;
      
      if (err.response?.data?.errors && Array.isArray(err.response.data.errors)) {
        // Show detailed validation errors
        const errorMessages = err.response.data.errors.map(e => {
          const field = e.param || e.path || 'field';
          return `${field}: ${e.msg}`;
        });
        errorMessage = errorMessages.join('; ');
      } else if (err.response?.data?.message) {
        errorMessage = err.response.data.message;
      } else if (err.message) {
        errorMessage = err.message;
      }
      
      setError(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  const openDetailsModal = async (promoItem) => {
    try {
      const response = await apiRequest(`/promos/${promoItem.promo_id}`);
      setSelectedPromoForDetails(response.data);
    } catch (err) {
      console.error('Error fetching promo details:', err);
      setSelectedPromoForDetails(promoItem);
    }
    setShowDetailsModal(true);
  };

  const closeDetailsModal = () => {
    setShowDetailsModal(false);
    setSelectedPromoForDetails(null);
  };

  // Helper functions
  // Removed getBranchName - admin only sees their branch

  const getPackageName = (packageId) => {
    if (!packageId) return null;
    const pkg = packages.find(p => p.package_id === packageId);
    return pkg ? pkg.package_name : null;
  };

  const getMerchandiseName = (merchandiseId) => {
    if (!merchandiseId) return null;
    const item = merchandise.find(m => m.merchandise_id === merchandiseId);
    return item ? item.merchandise_name : null;
  };

  // Build example branch-specific promo codes based on existing branches
  const getBranchPromoCodeExamples = (baseCode) => {
    if (!baseCode || !branches || branches.length === 0) return '';
    const examples = branches
      .slice(0, 3)
      .map((branch) => {
        const citySource = branch.city || branch.branch_name || '';
        const cityClean = citySource
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '');
        return `${baseCode}${cityClean}`;
      })
      .filter(Boolean);
    if (examples.length === 0) return '';
    if (examples.length === 1) return examples[0];
    if (examples.length === 2) return `${examples[0]}, ${examples[1]}`;
    return `${examples[0]}, ${examples[1]}, etc.`;
  };

  const getPromoTypeLabel = (type) => {
    const promoType = PROMO_TYPES.find(t => t.value === type);
    return promoType ? promoType.label : type;
  };

  const getEligibilityLabel = (eligibility) => {
    const elig = ELIGIBILITY_TYPES.find(e => e.value === eligibility);
    return elig ? elig.label : eligibility;
  };

  const isPromoActive = (promo) => {
    if (promo.status !== 'Active') return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = promo.start_date ? new Date(promo.start_date) : null;
    const endDate = promo.end_date ? new Date(promo.end_date) : null;
    
    if (!startDate || !endDate) return false;
    
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);
    
    return today >= startDate && today <= endDate;
  };

  const isPromoExpired = (promo) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = promo.end_date ? new Date(promo.end_date) : null;
    return endDate && endDate < today;
  };

  // Removed getUniqueBranches - admin only sees their branch
  const getUniquePackages = [...new Set(promos.map(p => p.package_id).filter(Boolean))];
  const getUniqueStatuses = ['Active', 'Inactive', 'Expired'];

  const filteredPromos = promos.filter((promo) => {
    const matchesSearch = !nameSearchTerm || 
      promo.promo_name?.toLowerCase().includes(nameSearchTerm.toLowerCase()) ||
      getPackageName(promo.package_id)?.toLowerCase().includes(nameSearchTerm.toLowerCase());
    
    // Removed branch filter - admin only sees their branch
    
    const matchesPackage = !filterPackage || promo.package_id?.toString() === filterPackage;
    
    const matchesStatus = !filterStatus || promo.status === filterStatus || 
      (filterStatus === 'Expired' && isPromoExpired(promo));

    return matchesSearch && matchesPackage && matchesStatus;
  });

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
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Promos</h1>
        <button 
          onClick={openCreateModal}
          className="btn-primary flex items-center justify-center space-x-2 w-full sm:w-auto"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>Add Promo</span>
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Promos List */}
      {filteredPromos.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-500">
            {nameSearchTerm || filterPackage || filterStatus
              ? 'No promos found matching your criteria.'
              : 'No promos found. Add your first promo to get started.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow">
          {/* Desktop Table View */}
          <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
            <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '900px', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '220px' }} />
                <col style={{ width: '200px' }} />
                <col style={{ width: '140px' }} />
                <col style={{ width: '120px' }} />
                <col style={{ width: '120px' }} />
                <col style={{ width: '100px' }} />
              </colgroup>
              <thead className="bg-white table-header-stable">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '220px', minWidth: '220px' }}>
                    <div className="flex flex-col space-y-2">
                      <div className="flex items-center space-x-1 min-h-[6px]">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${nameSearchTerm ? 'bg-primary-600' : 'invisible'}`} aria-hidden />
                      </div>
                      <div className="relative min-h-[28px]">
                        <input
                          type="text"
                          value={nameSearchTerm}
                          onChange={(e) => setNameSearchTerm(e.target.value)}
                          placeholder="Search promo..."
                          className="px-2 py-1 pr-6 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 w-full"
                          onClick={(e) => e.stopPropagation()}
                        />
                        {nameSearchTerm && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setNameSearchTerm('');
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
                  {/* Removed Branch column - admin only sees their branch */}
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '200px', minWidth: '200px' }}>
                    <div className="relative package-filter-dropdown">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenPackageDropdown(!openPackageDropdown);
                        }}
                        className="flex items-center space-x-1 hover:text-gray-700"
                      >
                        <span>Package</span>
                        {filterPackage && (
                          <span className="inline-flex items-center justify-center w-1.5 h-1.5 bg-primary-600 rounded-full"></span>
                        )}
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {openPackageDropdown && (
                        <div className="absolute left-0 mt-2 w-48 bg-white rounded-md shadow-lg z-50 border border-gray-200 max-h-60 overflow-y-auto">
                          <div className="py-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setFilterPackage('');
                                setOpenPackageDropdown(false);
                              }}
                              className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
                                !filterPackage ? 'bg-gray-100 font-medium' : 'text-gray-700'
                              }`}
                            >
                              All Packages
                            </button>
                            {getUniquePackages.map((packageId) => {
                              const packageName = getPackageName(packageId);
                              return (
                                <button
                                  key={packageId}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setFilterPackage(packageId.toString());
                                    setOpenPackageDropdown(false);
                                  }}
                                  className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
                                    filterPackage === packageId.toString() ? 'bg-gray-100 font-medium' : 'text-gray-700'
                                  }`}
                                >
                                  {packageName || `Package ${packageId}`}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '140px', minWidth: '140px' }}>
                    <div className="relative status-filter-dropdown">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenStatusDropdown(!openStatusDropdown);
                        }}
                        className="flex items-center space-x-1 hover:text-gray-700"
                      >
                        <span>Status</span>
                        <span className={`inline-flex items-center justify-center w-1.5 h-1.5 rounded-full flex-shrink-0 ${filterStatus ? 'bg-primary-600' : 'invisible'}`} aria-hidden />
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {openStatusDropdown && (
                        <div className="absolute left-0 mt-2 w-48 bg-white rounded-md shadow-lg z-50 border border-gray-200 max-h-60 overflow-y-auto">
                          <div className="py-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setFilterStatus('');
                                setOpenStatusDropdown(false);
                              }}
                              className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
                                !filterStatus ? 'bg-gray-100 font-medium' : 'text-gray-700'
                              }`}
                            >
                              All Status
                            </button>
                            {getUniqueStatuses.map((status) => (
                              <button
                                key={status}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setFilterStatus(status);
                                  setOpenStatusDropdown(false);
                                }}
                                className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
                                  filterStatus === status ? 'bg-gray-100 font-medium' : 'text-gray-700'
                                }`}
                              >
                                {status}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '120px', minWidth: '120px' }}>
                    Discount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '120px', minWidth: '120px' }}>
                    Usage
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '100px', minWidth: '100px' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-[#ffffff] divide-y divide-gray-200">
                {filteredPromos.map((promo) => {
                  const isActive = isPromoActive(promo);
                  const isExpired = isPromoExpired(promo);
                  
                  return (
                    <tr key={promo.promo_id}>
                      <td className="px-6 py-4" style={{ maxWidth: '220px' }}>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-gray-900 truncate" title={promo.promo_name || '-'}>
                            {promo.promo_name || '-'}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            {getPromoTypeLabel(promo.promo_type)}
                          </div>
                          {promo.promo_code && (
                            <div className="mt-1 flex items-center space-x-2">
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-blue-50 text-blue-700 border border-blue-200">
                                {promo.promo_code}
                              </span>
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(promo.promo_code);
                                  // Could add toast notification
                                }}
                                className="text-blue-600 hover:text-blue-800"
                                title="Copy promo code"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                      {/* Removed Branch column - admin only sees their branch */}
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-900">
                          {(() => {
                            const packageIds = promo.package_ids || (promo.package_id ? [promo.package_id] : []);
                            if (packageIds.length === 0) return '-';
                            if (packageIds.length === 1) {
                              return getPackageName(packageIds[0]) || '-';
                            }
                            return (
                              <div className="flex flex-col space-y-1">
                                <span className="font-medium">{packageIds.length} packages</span>
                                <div className="text-xs text-gray-600 space-y-0.5">
                                  {packageIds.slice(0, 2).map(id => (
                                    <div key={id}>• {getPackageName(id) || `Package ${id}`}</div>
                                  ))}
                                  {packageIds.length > 2 && (
                                    <div className="text-gray-500">+{packageIds.length - 2} more</div>
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${
                            isActive
                              ? 'bg-green-100 text-green-800'
                              : isExpired
                              ? 'bg-red-100 text-red-800'
                              : promo.status === 'Active'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {isActive ? 'Active' : isExpired ? 'Expired' : promo.status || 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {promo.promo_type === 'percentage_discount' && promo.discount_percentage
                            ? `${promo.discount_percentage}% off`
                            : promo.promo_type === 'fixed_discount' && promo.discount_amount
                            ? `₱${parseFloat(promo.discount_amount).toFixed(2)} off`
                            : promo.promo_type === 'free_merchandise'
                            ? 'Free Items'
                            : promo.promo_type === 'combined'
                            ? `${promo.discount_percentage ? promo.discount_percentage + '%' : ''}${promo.discount_amount ? '₱' + parseFloat(promo.discount_amount).toFixed(2) : ''} + Free Items`
                            : '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {promo.max_uses !== null && promo.max_uses !== undefined
                            ? `${promo.current_uses || 0} / ${promo.max_uses}`
                            : `${promo.current_uses || 0} / Unlimited`}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="relative action-menu-container">
                          <button
                            onClick={(e) => handleMenuClick(promo.promo_id, e)}
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
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Results Count */}
      {filteredPromos.length > 0 && (
        <div className="text-sm text-gray-500 text-center">
          Showing {filteredPromos.length} of {promos.length} promos
        </div>
      )}

      {/* Action Menu Overlay */}
      {openMenuId && createPortal(
        <>
          <div 
            className="fixed inset-0 z-40 bg-transparent" 
            onClick={() => {
              setOpenMenuId(null);
              setMenuPosition({ top: undefined, bottom: undefined, right: undefined, left: undefined });
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
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const selectedPromo = filteredPromos.find(p => p.promo_id === openMenuId);
                  if (selectedPromo) {
                    setOpenMenuId(null);
                    setMenuPosition({ top: undefined, bottom: undefined, right: undefined, left: undefined });
                    openEditModal(selectedPromo);
                  }
                }}
                className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const selectedPromo = filteredPromos.find(p => p.promo_id === openMenuId);
                  if (selectedPromo) {
                    setOpenMenuId(null);
                    setMenuPosition({ top: undefined, bottom: undefined, right: undefined, left: undefined });
                    openDetailsModal(selectedPromo);
                  }
                }}
                className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
              >
                View Details
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenMenuId(null);
                  setMenuPosition({ top: undefined, bottom: undefined, right: undefined, left: undefined });
                  handleDelete(openMenuId);
                }}
                className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-100 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </>,
        document.body
      )}

      {/* Create/Edit Promo Modal */}
      {isModalOpen && createPortal(
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4"
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
                  {editingPromo ? 'Edit Promo' : 'Create New Promo'}
                </h2>
                {!editingPromo && (
                  <p className="text-sm text-gray-500 mt-1">Configure promotional offer for packages</p>
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
                  {/* Basic Information */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <label htmlFor="promo_name" className="label-field">
                        Promo Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        id="promo_name"
                        name="promo_name"
                        value={formData.promo_name}
                        onChange={handleInputChange}
                        className={`input-field ${formErrors.promo_name ? 'border-red-500' : ''}`}
                        required
                        placeholder="e.g., Summer Sale 2024, Winter Promo"
                      />
                      {formErrors.promo_name && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.promo_name}</p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="promo_code" className="label-field">
                        Promo Code <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          id="promo_code"
                          name="promo_code"
                          value={formData.promo_code || ''}
                          onChange={(e) => {
                            // Auto-convert to uppercase and remove spaces
                            const value = e.target.value.toUpperCase().replace(/\s/g, '').replace(/[^A-Z0-9-]/g, '');
                            setFormData(prev => ({ ...prev, promo_code: value }));
                            if (formErrors.promo_code) {
                              setFormErrors(prev => {
                                const newErrors = { ...prev };
                                delete newErrors.promo_code;
                                return newErrors;
                              });
                            }
                          }}
                          className={`input-field font-mono ${formErrors.promo_code ? 'border-red-500' : ''}`}
                          placeholder="e.g., SUMMER2024, WELCOME10"
                          maxLength={20}
                          required
                        />
                        {formData.promo_code && (
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(formData.promo_code);
                              // Could add a toast notification here
                            }}
                            className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            title="Copy promo code"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          </button>
                        )}
                      </div>
                      {formErrors.promo_code && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.promo_code}</p>
                      )}
                      {!editingPromo && formData.promo_code && (!formData.branch_id || formData.branch_id === '') && (
                        <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                          <div className="flex items-start">
                            <svg className="w-5 h-5 text-blue-600 mt-0.5 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                            </svg>
                            <div className="text-sm text-blue-800">
                              <p className="font-medium mb-1">Branch-Specific Codes Will Be Generated</p>
                              <p className="text-xs">
                                Since "All Branches" is selected, separate promos will be created for each branch with codes like:
                                <span className="block mt-1 font-mono text-blue-900">
                                  {getBranchPromoCodeExamples(formData.promo_code)}
                                </span>
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                      <p className="text-xs text-gray-500 mt-1">
                        <strong>Code-based:</strong> Enter a unique code for flyer/campaign promos <span className="whitespace-nowrap">(4-20 chars, A-Z, 0-9, -)</span>
                      </p>
                    </div>

                    <div className="md:col-span-2">
                      <label className="label-field">
                        Packages <span className="text-red-500">*</span>
                      </label>
                      <div className={`border border-gray-300 rounded-lg p-4 max-h-60 overflow-y-auto ${formErrors.package_ids ? 'border-red-500' : ''}`}>
                        {packages.length === 0 ? (
                          <p className="text-sm text-gray-500">No packages available</p>
                        ) : (
                          <div className="space-y-2">
                            {packages.map((pkg) => {
                              const isSelected = formData.package_ids.includes(pkg.package_id.toString());
                              return (
                                <label
                                  key={pkg.package_id}
                                  className="flex items-center space-x-3 p-2 rounded hover:bg-gray-50 cursor-pointer"
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setFormData(prev => ({
                                          ...prev,
                                          package_ids: [...prev.package_ids, pkg.package_id.toString()],
                                        }));
                                      } else {
                                        setFormData(prev => ({
                                          ...prev,
                                          package_ids: prev.package_ids.filter(id => id !== pkg.package_id.toString()),
                                        }));
                                      }
                                      if (formErrors.package_ids) {
                                        setFormErrors(prev => {
                                          const newErrors = { ...prev };
                                          delete newErrors.package_ids;
                                          return newErrors;
                                        });
                                      }
                                    }}
                                    className="w-4 h-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                                  />
                                  <div className="flex-1">
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                      <span className="text-sm font-medium text-gray-900">
                                        {pkg.package_name}
                                      </span>
                                      {pkg.level_tag && (
                                        <span className="text-xs text-gray-500">
                                          ({pkg.level_tag})
                                        </span>
                                      )}
                                      {pkg.package_type === 'Installment' && (
                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
                                          Installment
                                        </span>
                                      )}
                                    </div>
                                    <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-gray-600">
                                      {pkg.package_type === 'Installment' ? (
                                        <>
                                          {pkg.downpayment_amount != null && parseFloat(pkg.downpayment_amount) > 0 && (
                                            <span>Down payment: ₱{parseFloat(pkg.downpayment_amount).toFixed(2)}</span>
                                          )}
                                          {pkg.package_price != null && parseFloat(pkg.package_price) > 0 && (
                                            <span>Monthly: ₱{parseFloat(pkg.package_price).toFixed(2)}</span>
                                          )}
                                        </>
                                      ) : (
                                        pkg.package_price != null && parseFloat(pkg.package_price) > 0 && (
                                          <span>₱{parseFloat(pkg.package_price).toFixed(2)}</span>
                                        )
                                      )}
                                    </div>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      {formErrors.package_ids && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.package_ids}</p>
                      )}
                      {formData.package_ids.length > 0 && (
                        <p className="mt-1 text-xs text-gray-500">
                          {formData.package_ids.length} package(s) selected
                        </p>
                      )}
                      {formData.package_ids.length > 0 &&
                        formData.package_ids.some((id) => {
                          const p = packages.find((pkg) => pkg.package_id.toString() === id);
                          return p && p.package_type === 'Installment';
                        }) && (
                          <div className="mt-2 space-y-3">
                            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                              Configure how the promo applies to Installment packages:
                            </p>
                            
                            {/* Installment Apply Scope */}
                            <div>
                              <label className="label-field text-sm">
                                Apply Promo To <span className="text-red-500">*</span>
                              </label>
                              <div className="space-y-2">
                                <label className="flex items-center space-x-2 p-2 rounded hover:bg-gray-50 cursor-pointer">
                                  <input
                                    type="radio"
                                    name="installment_apply_scope"
                                    value="downpayment"
                                    checked={formData.installment_apply_scope === 'downpayment'}
                                    onChange={handleInputChange}
                                    className="w-4 h-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                                  />
                                  <span className="text-sm text-gray-700">Downpayment Only</span>
                                </label>
                                <label className="flex items-center space-x-2 p-2 rounded hover:bg-gray-50 cursor-pointer">
                                  <input
                                    type="radio"
                                    name="installment_apply_scope"
                                    value="monthly"
                                    checked={formData.installment_apply_scope === 'monthly'}
                                    onChange={handleInputChange}
                                    className="w-4 h-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                                  />
                                  <span className="text-sm text-gray-700">Monthly Installments Only</span>
                                </label>
                                <label className="flex items-center space-x-2 p-2 rounded hover:bg-gray-50 cursor-pointer">
                                  <input
                                    type="radio"
                                    name="installment_apply_scope"
                                    value="both"
                                    checked={formData.installment_apply_scope === 'both'}
                                    onChange={handleInputChange}
                                    className="w-4 h-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                                  />
                                  <span className="text-sm text-gray-700">Both (Downpayment + Monthly)</span>
                                </label>
                              </div>
                            </div>
                            
                            {/* Months to Apply (shown when scope includes monthly) */}
                            {(formData.installment_apply_scope === 'monthly' || formData.installment_apply_scope === 'both') && (
                              <div>
                                <label htmlFor="installment_months_to_apply" className="label-field text-sm">
                                  Number of Monthly Invoices to Apply Promo <span className="text-red-500">*</span>
                                </label>
                                <input
                                  type="number"
                                  id="installment_months_to_apply"
                                  name="installment_months_to_apply"
                                  value={formData.installment_months_to_apply || ''}
                                  onChange={handleInputChange}
                                  className={`input-field ${formErrors.installment_months_to_apply ? 'border-red-500' : ''}`}
                                  min="1"
                                  required
                                  placeholder="e.g., 3"
                                />
                                {formErrors.installment_months_to_apply && (
                                  <p className="mt-1 text-sm text-red-600">{formErrors.installment_months_to_apply}</p>
                                )}
                                <p className="mt-1 text-xs text-gray-500">
                                  Enter how many monthly installment invoices should receive the promo discount.
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                    </div>

                    {/* Branch is auto-set to admin's branch - read-only display */}
                    <div>
                      <label htmlFor="branch_id" className="label-field">
                        Branch
                      </label>
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

                    <div>
                      <label htmlFor="promo_type" className="label-field">
                        Promo Type <span className="text-red-500">*</span>
                      </label>
                      <select
                        id="promo_type"
                        name="promo_type"
                        value={formData.promo_type}
                        onChange={handleInputChange}
                        className={`input-field ${formErrors.promo_type ? 'border-red-500' : ''}`}
                        required
                      >
                        {PROMO_TYPES.map((type) => (
                          <option key={type.value} value={type.value}>
                            {type.label}
                          </option>
                        ))}
                      </select>
                      {formErrors.promo_type && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.promo_type}</p>
                      )}
                      {formData.promo_type === 'combined' && (
                        <p className="mt-1 text-xs text-gray-600">
                          💡 You can combine: Percentage discount OR Fixed discount + Free merchandise
                        </p>
                      )}
                    </div>

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
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                      </select>
                    </div>
                  </div>

                  {/* Discount Settings */}
                  {(formData.promo_type === 'percentage_discount' || formData.promo_type === 'fixed_discount' || formData.promo_type === 'combined') && (
                    <div className="border-t border-gray-200 pt-4">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">Discount Settings</h3>
                      {formData.promo_type === 'combined' && (
                        <div className="mb-4 space-y-2">
                          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                            <p className="text-sm font-semibold text-blue-900 mb-1">💡 Combined Promo Options:</p>
                            <ul className="text-xs text-blue-800 space-y-1 ml-4 list-disc">
                              <li><strong>Option 1:</strong> Percentage Discount + Free Merchandise</li>
                              <li><strong>Option 2:</strong> Fixed Amount Discount + Free Merchandise</li>
                              <li><strong>Option 3:</strong> Percentage + Fixed Discount + Free Merchandise</li>
                            </ul>
                            <p className="text-xs text-blue-700 mt-2">
                              <strong>Note:</strong> Use the toggle button below to select either percentage OR fixed discount, plus add free merchandise. At least one discount type OR merchandise is required.
                            </p>
                          </div>
                        </div>
                      )}
                      <div className="space-y-4">
                        {/* Toggle for Combined Promo Type */}
                        {formData.promo_type === 'combined' && (
                          <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                            <label className="label-field mb-3">Choose Discount Type:</label>
                            <div className="flex items-center space-x-4">
                              <button
                                type="button"
                                onClick={() => {
                                  setCombinedDiscountType('percentage');
                                  // Clear fixed amount when switching to percentage
                                  setFormData(prev => ({ ...prev, discount_amount: '' }));
                                }}
                                className={`flex-1 px-4 py-3 rounded-lg border-2 transition-all ${
                                  combinedDiscountType === 'percentage'
                                    ? 'border-blue-500 bg-blue-50 text-blue-700 font-semibold'
                                    : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                                }`}
                              >
                                <div className="flex items-center justify-center space-x-2">
                                  <span>Percentage Discount</span>
                                  <span className="text-xs">(%)</span>
                                </div>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setCombinedDiscountType('fixed');
                                  // Clear percentage when switching to fixed
                                  setFormData(prev => ({ ...prev, discount_percentage: '' }));
                                }}
                                className={`flex-1 px-4 py-3 rounded-lg border-2 transition-all ${
                                  combinedDiscountType === 'fixed'
                                    ? 'border-blue-500 bg-blue-50 text-blue-700 font-semibold'
                                    : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                                }`}
                              >
                                <div className="flex items-center justify-center space-x-2">
                                  <span>Fixed Amount</span>
                                  <span className="text-xs">($)</span>
                                </div>
                              </button>
                            </div>
                            <p className="mt-2 text-xs text-gray-600 text-center">
                              Select one discount type to use with free merchandise
                            </p>
                          </div>
                        )}

                        {/* Percentage Discount Field */}
                        {(formData.promo_type === 'percentage_discount' || (formData.promo_type === 'combined' && combinedDiscountType === 'percentage')) && (
                          <div>
                            <label htmlFor="discount_percentage" className="label-field">
                              Discount Percentage {formData.promo_type === 'percentage_discount' && <span className="text-red-500">*</span>}
                            </label>
                            <div className="flex items-center space-x-2">
                              <input
                                type="number"
                                id="discount_percentage"
                                name="discount_percentage"
                                value={formData.discount_percentage}
                                onChange={handleInputChange}
                                className={`input-field flex-1 ${formErrors.discount_percentage ? 'border-red-500' : ''}`}
                                min="0"
                                max="100"
                                step="0.01"
                                placeholder="0.00"
                                required={formData.promo_type === 'percentage_discount'}
                              />
                              <span className="text-gray-500">%</span>
                            </div>
                            {formErrors.discount_percentage && (
                              <p className="mt-1 text-sm text-red-600">{formErrors.discount_percentage}</p>
                            )}
                              {(formData.promo_type === 'percentage_discount' || formData.promo_type === 'combined') &&
                              formData.discount_percentage &&
                              formData.package_ids.length > 0 && (
                              <p className="mt-1 text-xs text-gray-500">
                                {(() => {
                                  const firstPackage = packages.find((p) =>
                                    formData.package_ids.includes(p.package_id.toString())
                                  );
                                  
                                  if (!firstPackage) return '';
                                  
                                  // Determine base amount based on scope for Installment packages
                                  let base = null;
                                  let label = '';
                                  
                                  if (firstPackage.package_type === 'Installment') {
                                    if (formData.installment_apply_scope === 'downpayment' || formData.installment_apply_scope === 'both') {
                                      base = firstPackage.downpayment_amount != null ? parseFloat(firstPackage.downpayment_amount) : null;
                                      label = 'on down payment';
                                    } else if (formData.installment_apply_scope === 'monthly') {
                                      base = firstPackage.package_price != null ? parseFloat(firstPackage.package_price) : null;
                                      label = 'per monthly installment';
                                    }
                                  } else {
                                    base = firstPackage.package_price != null ? parseFloat(firstPackage.package_price) : null;
                                  }
                                  
                                  return base != null && base > 0
                                    ? `Discount amount (${firstPackage.package_name}${label ? `, ${label}` : ''}): ₱${((base * parseFloat(formData.discount_percentage)) / 100).toFixed(2)}`
                                    : '';
                                })()}
                              </p>
                            )}
                          </div>
                        )}

                        {/* Fixed Amount Discount Field */}
                        {(formData.promo_type === 'fixed_discount' || (formData.promo_type === 'combined' && combinedDiscountType === 'fixed')) && (
                          <div>
                            <label htmlFor="discount_amount" className="label-field">
                              Discount Amount {formData.promo_type === 'fixed_discount' && <span className="text-red-500">*</span>}
                            </label>
                            <div className="flex items-center space-x-2">
                              <span className="text-gray-500">$</span>
                              <input
                                type="number"
                                id="discount_amount"
                                name="discount_amount"
                                value={formData.discount_amount}
                                onChange={handleInputChange}
                                className={`input-field flex-1 ${formErrors.discount_amount ? 'border-red-500' : ''}`}
                                min="0"
                                step="0.01"
                                placeholder="0.00"
                                required={formData.promo_type === 'fixed_discount'}
                              />
                            </div>
                            {formErrors.discount_amount && (
                              <p className="mt-1 text-sm text-red-600">{formErrors.discount_amount}</p>
                            )}
                          </div>
                        )}
                        
                        {formData.promo_type === 'combined' && (
                          <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                            <p className="text-xs text-green-800 font-medium mb-1">
                              ✓ Combined Promo Configuration:
                            </p>
                            <ul className="text-xs text-green-700 space-y-0.5 ml-4 list-disc">
                              {formData.discount_percentage && parseFloat(formData.discount_percentage) > 0 && (
                                <li>Percentage Discount: {formData.discount_percentage}%</li>
                              )}
                              {formData.discount_amount && parseFloat(formData.discount_amount) > 0 && (
                                <li>Fixed Discount: ₱{parseFloat(formData.discount_amount).toFixed(2)}</li>
                              )}
                              {formData.selectedMerchandise && formData.selectedMerchandise.length > 0 && (
                                <li>Free Merchandise: {formData.selectedMerchandise.length} item(s)</li>
                              )}
                              {(!formData.discount_percentage || parseFloat(formData.discount_percentage) <= 0) && 
                               (!formData.discount_amount || parseFloat(formData.discount_amount) <= 0) && 
                               (!formData.selectedMerchandise || formData.selectedMerchandise.length === 0) && (
                                <li className="text-yellow-700">⚠️ Add at least one discount or merchandise</li>
                              )}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Free Merchandise */}
                  {(formData.promo_type === 'free_merchandise' || formData.promo_type === 'combined') && (
                    <div className="border-t border-gray-200 pt-4">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">Free Merchandise</h3>
                      
                      {/* Add Merchandise */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                        <div className="md:col-span-2">
                          <label className="label-field text-xs">Merchandise</label>
                          <select
                            value={newMerchandise.merchandise_id}
                            onChange={(e) => setNewMerchandise({ ...newMerchandise, merchandise_id: e.target.value })}
                            className="input-field text-sm"
                          >
                            <option value="">Select Merchandise</option>
                            {MERCHANDISE_TYPES.map((typeName) => {
                              const itemsForType = getMerchandiseItemsByType(typeName);
                              if (itemsForType.length === 0) return null;
                              
                              return (
                                <optgroup key={typeName} label={typeName}>
                                  {itemsForType.map((item) => (
                                    <option key={item.merchandise_id} value={item.merchandise_id}>
                                      {item.merchandise_name} {item.size ? `(${item.size})` : ''}
                                    </option>
                                  ))}
                                </optgroup>
                              );
                            })}
                          </select>
                        </div>
                        <div>
                          <label className="label-field text-xs">Quantity</label>
                          <input
                            type="number"
                            min="1"
                            value={newMerchandise.quantity}
                            onChange={(e) => setNewMerchandise({ ...newMerchandise, quantity: parseInt(e.target.value) || 1 })}
                            className="input-field text-sm"
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleAddMerchandise}
                        className="mb-4 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                      >
                        Add Merchandise
                      </button>

                      {/* Selected Merchandise List */}
                      {formData.selectedMerchandise.length > 0 && (
                        <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                          <div className="space-y-2">
                            {formData.selectedMerchandise.map((item, index) => {
                              const merchItem = merchandise.find(m => m.merchandise_id === item.merchandise_id);
                              return (
                                <div key={index} className="flex items-center justify-between p-2 bg-white rounded border border-gray-200">
                                  <div className="flex-1">
                                    <span className="text-sm font-medium text-gray-900">
                                      {merchItem?.merchandise_name || `ID: ${item.merchandise_id}`}
                                      {merchItem?.size && ` (${merchItem.size})`}
                                    </span>
                                    <span className="ml-2 text-xs text-gray-500">
                                      Qty: {item.quantity}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveMerchandise(item.merchandise_id)}
                                    className="text-red-600 hover:text-red-700 ml-4"
                                  >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {formErrors.merchandise && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.merchandise}</p>
                      )}
                    </div>
                  )}

                  {/* Eligibility & Conditions */}
                  <div className="border-t border-gray-200 pt-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Eligibility & Conditions</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="eligibility_type" className="label-field">
                          Student Eligibility
                        </label>
                        <select
                          id="eligibility_type"
                          name="eligibility_type"
                          value={formData.eligibility_type}
                          onChange={handleInputChange}
                          className="input-field"
                        >
                          {ELIGIBILITY_TYPES.map((type) => (
                            <option key={type.value} value={type.value}>
                              {type.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label htmlFor="min_payment_amount" className="label-field">
                          Minimum Payment Amount
                        </label>
                        <div className="flex items-center space-x-2">
                          <span className="text-gray-500">$</span>
                          <input
                            type="number"
                            id="min_payment_amount"
                            name="min_payment_amount"
                            value={formData.min_payment_amount}
                            onChange={handleInputChange}
                            className="input-field flex-1"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                          />
                        </div>
                        <p className="text-xs text-gray-500 mt-1">Leave empty for no minimum</p>
                      </div>
                    </div>
                  </div>

                  {/* Duration & Usage */}
                  <div className="border-t border-gray-200 pt-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Duration & Usage</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label htmlFor="start_date" className="label-field">
                          Start Date <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="date"
                          id="start_date"
                          name="start_date"
                          value={formData.start_date}
                          onChange={handleInputChange}
                          className={`input-field ${formErrors.start_date ? 'border-red-500' : ''}`}
                          required
                        />
                        {formErrors.start_date && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.start_date}</p>
                        )}
                      </div>

                      <div>
                        <label htmlFor="end_date" className="label-field">
                          End Date <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="date"
                          id="end_date"
                          name="end_date"
                          value={formData.end_date}
                          onChange={handleInputChange}
                          className={`input-field ${formErrors.end_date ? 'border-red-500' : ''}`}
                          required
                        />
                        {formErrors.end_date && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.end_date}</p>
                        )}
                      </div>

                      <div>
                        <label htmlFor="max_uses" className="label-field">
                          Maximum Uses
                        </label>
                        <input
                          type="number"
                          id="max_uses"
                          name="max_uses"
                          value={formData.max_uses}
                          onChange={handleInputChange}
                          className="input-field"
                          min="1"
                          placeholder="Unlimited"
                        />
                        <p className="text-xs text-gray-500 mt-1">Leave empty for unlimited</p>
                      </div>
                    </div>
                  </div>

                  {/* Description */}
                  <div>
                    <label htmlFor="description" className="label-field">
                      Description
                    </label>
                    <textarea
                      id="description"
                      name="description"
                      value={formData.description}
                      onChange={handleInputChange}
                      className="input-field"
                      rows="3"
                      placeholder="Optional description for this promo"
                    />
                  </div>
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
                    editingPromo ? 'Update Promo' : 'Create Promo'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* View Details Modal */}
      {showDetailsModal && selectedPromoForDetails && createPortal(
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4"
          onClick={closeDetailsModal}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0 bg-white rounded-t-lg">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                  Promo Details
                </h2>
                <p className="text-sm text-gray-500 mt-1">{selectedPromoForDetails.promo_name}</p>
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

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-1">
              <div className="space-y-6">
                {/* Promo Information */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <span className="text-xs text-gray-500">Packages:</span>
                    <div className="text-sm font-medium text-gray-900">
                      {(() => {
                        const packageIds = selectedPromoForDetails.package_ids || 
                          (selectedPromoForDetails.packages ? selectedPromoForDetails.packages.map(p => p.package_id) : []) ||
                          (selectedPromoForDetails.package_id ? [selectedPromoForDetails.package_id] : []);
                        if (packageIds.length === 0) return '-';
                        return (
                          <div className="space-y-1">
                            {packageIds.map(id => (
                              <div key={id}>• {getPackageName(id) || `Package ${id}`}</div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Promo Code:</span>
                    <p className="text-sm font-medium text-gray-900">
                      {selectedPromoForDetails.promo_code ? (
                        <span className="inline-flex items-center px-2 py-1 rounded text-xs font-mono bg-blue-50 text-blue-700 border border-blue-200">
                          {selectedPromoForDetails.promo_code}
                        </span>
                      ) : (
                        <span className="text-gray-400">Auto-apply</span>
                      )}
                    </p>
                  </div>
                  {/* Removed Branch display - admin only sees their branch */}
                  <div>
                    <span className="text-xs text-gray-500">Promo Type:</span>
                    <p className="text-sm font-medium text-gray-900">
                      {getPromoTypeLabel(selectedPromoForDetails.promo_type)}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Eligibility:</span>
                    <p className="text-sm font-medium text-gray-900">
                      {getEligibilityLabel(selectedPromoForDetails.eligibility_type)}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Start Date:</span>
                    <p className="text-sm font-medium text-gray-900">
                      {selectedPromoForDetails.start_date 
                        ? new Date(selectedPromoForDetails.start_date).toLocaleDateString()
                        : 'Not set'}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">End Date:</span>
                    <p className="text-sm font-medium text-gray-900">
                      {selectedPromoForDetails.end_date 
                        ? new Date(selectedPromoForDetails.end_date).toLocaleDateString()
                        : 'Not set'}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Usage:</span>
                    <p className="text-sm font-medium text-gray-900">
                      {selectedPromoForDetails.max_uses !== null && selectedPromoForDetails.max_uses !== undefined
                        ? `${selectedPromoForDetails.current_uses || 0} / ${selectedPromoForDetails.max_uses}`
                        : `${selectedPromoForDetails.current_uses || 0} / Unlimited`}
                    </p>
                  </div>
                  {selectedPromoForDetails.min_payment_amount && (
                    <div>
                      <span className="text-xs text-gray-500">Minimum Payment:</span>
                      <p className="text-sm font-medium text-gray-900">
                        ₱{parseFloat(selectedPromoForDetails.min_payment_amount).toFixed(2)}
                      </p>
                    </div>
                  )}
                </div>

                {/* Discount Information */}
                {(selectedPromoForDetails.discount_percentage || selectedPromoForDetails.discount_amount) && (
                  <div className="border-t border-gray-200 pt-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-3">Discount</h3>
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      {selectedPromoForDetails.discount_percentage && (
                        <p className="text-sm text-blue-700">
                          <strong>Percentage:</strong> {selectedPromoForDetails.discount_percentage}% off
                        </p>
                      )}
                      {selectedPromoForDetails.discount_amount && (
                        <p className="text-sm text-blue-700">
                          <strong>Fixed Amount:</strong> ₱{parseFloat(selectedPromoForDetails.discount_amount).toFixed(2)} off
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Free Merchandise */}
                {selectedPromoForDetails.merchandise && selectedPromoForDetails.merchandise.length > 0 && (
                  <div className="border-t border-gray-200 pt-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-3">Free Merchandise</h3>
                    <div className="space-y-2">
                      {selectedPromoForDetails.merchandise.map((item) => (
                        <div key={item.promomerchandise_id} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="text-sm font-medium text-gray-900">
                                {item.merchandise_name || `ID: ${item.merchandise_id}`}
                                {item.size && ` (${item.size})`}
                              </span>
                              <span className="ml-2 text-xs text-gray-500">
                                Quantity: {item.quantity || 1}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Description */}
                {selectedPromoForDetails.description && (
                  <div className="border-t border-gray-200 pt-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-3">Description</h3>
                    <p className="text-sm text-gray-700">{selectedPromoForDetails.description}</p>
                  </div>
                )}
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
    </div>
  );
};

export default AdminPromo;

