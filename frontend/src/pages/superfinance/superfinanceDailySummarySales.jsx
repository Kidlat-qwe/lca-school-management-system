import { useLocation } from 'react-router-dom';
import DailySummarySalesApprovalPage from '../shared/DailySummarySalesApprovalPage';
import { getDailySummaryKindFromPathname } from '../../utils/dailySummaryNav';

const SuperfinanceDailySummarySales = () => {
  const location = useLocation();
  const summaryKind = getDailySummaryKindFromPathname(location.pathname);

  return <DailySummarySalesApprovalPage summaryKind={summaryKind} />;
};

export default SuperfinanceDailySummarySales;
