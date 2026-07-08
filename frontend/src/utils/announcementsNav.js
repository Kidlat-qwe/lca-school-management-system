/**
 * React Router path to the announcements list for the logged-in user.
 * Finance with no branch_id is Superfinance (org-wide finance).
 */
export function getAnnouncementsPathForUser(userInfo) {
  if (!userInfo) return '/';
  const userType = userInfo.user_type || userInfo.userType;
  const branchId = userInfo.branchId ?? userInfo.branch_id;
  if (userType === 'Finance') {
    return branchId === null || branchId === undefined
      ? '/superfinance/announcements'
      : '/finance/announcements';
  }
  switch (userType) {
    case 'Superadmin':
      return '/superadmin/announcements';
    case 'Admin':
      return '/admin/announcements';
    case 'Teacher':
      return '/teacher/announcements';
    case 'Student':
      return '/student/announcements';
    default:
      console.warn('getAnnouncementsPathForUser: unmapped userType', userType);
      return '/';
  }
}

/** Role home dashboard — used when blocking access to another role's route (stay signed in). */
export function getHomePathForUser(userInfo) {
  if (!userInfo) return '/login';
  const userType = userInfo.user_type || userInfo.userType;
  const branchId = userInfo.branchId ?? userInfo.branch_id;
  switch (userType) {
    case 'Superadmin':
      return '/superadmin';
    case 'Admin':
      return '/admin';
    case 'Teacher':
      return '/teacher';
    case 'Student':
      return '/student';
    case 'Superfinance':
      return '/superfinance';
    case 'Finance':
      return branchId === null || branchId === undefined ? '/superfinance' : '/finance';
    default:
      return '/login';
  }
}
