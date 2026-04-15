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
