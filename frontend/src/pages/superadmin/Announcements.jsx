import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import API_BASE_URL, { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';
import { useGlobalBranchFilter } from '../../contexts/GlobalBranchFilterContext';
import { formatDateManila } from '../../utils/dateUtils';
import FixedTablePagination, { TablePaginationSummary } from '../../components/table/FixedTablePagination';
import { appAlert, appConfirm } from '../../utils/appAlert';
import AnnouncementAttachmentPreview, { isAnnouncementImageFile } from '../../components/announcementAttachment';
import AnnouncementSendEmailToggle from '../../components/announcementSendEmailToggle';
import {
  AnnouncementBoardFilters,
  AnnouncementTableLoadingShell,
  useAnnouncementBoardList,
} from '../../components/announcementBoardFilters';
import {
  expandAnnouncementRecipientGroupsForForm,
  normalizeAnnouncementRecipientGroupsForSubmit,
  toggleAnnouncementRecipientGroups,
} from '../../utils/announcementRecipientGroups';

const RECIPIENT_GROUPS = [
  { value: 'All', label: 'All' },
  { value: 'Students', label: 'Students' },
  { value: 'Teachers', label: 'Teachers' },
  { value: 'Admin', label: 'Admin' },
  { value: 'Finance', label: 'Finance' },
  { value: 'Superadmin', label: 'Superadmin' },
  { value: 'Superfinance', label: 'Superfinance' },
  { value: 'Guardians', label: 'Guardians' },
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

const Announcements = () => {
  const { userInfo } = useAuth();
  const { selectedBranchId: globalBranchId } = useGlobalBranchFilter();
  const userType = userInfo?.user_type || userInfo?.userType;
  const canManageAnnouncements = userType === 'Superadmin';
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    announcements,
    tableLoading,
    error,
    setError,
    titleSearchTerm,
    setTitleSearchTerm,
    filterRecipientGroup,
    setFilterRecipientGroup,
    filterCreatedOn,
    setFilterCreatedOn,
    filterStatus,
    setFilterStatus,
    currentPage,
    setCurrentPage,
    itemsPerPage,
    totalItems,
    totalPages,
    fetchAnnouncements,
  } = useAnnouncementBoardList({
    extraParams: globalBranchId ? { branch_id: String(globalBranchId) } : {},
  });
  const [openMenuId, setOpenMenuId] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [viewingAnnouncement, setViewingAnnouncement] = useState(null);
  const [editingAnnouncement, setEditingAnnouncement] = useState(null);
  const [branches, setBranches] = useState([]);
  const [formData, setFormData] = useState({
    title: '',
    email_subject: '',
    body: '',
    recipient_groups: [],
    status: 'Active',
    priority: 'Medium',
    branch_id: '',
    start_date: '',
    end_date: '',
    attachment_url: '',
    send_email: true,
  });
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [attachmentFileName, setAttachmentFileName] = useState('');
  const [attachmentLocalPreviewUrl, setAttachmentLocalPreviewUrl] = useState('');
  const attachmentInputRef = useRef(null);
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [highlightedAnnouncementId, setHighlightedAnnouncementId] = useState(null);
  const highlightedRowRef = useRef(null);

  useEffect(() => {
    fetchBranches();
  }, []);

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
    };

    if (openMenuId) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [openMenuId]);

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

  const fetchBranches = async () => {
    try {
      const response = await apiRequest('/branches?limit=100');
      setBranches(response.data || []);
    } catch (err) {
      console.error('Error fetching branches:', err);
    }
  };

  const handleDelete = async (announcementId) => {
    setOpenMenuId(null);
    if (
      !(await appConfirm({
        title: 'Delete announcement',
        message: 'Are you sure you want to delete this announcement?',
        destructive: true,
        confirmLabel: 'Delete',
      }))
    ) {
      return;
    }

    try {
      await apiRequest(`/announcements/${announcementId}`, {
        method: 'DELETE',
      });
      fetchAnnouncements();
    } catch (err) {
      appAlert(err.message || 'Failed to delete announcement');
    }
  };

  const clearAttachmentLocalPreview = () => {
    setAttachmentLocalPreviewUrl((prev) => {
      if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
      return '';
    });
  };

  const openCreateModal = () => {
    setEditingAnnouncement(null);
    setError('');
    setFormData({
      title: '',
      email_subject: '',
      body: '',
      recipient_groups: [],
      status: 'Active',
      priority: 'Medium',
      branch_id: '',
      start_date: '',
      end_date: '',
      attachment_url: '',
      send_email: true,
    });
    setAttachmentFileName('');
    clearAttachmentLocalPreview();
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
    setFormData({
      title: announcement.title || '',
      email_subject: announcement.email_subject || '',
      body: announcement.body || '',
      recipient_groups: expandAnnouncementRecipientGroupsForForm(
        announcement.recipient_groups || [],
        RECIPIENT_GROUPS
      ),
      status: announcement.status || 'Active',
      priority: announcement.priority || 'Medium',
      branch_id: announcement.branch_id ? announcement.branch_id.toString() : 'all',
      start_date: formatDateForInput(announcement.start_date),
      end_date: formatDateForInput(announcement.end_date),
      attachment_url: announcement.attachment_url || '',
    });
    setAttachmentFileName(announcement.attachment_url ? 'Attached file' : '');
    clearAttachmentLocalPreview();
    setFormErrors({});
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingAnnouncement(null);
    setFormErrors({});
    setFormData({
      title: '',
      email_subject: '',
      body: '',
      recipient_groups: [],
      status: 'Active',
      priority: 'Medium',
      branch_id: '',
      start_date: '',
      end_date: '',
      attachment_url: '',
      send_email: true,
    });
    setAttachmentFileName('');
    clearAttachmentLocalPreview();
  };

  const handleAttachmentChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAttachmentLocalPreviewUrl((prev) => {
      if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
      return isAnnouncementImageFile(file) ? URL.createObjectURL(file) : '';
    });

    setAttachmentUploading(true);
    setError('');
    try {
      const token = localStorage.getItem('firebase_token');
      const fd = new FormData();
      fd.append('attachment', file);
      const res = await fetch(`${API_BASE_URL}/upload/announcement-file`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Upload failed');
      setFormData((prev) => ({ ...prev, attachment_url: data.attachmentUrl }));
      setAttachmentFileName(file.name);
    } catch (err) {
      setError(err.message || 'Failed to upload file');
    } finally {
      setAttachmentUploading(false);
      if (attachmentInputRef.current) attachmentInputRef.current.value = '';
    }
  };

  const removeAttachment = () => {
    setFormData((prev) => ({ ...prev, attachment_url: '' }));
    setAttachmentFileName('');
    clearAttachmentLocalPreview();
    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
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
    setFormData((prev) => ({
      ...prev,
      recipient_groups: toggleAnnouncementRecipientGroups(
        prev.recipient_groups,
        group,
        RECIPIENT_GROUPS
      ),
    }));
  };

  const validateForm = () => {
    const errors = {};
    
    if (!formData.title.trim()) {
      errors.title = 'Title is required';
    }

    if (
      (!editingAnnouncement && formData.send_email && formData.status === 'Active' && !formData.email_subject.trim()) ||
      (editingAnnouncement && !formData.email_subject.trim())
    ) {
      errors.email_subject = 'Subject is required';
    }

    if (!formData.body.trim()) {
      errors.body = 'Description is required';
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

    // Branch is required - "all" means all branches (valid), empty string means not selected (error)
    if (!formData.branch_id || formData.branch_id === '') {
      errors.branch_id = 'Branch is required';
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
      const payload = {
        title: formData.title.trim(),
        email_subject: formData.email_subject.trim(),
        body: formData.body.trim(),
        recipient_groups: normalizeAnnouncementRecipientGroupsForSubmit(
          formData.recipient_groups,
          RECIPIENT_GROUPS
        ),
        status: formData.status,
        priority: formData.priority,
        branch_id: formData.branch_id === 'all' || formData.branch_id === '' 
          ? null 
          : (formData.branch_id ? parseInt(formData.branch_id) : null),
        start_date: formData.start_date && formData.start_date.trim() !== '' ? formData.start_date : null,
        end_date: formData.end_date && formData.end_date.trim() !== '' ? formData.end_date : null,
        attachment_url: formData.attachment_url && formData.attachment_url.trim() ? formData.attachment_url.trim() : null,
      };

      if (!editingAnnouncement) {
        payload.send_email = formData.send_email;
      }

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

  const getBranchName = (branchId) => {
    if (!branchId) return 'All Branches';
    const branch = branches.find(b => b.branch_id === branchId);
    return branch ? branch.branch_name : null;
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

      <AnnouncementBoardFilters
        titleSearchTerm={titleSearchTerm}
        onTitleChange={setTitleSearchTerm}
        filterRecipientGroup={filterRecipientGroup}
        onRecipientGroupChange={setFilterRecipientGroup}
        filterCreatedOn={filterCreatedOn}
        onCreatedOnChange={setFilterCreatedOn}
        filterStatus={filterStatus}
        onStatusChange={setFilterStatus}
      />

      {/* Table Section */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          {canManageAnnouncements ? (
            <button
              onClick={openCreateModal}
              className="btn-primary flex items-center justify-center space-x-2 w-full sm:w-auto"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span>Create</span>
            </button>
          ) : null}
        </div>

        {/* Table */}
        {totalItems > 0 && (
          <TablePaginationSummary
            page={currentPage}
            totalItems={totalItems}
            itemsPerPage={itemsPerPage}
            itemLabel="entries"
            className="px-4 pt-4 pb-2"
          />
        )}
        <AnnouncementTableLoadingShell loading={tableLoading}>
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
                      {formatDateManila(announcement.created_at)}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getStatusBadgeColor(announcement.status)}`}>
                        {announcement.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-sm">
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
                                {canManageAnnouncements ? (
                                  <>
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
                                  </>
                                ) : null}
                              </div>,
                              document.body
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        </AnnouncementTableLoadingShell>

        {/* Pagination */}
        <div className="mt-4">
          <FixedTablePagination
            page={currentPage}
            totalPages={totalPages || 1}
            totalItems={totalItems}
            itemsPerPage={itemsPerPage}
            itemLabel="entries"
            onPageChange={(page) => setCurrentPage(Math.min(Math.max(page, 1), totalPages || 1))}
          />
        </div>
      </div>

      {/* Create/Edit Modal (portaled so overlay covers header) */}
      {isModalOpen && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4">
          <div className="fixed inset-0 backdrop-blur-sm bg-black/5" onClick={closeModal}></div>
          <div className="relative z-10 flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-lg bg-white text-left shadow-xl">
            <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
              <div className="shrink-0 border-b border-gray-200 px-4 py-3">
                <h3 className="text-lg font-medium text-gray-900">
                  {editingAnnouncement ? 'Edit Announcement' : 'Create Announcement'}
                </h3>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                {error && (
                  <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </div>
                )}

                <div className="space-y-3">
                    <div>
                      <label htmlFor="title" className="mb-1 block text-sm font-medium text-gray-700">
                        Title <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        id="title"
                        name="title"
                        value={formData.title}
                        onChange={handleInputChange}
                        required
                        className={`w-full rounded-lg border px-3 py-1.5 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500 ${
                          formErrors.title ? 'border-red-500' : 'border-gray-300'
                        }`}
                      />
                      {formErrors.title && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.title}</p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="email_subject" className="mb-1 block text-sm font-medium text-gray-700">
                        Subject{' '}
                        {(editingAnnouncement || (formData.send_email && formData.status === 'Active')) && (
                          <span className="text-red-500">*</span>
                        )}
                      </label>
                      <input
                        type="text"
                        id="email_subject"
                        name="email_subject"
                        value={formData.email_subject}
                        onChange={handleInputChange}
                        required={editingAnnouncement || (formData.send_email && formData.status === 'Active')}
                        disabled={!editingAnnouncement && !formData.send_email}
                        placeholder="Email subject line"
                        className={`w-full rounded-lg border px-3 py-1.5 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100 disabled:text-gray-500 ${
                          formErrors.email_subject ? 'border-red-500' : 'border-gray-300'
                        }`}
                      />
                      {formErrors.email_subject && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.email_subject}</p>
                      )}
                    </div>

                    <AnnouncementSendEmailToggle
                      checked={formData.send_email}
                      onChange={(value) =>
                        setFormData((prev) => ({
                          ...prev,
                          send_email: value,
                        }))
                      }
                      status={formData.status}
                      showEditHint={Boolean(editingAnnouncement)}
                      compact
                    />

                    <div>
                      <label htmlFor="body" className="mb-1 block text-sm font-medium text-gray-700">
                        Description <span className="text-red-500">*</span>
                      </label>
                      <textarea
                        id="body"
                        name="body"
                        value={formData.body}
                        onChange={handleInputChange}
                        required
                        rows={3}
                        className={`w-full rounded-lg border px-3 py-1.5 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500 ${
                          formErrors.body ? 'border-red-500' : 'border-gray-300'
                        }`}
                      />
                      {formErrors.body && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.body}</p>
                      )}
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Attachment (optional)
                      </label>
                      <input
                        ref={attachmentInputRef}
                        type="file"
                        accept=".pdf,.doc,.docx,image/*,.txt,.csv"
                        onChange={handleAttachmentChange}
                        disabled={attachmentUploading}
                        className="w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-primary-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-700 hover:file:bg-primary-100"
                      />
                      {attachmentUploading && (
                        <p className="mt-1 text-sm text-gray-500">Uploading...</p>
                      )}
                      {(attachmentFileName || attachmentLocalPreviewUrl) && (
                        <div className="mt-2 space-y-1.5">
                          {(formData.attachment_url || attachmentLocalPreviewUrl) && (
                            <AnnouncementAttachmentPreview
                              url={formData.attachment_url}
                              localPreviewUrl={attachmentLocalPreviewUrl}
                              compact
                            />
                          )}
                          {attachmentFileName && (
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm text-gray-700">{attachmentFileName}</span>
                              <button
                                type="button"
                                onClick={removeAttachment}
                                className="shrink-0 text-sm text-red-600 hover:text-red-700"
                              >
                                Remove
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Recipient Groups <span className="text-red-500">*</span>
                      </label>
                      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
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

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label htmlFor="status" className="mb-1 block text-sm font-medium text-gray-700">
                          Status <span className="text-red-500">*</span>
                        </label>
                        <select
                          id="status"
                          name="status"
                          value={formData.status}
                          onChange={handleInputChange}
                          required
                          className={`w-full rounded-lg border px-3 py-1.5 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500 ${
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
                        <label htmlFor="priority" className="mb-1 block text-sm font-medium text-gray-700">
                          Priority <span className="text-red-500">*</span>
                        </label>
                        <select
                          id="priority"
                          name="priority"
                          value={formData.priority}
                          onChange={handleInputChange}
                          required
                          className={`w-full rounded-lg border px-3 py-1.5 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500 ${
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
                      <label htmlFor="branch_id" className="mb-1 block text-sm font-medium text-gray-700">
                        Branch <span className="text-red-500">*</span>
                      </label>
                      <select
                        id="branch_id"
                        name="branch_id"
                        value={formData.branch_id}
                        onChange={handleInputChange}
                        required
                        className={`w-full rounded-lg border px-3 py-1.5 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500 ${
                          formErrors.branch_id ? 'border-red-500' : 'border-gray-300'
                        }`}
                      >
                        <option value="">Select Branch</option>
                        <option value="all">All Branches</option>
                        {branches.map((branch) => (
                          <option key={branch.branch_id} value={branch.branch_id}>
                            {branch.branch_name}
                          </option>
                        ))}
                      </select>
                      {formErrors.branch_id && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.branch_id}</p>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label htmlFor="start_date" className="mb-1 block text-sm font-medium text-gray-700">
                          Start Date
                        </label>
                        <input
                          type="date"
                          id="start_date"
                          name="start_date"
                          value={formData.start_date}
                          onChange={handleInputChange}
                          className={`w-full rounded-lg border px-3 py-1.5 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500 ${
                            formErrors.start_date ? 'border-red-500' : 'border-gray-300'
                          }`}
                        />
                        {formErrors.start_date && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.start_date}</p>
                        )}
                      </div>

                      <div>
                        <label htmlFor="end_date" className="mb-1 block text-sm font-medium text-gray-700">
                          End Date
                        </label>
                        <input
                          type="date"
                          id="end_date"
                          name="end_date"
                          value={formData.end_date}
                          onChange={handleInputChange}
                          className={`w-full rounded-lg border px-3 py-1.5 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500 ${
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
              <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-gray-200 bg-gray-50 px-4 py-3 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="inline-flex w-full justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 sm:w-auto"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex w-full justify-center rounded-lg border border-transparent bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 sm:w-auto"
                  >
                    {submitting ? 'Saving...' : editingAnnouncement ? 'Update' : 'Create'}
                  </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* View Details Modal (portaled so overlay covers header) */}
      {isViewModalOpen && viewingAnnouncement && createPortal(
        <div className="fixed inset-0 z-[9999] overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 backdrop-blur-sm bg-black/5" onClick={closeViewModal}></div>
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
                      Subject
                    </label>
                    <div className="text-sm text-gray-900 bg-gray-50 px-4 py-2 rounded-lg">
                      {viewingAnnouncement.email_subject || viewingAnnouncement.title}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Description
                    </label>
                    <div className="text-sm text-gray-900 bg-gray-50 px-4 py-3 rounded-lg whitespace-pre-wrap max-h-96 overflow-y-auto">
                      {viewingAnnouncement.body}
                    </div>
                  </div>

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
                        {viewingAnnouncement.start_date ? formatDateManila(viewingAnnouncement.start_date) : 'No start date'}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        End Date
                      </label>
                      <div className="text-sm text-gray-900 bg-gray-50 px-4 py-2 rounded-lg">
                        {viewingAnnouncement.end_date ? formatDateManila(viewingAnnouncement.end_date) : 'No end date'}
                      </div>
                    </div>

                    {viewingAnnouncement.attachment_url && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Attachment
                        </label>
                        <AnnouncementAttachmentPreview url={viewingAnnouncement.attachment_url} />
                      </div>
                    )}
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
        </div>,
        document.body
      )}
    </div>
  );
};

export default Announcements;

