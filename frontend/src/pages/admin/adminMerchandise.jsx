import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';
import MerchandiseImageUpload from '../../components/MerchandiseImageUploadS3';
import { useAuth } from '../../contexts/AuthContext';

const AdminMerchandise = () => {
  const { userInfo } = useAuth();
  // Get admin's branch_id from userInfo
  const adminBranchId = userInfo?.branch_id || userInfo?.branchId;
  // Removed branches state - admin only sees their branch
  const [merchandise, setMerchandise] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Admin always uses their branch
  const selectedBranchId = adminBranchId;
  const [selectedBranchName, setSelectedBranchName] = useState(userInfo?.branch_name || 'Your Branch');
  const [viewingStocksFor, setViewingStocksFor] = useState(null); // merchandise_name
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [isRequestingSpecificStock, setIsRequestingSpecificStock] = useState(false);
  const [modalStep, setModalStep] = useState('form'); // Removed branch-selection - admin only sees their branch
  // Removed selectedBranch - admin only sees their branch
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
  const [requestFormData, setRequestFormData] = useState({
    merchandise_name: '',
    size: '',
    requested_quantity: '',
    request_reason: '',
    gender: '',
    type: '',
  });
  const [editingMerchandiseType, setEditingMerchandiseType] = useState(null); // For editing merchandise type (not individual stock)
  const [formErrors, setFormErrors] = useState({});
  const [requestFormErrors, setRequestFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [requiresSizing, setRequiresSizing] = useState(false); // Toggle for uniform/sizing
  const [openMenuId, setOpenMenuId] = useState(null); // Track which merchandise type's menu is open
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const [activeTab, setActiveTab] = useState('inventory'); // 'inventory' or 'requests'

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
    // Don't fetch branches for admin - they only see their branch
    if (adminBranchId) {
      fetchMerchandiseByBranch(adminBranchId);
      fetchMerchandiseRequests();
    }
  }, [adminBranchId]);

  // Auto-set branch_id from adminBranchId when available
  useEffect(() => {
    if (adminBranchId && isModalOpen && !editingMerchandise && !editingMerchandiseType) {
      setFormData(prev => ({
        ...prev,
        branch_id: adminBranchId.toString(),
      }));
    }
  }, [adminBranchId, isModalOpen, editingMerchandise, editingMerchandiseType]);

  // Removed fetchBranches - admin only sees their branch

  const fetchMerchandiseByBranch = async (branchId) => {
    try {
      setLoading(true);
      // Fetch merchandise filtered by branch_id from backend
      const response = await apiRequest(`/merchandise?branch_id=${branchId}&limit=100`);
      setMerchandise(response.data || []);
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to fetch merchandise');
      console.error('Error fetching merchandise:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchMerchandiseRequests = async () => {
    try {
      const response = await apiRequest('/merchandise-requests');
      setRequests(response.data || []);
    } catch (err) {
      console.error('Error fetching merchandise requests:', err);
    }
  };

  // Removed handleViewMerch and handleBackToBranches - admin only sees their branch

  const handleViewStocks = (merchandiseName) => {
    setOpenMenuId(null);
    setViewingStocksFor(merchandiseName);
  };

  const handleBackToMerchandise = () => {
    setViewingStocksFor(null);
  };

  const handleDelete = async (merchandiseId) => {
    // Verify merchandise belongs to admin's branch
    const item = merchandise.find(m => m.merchandise_id === merchandiseId);
    if (item && item.branch_id !== adminBranchId) {
      alert('You can only delete merchandise from your branch.');
      return;
    }
    
    if (!window.confirm('Are you sure you want to delete this merchandise?')) {
      return;
    }

    try {
      await apiRequest(`/merchandise/${merchandiseId}`, {
        method: 'DELETE',
      });
      if (adminBranchId) {
        fetchMerchandiseByBranch(adminBranchId);
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
        item => item.branch_id === adminBranchId && 
                 item.merchandise_name === merchandiseName
      );

      // Delete all items
      for (const item of itemsToDelete) {
        await apiRequest(`/merchandise/${item.merchandise_id}`, {
          method: 'DELETE',
        });
      }

      // Refresh the merchandise list
      if (adminBranchId) {
        await fetchMerchandiseByBranch(adminBranchId);
      }
    } catch (err) {
      alert(err.message || 'Failed to delete merchandise type');
    }
  };

  const openCreateModal = () => {
    setEditingMerchandise(null);
    setError('');
    // If we're in stocks view, pre-fill merchandise_name and branch_id
    if (viewingStocksFor && adminBranchId) {
      // Check if this merchandise type requires sizing
      setRequiresSizing(requiresSizingForMerchandise(viewingStocksFor));
      setModalStep('form');
      setFormData({
        merchandise_name: viewingStocksFor,
        size: '',
        quantity: '',
        price: '',
        branch_id: adminBranchId.toString(),
        gender: '',
        type: '',
        image_url: '',
      });
      setEditingMerchandiseType(null);
    } else if (adminBranchId) {
      // If we're in merchandise types view, pre-fill branch_id
      setRequiresSizing(false);
      setModalStep('form');
      setFormData({
        merchandise_name: '',
        size: '',
        quantity: '',
        price: '',
        branch_id: adminBranchId.toString(),
        gender: '',
        type: '',
        image_url: '',
      });
      setEditingMerchandiseType(null);
    }
    setFormErrors({});
    setIsModalOpen(true);
  };

  // Open request modal from global "Request Stock" button
  const openRequestModal = (merchandiseDetails = null) => {
    setIsRequestModalOpen(true);
    const isSpecificRequest = Boolean(merchandiseDetails);
    setIsRequestingSpecificStock(isSpecificRequest);
    
    if (isSpecificRequest) {
      const { name, size, gender, type } = merchandiseDetails;
      setRequestFormData({
        merchandise_name: name,
        size: size || '',
        requested_quantity: '',
        request_reason: '',
        gender: gender || '',
        type: type || '',
      });
      setRequestFormErrors({});
    } else {
      // Reset form for general request
      setRequestFormData({
        merchandise_name: '',
        size: '',
        requested_quantity: '',
        request_reason: '',
        gender: '',
        type: '',
      });
      setRequestFormErrors({});
    }
  };

  const closeRequestModal = () => {
    setIsRequestModalOpen(false);
    setIsRequestingSpecificStock(false);
    setRequestFormData({
      merchandise_name: '',
      size: '',
      requested_quantity: '',
      request_reason: '',
      gender: '',
      type: '',
    });
    setRequestFormErrors({});
  };

  const openEditModal = (item) => {
    // Verify merchandise belongs to admin's branch
    if (item.branch_id !== adminBranchId) {
      alert('You can only edit merchandise from your branch.');
      return;
    }
    
    setEditingMerchandise(item);
    setEditingMerchandiseType(null);
    setError('');
    setModalStep('form');
    // Removed setSelectedBranch - admin only sees their branch
    setRequiresSizing(item.merchandise_name?.trim() === 'LCA Uniform' || !!item.size);
    setFormData({
      merchandise_name: item.merchandise_name || '',
      size: item.size || '',
      quantity: item.quantity?.toString() || '',
      price: item.price?.toString() || '',
      branch_id: item.branch_id ? item.branch_id.toString() : adminBranchId?.toString() || '',
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
    // Removed setSelectedBranch - admin only sees their branch
    // Get the first item of this type to get image_url
    const sampleItem = merchandise.find(
      item => item.branch_id === adminBranchId && 
               item.merchandise_name === merchType.name &&
               item.image_url
    ) || merchandise.find(
      item => item.branch_id === adminBranchId && 
               item.merchandise_name === merchType.name
    );
    
    setFormData({
      merchandise_name: merchType.name || '',
      size: '',
      quantity: '',
      price: '',
      branch_id: adminBranchId?.toString() || '',
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
    setModalStep('form'); // Removed branch-selection step
    // Removed setSelectedBranch - admin only sees their branch
    setFormErrors({});
    setRequiresSizing(false);
  };

  // Removed handleBranchSelect and handleBackToBranchSelection - admin only sees their branch

  // Get stocks for a specific merchandise name (filtered by branch and merchandise name)
  // Moved up for use in requiresSizingForMerchandise
  const getStocksByMerchandiseName = (merchandiseName) => {
    if (!adminBranchId || !merchandiseName) return [];
    
    // Filter merchandise by branch_id and merchandise_name
    const filteredStocks = merchandise.filter(
      (item) => item.branch_id === adminBranchId && 
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
  // Moved up for use in handleRequestInputChange
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

  const handleRequestInputChange = (e) => {
    const { name, value } = e.target;
    
    setRequestFormData((prev) => {
      const updated = {
        ...prev,
        [name]: value,
      };
      
      // When merchandise name changes, reset size, gender, and type if new type doesn't require them
      if (name === 'merchandise_name') {
        const requiresSizing = requiresSizingForMerchandise(value);
        const isUniform = value.toLowerCase().includes('uniform');
        
        // Reset size if new merchandise type doesn't require sizing
        if (!requiresSizing) {
          updated.size = '';
        }
        
        // Reset gender and type if not a uniform
        if (!isUniform) {
          updated.gender = '';
          updated.type = '';
        }
      }
      
      return updated;
    });
    
    if (requestFormErrors[name]) {
      setRequestFormErrors((prev) => {
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

  const validateRequestForm = () => {
    const errors = {};
    
    if (!requestFormData.merchandise_name.trim()) {
      errors.merchandise_name = 'Merchandise name is required';
    }

    // Check if merchandise requires sizing (not just uniforms, but any item type that has sizes)
    const requiresSizing = requiresSizingForMerchandise(requestFormData.merchandise_name);
    
    // Size is required for items that require sizing
    if (requiresSizing && !requestFormData.size.trim()) {
      errors.size = 'Size is required for this merchandise type';
    }

    // Gender and type are optional for uniforms (not strictly required)
    // but we validate if provided
    const isUniform = requestFormData.merchandise_name.toLowerCase().includes('uniform');

    if (!requestFormData.requested_quantity || parseInt(requestFormData.requested_quantity) <= 0) {
      errors.requested_quantity = 'Requested quantity must be greater than 0';
    }

    if (!requestFormData.request_reason.trim()) {
      errors.request_reason = 'Request reason is required';
    }

    setRequestFormErrors(errors);
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
        branch_id: adminBranchId || (formData.branch_id ? parseInt(formData.branch_id) : null),
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
          item => item.branch_id === adminBranchId && 
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
      if (adminBranchId) {
        await fetchMerchandiseByBranch(adminBranchId);
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

  const handleRequestSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateRequestForm()) {
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        merchandise_name: requestFormData.merchandise_name.trim(),
        size: requestFormData.size?.trim() || null,
        requested_quantity: parseInt(requestFormData.requested_quantity),
        request_reason: requestFormData.request_reason.trim(),
        gender: requestFormData.gender?.trim() || null,
        type: requestFormData.type?.trim() || null,
      };
      
      await apiRequest('/merchandise-requests', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      
      closeRequestModal();
      // Refresh requests
      await fetchMerchandiseRequests();
      
      // Show success message
      alert('Stock request submitted successfully! Superadmin will be notified.');
    } catch (err) {
      alert(err.message || 'Failed to submit stock request');
      console.error('Error submitting request:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelRequest = async (requestId) => {
    if (!window.confirm('Are you sure you want to cancel this request?')) {
      return;
    }

    try {
      await apiRequest(`/merchandise-requests/${requestId}/cancel`, {
        method: 'PUT',
      });
      
      // Refresh requests
      await fetchMerchandiseRequests();
      alert('Request cancelled successfully');
    } catch (err) {
      alert(err.message || 'Failed to cancel request');
    }
  };

  // Removed formatBranchName - admin only sees their branch

  // Get unique merchandise types for the selected branch with their images
  const getUniqueMerchandiseTypes = () => {
    if (!adminBranchId || !merchandise.length) return [];
    
    // Filter merchandise by branch_id
    const branchMerchandise = merchandise.filter(item => item.branch_id === adminBranchId && item.merchandise_name);
    
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


  const getStatusBadge = (status) => {
    const statusStyles = {
      Pending: 'bg-yellow-100 text-yellow-800',
      Approved: 'bg-green-100 text-green-800',
      Rejected: 'bg-red-100 text-red-800',
      Cancelled: 'bg-gray-100 text-gray-800',
    };
    
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyles[status] || 'bg-gray-100 text-gray-800'}`}>
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
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4"
            onClick={closeModal}
          >
            <div 
            className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0 bg-white rounded-t-lg">
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                  {editingMerchandiseType ? 'Edit Merchandise Image' : editingMerchandise ? 'Edit Stock' : viewingStocksFor ? 'Add Stock' : 'Add Merchandise Type'}
                  </h2>
                  {modalStep === 'form' && !editingMerchandise && (
                    <p className="text-sm text-gray-500 mt-1">
                      {editingMerchandiseType 
                        ? 'Update the image for this merchandise type' 
                        : viewingStocksFor 
                        ? 'Fill in the stock details for this merchandise type' 
                      : 'Fill in the details to create a new merchandise type for this branch'}
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

                    <div className="md:col-span-2">
                        <label htmlFor="branch_id" className="label-field">
                          Branch <span className="text-red-500">*</span>
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

                    {/* Only show these fields when adding/editing stock (not when adding merchandise type) */}
                    {(viewingStocksFor || editingMerchandise) && (
                      <>
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

                      {/* Gender and Type fields - only show for uniforms */}
                      {formData.merchandise_name && formData.merchandise_name.toLowerCase().includes('uniform') && (
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
                      </>
                    )}

                      {/* Image Upload - Show for merchandise type editing or when adding new merchandise type */}
                      {(editingMerchandiseType || (!editingMerchandise && !viewingStocksFor && adminBranchId)) && (
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
                      editingMerchandiseType 
                        ? 'Update Image' 
                        : editingMerchandise 
                        ? 'Update Stock' 
                        : 'Add Merchandise Type'
                    )}
                  </button>
                </div>
              </form>
          </div>
        </div>,
        document.body
      )}

      {/* Request Stock Modal */}
      {isRequestModalOpen && createPortal(
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4"
          onClick={closeRequestModal}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0 bg-white rounded-t-lg">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                  {isRequestingSpecificStock ? 'Request Additional Stock' : 'Request Merchandise Stock'}
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  {isRequestingSpecificStock 
                    ? 'Submit a request to add more stock to this specific item' 
                    : 'Submit a request to Superadmin for merchandise stock approval'}
                </p>
            </div>
              <button
                onClick={closeRequestModal}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
          </div>

            {/* Modal Body */}
            <form onSubmit={handleRequestSubmit} className="flex flex-col flex-1 overflow-hidden">
              <div className="p-6 overflow-y-auto flex-1">
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <label htmlFor="request_merchandise_name" className="label-field">
                        Merchandise Name <span className="text-red-500">*</span>
                      </label>
                      {isRequestingSpecificStock ? (
                        <>
                          <input
                            type="text"
                            id="request_merchandise_name"
                            name="merchandise_name"
                            value={requestFormData.merchandise_name}
                            className="input-field bg-gray-50 cursor-not-allowed"
                            readOnly
                          />
                          <p className="mt-1 text-xs text-gray-500">Merchandise name is pre-filled for this specific stock item</p>
                        </>
                      ) : (
                        <>
                          <select
                            id="request_merchandise_name"
                            name="merchandise_name"
                            value={requestFormData.merchandise_name}
                            onChange={handleRequestInputChange}
                            className={`input-field ${requestFormErrors.merchandise_name ? 'border-red-500' : ''}`}
                            required
                          >
                            <option value="">-- Select Merchandise Type --</option>
                            {getUniqueMerchandiseTypes().map((merchType) => (
                              <option key={merchType.name} value={merchType.name}>
                                {merchType.name}
                              </option>
                            ))}
                          </select>
                          <p className="mt-1 text-xs text-gray-500">Select the merchandise type you want to request stock for</p>
                        </>
                      )}
                      {requestFormErrors.merchandise_name && (
                        <p className="mt-1 text-sm text-red-600">{requestFormErrors.merchandise_name}</p>
                      )}
                    </div>

                    {/* Only show size field if merchandise type requires sizing */}
                    {((requestFormData.merchandise_name && requiresSizingForMerchandise(requestFormData.merchandise_name)) || isRequestingSpecificStock) && (
                      <div>
                        <label htmlFor="request_size" className="label-field">
                          Size <span className="text-red-500">*</span>
                        </label>
                        {isRequestingSpecificStock && requestFormData.size ? (
                          <>
                            <input
                              type="text"
                              value={requestFormData.size}
                              className="input-field bg-gray-50 cursor-not-allowed"
                              readOnly
                            />
                            <p className="mt-1 text-xs text-gray-500">Size is pre-filled for this specific stock item</p>
                          </>
                        ) : (
                          <>
                            <select
                              id="request_size"
                              name="size"
                              value={requestFormData.size}
                              onChange={handleRequestInputChange}
                              className={`input-field ${requestFormErrors.size ? 'border-red-500' : ''}`}
                              required={requiresSizingForMerchandise(requestFormData.merchandise_name)}
                            >
                              <option value="">Select Size</option>
                              <option value="Extra Small">Extra Small</option>
                              <option value="Small">Small</option>
                              <option value="Medium">Medium</option>
                              <option value="Large">Large</option>
                              <option value="Extra Large">Extra Large</option>
                            </select>
                            {requestFormErrors.size && (
                              <p className="mt-1 text-sm text-red-600">{requestFormErrors.size}</p>
                            )}
                            <p className="mt-1 text-xs text-gray-500">Size is required for this merchandise type</p>
                          </>
                        )}
                      </div>
                    )}

                    <div>
                      <label htmlFor="requested_quantity" className="label-field">
                        Requested Quantity <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="number"
                        min="1"
                        id="requested_quantity"
                        name="requested_quantity"
                        value={requestFormData.requested_quantity}
                        onChange={handleRequestInputChange}
                        className={`input-field ${requestFormErrors.requested_quantity ? 'border-red-500' : ''}`}
                        required
                        placeholder="0"
                      />
                      {requestFormErrors.requested_quantity && (
                        <p className="mt-1 text-sm text-red-600">{requestFormErrors.requested_quantity}</p>
                      )}
                    </div>

                    <div className="md:col-span-2">
                      <label htmlFor="request_reason" className="label-field">
                        Reason for Request <span className="text-red-500">*</span>
                      </label>
                      <textarea
                        id="request_reason"
                        name="request_reason"
                        value={requestFormData.request_reason}
                        onChange={handleRequestInputChange}
                        className={`input-field min-h-[100px] resize-y ${requestFormErrors.request_reason ? 'border-red-500' : ''}`}
                        required
                        placeholder="Please explain why you need this stock..."
                        rows={4}
                      />
                      {requestFormErrors.request_reason && (
                        <p className="mt-1 text-sm text-red-600">{requestFormErrors.request_reason}</p>
                      )}
                    </div>

                    {/* Gender and Type fields - only show for uniforms */}
                    {requestFormData.merchandise_name && requestFormData.merchandise_name.toLowerCase().includes('uniform') && (
                      <>
                        <div>
                          <label htmlFor="request_gender" className="label-field">
                            Gender
                          </label>
                          <select
                            id="request_gender"
                            name="gender"
                            value={requestFormData.gender}
                            onChange={handleRequestInputChange}
                            className={`input-field ${requestFormErrors.gender ? 'border-red-500' : ''} ${isRequestingSpecificStock ? 'bg-gray-50 cursor-not-allowed' : ''}`}
                            disabled={isRequestingSpecificStock}
                          >
                            <option value="">Select Gender</option>
                            <option value="Men">Men</option>
                            <option value="Women">Women</option>
                            <option value="Unisex">Unisex</option>
                          </select>
                          {requestFormErrors.gender && (
                            <p className="mt-1 text-sm text-red-600">{requestFormErrors.gender}</p>
                          )}
                        </div>

                        <div>
                          <label htmlFor="request_type" className="label-field">
                            Type
                          </label>
                          <select
                            id="request_type"
                            name="type"
                            value={requestFormData.type}
                            onChange={handleRequestInputChange}
                            className={`input-field ${requestFormErrors.type ? 'border-red-500' : ''} ${isRequestingSpecificStock ? 'bg-gray-50 cursor-not-allowed' : ''}`}
                            disabled={isRequestingSpecificStock}
                          >
                            <option value="">Select Type</option>
                            <option value="Top">Top</option>
                            <option value="Bottom">Bottom</option>
                          </select>
                          {requestFormErrors.type && (
                            <p className="mt-1 text-sm text-red-600">{requestFormErrors.type}</p>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 flex-shrink-0 bg-white rounded-b-lg">
                <button
                  type="button"
                  onClick={closeRequestModal}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                  disabled={submitting}
                >
                  {submitting ? (
                    <span className="flex items-center space-x-2">
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>Submitting...</span>
                    </span>
                  ) : (
                    'Submit Request'
                  )}
                </button>
              </div>
            </form>
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
            <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: showSizeColumn ? '800px' : '600px' }}>
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
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Gender
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Type
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
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{stock.gender || '-'}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{stock.type || '-'}</div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={showSizeColumn ? 5 : 4} className="px-6 py-4 text-center text-sm text-gray-500">
                      No stock information available for this merchandise type.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modals */}
        {renderModals()}
      </div>
    );
  }

  // Main view: Show merchandise types directly (admin only sees their branch)
  // If no branch ID, show loading or error
  if (!adminBranchId) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <p className="text-gray-500">Loading branch information...</p>
        </div>
      </div>
    );
  }

  // Show merchandise items for admin's branch directly
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Merchandise</h1>
          <p className="text-sm text-gray-500 mt-1">{selectedBranchName}</p>
        </div>
        {/* Request Stock Button - Upper Right */}
        <button 
          onClick={() => openRequestModal()}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors flex items-center justify-center space-x-2 shadow-md"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>Request Stock</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
        <button 
            onClick={() => setActiveTab('inventory')}
            className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'inventory'
                ? 'border-[#F7C844] text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Inventory
        </button>
          <button
            onClick={() => setActiveTab('requests')}
            className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors flex items-center space-x-2 ${
              activeTab === 'requests'
                ? 'border-[#F7C844] text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <span>My Requests</span>
            {requests.filter(r => r.status === 'Pending').length > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
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
      {activeTab === 'inventory' ? (
        <>
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
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-500">
            No merchandise types found for this branch.
          </p>
        </div>
      )}
        </>
                      ) : (
                        <>
          {/* Requests List */}
          {requests.length > 0 ? (
            <div className="bg-white rounded-lg shadow">
              <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
                <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '1200px' }}>
                  <thead className="bg-white">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Merchandise
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Size
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Quantity
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Reason
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Gender
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Type
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
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
                          <div className="text-sm text-gray-900">{request.size || 'N/A'}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{request.requested_quantity}</div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-900 max-w-xs truncate" title={request.request_reason}>
                            {request.request_reason}
                        </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{request.gender || '-'}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{request.type || '-'}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {getStatusBadge(request.status)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {new Date(request.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          {request.status === 'Pending' && (
                <button
                              onClick={() => handleCancelRequest(request.request_id)}
                              className="px-3 py-1 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                          )}
                          {request.status === 'Rejected' && request.review_notes && (
                <button
                              onClick={() => alert(`Rejection reason: ${request.review_notes}`)}
                              className="px-3 py-1 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                              View Notes
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
                No requests found. Click "Request Stock" to submit a request to Superadmin.
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

export default AdminMerchandise;
