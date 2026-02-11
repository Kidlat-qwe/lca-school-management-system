import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';
import { formatDateManila } from '../../utils/dateUtils';

const AdminStudent = () => {
  const { signup, userInfo } = useAuth();
  const adminBranchId = userInfo?.branch_id || userInfo?.branchId;
  const [selectedBranchName, setSelectedBranchName] = useState(userInfo?.branch_name || 'Your Branch');
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nameSearchTerm, setNameSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState(null);
  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    password: '',
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

  useEffect(() => {
    fetchStudents();
  }, [currentPage, itemsPerPage]);

  // Auto-set branch_id when adminBranchId is available
  useEffect(() => {
    if (adminBranchId && !editingStudent) {
      setFormData(prev => ({
        ...prev,
        branch_id: adminBranchId.toString(),
      }));
    }
  }, [adminBranchId, editingStudent]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (openMenuId && !event.target.closest('.action-menu-container') && !event.target.closest('.action-menu-overlay')) {
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

  const handleMenuClick = (studentId, event) => {
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    
    if (openMenuId === studentId) {
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
      setOpenMenuId(studentId);
    }
  };

  const fetchStudents = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        user_type: 'Student',
        limit: String(itemsPerPage),
        page: String(currentPage),
      });
      if (adminBranchId) params.set('branch_id', String(adminBranchId));
      const response = await apiRequest(`/users?${params.toString()}`);
      const list = (response.data || []).filter((s) => s.user_type === 'Student');
      setStudents(list);
      setTotalItems(response.pagination?.total ?? 0);
      setTotalPages(response.pagination?.totalPages ?? 1);
    } catch (err) {
      setError(err.message || 'Failed to fetch students');
      console.error('Error fetching students:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (userId) => {
    setOpenMenuId(null);
    
    // Verify student belongs to admin's branch
    const student = students.find(s => s.user_id === userId);
    if (student && student.branch_id !== adminBranchId) {
      alert('You can only delete students from your branch.');
      return;
    }
    
    if (!window.confirm('Are you sure you want to delete this student?')) {
      return;
    }

    try {
      await apiRequest(`/users/${userId}`, {
        method: 'DELETE',
      });
      fetchStudents();
    } catch (err) {
      alert(err.message || 'Failed to delete student');
    }
  };

  const openCreateModal = () => {
    setEditingStudent(null);
    setError('');
    setExistingGuardian(null);
    setFormData({
      full_name: '',
      email: '',
      password: '',
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

  const openEditModal = async (student) => {
    setOpenMenuId(null);
    
    // Verify student belongs to admin's branch
    if (student.branch_id !== adminBranchId) {
      alert('You can only edit students from your branch.');
      return;
    }
    
    setEditingStudent(student);
    setError('');
    setExistingGuardian(null);
    
    setFormData({
      full_name: student.full_name || '',
      email: student.email || '',
      password: '',
      phone_number: student.phone_number || '',
      branch_id: student.branch_id ? student.branch_id.toString() : adminBranchId.toString(),
      level_tag: student.level_tag || '',
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

    // Fetch guardian data
    try {
      const guardianResponse = await apiRequest(`/guardians/student/${student.user_id}`);
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
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingStudent(null);
    setExistingGuardian(null);
    setFormErrors({});
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setFormErrors({});

    try {
      // Validation
      const errors = {};
      if (!formData.full_name.trim()) errors.full_name = 'Full name is required';
      if (!formData.email.trim()) errors.email = 'Email is required';
      if (!editingStudent && !formData.password.trim()) errors.password = 'Password is required';
      if (!formData.branch_id) errors.branch_id = 'Branch is required';
      if (!formData.level_tag) errors.level_tag = 'Level tag is required';
      // Guardian fields - ALL REQUIRED
      if (!formData.guardian_name.trim()) errors.guardian_name = 'Guardian name is required';
      if (!formData.guardian_email.trim()) errors.guardian_email = 'Guardian email is required';
      if (!formData.guardian_relationship) errors.guardian_relationship = 'Relationship is required';
      if (!formData.guardian_phone_number.trim()) errors.guardian_phone_number = 'Guardian phone number is required';
      if (!formData.guardian_gender) errors.guardian_gender = 'Guardian gender is required';
      if (!formData.guardian_address.trim()) errors.guardian_address = 'Address is required';
      if (!formData.guardian_city.trim()) errors.guardian_city = 'City is required';
      if (!formData.guardian_postal_code.trim()) errors.guardian_postal_code = 'Postal code is required';
      if (!formData.guardian_country.trim()) errors.guardian_country = 'Country is required';
      if (!formData.guardian_state_province_region.trim()) errors.guardian_state_province_region = 'State/Province/Region is required';

      if (Object.keys(errors).length > 0) {
        setFormErrors(errors);
        setSubmitting(false);
        return;
      }

      // Ensure branch_id is set to admin's branch
      const finalBranchId = adminBranchId || parseInt(formData.branch_id);

      if (editingStudent) {
        // Update existing student
        const payload = {
          full_name: formData.full_name.trim(),
          phone_number: formData.phone_number || null,
          branch_id: finalBranchId,
          level_tag: formData.level_tag,
        };

        if (formData.password.trim()) {
          payload.password = formData.password;
        }

        await apiRequest(`/users/${editingStudent.user_id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });

        // Update or create guardian
        if (existingGuardian && existingGuardian.guardian_id) {
          await apiRequest(`/guardians/${existingGuardian.guardian_id}`, {
            method: 'PUT',
            body: JSON.stringify({
              guardian_name: formData.guardian_name.trim(),
              email: formData.guardian_email.trim(),
              relationship: formData.guardian_relationship.trim(),
              guardian_phone_number: formData.guardian_phone_number.trim(),
              gender: formData.guardian_gender,
              address: formData.guardian_address.trim(),
              city: formData.guardian_city.trim(),
              postal_code: formData.guardian_postal_code.trim(),
              country: formData.guardian_country.trim(),
              state_province_region: formData.guardian_state_province_region.trim(),
            }),
          });
        } else {
          await apiRequest('/guardians', {
            method: 'POST',
            body: JSON.stringify({
              student_id: editingStudent.user_id,
              guardian_name: formData.guardian_name.trim(),
              email: formData.guardian_email.trim(),
              relationship: formData.guardian_relationship.trim(),
              guardian_phone_number: formData.guardian_phone_number.trim(),
              gender: formData.guardian_gender,
              address: formData.guardian_address.trim(),
              city: formData.guardian_city.trim(),
              postal_code: formData.guardian_postal_code.trim(),
              country: formData.guardian_country.trim(),
              state_province_region: formData.guardian_state_province_region.trim(),
            }),
          });
        }
      } else {
        // Create new student
        const userData = {
          full_name: formData.full_name.trim(),
          user_type: 'Student',
          phone_number: formData.phone_number || null,
          branch_id: finalBranchId,
          level_tag: formData.level_tag,
        };

        const result = await signup(formData.email, formData.password, userData, false);

        // Create guardian
        if (result.user?.user_id) {
          await apiRequest('/guardians', {
            method: 'POST',
            body: JSON.stringify({
              student_id: result.user.user_id,
              guardian_name: formData.guardian_name.trim(),
              email: formData.guardian_email.trim(),
              relationship: formData.guardian_relationship.trim(),
              guardian_phone_number: formData.guardian_phone_number.trim(),
              gender: formData.guardian_gender,
              address: formData.guardian_address.trim(),
              city: formData.guardian_city.trim(),
              postal_code: formData.guardian_postal_code.trim(),
              country: formData.guardian_country.trim(),
              state_province_region: formData.guardian_state_province_region.trim(),
            }),
          });
        }
      }
      
      closeModal();
      fetchStudents();
    } catch (err) {
      console.error('Error saving student:', err);
      let errorMessage = err.message || `Failed to ${editingStudent ? 'update' : 'create'} student`;
      
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

  const filteredStudents = students.filter((student) => {
    const matchesName = !nameSearchTerm || 
      student.full_name?.toLowerCase().includes(nameSearchTerm.toLowerCase());
    return matchesName;
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
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Students</h1>
          <p className="text-sm text-gray-500 mt-1">Branch: {selectedBranchName}</p>
        </div>
        <button 
          onClick={openCreateModal}
          className="btn-primary flex items-center justify-center space-x-2 w-full sm:w-auto"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>Add Student</span>
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Student List */}
      {filteredStudents.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-500">
            {nameSearchTerm
              ? 'No students found matching your search.'
              : 'No students found. Add your first student to get started.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow">
          {/* Table View - Responsive */}
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
                <col style={{ width: '100px' }} />
                <col style={{ width: '120px' }} />
                <col style={{ width: '130px' }} />
                <col style={{ width: '50px' }} />
              </colgroup>
              <thead className="bg-white table-header-stable">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '200px', minWidth: '200px' }}>
                    <div className="flex flex-col space-y-2">
                      <div className="flex items-center space-x-1 min-h-[6px]">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${nameSearchTerm ? 'bg-primary-600' : 'invisible'}`} aria-hidden />
                      </div>
                      <div className="relative min-h-[28px]">
                        <input
                          type="text"
                          value={nameSearchTerm}
                          onChange={(e) => setNameSearchTerm(e.target.value)}
                          placeholder="Search student..."
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
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '200px', minWidth: '200px' }}>
                    Email
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '100px', minWidth: '100px' }}>
                    Level Tag
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '120px', minWidth: '120px' }}>
                    Phone Number
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
                {filteredStudents.map((student) => (
                  <tr key={student.user_id}>
                    <td className="px-3 py-4">
                      <div className="flex items-center min-w-0">
                        <div className="h-8 w-8 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                          {student.profile_picture_url ? (
                            <img
                              src={student.profile_picture_url}
                              alt={student.full_name}
                              className="h-8 w-8 rounded-full object-cover"
                            />
                          ) : (
                            <span className="text-primary-600 font-semibold text-xs">
                              {student.full_name?.charAt(0).toUpperCase() || '-'}
                            </span>
                          )}
                        </div>
                        <div className="ml-2 min-w-0 flex-1">
                          <div className="text-sm font-medium text-gray-900 truncate" title={student.full_name || '-'}>
                            {student.full_name || '-'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-4">
                      <div className="text-sm text-gray-900 truncate" title={student.email || '-'}>
                        {student.email || '-'}
                      </div>
                    </td>
                    <td className="px-3 py-4">
                      <div className="text-sm text-gray-900 truncate">
                        {student.level_tag || '-'}
                      </div>
                    </td>
                    <td className="px-3 py-4">
                      <div className="text-sm text-gray-900 truncate">
                        {student.phone_number || '-'}
                      </div>
                    </td>
                    <td className="px-3 py-4">
                      <div className="text-sm text-gray-900">
                        {student.last_login
                          ? (() => {
                              // Parse timestamp string (format: YYYY-MM-DD HH24:MI:SS) as Philippines time
                              const dateStr = student.last_login;
                              // Convert PostgreSQL timestamp format to ISO format with timezone
                              const isoStr = dateStr.replace(' ', 'T') + '+08:00';
                              const date = new Date(isoStr);
                              
                              // Format date: DD/MM/YYYY
                              const formattedDate = formatDateManila(date);
                              
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
                          onClick={(e) => handleMenuClick(student.user_id, e)}
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
      {totalItems > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-gray-200 bg-gray-50 rounded-b-lg">
          <div className="text-sm text-gray-600">
            Showing {(currentPage - 1) * itemsPerPage + 1}–{Math.min(currentPage * itemsPerPage, totalItems)} of {totalItems} students
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-sm text-gray-600 flex items-center gap-1">
              Per page
              <select
                value={itemsPerPage}
                onChange={(e) => {
                  setItemsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="rounded border border-gray-300 px-2 py-1 text-sm"
              >
                {[10, 20, 50].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="px-3 py-1 border border-gray-300 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
              >
                Previous
              </button>
              <span className="px-2 text-sm text-gray-600">
                Page {currentPage} of {totalPages || 1}
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages || 1, p + 1))}
                disabled={currentPage >= (totalPages || 1)}
                className="px-3 py-1 border border-gray-300 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
              >
                Next
              </button>
            </div>
          </div>
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
            className="fixed action-menu-overlay bg-white rounded-md shadow-lg z-50 border border-gray-200 w-48"
            style={{
              ...(menuPosition.top !== undefined && { top: `${menuPosition.top}px` }),
              ...(menuPosition.bottom !== undefined && { bottom: `${menuPosition.bottom}px` }),
              ...(menuPosition.right !== undefined && { right: `${menuPosition.right}px` }),
              ...(menuPosition.left !== undefined && { left: `${menuPosition.left}px` }),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="py-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const selectedStudent = filteredStudents.find(s => s.user_id === openMenuId);
                  if (selectedStudent) {
                    setOpenMenuId(null);
                    setMenuPosition({ top: 0, right: 0 });
                    openEditModal(selectedStudent);
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

      {/* Create/Edit Student Modal */}
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
            <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                  {editingStudent ? 'Edit Student' : 'Create New Student'}
                </h2>
                {!editingStudent && (
                  <p className="text-sm text-gray-500 mt-1">Fill in the details to create a new student</p>
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
                        disabled={!!editingStudent}
                      />
                      {formErrors.email && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.email}</p>
                      )}
                    </div>

                    {!editingStudent && (
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
                          required
                        />
                        {formErrors.password && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.password}</p>
                        )}
                      </div>
                    )}

                    {editingStudent && (
                      <div>
                        <label htmlFor="password" className="label-field">
                          New Password (leave blank to keep current)
                        </label>
                        <input
                          type="password"
                          id="password"
                          name="password"
                          value={formData.password}
                          onChange={handleInputChange}
                          className="input-field"
                        />
                      </div>
                    )}

                    <div>
                      <label htmlFor="phone_number" className="label-field">
                        Phone Number
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
                      <label htmlFor="branch_id" className="label-field">
                        Branch <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={selectedBranchName}
                        readOnly
                        className="input-field bg-gray-50 cursor-not-allowed"
                      />
                      <p className="mt-1 text-xs text-gray-500">Branch is set to your assigned branch</p>
                    </div>

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
                        required
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
                  </div>

                  {/* Guardian Information Section */}
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
                          required
                          placeholder="Full name of guardian"
                        />
                        {formErrors.guardian_name && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.guardian_name}</p>
                        )}
                      </div>

                      <div>
                        <label htmlFor="guardian_email" className="label-field">
                          Guardian Email <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="email"
                          id="guardian_email"
                          name="guardian_email"
                          value={formData.guardian_email}
                          onChange={handleInputChange}
                          className={`input-field ${formErrors.guardian_email ? 'border-red-500' : ''}`}
                          required
                          placeholder="guardian@example.com"
                        />
                        {formErrors.guardian_email && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.guardian_email}</p>
                        )}
                      </div>

                      <div>
                        <label htmlFor="guardian_relationship" className="label-field">
                          Relationship <span className="text-red-500">*</span>
                        </label>
                        <select
                          id="guardian_relationship"
                          name="guardian_relationship"
                          value={formData.guardian_relationship}
                          onChange={handleInputChange}
                          className={`input-field ${formErrors.guardian_relationship ? 'border-red-500' : ''}`}
                          required
                        >
                          <option value="">Select Relationship</option>
                          <option value="Parent">Parent</option>
                          <option value="Guardian">Guardian</option>
                          <option value="Grandparent">Grandparent</option>
                          <option value="Sibling">Sibling</option>
                          <option value="Other">Other</option>
                        </select>
                        {formErrors.guardian_relationship && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.guardian_relationship}</p>
                        )}
                      </div>

                      <div>
                        <label htmlFor="guardian_phone_number" className="label-field">
                          Guardian Phone Number <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="tel"
                          id="guardian_phone_number"
                          name="guardian_phone_number"
                          value={formData.guardian_phone_number}
                          onChange={handleInputChange}
                          className={`input-field ${formErrors.guardian_phone_number ? 'border-red-500' : ''}`}
                          required
                          placeholder="e.g., +639123456789"
                        />
                        {formErrors.guardian_phone_number && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.guardian_phone_number}</p>
                        )}
                      </div>

                      <div>
                        <label htmlFor="guardian_gender" className="label-field">
                          Guardian Gender <span className="text-red-500">*</span>
                        </label>
                        <select
                          id="guardian_gender"
                          name="guardian_gender"
                          value={formData.guardian_gender}
                          onChange={handleInputChange}
                          className={`input-field ${formErrors.guardian_gender ? 'border-red-500' : ''}`}
                          required
                        >
                          <option value="">Select Gender</option>
                          <option value="Male">Male</option>
                          <option value="Female">Female</option>
                          <option value="Other">Other</option>
                        </select>
                        {formErrors.guardian_gender && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.guardian_gender}</p>
                        )}
                      </div>

                      <div className="md:col-span-2">
                        <label htmlFor="guardian_address" className="label-field">
                          Address <span className="text-red-500">*</span>
                        </label>
                        <textarea
                          id="guardian_address"
                          name="guardian_address"
                          value={formData.guardian_address}
                          onChange={handleInputChange}
                          className={`input-field ${formErrors.guardian_address ? 'border-red-500' : ''}`}
                          required
                          rows="2"
                          placeholder="Street address"
                        />
                        {formErrors.guardian_address && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.guardian_address}</p>
                        )}
                      </div>

                      <div>
                        <label htmlFor="guardian_city" className="label-field">
                          City <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          id="guardian_city"
                          name="guardian_city"
                          value={formData.guardian_city}
                          onChange={handleInputChange}
                          className={`input-field ${formErrors.guardian_city ? 'border-red-500' : ''}`}
                          required
                          placeholder="City"
                        />
                        {formErrors.guardian_city && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.guardian_city}</p>
                        )}
                      </div>

                      <div>
                        <label htmlFor="guardian_postal_code" className="label-field">
                          Postal Code <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          id="guardian_postal_code"
                          name="guardian_postal_code"
                          value={formData.guardian_postal_code}
                          onChange={handleInputChange}
                          className={`input-field ${formErrors.guardian_postal_code ? 'border-red-500' : ''}`}
                          required
                          placeholder="Postal code"
                        />
                        {formErrors.guardian_postal_code && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.guardian_postal_code}</p>
                        )}
                      </div>

                      <div>
                        <label htmlFor="guardian_state_province_region" className="label-field">
                          State/Province/Region <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          id="guardian_state_province_region"
                          name="guardian_state_province_region"
                          value={formData.guardian_state_province_region}
                          onChange={handleInputChange}
                          className={`input-field ${formErrors.guardian_state_province_region ? 'border-red-500' : ''}`}
                          required
                          placeholder="State/Province/Region"
                        />
                        {formErrors.guardian_state_province_region && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.guardian_state_province_region}</p>
                        )}
                      </div>

                      <div>
                        <label htmlFor="guardian_country" className="label-field">
                          Country <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          id="guardian_country"
                          name="guardian_country"
                          value={formData.guardian_country}
                          onChange={handleInputChange}
                          className={`input-field ${formErrors.guardian_country ? 'border-red-500' : ''}`}
                          required
                          placeholder="Country"
                        />
                        {formErrors.guardian_country && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.guardian_country}</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 flex-shrink-0">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Saving...' : editingStudent ? 'Update Student' : 'Create Student'}
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

export default AdminStudent;
