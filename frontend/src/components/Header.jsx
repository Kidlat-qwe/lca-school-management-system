import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../config/api';
import ProfilePictureModal from './ProfilePictureModalS3';
import NotificationDropdown from './NotificationDropdown';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../config/firebase';

const Header = ({ onMenuClick }) => {
  const { userInfo, logout } = useAuth();
  const navigate = useNavigate();
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isProfilePictureModalOpen, setIsProfilePictureModalOpen] = useState(false);
  const [isPasswordResetModalOpen, setIsPasswordResetModalOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetEmailError, setResetEmailError] = useState('');
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const profileMenuRef = useRef(null);
  const [branchName, setBranchName] = useState(null);

  // Fetch branch name if user has a branch_id
  useEffect(() => {
    const fetchBranchName = async () => {
      const branchId = userInfo?.branch_id || userInfo?.branchId;
      if (branchId) {
        try {
          const response = await apiRequest(`/branches/${branchId}`);
          if (response && response.data) {
            setBranchName(response.data.branch_name);
          }
        } catch (err) {
          console.error('Error fetching branch name:', err);
        }
      }
    };

    if (userInfo) {
      fetchBranchName();
    }
  }, [userInfo]);

  // Debug: Log when userInfo changes
  useEffect(() => {
    console.log('Header userInfo updated:', userInfo);
    console.log('Profile picture URL:', userInfo?.profile_picture_url);
  }, [userInfo]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) {
        setIsProfileMenuOpen(false);
      }
    };

    if (isProfileMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isProfileMenuOpen]);

  // Helper function to format branch name for display (two lines)
  const formatBranchName = (branchName) => {
    if (!branchName) return null;
    
    // Check if branch name contains a dash or hyphen separator
    if (branchName.includes(' - ')) {
      const parts = branchName.split(' - ');
      return {
        company: parts[0].trim(),
        location: parts.slice(1).join(' - ').trim()
      };
    } else if (branchName.includes('-')) {
      const parts = branchName.split('-');
      return {
        company: parts[0].trim(),
        location: parts.slice(1).join('-').trim()
      };
    }
    
    // If no separator, return the full name as company
    return {
      company: branchName,
      location: ''
    };
  };

  const handleLogout = async () => {
    try {
      setIsProfileMenuOpen(false);
      await logout();
      navigate('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const handleChangeProfilePhoto = () => {
    setIsProfileMenuOpen(false);
    setIsProfilePictureModalOpen(true);
  };

  const handleChangePassword = () => {
    setIsProfileMenuOpen(false);
    // Pre-fill with user's email if available
    setResetEmail(userInfo?.email || '');
    setResetEmailError('');
    setIsPasswordResetModalOpen(true);
  };

  const handlePasswordResetSubmit = async (e) => {
    e.preventDefault();
    setResetEmailError('');

    // Validate email
    if (!resetEmail || !resetEmail.trim()) {
      setResetEmailError('Please enter your email address');
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(resetEmail)) {
      setResetEmailError('Please enter a valid email address');
      return;
    }

    try {
      setIsResettingPassword(true);
      await sendPasswordResetEmail(auth, resetEmail.trim());
      
      alert('Password reset email sent! Please check your inbox and follow the instructions to reset your password.');
      setIsPasswordResetModalOpen(false);
      setResetEmail('');
    } catch (error) {
      console.error('Password reset error:', error);
      
      // Handle specific Firebase errors
      if (error.code === 'auth/user-not-found') {
        setResetEmailError('No account found with this email address');
      } else if (error.code === 'auth/invalid-email') {
        setResetEmailError('Invalid email address');
      } else if (error.code === 'auth/too-many-requests') {
        setResetEmailError('Too many requests. Please try again later');
      } else {
        setResetEmailError('Failed to send password reset email. Please try again');
      }
    } finally {
      setIsResettingPassword(false);
    }
  };

  return (
    <>
      <div className="fixed top-0 left-0 right-0 z-50 bg-[#F7C844]">
        <div className="h-[env(safe-area-inset-top,0px)]" aria-hidden="true" />
        <header className="bg-[#F7C844] border-b border-primary-600 min-h-16 flex items-center justify-between px-2 sm:px-4 md:px-6 lg:px-8 py-2 shadow-sm">
        {/* Logo and Company Name / Branch Name */}
        <div className="flex items-center space-x-2 sm:space-x-3 flex-1 min-w-0">
          <img
            src="/LCA Icon.png"
            alt="Little Champions Academy Logo"
            className="h-8 w-8 sm:h-10 sm:w-10 md:h-12 md:w-12 object-contain bg-transparent flex-shrink-0"
          />
          <div className="min-w-0 flex-1">
            {branchName ? (() => {
              const formatted = formatBranchName(branchName);
              return (
                <div className="min-w-0">
                  <div className="text-xs sm:text-sm md:text-lg lg:text-xl font-bold text-gray-900 truncate">
                    {formatted.company}
                  </div>
                  {formatted.location && (
                    <div className="text-[10px] sm:text-xs md:text-sm text-gray-700 truncate">
                      {formatted.location}
                    </div>
                  )}
                </div>
              );
            })() : (
              <h1 className="text-xs sm:text-sm md:text-lg lg:text-xl font-bold text-gray-900 truncate">
                Little Champions Academy Inc.
              </h1>
            )}
          </div>
        </div>

        {/* Notifications and User Profile */}
        <div className="flex items-center space-x-2 sm:space-x-3 flex-shrink-0">
          {/* Notification Bell */}
          <NotificationDropdown />

        {/* User Profile */}
          <div className="relative" ref={profileMenuRef}>
          <button
            onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
            className="flex items-center space-x-1 sm:space-x-2 md:space-x-3 hover:bg-primary-600 rounded-lg px-1 sm:px-2 py-1 transition-colors"
          >
            <div className="hidden md:block text-right">
              <p className="text-sm font-medium text-gray-900 truncate max-w-[120px] lg:max-w-none">
                {userInfo?.full_name || userInfo?.fullName || userInfo?.email || 'User'}
              </p>
              <p className="text-xs text-gray-700 capitalize">
                {(() => {
                  const userType = userInfo?.user_type || userInfo?.userType || 'User';
                  const branchId = userInfo?.branch_id || userInfo?.branchId;
                  // If Finance role with no branch_id, display as Superfinance
                  if (userType === 'Finance' && (branchId === null || branchId === undefined)) {
                    return 'Superfinance';
                  }
                  return userType;
                })()}
              </p>
            </div>
            <div className="h-8 w-8 sm:h-9 sm:w-9 md:h-10 md:w-10 rounded-full bg-white flex items-center justify-center flex-shrink-0">
              {userInfo?.profile_picture_url ? (
                <img
                  src={userInfo.profile_picture_url}
                  alt="Profile"
                  className="h-8 w-8 sm:h-9 sm:w-9 md:h-10 md:w-10 rounded-full object-cover"
                  key={userInfo.profile_picture_url}
                />
              ) : (
                <span className="text-primary-600 font-semibold text-xs sm:text-sm">
                  {(userInfo?.full_name || userInfo?.fullName || userInfo?.email || 'U').charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <svg
              className={`w-3 h-3 sm:w-4 sm:h-4 text-gray-900 transition-transform flex-shrink-0 ${isProfileMenuOpen ? 'transform rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Dropdown Menu */}
          {isProfileMenuOpen && (
            <div className="absolute right-0 mt-2 w-48 sm:w-56 bg-white rounded-md shadow-lg z-50 border border-gray-200">
              <div className="py-1">
                <button
                  onClick={handleChangeProfilePhoto}
                  className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors flex items-center space-x-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span>Change Profile Photo</span>
                </button>
                <button
                  onClick={handleChangePassword}
                  className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors flex items-center space-x-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                  </svg>
                  <span>Change Password</span>
                </button>
                <button
                  onClick={handleLogout}
                  className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-100 transition-colors flex items-center space-x-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  <span>Logout</span>
                </button>
              </div>
            </div>
          )}
          </div>
        </div>
        </header>
      </div>

    {/* Mobile Menu Button - Fixed Bottom Right */}
    {onMenuClick && (
      <button
        onClick={onMenuClick}
        className="fixed bottom-6 right-6 lg:hidden p-4 bg-[#F7C844] text-gray-900 rounded-full shadow-lg hover:bg-[#F5B82E] transition-colors z-50"
        aria-label="Toggle menu"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
    )}

    {/* Profile Picture Modal */}
    <ProfilePictureModal
      isOpen={isProfilePictureModalOpen}
      onClose={() => setIsProfilePictureModalOpen(false)}
      currentProfilePicture={userInfo?.profile_picture_url}
    />

    {/* Password Reset Modal */}
    {isPasswordResetModalOpen && (
      <div 
        className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4"
        onClick={() => {
          setIsPasswordResetModalOpen(false);
          setResetEmail('');
          setResetEmailError('');
        }}
      >
        <div 
          className="bg-white rounded-lg shadow-xl max-w-md w-full"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Modal Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                Change Password
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                Enter your email to receive a password reset link
              </p>
            </div>
            <button
              onClick={() => {
                setIsPasswordResetModalOpen(false);
                setResetEmail('');
                setResetEmailError('');
              }}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Modal Body */}
          <form onSubmit={handlePasswordResetSubmit} className="p-6">
            <div className="space-y-4">
              <div>
                <label htmlFor="reset_email" className="label-field">
                  Email Address <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  id="reset_email"
                  value={resetEmail}
                  onChange={(e) => {
                    setResetEmail(e.target.value);
                    setResetEmailError('');
                  }}
                  className={`input-field ${resetEmailError ? 'border-red-500' : ''}`}
                  placeholder="your.email@example.com"
                  required
                  disabled={isResettingPassword}
                />
                {resetEmailError && (
                  <p className="mt-1 text-sm text-red-600">{resetEmailError}</p>
                )}
                <p className="mt-2 text-xs text-gray-500">
                  We'll send you an email with instructions to reset your password. Please check your inbox (and spam folder) after submitting.
                </p>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end space-x-3 mt-6">
              <button
                type="button"
                onClick={() => {
                  setIsPasswordResetModalOpen(false);
                  setResetEmail('');
                  setResetEmailError('');
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                disabled={isResettingPassword}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:bg-blue-300 disabled:cursor-not-allowed"
                disabled={isResettingPassword}
              >
                {isResettingPassword ? (
                  <span className="flex items-center space-x-2">
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Sending...</span>
                  </span>
                ) : (
                  'Send Reset Link'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    )}
    </>
  );
};

export default Header;

