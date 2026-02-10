/**
 * Date utilities for Asia/Manila (Philippines) timezone UTC+8.
 * Display format across the system: DD/MM/YYYY.
 */

const MANILA_TZ = 'Asia/Manila';

/**
 * Format an ISO date string or Date for display (date only) in DD/MM/YYYY, Asia/Manila.
 * @param {string|Date} dateInput - ISO date string or Date
 * @returns {string} e.g. "10/02/2026" or "-" if invalid
 */
export const formatDateManila = (dateInput) => {
  if (!dateInput) return '-';
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-GB', { timeZone: MANILA_TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
};

/**
 * Format an ISO date string or Date for display (date and time) in DD/MM/YYYY, HH:MM, Asia/Manila.
 * @param {string|Date} dateInput - ISO date string or Date
 * @returns {string} e.g. "10/02/2026, 12:00" or "-" if invalid
 */
export const formatDateTimeManila = (dateInput) => {
  if (!dateInput) return '-';
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(d.getTime())) return '-';
  const datePart = d.toLocaleDateString('en-GB', { timeZone: MANILA_TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
  const timePart = d.toLocaleTimeString('en-GB', { timeZone: MANILA_TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  return `${datePart}, ${timePart}`;
};

/**
 * Today's date in Asia/Manila as YYYY-MM-DD (for date inputs).
 * @returns {string}
 */
export const todayManilaYMD = () => {
  return new Date().toLocaleDateString('en-CA', { timeZone: MANILA_TZ });
};
