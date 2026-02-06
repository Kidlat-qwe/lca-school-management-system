import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';

const AdminCurriculum = () => {
  const [curricula, setCurricula] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nameSearchTerm, setNameSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [openMenuId, setOpenMenuId] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const [openStatusDropdown, setOpenStatusDropdown] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCurriculum, setEditingCurriculum] = useState(null);
  const [formData, setFormData] = useState({
    curriculum_name: '',
    number_of_phase: '',
    number_of_session_per_phase: '',
    status: 'Active',
  });
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [selectedCurriculumForDetails, setSelectedCurriculumForDetails] = useState(null);
  const [phaseSessions, setPhaseSessions] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [editingCell, setEditingCell] = useState(null);
  const [editingValue, setEditingValue] = useState('');
  const [savingCell, setSavingCell] = useState(false);

  useEffect(() => {
    fetchCurricula();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (openMenuId && !event.target.closest('.action-menu-container') && !event.target.closest('.action-menu-overlay')) {
        setOpenMenuId(null);
      }
      if (openStatusDropdown && !event.target.closest('.status-filter-dropdown')) {
        setOpenStatusDropdown(false);
      }
    };

    if (openMenuId || openStatusDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [openMenuId, openStatusDropdown]);

  const handleMenuClick = (curriculumId, event) => {
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    
    if (openMenuId === curriculumId) {
      setOpenMenuId(null);
      setMenuPosition({ top: undefined, bottom: undefined, right: undefined, left: undefined });
    } else {
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;
      const estimatedDropdownHeight = 150;
      
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
      setOpenMenuId(curriculumId);
    }
  };

  const fetchCurricula = async () => {
    try {
      setLoading(true);
      const response = await apiRequest('/curriculum');
      setCurricula(response.data || []);
    } catch (err) {
      setError(err.message || 'Failed to fetch curricula');
      console.error('Error fetching curricula:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (curriculumId) => {
    setOpenMenuId(null);
    if (!window.confirm('Are you sure you want to delete this curriculum?')) {
      return;
    }

    try {
      await apiRequest(`/curriculum/${curriculumId}`, {
        method: 'DELETE',
      });
      fetchCurricula();
    } catch (err) {
      alert(err.message || 'Failed to delete curriculum');
    }
  };

  const openManageDetailsModal = (curriculum) => {
    setOpenMenuId(null);
    setSelectedCurriculumForDetails(curriculum);
    setIsDetailsModalOpen(true);
    fetchPhaseSessions(curriculum.curriculum_id);
  };

  const closeDetailsModal = () => {
    setIsDetailsModalOpen(false);
    setSelectedCurriculumForDetails(null);
    setPhaseSessions([]);
    setEditingCell(null);
    setEditingValue('');
  };

  const fetchPhaseSessions = async (curriculumId) => {
    try {
      setLoadingSessions(true);
      const response = await apiRequest(`/phasesessions?curriculum_id=${curriculumId}`);
      setPhaseSessions(response.data || []);
    } catch (err) {
      setError(err.message || 'Failed to fetch phase sessions');
      console.error('Error fetching phase sessions:', err);
    } finally {
      setLoadingSessions(false);
    }
  };

  const startEditing = (sessionId, field, currentValue) => {
    setEditingCell({ sessionId, field });
    setEditingValue(currentValue || '');
  };

  const cancelEditing = () => {
    setEditingCell(null);
    setEditingValue('');
  };

  const saveCell = async (sessionId, field) => {
    if (savingCell) return;

    setSavingCell(true);
    try {
      const session = phaseSessions.find(s => s.phasesessiondetail_id === sessionId);
      if (!session) return;

      const payload = {
        curriculum_id: session.curriculum_id,
        phase_number: session.phase_number,
        phase_session_number: session.phase_session_number,
        topic: session.topic || null,
        goal: session.goal || null,
        agenda: session.agenda || null,
        [field]: editingValue.trim() || null,
      };

      await apiRequest(`/phasesessions/${sessionId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });

      setPhaseSessions(prev => prev.map(s => 
        s.phasesessiondetail_id === sessionId 
          ? { ...s, [field]: editingValue.trim() || null }
          : s
      ));

      setEditingCell(null);
      setEditingValue('');
    } catch (err) {
      setError(err.message || 'Failed to update phase session');
      console.error('Error updating phase session:', err);
    } finally {
      setSavingCell(false);
    }
  };

  const handleCellKeyDown = (e, sessionId, field) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveCell(sessionId, field);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditing();
    }
  };

  const openCreateModal = () => {
    setEditingCurriculum(null);
    setError('');
    setFormData({
      curriculum_name: '',
      number_of_phase: '',
      number_of_session_per_phase: '',
      status: 'Active',
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = (curriculum) => {
    setOpenMenuId(null);
    setEditingCurriculum(curriculum);
    setError('');
    setFormData({
      curriculum_name: curriculum.curriculum_name || '',
      number_of_phase: curriculum.number_of_phase?.toString() || '',
      number_of_session_per_phase: curriculum.number_of_session_per_phase?.toString() || '',
      status: curriculum.status || 'Active',
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingCurriculum(null);
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
    
    if (!formData.curriculum_name.trim()) {
      errors.curriculum_name = 'Curriculum name is required';
    }
    
    if (formData.number_of_phase && (isNaN(formData.number_of_phase) || parseInt(formData.number_of_phase) < 1)) {
      errors.number_of_phase = 'Number of phases must be a positive integer';
    }

    if (formData.number_of_session_per_phase && (isNaN(formData.number_of_session_per_phase) || parseInt(formData.number_of_session_per_phase) < 1)) {
      errors.number_of_session_per_phase = 'Number of sessions per phase must be a positive integer';
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
      const payload = {
        curriculum_name: formData.curriculum_name.trim(),
        number_of_phase: formData.number_of_phase ? parseInt(formData.number_of_phase) : null,
        number_of_session_per_phase: formData.number_of_session_per_phase ? parseInt(formData.number_of_session_per_phase) : null,
        status: formData.status || 'Active',
      };
      
      if (editingCurriculum) {
        await apiRequest(`/curriculum/${editingCurriculum.curriculum_id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await apiRequest('/curriculum', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      
      closeModal();
      fetchCurricula();
    } catch (err) {
      setError(err.message || `Failed to ${editingCurriculum ? 'update' : 'create'} curriculum`);
      console.error('Error saving curriculum:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const uniqueStatuses = [...new Set(curricula.map(c => c.status).filter(Boolean))];

  const filteredCurricula = curricula.filter((curriculum) => {
    const matchesNameSearch = !nameSearchTerm || 
      curriculum.curriculum_name?.toLowerCase().includes(nameSearchTerm.toLowerCase());
    const matchesStatus = !filterStatus || curriculum.status === filterStatus;
    return matchesNameSearch && matchesStatus;
  });

  const getStatusBadgeColor = (status) => {
    const colors = {
      Active: 'bg-green-100 text-green-800',
      Inactive: 'bg-gray-100 text-gray-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
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
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Curriculum</h1>
          <p className="text-sm text-gray-600">Manage curriculum templates (system-wide)</p>
        </div>
        <button 
          onClick={openCreateModal}
          className="btn-primary flex items-center justify-center space-x-2 w-full sm:w-auto"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>Add Curriculum</span>
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {filteredCurricula.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-500">
            {nameSearchTerm || filterStatus
              ? 'No curricula found matching your criteria.'
              : 'No curricula found. Add your first curriculum to get started.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow">
          <div
            className="overflow-x-auto rounded-lg"
            style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}
          >
            <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '800px' }}>
              <thead className="bg-white">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <div className="flex flex-col space-y-2">
                      <div className="flex items-center space-x-1">
                        {nameSearchTerm && (
                          <span className="inline-flex items-center justify-center w-1.5 h-1.5 bg-primary-600 rounded-full"></span>
                        )}
                      </div>
                      <div className="relative">
                        <input
                          type="text"
                          value={nameSearchTerm}
                          onChange={(e) => setNameSearchTerm(e.target.value)}
                          placeholder="Search curriculum..."
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
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Number of Phases
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Sessions per Phase
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
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
                        <div className="absolute left-0 mt-2 w-40 bg-white rounded-md shadow-lg z-50 border border-gray-200 max-h-60 overflow-y-auto">
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
                              All Statuses
                            </button>
                            {uniqueStatuses.map((status) => (
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
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-[#ffffff] divide-y divide-gray-200">
                {filteredCurricula.map((curriculum) => (
                  <tr key={curriculum.curriculum_id}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {curriculum.curriculum_name || '-'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {curriculum.number_of_phase !== null && curriculum.number_of_phase !== undefined
                          ? curriculum.number_of_phase
                          : '-'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {curriculum.number_of_session_per_phase !== null && curriculum.number_of_session_per_phase !== undefined
                          ? curriculum.number_of_session_per_phase
                          : '-'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${getStatusBadgeColor(
                          curriculum.status
                        )}`}
                      >
                        {curriculum.status || 'Active'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="relative action-menu-container">
                        <button
                          onClick={(e) => handleMenuClick(curriculum.curriculum_id, e)}
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

      {filteredCurricula.length > 0 && (
        <div className="text-sm text-gray-500 text-center">
          Showing {filteredCurricula.length} of {curricula.length} curricula
        </div>
      )}

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
                  const selectedCurriculum = filteredCurricula.find(c => c.curriculum_id === openMenuId);
                  if (selectedCurriculum) {
                    setOpenMenuId(null);
                    setMenuPosition({ top: undefined, bottom: undefined, right: undefined, left: undefined });
                    openEditModal(selectedCurriculum);
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
                  const selectedCurriculum = filteredCurricula.find(c => c.curriculum_id === openMenuId);
                  if (selectedCurriculum) {
                    setOpenMenuId(null);
                    setMenuPosition({ top: undefined, bottom: undefined, right: undefined, left: undefined });
                    openManageDetailsModal(selectedCurriculum);
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

      {isModalOpen && createPortal(
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4"
          onClick={closeModal}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0 bg-white rounded-t-lg">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                  {editingCurriculum ? 'Edit Curriculum' : 'Create New Curriculum'}
                </h2>
                {!editingCurriculum && (
                  <p className="text-sm text-gray-500 mt-1">Fill in the details to create a new curriculum</p>
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
                    <div className="md:col-span-2">
                      <label htmlFor="curriculum_name" className="label-field">
                        Curriculum Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        id="curriculum_name"
                        name="curriculum_name"
                        value={formData.curriculum_name}
                        onChange={handleInputChange}
                        className={`input-field ${formErrors.curriculum_name ? 'border-red-500' : ''}`}
                        required
                        placeholder="e.g., Early Childhood Development"
                      />
                      {formErrors.curriculum_name && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.curriculum_name}</p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="number_of_phase" className="label-field">
                        Number of Phases
                      </label>
                      <input
                        type="number"
                        id="number_of_phase"
                        name="number_of_phase"
                        value={formData.number_of_phase}
                        onChange={handleInputChange}
                        className={`input-field ${formErrors.number_of_phase ? 'border-red-500' : ''}`}
                        min="1"
                        placeholder="e.g., 5"
                      />
                      {formErrors.number_of_phase && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.number_of_phase}</p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="number_of_session_per_phase" className="label-field">
                        Sessions per Phase
                      </label>
                      <input
                        type="number"
                        id="number_of_session_per_phase"
                        name="number_of_session_per_phase"
                        value={formData.number_of_session_per_phase}
                        onChange={handleInputChange}
                        className={`input-field ${formErrors.number_of_session_per_phase ? 'border-red-500' : ''}`}
                        min="1"
                        placeholder="e.g., 10"
                      />
                      {formErrors.number_of_session_per_phase && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.number_of_session_per_phase}</p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="status" className="label-field">
                        Status <span className="text-red-500">*</span>
                      </label>
                      <select
                        id="status"
                        name="status"
                        value={formData.status}
                        onChange={handleInputChange}
                        className="input-field"
                        required
                      >
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                      </select>
                    </div>
                  </div>
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
                    editingCurriculum ? 'Update Curriculum' : 'Create Curriculum'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {isDetailsModalOpen && selectedCurriculumForDetails && createPortal(
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4"
          onClick={closeDetailsModal}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[85vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-gray-200 flex-shrink-0 bg-white rounded-t-lg">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  Manage Phase Sessions - {selectedCurriculumForDetails.curriculum_name}
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Click on Topic, Goal, or Agenda to edit
                </p>
              </div>
              <button
                onClick={closeDetailsModal}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex flex-col flex-1 overflow-hidden">
              <div className="p-4 overflow-y-auto flex-1">
                {loadingSessions ? (
                  <div className="flex items-center justify-center h-32">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                  </div>
                ) : phaseSessions.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-gray-500 text-sm">No phase sessions found.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
                    <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '600px' }}>
                      <thead className="bg-white">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Phase
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Session
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Topic
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Goal
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Agenda
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-[#ffffff] divide-y divide-gray-200">
                        {phaseSessions.map((session) => (
                          <tr key={session.phasesessiondetail_id}>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                              {session.phase_number}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                              {session.phase_session_number}
                            </td>
                            <td 
                              className="px-4 py-3 text-sm text-gray-900 cursor-pointer hover:bg-blue-50 transition-colors"
                              onClick={() => startEditing(session.phasesessiondetail_id, 'topic', session.topic)}
                            >
                              {editingCell?.sessionId === session.phasesessiondetail_id && editingCell?.field === 'topic' ? (
                                <input
                                  type="text"
                                  value={editingValue}
                                  onChange={(e) => setEditingValue(e.target.value)}
                                  onBlur={() => saveCell(session.phasesessiondetail_id, 'topic')}
                                  onKeyDown={(e) => handleCellKeyDown(e, session.phasesessiondetail_id, 'topic')}
                                  className="w-full px-2 py-1 text-sm border border-blue-500 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                  autoFocus
                                  disabled={savingCell}
                                />
                              ) : (
                                <div className="min-h-[24px]">
                                  {session.topic || <span className="text-gray-400 italic">Click to edit</span>}
                                </div>
                              )}
                            </td>
                            <td 
                              className="px-4 py-3 text-sm text-gray-900 cursor-pointer hover:bg-blue-50 transition-colors max-w-xs"
                              onClick={() => startEditing(session.phasesessiondetail_id, 'goal', session.goal)}
                            >
                              {editingCell?.sessionId === session.phasesessiondetail_id && editingCell?.field === 'goal' ? (
                                <textarea
                                  value={editingValue}
                                  onChange={(e) => setEditingValue(e.target.value)}
                                  onBlur={() => saveCell(session.phasesessiondetail_id, 'goal')}
                                  onKeyDown={(e) => handleCellKeyDown(e, session.phasesessiondetail_id, 'goal')}
                                  className="w-full px-2 py-1 text-sm border border-blue-500 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                                  rows="2"
                                  autoFocus
                                  disabled={savingCell}
                                />
                              ) : (
                                <div className="min-h-[24px]">
                                  {session.goal || <span className="text-gray-400 italic">Click to edit</span>}
                                </div>
                              )}
                            </td>
                            <td 
                              className="px-4 py-3 text-sm text-gray-900 cursor-pointer hover:bg-blue-50 transition-colors max-w-xs"
                              onClick={() => startEditing(session.phasesessiondetail_id, 'agenda', session.agenda)}
                            >
                              {editingCell?.sessionId === session.phasesessiondetail_id && editingCell?.field === 'agenda' ? (
                                <textarea
                                  value={editingValue}
                                  onChange={(e) => setEditingValue(e.target.value)}
                                  onBlur={() => saveCell(session.phasesessiondetail_id, 'agenda')}
                                  onKeyDown={(e) => handleCellKeyDown(e, session.phasesessiondetail_id, 'agenda')}
                                  className="w-full px-2 py-1 text-sm border border-blue-500 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                                  rows="2"
                                  autoFocus
                                  disabled={savingCell}
                                />
                              ) : (
                                <div className="min-h-[24px]">
                                  {session.agenda || <span className="text-gray-400 italic">Click to edit</span>}
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default AdminCurriculum;

