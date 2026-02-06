import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';

const Branch = () => {
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState(null);
  const [formData, setFormData] = useState({
    branch_name: '',
    branch_email: '',
    branch_address: '',
    branch_phone_number: '',
    status: 'Active',
    city: '',
    postal_code: '',
    business_registration_number: '',
    registered_tax_id: '',
    establishment_date: '',
    country: '',
    state_province_region: '',
    locale: '',
    currency: 'PHP',
  });
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });

  useEffect(() => {
    fetchBranches();
  }, []);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (openMenuId && !event.target.closest('.branch-action-menu-container') && !event.target.closest('.branch-action-menu-overlay')) {
        setOpenMenuId(null);
      }
    };

    if (openMenuId) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [openMenuId]);

  const handleMenuClick = (branchId, event) => {
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    
    if (openMenuId === branchId) {
      setOpenMenuId(null);
      setMenuPosition({ top: undefined, bottom: undefined, right: undefined, left: undefined });
    } else {
      // Calculate available space
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;
      const estimatedDropdownHeight = 100; // Approximate height for 2 menu items
      
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
      setOpenMenuId(branchId);
    }
  };

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

  const handleDelete = async (branchId) => {
    setOpenMenuId(null);
    if (!window.confirm('Are you sure you want to delete this branch?')) {
      return;
    }

    try {
      await apiRequest(`/branches/${branchId}`, {
        method: 'DELETE',
      });
      fetchBranches(); // Refresh the list
    } catch (err) {
      alert(err.message || 'Failed to delete branch');
    }
  };

  const openCreateModal = () => {
    setEditingBranch(null);
    setError('');
    setFormData({
      branch_name: '',
      branch_email: '',
      branch_address: '',
      branch_phone_number: '',
      status: 'Active',
      city: '',
      postal_code: '',
      business_registration_number: '',
      registered_tax_id: '',
      establishment_date: '',
      country: '',
      state_province_region: '',
      locale: '',
      currency: 'PHP',
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = (branch) => {
    setOpenMenuId(null);
    setEditingBranch(branch);
    setError('');
    setFormData({
      branch_name: branch.branch_name || '',
      branch_email: branch.branch_email || '',
      branch_address: branch.branch_address || '',
      branch_phone_number: branch.branch_phone_number || '',
      status: branch.status || 'Active',
      city: branch.city || '',
      postal_code: branch.postal_code || '',
      business_registration_number: branch.business_registration_number || '',
      registered_tax_id: branch.registered_tax_id || '',
      establishment_date: branch.establishment_date || '',
      country: branch.country || '',
      state_province_region: branch.state_province_region || '',
      locale: branch.locale || '',
      currency: branch.currency || 'PHP',
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingBranch(null);
    setFormErrors({});
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    // Clear error for this field
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
    
    if (!formData.branch_name.trim()) {
      errors.branch_name = 'Branch name is required';
    }

    if (!formData.branch_email.trim()) {
      errors.branch_email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.branch_email)) {
      errors.branch_email = 'Please enter a valid email address';
    }

    if (!formData.branch_address.trim()) {
      errors.branch_address = 'Address is required';
    }

    if (!formData.city.trim()) {
      errors.city = 'City is required';
    }

    if (!formData.state_province_region.trim()) {
      errors.state_province_region = 'State/Province/Region is required';
    }

    if (!formData.postal_code.trim()) {
      errors.postal_code = 'Postal code is required';
    }

    if (!formData.country.trim()) {
      errors.country = 'Country is required';
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
    try {
      const payload = { ...formData };
      
      if (editingBranch) {
        // Update existing branch
        await apiRequest(`/branches/${editingBranch.branch_id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        // Create new branch
        await apiRequest('/branches', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      
      closeModal();
      fetchBranches(); // Refresh the list
    } catch (err) {
      setError(err.message || `Failed to ${editingBranch ? 'update' : 'create'} branch`);
      console.error('Error saving branch:', err);
    } finally {
      setSubmitting(false);
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Branch</h1>
        <button 
          onClick={openCreateModal}
          className="btn-primary flex items-center justify-center space-x-2 w-full sm:w-auto"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>Create Branch</span>
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {branches.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-500">No branches found. Create your first branch to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {branches.map((branch) => (
            <div key={branch.branch_id} className="bg-white rounded-lg shadow-md p-6 relative">
              {/* 3-dots Action Menu Button */}
              <div className="absolute top-4 right-4 branch-action-menu-container">
                <button
                  onClick={(e) => handleMenuClick(branch.branch_id, e)}
                  className="p-2 rounded-full hover:bg-gray-100 transition-colors"
                >
                  <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                  </svg>
                </button>
              </div>

              {/* Branch Title */}
              <h3 className="text-lg font-semibold text-gray-900 mb-4 pr-12">
                {branch.branch_name}
              </h3>

              {/* Status Badge */}
              <div className="mb-4">
                <span
                  className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${
                    branch.status === 'Active'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {branch.status || 'Active'}
                </span>
              </div>

              {/* Branch Details */}
              <div className="space-y-3">
                {branch.branch_address && (
                  <div className="flex items-start space-x-3">
                    <svg className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <p className="text-sm text-gray-600 flex-1">{branch.branch_address}</p>
                  </div>
                )}

                {branch.city && (
                  <div className="flex items-start space-x-3">
                    <svg className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-sm text-gray-600 flex-1">
                      {branch.city}
                      {branch.state_province_region && `, ${branch.state_province_region}`}
                      {branch.country && `, ${branch.country}`}
                    </p>
                  </div>
                )}

                {branch.branch_phone_number && (
                  <div className="flex items-start space-x-3">
                    <svg className="w-5 h-5 text-pink-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                    <p className="text-sm text-gray-600 flex-1">{branch.branch_phone_number}</p>
                  </div>
                )}

                {branch.branch_email && (
                  <div className="flex items-start space-x-3">
                    <svg className="w-5 h-5 text-purple-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    <p className="text-sm text-gray-600 flex-1">{branch.branch_email}</p>
                  </div>
                )}

                {branch.currency && (
                  <div className="flex items-start space-x-3">
                    <svg className="w-5 h-5 text-orange-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-sm text-gray-600 flex-1">Currency: {branch.currency}</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Branch Modal */}
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
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                {editingBranch ? 'Edit Branch' : 'Create Branch'}
              </h2>
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
                <div className="space-y-6">
                  {/* Basic Information Section */}
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Basic Information</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="branch_name" className="label-field">
                        Branch Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        id="branch_name"
                        name="branch_name"
                        value={formData.branch_name}
                        onChange={handleInputChange}
                        className={`input-field ${formErrors.branch_name ? 'border-red-500' : ''}`}
                        required
                      />
                      {formErrors.branch_name && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.branch_name}</p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="branch_email" className="label-field">
                        Email <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="email"
                        id="branch_email"
                        name="branch_email"
                        value={formData.branch_email}
                        onChange={handleInputChange}
                        required
                        className={`input-field ${formErrors.branch_email ? 'border-red-500' : ''}`}
                      />
                      {formErrors.branch_email && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.branch_email}</p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="branch_phone_number" className="label-field">
                        Phone Number
                      </label>
                      <input
                        type="tel"
                        id="branch_phone_number"
                        name="branch_phone_number"
                        value={formData.branch_phone_number}
                        onChange={handleInputChange}
                        className="input-field"
                      />
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
                </div>

                {/* Address Information Section */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Address Information</h3>
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="branch_address" className="label-field">
                        Address <span className="text-red-500">*</span>
                      </label>
                      <textarea
                        id="branch_address"
                        name="branch_address"
                        value={formData.branch_address}
                        onChange={handleInputChange}
                        rows={3}
                        required
                        className={`input-field ${formErrors.branch_address ? 'border-red-500' : ''}`}
                      />
                      {formErrors.branch_address && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.branch_address}</p>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label htmlFor="city" className="label-field">
                          City <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          id="city"
                          name="city"
                          value={formData.city}
                          onChange={handleInputChange}
                          required
                          className={`input-field ${formErrors.city ? 'border-red-500' : ''}`}
                        />
                        {formErrors.city && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.city}</p>
                        )}
                      </div>

                      <div>
                        <label htmlFor="state_province_region" className="label-field">
                          State/Province/Region <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          id="state_province_region"
                          name="state_province_region"
                          value={formData.state_province_region}
                          onChange={handleInputChange}
                          required
                          className={`input-field ${formErrors.state_province_region ? 'border-red-500' : ''}`}
                        />
                        {formErrors.state_province_region && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.state_province_region}</p>
                        )}
                      </div>

                      <div>
                        <label htmlFor="postal_code" className="label-field">
                          Postal Code <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          id="postal_code"
                          name="postal_code"
                          value={formData.postal_code}
                          onChange={handleInputChange}
                          required
                          className={`input-field ${formErrors.postal_code ? 'border-red-500' : ''}`}
                        />
                        {formErrors.postal_code && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.postal_code}</p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="country" className="label-field">
                          Country <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          id="country"
                          name="country"
                          value={formData.country}
                          onChange={handleInputChange}
                          required
                          className={`input-field ${formErrors.country ? 'border-red-500' : ''}`}
                        />
                        {formErrors.country && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.country}</p>
                        )}
                      </div>

                      <div>
                        <label htmlFor="locale" className="label-field">
                          Locale
                        </label>
                        <input
                          type="text"
                          id="locale"
                          name="locale"
                          value={formData.locale}
                          onChange={handleInputChange}
                          placeholder="e.g., en-US, en-PH"
                          className="input-field"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Business Information Section */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Business Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="business_registration_number" className="label-field">
                        Business Registration Number
                      </label>
                      <input
                        type="text"
                        id="business_registration_number"
                        name="business_registration_number"
                        value={formData.business_registration_number}
                        onChange={handleInputChange}
                        className="input-field"
                      />
                    </div>

                    <div>
                      <label htmlFor="registered_tax_id" className="label-field">
                        Registered Tax ID
                      </label>
                      <input
                        type="text"
                        id="registered_tax_id"
                        name="registered_tax_id"
                        value={formData.registered_tax_id}
                        onChange={handleInputChange}
                        className="input-field"
                      />
                    </div>

                    <div>
                      <label htmlFor="establishment_date" className="label-field">
                        Establishment Date
                      </label>
                      <input
                        type="date"
                        id="establishment_date"
                        name="establishment_date"
                        value={formData.establishment_date}
                        onChange={handleInputChange}
                        className="input-field"
                      />
                    </div>

                    <div>
                      <label htmlFor="currency" className="label-field">
                        Currency
                      </label>
                      <select
                        id="currency"
                        name="currency"
                        value={formData.currency}
                        onChange={handleInputChange}
                        className="input-field"
                      >
                        <option value="PHP">PHP - Philippine Peso</option>
                        <option value="USD">USD - US Dollar</option>
                        <option value="EUR">EUR - Euro</option>
                        <option value="GBP">GBP - British Pound</option>
                      </select>
                    </div>
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
                  className="btn-primary px-4 py-2 text-sm font-medium"
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
                    editingBranch ? 'Update Branch' : 'Create Branch'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
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
                  const selectedBranch = branches.find(b => b.branch_id === openMenuId);
                  if (selectedBranch) {
                    setOpenMenuId(null);
                    setMenuPosition({ top: undefined, bottom: undefined, right: undefined, left: undefined });
                    openEditModal(selectedBranch);
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
    </div>
  );
};

export default Branch;

