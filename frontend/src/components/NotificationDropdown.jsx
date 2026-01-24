import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../config/api';
import { useAuth } from '../contexts/AuthContext';
import ToastNotification from './ToastNotification';

const NotificationDropdown = () => {
  const { userInfo } = useAuth();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState(null);
  const [toastNotifications, setToastNotifications] = useState([]);
  const [previousNotificationIds, setPreviousNotificationIds] = useState(new Set());
  const dropdownRef = useRef(null);

  // Get announcements page path based on user role
  const getAnnouncementsPath = () => {
    const userType = userInfo?.user_type || userInfo?.userType;
    switch (userType) {
      case 'Superadmin':
        return '/superadmin/announcements';
      case 'Admin':
        return '/admin/announcements';
      case 'Teacher':
        return '/teacher/announcements';
      case 'Student':
        return '/student/announcements';
      default:
        return '/superadmin/announcements';
    }
  };

  // Fetch notifications
  const fetchNotifications = async (showToasts = false) => {
    try {
      setLoading(true);
      const response = await apiRequest('/announcements/notifications');
      if (response && response.success) {
        const newNotifications = response.data || [];
        
        // Check for new medium/low priority unread announcements to show as toast
        if (showToasts && userInfo && previousNotificationIds.size > 0) {
          const newMediumLowPriority = newNotifications.filter(
            (announcement) =>
              (announcement.priority === 'Medium' || announcement.priority === 'Low') &&
              !announcement.is_read &&
              !previousNotificationIds.has(announcement.announcement_id)
          );

          // Show toast for each new medium/low priority announcement (staggered)
          if (newMediumLowPriority.length > 0) {
            newMediumLowPriority.forEach((announcement, index) => {
              setTimeout(() => {
                setToastNotifications((prev) => [...prev, announcement]);
              }, index * 500); // Stagger by 500ms
            });
          }
        }

        setNotifications(newNotifications);
        setUnreadCount(response.unreadCount || 0);

        // Update previous notification IDs
        setPreviousNotificationIds(new Set(newNotifications.map(n => n.announcement_id)));
      }
    } catch (error) {
      // Silently handle errors - notifications are not critical
    } finally {
      setLoading(false);
    }
  };

  // Fetch notifications on mount and when dropdown opens
  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
    }
  }, [isOpen]);

  // Check for medium/low priority announcements on login
  useEffect(() => {
    if (userInfo && userInfo.userId) {
      // Small delay to ensure user is fully logged in
      const timer = setTimeout(async () => {
        try {
          const response = await apiRequest('/announcements/notifications');
          if (response && response.success) {
            const allNotifications = response.data || [];
            
            // Filter medium/low priority unread announcements
            const mediumLowPriority = allNotifications.filter(
              (announcement) =>
                (announcement.priority === 'Medium' || announcement.priority === 'Low') &&
                !announcement.is_read
            );

            // Show toast for each medium/low priority announcement (staggered)
            if (mediumLowPriority.length > 0) {
              mediumLowPriority.forEach((announcement, index) => {
                setTimeout(() => {
                  setToastNotifications((prev) => {
                    // Avoid duplicates
                    if (prev.some(t => t.announcement_id === announcement.announcement_id)) {
                      return prev;
                    }
                    return [...prev, announcement];
                  });
                }, index * 500); // Stagger by 500ms
              });
            }

            // Set initial notifications and previous IDs
            setNotifications(allNotifications);
            setUnreadCount(response.unreadCount || 0);
            setPreviousNotificationIds(new Set(allNotifications.map(n => n.announcement_id)));
          }
        } catch (error) {
          console.error('Error fetching notifications on login:', error);
        }
      }, 1000); // Wait 1 second after login

      return () => clearTimeout(timer);
    }
  }, [userInfo]);

  // Poll for new notifications every 30 seconds when dropdown is closed
  useEffect(() => {
    if (!isOpen && userInfo && previousNotificationIds.size > 0) {
      const interval = setInterval(() => {
        fetchNotifications(true); // Show toasts for new announcements
      }, 30000); // Poll every 30 seconds

      return () => clearInterval(interval);
    }
  }, [isOpen, userInfo, previousNotificationIds.size]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
        setSelectedAnnouncement(null);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isOpen]);

  // Mark announcement as read
  const markAsRead = async (announcementId) => {
    try {
      await apiRequest(`/announcements/${announcementId}/read`, {
        method: 'POST',
      });
      
      // Update local state
      setNotifications(prevNotifications =>
        prevNotifications.map(notif =>
          notif.announcement_id === announcementId
            ? { ...notif, is_read: true }
            : notif
        )
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Error marking announcement as read:', error);
    }
  };

  // Handle notification click - navigate to announcements page
  const handleNotificationClick = (announcement) => {
    if (!announcement.is_read) {
      markAsRead(announcement.announcement_id);
    }
    
    // Close dropdown
    setIsOpen(false);
    setSelectedAnnouncement(null);
    
    // Navigate to announcements page with announcement ID as query parameter
    const announcementsPath = getAnnouncementsPath();
    navigate(`${announcementsPath}?highlight=${announcement.announcement_id}`);
  };

  // Format date
  const formatDate = (dateString) => {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', { 
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

  // Get priority color
  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'High':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'Medium':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'Low':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  // Handle toast close
  const handleToastClose = (announcementId) => {
    setToastNotifications((prev) =>
      prev.filter((toast) => toast.announcement_id !== announcementId)
    );
  };

  return (
    <>
      {/* Toast Notifications */}
      {toastNotifications.map((toast, index) => (
        <ToastNotification
          key={`${toast.announcement_id}-${index}`}
          notification={toast}
          onClose={() => handleToastClose(toast.announcement_id)}
          duration={2500}
        />
      ))}

      <div className="relative" ref={dropdownRef}>
      {/* Notification Bell Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-gray-900 hover:bg-primary-600 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500"
        aria-label="Notifications"
      >
        <svg
          className="w-6 h-6 sm:w-7 sm:h-7"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {/* Unread Badge */}
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 block h-4 w-4 sm:h-5 sm:w-5 bg-red-500 text-white text-[10px] sm:text-xs font-bold rounded-full flex items-center justify-center border-2 border-[#F7C844]">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-lg shadow-xl z-50 border border-gray-200 max-h-[600px] flex flex-col">
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Notifications</h3>
            {unreadCount > 0 && (
              <span className="text-sm text-gray-600">
                {unreadCount} unread
              </span>
            )}
          </div>

          {/* Content */}
          <div className="overflow-y-auto flex-1">
            {loading ? (
              <div className="p-4 text-center text-gray-500">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#F7C844] mx-auto"></div>
                <p className="mt-2">Loading notifications...</p>
              </div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <svg
                  className="w-12 h-12 mx-auto mb-3 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                  />
                </svg>
                <p>No new notifications</p>
              </div>
            ) : selectedAnnouncement ? (
              // Announcement Detail View
              <div className="p-4">
                <button
                  onClick={() => setSelectedAnnouncement(null)}
                  className="mb-3 text-sm text-gray-600 hover:text-gray-900 flex items-center"
                >
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Back to list
                </button>
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <h4 className="text-lg font-semibold text-gray-900">
                      {selectedAnnouncement.title}
                    </h4>
                    <span
                      className={`px-2 py-1 text-xs font-medium rounded border ${getPriorityColor(
                        selectedAnnouncement.priority
                      )}`}
                    >
                      {selectedAnnouncement.priority}
                    </span>
                  </div>
                  <div className="text-sm text-gray-600 space-y-1">
                    {selectedAnnouncement.created_by_name && (
                      <p>
                        <span className="font-medium">From:</span> {selectedAnnouncement.created_by_name}
                      </p>
                    )}
                    {selectedAnnouncement.branch_name && (
                      <p>
                        <span className="font-medium">Branch:</span> {selectedAnnouncement.branch_name}
                      </p>
                    )}
                    <p>
                      <span className="font-medium">Date:</span> {formatDate(selectedAnnouncement.created_at)}
                    </p>
                  </div>
                  <div className="pt-3 border-t border-gray-200">
                    <p className="text-gray-700 whitespace-pre-wrap">
                      {selectedAnnouncement.body}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              // Notifications List
              <div className="divide-y divide-gray-200">
                {notifications.map((notification) => (
                  <button
                    key={notification.announcement_id}
                    onClick={() => handleNotificationClick(notification)}
                    className={`w-full text-left p-4 hover:bg-gray-50 transition-colors ${
                      !notification.is_read ? 'bg-blue-50' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-2 mb-1">
                          <h4 className="text-sm font-semibold text-gray-900 truncate">
                            {notification.title}
                          </h4>
                          {!notification.is_read && (
                            <span className="flex-shrink-0 w-2 h-2 bg-blue-500 rounded-full"></span>
                          )}
                        </div>
                        <p className="text-xs text-gray-600 line-clamp-2">
                          {notification.body}
                        </p>
                        <div className="flex items-center space-x-2 mt-2">
                          <span
                            className={`px-2 py-0.5 text-xs font-medium rounded border ${getPriorityColor(
                              notification.priority
                            )}`}
                          >
                            {notification.priority}
                          </span>
                          <span className="text-xs text-gray-500">
                            {formatDate(notification.created_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
    </>
  );
};

export default NotificationDropdown;

