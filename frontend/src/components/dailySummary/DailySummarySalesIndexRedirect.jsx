import { Navigate, useLocation } from 'react-router-dom';
import {
  DAILY_SUMMARY_KIND,
  DAILY_SUMMARY_ROUTE_SEGMENTS,
  getDailySummaryRouteSegment,
} from '../../utils/dailySummaryNav';

/**
 * Redirects `/daily-summary-sales` to the correct child route, preserving query string.
 * Honors legacy `?notificationTab=cashDeposit|endOfShift`.
 */
const DailySummarySalesIndexRedirect = () => {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const notificationTab = params.get('notificationTab');
  const kind =
    notificationTab === DAILY_SUMMARY_KIND.CASH_DEPOSIT
      ? DAILY_SUMMARY_KIND.CASH_DEPOSIT
      : DAILY_SUMMARY_KIND.END_OF_SHIFT;
  const segment = getDailySummaryRouteSegment(kind);

  return <Navigate to={`${segment}${location.search}`} replace />;
};

export { DAILY_SUMMARY_ROUTE_SEGMENTS };
export default DailySummarySalesIndexRedirect;
