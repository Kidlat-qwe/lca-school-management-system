import { useGlobalBranchFilter } from '../../contexts/GlobalBranchFilterContext';
import DailyOperationalDashboardView from '../../components/dashboard/DailyOperationalDashboardView';

const DailyOperationalDashboard = () => {
  const { selectedBranchId, selectedBranchName } = useGlobalBranchFilter();

  return (
    <DailyOperationalDashboardView
      branchId={selectedBranchId}
      branchName={selectedBranchId ? selectedBranchName : 'All Branches'}
      canFilterAcrossBranches={true}
    />
  );
};

export default DailyOperationalDashboard;
