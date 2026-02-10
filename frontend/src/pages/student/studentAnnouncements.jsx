import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';
import { formatDateManila } from '../../utils/dateUtils';

const StudentAnnouncements = () => {
  const { userInfo } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [titleSearchTerm, setTitleSearchTerm] = useState('');
  const [filterRecipientGroup, setFilterRecipientGroup] = useState('');
  const [filterCreatedOn, setFilterCreatedOn] = useState('');
  const [openRecipientGroupDropdown, setOpenRecipientGroupDropdown] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(15);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [highlightedAnnouncementId, setHighlightedAnnouncementId] = useState(null);
  const highlightedRowRef = useRef(null);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [viewingAnnouncement, setViewingAnnouncement] = useState(null);

  const RECIPIENT_GROUPS = [
    { value: 'All', label: 'All' },
    { value: 'Students', label: 'Students' },
    { value: 'Teachers', label: 'Teachers' },
    { value: 'Admin', label: 'Admin' },
    { value: 'Finance', label: 'Finance' },
  ];

  useEffect(() => {
    fetchAnnouncements();
  }, [currentPage, itemsPerPage, titleSearchTerm, filterRecipientGroup, filterCreatedOn]);

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

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (openRecipientGroupDropdown && !event.target.closest('.recipient-group-filter-dropdown')) {
        setOpenRecipientGroupDropdown(false);
      }
    };

    if (openRecipientGroupDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [openRecipientGroupDropdown]);

  const openViewModal = (announcement) => {
    setViewingAnnouncement(announcement);
    setIsViewModalOpen(true);
  };

  const closeViewModal = () => {
    setIsViewModalOpen(false);
    setViewingAnnouncement(null);
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
    if (!groups || !Array.isArray(groups)) return 'N/A';
    return groups.join(', ');
  };

  const fetchAnnouncements = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: itemsPerPage.toString(),
        status: 'Active', // Only show active announcements
      });

      // Filter by recipient group - default to user's role, or use selected filter
      const recipientGroupFilter = filterRecipientGroup || (userInfo?.user_type || 'Students');
      params.append('recipient_group', recipientGroupFilter);

      if (titleSearchTerm) {
        params.append('title', titleSearchTerm);
      }
      if (filterCreatedOn) {
        params.append('created_on', filterCreatedOn);
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

  /** Format date in Philippines time (UTC+8) */
  const formatDate = (dateString) => {
    if (!dateString) return '-';
    try {
      const date = new Date(dateString);
      return formatDateManila(dateString);
    } catch {
      return dateString;
    }
  };

  /** Format date-time in Philippines time (UTC+8) */
  const formatDateTime = (dateString) => {
    if (!dateString) return '-';
    try {
      const date = new Date(dateString);
      return date.toLocaleString('en-PH', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    } catch {
      return dateString;
    }
  };

  const getPriorityColor = (priority) => {
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

  // Announcements are already filtered by the API
  const filteredAnnouncements = announcements;

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
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Announcements</h1>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Search and Filters */}
      <div className="bg-white rounded-lg shadow p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Title Search */}
          <div className="relative">
            <input
              type="text"
              placeholder="Search by title..."
              value={titleSearchTerm}
              onChange={(e) => {
                setTitleSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:border-transparent text-sm"
            />
            {titleSearchTerm && (
              <button
                onClick={() => {
                  setTitleSearchTerm('');
                  setCurrentPage(1);
                }}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Recipient Group Filter */}
          <div className="relative recipient-group-filter-dropdown">
            <button
              onClick={() => setOpenRecipientGroupDropdown(!openRecipientGroupDropdown)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:border-transparent text-sm text-left flex items-center justify-between bg-white"
            >
              <span className={filterRecipientGroup ? 'text-gray-900' : 'text-gray-500'}>
                {filterRecipientGroup 
                  ? RECIPIENT_GROUPS.find(rg => rg.value === filterRecipientGroup)?.label || filterRecipientGroup
                  : 'All Recipient Groups'}
              </span>
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {openRecipientGroupDropdown && (
              <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                <button
                  onClick={() => {
                    setFilterRecipientGroup('');
                    setOpenRecipientGroupDropdown(false);
                    setCurrentPage(1);
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  All Recipient Groups
                </button>
                {RECIPIENT_GROUPS.map((group) => (
                  <button
                    key={group.value}
                    onClick={() => {
                      setFilterRecipientGroup(group.value);
                      setOpenRecipientGroupDropdown(false);
                      setCurrentPage(1);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                  >
                    {group.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Created On Filter */}
          <div>
            <input
              type="date"
              value={filterCreatedOn}
              onChange={(e) => {
                setFilterCreatedOn(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:border-transparent text-sm"
            />
          </div>
        </div>
      </div>

      {/* Announcements Table */}
      <div className="bg-white rounded-lg shadow">
        <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
          <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '800px' }}>
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '12%' }}>
                  RECIPIENT GROUP
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '18%' }}>
                  TITLE
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '20%' }}>
                  BODY
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '12%' }}>
                  CREATED BY
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '12%' }}>
                  CREATED ON
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '10%' }}>
                  PRIORITY
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '16%' }}>
                  VALIDITY PERIOD
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredAnnouncements.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-4 py-8 text-center text-gray-500">
                    No announcements found.
                  </td>
                </tr>
              ) : (
                filteredAnnouncements.map((announcement) => (
                  <tr 
                    key={announcement.announcement_id} 
                    ref={highlightedAnnouncementId === announcement.announcement_id ? highlightedRowRef : null}
                    onClick={() => openViewModal(announcement)}
                    className={`hover:bg-gray-50 transition-all duration-300 cursor-pointer ${
                      highlightedAnnouncementId === announcement.announcement_id 
                        ? 'bg-yellow-200 ring-2 ring-yellow-400 ring-offset-2' 
                        : ''
                    }`}
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-xs text-gray-900">
                        {announcement.recipient_groups?.join(', ') || '-'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-gray-900">
                        {announcement.title}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-gray-900 truncate" style={{ maxWidth: '200px' }}>
                        {announcement.body || '-'}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {announcement.created_by_name || '-'}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {formatDateTime(announcement.created_at)}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${getPriorityColor(announcement.priority)}`}>
                        {announcement.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-xs text-gray-900">
                        {announcement.start_date && announcement.end_date ? (
                          <>
                            {formatDate(announcement.start_date)} - {formatDate(announcement.end_date)}
                          </>
                        ) : announcement.start_date ? (
                          `From ${formatDate(announcement.start_date)}`
                        ) : announcement.end_date ? (
                          `Until ${formatDate(announcement.end_date)}`
                        ) : (
                          'No limit'
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-700">Items per page:</span>
              <select
                value={itemsPerPage}
                onChange={(e) => {
                  setItemsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-[#F7C844]"
              >
                <option value={10}>10</option>
                <option value={15}>15</option>
                <option value={20}>20</option>
                <option value={30}>30</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-700">
                Page {currentPage} of {totalPages} ({totalItems} total)
              </span>
              <button
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

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
                        {formatDateTime(viewingAnnouncement.created_at)}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Start Date
                      </label>
                      <div className="text-sm text-gray-900 bg-gray-50 px-4 py-2 rounded-lg">
                        {viewingAnnouncement.start_date ? formatDate(viewingAnnouncement.start_date) : 'No start date'}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        End Date
                      </label>
                      <div className="text-sm text-gray-900 bg-gray-50 px-4 py-2 rounded-lg">
                        {viewingAnnouncement.end_date ? formatDate(viewingAnnouncement.end_date) : 'No end date'}
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

export default StudentAnnouncements;

