import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';

const RECIPIENT_GROUPS = [
  { value: 'All', label: 'All' },
  { value: 'Students', label: 'Students' },
  { value: 'Teachers', label: 'Teachers' },
  { value: 'Admin', label: 'Admin' },
  { value: 'Finance', label: 'Finance' },
];

const STATUS_OPTIONS = [
  { value: 'Active', label: 'Active' },
  { value: 'Inactive', label: 'Inactive' },
  { value: 'Draft', label: 'Draft' },
];

const PRIORITY_OPTIONS = [
  { value: 'High', label: 'High' },
  { value: 'Medium', label: 'Medium' },
  { value: 'Low', label: 'Low' },
];

/** Format date-time in Philippines time (UTC+8) for display */
const formatInPHTime = (isoOrDateString, options = {}) => {
  if (!isoOrDateString) return 'N/A';
  const d = new Date(isoOrDateString);
  if (Number.isNaN(d.getTime())) return 'N/A';
  return d.toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short', ...options });
};

/** Format date only in Philippines time (UTC+8) */
const formatDateInPH = (isoOrDateString) => {
  if (!isoOrDateString) return 'N/A';
  const d = new Date(isoOrDateString);
  if (Number.isNaN(d.getTime())) return 'N/A';
  return d.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' });
};

const TeacherAnnouncements = () => {
  const { userInfo } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [titleSearchTerm, setTitleSearchTerm] = useState('');
  const [filterRecipientGroup, setFilterRecipientGroup] = useState('');
  const [filterCreatedOn, setFilterCreatedOn] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const [openRecipientGroupDropdown, setOpenRecipientGroupDropdown] = useState(false);
  const [openStatusDropdown, setOpenStatusDropdown] = useState(false);
  const [openOptionsDropdown, setOpenOptionsDropdown] = useState(false);
  const [optionsMenuPosition, setOptionsMenuPosition] = useState({ top: 0, right: 0 });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [viewingAnnouncement, setViewingAnnouncement] = useState(null);
  const [editingAnnouncement, setEditingAnnouncement] = useState(null);
  const [formData, setFormData] = useState({
    title: '',
    body: '',
    recipient_groups: [],
    status: 'Active',
    priority: 'Medium',
    branch_id: '',
    start_date: '',
    end_date: '',
  });
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(15);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [highlightedAnnouncementId, setHighlightedAnnouncementId] = useState(null);
  const highlightedRowRef = useRef(null);

  useEffect(() => {
    fetchAnnouncements();
  }, [currentPage, itemsPerPage]);

  // Handle highlighting announcement from notification click
  useEffect(() => {
    const highlightId = searchParams.get('highlight');
    if (highlightId && announcements.length > 0) {
      const announcementId = parseInt(highlightId);
      const announcement = announcements.find(a => a.announcement_id === announcementId);
      
      if (announcement) {
        // Set highlighted ID
        setHighlightedAnnouncementId(announcementId);
        
        // Scroll to the highlighted row after a short delay to ensure DOM is ready
        setTimeout(() => {
          if (highlightedRowRef.current) {
            highlightedRowRef.current.scrollIntoView({ 
              behavior: 'smooth', 
              block: 'center' 
            });
          }
        }, 100);
        
        // Remove highlight after 5 seconds
        const timer = setTimeout(() => {
          setHighlightedAnnouncementId(null);
          // Remove query parameter from URL
          searchParams.delete('highlight');
          setSearchParams(searchParams, { replace: true });
        }, 5000);
        
        return () => clearTimeout(timer);
      } else {
        // Announcement not found in current page, remove query param
        searchParams.delete('highlight');
        setSearchParams(searchParams, { replace: true });
      }
    }
  }, [searchParams, announcements]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (openMenuId && !event.target.closest('.action-menu-container') && !event.target.closest('.action-menu-overlay')) {
        setOpenMenuId(null);
      }
      if (openRecipientGroupDropdown && !event.target.closest('.recipient-group-filter-dropdown')) {
        setOpenRecipientGroupDropdown(false);
      }
      if (openStatusDropdown && !event.target.closest('.status-filter-dropdown')) {
        setOpenStatusDropdown(false);
      }
      if (openOptionsDropdown && !event.target.closest('.options-menu-container') && !event.target.closest('.options-menu-overlay')) {
        setOpenOptionsDropdown(false);
      }
    };

    if (openMenuId || openRecipientGroupDropdown || openStatusDropdown || openOptionsDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [openMenuId, openRecipientGroupDropdown, openStatusDropdown, openOptionsDropdown]);

  const handleMenuClick = (announcementId, event) => {
    event.stopPropagation();
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    
    if (openMenuId === announcementId) {
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
      setOpenMenuId(announcementId);
    }
  };

  const handleOptionsMenuClick = (event) => {
    event.stopPropagation();
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    
    if (openOptionsDropdown) {
      setOpenOptionsDropdown(false);
      setOptionsMenuPosition({ top: 0, right: 0 });
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
      
      setOptionsMenuPosition({
        top: top !== 'auto' ? top : undefined,
        bottom: bottom !== 'auto' ? bottom : undefined,
        right: right !== 'auto' ? right : undefined,
        left: left !== 'auto' ? left : undefined,
      });
      setOpenOptionsDropdown(true);
    }
  };

  const fetchAnnouncements = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: itemsPerPage.toString(),
      });

      if (titleSearchTerm) {
        params.append('title', titleSearchTerm);
      }
      if (filterRecipientGroup) {
        params.append('recipient_group', filterRecipientGroup);
      }
      if (filterCreatedOn) {
        params.append('created_on', filterCreatedOn);
      }
      if (filterStatus) {
        params.append('status', filterStatus);
      }

      const response = await apiRequest(`/announcements?${params.toString()}`);
      setAnnouncements(response.data || []);
      setTotalItems(response.pagination?.total || 0);
      setTotalPages(response.pagination?.totalPages || 0);
    } catch (err) {
      setError(err.message || 'Failed to fetch announcements');
      console.error('Error fetching announcements:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (announcementId) => {
    setOpenMenuId(null);
    if (!window.confirm('Are you sure you want to delete this announcement?')) {
      return;
    }

    try {
      await apiRequest(`/announcements/${announcementId}`, {
        method: 'DELETE',
      });
      fetchAnnouncements();
    } catch (err) {
      alert(err.message || 'Failed to delete announcement');
    }
  };

  const openCreateModal = () => {
    setEditingAnnouncement(null);
    setError('');
    const userBranchId = userInfo?.branchId || userInfo?.branch_id;
    setFormData({
      title: '',
      body: '',
      recipient_groups: [],
      status: 'Active',
      priority: 'Medium',
      branch_id: userBranchId ? userBranchId.toString() : '',
      start_date: '',
      end_date: '',
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const formatDateForInput = (dateValue) => {
    if (!dateValue) return '';
    if (typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateValue)) {
      return dateValue.split('T')[0];
    }
    try {
      const date = new Date(dateValue);
      if (isNaN(date.getTime())) return '';
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    } catch (e) {
      return '';
    }
  };

  const openEditModal = (announcement) => {
    setOpenMenuId(null);
    setEditingAnnouncement(announcement);
    setError('');
    const userBranchId = userInfo?.branchId || userInfo?.branch_id;
    setFormData({
      title: announcement.title || '',
      body: announcement.body || '',
      recipient_groups: announcement.recipient_groups || [],
      status: announcement.status || 'Active',
      priority: announcement.priority || 'Medium',
      branch_id: userBranchId ? userBranchId.toString() : '',
      start_date: formatDateForInput(announcement.start_date),
      end_date: formatDateForInput(announcement.end_date),
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingAnnouncement(null);
    setFormErrors({});
    setFormData({
      title: '',
      body: '',
      recipient_groups: [],
      status: 'Active',
      priority: 'Medium',
      branch_id: '',
      start_date: '',
      end_date: '',
    });
  };

  const openViewModal = (announcement) => {
    setViewingAnnouncement(announcement);
    setIsViewModalOpen(true);
    setOpenMenuId(null);
  };

  const closeViewModal = () => {
    setIsViewModalOpen(false);
    setViewingAnnouncement(null);
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

  const handleRecipientGroupToggle = (group) => {
    setFormData((prev) => {
      const currentGroups = prev.recipient_groups || [];
      if (currentGroups.includes(group)) {
        return {
          ...prev,
          recipient_groups: currentGroups.filter(g => g !== group),
        };
      } else {
        return {
          ...prev,
          recipient_groups: [...currentGroups, group],
        };
      }
    });
  };

  const validateForm = () => {
    const errors = {};
    
    if (!formData.title.trim()) {
      errors.title = 'Title is required';
    }

    if (!formData.body.trim()) {
      errors.body = 'Body is required';
    }

    if (!formData.recipient_groups || formData.recipient_groups.length === 0) {
      errors.recipient_groups = 'At least one recipient group is required';
    }

    if (!formData.status) {
      errors.status = 'Status is required';
    }

    if (!formData.priority) {
      errors.priority = 'Priority is required';
    }

    if (!formData.start_date || formData.start_date.trim() === '') {
      errors.start_date = 'Start date is required';
    }

    if (!formData.end_date || formData.end_date.trim() === '') {
      errors.end_date = 'End date is required';
    }

    if (formData.start_date && formData.end_date) {
      if (new Date(formData.start_date) > new Date(formData.end_date)) {
        errors.end_date = 'End date must be after or equal to start date';
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
    setError('');
    try {
      // For Admin/Teacher, always use their branch_id
      const userBranchId = userInfo?.branchId || userInfo?.branch_id;
      const payload = {
        title: formData.title.trim(),
        body: formData.body.trim(),
        recipient_groups: formData.recipient_groups,
        status: formData.status,
        priority: formData.priority,
        branch_id: userBranchId || null,
        start_date: formData.start_date && formData.start_date.trim() !== '' ? formData.start_date : null,
        end_date: formData.end_date && formData.end_date.trim() !== '' ? formData.end_date : null,
      };

      if (editingAnnouncement) {
        await apiRequest(`/announcements/${editingAnnouncement.announcement_id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await apiRequest('/announcements', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      
      closeModal();
      fetchAnnouncements();
    } catch (err) {
      console.error('Error saving announcement:', err);
      let errorMessage = `Failed to ${editingAnnouncement ? 'update' : 'create'} announcement`;
      
      if (err.response?.data?.errors && Array.isArray(err.response.data.errors)) {
        const errorMessages = err.response.data.errors.map(e => {
          const field = e.param || e.path || 'field';
          return `${field}: ${e.msg}`;
        });
        errorMessage = errorMessages.join('; ');
      } else if (err.response?.data?.message) {
        errorMessage = err.response.data.message;
      } else if (err.message) {
        errorMessage = err.message;
      }
      
      setError(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSearch = () => {
    setCurrentPage(1);
    fetchAnnouncements();
  };

  const handleReset = () => {
    setTitleSearchTerm('');
    setFilterRecipientGroup('');
    setFilterCreatedOn('');
    setFilterStatus('');
    setCurrentPage(1);
    setTimeout(() => {
      fetchAnnouncements();
    }, 0);
  };

  const getStatusBadgeColor = (status) => {
    switch (status) {
      case 'Active':
        return 'bg-green-100 text-green-800';
      case 'Inactive':
        return 'bg-gray-100 text-gray-800';
      case 'Draft':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getPriorityBadgeColor = (priority) => {
    switch (priority) {
      case 'High':
        return 'bg-red-100 text-red-800';
      case 'Medium':
        return 'bg-yellow-100 text-yellow-800';
      case 'Low':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const formatRecipientGroups = (groups) => {
    if (!groups || groups.length === 0) return 'N/A';
    return groups.join(', ');
  };

  const truncateText = (text, maxLength = 40) => {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  if (loading && announcements.length === 0) {
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
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">ANNOUNCEMENTS</h1>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Search Filter Section */}
      <div className="bg-white rounded-lg shadow-sm p-4">
        <h2 className="text-base font-semibold text-gray-900 mb-3">Search Filter</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label htmlFor="title-search" className="block text-xs font-medium text-gray-700 mb-1">
              Announcement Title
            </label>
            <input
              type="text"
              id="title-search"
              value={titleSearchTerm}
              onChange={(e) => setTitleSearchTerm(e.target.value)}
              placeholder="Search by title..."
              className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
          <div className="relative">
            <label htmlFor="recipient-group-filter" className="block text-xs font-medium text-gray-700 mb-1">
              Recipient Group
            </label>
            <div className="recipient-group-filter-dropdown relative">
              <button
                type="button"
                onClick={() => setOpenRecipientGroupDropdown(!openRecipientGroupDropdown)}
                className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white text-left flex items-center justify-between focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              >
                <span>{filterRecipientGroup || 'All'}</span>
                {filterRecipientGroup && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setFilterRecipientGroup('');
                    }}
                    className="ml-2 text-gray-400 hover:text-gray-600"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {openRecipientGroupDropdown && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-auto">
                  {RECIPIENT_GROUPS.map((group) => (
                    <button
                      key={group.value}
                      type="button"
                      onClick={() => {
                        setFilterRecipientGroup(group.value);
                        setOpenRecipientGroupDropdown(false);
                      }}
                      className={`w-full px-3 py-2 text-sm text-left hover:bg-primary-50 ${
                        filterRecipientGroup === group.value ? 'bg-primary-100' : ''
                      }`}
                    >
                      {group.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div>
            <label htmlFor="created-on-filter" className="block text-xs font-medium text-gray-700 mb-1">
              Announcement Created On
            </label>
            <input
              type="date"
              id="created-on-filter"
              value={filterCreatedOn}
              onChange={(e) => setFilterCreatedOn(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
            className="text-primary-600 hover:text-primary-700 flex items-center space-x-1 text-sm"
          >
            <span>advanced filters</span>
            <svg
              className={`w-3.5 h-3.5 transform transition-transform ${showAdvancedFilters ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <div className="flex space-x-2">
            <button
              type="button"
              onClick={handleReset}
              className="px-3 py-1.5 text-sm border border-primary-600 text-primary-600 rounded-lg hover:bg-primary-50"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={handleSearch}
              className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              Search
            </button>
          </div>
        </div>
        {showAdvancedFilters && (
          <div className="mt-3 pt-3 border-t border-gray-200">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="relative">
                <label htmlFor="status-filter" className="block text-xs font-medium text-gray-700 mb-1">
                  Status
                </label>
                <div className="status-filter-dropdown relative">
                  <button
                    type="button"
                    onClick={() => setOpenStatusDropdown(!openStatusDropdown)}
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white text-left flex items-center justify-between focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  >
                    <span>{filterStatus || 'All'}</span>
                    {filterStatus && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setFilterStatus('');
                        }}
                        className="ml-2 text-gray-400 hover:text-gray-600"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {openStatusDropdown && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-auto">
                      <button
                        type="button"
                        onClick={() => {
                          setFilterStatus('');
                          setOpenStatusDropdown(false);
                        }}
                        className="w-full px-3 py-2 text-sm text-left hover:bg-primary-50"
                      >
                        All
                      </button>
                      {STATUS_OPTIONS.map((status) => (
                        <button
                          key={status.value}
                          type="button"
                          onClick={() => {
                            setFilterStatus(status.value);
                            setOpenStatusDropdown(false);
                          }}
                          className={`w-full px-3 py-2 text-sm text-left hover:bg-primary-50 ${
                            filterStatus === status.value ? 'bg-primary-100' : ''
                          }`}
                        >
                          {status.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Table Section */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <button
            onClick={openCreateModal}
            className="btn-primary flex items-center justify-center space-x-2 w-full sm:w-auto"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>Create</span>
          </button>
          <div className="relative options-menu-container">
            <button
              onClick={handleOptionsMenuClick}
              className="btn-primary flex items-center justify-center space-x-2"
            >
              <span>Options</span>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {openOptionsDropdown && (
              <>
                <div
                  className="options-menu-overlay fixed inset-0 z-40"
                  onClick={() => setOpenOptionsDropdown(false)}
                  onMouseDown={(e) => e.stopPropagation()}
                />
                {createPortal(
                  <div
                    className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[192px]"
                    style={{
                      ...(optionsMenuPosition.top !== undefined && { top: `${optionsMenuPosition.top}px` }),
                      ...(optionsMenuPosition.bottom !== undefined && { bottom: `${optionsMenuPosition.bottom}px` }),
                      ...(optionsMenuPosition.right !== undefined && { right: `${optionsMenuPosition.right}px` }),
                      ...(optionsMenuPosition.left !== undefined && { left: `${optionsMenuPosition.left}px` }),
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        // Export functionality can be added here
                        setOpenOptionsDropdown(false);
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                    >
                      Export to CSV
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        // Print functionality can be added here
                        setOpenOptionsDropdown(false);
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                    >
                      Print
                    </button>
                  </div>,
                  document.body
                )}
              </>
            )}
          </div>
        </div>

        {/* Table */}
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
            style={{ width: '100%', minWidth: '1000px' }}
          >
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[12%]">
                  <div className="flex items-center space-x-1">
                    <span>RECIPIENT GROUP</span>
                    <div className="flex flex-col">
                      <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                      </svg>
                      <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[18%]">
                  <div className="flex items-center space-x-1">
                    <span>TITLE</span>
                    <div className="flex flex-col">
                      <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                      </svg>
                      <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[20%]">
                  <div className="flex items-center space-x-1">
                    <span>BODY</span>
                    <div className="flex flex-col">
                      <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                      </svg>
                      <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[12%]">
                  <div className="flex items-center space-x-1">
                    <span>CREATED BY</span>
                    <div className="flex flex-col">
                      <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                      </svg>
                      <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[12%]">
                  <div className="flex items-center space-x-1">
                    <span>CREATED ON</span>
                    <div className="flex flex-col">
                      <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                      </svg>
                      <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[10%]">
                  <div className="flex items-center space-x-1">
                    <span>STATUS</span>
                    <div className="flex flex-col">
                      <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                      </svg>
                      <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[4%]">
                  ACTIONS
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {announcements.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-3 py-12 text-center text-gray-500">
                    No data for table
                  </td>
                </tr>
              ) : (
                announcements.map((announcement) => (
                  <tr 
                    key={announcement.announcement_id} 
                    ref={highlightedAnnouncementId === announcement.announcement_id ? highlightedRowRef : null}
                    className={`hover:bg-gray-50 transition-all duration-300 ${
                      highlightedAnnouncementId === announcement.announcement_id 
                        ? 'bg-yellow-200 ring-2 ring-yellow-400 ring-offset-2' 
                        : ''
                    }`}
                  >
                    <td className="px-3 py-3 text-xs text-gray-900">
                      <div className="truncate" title={formatRecipientGroups(announcement.recipient_groups)}>
                        {formatRecipientGroups(announcement.recipient_groups)}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-900">
                      <div className="truncate" title={announcement.title}>
                        {announcement.title}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-900">
                      <div className="truncate" title={announcement.body}>
                        {truncateText(announcement.body, 40)}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-900">
                      <div className="truncate" title={announcement.created_by_name || 'N/A'}>
                        {announcement.created_by_name || 'N/A'}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-900 whitespace-nowrap">
                      {formatDateInPH(announcement.created_at)}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getStatusBadgeColor(announcement.status)}`}>
                        {announcement.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-sm">
                      {(() => {
                        const currentUserId = userInfo?.user_id || userInfo?.userId;
                        const isOwner = announcement.created_by === currentUserId;
                        
                        if (!isOwner) {
                          return <span className="text-xs text-gray-400">-</span>;
                        }
                        
                        return (
                          <div className="relative action-menu-container">
                            <button
                              onClick={(e) => handleMenuClick(announcement.announcement_id, e)}
                              className="text-gray-400 hover:text-gray-600 focus:outline-none"
                            >
                              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                              </svg>
                            </button>
                            {openMenuId === announcement.announcement_id && (
                              <>
                                <div
                                  className="action-menu-overlay fixed inset-0 z-40"
                                  onClick={() => setOpenMenuId(null)}
                                  onMouseDown={(e) => e.stopPropagation()}
                                />
                                {createPortal(
                                  <div
                                    className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[192px]"
                                    style={{
                                      ...(menuPosition.top !== undefined && { top: `${menuPosition.top}px` }),
                                      ...(menuPosition.bottom !== undefined && { bottom: `${menuPosition.bottom}px` }),
                                      ...(menuPosition.right !== undefined && { right: `${menuPosition.right}px` }),
                                      ...(menuPosition.left !== undefined && { left: `${menuPosition.left}px` }),
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    onMouseDown={(e) => e.stopPropagation()}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => openViewModal(announcement)}
                                      className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                                    >
                                      View Details
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => openEditModal(announcement)}
                                      className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDelete(announcement.announcement_id)}
                                      className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                                    >
                                      Delete
                                    </button>
                                  </div>,
                                  document.body
                                )}
                              </>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-700">Showing</span>
            <select
              value={itemsPerPage}
              onChange={(e) => {
                setItemsPerPage(parseInt(e.target.value));
                setCurrentPage(1);
              }}
              className="px-3 py-1 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              <option value={15}>15</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span className="text-sm text-gray-700">to</span>
            <span className="text-sm text-gray-700">
              {totalItems > 0 ? Math.min((currentPage - 1) * itemsPerPage + 1, totalItems) : 0} - {Math.min(currentPage * itemsPerPage, totalItems)} of {totalItems} entries
            </span>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 border border-gray-300 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              &lt;
            </button>
            <span className="px-3 py-1 bg-primary-600 text-white rounded-lg text-sm">
              {currentPage}
            </span>
            <button
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage >= totalPages}
              className="px-3 py-1 border border-gray-300 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              &gt;
            </button>
            <span className="text-sm text-gray-700">Go to page</span>
            <input
              type="number"
              min="1"
              max={totalPages}
              value={currentPage}
              onChange={(e) => {
                const page = parseInt(e.target.value);
                if (page >= 1 && page <= totalPages) {
                  setCurrentPage(page);
                }
              }}
              className="w-16 px-2 py-1 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
            <button
              onClick={() => {
                if (currentPage >= 1 && currentPage <= totalPages) {
                  fetchAnnouncements();
                }
              }}
              className="px-3 py-1 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700"
            >
              Go
            </button>
          </div>
        </div>
      </div>

      {/* Create/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75" onClick={closeModal}></div>
            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-3xl sm:w-full">
              <form onSubmit={handleSubmit}>
                <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">
                    {editingAnnouncement ? 'Edit Announcement' : 'Create Announcement'}
                  </h3>
                  
                  {error && (
                    <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                      {error}
                    </div>
                  )}

                  <div className="space-y-4">
                    <div>
                      <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">
                        Title <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        id="title"
                        name="title"
                        value={formData.title}
                        onChange={handleInputChange}
                        required
                        className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 ${
                          formErrors.title ? 'border-red-500' : 'border-gray-300'
                        }`}
                      />
                      {formErrors.title && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.title}</p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="body" className="block text-sm font-medium text-gray-700 mb-2">
                        Body <span className="text-red-500">*</span>
                      </label>
                      <textarea
                        id="body"
                        name="body"
                        value={formData.body}
                        onChange={handleInputChange}
                        required
                        rows={6}
                        className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 ${
                          formErrors.body ? 'border-red-500' : 'border-gray-300'
                        }`}
                      />
                      {formErrors.body && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.body}</p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Recipient Groups <span className="text-red-500">*</span>
                      </label>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {RECIPIENT_GROUPS.map((group) => (
                          <label key={group.value} className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              checked={formData.recipient_groups.includes(group.value)}
                              onChange={() => handleRecipientGroupToggle(group.value)}
                              className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                            />
                            <span className="text-sm text-gray-700">{group.label}</span>
                          </label>
                        ))}
                      </div>
                      {formErrors.recipient_groups && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.recipient_groups}</p>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="status" className="block text-sm font-medium text-gray-700 mb-2">
                          Status <span className="text-red-500">*</span>
                        </label>
                        <select
                          id="status"
                          name="status"
                          value={formData.status}
                          onChange={handleInputChange}
                          required
                          className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 ${
                            formErrors.status ? 'border-red-500' : 'border-gray-300'
                          }`}
                        >
                          {STATUS_OPTIONS.map((status) => (
                            <option key={status.value} value={status.value}>
                              {status.label}
                            </option>
                          ))}
                        </select>
                        {formErrors.status && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.status}</p>
                        )}
                      </div>

                      <div>
                        <label htmlFor="priority" className="block text-sm font-medium text-gray-700 mb-2">
                          Priority <span className="text-red-500">*</span>
                        </label>
                        <select
                          id="priority"
                          name="priority"
                          value={formData.priority}
                          onChange={handleInputChange}
                          required
                          className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 ${
                            formErrors.priority ? 'border-red-500' : 'border-gray-300'
                          }`}
                        >
                          {PRIORITY_OPTIONS.map((priority) => (
                            <option key={priority.value} value={priority.value}>
                              {priority.label}
                            </option>
                          ))}
                        </select>
                        {formErrors.priority && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.priority}</p>
                        )}
                      </div>
                    </div>

                    <div>
                      <label htmlFor="branch_id" className="block text-sm font-medium text-gray-700 mb-2">
                        Branch
                      </label>
                      <input
                        type="text"
                        id="branch_id"
                        value={userInfo?.branchName || 'Your Branch'}
                        disabled
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-100 text-gray-600 cursor-not-allowed"
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="start_date" className="block text-sm font-medium text-gray-700 mb-2">
                          Start Date <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="date"
                          id="start_date"
                          name="start_date"
                          value={formData.start_date}
                          onChange={handleInputChange}
                          required
                          className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 ${
                            formErrors.start_date ? 'border-red-500' : 'border-gray-300'
                          }`}
                        />
                        {formErrors.start_date && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.start_date}</p>
                        )}
                      </div>

                      <div>
                        <label htmlFor="end_date" className="block text-sm font-medium text-gray-700 mb-2">
                          End Date <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="date"
                          id="end_date"
                          name="end_date"
                          value={formData.end_date}
                          onChange={handleInputChange}
                          required
                          className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 ${
                            formErrors.end_date ? 'border-red-500' : 'border-gray-300'
                          }`}
                        />
                        {formErrors.end_date && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.end_date}</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full inline-flex justify-center rounded-lg border border-transparent shadow-sm px-4 py-2 bg-primary-600 text-base font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
                  >
                    {submitting ? 'Saving...' : editingAnnouncement ? 'Update' : 'Create'}
                  </button>
                  <button
                    type="button"
                    onClick={closeModal}
                    className="mt-3 w-full inline-flex justify-center rounded-lg border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* View Details Modal */}
      {isViewModalOpen && viewingAnnouncement && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75" onClick={closeViewModal}></div>
            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-3xl sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium text-gray-900">
                    Announcement Details
                  </h3>
                  <button
                    type="button"
                    onClick={closeViewModal}
                    className="text-gray-400 hover:text-gray-500 focus:outline-none"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Title
                    </label>
                    <div className="text-sm text-gray-900 bg-gray-50 px-4 py-2 rounded-lg">
                      {viewingAnnouncement.title}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Body
                    </label>
                    <div className="text-sm text-gray-900 bg-gray-50 px-4 py-3 rounded-lg whitespace-pre-wrap max-h-96 overflow-y-auto">
                      {viewingAnnouncement.body}
                    </div>
                  </div>

                  {viewingAnnouncement.attachment_url && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Attachment
                      </label>
                      <a
                        href={viewingAnnouncement.attachment_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-primary-600 hover:underline"
                      >
                        Open attached file
                      </a>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Recipient Groups
                      </label>
                      <div className="text-sm text-gray-900 bg-gray-50 px-4 py-2 rounded-lg">
                        {formatRecipientGroups(viewingAnnouncement.recipient_groups)}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Branch
                      </label>
                      <div className="text-sm text-gray-900 bg-gray-50 px-4 py-2 rounded-lg">
                        {viewingAnnouncement.branch_name || 'All Branches'}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Status
                      </label>
                      <div className="text-sm">
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getStatusBadgeColor(viewingAnnouncement.status)}`}>
                          {viewingAnnouncement.status}
                        </span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Priority
                      </label>
                      <div className="text-sm">
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getPriorityBadgeColor(viewingAnnouncement.priority)}`}>
                          {viewingAnnouncement.priority}
                        </span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Created By
                      </label>
                      <div className="text-sm text-gray-900 bg-gray-50 px-4 py-2 rounded-lg">
                        {viewingAnnouncement.created_by_name || 'N/A'}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Created On <span className="text-gray-500 font-normal">(Philippines, UTC+8)</span>
                      </label>
                      <div className="text-sm text-gray-900 bg-gray-50 px-4 py-2 rounded-lg">
                        {formatInPHTime(viewingAnnouncement.created_at)}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Start Date
                      </label>
                      <div className="text-sm text-gray-900 bg-gray-50 px-4 py-2 rounded-lg">
                        {viewingAnnouncement.start_date ? formatDateInPH(viewingAnnouncement.start_date) : 'No start date'}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        End Date
                      </label>
                      <div className="text-sm text-gray-900 bg-gray-50 px-4 py-2 rounded-lg">
                        {viewingAnnouncement.end_date ? formatDateInPH(viewingAnnouncement.end_date) : 'No end date'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={closeViewModal}
                  className="w-full inline-flex justify-center rounded-lg border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 sm:w-auto sm:text-sm"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TeacherAnnouncements;
