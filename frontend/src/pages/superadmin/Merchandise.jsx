import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';
import MerchandiseImageUpload from '../../components/MerchandiseImageUploadS3';
import { formatDateManila } from '../../utils/dateUtils';

const Merchandise = () => {
  const [branches, setBranches] = useState([]);
  const [merchandise, setMerchandise] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState(null);
  const [selectedBranchName, setSelectedBranchName] = useState(null);
  const [viewingStocksFor, setViewingStocksFor] = useState(null); // merchandise_name
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewPrice, setReviewPrice] = useState('');
  const [priceError, setPriceError] = useState('');
  const [modalStep, setModalStep] = useState('branch-selection');
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [editingMerchandise, setEditingMerchandise] = useState(null);
  const [formData, setFormData] = useState({
    merchandise_name: '',
    size: '',
    quantity: '',
    price: '',
    branch_id: '',
    gender: '',
    type: '',
    image_url: '',
  });
  const [editingMerchandiseType, setEditingMerchandiseType] = useState(null); // For editing merchandise type (not individual stock)
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [requiresSizing, setRequiresSizing] = useState(false); // Toggle for uniform/sizing
  const [merchandiseCategory, setMerchandiseCategory] = useState(''); // 'uniform_school' | 'uniform_pe' | 'other' – used when creating new type
  const [openMenuId, setOpenMenuId] = useState(null); // Track which merchandise type's menu is open
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const [activeTab, setActiveTab] = useState('branches'); // 'branches' or 'requests'

  useEffect(() => {
    fetchBranches();
    fetchAllRequests();
  }, []);

  useEffect(() => {
    if (selectedBranchId) {
      fetchMerchandiseByBranch(selectedBranchId);
    }
  }, [selectedBranchId]);

  const fetchBranches = async () => {
    try {
      setLoading(true);
      const response = await apiRequest('/branches');
      setBranches(response.data || []);
    } catch (err) {
      setError(err.message || 'Failed to fetch branches');
      console.error('Error fetching branches:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchMerchandiseByBranch = async (branchId) => {
    try {
      // Fetch merchandise filtered by branch_id from backend
      const response = await apiRequest(`/merchandise?branch_id=${branchId}&limit=100`);
      setMerchandise(response.data || []);
    } catch (err) {
      setError(err.message || 'Failed to fetch merchandise');
      console.error('Error fetching merchandise:', err);
    }
  };

  const fetchAllRequests = async () => {
    try {
      const response = await apiRequest('/merchandise-requests');
      setRequests(response.data || []);
    } catch (err) {
      console.error('Error fetching requests:', err);
    }
  };

  const handleViewMerch = (branchId, branchName) => {
    setOpenMenuId(null);
    setSelectedBranchId(branchId);
    setSelectedBranchName(branchName);
    setViewingStocksFor(null); // Reset stocks view
  };

  const handleBackToBranches = () => {
    setSelectedBranchId(null);
    setSelectedBranchName(null);
    setMerchandise([]);
    setViewingStocksFor(null);
  };

  const handleViewStocks = (merchandiseName) => {
    setOpenMenuId(null);
    setViewingStocksFor(merchandiseName);
  };

  const handleBackToMerchandise = () => {
    setViewingStocksFor(null);
  };

  const handleDelete = async (merchandiseId) => {
    if (!window.confirm('Are you sure you want to delete this merchandise?')) {
      return;
    }

    try {
      await apiRequest(`/merchandise/${merchandiseId}`, {
        method: 'DELETE',
      });
      if (selectedBranchId) {
        fetchMerchandiseByBranch(selectedBranchId);
      }
    } catch (err) {
      alert(err.message || 'Failed to delete merchandise');
    }
  };

  const handleDeleteMerchandiseType = async (merchandiseName) => {
    if (!window.confirm(`Are you sure you want to delete all items of "${merchandiseName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      setOpenMenuId(null);
      // Get all merchandise items of this type for the current branch
      const itemsToDelete = merchandise.filter(
        item => item.branch_id === selectedBranchId && 
                 item.merchandise_name === merchandiseName
      );

      // Delete all items
      for (const item of itemsToDelete) {
        await apiRequest(`/merchandise/${item.merchandise_id}`, {
          method: 'DELETE',
        });
      }

      // Refresh the merchandise list
      if (selectedBranchId) {
        await fetchMerchandiseByBranch(selectedBranchId);
      }
    } catch (err) {
      alert(err.message || 'Failed to delete merchandise type');
    }
  };

  const openCreateModal = () => {
    setEditingMerchandise(null);
    setError('');
    // If we're in stocks view, pre-fill merchandise_name and branch_id
    if (viewingStocksFor && selectedBranchId) {
      // Check if this merchandise type requires sizing
      setRequiresSizing(requiresSizingForMerchandise(viewingStocksFor));
      setModalStep('form');
      setSelectedBranch(branches.find(b => b.branch_id === selectedBranchId) || null);
      setFormData({
        merchandise_name: viewingStocksFor,
        size: '',
        quantity: '',
        price: '',
        branch_id: selectedBranchId.toString(),
        gender: '',
        type: '',
        image_url: '',
      });
      setEditingMerchandiseType(null);
    } else if (selectedBranchId) {
      // If we're in merchandise types view (branch selected but not viewing stocks), show category selection first
      setRequiresSizing(false);
      setMerchandiseCategory('');
      setModalStep('category-selection');
      setSelectedBranch(branches.find(b => b.branch_id === selectedBranchId) || null);
      setFormData({
        merchandise_name: '',
        size: '',
        quantity: '',
        price: '',
        branch_id: selectedBranchId.toString(),
        gender: '',
        type: '',
        image_url: '',
      });
      setEditingMerchandiseType(null);
    } else {
      // If we're in branches view, show branch selection step
      setRequiresSizing(false);
      setMerchandiseCategory('');
      setModalStep('branch-selection');
      setSelectedBranch(null);
      setMerchandiseCategory('');
    setFormData({
      merchandise_name: '',
      size: '',
      quantity: '',
      price: '',
      branch_id: '',
      gender: '',
      type: '',
      image_url: '',
    });
    setEditingMerchandiseType(null);
    }
    setFormErrors({});
    setIsModalOpen(true);
  };

  const openReviewModal = (request) => {
    setSelectedRequest(request);
    setReviewNotes('');
    setReviewPrice('');
    setPriceError('');
    setIsReviewModalOpen(true);
  };

  const openViewModal = (request) => {
    setSelectedRequest(request);
    setIsViewModalOpen(true);
  };

  const closeReviewModal = () => {
    setIsReviewModalOpen(false);
    setSelectedRequest(null);
    setReviewNotes('');
    setReviewPrice('');
  };

  const closeViewModal = () => {
    setIsViewModalOpen(false);
    setSelectedRequest(null);
  };

  const handleApproveRequest = async (requestId, notes, price) => {
    // Validate price is required
    if (!price || price.trim() === '' || parseFloat(price) <= 0 || isNaN(parseFloat(price))) {
      setPriceError('Price is required and must be greater than 0');
      return;
    }

    try {
      setSubmitting(true);
      setPriceError('');
      await apiRequest(`/merchandise-requests/${requestId}/approve`, {
        method: 'PUT',
        body: JSON.stringify({ 
          review_notes: notes,
          price: parseFloat(price)
        }),
      });
      
      alert('Request approved successfully! Admin will be notified.');
      closeReviewModal();
      await fetchAllRequests();
    } catch (err) {
      alert(err.message || 'Failed to approve request');
      console.error('Error approving request:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRejectRequest = async (requestId, notes) => {
    if (!notes || notes.trim() === '') {
      alert('Please provide a reason for rejection');
      return;
    }

    try {
      setSubmitting(true);
      await apiRequest(`/merchandise-requests/${requestId}/reject`, {
        method: 'PUT',
        body: JSON.stringify({ review_notes: notes }),
      });
      
      alert('Request rejected. Admin will be notified.');
      closeReviewModal();
      await fetchAllRequests();
    } catch (err) {
      alert(err.message || 'Failed to reject request');
      console.error('Error rejecting request:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const openEditModal = (item) => {
    setEditingMerchandise(item);
    setEditingMerchandiseType(null);
    setError('');
    setModalStep('form');
    setSelectedBranch(branches.find(b => b.branch_id === item.branch_id) || null);
    setRequiresSizing(item.merchandise_name?.trim() === 'LCA Uniform' || !!item.size);
    setFormData({
      merchandise_name: item.merchandise_name || '',
      size: item.size || '',
      quantity: item.quantity?.toString() || '',
      price: item.price?.toString() || '',
      branch_id: item.branch_id ? item.branch_id.toString() : '',
      gender: item.gender || '',
      type: item.type || '',
      image_url: item.image_url || '',
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const openEditMerchandiseTypeModal = (merchType) => {
    setOpenMenuId(null);
    setEditingMerchandise(null);
    setEditingMerchandiseType(merchType);
    setError('');
    setModalStep('form');
    setMerchandiseCategory('');
    setSelectedBranch(branches.find(b => b.branch_id === selectedBranchId) || null);
    // Get the first item of this type to get image_url
    const sampleItem = merchandise.find(
      item => item.branch_id === selectedBranchId && 
               item.merchandise_name === merchType.name &&
               item.image_url
    ) || merchandise.find(
      item => item.branch_id === selectedBranchId && 
               item.merchandise_name === merchType.name
    );
    
    setFormData({
      merchandise_name: merchType.name || '',
      size: '',
      quantity: '',
      price: '',
      branch_id: selectedBranchId.toString(),
      gender: '',
      type: '',
      image_url: merchType.image_url || sampleItem?.image_url || '',
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingMerchandise(null);
    setEditingMerchandiseType(null);
    setModalStep('branch-selection');
    setSelectedBranch(null);
    setFormErrors({});
    setRequiresSizing(false);
  };

  const handleBranchSelect = (branch) => {
    setSelectedBranch(branch);
    setMerchandiseCategory('');
    setFormData(prev => ({
      ...prev,
      branch_id: branch.branch_id.toString(),
    }));
    setModalStep('category-selection');
  };

  const handleCategorySelect = (category) => {
    setMerchandiseCategory(category);
    if (category === 'uniform_school') {
      setFormData(prev => ({ ...prev, merchandise_name: 'School Uniform', gender: '', type: '' }));
      setRequiresSizing(true);
    } else if (category === 'uniform_pe') {
      setFormData(prev => ({ ...prev, merchandise_name: 'PE Uniform', gender: '', type: '' }));
      setRequiresSizing(true);
    } else {
      setFormData(prev => ({ ...prev, merchandise_name: '', gender: '', type: '' }));
      setRequiresSizing(false);
    }
    setModalStep('form');
  };

  const handleBackToBranchSelection = () => {
    setModalStep('branch-selection');
    setSelectedBranch(null);
    setFormData(prev => ({
      ...prev,
      branch_id: '',
    }));
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

  const validateForm = () => {
    const errors = {};
    
    // When editing merchandise type image only, we don't need merchandise_name validation
    if (!editingMerchandiseType && !formData.merchandise_name.trim()) {
      errors.merchandise_name = 'Merchandise name is required';
    }

    if (formData.quantity && (isNaN(formData.quantity) || parseInt(formData.quantity) < 0)) {
      errors.quantity = 'Quantity must be a non-negative integer';
    }

    if (formData.price && (isNaN(formData.price) || parseFloat(formData.price) < 0)) {
      errors.price = 'Price must be a positive number';
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
        merchandise_name: formData.merchandise_name.trim(),
        size: formData.size?.trim() || null,
        quantity: formData.quantity && formData.quantity !== '' ? parseInt(formData.quantity) : null,
        price: formData.price && formData.price !== '' ? parseFloat(formData.price) : null,
        branch_id: formData.branch_id ? parseInt(formData.branch_id) : null,
        gender: formData.gender && formData.gender.trim() !== '' ? formData.gender.trim() : null,
        type: formData.type && formData.type.trim() !== '' ? formData.type.trim() : null,
        image_url: formData.image_url || null,
      };
      
      if (editingMerchandise) {
        await apiRequest(`/merchandise/${editingMerchandise.merchandise_id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else if (editingMerchandiseType) {
        // When editing merchandise type, update all items of that type with the image
        // First, get all items of this type
        const itemsToUpdate = merchandise.filter(
          item => item.branch_id === selectedBranchId && 
                   item.merchandise_name === editingMerchandiseType.name
        );
        
        // Update each item with the new image_url
        for (const item of itemsToUpdate) {
          await apiRequest(`/merchandise/${item.merchandise_id}`, {
            method: 'PUT',
            body: JSON.stringify({
              image_url: payload.image_url,
            }),
          });
        }
      } else {
        await apiRequest('/merchandise', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      
      closeModal();
      // Refresh merchandise data to show updated images
      if (selectedBranchId) {
        await fetchMerchandiseByBranch(selectedBranchId);
      }
      // If we were viewing stocks, refresh the stocks view
      if (viewingStocksFor) {
        // The stocks will automatically update since merchandise state is refreshed
      }
    } catch (err) {
      // Extract detailed error message from response
      let errorMessage = err.message || `Failed to ${editingMerchandise ? 'update' : 'create'} merchandise`;
      
      // If there are validation errors, show them
      if (err.response?.data?.errors && Array.isArray(err.response.data.errors)) {
        const validationErrors = err.response.data.errors.map(e => e.msg || e.message).join(', ');
        errorMessage = `Validation failed: ${validationErrors}`;
      } else if (err.response?.data?.message) {
        errorMessage = err.response.data.message;
      }
      
      setError(errorMessage);
      console.error('Error saving merchandise:', err);
      if (err.response?.data?.errors) {
        console.error('Validation errors:', err.response.data.errors);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Helper function to format branch name for display (two lines)
  const formatBranchName = (branchName) => {
    if (!branchName) return null;
    
    if (branchName.includes(' - ')) {
      const parts = branchName.split(' - ');
      return {
        company: parts[0].trim(),
        location: parts.slice(1).join(' - ').trim()
      };
    } else if (branchName.includes('-')) {
      const parts = branchName.split('-');
      return {
        company: parts[0].trim(),
        location: parts.slice(1).join('-').trim()
      };
    }
    
    return {
      company: branchName,
      location: ''
    };
  };

  // Get unique merchandise types for the selected branch with their images
  const getUniqueMerchandiseTypes = () => {
    if (!selectedBranchId || !merchandise.length) return [];
    
    // Filter merchandise by branch_id
    const branchMerchandise = merchandise.filter(item => item.branch_id === selectedBranchId && item.merchandise_name);
    
    // Group by merchandise_name and get the first item's image_url (or most recent)
    const typeMap = new Map();
    
    branchMerchandise.forEach(item => {
      const name = item.merchandise_name;
      if (!typeMap.has(name)) {
        // Get the first item with an image, or the first item if no image
        const withImage = branchMerchandise.find(i => i.merchandise_name === name && i.image_url);
        typeMap.set(name, {
          name,
          image_url: withImage?.image_url || item.image_url || null,
          // Get any item of this type for reference
          sampleItem: item,
        });
      } else {
        // Update if we find an item with an image
        const existing = typeMap.get(name);
        if (!existing.image_url && item.image_url) {
          existing.image_url = item.image_url;
        }
      }
    });
    
    // Convert to array and sort alphabetically
    return Array.from(typeMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  };

  // Get stocks for a specific merchandise name (filtered by branch and merchandise name)
  const getStocksByMerchandiseName = (merchandiseName) => {
    if (!selectedBranchId || !merchandiseName) return [];
    
    // Filter merchandise by branch_id and merchandise_name
    const filteredStocks = merchandise.filter(
      (item) => item.branch_id === selectedBranchId && 
                 item.merchandise_name === merchandiseName
    );
    
    // Group by size or return as is
    return filteredStocks.map(item => ({
      merchandise_id: item.merchandise_id,
      size: item.size || 'N/A',
      quantity: item.quantity || 0,
      price: item.price || 0,
      gender: item.gender || '',
      type: item.type || '',
    }));
  };

  // Check if a merchandise type requires sizing
  const requiresSizingForMerchandise = (merchandiseName) => {
    if (!merchandiseName) return false;
    
    // Check if name contains "uniform" (case-insensitive)
    if (merchandiseName.toLowerCase().includes('uniform')) {
      return true;
    }
    
    // Check if any stock item has a size (not null/empty/N/A)
    const stocks = getStocksByMerchandiseName(merchandiseName);
    return stocks.some(stock => stock.size && stock.size !== 'N/A' && stock.size.trim() !== '');
  };

  const getStatusBadge = (status) => {
    const statusStyles = {
      Pending: 'bg-yellow-100 text-yellow-800',
      Approved: 'bg-green-100 text-green-800',
      Rejected: 'bg-red-100 text-red-800',
      Cancelled: 'bg-gray-100 text-gray-800',
    };
    
    return (
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${statusStyles[status] || 'bg-gray-100 text-gray-800'}`}>
        {status}
      </span>
    );
  };

  // Render modals function
  const renderModals = () => (
    <>
        {/* Create/Edit Merchandise Modal */}
      {isModalOpen && createPortal(
          <div 
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
            onClick={closeModal}
          >
            <div 
              className={`bg-white rounded-lg shadow-xl ${(modalStep === 'branch-selection' || modalStep === 'category-selection') ? 'max-w-lg w-full' : 'max-w-2xl w-full'} max-h-[90vh] flex flex-col overflow-hidden`}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0 bg-white rounded-t-lg">
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                    {editingMerchandiseType ? 'Edit Merchandise Image' : editingMerchandise ? 'Edit Stock' : viewingStocksFor ? 'Add Stock' : modalStep === 'branch-selection' ? 'Select Branch' : modalStep === 'category-selection' ? 'Merchandise Category' : 'Create New Merchandise'}
                  </h2>
                  {modalStep === 'category-selection' && (
                    <p className="text-sm text-gray-500 mt-1">Choose what type of merchandise you want to add</p>
                  )}
                  {modalStep === 'form' && !editingMerchandise && (
                    <p className="text-sm text-gray-500 mt-1">
                      {editingMerchandiseType 
                        ? 'Update the image for this merchandise type' 
                        : viewingStocksFor 
                        ? 'Fill in the stock details for this merchandise type' 
                        : 'Fill in the details to create a new merchandise item'}
                    </p>
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
              {modalStep === 'branch-selection' ? (
                <div className="flex flex-col overflow-hidden">
                  <div className="p-6">
                    <div className="mb-4">
                      <label htmlFor="branch_select" className="label-field">
                        Select Branch <span className="text-red-500">*</span>
                      </label>
                      <select
                        id="branch_select"
                        value={selectedBranch?.branch_id || ''}
                        onChange={(e) => {
                          const branchId = parseInt(e.target.value);
                          const branch = branches.find(b => b.branch_id === branchId);
                          if (branch) {
                            handleBranchSelect(branch);
                          }
                        }}
                        className="input-field"
                        required
                      >
                        <option value="">Choose a branch...</option>
                        {branches.map((branch) => (
                          <option key={branch.branch_id} value={branch.branch_id}>
                            {branch.branch_name}
                          </option>
                        ))}
                      </select>
                      {selectedBranch && selectedBranch.branch_email && (
                        <p className="mt-2 text-sm text-gray-500">{selectedBranch.branch_email}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-end space-x-3 px-6 pb-6 border-t border-gray-200 flex-shrink-0 bg-white rounded-b-lg">
                    <button
                      type="button"
                      onClick={closeModal}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (selectedBranch) {
                          setModalStep('category-selection');
                        }
                      }}
                      disabled={!selectedBranch}
                      className="px-4 py-2 text-sm font-medium text-gray-900 bg-[#F7C844] hover:bg-[#F5B82E] rounded-lg transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                      Continue
                    </button>
                  </div>
                </div>
              ) : modalStep === 'category-selection' ? (
                <div className="flex flex-col overflow-hidden">
                  <div className="p-6">
                    <p className="text-sm text-gray-500 mb-4">What type of merchandise do you want to add?</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <button
                        type="button"
                        onClick={() => handleCategorySelect('uniform_school')}
                        className="flex flex-col items-center justify-center p-6 rounded-lg border-2 border-gray-200 hover:border-[#F7C844] hover:bg-amber-50 transition-colors text-left w-full"
                      >
                        <span className="text-lg font-semibold text-gray-900">Uniform (School)</span>
                        <span className="text-xs text-gray-500 mt-1">School uniform with Top/Bottom, Size, Gender</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCategorySelect('uniform_pe')}
                        className="flex flex-col items-center justify-center p-6 rounded-lg border-2 border-gray-200 hover:border-[#F7C844] hover:bg-amber-50 transition-colors text-left w-full"
                      >
                        <span className="text-lg font-semibold text-gray-900">Uniform (PE)</span>
                        <span className="text-xs text-gray-500 mt-1">PE uniform with Top/Bottom, Size, Gender</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCategorySelect('other')}
                        className="flex flex-col items-center justify-center p-6 rounded-lg border-2 border-gray-200 hover:border-[#F7C844] hover:bg-amber-50 transition-colors text-left w-full"
                      >
                        <span className="text-lg font-semibold text-gray-900">Other merchandise</span>
                        <span className="text-xs text-gray-500 mt-1">Bag, kit, keychain, etc.</span>
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-end space-x-3 px-6 pb-6 border-t border-gray-200 flex-shrink-0 bg-white rounded-b-lg">
                    {!selectedBranchId && (
                      <button
                        type="button"
                        onClick={() => setModalStep('branch-selection')}
                        className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                      >
                        Back
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={closeModal}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
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
                        <label htmlFor="merchandise_name" className="label-field">
                          Merchandise Name <span className="text-red-500">*</span>
                        </label>
                        {viewingStocksFor && !editingMerchandise ? (
                          <div>
                            <input
                              type="text"
                              value={formData.merchandise_name}
                              readOnly
                              className="input-field bg-gray-50 cursor-not-allowed"
                            />
                            <p className="mt-1 text-xs text-gray-500">Merchandise name is pre-filled from the selected type</p>
                          </div>
                        ) : (
                          <>
                            <input
                              type="text"
                              id="merchandise_name"
                              name="merchandise_name"
                              value={formData.merchandise_name}
                              onChange={handleInputChange}
                              className={`input-field ${formErrors.merchandise_name ? 'border-red-500' : ''}`}
                              required
                              placeholder="e.g., LCA Uniform, LCA Learning Kit, LCA Bag, LCA Keychain, LCA Totebag"
                            />
                            {formErrors.merchandise_name && (
                              <p className="mt-1 text-sm text-red-600">{formErrors.merchandise_name}</p>
                            )}
                          </>
                        )}
                      </div>

                      <div>
                        <label htmlFor="branch_id" className="label-field">
                          Branch <span className="text-red-500">*</span>
                        </label>
                        {(viewingStocksFor || (!editingMerchandise && selectedBranch)) ? (
                          <div>
                            <input
                              type="text"
                              value={selectedBranch?.branch_name || branches.find(b => b.branch_id === parseInt(formData.branch_id))?.branch_name || ''}
                              readOnly
                              className="input-field bg-gray-50 cursor-not-allowed"
                            />
                            <p className="mt-1 text-xs text-gray-500">
                              {viewingStocksFor ? 'Branch is pre-filled from the selected branch' : 'Branch was selected in the previous step'}
                            </p>
                          </div>
                        ) : (
                          <select
                            id="branch_id"
                            name="branch_id"
                            value={formData.branch_id}
                            onChange={handleInputChange}
                            className="input-field"
                            required
                          >
                            <option value="">Select Branch</option>
                            {branches.map((branch) => (
                              <option key={branch.branch_id} value={branch.branch_id}>
                                {branch.branch_name}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>

                      {(requiresSizing || requiresSizingForMerchandise(formData.merchandise_name)) && (
                        <div>
                          <label htmlFor="size" className="label-field">
                            Size
                          </label>
                          <select
                            id="size"
                            name="size"
                            value={formData.size}
                            onChange={handleInputChange}
                            className="input-field"
                          >
                            <option value="">Select Size</option>
                            <option value="Extra Small">Extra Small</option>
                            <option value="Small">Small</option>
                            <option value="Medium">Medium</option>
                            <option value="Large">Large</option>
                            <option value="Extra Large">Extra Large</option>
                          </select>
                        </div>
                      )}

                      <div>
                        <label htmlFor="quantity" className="label-field">
                          Quantity
                        </label>
                        <input
                          type="number"
                          min="0"
                          id="quantity"
                          name="quantity"
                          value={formData.quantity}
                          onChange={handleInputChange}
                          className={`input-field ${formErrors.quantity ? 'border-red-500' : ''}`}
                          placeholder="0"
                        />
                        {formErrors.quantity && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.quantity}</p>
                        )}
                      </div>

                      <div>
                        <label htmlFor="price" className="label-field">
                          Price
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          id="price"
                          name="price"
                          value={formData.price}
                          onChange={handleInputChange}
                          className={`input-field ${formErrors.price ? 'border-red-500' : ''}`}
                          placeholder="0.00"
                        />
                        {formErrors.price && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.price}</p>
                        )}
                      </div>

                      {/* Gender and Type fields - show for Uniform (School/PE) category or when name contains "uniform" */}
                      {((merchandiseCategory === 'uniform_school' || merchandiseCategory === 'uniform_pe') || (formData.merchandise_name && formData.merchandise_name.toLowerCase().includes('uniform'))) && (
                        <>
                          <div>
                            <label htmlFor="gender" className="label-field">
                              Gender
                            </label>
                            <select
                              id="gender"
                              name="gender"
                              value={formData.gender}
                              onChange={handleInputChange}
                              className="input-field"
                            >
                              <option value="">Select Gender</option>
                              <option value="Men">Men</option>
                              <option value="Women">Women</option>
                              <option value="Unisex">Unisex</option>
                            </select>
                          </div>

                          <div>
                            <label htmlFor="type" className="label-field">
                              Type
                            </label>
                            <select
                              id="type"
                              name="type"
                              value={formData.type}
                              onChange={handleInputChange}
                              className="input-field"
                            >
                              <option value="">Select Type</option>
                              <option value="Top">Top</option>
                              <option value="Bottom">Bottom</option>
                            </select>
                          </div>
                        </>
                      )}

                      {/* Image Upload - Show for merchandise type editing or when adding new merchandise type */}
                      {(editingMerchandiseType || (!editingMerchandise && !viewingStocksFor && selectedBranchId)) && (
                        <div className="md:col-span-2">
                          <MerchandiseImageUpload
                            currentImageUrl={formData.image_url}
                            onImageUploaded={(imageUrl) => {
                              setFormData(prev => ({
                                ...prev,
                                image_url: imageUrl || '',
                              }));
                            }}
                            merchandiseName={formData.merchandise_name}
                            merchandiseId={editingMerchandise?.merchandise_id || editingMerchandiseType?.sampleItem?.merchandise_id}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Modal Footer */}
                <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 flex-shrink-0 bg-white rounded-b-lg">
                  {!editingMerchandise && !viewingStocksFor && selectedBranch && (
                    <button
                      type="button"
                      onClick={() => setModalStep('category-selection')}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                      disabled={submitting}
                    >
                      Back
                    </button>
                  )}
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
                    editingMerchandise ? 'Update Stock' : 'Add Merchandise Type'
                    )}
                  </button>
                </div>
              </form>
              )}
            </div>
        </div>,
        document.body
      )}

      {/* Review Request Modal */}
      {isReviewModalOpen && selectedRequest && createPortal(
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4"
          onClick={closeReviewModal}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0 bg-white rounded-t-lg">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                  Review Stock Request
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  Review and approve or reject the merchandise request
                </p>
              </div>
              <button
                onClick={closeReviewModal}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-1">
              <div className="space-y-4">
                {/* Request Details */}
                <div className="bg-gray-50 p-4 rounded-lg">
                  <h3 className="text-sm font-medium text-gray-700 mb-3">Request Details</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Merchandise:</span>
                      <p className="font-medium text-gray-900">{selectedRequest.merchandise_name}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Branch:</span>
                      <p className="font-medium text-gray-900">{selectedRequest.requested_branch_name || selectedRequest.branch_name || 'N/A'}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Size:</span>
                      <p className="font-medium text-gray-900">{selectedRequest.size || 'N/A'}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Quantity:</span>
                      <p className="font-medium text-gray-900">{selectedRequest.requested_quantity}</p>
                    </div>
                    <div className="col-span-2">
                      <span className="text-gray-500">Reason:</span>
                      <p className="font-medium text-gray-900 mt-1">{selectedRequest.request_reason}</p>
                    </div>
                    {(selectedRequest.gender || selectedRequest.type) && (
                      <>
                        {selectedRequest.gender && (
                          <div>
                            <span className="text-gray-500">Gender:</span>
                            <p className="font-medium text-gray-900 mt-1">{selectedRequest.gender}</p>
                          </div>
                        )}
                        {selectedRequest.type && (
                          <div>
                            <span className="text-gray-500">Type:</span>
                            <p className="font-medium text-gray-900 mt-1">{selectedRequest.type}</p>
                          </div>
                        )}
                      </>
                    )}
                    <div>
                      <span className="text-gray-500">Requested by:</span>
                      <p className="font-medium text-gray-900">{selectedRequest.requested_by_name || 'N/A'}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Date:</span>
                      <p className="font-medium text-gray-900">
                        {new Date(selectedRequest.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Price Input (Only for approval) */}
                <div>
                  <label htmlFor="review_price" className="label-field">
                    Price (Per Piece) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    id="review_price"
                    step="0.01"
                    min="0.01"
                    value={reviewPrice}
                    onChange={(e) => {
                      setReviewPrice(e.target.value);
                      if (priceError) setPriceError('');
                    }}
                    className={`input-field ${priceError ? 'border-red-500' : ''}`}
                    placeholder="0.00"
                    required
                  />
                  {priceError && (
                    <p className="mt-1 text-sm text-red-600">{priceError}</p>
                  )}
                  <p className="mt-1 text-xs text-gray-500">
                    Enter the price per piece for this merchandise. This field is required for approval.
                  </p>
                </div>

                {/* Review Notes */}
                <div>
                  <label htmlFor="review_notes" className="label-field">
                    Notes (Optional for approval, Required for rejection)
                  </label>
                  <textarea
                    id="review_notes"
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    className="input-field min-h-[100px] resize-y"
                    placeholder="Add any notes or comments about this request..."
                    rows={4}
                  />
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 flex-shrink-0 bg-white rounded-b-lg">
              <button
                type="button"
                onClick={closeReviewModal}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleRejectRequest(selectedRequest.request_id, reviewNotes)}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                disabled={submitting}
              >
                {submitting ? 'Processing...' : 'Reject'}
              </button>
              <button
                type="button"
                onClick={() => handleApproveRequest(selectedRequest.request_id, reviewNotes, reviewPrice)}
                className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors"
                disabled={submitting}
              >
                {submitting ? 'Processing...' : 'Approve'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* View Request Details Modal (For Approved/Rejected Requests) */}
      {isViewModalOpen && selectedRequest && createPortal(
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4"
          onClick={closeViewModal}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0 bg-white rounded-t-lg">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                  Request Details
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  View details of {selectedRequest.status.toLowerCase()} merchandise request
                </p>
              </div>
              <button
                onClick={closeViewModal}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-1">
              <div className="space-y-4">
                {/* Request Details */}
                <div className="bg-gray-50 p-4 rounded-lg">
                  <h3 className="text-sm font-medium text-gray-700 mb-3">Request Details</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Merchandise:</span>
                      <p className="font-medium text-gray-900">{selectedRequest.merchandise_name}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Branch:</span>
                      <p className="font-medium text-gray-900">{selectedRequest.requested_branch_name || selectedRequest.branch_name || 'N/A'}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Size:</span>
                      <p className="font-medium text-gray-900">{selectedRequest.size || 'N/A'}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Quantity:</span>
                      <p className="font-medium text-gray-900">{selectedRequest.requested_quantity}</p>
                    </div>
                    {selectedRequest.merchandise_price && (
                      <div>
                        <span className="text-gray-500">Price (Per Piece):</span>
                        <p className="font-medium text-gray-900">
                          ₱{parseFloat(selectedRequest.merchandise_price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                      </div>
                    )}
                    <div className="col-span-2">
                      <span className="text-gray-500">Reason:</span>
                      <p className="font-medium text-gray-900 mt-1">{selectedRequest.request_reason}</p>
                    </div>
                    {(selectedRequest.gender || selectedRequest.type) && (
                      <>
                        {selectedRequest.gender && (
                          <div>
                            <span className="text-gray-500">Gender:</span>
                            <p className="font-medium text-gray-900 mt-1">{selectedRequest.gender}</p>
                          </div>
                        )}
                        {selectedRequest.type && (
                          <div>
                            <span className="text-gray-500">Type:</span>
                            <p className="font-medium text-gray-900 mt-1">{selectedRequest.type}</p>
                          </div>
                        )}
                      </>
                    )}
                    <div>
                      <span className="text-gray-500">Requested by:</span>
                      <p className="font-medium text-gray-900">{selectedRequest.requested_by_name || 'N/A'}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Date:</span>
                      <p className="font-medium text-gray-900">
                        {new Date(selectedRequest.created_at).toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500">Status:</span>
                      <div className="mt-1">
                        {getStatusBadge(selectedRequest.status)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Review Information (if reviewed) */}
                {(selectedRequest.status === 'Approved' || selectedRequest.status === 'Rejected') && (
                  <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                    <h3 className="text-sm font-medium text-gray-700 mb-3">Review Information</h3>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      {selectedRequest.reviewed_by_name && (
                        <div>
                          <span className="text-gray-500">Reviewed by:</span>
                          <p className="font-medium text-gray-900">{selectedRequest.reviewed_by_name}</p>
                        </div>
                      )}
                      {selectedRequest.reviewed_at && (
                        <div>
                          <span className="text-gray-500">Reviewed at:</span>
                          <p className="font-medium text-gray-900">
                            {new Date(selectedRequest.reviewed_at).toLocaleString()}
                          </p>
                        </div>
                      )}
                      {selectedRequest.review_notes && (
                        <div className="col-span-2">
                          <span className="text-gray-500">
                            {selectedRequest.status === 'Approved' ? 'Approval Notes:' : 'Rejection Reason:'}
                          </span>
                          <p className="font-medium text-gray-900 mt-1">{selectedRequest.review_notes}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 flex-shrink-0 bg-white rounded-b-lg">
              <button
                type="button"
                onClick={closeViewModal}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  // Show stocks view
  if (viewingStocksFor) {
    const stocks = getStocksByMerchandiseName(viewingStocksFor);
    const showSizeColumn = requiresSizingForMerchandise(viewingStocksFor);
    const showGenderTypeColumns =
      viewingStocksFor.toLowerCase().includes('uniform') ||
      stocks.some((s) => (s.gender && s.gender.trim() !== '') || (s.type && s.type.trim() !== ''));
    
    return (
      <div className="space-y-6">
        {/* Header with back button */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center space-x-4">
            <button
              onClick={handleBackToMerchandise}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
                Stocks: {viewingStocksFor}
              </h1>
              <p className="text-sm text-gray-500 mt-1">{selectedBranchName}</p>
            </div>
          </div>
          <button 
            onClick={openCreateModal}
            className="btn-primary flex items-center justify-center space-x-2 w-full sm:w-auto"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>Add Stocks</span>
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {/* Stocks Table */}
        <div className="bg-white rounded-lg shadow">
          <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
            <table
              className="divide-y divide-gray-200"
              style={{
                width: '100%',
                minWidth: showSizeColumn
                  ? (showGenderTypeColumns ? '1000px' : '800px')
                  : (showGenderTypeColumns ? '800px' : '650px'),
              }}
            >
              <thead className="bg-white">
                <tr>
                  {showSizeColumn && (
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Size
                    </th>
                  )}
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Quantity
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Price
                  </th>
                  {showGenderTypeColumns && (
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Gender
                    </th>
                  )}
                  {showGenderTypeColumns && (
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Type
                    </th>
                  )}
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-[#ffffff] divide-y divide-gray-200">
                {stocks.length > 0 ? (
                  stocks.map((stock) => (
                    <tr key={stock.merchandise_id}>
                      {showSizeColumn && (
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{stock.size || 'N/A'}</div>
                        </td>
                      )}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{stock.quantity}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {stock.price ? `₱${parseFloat(stock.price).toFixed(2)}` : '-'}
                        </div>
                      </td>
                      {showGenderTypeColumns && (
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{stock.gender || '-'}</div>
                        </td>
                      )}
                      {showGenderTypeColumns && (
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{stock.type || '-'}</div>
                        </td>
                      )}
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex items-center justify-end space-x-2">
                          <button
                            onClick={() => {
                              const item = merchandise.find(m => m.merchandise_id === stock.merchandise_id);
                              if (item) openEditModal(item);
                            }}
                            className="px-3 py-1 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(stock.merchandise_id)}
                            className="px-3 py-1 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={
                        (showSizeColumn ? 1 : 0) +
                        2 + // qty, price
                        (showGenderTypeColumns ? 2 : 0) +
                        1 // actions
                      }
                      className="px-6 py-4 text-center text-sm text-gray-500"
                    >
                      No stock information available for this merchandise type.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Create/Edit Merchandise Modal */}
        {renderModals()}
      </div>
    );
  }

  // Show merchandise items for selected branch
  if (selectedBranchId) {
    return (
      <div className="space-y-6">
        {/* Header with back button */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center space-x-4">
          <button
            onClick={handleBackToBranches}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Merchandise</h1>
            <p className="text-sm text-gray-500 mt-1">{selectedBranchName}</p>
          </div>
          </div>
          <button 
            onClick={() => {
              setEditingMerchandise(null);
              setError('');
              setRequiresSizing(false);
              setMerchandiseCategory('');
              setModalStep('category-selection');
              setSelectedBranch(branches.find(b => b.branch_id === selectedBranchId) || null);
              setFormData({
                merchandise_name: '',
                size: '',
                quantity: '',
                price: '',
                branch_id: selectedBranchId.toString(),
                gender: '',
                type: '',
                image_url: '',
              });
              setFormErrors({});
              setIsModalOpen(true);
            }}
            className="btn-primary flex items-center justify-center space-x-2 w-full sm:w-auto"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>Add Merchandise Type</span>
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {/* Merchandise Types List - Card Grid */}
        {getUniqueMerchandiseTypes().length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {getUniqueMerchandiseTypes().map((merchType) => (
              <div
                key={merchType.name}
                className="bg-white rounded-xl shadow-md hover:shadow-lg transition-shadow duration-200 border border-gray-200"
              >
                {/* Image Section - Fixed aspect ratio for consistent card sizes */}
                <div className="relative w-full aspect-square bg-gray-100 overflow-hidden">
                  {merchType.image_url ? (
                    <img
                      src={merchType.image_url}
                      alt={merchType.name}
                      className="absolute inset-0 w-full h-full object-cover object-center"
                      onError={(e) => {
                        // Fallback if image fails to load
                        e.target.style.display = 'none';
                        const placeholder = e.target.nextElementSibling;
                        if (placeholder) placeholder.style.display = 'flex';
                      }}
                    />
                  ) : null}
                  <div 
                    className={`absolute inset-0 w-full h-full flex items-center justify-center bg-gray-100 ${merchType.image_url ? 'hidden' : 'flex'}`}
                  >
                    <svg className="w-16 h-16 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                </div>

                {/* Content Section */}
                <div className="p-4 relative overflow-visible">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4 truncate" title={merchType.name}>
                    {merchType.name}
                  </h3>
                  
                  {/* Action Buttons */}
                  <div className="flex flex-col items-center space-y-2">
                    <button
                      onClick={() => handleViewStocks(merchType.name)}
                      className="w-full px-4 py-2 text-sm font-medium text-gray-900 bg-[#F7C844] hover:bg-[#F5B82E] rounded-lg transition-colors"
                    >
                      View Stocks
                    </button>
                    
                    {/* Action Menu Dropdown */}
                    <div className="relative z-50">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const button = e.currentTarget;
                          const rect = button.getBoundingClientRect();
                          
                          if (openMenuId === merchType.name) {
                            setOpenMenuId(null);
                            setMenuPosition({ top: undefined, bottom: undefined, right: undefined, left: undefined });
                          } else {
                            // Calculate available space
                            const viewportHeight = window.innerHeight;
                            const viewportWidth = window.innerWidth;
                            const spaceBelow = viewportHeight - rect.bottom;
                            const spaceAbove = rect.top;
                            const estimatedDropdownHeight = 100; // Approximate height for 2 menu items
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
                            if (spaceBelow >= estimatedDropdownHeight || spaceAbove >= estimatedDropdownHeight) {
                              // Align right edge with button right edge
                              right = viewportWidth - rect.right;
                              left = 'auto';
                            } else {
                              // If positioning is constrained, try to fit within viewport
                              right = viewportWidth - rect.right;
                              left = 'auto';
                            }
                            
                            setMenuPosition({
                              top: top !== 'auto' ? top : undefined,
                              bottom: bottom !== 'auto' ? bottom : undefined,
                              right: right !== 'auto' ? right : undefined,
                              left: left !== 'auto' ? left : undefined,
                            });
                            setOpenMenuId(merchType.name);
                          }
                        }}
                        className="px-3 py-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center justify-center"
                        title="More options"
                      >
                        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                          <circle cx="6" cy="12" r="1.5" />
                          <circle cx="12" cy="12" r="1.5" />
                          <circle cx="18" cy="12" r="1.5" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <p className="text-gray-500">
              No merchandise types found for this branch. Click "Add Merchandise Type" to create one.
            </p>
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
                {(() => {
                  // Get the merchandise type from getUniqueMerchandiseTypes
                  const uniqueTypes = getUniqueMerchandiseTypes();
                  const merchType = uniqueTypes.find(t => t.name === openMenuId);
                  
                  if (!merchType) return null;
                  
                  const merchTypeData = {
                    name: merchType.name,
                    image_url: merchType.image_url || null,
                  };
                  
                  return (
                    <>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuId(null);
                          setMenuPosition({ top: undefined, bottom: undefined, right: undefined, left: undefined });
                          openEditMerchandiseTypeModal(merchTypeData);
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center space-x-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuId(null);
                          setMenuPosition({ top: undefined, bottom: undefined, right: undefined, left: undefined });
                          handleDeleteMerchandiseType(openMenuId);
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center space-x-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        <span>Delete</span>
                      </button>
                    </>
                  );
                })()}
              </div>
            </div>
          </>,
          document.body
        )}

        {/* Modals */}
        {renderModals()}
                </div>
    );
  }

  // Main view: Show branches and requests tabs
  return (
                  <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Merchandise</h1>
                      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
                            <button
            onClick={() => setActiveTab('branches')}
            className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'branches'
                ? 'border-[#F7C844] text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Branches
                            </button>
                  <button
            onClick={() => setActiveTab('requests')}
            className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors flex items-center space-x-2 ${
              activeTab === 'requests'
                ? 'border-[#F7C844] text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <span>Stock Requests</span>
            {requests.filter(r => r.status === 'Pending').length > 0 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                {requests.filter(r => r.status === 'Pending').length}
                      </span>
                    )}
                  </button>
        </nav>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Tab Content */}
      {activeTab === 'branches' ? (
        <>
      {/* Branches List */}
      {branches.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-500">
            No branches found. Please add branches first.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow">
          {/* Desktop Table View */}
          <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
            <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '800px' }}>
              <thead className="bg-white">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Branch
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-[#ffffff] divide-y divide-gray-200">
                {branches.map((branch) => {
                  const formatted = formatBranchName(branch.branch_name);
                  return (
                    <tr key={branch.branch_id}>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-900">
                          <div className="font-medium whitespace-nowrap">{formatted.company}</div>
                          {formatted.location && (
                            <div className="text-gray-600 text-xs mt-0.5 whitespace-nowrap">{formatted.location}</div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{branch.branch_email || '-'}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${
                            branch.status === 'Active' || !branch.status
                              ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {branch.status || 'Active'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => handleViewMerch(branch.branch_id, branch.branch_name)}
                          className="px-4 py-2 text-sm font-medium text-gray-900 bg-[#F7C844] hover:bg-[#F5B82E] rounded-lg transition-colors"
                        >
                          View Merch
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
        </>
      ) : (
        <>
          {/* Requests List */}
          {requests.length > 0 ? (
            <div className="bg-white rounded-lg shadow">
              <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
                <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '1000px' }}>
                  <thead className="bg-white">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Merchandise
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Branch
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Date
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-[#ffffff] divide-y divide-gray-200">
                    {requests.map((request) => (
                      <tr key={request.request_id}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{request.merchandise_name}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{request.requested_branch_name || request.branch_name || 'N/A'}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{request.requested_by_name || 'N/A'}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {formatDateManila(request.created_at)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          {request.status === 'Pending' && (
              <button
                              onClick={() => openReviewModal(request)}
                              className="px-3 py-1 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                              Review
              </button>
                          )}
                          {(request.status === 'Approved' || request.status === 'Rejected') && (
                  <button
                              onClick={() => openViewModal(request)}
                              className="px-3 py-1 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                  >
                              View
                  </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                        </div>
                        </div>
                      ) : (
            <div className="bg-white rounded-lg shadow p-12 text-center">
              <p className="text-gray-500">
                No stock requests found. Admins can submit requests which will appear here.
              </p>
                      </div>
                    )}
                      </>
                    )}

      {/* Modals */}
      {renderModals()}
    </div>
  );
};

export default Merchandise;
