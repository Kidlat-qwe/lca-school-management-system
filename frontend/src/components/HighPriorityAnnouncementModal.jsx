import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../config/api';
import { useAuth } from '../contexts/AuthContext';

const HighPriorityAnnouncementModal = () => {
  const { userInfo } = useAuth();
  const navigate = useNavigate();
  const [highPriorityAnnouncement, setHighPriorityAnnouncement] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

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

  // Check for unread high priority announcements
  const checkHighPriorityAnnouncements = async () => {
    if (!userInfo) return;

    try {
      setLoading(true);
      const response = await apiRequest('/announcements/notifications');
      
      if (response && response.success && response.data) {
        // Find the first unread HIGH priority announcement
        const highPriorityUnread = response.data.find(
          (announcement) => 
            announcement.priority === 'High' && 
            !announcement.is_read
        );

        if (highPriorityUnread) {
          setHighPriorityAnnouncement(highPriorityUnread);
          setIsVisible(true);
        }
      }
    } catch (error) {
      console.error('Error checking high priority announcements:', error);
    } finally {
      setLoading(false);
    }
  };

  // Check for announcements when userInfo is available
  useEffect(() => {
    if (userInfo && userInfo.userId) {
      // Small delay to ensure user is fully logged in
      const timer = setTimeout(() => {
        checkHighPriorityAnnouncements();
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [userInfo]);

  // Mark as read and navigate to announcements page
  const handleViewAnnouncement = async () => {
    if (!highPriorityAnnouncement) return;

    try {
      // Mark as read
      await apiRequest(`/announcements/${highPriorityAnnouncement.announcement_id}/read`, {
        method: 'POST',
      });

      // Close modal
      setIsVisible(false);
      setHighPriorityAnnouncement(null);

      // Navigate to announcements page with highlight
      const announcementsPath = getAnnouncementsPath();
      navigate(`${announcementsPath}?highlight=${highPriorityAnnouncement.announcement_id}`);
    } catch (error) {
      console.error('Error marking announcement as read:', error);
      // Still navigate even if marking as read fails
      setIsVisible(false);
      const announcementsPath = getAnnouncementsPath();
      navigate(`${announcementsPath}?highlight=${highPriorityAnnouncement.announcement_id}`);
    }
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

  if (!isVisible || !highPriorityAnnouncement) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="bg-red-600 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <svg
              className="w-6 h-6 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <h2 className="text-xl font-bold text-white">High Priority Announcement</h2>
          </div>
          <span className="px-3 py-1 text-sm font-semibold bg-white text-red-600 rounded-full">
            URGENT
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-4">
            <div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">
                {highPriorityAnnouncement.title}
              </h3>
              <div className="flex items-center space-x-4 text-sm text-gray-600">
                {highPriorityAnnouncement.created_by_name && (
                  <span>
                    <span className="font-medium">From:</span> {highPriorityAnnouncement.created_by_name}
                  </span>
                )}
                {highPriorityAnnouncement.branch_name && (
                  <span>
                    <span className="font-medium">Branch:</span> {highPriorityAnnouncement.branch_name}
                  </span>
                )}
                <span>
                  <span className="font-medium">Date:</span> {formatDate(highPriorityAnnouncement.created_at)}
                </span>
              </div>
            </div>

            <div className="pt-4 border-t border-gray-200">
              <p className="text-gray-700 whitespace-pre-wrap leading-relaxed">
                {highPriorityAnnouncement.body}
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-end space-x-3">
          <button
            onClick={handleViewAnnouncement}
            className="px-6 py-2 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
          >
            View Full Details
          </button>
        </div>
      </div>
    </div>
  );
};

export default HighPriorityAnnouncementModal;
