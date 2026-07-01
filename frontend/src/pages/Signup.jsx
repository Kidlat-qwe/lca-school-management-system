import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const Signup = () => {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    full_name: '',
    user_type: 'Student',
    phone_number: '',
    gender: '',
    date_of_birth: '',
    branch_id: '',
    level_tag: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signup } = useAuth();
  const navigate = useNavigate();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Validation
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);

    try {
      const result = await signup(formData.email, formData.password, {
        full_name: formData.full_name,
        user_type: formData.user_type,
        phone_number: formData.phone_number || null,
        gender: formData.gender || null,
        date_of_birth: formData.date_of_birth || null,
        branch_id: formData.branch_id ? parseInt(formData.branch_id) : null,
        level_tag: formData.level_tag || null,
      });

      if (result.success) {
        // Redirect based on user type
        const userType = result.user.userType;
        switch (userType) {
          case 'Superadmin':
            navigate('/superadmin');
            break;
          case 'Admin':
            navigate('/admin');
            break;
          case 'Finance':
            navigate('/finance');
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
      let errorMessage = 'Failed to create account. Please try again.';
      
      // Firebase authentication errors
      if (err.code === 'auth/configuration-not-found') {
        errorMessage = 'Firebase Authentication is not properly configured. Please check that Email/Password authentication is enabled in Firebase Console for project psms-b9ca7.';
      } else if (err.code === 'auth/email-already-in-use') {
        errorMessage = 'This email is already registered. Please use a different email or sign in.';
      } else if (err.code === 'auth/weak-password') {
        errorMessage = 'Password is too weak. Please use a stronger password (at least 6 characters).';
      } else if (err.code === 'auth/invalid-email') {
        errorMessage = 'Invalid email address. Please check your email format.';
      } else if (err.code === 'auth/network-request-failed') {
        errorMessage = 'Network error. Please check your internet connection and try again.';
      } else if (err.message) {
        // Use the error message from the context (which may include PostgreSQL sync errors)
        errorMessage = err.message;
      }
      
      console.error('Signup error details:', err);
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 via-white to-primary-50 px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-2xl w-full space-y-8">
        {/* Logo/Header Section */}
        <div className="text-center">
          <div className="mx-auto h-16 w-16 bg-primary-600 rounded-full flex items-center justify-center mb-4">
            <svg
              className="h-10 w-10 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
              />
            </svg>
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900">
            Create Account
          </h2>
          <p className="mt-2 text-sm sm:text-base text-gray-600">
            Sign up to get started
          </p>
        </div>

        {/* Signup Form */}
        <div className="bg-white rounded-2xl shadow-xl p-6 sm:p-8 md:p-10">
          <form className="space-y-5" onSubmit={handleSubmit}>
            {/* Error Message */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            {/* Full Name */}
            <div>
              <label htmlFor="full_name" className="label-field">
                Full Name <span className="text-red-500">*</span>
              </label>
              <input
                id="full_name"
                name="full_name"
                type="text"
                required
                value={formData.full_name}
                onChange={handleChange}
                className="input-field"
                placeholder="Enter your full name"
              />
            </div>

            {/* Email Field */}
            <div>
              <label htmlFor="email" className="label-field">
                Email Address <span className="text-red-500">*</span>
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={formData.email}
                onChange={handleChange}
                className="input-field"
                placeholder="Enter your email"
              />
            </div>

            {/* User Type */}
            <div>
              <label htmlFor="user_type" className="label-field">
                User Type <span className="text-red-500">*</span>
              </label>
              <select
                id="user_type"
                name="user_type"
                required
                value={formData.user_type}
                onChange={handleChange}
                className="input-field"
              >
                <option value="Student">Student</option>
                <option value="Teacher">Teacher</option>
                <option value="Finance">Finance</option>
                <option value="Admin">Admin</option>
                <option value="Superadmin">Superadmin</option>
              </select>
            </div>

            {/* Password Fields - Side by side on larger screens */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="password" className="label-field">
                  Password <span className="text-red-500">*</span>
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={formData.password}
                  onChange={handleChange}
                  className="input-field"
                  placeholder="Create a password"
                  minLength={6}
                />
              </div>

              <div>
                <label htmlFor="confirmPassword" className="label-field">
                  Confirm Password <span className="text-red-500">*</span>
                </label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  className="input-field"
                  placeholder="Confirm your password"
                  minLength={6}
                />
              </div>
            </div>

            {/* Phone Number and Gender - Side by side on larger screens */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="phone_number" className="label-field">
                  Phone Number
                </label>
                <input
                  id="phone_number"
                  name="phone_number"
                  type="tel"
                  value={formData.phone_number}
                  onChange={handleChange}
                  className="input-field"
                  placeholder="Enter your phone number"
                />
              </div>

              <div>
                <label htmlFor="gender" className="label-field">
                  Gender
                </label>
                <select
                  id="gender"
                  name="gender"
                  value={formData.gender}
                  onChange={handleChange}
                  className="input-field"
                >
                  <option value="">Select gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>

            {/* Date of Birth and Level Tag - Side by side on larger screens */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="date_of_birth" className="label-field">
                  Date of Birth
                </label>
                <input
                  id="date_of_birth"
                  name="date_of_birth"
                  type="date"
                  value={formData.date_of_birth}
                  onChange={handleChange}
                  className="input-field"
                />
              </div>

              <div>
                <label htmlFor="level_tag" className="label-field">
                  Level Tag
                </label>
                <input
                  id="level_tag"
                  name="level_tag"
                  type="text"
                  value={formData.level_tag}
                  onChange={handleChange}
                  className="input-field"
                  placeholder="e.g., Level 1, Grade 5"
                />
              </div>
            </div>

            {/* Branch ID */}
            <div>
              <label htmlFor="branch_id" className="label-field">
                Branch ID
              </label>
              <input
                id="branch_id"
                name="branch_id"
                type="number"
                value={formData.branch_id}
                onChange={handleChange}
                className="input-field"
                placeholder="Enter branch ID (optional)"
              />
              <p className="mt-1 text-xs text-gray-500">
                Leave empty if you don't have a branch ID
              </p>
            </div>

            {/* Submit Button */}
            <div>
              <button
                type="submit"
                disabled={loading}
                className="w-full btn-primary disabled:opacity-50 disabled:cursor-not-allowed py-3 text-base sm:text-lg font-semibold"
              >
                {loading ? (
                  <span className="flex items-center justify-center">
                    <svg
                      className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
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
                    Creating account...
                  </span>
                ) : (
                  'Create Account'
                )}
              </button>
            </div>
          </form>

          {/* Sign In Link */}
          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600">
              Already have an account?{' '}
              <Link
                to="/login"
                className="font-medium text-primary-600 hover:text-primary-500 transition-colors"
              >
                Sign in
              </Link>
            </p>
          </div>

          {/* Additional Info */}
          <div className="mt-4 text-center">
            <p className="text-xs sm:text-sm text-gray-500">
              By creating an account, you agree to our{' '}
              <a href="#" className="text-primary-600 hover:text-primary-500">
                Terms of Service
              </a>{' '}
              and{' '}
              <a href="#" className="text-primary-600 hover:text-primary-500">
                Privacy Policy
              </a>
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center">
          <p className="text-xs sm:text-sm text-gray-500">
            © 2024 School Management System. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Signup;

