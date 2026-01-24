import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const ProtectedRoute = ({ children, allowedRoles = [], checkBranch = false, requireNoBranch = false }) => {
  const { userInfo, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!userInfo) {
    return <Navigate to="/login" replace />;
  }

  const userType = userInfo.userType || userInfo.user_type;
  const branchId = userInfo.branchId || userInfo.branch_id;

  if (allowedRoles.length > 0 && !allowedRoles.includes(userType)) {
    return <Navigate to="/login" replace />;
  }

  // Check if superfinance route requires no branch (Finance with branch_id = null)
  if (requireNoBranch && (branchId !== null && branchId !== undefined)) {
    // Finance user with a branch should not access superfinance routes
    return <Navigate to="/finance" replace />;
  }

  // Check if finance route requires a branch (regular finance users)
  if (checkBranch && userType === 'Finance' && (branchId === null || branchId === undefined)) {
    // Finance user without a branch should go to superfinance routes
    return <Navigate to="/superfinance" replace />;
  }

  return children;
};

export default ProtectedRoute;

