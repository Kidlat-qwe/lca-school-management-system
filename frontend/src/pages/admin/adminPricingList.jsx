import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';

const AdminPricingList = () => {
  const { userInfo } = useAuth();
  // Get admin's branch_id from userInfo
  const adminBranchId = userInfo?.branch_id || userInfo?.branchId;
  const selectedBranchName = userInfo?.branch_name || 'Your Branch';
  const [pricingLists, setPricingLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nameSearchTerm, setNameSearchTerm] = useState('');
  // Removed filterBranch - admin only sees their branch
  const [filterLevelTag, setFilterLevelTag] = useState('');
  const [openMenuId, setOpenMenuId] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  // Removed openBranchDropdown - admin only sees their branch
  const [openLevelTagDropdown, setOpenLevelTagDropdown] = useState(false);
  const [levelTagDropdownRect, setLevelTagDropdownRect] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPricingList, setEditingPricingList] = useState(null);
  // Removed branches state - admin only sees their branch
  const [formData, setFormData] = useState({
    name: '',
    level_tag: '',
    price: '',
    branch_id: '',
  });
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

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
    fetchPricingLists();
    // Don't fetch branches for admin - they only see their branch
  }, []);

  // Auto-set branch_id from adminBranchId when available
  useEffect(() => {
    if (adminBranchId && isModalOpen && !editingPricingList) {
      setFormData(prev => ({
        ...prev,
        branch_id: adminBranchId.toString(),
      }));
    }
  }, [adminBranchId, isModalOpen, editingPricingList]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (openMenuId && !event.target.closest('.action-menu-container') && !event.target.closest('.action-menu-overlay')) {
        setOpenMenuId(null);
      }
      // Removed branch dropdown - admin only sees their branch
      if (openLevelTagDropdown && !event.target.closest('.leveltag-filter-dropdown') && !event.target.closest('.leveltag-filter-dropdown-portal')) {
        setOpenLevelTagDropdown(false);
        setLevelTagDropdownRect(null);
      }
    };

    if (openMenuId || openLevelTagDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [openMenuId, openLevelTagDropdown]);

  const handleMenuClick = (pricingListId, event) => {
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    
    if (openMenuId === pricingListId) {
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
        top = rect.bottom + 4;
        bottom = 'auto';
      } else if (spaceAbove >= estimatedDropdownHeight) {
        bottom = viewportHeight - rect.top + 4;
        top = 'auto';
      } else {
        if (spaceBelow > spaceAbove) {
          top = rect.bottom + 4;
          bottom = 'auto';
        } else {
          bottom = viewportHeight - rect.top + 4;
          top = 'auto';
        }
      }
      
      let right, left;
      right = viewportWidth - rect.right;
      left = 'auto';
      
      setMenuPosition({
        top: top !== 'auto' ? top : undefined,
        bottom: bottom !== 'auto' ? bottom : undefined,
        right: right !== 'auto' ? right : undefined,
        left: left !== 'auto' ? left : undefined,
      });
      setOpenMenuId(pricingListId);
    }
  };

  const fetchPricingLists = async () => {
    try {
      setLoading(true);
      // Filter by admin's branch
      const response = await apiRequest(`/pricinglists?branch_id=${adminBranchId}&limit=100`);
      setPricingLists(response.data || []);
    } catch (err) {
      setError(err.message || 'Failed to fetch pricing lists');
      console.error('Error fetching pricing lists:', err);
    } finally {
      setLoading(false);
    }
  };

  // Removed fetchBranches - admin only sees their branch

  const handleDelete = async (pricingListId) => {
    setOpenMenuId(null);
    
    // Verify pricing list belongs to admin's branch
    const pricingList = pricingLists.find(pl => pl.pricinglist_id === pricingListId);
    if (pricingList && pricingList.branch_id !== adminBranchId) {
      alert('You can only delete pricing lists from your branch.');
      return;
    }
    
    if (!window.confirm('Are you sure you want to delete this pricing list?')) {
      return;
    }

    try {
      await apiRequest(`/pricinglists/${pricingListId}`, {
        method: 'DELETE',
      });
      fetchPricingLists();
    } catch (err) {
      alert(err.message || 'Failed to delete pricing list');
    }
  };

  const openCreateModal = () => {
    setEditingPricingList(null);
    setError('');
    setFormData({
      name: '',
      level_tag: '',
      price: '',
      branch_id: adminBranchId ? adminBranchId.toString() : '',
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = (pricingList) => {
    setOpenMenuId(null);
    
    // Verify pricing list belongs to admin's branch
    if (pricingList.branch_id !== adminBranchId) {
      alert('You can only edit pricing lists from your branch.');
      return;
    }
    
    setEditingPricingList(pricingList);
    setError('');
    setFormData({
      name: pricingList.name || '',
      level_tag: pricingList.level_tag || '',
      price: pricingList.price?.toString() || '',
      branch_id: pricingList.branch_id?.toString() || '',
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingPricingList(null);
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

  const validateForm = () => {
    const errors = {};
    
    if (!formData.name.trim()) {
      errors.name = 'Name is required';
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
        name: formData.name.trim(),
        level_tag: formData.level_tag?.trim() || null,
        price: formData.price && formData.price !== '' ? parseFloat(formData.price) : null,
        branch_id: adminBranchId || (formData.branch_id && formData.branch_id !== '' ? parseInt(formData.branch_id) : null),
      };
      
      if (editingPricingList) {
        await apiRequest(`/pricinglists/${editingPricingList.pricinglist_id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await apiRequest('/pricinglists', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      
      closeModal();
      fetchPricingLists();
    } catch (err) {
      console.error('Error saving pricing list:', err);
      const errorMessage = err.response?.data?.errors 
        ? err.response.data.errors.map(e => e.msg).join(', ')
        : (err.response?.data?.message || err.message || `Failed to ${editingPricingList ? 'update' : 'create'} pricing list`);
      setError(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  // Helper functions
  // Removed getBranchName - admin only sees their branch

  // Removed getUniqueBranches - admin only sees their branch
  const getUniqueLevelTags = [...new Set(pricingLists.map(p => p.level_tag).filter(Boolean))].sort();

  const filteredPricingLists = pricingLists.filter((pricingList) => {
    const matchesSearch = !nameSearchTerm || 
      pricingList.name?.toLowerCase().includes(nameSearchTerm.toLowerCase()) ||
      pricingList.level_tag?.toLowerCase().includes(nameSearchTerm.toLowerCase());
    
    // Removed branch filter - admin only sees their branch
    const matchesLevelTag = !filterLevelTag || pricingList.level_tag === filterLevelTag;
    
    return matchesSearch && matchesLevelTag;
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
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Pricing Lists</h1>
        <button 
          onClick={openCreateModal}
          className="btn-primary flex items-center justify-center space-x-2 w-full sm:w-auto"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>Add Pricing List</span>
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Pricing Lists List */}
      {filteredPricingLists.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-500">
            {nameSearchTerm
              ? 'No pricing lists found matching your criteria.'
              : 'No pricing lists found. Add your first pricing list to get started.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow">
          {/* Table View - Horizontal Scroll on All Screens */}
          <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
            <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '750px', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '250px' }} />
                <col style={{ width: '200px' }} />
                <col style={{ width: '150px' }} />
                <col style={{ width: '100px' }} />
              </colgroup>
              <thead className="bg-white table-header-stable">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '250px', minWidth: '250px' }}>
                    <div className="flex flex-col space-y-2">
                      <div className="flex items-center space-x-1 min-h-[6px]">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${nameSearchTerm ? 'bg-primary-600' : 'invisible'}`} aria-hidden />
                      </div>
                      <div className="relative min-h-[28px]">
                        <input
                          type="text"
                          value={nameSearchTerm}
                          onChange={(e) => setNameSearchTerm(e.target.value)}
                          placeholder="Search pricing list..."
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
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '200px', minWidth: '200px' }}>
                    <div className="relative leveltag-filter-dropdown">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          setLevelTagDropdownRect(rect);
                          setOpenLevelTagDropdown(!openLevelTagDropdown);
                        }}
                        className="flex items-center space-x-1 hover:text-gray-700"
                      >
                        <span>Level Tag</span>
                        <span className={`inline-flex items-center justify-center w-1.5 h-1.5 rounded-full flex-shrink-0 ${filterLevelTag ? 'bg-primary-600' : 'invisible'}`} aria-hidden />
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                  </th>
                  {/* Removed Branch column - admin only sees their branch */}
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '150px', minWidth: '150px' }}>
                    Price
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '100px', minWidth: '100px' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-[#ffffff] divide-y divide-gray-200">
                {filteredPricingLists.map((pricingList) => (
                  <tr key={pricingList.pricinglist_id}>
                    <td className="px-6 py-4" style={{ maxWidth: '250px' }}>
                      <div className="text-sm font-medium text-gray-900 truncate" title={pricingList.name || '-'}>
                        {pricingList.name || '-'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {pricingList.level_tag || '-'}
                      </div>
                    </td>
                    {/* Removed Branch column - admin only sees their branch */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {pricingList.price !== null && pricingList.price !== undefined
                          ? `₱${parseFloat(pricingList.price).toFixed(2)}`
                          : '-'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="relative action-menu-container">
                        <button
                          onClick={(e) => handleMenuClick(pricingList.pricinglist_id, e)}
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
      {filteredPricingLists.length > 0 && (
        <div className="text-sm text-gray-500 text-center">
          Showing {filteredPricingLists.length} of {pricingLists.length} pricing lists
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
                  const selectedPricingList = filteredPricingLists.find(p => p.pricinglist_id === openMenuId);
                  if (selectedPricingList) {
                    setOpenMenuId(null);
                    setMenuPosition({ top: undefined, bottom: undefined, right: undefined, left: undefined });
                    openEditModal(selectedPricingList);
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

      {/* Level Tag filter dropdown - portaled to avoid table overflow clipping */}
      {openLevelTagDropdown && levelTagDropdownRect && createPortal(
        <div
          className="fixed leveltag-filter-dropdown-portal w-48 bg-white rounded-md shadow-lg z-[100] border border-gray-200 max-h-60 overflow-y-auto py-1"
          style={{
            top: `${levelTagDropdownRect.bottom + 4}px`,
            left: `${levelTagDropdownRect.left}px`,
            minWidth: `${Math.max(levelTagDropdownRect.width, 192)}px`,
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setFilterLevelTag('');
              setOpenLevelTagDropdown(false);
              setLevelTagDropdownRect(null);
            }}
            className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
              !filterLevelTag ? 'bg-gray-100 font-medium' : 'text-gray-700'
            }`}
          >
            All Level Tags
          </button>
          {getUniqueLevelTags.map((levelTag) => (
            <button
              key={levelTag}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setFilterLevelTag(levelTag);
                setOpenLevelTagDropdown(false);
                setLevelTagDropdownRect(null);
              }}
              className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
                filterLevelTag === levelTag ? 'bg-gray-100 font-medium' : 'text-gray-700'
              }`}
            >
              {levelTag}
            </button>
          ))}
        </div>,
        document.body
      )}

      {/* Create/Edit Pricing List Modal */}
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
                  {editingPricingList ? 'Edit Pricing List' : 'Create New Pricing List'}
                </h2>
                {!editingPricingList && (
                  <p className="text-sm text-gray-500 mt-1">Fill in the details to create a new pricing list</p>
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
                      <label htmlFor="name" className="label-field">
                        Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        id="name"
                        name="name"
                        value={formData.name}
                        onChange={handleInputChange}
                        className={`input-field ${formErrors.name ? 'border-red-500' : ''}`}
                        required
                        placeholder="e.g., Monthly Tuition, Registration Fee"
                      />
                      {formErrors.name && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.name}</p>
                      )}
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
                    editingPricingList ? 'Update Pricing List' : 'Create Pricing List'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default AdminPricingList;

