import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';

const Program = () => {
  const [programs, setPrograms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nameSearchTerm, setNameSearchTerm] = useState('');
  const [filterCurriculum, setFilterCurriculum] = useState('');
  const [openMenuId, setOpenMenuId] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const [openCurriculumDropdown, setOpenCurriculumDropdown] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProgram, setEditingProgram] = useState(null);
  const [curricula, setCurricula] = useState([]);
  const [formData, setFormData] = useState({
    program_name: '',
    program_code: '',
    curriculum_id: '',
    session_duration_hours: '',
  });
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  // Program name to code mapping
  const programNameToCode = {
    'Playgroup': 'sc',
    'Nursery': 'nc',
    'Kindergarten': 'kg',
    'Pre-Kindergarten': 'pk',
    'Grade School': 'gs',
  };

  const programNames = ['Playgroup', 'Nursery', 'Kindergarten', 'Pre-Kindergarten', 'Grade School'];

  useEffect(() => {
    fetchPrograms();
    fetchCurricula();
  }, []);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (openMenuId && !event.target.closest('.action-menu-container') && !event.target.closest('.action-menu-overlay')) {
        setOpenMenuId(null);
      }
      if (openCurriculumDropdown && !event.target.closest('.curriculum-filter-dropdown')) {
        setOpenCurriculumDropdown(false);
      }
    };

    if (openMenuId || openCurriculumDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [openMenuId, openCurriculumDropdown]);

  const handleMenuClick = (programId, event) => {
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    
    if (openMenuId === programId) {
      setOpenMenuId(null);
      setMenuPosition({ top: 0, right: 0 });
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
      setOpenMenuId(programId);
    }
  };

  const fetchPrograms = async () => {
    try {
      setLoading(true);
      const response = await apiRequest('/programs');
      setPrograms(response.data || []);
    } catch (err) {
      setError(err.message || 'Failed to fetch programs');
      console.error('Error fetching programs:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCurricula = async () => {
    try {
      const response = await apiRequest('/curriculum');
      setCurricula(response.data || []);
    } catch (err) {
      console.error('Error fetching curricula:', err);
    }
  };

  const handleDelete = async (programId) => {
    setOpenMenuId(null);
    if (!window.confirm('Are you sure you want to delete this program?')) {
      return;
    }

    try {
      await apiRequest(`/programs/${programId}`, {
        method: 'DELETE',
      });
      fetchPrograms(); // Refresh the list
    } catch (err) {
      alert(err.message || 'Failed to delete program');
    }
  };

  const openCreateModal = () => {
    setEditingProgram(null);
    setError('');
    setFormData({
      program_name: '',
      program_code: '',
      curriculum_id: '',
      session_duration_hours: '',
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = (program) => {
    setOpenMenuId(null);
    setEditingProgram(program);
    setError('');
    // Handle both new format (session_duration_hours) and old format (session_duration_per_day) for backward compatibility
    let durationHours = '';
    if (program.session_duration_hours !== undefined && program.session_duration_hours !== null) {
      durationHours = program.session_duration_hours.toString();
    } else if (program.session_duration_per_day) {
      // Legacy format: extract first value
      const durationData = typeof program.session_duration_per_day === 'string' 
        ? JSON.parse(program.session_duration_per_day) 
        : program.session_duration_per_day;
      const firstValue = Object.values(durationData || {})[0];
      if (firstValue !== undefined) {
        durationHours = firstValue.toString();
      }
    }
    
    // Get program code from mapping if program name exists, otherwise use stored value
    const programName = program.program_name || '';
    const programCode = programNameToCode[programName] || program.program_code || '';
    
    setFormData({
      program_name: programName,
      program_code: programCode,
      curriculum_id: program.curriculum_id ? program.curriculum_id.toString() : '',
      session_duration_hours: durationHours,
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingProgram(null);
    setFormErrors({});
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    
    // Auto-populate program code when program name is selected
    if (name === 'program_name') {
      const programCode = programNameToCode[value] || '';
      setFormData((prev) => ({
        ...prev,
        program_name: value,
        program_code: programCode,
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        [name]: value,
      }));
    }
    
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
    
    if (!formData.program_name.trim()) {
      errors.program_name = 'Program name is required';
    } else if (!programNames.includes(formData.program_name)) {
      errors.program_name = 'Please select a valid program name';
    }

    // Validate session duration (0.5-8 hours)
    if (formData.session_duration_hours && formData.session_duration_hours.trim() !== '') {
      const numDuration = parseFloat(formData.session_duration_hours);
      if (isNaN(numDuration) || numDuration < 0.5 || numDuration > 8) {
        errors.session_duration_hours = 'Session duration must be between 0.5 and 8 hours';
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
    try {
      // Ensure program code is set correctly based on program name
      const programCode = programNameToCode[formData.program_name] || formData.program_code.trim() || null;
      
      const payload = {
        program_name: formData.program_name.trim(),
        program_code: programCode,
        curriculum_id: formData.curriculum_id ? parseInt(formData.curriculum_id) : null,
        session_duration_hours: formData.session_duration_hours && formData.session_duration_hours.trim() !== ''
          ? parseFloat(formData.session_duration_hours)
          : null,
      };
      
      if (editingProgram) {
        // Update existing program
        await apiRequest(`/programs/${editingProgram.program_id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        // Create new program
        await apiRequest('/programs', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      
      closeModal();
      fetchPrograms(); // Refresh the list
    } catch (err) {
      setError(err.message || `Failed to ${editingProgram ? 'update' : 'create'} program`);
      console.error('Error saving program:', err);
    } finally {
      setSubmitting(false);
    }
  };

  // Get unique curricula for filter dropdown
  const uniqueCurricula = [...new Set(programs.map(p => p.curriculum_id).filter(Boolean))];

  // Helper function to get curriculum name by ID
  const getCurriculumName = (curriculumId) => {
    if (!curriculumId) return null;
    const curriculum = curricula.find(c => c.curriculum_id === curriculumId);
    return curriculum ? curriculum.curriculum_name : null;
  };

  const filteredPrograms = programs.filter((program) => {
    // Filter by name search
    const matchesNameSearch = !nameSearchTerm || 
      program.program_name?.toLowerCase().includes(nameSearchTerm.toLowerCase()) ||
      program.program_code?.toLowerCase().includes(nameSearchTerm.toLowerCase());
    
    // Filter by curriculum
    const matchesCurriculum = !filterCurriculum || program.curriculum_id?.toString() === filterCurriculum;
    
    return matchesNameSearch && matchesCurriculum;
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
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Program</h1>
        <button 
          onClick={openCreateModal}
          className="btn-primary flex items-center justify-center space-x-2 w-full sm:w-auto"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>Add Program</span>
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Program List */}
      {filteredPrograms.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-500">
            {nameSearchTerm || filterCurriculum
              ? 'No programs found matching your criteria.'
              : 'No programs found. Add your first program to get started.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow">
          {/* Table View - Horizontal Scroll on All Screens */}
          <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
            <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '900px' }}>
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
                          placeholder="Search program..."
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
                    Program Code
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <div className="relative curriculum-filter-dropdown">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenCurriculumDropdown(!openCurriculumDropdown);
                        }}
                        className="flex items-center space-x-1 hover:text-gray-700"
                      >
                        <span>Curriculum</span>
                        {filterCurriculum && (
                          <span className="inline-flex items-center justify-center w-1.5 h-1.5 bg-primary-600 rounded-full"></span>
                        )}
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {openCurriculumDropdown && (
                        <div className="absolute left-0 mt-0.5 w-48 bg-white rounded-md shadow-lg z-50 border border-gray-200 max-h-60 overflow-y-auto">
                          <div className="py-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setFilterCurriculum('');
                                setOpenCurriculumDropdown(false);
                              }}
                              className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
                                !filterCurriculum ? 'bg-gray-100 font-medium' : 'text-gray-700'
                              }`}
                            >
                              All Curricula
                            </button>
                            {uniqueCurricula.map((curriculumId) => {
                              const curriculumName = getCurriculumName(curriculumId);
                              return (
                                <button
                                  key={curriculumId}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setFilterCurriculum(curriculumId.toString());
                                    setOpenCurriculumDropdown(false);
                                  }}
                                  className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
                                    filterCurriculum === curriculumId.toString() ? 'bg-gray-100 font-medium' : 'text-gray-700'
                                  }`}
                                >
                                  {curriculumName || `Curriculum ${curriculumId}`}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Session Duration
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-[#ffffff] divide-y divide-gray-200">
                {filteredPrograms.map((program) => {
                  // Format session duration for display
                  const formatSessionDuration = (duration) => {
                    if (!duration && duration !== 0) return '-';
                    const numDuration = parseFloat(duration);
                    if (isNaN(numDuration)) return '-';
                    // Format to show hours, handling decimals nicely
                    if (numDuration % 1 === 0) {
                      return `${numDuration} ${numDuration === 1 ? 'hour' : 'hours'}`;
                    } else {
                      return `${numDuration} hours`;
                    }
                  };

                  return (
                    <tr key={program.program_id}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {program.program_name || '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {program.program_code || '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {program.curriculum_id ? getCurriculumName(program.curriculum_id) || '-' : '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {formatSessionDuration(program.session_duration_hours)}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="relative action-menu-container">
                        <button
                          onClick={(e) => handleMenuClick(program.program_id, e)}
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
      {filteredPrograms.length > 0 && (
        <div className="text-sm text-gray-500 text-center">
          Showing {filteredPrograms.length} of {programs.length} programs
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
                  const selectedProgram = filteredPrograms.find(p => p.program_id === openMenuId);
                  if (selectedProgram) {
                    setOpenMenuId(null);
                    setMenuPosition({ top: 0, right: 0 });
                    openEditModal(selectedProgram);
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

      {/* Create/Edit Program Modal */}
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
                  {editingProgram ? 'Edit Program' : 'Create New Program'}
                </h2>
                {!editingProgram && (
                  <p className="text-sm text-gray-500 mt-1">Fill in the details to create a new program</p>
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
                      <label htmlFor="program_name" className="label-field">
                        Program Name <span className="text-red-500">*</span>
                      </label>
                      <select
                        id="program_name"
                        name="program_name"
                        value={formData.program_name}
                        onChange={handleInputChange}
                        className={`input-field ${formErrors.program_name ? 'border-red-500' : ''}`}
                        required
                      >
                        <option value="">Select Program Name</option>
                        {programNames.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                      {formErrors.program_name && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.program_name}</p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="program_code" className="label-field">
                        Program Code
                      </label>
                      <input
                        type="text"
                        id="program_code"
                        name="program_code"
                        value={formData.program_code}
                        readOnly
                        className="input-field bg-gray-100 cursor-not-allowed"
                        placeholder="Auto-generated from program name"
                      />
                      <p className="mt-1 text-xs text-gray-500">Automatically generated based on program name</p>
                    </div>

                    <div className="md:col-span-2">
                      <label htmlFor="curriculum_id" className="label-field">
                        Curriculum
                      </label>
                      <select
                        id="curriculum_id"
                        name="curriculum_id"
                        value={formData.curriculum_id}
                        onChange={handleInputChange}
                        className="input-field"
                      >
                        <option value="">Select Curriculum (Optional)</option>
                        {curricula.map((curriculum) => (
                          <option key={curriculum.curriculum_id} value={curriculum.curriculum_id}>
                            {curriculum.curriculum_name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Session Duration Section */}
                  <div className="border-t border-gray-200 pt-6 mt-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Session Duration</h3>
                    <p className="text-sm text-gray-500 mb-4">
                      Configure the fixed session duration for all sessions in this program. Used to auto-calculate session end times from start times. Leave empty to use existing end_time values.
                    </p>
                    <div>
                      <label htmlFor="session_duration_hours" className="label-field">
                        Session Duration (Hours)
                      </label>
                      <input
                        type="number"
                        id="session_duration_hours"
                        name="session_duration_hours"
                        value={formData.session_duration_hours}
                        onChange={handleInputChange}
                        className={`input-field ${formErrors.session_duration_hours ? 'border-red-500' : ''}`}
                        placeholder="e.g., 3"
                        min="0.5"
                        max="8"
                        step="0.5"
                      />
                      {formErrors.session_duration_hours && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.session_duration_hours}</p>
                      )}
                      <p className="mt-1 text-xs text-gray-500">Hours (0.5-8). This duration applies to all sessions regardless of day of week.</p>
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
                    editingProgram ? 'Update Program' : 'Create Program'
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

export default Program;

