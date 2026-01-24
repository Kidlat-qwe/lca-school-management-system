import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../config/api';
import { useAuth } from '../contexts/AuthContext';

const ToastNotification = ({ notification, onClose, duration = 2500 }) => {
  const { userInfo } = useAuth();
  const navigate = useNavigate();
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

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

  // Show toast with animation
  useEffect(() => {
    // Trigger entrance animation
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 10);

    // Auto-close after duration
    const closeTimer = setTimeout(() => {
      handleClose();
    }, duration);

    return () => {
      clearTimeout(timer);
      clearTimeout(closeTimer);
    };
  }, []);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => {
      onClose();
    }, 300); // Match animation duration
  };

  const handleClick = async () => {
    if (!notification) return;

    try {
      // Mark as read if not already read
      if (!notification.is_read) {
        await apiRequest(`/announcements/${notification.announcement_id}/read`, {
          method: 'POST',
        });
      }

      // Navigate to announcements page
      const announcementsPath = getAnnouncementsPath();
      navigate(`${announcementsPath}?highlight=${notification.announcement_id}`);
      handleClose();
    } catch (error) {
      console.error('Error handling toast click:', error);
      // Still navigate even if marking as read fails
      const announcementsPath = getAnnouncementsPath();
      navigate(`${announcementsPath}?highlight=${notification.announcement_id}`);
      handleClose();
    }
  };

  // Get priority color
  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'Medium':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'Low':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  if (!notification) return null;

  return (
    <div
      className={`fixed top-20 right-4 z-[9998] max-w-sm w-full bg-white rounded-lg shadow-lg border-2 ${
        getPriorityColor(notification.priority)
      } transition-all duration-300 ${
        isVisible && !isExiting
          ? 'translate-x-0 opacity-100'
          : 'translate-x-full opacity-0'
      }`}
    >
      <div className="p-4">
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
            <p className="text-xs text-gray-600 line-clamp-2 mb-2">
              {notification.body}
            </p>
            <div className="flex items-center space-x-2">
              <span
                className={`px-2 py-0.5 text-xs font-medium rounded border ${getPriorityColor(
                  notification.priority
                )}`}
              >
                {notification.priority}
              </span>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="ml-2 flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <button
          onClick={handleClick}
          className="mt-3 w-full text-xs font-medium text-gray-700 hover:text-gray-900 underline text-center"
        >
          View Details
        </button>
      </div>
    </div>
  );
};

export default ToastNotification;
