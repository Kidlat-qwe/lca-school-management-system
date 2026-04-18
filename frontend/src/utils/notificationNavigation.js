import { getAnnouncementsPathForUser } from './announcementsNav';

function getNotificationBasePath(navigationKey, userInfo) {
  if (!userInfo) return '/';

  const userType = userInfo.user_type || userInfo.userType;
  const branchId = userInfo.branchId ?? userInfo.branch_id;

  switch (navigationKey) {
    case 'payment-logs':
      if (userType === 'Superadmin') return '/superadmin/payment-logs';
      if (userType === 'Admin') return '/admin/payment-logs';
      if (userType === 'Finance') {
        return branchId === null || branchId === undefined
          ? '/superfinance/payment-logs'
          : '/finance/payment-logs';
      }
      if (userType === 'Superfinance') return '/superfinance/payment-logs';
      if (userType === 'Student') return '/student/payment-logs';
      return getAnnouncementsPathForUser(userInfo);

    case 'merchandise':
      if (userType === 'Superadmin') return '/superadmin/merchandise';
      if (userType === 'Admin') return '/admin/merchandise';
      return getAnnouncementsPathForUser(userInfo);

    case 'daily-summary-sales':
      if (userType === 'Superadmin') return '/superadmin/daily-summary-sales';
      if (userType === 'Superfinance') return '/superfinance/daily-summary-sales';
      if (userType === 'Finance' && (branchId === null || branchId === undefined)) {
        return '/superfinance/daily-summary-sales';
      }
      return getAnnouncementsPathForUser(userInfo);

    case 'announcements':
    default:
      return getAnnouncementsPathForUser(userInfo);
  }
}

function inferNotificationNavigation(notification) {
  const title = String(notification?.title || '').toLowerCase();

  if (title.includes('payment returned')) {
    return { navigationKey: 'payment-logs', navigationQuery: 'notificationTab=return' };
  }
  if (title.includes('payment resubmitted')) {
    return { navigationKey: 'payment-logs', navigationQuery: 'notificationTab=main' };
  }
  if (title.includes('merchandise request') || title.includes('stock request')) {
    return { navigationKey: 'merchandise', navigationQuery: 'notificationTab=requests' };
  }
  if (title.includes('cash deposit summary')) {
    return { navigationKey: 'daily-summary-sales', navigationQuery: 'notificationTab=cashDeposit' };
  }
  if (title.includes('end of shift')) {
    return { navigationKey: 'daily-summary-sales', navigationQuery: 'notificationTab=endOfShift' };
  }

  return { navigationKey: 'announcements', navigationQuery: '' };
}

export function getNotificationDestination(notification, userInfo) {
  if (!notification) {
    return getAnnouncementsPathForUser(userInfo);
  }

  const inferred = inferNotificationNavigation(notification);
  const navigationKey = notification.navigation_key || inferred.navigationKey;
  const navigationQuery = notification.navigation_query || inferred.navigationQuery || '';
  const basePath = getNotificationBasePath(navigationKey, userInfo);
  const params = new URLSearchParams(navigationQuery);

  if (navigationKey === 'announcements') {
    params.set('highlight', String(notification.announcement_id));
  } else {
    params.set('fromNotification', '1');
    params.set('notificationTs', String(Date.now()));
  }

  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}
