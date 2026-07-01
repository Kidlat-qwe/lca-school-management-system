import { useGlobalBranchFilter } from '../../contexts/GlobalBranchFilterContext';
import MonthlyOperationalDashboardView from '../../components/dashboard/MonthlyOperationalDashboardView';

const MonthlyOperationalDashboard = () => {
  const { selectedBranchId, selectedBranchName } = useGlobalBranchFilter();

  return (
    <MonthlyOperationalDashboardView
      branchId={selectedBranchId}
      branchName={selectedBranchId ? selectedBranchName : 'All Branches'}
      canFilterAcrossBranches={true}
    />
  );
};

export default MonthlyOperationalDashboard;
