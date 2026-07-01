import { useAuth } from '../../contexts/AuthContext';
import DailyOperationalDashboardView from '../../components/dashboard/DailyOperationalDashboardView';

const AdminDailyOperationalDashboard = () => {
  const { userInfo } = useAuth();
  const branchId = userInfo?.branch_id || userInfo?.branchId || '';
  const branchName = userInfo?.branch_name || userInfo?.branchName || 'Your Branch';

  return (
    <DailyOperationalDashboardView
      branchId={branchId}
      branchName={branchName}
      canFilterAcrossBranches={false}
    />
  );
};

export default AdminDailyOperationalDashboard;
