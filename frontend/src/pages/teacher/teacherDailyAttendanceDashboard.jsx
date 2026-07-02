import { useAuth } from '../../contexts/AuthContext';
import AttendanceDashboardView from '../../components/dashboard/AttendanceDashboardView';

const TeacherDailyAttendanceDashboard = () => {
  const { userInfo } = useAuth();
  const branchId = userInfo?.branch_id || userInfo?.branchId || '';
  const branchName = userInfo?.branch_name || userInfo?.branchName || 'Your branch';

  return (
    <AttendanceDashboardView
      mode="daily"
      branchId={branchId}
      branchName={branchName}
      canFilterAcrossBranches={false}
    />
  );
};

export default TeacherDailyAttendanceDashboard;
