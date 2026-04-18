/**
 * Default passwords for user creation (Superadmin/Admin creating users).
 * Used when creating Student, Teacher, or Finance from the admin/superadmin panels.
 */
export const DEFAULT_PASSWORD_STUDENT = '$tudent-1234';
export const DEFAULT_PASSWORD_TEACHER = 'Te@cher-1234';
export const DEFAULT_PASSWORD_FINANCE = 'Finance-1234';
export const DEFAULT_PASSWORD_SUPERADMIN = 'Superadmin-1234';

/**
 * Returns the default password for the given user type, or empty string if no default.
 * @param {string} userType - One of 'Student', 'Teacher', 'Finance', etc.
 * @returns {string}
 */
export function getDefaultPasswordForUserType(userType) {
  switch (userType) {
    case 'Student':
      return DEFAULT_PASSWORD_STUDENT;
    case 'Teacher':
      return DEFAULT_PASSWORD_TEACHER;
    case 'Finance':
      return DEFAULT_PASSWORD_FINANCE;
    case 'Superadmin':
      return DEFAULT_PASSWORD_SUPERADMIN;
    default:
      return '';
  }
}
