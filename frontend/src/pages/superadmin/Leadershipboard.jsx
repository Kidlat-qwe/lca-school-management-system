import { useGlobalBranchFilter } from '../../contexts/GlobalBranchFilterContext';
import LeadershipboardView from '../../components/dashboard/LeadershipboardView';

const Leadershipboard = () => {
  const { selectedBranchId, selectedBranchName } = useGlobalBranchFilter();

  return (
    <LeadershipboardView
      branchId={selectedBranchId}
      branchName={selectedBranchId ? selectedBranchName : 'All Branches'}
    />
  );
};

export default Leadershipboard;
