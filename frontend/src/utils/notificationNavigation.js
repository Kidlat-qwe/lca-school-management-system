import { getAnnouncementsPathForUser } from './announcementsNav';
import { LESSON_PLANS_ENABLED } from './lessonPlansFeature';
import {
  buildDailySummaryPath,
  DAILY_SUMMARY_KIND,
  getDailySummaryBasePath,
  roleHasDailySummaryAccess,
} from './dailySummaryNav';

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

    case 'lesson-plans':
      if (!LESSON_PLANS_ENABLED) return getAnnouncementsPathForUser(userInfo);
      if (userType === 'Superadmin') return '/superadmin/lesson-plans';
      if (userType === 'Admin') return '/admin/lesson-plans';
      if (userType === 'Teacher') return '/teacher/lesson-plans';
      return getAnnouncementsPathForUser(userInfo);

    case 'daily-summary-sales':
      return getDailySummaryBasePath(userInfo);

    case 'acknowledgement-receipts':
      if (userType === 'Superadmin') return '/superadmin/acknowledgement-receipts';
      if (userType === 'Admin') return '/admin/acknowledgement-receipts';
      if (userType === 'Superfinance') return '/superfinance/acknowledgement-receipts';
      if (userType === 'Finance') {
        return branchId === null || branchId === undefined
          ? '/superfinance/acknowledgement-receipts'
          : '/finance/acknowledgement-receipts';
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
  if (title.includes('payment rejected')) {
    return { navigationKey: 'payment-logs', navigationQuery: 'notificationTab=rejected' };
  }
  if (title.includes('payment resubmitted')) {
    return { navigationKey: 'payment-logs', navigationQuery: 'notificationTab=main' };
  }
  if (title.includes('merchandise request') || title.includes('stock request')) {
    return { navigationKey: 'merchandise', navigationQuery: 'notificationTab=requests' };
  }
  if (
    LESSON_PLANS_ENABLED &&
    (title.includes('lesson plan submitted') ||
      title.includes('lesson plan approved') ||
      title.includes('lesson plan revision'))
  ) {
    return { navigationKey: 'lesson-plans', navigationQuery: '' };
  }
  if (title.includes('cash deposit summary')) {
    return {
      navigationKey: 'daily-summary-sales',
      navigationQuery: '',
      dailySummaryKind: DAILY_SUMMARY_KIND.CASH_DEPOSIT,
    };
  }
  if (title.includes('end of shift')) {
    return {
      navigationKey: 'daily-summary-sales',
      navigationQuery: '',
      dailySummaryKind: DAILY_SUMMARY_KIND.END_OF_SHIFT,
    };
  }
  if (title.includes('acknowledgement receipt')) {
    return { navigationKey: 'acknowledgement-receipts', navigationQuery: 'page=1' };
  }

  return { navigationKey: 'announcements', navigationQuery: '' };
}

function resolveDailySummaryNotificationPath(userInfo, navigationQuery, dailySummaryKind) {
  let kind = dailySummaryKind || DAILY_SUMMARY_KIND.END_OF_SHIFT;

  if (!dailySummaryKind && navigationQuery) {
    const legacyParams = new URLSearchParams(navigationQuery);
    const tab = legacyParams.get('notificationTab');
    if (tab === DAILY_SUMMARY_KIND.CASH_DEPOSIT || tab === 'cashDeposit') {
      kind = DAILY_SUMMARY_KIND.CASH_DEPOSIT;
    } else if (tab === DAILY_SUMMARY_KIND.END_OF_SHIFT || tab === 'endOfShift') {
      kind = DAILY_SUMMARY_KIND.END_OF_SHIFT;
    }
  }

  return buildDailySummaryPath(userInfo, kind);
}

export function getNotificationDestination(notification, userInfo) {
  if (!notification) {
    return getAnnouncementsPathForUser(userInfo);
  }

  const inferred = inferNotificationNavigation(notification);
  const navigationKey = notification.navigation_key || inferred.navigationKey;
  const navigationQuery = notification.navigation_query || inferred.navigationQuery || '';
  const dailySummaryKind = inferred.dailySummaryKind;

  if (navigationKey === 'daily-summary-sales' && !roleHasDailySummaryAccess(userInfo)) {
    const basePath = getAnnouncementsPathForUser(userInfo);
    const params = new URLSearchParams();
    if (notification.announcement_id != null) {
      params.set('highlight', String(notification.announcement_id));
    }
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  }

  let basePath = getNotificationBasePath(navigationKey, userInfo);

  if (navigationKey === 'daily-summary-sales') {
    basePath = resolveDailySummaryNotificationPath(userInfo, navigationQuery, dailySummaryKind);
  }
  const params = new URLSearchParams(navigationQuery);

  if (navigationKey === 'daily-summary-sales') {
    params.delete('notificationTab');
  }

  if (navigationKey === 'announcements') {
    params.set('highlight', String(notification.announcement_id));
  } else {
    params.set('fromNotification', '1');
    params.set('notificationTs', String(Date.now()));
  }

  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}
