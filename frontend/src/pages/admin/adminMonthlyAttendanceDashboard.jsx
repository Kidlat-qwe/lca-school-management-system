import { useAuth } from '../../contexts/AuthContext';
import AttendanceDashboardView from '../../components/dashboard/AttendanceDashboardView';

const AdminMonthlyAttendanceDashboard = () => {
  const { userInfo } = useAuth();
  const branchId = userInfo?.branch_id || userInfo?.branchId || '';
  const branchName = userInfo?.branch_name || userInfo?.branchName || 'Your Branch';

  return (
    <AttendanceDashboardView
      mode="monthly"
      branchId={branchId}
      branchName={branchName}
      canFilterAcrossBranches={false}
    />
  );
};

export default AdminMonthlyAttendanceDashboard;
