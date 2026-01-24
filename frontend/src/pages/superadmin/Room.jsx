import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';

const Room = () => {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nameSearchTerm, setNameSearchTerm] = useState('');
  const [filterBranch, setFilterBranch] = useState('');
  const [openMenuId, setOpenMenuId] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const [openBranchDropdown, setOpenBranchDropdown] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalStep, setModalStep] = useState('branch-selection'); // 'branch-selection' or 'form'
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [editingRoom, setEditingRoom] = useState(null);
  const [branches, setBranches] = useState([]);
  const [classes, setClasses] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [scheduleFormData, setScheduleFormData] = useState({
    Monday: { enabled: false, start_time: '', end_time: '' },
    Tuesday: { enabled: false, start_time: '', end_time: '' },
    Wednesday: { enabled: false, start_time: '', end_time: '' },
    Thursday: { enabled: false, start_time: '', end_time: '' },
    Friday: { enabled: false, start_time: '', end_time: '' },
    Saturday: { enabled: false, start_time: '', end_time: '' },
    Sunday: { enabled: false, start_time: '', end_time: '' },
  });
  const [formData, setFormData] = useState({
    room_name: '',
    branch_id: '',
  });
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchRooms();
    fetchBranches();
    fetchClasses();
  }, []);

  useEffect(() => {
    if (editingRoom && isModalOpen && modalStep === 'form') {
      fetchSchedules(editingRoom.room_id);
    }
  }, [editingRoom, isModalOpen, modalStep]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (openMenuId && !event.target.closest('.action-menu-container') && !event.target.closest('.action-menu-overlay')) {
        setOpenMenuId(null);
      }
      if (openBranchDropdown && !event.target.closest('.branch-filter-dropdown')) {
        setOpenBranchDropdown(false);
      }
    };

    if (openMenuId || openBranchDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [openMenuId, openBranchDropdown]);

  const handleMenuClick = (roomId, event) => {
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    
    if (openMenuId === roomId) {
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
      setOpenMenuId(roomId);
    }
  };

  const fetchRooms = async () => {
    try {
      setLoading(true);
      const response = await apiRequest('/rooms');
      const roomsData = response.data || [];
      
      // Fetch schedule count for each room
      const roomsWithSchedules = await Promise.all(
        roomsData.map(async (room) => {
          try {
            const scheduleResponse = await apiRequest(`/rooms/${room.room_id}/schedules`);
            return {
              ...room,
              schedule_count: scheduleResponse.data?.length || 0,
            };
          } catch {
            return {
              ...room,
              schedule_count: 0,
            };
          }
        })
      );
      
      setRooms(roomsWithSchedules);
    } catch (err) {
      setError(err.message || 'Failed to fetch rooms');
      console.error('Error fetching rooms:', err);
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

  const fetchClasses = async () => {
    try {
      const response = await apiRequest('/classes?limit=100');
      setClasses(response.data || []);
    } catch (err) {
      console.error('Error fetching classes:', err);
    }
  };

  const fetchSchedules = async (roomId) => {
    try {
      const response = await apiRequest(`/rooms/${roomId}/schedules`);
      const schedulesData = response.data || [];
      setSchedules(schedulesData);
      
      // Initialize schedule form data based on fetched schedules
      const initialScheduleData = {
        Monday: { enabled: false, start_time: '', end_time: '' },
        Tuesday: { enabled: false, start_time: '', end_time: '' },
        Wednesday: { enabled: false, start_time: '', end_time: '' },
        Thursday: { enabled: false, start_time: '', end_time: '' },
        Friday: { enabled: false, start_time: '', end_time: '' },
        Saturday: { enabled: false, start_time: '', end_time: '' },
        Sunday: { enabled: false, start_time: '', end_time: '' },
      };
      
      // Map existing schedules to days (take the first schedule for each day if multiple exist)
      schedulesData.forEach((schedule) => {
        if (schedule.day_of_week && initialScheduleData[schedule.day_of_week] && !initialScheduleData[schedule.day_of_week].enabled) {
          const formatTimeForInput = (timeString) => {
            if (!timeString) return '';
            return timeString.substring(0, 5); // Extract HH:MM from HH:MM:SS
          };
          initialScheduleData[schedule.day_of_week] = {
            enabled: true,
            start_time: formatTimeForInput(schedule.start_time) || '',
            end_time: formatTimeForInput(schedule.end_time) || '',
          };
        }
      });
      
      setScheduleFormData(initialScheduleData);
    } catch (err) {
      console.error('Error fetching schedules:', err);
      setSchedules([]);
    }
  };

  const handleDelete = async (roomId) => {
    setOpenMenuId(null);
    if (!window.confirm('Are you sure you want to delete this room?')) {
      return;
    }

    try {
      await apiRequest(`/rooms/${roomId}`, {
        method: 'DELETE',
      });
      fetchRooms();
    } catch (err) {
      alert(err.message || 'Failed to delete room');
    }
  };

  const openCreateModal = () => {
    setEditingRoom(null);
    setError('');
    setModalStep('branch-selection');
    setSelectedBranch(null);
    setSchedules([]);
    setScheduleFormData({
      Monday: { enabled: false, start_time: '', end_time: '' },
      Tuesday: { enabled: false, start_time: '', end_time: '' },
      Wednesday: { enabled: false, start_time: '', end_time: '' },
      Thursday: { enabled: false, start_time: '', end_time: '' },
      Friday: { enabled: false, start_time: '', end_time: '' },
      Saturday: { enabled: false, start_time: '', end_time: '' },
      Sunday: { enabled: false, start_time: '', end_time: '' },
    });
    setFormData({
      room_name: '',
      branch_id: '',
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = async (room) => {
    setOpenMenuId(null);
    setEditingRoom(room);
    setError('');
    setModalStep('form');
    setSelectedBranch(branches.find(b => b.branch_id === room.branch_id) || null);
    setFormData({
      room_name: room.room_name || '',
      branch_id: room.branch_id?.toString() || '',
    });
    setFormErrors({});
    setIsModalOpen(true);
    // Fetch schedules for this room
    await fetchSchedules(room.room_id);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingRoom(null);
    setModalStep('branch-selection');
    setSelectedBranch(null);
    setSchedules([]);
    setScheduleFormData({
      Monday: { enabled: false, start_time: '', end_time: '' },
      Tuesday: { enabled: false, start_time: '', end_time: '' },
      Wednesday: { enabled: false, start_time: '', end_time: '' },
      Thursday: { enabled: false, start_time: '', end_time: '' },
      Friday: { enabled: false, start_time: '', end_time: '' },
      Saturday: { enabled: false, start_time: '', end_time: '' },
      Sunday: { enabled: false, start_time: '', end_time: '' },
    });
    setFormErrors({});
  };

  const handleBranchSelect = (branch) => {
    setSelectedBranch(branch);
    setFormData(prev => ({
      ...prev,
      branch_id: branch.branch_id.toString(),
    }));
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

  const handleScheduleChange = (day, field, value) => {
    setScheduleFormData(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        [field]: value,
      },
    }));
  };

  const handleScheduleToggle = (day) => {
    setScheduleFormData(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        enabled: !prev[day].enabled,
      },
    }));
  };


  const getClassName = (classId) => {
    const classItem = classes.find(c => c.class_id === classId);
    if (!classItem) return `Class ${classId}`;
    if (classItem.level_tag && classItem.section_name) {
      return `${classItem.level_tag} - ${classItem.section_name}`;
    }
    return classItem.level_tag || classItem.section_name || `Class ${classId}`;
  };

  const formatTime = (timeString) => {
    if (!timeString) return '';
    // Convert HH:MM:SS to HH:MM for display
    return timeString.substring(0, 5);
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
    
    if (!formData.room_name.trim()) {
      errors.room_name = 'Room name is required';
    }

    if (!editingRoom && !formData.branch_id) {
      errors.branch_id = 'Branch is required';
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
        room_name: formData.room_name.trim(),
        branch_id: formData.branch_id && formData.branch_id !== '' ? parseInt(formData.branch_id) : null,
      };
      
      let createdRoomId;
      
      if (editingRoom) {
        await apiRequest(`/rooms/${editingRoom.room_id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        createdRoomId = editingRoom.room_id;
      } else {
        // For create, branch_id is required by backend
        if (!payload.branch_id) {
          setError('Branch is required');
          setSubmitting(false);
          return;
        }
        const response = await apiRequest('/rooms', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        createdRoomId = response.data.room_id;
      }
      
      closeModal();
      fetchRooms();
    } catch (err) {
      setError(err.message || `Failed to ${editingRoom ? 'update' : 'create'} room`);
      console.error('Error saving room:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveSchedulesForRoom = async (roomId) => {
    const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    
    // Get all enabled schedules
    const enabledSchedules = daysOfWeek
      .filter(day => scheduleFormData[day].enabled)
      .map(day => ({
        day,
        ...scheduleFormData[day],
      }));

    // If no schedules are enabled, skip saving
    if (enabledSchedules.length === 0) {
      console.log('No schedules enabled, skipping save');
      return;
    }

    console.log('📅 Saving schedules for room:', roomId, 'Enabled schedules:', enabledSchedules);

    // Validate that all enabled schedules have required fields
    for (const schedule of enabledSchedules) {
      if (!schedule.start_time || !schedule.end_time) {
        const errorMsg = `Please fill in start time and end time for ${schedule.day}`;
        console.error('❌ Validation error:', errorMsg);
        throw new Error(errorMsg);
      }
    }

    // Get the branch_id for filtering classes
    const branchId = editingRoom ? editingRoom.branch_id : (selectedBranch ? selectedBranch.branch_id : parseInt(formData.branch_id));
    
    if (!branchId) {
      const errorMsg = 'No branch ID available. Cannot create schedules.';
      console.error('❌', errorMsg);
      throw new Error(errorMsg);
    }
    
    console.log('🔍 Looking for classes with branch_id:', branchId);
    console.log('📚 Available classes:', classes);
    
    // Get available classes for this branch
    const availableClasses = classes.filter(c => c.branch_id === branchId);
    
    console.log('✅ Found classes for branch:', availableClasses);
    
    // Use the first available class if exists, otherwise use null
    // This allows creating room schedules even without classes
    const defaultClassId = availableClasses.length > 0 ? availableClasses[0].class_id : null;
    console.log('📝 Using class_id:', defaultClassId || 'null (no class assigned)');

    // Delete existing schedules for this room first (if editing)
    if (editingRoom && schedules.length > 0) {
      console.log('🗑️ Deleting existing schedules...');
      for (const schedule of schedules) {
        if (schedule.day_of_week) {
          try {
            await apiRequest(`/rooms/${roomId}/schedules/${schedule.day_of_week}`, {
              method: 'DELETE',
            });
            console.log(`✅ Deleted schedule for ${schedule.day_of_week}`);
          } catch (err) {
            console.error(`❌ Error deleting schedule for ${schedule.day_of_week}:`, err);
            // Continue even if deletion fails
          }
        }
      }
    }

    // Create new schedules for enabled days
    const savedSchedules = [];
    const failedSchedules = [];
    
    for (const schedule of enabledSchedules) {
      try {
        const schedulePayload = {
          day_of_week: schedule.day,
          start_time: schedule.start_time,
          end_time: schedule.end_time,
        };
        
        // Only include class_id if a class is available
        if (defaultClassId) {
          schedulePayload.class_id = defaultClassId;
        }
        
        console.log(`💾 Saving schedule for ${schedule.day}:`, schedulePayload);
        
        const response = await apiRequest(`/rooms/${roomId}/schedules`, {
          method: 'POST',
          body: JSON.stringify(schedulePayload),
        });
        
        console.log(`✅ Successfully saved schedule for ${schedule.day}:`, response);
        savedSchedules.push(schedule.day);
      } catch (err) {
        console.error(`❌ Error saving schedule for ${schedule.day}:`, err);
        console.error('Error details:', {
          message: err.message,
          response: err.response,
          status: err.response?.status,
        });
        
        // If it's a database error about missing column, log it clearly
        if (err.message && (err.message.includes('day_of_week') || err.message.includes('migration'))) {
          console.error('⚠️ Database migration may not have been run. Please run: backend/migrations/002_add_day_of_week_to_roomschedtbl.sql');
        }
        
        failedSchedules.push({ day: schedule.day, error: err.message });
      }
    }
    
    // Log summary
    if (savedSchedules.length > 0) {
      console.log(`✅ Successfully saved ${savedSchedules.length} schedule(s):`, savedSchedules);
    }
    if (failedSchedules.length > 0) {
      console.error(`❌ Failed to save ${failedSchedules.length} schedule(s):`, failedSchedules);
      throw new Error(`Failed to save schedules for: ${failedSchedules.map(s => s.day).join(', ')}`);
    }
  };

  // Helper functions
  const getBranchName = (branchId) => {
    if (!branchId) return null;
    const branch = branches.find(b => b.branch_id === branchId);
    return branch ? branch.branch_name : null;
  };

  const getUniqueBranches = [...new Set(rooms.map(r => r.branch_id).filter(Boolean))];

  const filteredRooms = rooms.filter((room) => {
    const matchesSearch = !nameSearchTerm || 
      room.room_name?.toLowerCase().includes(nameSearchTerm.toLowerCase()) ||
      getBranchName(room.branch_id)?.toLowerCase().includes(nameSearchTerm.toLowerCase());
    
    const matchesBranch = !filterBranch || room.branch_id?.toString() === filterBranch;
    
    return matchesSearch && matchesBranch;
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
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Rooms</h1>
        <button 
          onClick={openCreateModal}
          className="btn-primary flex items-center justify-center space-x-2 w-full sm:w-auto"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>Add Room</span>
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Rooms List */}
      {filteredRooms.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-500">
            {nameSearchTerm || filterBranch
              ? 'No rooms found matching your criteria.'
              : 'No rooms found. Add your first room to get started.'}
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
                          placeholder="Search room..."
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
                    <div className="relative branch-filter-dropdown">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenBranchDropdown(!openBranchDropdown);
                        }}
                        className="flex items-center space-x-1 hover:text-gray-700"
                      >
                        <span>Branch</span>
                        {filterBranch && (
                          <span className="inline-flex items-center justify-center w-1.5 h-1.5 bg-primary-600 rounded-full"></span>
                        )}
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {openBranchDropdown && (
                        <div className="absolute left-0 mt-2 w-48 bg-white rounded-md shadow-lg z-50 border border-gray-200 max-h-60 overflow-y-auto">
                          <div className="py-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setFilterBranch('');
                                setOpenBranchDropdown(false);
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
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setFilterBranch(branchId.toString());
                                    setOpenBranchDropdown(false);
                                  }}
                                  className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
                                    filterBranch === branchId.toString() ? 'bg-gray-100 font-medium' : 'text-gray-700'
                                  }`}
                                >
                                  {branchName || `Branch ${branchId}`}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Schedules
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-[#ffffff] divide-y divide-gray-200">
                {filteredRooms.map((room) => (
                  <tr key={room.room_id}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {room.room_name || '-'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {getBranchName(room.branch_id) || '-'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          {room.schedule_count || 0} schedule{room.schedule_count !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="relative action-menu-container">
                        <button
                          onClick={(e) => handleMenuClick(room.room_id, e)}
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
      {filteredRooms.length > 0 && (
        <div className="text-sm text-gray-500 text-center">
          Showing {filteredRooms.length} of {rooms.length} rooms
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
                  const selectedRoom = filteredRooms.find(r => r.room_id === openMenuId);
                  if (selectedRoom) {
                    setOpenMenuId(null);
                    setMenuPosition({ top: undefined, bottom: undefined, right: undefined, left: undefined });
                    openEditModal(selectedRoom);
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

      {/* Create/Edit Room Modal */}
      {isModalOpen && createPortal(
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4"
          onClick={closeModal}
        >
          <div 
            className={`bg-white rounded-lg shadow-xl ${modalStep === 'branch-selection' ? 'max-w-md w-full' : 'max-w-4xl w-full max-h-[90vh]'} flex flex-col overflow-hidden`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0 bg-white rounded-t-lg">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                  {editingRoom ? 'Edit Room' : modalStep === 'branch-selection' ? 'Select Branch' : 'Create New Room'}
                </h2>
                {modalStep === 'form' && !editingRoom && (
                  <p className="text-sm text-gray-500 mt-1">Fill in the details to create a new room</p>
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
                        setModalStep('form');
                      }
                    }}
                    disabled={!selectedBranch}
                    className="px-4 py-2 text-sm font-medium text-gray-900 bg-[#F7C844] hover:bg-[#F5B82E] rounded-lg transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                  >
                    Continue
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
                      <label htmlFor="room_name" className="label-field">
                        Room Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        id="room_name"
                        name="room_name"
                        value={formData.room_name}
                        onChange={handleInputChange}
                        className={`input-field ${formErrors.room_name ? 'border-red-500' : ''}`}
                        required
                        placeholder="e.g., Room 101, Lab A, Auditorium"
                      />
                      {formErrors.room_name && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.room_name}</p>
                      )}
                    </div>

                    <div className="md:col-span-2">
                      <label htmlFor="branch_id" className="label-field">
                        Branch {!editingRoom && <span className="text-red-500">*</span>}
                      </label>
                      {!editingRoom && selectedBranch ? (
                        <div>
                          <input
                            type="text"
                            value={selectedBranch.branch_name}
                            readOnly
                            className="input-field bg-gray-50 cursor-not-allowed"
                          />
                          <p className="mt-1 text-xs text-gray-500">Branch was selected in the previous step</p>
                        </div>
                      ) : (
                        <select
                          id="branch_id"
                          name="branch_id"
                          value={formData.branch_id}
                          onChange={handleInputChange}
                          className={`input-field ${formErrors.branch_id ? 'border-red-500' : ''}`}
                          required={!editingRoom}
                        >
                          <option value="">Select Branch {editingRoom && '(Optional)'}</option>
                          {branches.map((branch) => (
                            <option key={branch.branch_id} value={branch.branch_id}>
                              {branch.branch_name}
                            </option>
                          ))}
                        </select>
                      )}
                      {formErrors.branch_id && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.branch_id}</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
                <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 flex-shrink-0 bg-white rounded-b-lg">
                {!editingRoom && selectedBranch && (
                  <button
                    type="button"
                    onClick={handleBackToBranchSelection}
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
                    editingRoom ? 'Update Room' : 'Create Room'
                  )}
                </button>
                </div>
              </form>
            )}
          </div>
        </div>,
        document.body
      )}

    </div>
  );
};

export default Room;

