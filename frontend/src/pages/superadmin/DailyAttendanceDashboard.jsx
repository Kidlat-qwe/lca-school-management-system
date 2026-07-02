import { useGlobalBranchFilter } from '../../contexts/GlobalBranchFilterContext';
import AttendanceDashboardView from '../../components/dashboard/AttendanceDashboardView';

const DailyAttendanceDashboard = () => {
  const { selectedBranchId, selectedBranchName } = useGlobalBranchFilter();

  return (
    <AttendanceDashboardView
      mode="daily"
      branchId={selectedBranchId}
      branchName={selectedBranchId ? selectedBranchName : 'All Branches'}
      canFilterAcrossBranches={true}
    />
  );
};

export default DailyAttendanceDashboard;
