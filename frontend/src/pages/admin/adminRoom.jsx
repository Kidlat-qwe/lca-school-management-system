import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';

const AdminRoom = () => {
  const { userInfo } = useAuth();
  // Get admin's branch_id from userInfo
  const adminBranchId = userInfo?.branch_id || userInfo?.branchId;
  const [selectedBranchName, setSelectedBranchName] = useState(userInfo?.branch_name || 'Your Branch');
  
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nameSearchTerm, setNameSearchTerm] = useState('');
  const [openMenuId, setOpenMenuId] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalStep, setModalStep] = useState('form'); // Removed branch-selection - admin only sees their branch
  const [editingRoom, setEditingRoom] = useState(null);
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
    if (adminBranchId) {
      fetchRooms();
      fetchClasses();
    }
  }, [adminBranchId]);

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
    };

    if (openMenuId) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [openMenuId]);

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
      // Backend automatically filters by admin's branch_id
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

  // Removed fetchBranches - admin only sees their branch

  const fetchClasses = async () => {
    try {
      // Filter by admin's branch
      const response = await apiRequest(`/classes?branch_id=${adminBranchId}&limit=100`);
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
    
    // Verify room belongs to admin's branch
    const room = rooms.find(r => r.room_id === roomId);
    if (room && room.branch_id !== adminBranchId) {
      alert('You can only delete rooms from your branch.');
      return;
    }
    
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
    setModalStep('form'); // Removed branch-selection - admin only sees their branch
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
      branch_id: adminBranchId?.toString() || '',
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = async (room) => {
    setOpenMenuId(null);
    
    // Verify room belongs to admin's branch
    if (room.branch_id !== adminBranchId) {
      alert('You can only edit rooms from your branch.');
      return;
    }
    
    setEditingRoom(room);
    setError('');
    setModalStep('form');
    setFormData({
      room_name: room.room_name || '',
      branch_id: room.branch_id?.toString() || adminBranchId?.toString() || '',
    });
    setFormErrors({});
    setIsModalOpen(true);
    // Fetch schedules for this room
    await fetchSchedules(room.room_id);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingRoom(null);
    setModalStep('form'); // Removed branch-selection step
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

  // Removed handleBranchSelect and handleBackToBranchSelection - admin only sees their branch

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

  // Auto-set branch_id from adminBranchId when available
  useEffect(() => {
    if (adminBranchId && isModalOpen && !editingRoom) {
      setFormData(prev => {
        if (prev.branch_id) return prev; // Don't overwrite if already set
        return {
          ...prev,
          branch_id: adminBranchId.toString(),
        };
      });
    }
  }, [adminBranchId, isModalOpen, editingRoom]);

  const validateForm = () => {
    const errors = {};
    
    if (!formData.room_name.trim()) {
      errors.room_name = 'Room name is required';
    }

    // Branch is automatically set for admin, no need to validate

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
        // For create, branch_id is automatically set from adminBranchId
        if (!payload.branch_id) {
          payload.branch_id = adminBranchId;
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
    const branchId = editingRoom ? editingRoom.branch_id : adminBranchId;
    
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
  // Removed getBranchName and getUniqueBranches - admin only sees their branch

  const filteredRooms = rooms.filter((room) => {
    const matchesSearch = !nameSearchTerm || 
      room.room_name?.toLowerCase().includes(nameSearchTerm.toLowerCase());
    
    // Backend already filters by branch, so no need to filter here
    return matchesSearch;
  });

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
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Rooms</h1>
          <p className="text-sm text-gray-500 mt-1">{selectedBranchName}</p>
        </div>
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
            {nameSearchTerm
              ? 'No rooms found matching your criteria.'
              : 'No rooms found. Add your first room to get started.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow">
          {/* Desktop Table View */}
          <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
            <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '600px' }}>
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
                  {/* Removed Branch column - admin only sees their branch */}
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
                    {/* Removed Branch column - admin only sees their branch */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
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
            className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0 bg-white rounded-t-lg">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                  {editingRoom ? 'Edit Room' : 'Create New Room'}
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
            {/* Removed branch selection step - admin only sees their branch */}
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
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
                <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 flex-shrink-0 bg-white rounded-b-lg">
                {/* Removed Back button - no branch selection step */}
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
          </div>
        </div>,
        document.body
      )}

    </div>
  );
};

export default AdminRoom;

