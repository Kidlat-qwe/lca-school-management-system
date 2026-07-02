import { useGlobalBranchFilter } from '../../contexts/GlobalBranchFilterContext';
import AttendanceDashboardView from '../../components/dashboard/AttendanceDashboardView';

const MonthlyAttendanceDashboard = () => {
  const { selectedBranchId, selectedBranchName } = useGlobalBranchFilter();

  return (
    <AttendanceDashboardView
      mode="monthly"
      branchId={selectedBranchId}
      branchName={selectedBranchId ? selectedBranchName : 'All Branches'}
      canFilterAcrossBranches={true}
    />
  );
};

export default MonthlyAttendanceDashboard;
