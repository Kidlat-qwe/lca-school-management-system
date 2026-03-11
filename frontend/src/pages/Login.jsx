import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../config/firebase';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isForgotPasswordOpen, setIsForgotPasswordOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetEmailError, setResetEmailError] = useState('');
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleForgotPasswordSubmit = async (e) => {
    e.preventDefault();
    setResetEmailError('');
    if (!resetEmail || !resetEmail.trim()) {
      setResetEmailError('Please enter your email address');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(resetEmail)) {
      setResetEmailError('Please enter a valid email address');
      return;
    }
    try {
      setIsResettingPassword(true);
      await sendPasswordResetEmail(auth, resetEmail.trim());
      alert('Password reset email sent! Check your inbox (and spam folder for Gmail) and follow the link to set a new password.');
      setIsForgotPasswordOpen(false);
      setResetEmail('');
    } catch (err) {
      console.error('Password reset error:', err);
      if (err.code === 'auth/user-not-found') {
        setResetEmailError('No account found with this email address');
      } else if (err.code === 'auth/invalid-email') {
        setResetEmailError('Invalid email address');
      } else if (err.code === 'auth/too-many-requests') {
        setResetEmailError('Too many requests. Please try again later.');
      } else {
        setResetEmailError('Failed to send password reset email. Please try again.');
      }
    } finally {
      setIsResettingPassword(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await login(email, password);
      
      if (result.success) {
        // Redirect based on user type
        const userType = result.user.user_type || result.user.userType;
        const branchId = result.user.branch_id || result.user.branchId;
        
        switch (userType) {
          case 'Superadmin':
            navigate('/superadmin');
            break;
          case 'Admin':
            // Admin users are redirected to their dashboard
            navigate('/admin');
            break;
          case 'Finance':
            // If Finance user has no branch (branch_id is null), redirect to superfinance
            if (branchId === null || branchId === undefined) {
              navigate('/superfinance');
            } else {
              navigate('/finance');
            }
            break;
          case 'Teacher':
            navigate('/teacher');
            break;
          case 'Student':
            navigate('/student');
            break;
          default:
            navigate('/');
        }
      }
    } catch (err) {
      setError(err.message || 'Failed to login. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 via-white to-primary-50 px-4 sm:px-6">
      <div className="max-w-md w-full space-y-4">
        {/* Logo/Header Section */}
        <div className="text-center w-full">
          <div className="mx-auto mb-2 flex justify-center bg-transparent">
            <img
              src="/LCA Icon.png"
              alt="Little Champions Academy Logo"
              className="h-16 w-16 sm:h-20 sm:w-20 object-contain bg-transparent"
            />
          </div>
          <div className="w-full flex justify-center">
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900 whitespace-nowrap">
              Little Champions Academy Inc.
            </h2>
          </div>
          <p className="mt-1 text-xs sm:text-sm text-gray-600">
            Sign in to your account
          </p>
        </div>

        {/* Login Form */}
        <div className="bg-white rounded-xl shadow-lg p-4 sm:p-6">
          <form className="space-y-4" onSubmit={handleSubmit}>
            {/* Error Message */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-xs sm:text-sm">
                {error}
              </div>
            )}

            {/* Email Field */}
            <div>
              <label htmlFor="email" className="label-field text-sm">
                Email Address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field text-sm py-2"
                placeholder="Enter your email"
              />
            </div>

            {/* Password Field */}
            <div>
              <label htmlFor="password" className="label-field text-sm">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-field text-sm py-2"
                placeholder="Enter your password"
              />
            </div>

            {/* Remember Me & Forgot Password */}
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <input
                  id="remember-me"
                  name="remember-me"
                  type="checkbox"
                  className="h-3.5 w-3.5 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                />
                <label htmlFor="remember-me" className="ml-2 block text-xs sm:text-sm text-gray-700">
                  Remember me
                </label>
              </div>

              <div className="text-xs sm:text-sm">
                <button
                  type="button"
                  onClick={() => {
                    setResetEmail(email);
                    setResetEmailError('');
                    setIsForgotPasswordOpen(true);
                  }}
                  className="font-medium text-primary-600 hover:text-primary-500 transition-colors"
                >
                  Forgot password?
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <div>
              <button
                type="submit"
                disabled={loading}
                className="w-full btn-primary disabled:opacity-50 disabled:cursor-not-allowed py-2 text-sm sm:text-base font-semibold"
              >
                {loading ? (
                  <span className="flex items-center justify-center">
                    <svg
                      className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    Signing in...
                  </span>
                ) : (
                  'Sign in'
                )}
              </button>
            </div>
          </form>

          {/* Sign Up Link intentionally hidden */}
        </div>

        {/* Footer */}
        <div className="text-center">
          <p className="text-xs text-gray-500">
            © 2024 Little Champions Academy Inc. All rights reserved.
          </p>
        </div>
      </div>

      {/* Forgot Password Modal - same flow as in-app Change Password */}
      {isForgotPasswordOpen && (
        <div
          className="fixed inset-0 backdrop-blur-sm bg-black/5 flex items-center justify-center z-[9999] p-4"
          onClick={() => {
            setIsForgotPasswordOpen(false);
            setResetEmail('');
            setResetEmailError('');
          }}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
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
                type="button"
                onClick={() => {
                  setIsForgotPasswordOpen(false);
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
            <form onSubmit={handleForgotPasswordSubmit} className="p-6">
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
                    Works with any email (Gmail, Outlook, etc.). We&apos;ll send a reset link to this address. Check your inbox and spam folder after submitting.
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-end space-x-3 mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setIsForgotPasswordOpen(false);
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
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
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
    </div>
  );
};

export default Login;

