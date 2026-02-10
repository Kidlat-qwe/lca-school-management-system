/**
 * Date utilities for Asia/Manila (Philippines) timezone UTC+8.
 * Use for displaying and defaulting dates in the app.
 */

const MANILA_TZ = 'Asia/Manila';

/**
 * Format an ISO date string or Date for display in Asia/Manila (date only).
 * @param {string|Date} dateInput - ISO date string or Date
 * @returns {string} e.g. "Feb 10, 2026" or "-" if invalid
 */
export const formatDateManila = (dateInput) => {
  if (!dateInput) return '-';
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-PH', { timeZone: MANILA_TZ, year: 'numeric', month: 'short', day: 'numeric' });
};

/**
 * Format an ISO date string or Date for display in Asia/Manila (date and time).
 * @param {string|Date} dateInput - ISO date string or Date
 * @returns {string} e.g. "Feb 10, 2026, 12:00 AM" or "-" if invalid
 */
export const formatDateTimeManila = (dateInput) => {
  if (!dateInput) return '-';
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('en-PH', {
    timeZone: MANILA_TZ,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * Today's date in Asia/Manila as YYYY-MM-DD (for date inputs).
 * @returns {string}
 */
export const todayManilaYMD = () => {
  return new Date().toLocaleDateString('en-CA', { timeZone: MANILA_TZ });
};
