import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';

const AdminPersonnel = () => {
  const { signup, userInfo } = useAuth();
  const [personnel, setPersonnel] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [userSearchTerm, setUserSearchTerm] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [openMenuId, setOpenMenuId] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const [openRoleDropdown, setOpenRoleDropdown] = useState(false);
  const [roleDropdownRect, setRoleDropdownRect] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPersonnel, setEditingPersonnel] = useState(null);
  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    password: '',
    user_type: 'Teacher',
    phone_number: '',
    branch_id: '', // Will be auto-set to admin's branch
    level_tag: '',
    // Guardian fields
    guardian_name: '',
    guardian_email: '',
    guardian_relationship: '',
    guardian_phone_number: '',
    guardian_gender: '',
    guardian_address: '',
    guardian_city: '',
    guardian_postal_code: '',
    guardian_country: '',
    guardian_state_province_region: '',
  });
  const [existingGuardian, setExistingGuardian] = useState(null);
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  // Get admin's branch_id from userInfo
  const adminBranchId = userInfo?.branch_id || userInfo?.branchId;
  // Get current user's role to prevent creating Admin accounts
  const currentUserType = userInfo?.user_type || userInfo?.userType;

  useEffect(() => {
    fetchPersonnel();
  }, []);

  // Auto-set branch_id when adminBranchId is available
  useEffect(() => {
    if (adminBranchId && !editingPersonnel) {
      setFormData(prev => ({
        ...prev,
        branch_id: adminBranchId.toString(),
      }));
    }
  }, [adminBranchId, editingPersonnel]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (openMenuId && !event.target.closest('.action-menu-container') && !event.target.closest('.action-menu-overlay')) {
        setOpenMenuId(null);
      }
      if (openRoleDropdown && !event.target.closest('.role-filter-dropdown') && !event.target.closest('.role-filter-dropdown-portal')) {
        setOpenRoleDropdown(false);
        setRoleDropdownRect(null);
      }
    };

    if (openMenuId || openRoleDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [openMenuId, openRoleDropdown]);

  const handleMenuClick = (personId, event) => {
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    
    if (openMenuId === personId) {
      setOpenMenuId(null);
      setMenuPosition({ top: 0, right: 0 });
    } else {
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;
      const estimatedDropdownHeight = 100;
      
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
      setOpenMenuId(personId);
    }
  };

  const fetchPersonnel = async () => {
    try {
      setLoading(true);
      // Backend automatically filters by admin's branch
      const response = await apiRequest('/users');
      setPersonnel(response.data || []);
    } catch (err) {
      setError(err.message || 'Failed to fetch personnel');
      console.error('Error fetching personnel:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (userId) => {
    setOpenMenuId(null);
    
    // Verify personnel belongs to admin's branch
    const person = personnel.find(p => p.user_id === userId);
    if (person && person.branch_id !== adminBranchId) {
      alert('You can only delete personnel from your branch.');
      return;
    }
    
    if (!window.confirm('Are you sure you want to delete this personnel?')) {
      return;
    }

    try {
      await apiRequest(`/users/${userId}`, {
        method: 'DELETE',
      });
      fetchPersonnel();
    } catch (err) {
      alert(err.message || 'Failed to delete personnel');
    }
  };

  const openCreateModal = () => {
    setEditingPersonnel(null);
    setError('');
    setExistingGuardian(null);
    setFormData({
      full_name: '',
      email: '',
      password: '',
      user_type: 'Teacher',
      phone_number: '',
      branch_id: adminBranchId ? adminBranchId.toString() : '',
      level_tag: '',
      guardian_name: '',
      guardian_email: '',
      guardian_relationship: '',
      guardian_phone_number: '',
      guardian_gender: '',
      guardian_address: '',
      guardian_city: '',
      guardian_postal_code: '',
      guardian_country: '',
      guardian_state_province_region: '',
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = async (person) => {
    setOpenMenuId(null);
    
    // Verify personnel belongs to admin's branch
    if (person.branch_id !== adminBranchId) {
      alert('You can only edit personnel from your branch.');
      return;
    }
    
    // Prevent editing Admin users if current user is Admin
    if (currentUserType === 'Admin' && person.user_type === 'Admin') {
      alert('You cannot edit Admin accounts. Only Superadmin can edit Admin accounts.');
      return;
    }
    
    setEditingPersonnel(person);
    setError('');
    setExistingGuardian(null);
    
    setFormData({
      full_name: person.full_name || '',
      email: person.email || '',
      password: '',
      user_type: person.user_type || 'Teacher',
      phone_number: person.phone_number || '',
      branch_id: person.branch_id ? person.branch_id.toString() : adminBranchId ? adminBranchId.toString() : '',
      level_tag: person.level_tag || '',
      guardian_name: '',
      guardian_email: '',
      guardian_relationship: '',
      guardian_phone_number: '',
      guardian_gender: '',
      guardian_address: '',
      guardian_city: '',
      guardian_postal_code: '',
      guardian_country: '',
      guardian_state_province_region: '',
    });
    setFormErrors({});
    setIsModalOpen(true);

    // Fetch guardian data if user is a student
    if (person.user_type === 'Student') {
      try {
        const guardianResponse = await apiRequest(`/guardians/student/${person.user_id}`);
        if (guardianResponse.data && guardianResponse.data.length > 0) {
          const guardian = guardianResponse.data[0];
          setExistingGuardian(guardian);
          setFormData(prev => ({
            ...prev,
            guardian_name: guardian.guardian_name || '',
            guardian_email: guardian.email || '',
            guardian_relationship: guardian.relationship || '',
            guardian_phone_number: guardian.guardian_phone_number || '',
            guardian_gender: guardian.gender || '',
            guardian_address: guardian.address || '',
            guardian_city: guardian.city || '',
            guardian_postal_code: guardian.postal_code || '',
            guardian_country: guardian.country || '',
            guardian_state_province_region: guardian.state_province_region || '',
          }));
        }
      } catch (err) {
        console.error('Error fetching guardian:', err);
      }
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingPersonnel(null);
    setExistingGuardian(null);
    setFormErrors({});
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => {
      const updated = {
        ...prev,
        [name]: value,
      };
      if (name === 'user_type' && value !== 'Student') {
        updated.level_tag = '';
        updated.guardian_name = '';
        updated.guardian_email = '';
        updated.guardian_relationship = '';
        updated.guardian_phone_number = '';
        updated.guardian_gender = '';
        updated.guardian_address = '';
        updated.guardian_city = '';
        updated.guardian_postal_code = '';
        updated.guardian_country = '';
        updated.guardian_state_province_region = '';
        setExistingGuardian(null);
      }
      return updated;
    });
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
    
    if (!formData.full_name.trim()) {
      errors.full_name = 'Full name is required';
    }
    
    if (!formData.email.trim()) {
      errors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = 'Please enter a valid email address';
    }

    if (!editingPersonnel && !formData.password.trim()) {
      errors.password = 'Password is required';
    } else if (!editingPersonnel && formData.password.length < 6) {
      errors.password = 'Password must be at least 6 characters';
    }

    if (formData.user_type === 'Student' && !formData.level_tag.trim()) {
      errors.level_tag = 'Level tag is required for students';
    }

    if (formData.user_type === 'Student' && !formData.guardian_name.trim()) {
      errors.guardian_name = 'Guardian name is required for students';
    }

    if (formData.user_type === 'Student' && formData.guardian_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.guardian_email)) {
      errors.guardian_email = 'Please enter a valid guardian email address';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    // Ensure branch_id is set to admin's branch
    const finalBranchId = adminBranchId || (formData.branch_id ? parseInt(formData.branch_id) : null);

    // Prevent creating Admin accounts if current user is Admin
    if (currentUserType === 'Admin' && formData.user_type === 'Admin' && !editingPersonnel) {
      setError('You cannot create Admin accounts. Only Superadmin can create Admin accounts.');
      return;
    }

    setSubmitting(true);
    try {
      if (editingPersonnel) {
        // Prevent changing role to Admin if current user is Admin
        if (currentUserType === 'Admin' && formData.user_type === 'Admin' && editingPersonnel.user_type !== 'Admin') {
          setError('You cannot change a user\'s role to Admin. Only Superadmin can assign Admin role.');
          setSubmitting(false);
          return;
        }
        const payload = {
          email: formData.email.trim(),
          full_name: formData.full_name.trim(),
          user_type: formData.user_type,
        };
        
        if (formData.phone_number && formData.phone_number.trim()) {
          payload.phone_number = formData.phone_number.trim();
        }
        
        payload.branch_id = finalBranchId;
        payload.level_tag = formData.level_tag && formData.level_tag.trim() 
          ? formData.level_tag.trim() 
          : null;
        
        await apiRequest(`/users/${editingPersonnel.user_id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });

        // Update or create guardian if user is a student
        if (formData.user_type === 'Student' && formData.guardian_name.trim()) {
          try {
            if (existingGuardian && existingGuardian.guardian_id) {
              await apiRequest(`/guardians/${existingGuardian.guardian_id}`, {
                method: 'PUT',
                body: JSON.stringify({
                  guardian_name: formData.guardian_name.trim(),
                  email: formData.guardian_email?.trim() || null,
                  relationship: formData.guardian_relationship?.trim() || null,
                  guardian_phone_number: formData.guardian_phone_number?.trim() || null,
                  gender: formData.guardian_gender || null,
                  address: formData.guardian_address?.trim() || null,
                  city: formData.guardian_city?.trim() || null,
                  postal_code: formData.guardian_postal_code?.trim() || null,
                  country: formData.guardian_country?.trim() || null,
                  state_province_region: formData.guardian_state_province_region?.trim() || null,
                }),
              });
            } else {
              await apiRequest('/guardians', {
                method: 'POST',
                body: JSON.stringify({
                  student_id: editingPersonnel.user_id,
                  guardian_name: formData.guardian_name.trim(),
                  email: formData.guardian_email?.trim() || null,
                  relationship: formData.guardian_relationship?.trim() || null,
                  guardian_phone_number: formData.guardian_phone_number?.trim() || null,
                  gender: formData.guardian_gender || null,
                  address: formData.guardian_address?.trim() || null,
                  city: formData.guardian_city?.trim() || null,
                  postal_code: formData.guardian_postal_code?.trim() || null,
                  country: formData.guardian_country?.trim() || null,
                  state_province_region: formData.guardian_state_province_region?.trim() || null,
                }),
              });
            }
          } catch (guardianErr) {
            console.error('Error saving guardian:', guardianErr);
            setError(prev => prev ? `${prev}. Guardian save failed: ${guardianErr.message}` : `Guardian save failed: ${guardianErr.message}`);
          }
        }
      } else {
        const userData = {
          full_name: formData.full_name.trim(),
          user_type: formData.user_type,
          phone_number: formData.phone_number || null,
          branch_id: finalBranchId,
          level_tag: formData.user_type === 'Student' ? (formData.level_tag || null) : null,
        };
        
        const result = await signup(formData.email, formData.password, userData, false);

        if (formData.user_type === 'Student' && formData.guardian_name.trim() && result.user?.user_id) {
          try {
            await apiRequest('/guardians', {
              method: 'POST',
              body: JSON.stringify({
                student_id: result.user.user_id,
                guardian_name: formData.guardian_name.trim(),
                email: formData.guardian_email?.trim() || null,
                relationship: formData.guardian_relationship?.trim() || null,
                guardian_phone_number: formData.guardian_phone_number?.trim() || null,
                gender: formData.guardian_gender || null,
                address: formData.guardian_address?.trim() || null,
                city: formData.guardian_city?.trim() || null,
                postal_code: formData.guardian_postal_code?.trim() || null,
                country: formData.guardian_country?.trim() || null,
                state_province_region: formData.guardian_state_province_region?.trim() || null,
              }),
            });
          } catch (guardianErr) {
            console.error('Error creating guardian:', guardianErr);
            setError(prev => prev ? `${prev}. Guardian creation failed: ${guardianErr.message}` : `Guardian creation failed: ${guardianErr.message}`);
          }
        }
      }
      
      closeModal();
      fetchPersonnel();
    } catch (err) {
      console.error('Error saving personnel:', err);
      let errorMessage = err.message || `Failed to ${editingPersonnel ? 'update' : 'create'} personnel`;
      
      if (err.response?.data?.errors && Array.isArray(err.response.data.errors)) {
        const validationErrors = err.response.data.errors.map(e => {
          const fieldName = e.param || e.field || 'field';
          const message = e.msg || e.message || 'Invalid value';
          return `${fieldName}: ${message}`;
        }).join(', ');
        errorMessage = `Validation failed: ${validationErrors}`;
      } else if (err.response?.data?.message) {
        errorMessage = err.response.data.message;
      }
      
      setError(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  // Helper function to get display role (Finance with no branch = Superfinance)
  const getDisplayRole = (person) => {
    const userType = person.user_type;
    const branchId = person.branch_id;
    
    // If Finance role with no branch_id, display as Superfinance
    if (userType === 'Finance' && (branchId === null || branchId === undefined)) {
      return 'Superfinance';
    }
    return userType;
  };

  // Get unique roles and branches for filter dropdowns
  // Use display roles (Finance with no branch = Superfinance)
  // Exclude Student role since students have their own page
  const uniqueRoles = [...new Set(personnel.filter(p => p.user_type !== 'Student').map(p => getDisplayRole(p)).filter(Boolean))];

  const filteredPersonnel = personnel.filter((person) => {
    // Exclude students - they have their own page
    if (person.user_type === 'Student') {
      return false;
    }
    
    const matchesUserSearch = !userSearchTerm || 
      person.full_name?.toLowerCase().includes(userSearchTerm.toLowerCase());
    // Use display role for filtering
    const displayRole = getDisplayRole(person);
    const matchesRole = !filterRole || displayRole === filterRole;
    return matchesUserSearch && matchesRole;
  });

  const getUserTypeBadgeColor = (userType) => {
    const colors = {
      Superadmin: 'bg-brown-100 text-brown-800',
      Superfinance: 'bg-purple-100 text-purple-800',
      Admin: 'bg-primary-100 text-primary-800',
      Finance: 'bg-green-100 text-green-800',
      Teacher: 'bg-yellow-100 text-yellow-800',
      Student: 'bg-gray-100 text-gray-800',
    };
    return colors[userType] || 'bg-gray-100 text-gray-800';
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
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Personnel</h1>
          <p className="text-sm text-gray-600">Manage personnel for your branch</p>
        </div>
        <button 
          onClick={openCreateModal}
          className="btn-primary flex items-center justify-center space-x-2 w-full sm:w-auto"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>Add Personnel</span>
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {filteredPersonnel.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-500">
            {userSearchTerm || filterRole
              ? 'No personnel found matching your criteria.'
              : 'No personnel found. Add your first personnel member to get started.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow">
          <div
            className="overflow-x-auto rounded-lg"
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: '#cbd5e0 #f7fafc',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            <table
              className="divide-y divide-gray-200"
              style={{ width: '100%', minWidth: '800px', tableLayout: 'fixed' }}
            >
              <colgroup>
                <col style={{ width: '200px' }} />
                <col style={{ width: '200px' }} />
                <col style={{ width: '120px' }} />
                <col style={{ width: '100px' }} />
                <col style={{ width: '130px' }} />
                <col style={{ width: '50px' }} />
              </colgroup>
              <thead className="bg-white table-header-stable">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '200px', minWidth: '200px' }}>
                    <div className="flex flex-col space-y-2">
                      <div className="flex items-center space-x-1 min-h-[6px]">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${userSearchTerm ? 'bg-primary-600' : 'invisible'}`} aria-hidden />
                      </div>
                      <div className="relative min-h-[28px]">
                        <input
                          type="text"
                          value={userSearchTerm}
                          onChange={(e) => setUserSearchTerm(e.target.value)}
                          placeholder="Search user..."
                          className="px-2 py-1 pr-6 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 w-full"
                          onClick={(e) => e.stopPropagation()}
                        />
                        {userSearchTerm && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setUserSearchTerm('');
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
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '200px', minWidth: '200px' }}>
                    Email
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '120px', minWidth: '120px' }}>
                    <div className="relative role-filter-dropdown">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          setRoleDropdownRect(rect);
                          setOpenRoleDropdown(!openRoleDropdown);
                        }}
                        className="flex items-center space-x-1 hover:text-gray-700"
                      >
                        <span>Role</span>
                        <span className={`inline-flex items-center justify-center w-1.5 h-1.5 rounded-full flex-shrink-0 ${filterRole ? 'bg-primary-600' : 'invisible'}`} aria-hidden />
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '100px', minWidth: '100px' }}>
                    Status
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '130px', minWidth: '130px' }}>
                    Last Login
                  </th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '50px', minWidth: '50px' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-[#ffffff] divide-y divide-gray-200">
                {filteredPersonnel.map((person) => (
                  <tr key={person.user_id}>
                    <td className="px-3 py-4">
                      <div className="flex items-center min-w-0">
                        <div className="h-8 w-8 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                          {person.profile_picture_url ? (
                            <img
                              src={person.profile_picture_url}
                              alt={person.full_name}
                              className="h-8 w-8 rounded-full object-cover"
                            />
                          ) : (
                            <span className="text-primary-600 font-semibold text-xs">
                              {person.full_name?.charAt(0).toUpperCase() || '-'}
                            </span>
                          )}
                        </div>
                        <div className="ml-2 min-w-0 flex-1">
                          <div className="text-sm font-medium text-gray-900 truncate" title={person.full_name || '-'}>
                            {person.full_name || '-'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-4">
                      <div className="text-sm text-gray-900 truncate" title={person.email || '-'}>
                        {person.email || '-'}
                      </div>
                    </td>
                    <td className="px-3 py-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getUserTypeBadgeColor(
                          getDisplayRole(person)
                        )}`}
                      >
                        {getDisplayRole(person) || '-'}
                      </span>
                    </td>
                    <td className="px-3 py-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          person.status === 'Active' || !person.status
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {person.status || 'Active'}
                      </span>
                    </td>
                    <td className="px-3 py-4">
                      <div className="text-sm text-gray-900">
                        {person.last_login
                          ? (() => {
                              // Parse timestamp string (format: YYYY-MM-DD HH24:MI:SS) as Philippines time
                              const dateStr = person.last_login;
                              // Convert PostgreSQL timestamp format to ISO format with timezone
                              const isoStr = dateStr.replace(' ', 'T') + '+08:00';
                              const date = new Date(isoStr);
                              
                              // Format date: DD/MM/YYYY
                              const formattedDate = date.toLocaleDateString('en-GB', {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                timeZone: 'Asia/Manila',
                              });
                              
                              // Format time: HH:MMam/pm
                              const formattedTime = date.toLocaleTimeString('en-US', {
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: true,
                                timeZone: 'Asia/Manila',
                              }).toLowerCase();
                              
                              return (
                                <div className="flex flex-col">
                                  <span>{formattedDate}</span>
                                  <span>{formattedTime}</span>
                                </div>
                              );
                            })()
                          : '-'}
                      </div>
                    </td>
                    <td className="px-3 py-4 text-right text-sm font-medium">
                      <div className="relative action-menu-container">
                        <button
                          onClick={(e) => handleMenuClick(person.user_id, e)}
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

      {filteredPersonnel.length > 0 && (
        <div className="text-sm text-gray-500 text-center">
          Showing {filteredPersonnel.length} of {personnel.length} personnel
        </div>
      )}

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
            className="fixed action-menu-overlay bg-white rounded-md shadow-lg z-50 border border-gray-200 w-48"
            style={{
              ...(menuPosition.top !== undefined && { top: `${menuPosition.top}px` }),
              ...(menuPosition.bottom !== undefined && { bottom: `${menuPosition.bottom}px` }),
              ...(menuPosition.right !== undefined && { right: `${menuPosition.right}px` }),
              ...(menuPosition.left !== undefined && { left: `${menuPosition.left}px` }),
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="py-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const selectedPerson = filteredPersonnel.find(p => p.user_id === openMenuId);
                  if (selectedPerson) {
                    setOpenMenuId(null);
                    setMenuPosition({ top: 0, right: 0 });
                    openEditModal(selectedPerson);
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

      {/* Role filter dropdown - portaled to avoid table overflow clipping */}
      {openRoleDropdown && roleDropdownRect && createPortal(
        <div
          className="fixed role-filter-dropdown-portal w-40 bg-white rounded-md shadow-lg z-[100] border border-gray-200 max-h-60 overflow-y-auto py-1"
          style={{
            top: `${roleDropdownRect.bottom + 4}px`,
            left: `${roleDropdownRect.left}px`,
            minWidth: `${Math.max(roleDropdownRect.width, 160)}px`,
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setFilterRole('');
              setOpenRoleDropdown(false);
              setRoleDropdownRect(null);
            }}
            className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
              !filterRole ? 'bg-gray-100 font-medium' : 'text-gray-700'
            }`}
          >
            All Roles
          </button>
          {uniqueRoles.map((role) => (
            <button
              key={role}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setFilterRole(role);
                setOpenRoleDropdown(false);
                setRoleDropdownRect(null);
              }}
              className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
                filterRole === role ? 'bg-gray-100 font-medium' : 'text-gray-700'
              }`}
            >
              {role}
            </button>
          ))}
        </div>,
        document.body
      )}

      {isModalOpen && createPortal(
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4"
          onClick={closeModal}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0 bg-white rounded-t-lg">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                  {editingPersonnel ? 'Edit Personnel' : 'Create New User'}
                </h2>
                {!editingPersonnel && (
                  <p className="text-sm text-gray-500 mt-1">Fill in the details to create a new user for your branch</p>
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

            <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
              <div className="p-6 overflow-y-auto flex-1">
                {error && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                    {error}
                  </div>
                )}
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="full_name" className="label-field">
                        Full Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        id="full_name"
                        name="full_name"
                        value={formData.full_name}
                        onChange={handleInputChange}
                        className={`input-field ${formErrors.full_name ? 'border-red-500' : ''}`}
                        required
                      />
                      {formErrors.full_name && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.full_name}</p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="email" className="label-field">
                        Email <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="email"
                        id="email"
                        name="email"
                        value={formData.email}
                        onChange={handleInputChange}
                        className={`input-field ${formErrors.email ? 'border-red-500' : ''}`}
                        required
                      />
                      {formErrors.email && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.email}</p>
                      )}
                    </div>

                    {!editingPersonnel && (
                      <div>
                        <label htmlFor="password" className="label-field">
                          Password <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="password"
                          id="password"
                          name="password"
                          value={formData.password}
                          onChange={handleInputChange}
                          className={`input-field ${formErrors.password ? 'border-red-500' : ''}`}
                          required={!editingPersonnel}
                        />
                        {formErrors.password && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.password}</p>
                        )}
                      </div>
                    )}

                    <div>
                      <label htmlFor="phone_number" className="label-field">
                        Phone
                      </label>
                      <input
                        type="tel"
                        id="phone_number"
                        name="phone_number"
                        value={formData.phone_number}
                        onChange={handleInputChange}
                        className="input-field"
                        placeholder="e.g., +639123456789"
                      />
                    </div>

                    <div>
                      <label htmlFor="user_type" className="label-field">
                        Role <span className="text-red-500">*</span>
                      </label>
                      <select
                        id="user_type"
                        name="user_type"
                        value={formData.user_type}
                        onChange={handleInputChange}
                        className="input-field"
                        required
                        disabled={editingPersonnel && editingPersonnel.user_type === 'Admin'}
                      >
                        <option value="Teacher">Teacher</option>
                        <option value="Finance">Finance</option>
                        {currentUserType !== 'Admin' && (
                          <option value="Admin">Admin</option>
                        )}
                      </select>
                      {editingPersonnel && editingPersonnel.user_type === 'Admin' && (
                        <p className="mt-1 text-xs text-gray-500">
                          Admin role cannot be changed
                        </p>
                      )}
                      {currentUserType === 'Admin' && !editingPersonnel && (
                        <p className="mt-1 text-xs text-gray-500">
                          You cannot create Admin accounts
                        </p>
                      )}
                    </div>

                    {formData.user_type === 'Student' && (
                      <div>
                        <label htmlFor="level_tag" className="label-field">
                          Level Tag <span className="text-red-500">*</span>
                        </label>
                        <select
                          id="level_tag"
                          name="level_tag"
                          value={formData.level_tag}
                          onChange={handleInputChange}
                          className={`input-field ${formErrors.level_tag ? 'border-red-500' : ''}`}
                          required={formData.user_type === 'Student'}
                        >
                          <option value="">Select Level Tag</option>
                          <option value="Playgroup">Playgroup</option>
                          <option value="Nursery">Nursery</option>
                          <option value="Pre-Kindergarten">Pre-Kindergarten</option>
                          <option value="Kindergarten">Kindergarten</option>
                          <option value="Grade School">Grade School</option>
                        </select>
                        {formErrors.level_tag && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.level_tag}</p>
                        )}
                      </div>
                    )}
                  </div>

                  {formData.user_type === 'Student' && (
                    <div className="mt-6 pt-6 border-t border-gray-200">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">Guardian Information</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                          <label htmlFor="guardian_name" className="label-field">
                            Guardian Name <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            id="guardian_name"
                            name="guardian_name"
                            value={formData.guardian_name}
                            onChange={handleInputChange}
                            className={`input-field ${formErrors.guardian_name ? 'border-red-500' : ''}`}
                            required={formData.user_type === 'Student'}
                            placeholder="Full name of guardian"
                          />
                          {formErrors.guardian_name && (
                            <p className="mt-1 text-sm text-red-600">{formErrors.guardian_name}</p>
                          )}
                        </div>

                        <div>
                          <label htmlFor="guardian_email" className="label-field">
                            Guardian Email
                          </label>
                          <input
                            type="email"
                            id="guardian_email"
                            name="guardian_email"
                            value={formData.guardian_email}
                            onChange={handleInputChange}
                            className={`input-field ${formErrors.guardian_email ? 'border-red-500' : ''}`}
                            placeholder="guardian@example.com"
                          />
                          {formErrors.guardian_email && (
                            <p className="mt-1 text-sm text-red-600">{formErrors.guardian_email}</p>
                          )}
                        </div>

                        <div>
                          <label htmlFor="guardian_relationship" className="label-field">
                            Relationship
                          </label>
                          <select
                            id="guardian_relationship"
                            name="guardian_relationship"
                            value={formData.guardian_relationship}
                            onChange={handleInputChange}
                            className="input-field"
                          >
                            <option value="">Select Relationship</option>
                            <option value="Parent">Parent</option>
                            <option value="Guardian">Guardian</option>
                            <option value="Grandparent">Grandparent</option>
                            <option value="Sibling">Sibling</option>
                            <option value="Other">Other</option>
                          </select>
                        </div>

                        <div>
                          <label htmlFor="guardian_phone_number" className="label-field">
                            Guardian Phone Number
                          </label>
                          <input
                            type="tel"
                            id="guardian_phone_number"
                            name="guardian_phone_number"
                            value={formData.guardian_phone_number}
                            onChange={handleInputChange}
                            className="input-field"
                            placeholder="e.g., +639123456789"
                          />
                        </div>

                        <div>
                          <label htmlFor="guardian_gender" className="label-field">
                            Guardian Gender
                          </label>
                          <select
                            id="guardian_gender"
                            name="guardian_gender"
                            value={formData.guardian_gender}
                            onChange={handleInputChange}
                            className="input-field"
                          >
                            <option value="">Select Gender</option>
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                            <option value="Other">Other</option>
                          </select>
                        </div>

                        <div className="md:col-span-2">
                          <label htmlFor="guardian_address" className="label-field">
                            Address
                          </label>
                          <textarea
                            id="guardian_address"
                            name="guardian_address"
                            value={formData.guardian_address}
                            onChange={handleInputChange}
                            className="input-field"
                            rows="2"
                            placeholder="Street address"
                          />
                        </div>

                        <div>
                          <label htmlFor="guardian_city" className="label-field">
                            City
                          </label>
                          <input
                            type="text"
                            id="guardian_city"
                            name="guardian_city"
                            value={formData.guardian_city}
                            onChange={handleInputChange}
                            className="input-field"
                            placeholder="City"
                          />
                        </div>

                        <div>
                          <label htmlFor="guardian_postal_code" className="label-field">
                            Postal Code
                          </label>
                          <input
                            type="text"
                            id="guardian_postal_code"
                            name="guardian_postal_code"
                            value={formData.guardian_postal_code}
                            onChange={handleInputChange}
                            className="input-field"
                            placeholder="Postal code"
                          />
                        </div>

                        <div>
                          <label htmlFor="guardian_state_province_region" className="label-field">
                            State/Province/Region
                          </label>
                          <input
                            type="text"
                            id="guardian_state_province_region"
                            name="guardian_state_province_region"
                            value={formData.guardian_state_province_region}
                            onChange={handleInputChange}
                            className="input-field"
                            placeholder="State/Province/Region"
                          />
                        </div>

                        <div>
                          <label htmlFor="guardian_country" className="label-field">
                            Country
                          </label>
                          <input
                            type="text"
                            id="guardian_country"
                            name="guardian_country"
                            value={formData.guardian_country}
                            onChange={handleInputChange}
                            className="input-field"
                            placeholder="Country"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

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
                    editingPersonnel ? 'Update Personnel' : 'Create User'
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

export default AdminPersonnel;

