/**
 * Helpers for class Active / Inactive status checks in the UI.
 */

export const CLASS_INACTIVE_ACTION_MESSAGE =
  'This class is inactive. Reactivate the class to perform this action.';

/**
 * @param {{ status?: string } | null | undefined} classItem
 * @returns {boolean}
 */
export function isClassInactive(classItem) {
  if (!classItem) return false;
  return String(classItem.status ?? 'Active').trim() === 'Inactive';
}

/**
 * @param {boolean} disabled
 * @param {'default' | 'amber'} [variant]
 * @returns {string}
 */
export function getClassInactiveMenuButtonClass(disabled, variant = 'default') {
  if (disabled) {
    return 'block w-full text-left px-4 py-2 text-sm text-gray-400 cursor-not-allowed';
  }
  if (variant === 'amber') {
    return 'block w-full text-left px-4 py-2 text-sm text-amber-600 hover:bg-gray-100 transition-colors';
  }
  return 'block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors';
}

/**
 * @param {boolean} disabled
 * @param {string} enabledClassName
 * @returns {string}
 */
export function getClassInactiveActionButtonClass(disabled, enabledClassName) {
  if (disabled) {
    return 'block w-full px-4 py-2 text-left text-sm text-gray-400 cursor-not-allowed';
  }
  return enabledClassName;
}

/**
 * @param {boolean} disabled
 * @param {string} enabledClassName
 * @returns {string}
 */
export function getClassInactiveIconButtonClass(disabled, enabledClassName) {
  if (disabled) {
    return 'inline-flex items-center justify-center rounded-full p-1.5 text-gray-300 cursor-not-allowed';
  }
  return enabledClassName;
}
