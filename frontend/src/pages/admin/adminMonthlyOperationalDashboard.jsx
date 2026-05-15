import { useAuth } from '../../contexts/AuthContext';
import MonthlyOperationalDashboardView from '../../components/dashboard/MonthlyOperationalDashboardView';

const AdminMonthlyOperationalDashboard = () => {
  const { userInfo } = useAuth();
  const branchId = userInfo?.branch_id || userInfo?.branchId || '';
  const branchName = userInfo?.branch_name || userInfo?.branchName || 'Your Branch';

  return (
    <MonthlyOperationalDashboardView
      branchId={branchId}
      branchName={branchName}
      canFilterAcrossBranches={false}
    />
  );
};

export default AdminMonthlyOperationalDashboard;
