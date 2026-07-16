import { useAuth } from '../../contexts/AuthContext';
import LeadershipboardView from '../../components/dashboard/LeadershipboardView';

/**
 * Branch Admin Leadershipboard — own branch spotlight + place among peers;
 * peer metric numbers are redacted by the API (privacy_mode).
 */
const AdminLeadershipboard = () => {
  const { userInfo } = useAuth();
  const branchId = userInfo?.branch_id || userInfo?.branchId || '';
  const branchName =
    userInfo?.branch_nickname ||
    userInfo?.branch_name ||
    userInfo?.branchName ||
    'Your Branch';

  return (
    <LeadershipboardView
      branchId={branchId}
      branchName={branchName}
      privacyMode
    />
  );
};

export default AdminLeadershipboard;
