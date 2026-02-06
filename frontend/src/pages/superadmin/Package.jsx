import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';

const Package = () => {
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nameSearchTerm, setNameSearchTerm] = useState('');
  const [filterBranch, setFilterBranch] = useState('');
  const [openMenuId, setOpenMenuId] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const [openBranchDropdown, setOpenBranchDropdown] = useState(false);
  const [branchDropdownRect, setBranchDropdownRect] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPackage, setEditingPackage] = useState(null);
  const [branches, setBranches] = useState([]);
  const [pricingLists, setPricingLists] = useState([]);
  const [merchandise, setMerchandise] = useState([]);
  const [formData, setFormData] = useState({
    package_name: '',
    branch_id: '',
    status: 'Active',
    package_price: '',
    level_tag: '',
    package_type: 'Fullpayment',
    phase_start: '',
    phase_end: '',
    downpayment_amount: '',
    selectedPricingLists: [], // Array of pricinglist_id
    selectedMerchandise: [], // Array of merchandise_id
  });
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedPackageForDetails, setSelectedPackageForDetails] = useState(null);
  const [newDetail, setNewDetail] = useState({
    type: 'pricing', // 'pricing' or 'merchandise'
    pricinglist_id: '',
    merchandise_id: '',
  });

  useEffect(() => {
    fetchPackages();
    fetchBranches();
    fetchPricingLists();
    fetchMerchandise();
  }, []);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (openMenuId && !event.target.closest('.action-menu-container') && !event.target.closest('.action-menu-overlay')) {
        setOpenMenuId(null);
      }
      if (openBranchDropdown && !event.target.closest('.branch-filter-dropdown') && !event.target.closest('.branch-filter-dropdown-portal')) {
        setOpenBranchDropdown(false);
        setBranchDropdownRect(null);
      }
    };

    if (openMenuId || openBranchDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [openMenuId, openBranchDropdown]);

  const handleMenuClick = (packageId, event) => {
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    
    if (openMenuId === packageId) {
      setOpenMenuId(null);
      setMenuPosition({ top: 0, right: 0 });
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
      setOpenMenuId(packageId);
    }
  };

  const fetchPackages = async () => {
    try {
      setLoading(true);
      const response = await apiRequest('/packages?limit=100');
      setPackages(response.data || []);
    } catch (err) {
      setError(err.message || 'Failed to fetch packages');
      console.error('Error fetching packages:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchBranches = async () => {
    try {
      const response = await apiRequest('/branches?limit=100');
      setBranches(response.data || []);
    } catch (err) {
      console.error('Error fetching branches:', err);
    }
  };

  const fetchPricingLists = async () => {
    try {
      const response = await apiRequest('/pricinglists?limit=100');
      setPricingLists(response.data || []);
    } catch (err) {
      console.error('Error fetching pricing lists:', err);
    }
  };

  const fetchMerchandise = async () => {
    try {
      const response = await apiRequest('/merchandise?limit=100');
      setMerchandise(response.data || []);
    } catch (err) {
      console.error('Error fetching merchandise:', err);
    }
  };

  const handleDelete = async (packageId) => {
    setOpenMenuId(null);
    if (!window.confirm('Are you sure you want to delete this package? This will also delete all package details.')) {
      return;
    }

    try {
      await apiRequest(`/packages/${packageId}`, {
        method: 'DELETE',
      });
      fetchPackages();
    } catch (err) {
      alert(err.message || 'Failed to delete package');
    }
  };

  const openCreateModal = () => {
    setEditingPackage(null);
    setError('');
    setFormData({
      package_name: '',
      branch_id: '',
      status: 'Active',
      package_price: '',
      level_tag: '',
      package_type: 'Fullpayment',
      phase_start: '',
      phase_end: '',
      downpayment_amount: '',
      selectedPricingLists: [],
      selectedMerchandise: [],
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const formatDateForInput = (dateValue) => {
    if (!dateValue) return '';
    // If it's already in YYYY-MM-DD format, return as is
    if (typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateValue)) {
      return dateValue.split('T')[0]; // Remove time portion if present
    }
    // If it's a Date object or can be parsed, format it
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

  const openEditModal = (packageItem) => {
    setOpenMenuId(null);
    setEditingPackage(packageItem);
    setError('');
    setFormData({
      package_name: packageItem.package_name || '',
      branch_id: packageItem.branch_id?.toString() || '',
      status: packageItem.status || 'Active',
      package_price: packageItem.package_price?.toString() || '',
      level_tag: packageItem.level_tag || '',
      package_type: packageItem.package_type || 'Fullpayment',
      phase_start: packageItem.phase_start?.toString() || '',
      phase_end: packageItem.phase_end?.toString() || '',
      downpayment_amount: packageItem.downpayment_amount?.toString() || '',
      selectedPricingLists: [],
      selectedMerchandise: [],
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingPackage(null);
    setFormErrors({});
    setFormData({
      package_name: '',
      branch_id: '',
      status: 'Active',
      package_price: '',
      level_tag: '',
      package_type: 'Fullpayment',
      phase_start: '',
      phase_end: '',
      downpayment_amount: '',
      selectedPricingLists: [],
      selectedMerchandise: [],
    });
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

  const handlePricingListToggle = (pricinglistId) => {
    setFormData((prev) => {
      const id = parseInt(pricinglistId);
      const isSelected = prev.selectedPricingLists.includes(id);
      return {
        ...prev,
        selectedPricingLists: isSelected
          ? prev.selectedPricingLists.filter((pid) => pid !== id)
          : [...prev.selectedPricingLists, id],
      };
    });
  };

  // Get unique merchandise types from the fetched merchandise data
  // Optionally filter by branch if branch_id is provided
  const getUniqueMerchandiseTypes = (branchId = null) => {
    const typeMap = new Map();
    // Filter merchandise by branch if branchId is provided
    const filteredMerchandise = branchId 
      ? merchandise.filter((item) => item.branch_id === parseInt(branchId))
      : merchandise;
    
    filteredMerchandise.forEach((item) => {
      if (item.merchandise_name) {
        if (!typeMap.has(item.merchandise_name)) {
          typeMap.set(item.merchandise_name, []);
        }
        typeMap.get(item.merchandise_name).push(item);
      }
    });
    // Return sorted array of unique merchandise type names
    return Array.from(typeMap.keys()).sort((a, b) => a.localeCompare(b));
  };

  const getMerchandiseItemsByType = (typeName, branchId = null) => {
    let filtered = merchandise.filter((item) => item.merchandise_name === typeName);
    // Filter by branch if branchId is provided
    if (branchId) {
      filtered = filtered.filter((item) => item.branch_id === parseInt(branchId));
    }
    return filtered;
  };

  const handleMerchandiseTypeToggle = (typeName) => {
    const itemsForType = getMerchandiseItemsByType(typeName, formData.branch_id || null);
    if (itemsForType.length === 0) {
      return;
    }

    setFormData((prev) => {
      const currentlySelected = prev.selectedMerchandise;
      const isSelected = itemsForType.some((item) =>
        currentlySelected.includes(item.merchandise_id)
      );

      let updatedSelection;
      if (isSelected) {
        updatedSelection = currentlySelected.filter(
          (id) => !itemsForType.some((item) => item.merchandise_id === id)
        );
      } else {
        updatedSelection = Array.from(
          new Set([
            ...currentlySelected,
            ...itemsForType.map((item) => item.merchandise_id),
          ])
        );
      }

      return {
        ...prev,
        selectedMerchandise: updatedSelection,
      };
    });
  };

  const getSelectedMerchandiseTypes = () => {
    const uniqueTypes = getUniqueMerchandiseTypes(formData.branch_id || null);
    return uniqueTypes.filter((typeName) => {
      const itemsForType = getMerchandiseItemsByType(typeName, formData.branch_id || null);
      if (itemsForType.length === 0) return false;
      return itemsForType.some((item) =>
        formData.selectedMerchandise.includes(item.merchandise_id)
      );
    });
  };

  const validateForm = () => {
    const errors = {};
    
    if (!formData.package_name.trim()) {
      errors.package_name = 'Package name is required';
    }

    // Validate level tag if pricing lists are selected
    if (!editingPackage && formData.selectedPricingLists.length > 0 && !formData.level_tag) {
      errors.level_tag = 'Level tag is required when selecting pricing lists';
    }

    // Validate phase range if package type is Phase
    if (formData.package_type === 'Phase') {
      if (!formData.phase_start) {
        errors.phase_start = 'Phase start is required for Phase package type';
      } else if (isNaN(parseInt(formData.phase_start)) || parseInt(formData.phase_start) < 1) {
        errors.phase_start = 'Phase start must be a positive integer';
      }

      if (formData.phase_end) {
        if (isNaN(parseInt(formData.phase_end)) || parseInt(formData.phase_end) < 1) {
          errors.phase_end = 'Phase end must be a positive integer';
        } else if (parseInt(formData.phase_end) < parseInt(formData.phase_start || '1')) {
          errors.phase_end = 'Phase end must be greater than or equal to phase start';
        }
      }
    }

    // Validate downpayment and package price for Installment packages
    if (formData.package_type === 'Installment') {
      if (!formData.downpayment_amount || formData.downpayment_amount === '') {
        errors.downpayment_amount = 'Downpayment is required for Installment packages';
      } else {
        const downpayment = parseFloat(formData.downpayment_amount);
        if (isNaN(downpayment) || downpayment < 0) {
          errors.downpayment_amount = 'Downpayment must be a positive number';
        }
      }
      
      if (!formData.package_price || formData.package_price === '') {
        errors.package_price = 'Monthly installment amount is required for Installment packages';
      } else {
        const monthlyAmount = parseFloat(formData.package_price);
        if (isNaN(monthlyAmount) || monthlyAmount < 0) {
          errors.package_price = 'Monthly installment amount must be a positive number';
        }
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
      if (editingPackage) {
        // When editing, only update package info (not details - they're managed separately)
        const payload = {
          package_name: formData.package_name.trim(),
          branch_id: formData.branch_id && formData.branch_id !== '' ? parseInt(formData.branch_id) : null,
          status: formData.status || 'Active',
          package_price: formData.package_price && formData.package_price !== '' ? parseFloat(formData.package_price) : null,
          level_tag: formData.level_tag?.trim() || null,
          package_type: formData.package_type || 'Fullpayment',
          phase_start: formData.package_type === 'Phase' && formData.phase_start ? parseInt(formData.phase_start) : null,
          phase_end: formData.package_type === 'Phase'
            ? (formData.phase_end ? parseInt(formData.phase_end) : (formData.phase_start ? parseInt(formData.phase_start) : null))
            : null,
          downpayment_amount: formData.package_type === 'Installment' && formData.downpayment_amount && formData.downpayment_amount !== ''
            ? parseFloat(formData.downpayment_amount)
            : null,
        };
        await apiRequest(`/packages/${editingPackage.package_id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        // When creating, build details from selected items
        const details = [];
        
        // Add selected pricing lists
        formData.selectedPricingLists.forEach(pricinglistId => {
          details.push({
            pricinglist_id: pricinglistId,
            merchandise_id: null,
          });
        });
        
        // Add selected merchandise
        formData.selectedMerchandise.forEach(merchandiseId => {
          details.push({
            pricinglist_id: null,
            merchandise_id: merchandiseId,
          });
        });

        const payload = {
          package_name: formData.package_name.trim(),
          branch_id: formData.branch_id && formData.branch_id !== '' ? parseInt(formData.branch_id) : null,
          status: formData.status || 'Active',
          package_price: formData.package_price && formData.package_price !== '' ? parseFloat(formData.package_price) : null,
          level_tag: formData.level_tag?.trim() || null,
          package_type: formData.package_type || 'Fullpayment',
          phase_start: formData.package_type === 'Phase' && formData.phase_start ? parseInt(formData.phase_start) : null,
          phase_end: formData.package_type === 'Phase'
            ? (formData.phase_end ? parseInt(formData.phase_end) : (formData.phase_start ? parseInt(formData.phase_start) : null))
            : null,
          downpayment_amount: formData.package_type === 'Installment' && formData.downpayment_amount && formData.downpayment_amount !== ''
            ? parseFloat(formData.downpayment_amount)
            : null,
          details: details,
        };
        await apiRequest('/packages', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      
      closeModal();
      fetchPackages();
    } catch (err) {
      console.error('Error saving package:', err);
      const errorMessage = err.response?.data?.errors 
        ? err.response.data.errors.map(e => e.msg).join(', ')
        : (err.response?.data?.message || err.message || `Failed to ${editingPackage ? 'update' : 'create'} package`);
      setError(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  const openDetailsModal = async (packageItem) => {
    // Refresh merchandise list to ensure we have the latest data
    await fetchMerchandise();
    
    // Fetch the latest package data with details
    try {
      const response = await apiRequest(`/packages/${packageItem.package_id}`);
      setSelectedPackageForDetails(response.data);
    } catch (err) {
      console.error('Error fetching package details:', err);
      const errorMessage = err.response?.data?.message || err.message || 'Failed to fetch package details';
      alert(`Error: ${errorMessage}`);
      // Still open the modal with the package item we have
      setSelectedPackageForDetails(packageItem);
    }
    setNewDetail({
      type: 'pricing',
      pricinglist_id: '',
      merchandise_id: '',
    });
    setShowDetailsModal(true);
  };

  const closeDetailsModal = () => {
    setShowDetailsModal(false);
    setSelectedPackageForDetails(null);
  };

  const addPackageDetail = async () => {
    if (newDetail.type === 'pricing' && !newDetail.pricinglist_id) {
      alert('Please select a pricing list');
      return;
    }
    if (newDetail.type === 'merchandise' && !newDetail.merchandise_id) {
      alert('Please select merchandise');
      return;
    }

    try {
      // Validate and parse IDs
      let pricinglistId = null;
      let merchandiseId = null;

      if (newDetail.type === 'pricing' && newDetail.pricinglist_id) {
        pricinglistId = parseInt(newDetail.pricinglist_id);
        if (isNaN(pricinglistId) || pricinglistId <= 0) {
          alert('Invalid pricing list ID');
          return;
        }
      }

      if (newDetail.type === 'merchandise' && newDetail.merchandise_id) {
        merchandiseId = parseInt(newDetail.merchandise_id);
        if (isNaN(merchandiseId) || merchandiseId <= 0) {
          alert('Invalid merchandise ID');
          return;
        }
        // Verify merchandise exists in our fetched data
        const merchandiseItem = merchandise.find(m => m.merchandise_id === merchandiseId);
        if (!merchandiseItem) {
          alert('Selected merchandise not found. Please refresh and try again.');
          return;
        }
      }

      const payload = {};
      if (pricinglistId) {
        payload.pricinglist_id = pricinglistId;
      }
      if (merchandiseId) {
        payload.merchandise_id = merchandiseId;
      }

      // Ensure we have at least one ID
      if (!pricinglistId && !merchandiseId) {
        alert('Please select either a pricing list or merchandise');
        return;
      }

      await apiRequest(`/packages/${selectedPackageForDetails.package_id}/details`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setNewDetail({
        type: 'pricing',
        pricinglist_id: '',
        merchandise_id: '',
      });
      
      // Refresh packages and update selected package
      await fetchPackages();
      const updatedPackages = await apiRequest(`/packages/${selectedPackageForDetails.package_id}`);
      setSelectedPackageForDetails(updatedPackages.data);
    } catch (err) {
      console.error('Error adding package detail:', err);
      const errorMessage = err.response?.data?.errors 
        ? err.response.data.errors.map(e => e.msg).join(', ')
        : (err.response?.data?.message || err.message || 'Failed to add package detail');
      alert(errorMessage);
    }
  };

  const removePackageDetail = async (detailId) => {
    if (!window.confirm('Are you sure you want to remove this detail from the package?')) {
      return;
    }

    try {
      await apiRequest(`/packages/${selectedPackageForDetails.package_id}/details/${detailId}`, {
        method: 'DELETE',
      });
      
      // Refresh packages and update selected package
      await fetchPackages();
      const updatedPackages = await apiRequest(`/packages/${selectedPackageForDetails.package_id}`);
      setSelectedPackageForDetails(updatedPackages.data);
    } catch (err) {
      alert(err.message || 'Failed to remove package detail');
    }
  };

  // Helper functions
  const getBranchName = (branchId) => {
    if (!branchId) return null;
    const branch = branches.find(b => b.branch_id === branchId);
    return branch ? branch.branch_name : null;
  };

  const getPricingListName = (pricingListId) => {
    if (!pricingListId) return null;
    const pricing = pricingLists.find(p => p.pricinglist_id === pricingListId);
    return pricing ? pricing.name : null;
  };

  const getMerchandiseName = (merchandiseId) => {
    if (!merchandiseId) return null;
    const item = merchandise.find(m => m.merchandise_id === merchandiseId);
    return item ? item.merchandise_name : null;
  };

  const getPricingDetailCount = (details = []) =>
    details.filter(detail => detail.pricinglist_id).length;

  const getMerchandiseTypeCount = (details = []) => {
    const types = new Set();
    details.forEach(detail => {
      if (detail.merchandise_id) {
        const name =
          detail.merchandise_name ||
          getMerchandiseName(detail.merchandise_id);
        if (name) {
          types.add(name);
        }
      }
    });
    return types.size;
  };

  const getDisplayDetailsCount = (details = []) =>
    getPricingDetailCount(details) + getMerchandiseTypeCount(details);

  const getUniqueBranches = [...new Set(packages.map(p => p.branch_id).filter(Boolean))];

  const filteredPackages = packages.filter((packageItem) => {
    const matchesSearch = !nameSearchTerm || 
      packageItem.package_name?.toLowerCase().includes(nameSearchTerm.toLowerCase()) ||
      getBranchName(packageItem.branch_id)?.toLowerCase().includes(nameSearchTerm.toLowerCase());
    
    const matchesBranch = !filterBranch || packageItem.branch_id?.toString() === filterBranch;
    
    return matchesSearch && matchesBranch;
  });

  // Filter pricing lists by selected level tag (use formData.level_tag)
  const filteredPricingListsByLevel = formData.level_tag
    ? pricingLists.filter(p => p.level_tag === formData.level_tag)
    : pricingLists;

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
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Packages</h1>
        <button 
          onClick={openCreateModal}
          className="btn-primary flex items-center justify-center space-x-2 w-full sm:w-auto"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>Add Package</span>
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Packages List */}
      {filteredPackages.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-500">
            {nameSearchTerm || filterBranch
              ? 'No packages found matching your criteria.'
              : 'No packages found. Add your first package to get started.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow">
          {/* Desktop Table View */}
          <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
            <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '1000px', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '200px' }} />
                <col style={{ width: '140px' }} />
                <col style={{ width: '220px' }} />
                <col style={{ width: '90px' }} />
                <col style={{ width: '120px' }} />
                <col style={{ width: '100px' }} />
                <col style={{ width: '100px' }} />
              </colgroup>
              <thead className="bg-white table-header-stable">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '200px', minWidth: '200px' }}>
                    <div className="flex flex-col space-y-2">
                      <div className="flex items-center space-x-1 min-h-[6px]">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${nameSearchTerm ? 'bg-primary-600' : 'invisible'}`} aria-hidden />
                      </div>
                      <div className="relative min-h-[28px]">
                        <input
                          type="text"
                          value={nameSearchTerm}
                          onChange={(e) => setNameSearchTerm(e.target.value)}
                          placeholder="Search package..."
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
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '140px', minWidth: '140px' }}>
                    Package Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '220px', minWidth: '220px' }}>
                    <div className="relative branch-filter-dropdown">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          setBranchDropdownRect(rect);
                          setOpenBranchDropdown(!openBranchDropdown);
                        }}
                        className="flex items-center space-x-1 hover:text-gray-700"
                      >
                        <span>Branch</span>
                        <span className={`inline-flex items-center justify-center w-1.5 h-1.5 rounded-full flex-shrink-0 ${filterBranch ? 'bg-primary-600' : 'invisible'}`} aria-hidden />
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '90px', minWidth: '90px' }}>
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '120px', minWidth: '120px' }}>
                    Price
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '100px', minWidth: '100px' }}>
                    Details Count
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '100px', minWidth: '100px' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-[#ffffff] divide-y divide-gray-200">
                {filteredPackages.map((packageItem) => (
                  <tr key={packageItem.package_id}>
                    <td className="px-6 py-4" style={{ maxWidth: '200px' }}>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate" title={packageItem.package_name || '-'}>
                          {packageItem.package_name || '-'}
                        </div>
                        {packageItem.level_tag && (
                          <>
                            <div className="h-1"></div>
                            <div className="text-xs text-gray-600 font-medium truncate" title={packageItem.level_tag}>
                              {packageItem.level_tag}
                            </div>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col items-start space-y-1">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${
                            (packageItem.package_type || '').trim() === 'Installment'
                              ? 'bg-blue-100 text-blue-800'
                              : (packageItem.package_type || '').trim() === 'Reserved'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {(packageItem.package_type || 'Fullpayment').trim()}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4" style={{ maxWidth: '220px' }}>
                      <div className="text-sm text-gray-900 truncate" title={getBranchName(packageItem.branch_id) || '-'}>
                        {getBranchName(packageItem.branch_id) || '-'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${
                          (packageItem.status || '').trim() === 'Active'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {(packageItem.status || 'Active').trim()}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {packageItem.package_price !== null && packageItem.package_price !== undefined
                          ? `₱${parseFloat(packageItem.package_price).toFixed(2)}`
                          : '-'}
                      </div>
                      {(packageItem.package_type || '').trim() === 'Installment' && packageItem.downpayment_amount && (
                        <div className="text-xs text-gray-500 mt-1">
                          Downpayment: ₱{parseFloat(packageItem.downpayment_amount).toFixed(2)}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {getDisplayDetailsCount(packageItem.details || [])} item(s)
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="relative action-menu-container">
                        <button
                          onClick={(e) => handleMenuClick(packageItem.package_id, e)}
                          className="p-2 rounded-full hover:bg-gray-100 transition-colors"
                        >
                          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Results Count */}
      {filteredPackages.length > 0 && (
        <div className="text-sm text-gray-500 text-center">
          Showing {filteredPackages.length} of {packages.length} packages
        </div>
      )}

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
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const selectedPackage = filteredPackages.find(p => p.package_id === openMenuId);
                  if (selectedPackage) {
                    setOpenMenuId(null);
                    setMenuPosition({ top: 0, right: 0 });
                    openEditModal(selectedPackage);
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
                  const selectedPackage = filteredPackages.find(p => p.package_id === openMenuId);
                  if (selectedPackage) {
                    setOpenMenuId(null);
                    setMenuPosition({ top: 0, right: 0 });
                    openDetailsModal(selectedPackage);
                  }
                }}
                className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
              >
                Manage Details
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenMenuId(null);
                  setMenuPosition({ top: 0, right: 0 });
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
          {getUniqueBranches.map((branchId) => {
            const branchName = getBranchName(branchId);
            return (
              <button
                key={branchId}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setFilterBranch(branchId.toString());
                  setOpenBranchDropdown(false);
                  setBranchDropdownRect(null);
                }}
                className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
                  filterBranch === branchId.toString() ? 'bg-gray-100 font-medium' : 'text-gray-700'
                }`}
              >
                {branchName || `Branch ${branchId}`}
              </button>
            );
          })}
        </div>,
        document.body
      )}

      {/* Create/Edit Package Modal */}
      {isModalOpen && createPortal(
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4"
          onClick={closeModal}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0 bg-white rounded-t-lg">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                  {editingPackage ? 'Edit Package' : 'Create New Package'}
                </h2>
                {!editingPackage && (
                  <p className="text-sm text-gray-500 mt-1">Fill in the details to create a new package</p>
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
                    <div className="md:col-span-2">
                      <label htmlFor="package_name" className="label-field">
                        Package Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        id="package_name"
                        name="package_name"
                        value={formData.package_name}
                        onChange={handleInputChange}
                        className={`input-field ${formErrors.package_name ? 'border-red-500' : ''}`}
                        required
                        placeholder="e.g., Premium Package, Basic Package"
                      />
                      {formErrors.package_name && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.package_name}</p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="branch_id" className="label-field">
                        Branch
                      </label>
                      <select
                        id="branch_id"
                        name="branch_id"
                        value={formData.branch_id}
                        onChange={handleInputChange}
                        className="input-field"
                      >
                        <option value="">Select Branch (Optional)</option>
                        {branches.map((branch) => (
                          <option key={branch.branch_id} value={branch.branch_id}>
                            {branch.branch_name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="level_tag" className="label-field">
                        Level Tag
                      </label>
                      <select
                        id="level_tag"
                        name="level_tag"
                        value={formData.level_tag}
                        onChange={handleInputChange}
                        className="input-field"
                      >
                        <option value="">Select Level Tag</option>
                        <option value="Playgroup">Playgroup</option>
                        <option value="Nursery">Nursery</option>
                        <option value="Pre-Kindergarten">Pre-Kindergarten</option>
                        <option value="Kindergarten">Kindergarten</option>
                        <option value="Grade School">Grade School</option>
                      </select>
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

                    <div>
                      <label htmlFor="package_type" className="label-field">
                        Package Type
                      </label>
                      <select
                        id="package_type"
                        name="package_type"
                        value={formData.package_type}
                        onChange={handleInputChange}
                        className="input-field"
                      >
                        <option value="Fullpayment">Fullpayment</option>
                        <option value="Installment">Installment</option>
                        <option value="Reserved">Reserved</option>
                        <option value="Phase">Phase</option>
                      </select>
                    </div>
                  </div>

                  {/* Package Price / Monthly Installment Amount */}
                  <div>
                    <label htmlFor="package_price" className="label-field">
                      {formData.package_type === 'Installment' ? (
                        <>Monthly Installment Amount <span className="text-red-500">*</span></>
                      ) : (
                        <>Package Price</>
                      )}
                    </label>
                    <input
                      type="number"
                      id="package_price"
                      name="package_price"
                      value={formData.package_price}
                      onChange={handleInputChange}
                      className={`input-field ${formErrors.package_price ? 'border-red-500' : ''}`}
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      required={formData.package_type === 'Installment'}
                    />
                    {formErrors.package_price && (
                      <p className="mt-1 text-sm text-red-600">{formErrors.package_price}</p>
                    )}
                    {formData.package_type === 'Installment' && (
                      <p className="mt-1 text-xs text-gray-500">
                        The monthly installment amount that will be charged after downpayment is paid.
                      </p>
                    )}
                  </div>

                  {/* Downpayment Settings for Installment Packages */}
                  {formData.package_type === 'Installment' && (
                    <div className="space-y-4 border-t border-gray-200 pt-4">
                      <h3 className="text-lg font-semibold text-gray-900">Downpayment Settings</h3>
                      <div>
                        <label htmlFor="downpayment_amount" className="label-field">
                          Downpayment Amount <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="number"
                          id="downpayment_amount"
                          name="downpayment_amount"
                          value={formData.downpayment_amount}
                          onChange={handleInputChange}
                          className={`input-field ${formErrors.downpayment_amount ? 'border-red-500' : ''}`}
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          required
                        />
                        {formErrors.downpayment_amount && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.downpayment_amount}</p>
                        )}
                        <p className="mt-1 text-xs text-gray-500">
                          Amount required before monthly installment invoices start generating. Once paid, monthly invoices will automatically be created.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Phase Package Settings */}
                  {formData.package_type === 'Phase' && (
                    <div className="space-y-4 border-t border-gray-200 pt-4">
                      <h3 className="text-lg font-semibold text-gray-900">Phase Settings</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label htmlFor="phase_start" className="label-field">
                            Phase From <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="number"
                            id="phase_start"
                            name="phase_start"
                            min="1"
                            value={formData.phase_start}
                            onChange={handleInputChange}
                            className="input-field"
                            required={formData.package_type === 'Phase'}
                          />
                          {formErrors.phase_start && (
                            <p className="text-red-500 text-xs mt-1">{formErrors.phase_start}</p>
                          )}
                        </div>
                        <div>
                          <label htmlFor="phase_end" className="label-field">
                            Phase To
                          </label>
                          <input
                            type="number"
                            id="phase_end"
                            name="phase_end"
                            min="1"
                            value={formData.phase_end}
                            onChange={handleInputChange}
                            className="input-field"
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            Leave empty to create a package for a single phase only (e.g., Phase 1).
                          </p>
                          {formErrors.phase_end && (
                            <p className="text-red-500 text-xs mt-1">{formErrors.phase_end}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Package Details Section - Only show when creating */}
                  {!editingPackage && (
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">Select Items to Include</h3>
                      
                      {/* Pricing Lists Section */}
                      <div className="mb-6">
                        <h4 className="text-md font-medium text-gray-700 mb-3">Pricing Lists</h4>
                        {!formData.level_tag ? (
                          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                            <p className="text-sm text-gray-500 italic">
                              Please select a level tag above to view available pricing lists.
                            </p>
                          </div>
                        ) : filteredPricingListsByLevel.length === 0 ? (
                          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                            <p className="text-sm text-gray-500 italic">
                              No pricing lists available for level tag "{formData.level_tag}".
                            </p>
                          </div>
                        ) : (
                          <div className="border border-gray-200 rounded-lg p-4 max-h-60 overflow-y-auto">
                            <div className="space-y-2">
                              {filteredPricingListsByLevel.map((pricing) => (
                                <label
                                  key={pricing.pricinglist_id}
                                  className="flex items-center space-x-3 p-2 hover:bg-gray-50 rounded cursor-pointer"
                                >
                                  <input
                                    type="checkbox"
                                    checked={formData.selectedPricingLists.includes(pricing.pricinglist_id)}
                                    onChange={() => handlePricingListToggle(pricing.pricinglist_id)}
                                    className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                                  />
                                  <div className="flex-1">
                                    <span className="text-sm font-medium text-gray-900">{pricing.name}</span>
                                    {pricing.level_tag && (
                                      <span className="ml-2 text-xs text-gray-500">({pricing.level_tag})</span>
                                    )}
                                    {pricing.price && (
                                      <span className="ml-2 text-xs text-gray-600">- ₱{parseFloat(pricing.price).toFixed(2)}</span>
                                    )}
                                  </div>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Merchandise Section */}
                      <div>
                        <h4 className="text-md font-medium text-gray-700 mb-3">Merchandise</h4>
                        {merchandise.length === 0 ? (
                          <p className="text-sm text-gray-500 italic">No merchandise available.</p>
                        ) : (
                          <div className="border border-gray-200 rounded-lg p-4 max-h-60 overflow-y-auto">
                            <div className="space-y-2">
                              {getUniqueMerchandiseTypes(formData.branch_id || null).map((typeName) => {
                                const itemsForType = getMerchandiseItemsByType(typeName, formData.branch_id || null);
                                const hasInventory = itemsForType.length > 0;
                                const isSelected = itemsForType.some((item) =>
                                  formData.selectedMerchandise.includes(item.merchandise_id)
                                );
                                const sampleItem = itemsForType[0];

                                return (
                                  <label
                                    key={typeName}
                                    className={`flex items-start space-x-3 p-2 rounded ${
                                      hasInventory
                                        ? 'hover:bg-gray-50 cursor-pointer'
                                        : 'opacity-60 cursor-not-allowed'
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      disabled={!hasInventory}
                                      onChange={() => handleMerchandiseTypeToggle(typeName)}
                                      className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded mt-1"
                                    />
                                    <div className="flex-1">
                                      <span className="text-sm font-medium text-gray-900">{typeName}</span>
                                      {!hasInventory && (
                                        <div className="mt-1 text-xs text-gray-500 italic">
                                          No inventory available yet
                                        </div>
                                      )}
                                    </div>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Summary */}
                      {(() => {
                        const selectedMerchTypes = getSelectedMerchandiseTypes();
                        return (
                          (formData.selectedPricingLists.length > 0 || selectedMerchTypes.length > 0) && (
                        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                              <p className="text-sm text-blue-700">
                                <strong>Selected:</strong> {formData.selectedPricingLists.length} pricing list(s),{' '}
                                {selectedMerchTypes.length} merchandise type(s)
                              </p>
                              {selectedMerchTypes.length > 0 && (
                                <p className="text-xs text-blue-600 mt-1">
                                  {selectedMerchTypes.join(', ')}
                                </p>
                              )}
                        </div>
                          )
                        );
                      })()}
                    </div>
                  )}

                  {editingPackage && (
                    <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-sm">
                      <p>To manage package details (pricing lists and merchandise), use the "Manage Details" option from the action menu after saving.</p>
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
                    editingPackage ? 'Update Package' : 'Create Package'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Manage Details Modal */}
      {showDetailsModal && selectedPackageForDetails && createPortal(
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
                  Manage Package Details
                </h2>
                <p className="text-sm text-gray-500 mt-1">{selectedPackageForDetails.package_name}</p>
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
              {/* Existing Details */}
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Current Details</h3>
                {selectedPackageForDetails.details && selectedPackageForDetails.details.length > 0 ? (
                  <div className="space-y-3">
                    {(() => {
                      // Separate pricing lists and merchandise
                      const pricingDetails = selectedPackageForDetails.details.filter(d => d.pricinglist_id);
                      const merchandiseDetails = selectedPackageForDetails.details.filter(d => d.merchandise_id);
                      
                      // Group merchandise by type (merchandise_name)
                      const merchandiseByType = new Map();
                      merchandiseDetails.forEach(detail => {
                        const typeName = detail.merchandise_name || getMerchandiseName(detail.merchandise_id);
                        if (typeName) {
                          if (!merchandiseByType.has(typeName)) {
                            merchandiseByType.set(typeName, []);
                          }
                          merchandiseByType.get(typeName).push(detail);
                        }
                      });
                      
                      return (
                        <>
                          {/* Display pricing lists */}
                          {pricingDetails.map((detail) => (
                            <div key={detail.packagedtl_id} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <span className="text-xs text-gray-500">Pricing List:</span>
                                  <span className="ml-2 text-sm font-medium text-gray-900">
                                    {detail.pricing_name || getPricingListName(detail.pricinglist_id) || `ID: ${detail.pricinglist_id}`}
                                    {detail.pricing_level_tag && ` (${detail.pricing_level_tag})`}
                                  </span>
                                </div>
                                <button
                                  onClick={() => removePackageDetail(detail.packagedtl_id)}
                                  className="text-red-600 hover:text-red-700 ml-4"
                                >
                                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          ))}
                          
                          {/* Display merchandise types (grouped) */}
                          {Array.from(merchandiseByType.entries()).map(([typeName, details]) => (
                            <div key={typeName} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <span className="text-xs text-gray-500">Merchandise:</span>
                                  <span className="ml-2 text-sm font-medium text-gray-900">
                                    {typeName}
                                  </span>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <span className="text-xs text-gray-500">
                                    ({details.length} item{details.length > 1 ? 's' : ''})
                                  </span>
                                  <button
                                    onClick={() => {
                                      // Remove all items of this type
                                      details.forEach(detail => removePackageDetail(detail.packagedtl_id));
                                    }}
                                    className="text-red-600 hover:text-red-700 ml-2"
                                  >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </>
                      );
                    })()}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 italic">No details added yet.</p>
                )}
              </div>

              {/* Add New Detail */}
              <div className="border-t border-gray-200 pt-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Add New Detail</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="label-field text-xs">Type</label>
                    <select
                      value={newDetail.type}
                      onChange={(e) => setNewDetail({ ...newDetail, type: e.target.value, pricinglist_id: '', merchandise_id: '' })}
                      className="input-field text-sm"
                    >
                      <option value="pricing">Pricing List</option>
                      <option value="merchandise">Merchandise</option>
                    </select>
                  </div>
                  <div>
                    <label className="label-field text-xs">
                      {newDetail.type === 'pricing' ? 'Pricing List' : 'Merchandise'}
                    </label>
                    {newDetail.type === 'pricing' ? (
                      <select
                        value={newDetail.pricinglist_id}
                        onChange={(e) => setNewDetail({ ...newDetail, pricinglist_id: e.target.value })}
                        className="input-field text-sm"
                      >
                        <option value="">Select Pricing List</option>
                        {pricingLists.map((pricing) => (
                          <option key={pricing.pricinglist_id} value={pricing.pricinglist_id}>
                            {pricing.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <select
                        value={newDetail.merchandise_id}
                        onChange={(e) => setNewDetail({ ...newDetail, merchandise_id: e.target.value })}
                        className="input-field text-sm"
                      >
                        <option value="">Select Merchandise</option>
                        {getUniqueMerchandiseTypes(selectedPackageForDetails?.branch_id || null).map((typeName) => {
                          const branchId = selectedPackageForDetails?.branch_id;
                          const itemsForType = getMerchandiseItemsByType(typeName, branchId || null);
                          // Filter out items that don't have valid IDs
                          const validItems = itemsForType.filter(item => item.merchandise_id && item.merchandise_id > 0);
                          const firstItemId = validItems[0]?.merchandise_id;
                          const isAvailable = Boolean(firstItemId);

                          return (
                            <option 
                              key={typeName} 
                              value={firstItemId ? firstItemId.toString() : ''} 
                              disabled={!isAvailable}
                            >
                              {typeName} {!isAvailable ? '(Not available)' : ''}
                            </option>
                          );
                        })}
                      </select>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={addPackageDetail}
                  className="mt-4 px-4 py-2 text-sm font-medium text-gray-900 bg-[#F7C844] hover:bg-[#F5B82E] rounded-lg transition-colors"
                >
                  Add Detail
                </button>
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

export default Package;

