/**
 * Date utilities for Asia/Manila (Philippines) timezone UTC+8.
 * Display format across the system: "June 06, 2026" (long month, zero-padded day).
 */

const MANILA_TZ = 'Asia/Manila';

/** Shared Intl options for date-only display. */
export const DISPLAY_DATE_OPTIONS = {
  timeZone: MANILA_TZ,
  month: 'long',
  day: '2-digit',
  year: 'numeric',
};

/**
 * Parse API / user date input for display (avoids timezone shifts on YYYY-MM-DD).
 * @param {string|Date|null|undefined} dateInput
 * @returns {Date|null}
 */
export const parseDateForDisplay = (dateInput) => {
  if (dateInput == null || dateInput === '') return null;
  if (dateInput instanceof Date) {
    return Number.isNaN(dateInput.getTime()) ? null : dateInput;
  }

  const str = String(dateInput).trim();
  const ymd = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) {
    const y = parseInt(ymd[1], 10);
    const m = parseInt(ymd[2], 10);
    const d = parseInt(ymd[3], 10);
    if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
    return new Date(y, m - 1, d, 12, 0, 0, 0);
  }

  const isoWithTz = str.includes(' ') && !str.includes('T')
    ? str.replace(' ', 'T') + '+08:00'
    : str;
  const parsed = new Date(isoWithTz);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * Format an ISO date string or Date for display (date only) in Asia/Manila.
 * @param {string|Date} dateInput - ISO date string or Date
 * @returns {string} e.g. "June 06, 2026" or "-" if invalid
 */
export const formatDateManila = (dateInput) => {
  const d = parseDateForDisplay(dateInput);
  if (!d) return '-';
  return d.toLocaleDateString('en-US', DISPLAY_DATE_OPTIONS);
};

/**
 * Format an ISO date string or Date for display (date and time) in Asia/Manila.
 * @param {string|Date} dateInput
 * @param {{ hour12?: boolean }} [options]
 * @returns {string} e.g. "June 06, 2026, 14:30" or "-" if invalid
 */
export const formatDateTimeManila = (dateInput, options = {}) => {
  const { hour12 = false } = options;
  const d = parseDateForDisplay(dateInput);
  if (!d) return '-';
  const datePart = d.toLocaleDateString('en-US', DISPLAY_DATE_OPTIONS);
  const timePart = d.toLocaleTimeString('en-US', {
    timeZone: MANILA_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12,
  });
  return `${datePart}, ${timePart}`;
};

/**
 * Today's date in Asia/Manila as YYYY-MM-DD (for date inputs).
 * @returns {string}
 */
export const todayManilaYMD = () => {
  return new Date().toLocaleDateString('en-CA', { timeZone: MANILA_TZ });
};

/**
 * First calendar day of the current month in Asia/Manila as YYYY-MM-DD.
 * @returns {string}
 */
export const firstDayOfMonthManilaYMD = () => {
  const ymd = todayManilaYMD();
  const [y, m] = ymd.split('-');
  return `${y}-${m}-01`;
};

/**
 * Current year-month in Asia/Manila as YYYY-MM (for type="month" inputs).
 * @returns {string}
 */
export const manilaMonthYYYYMM = () => {
  return new Date().toLocaleDateString('en-CA', { timeZone: MANILA_TZ }).slice(0, 7);
};

/**
 * Inclusive first/last calendar days for a YYYY-MM string (last day uses JS Date month length).
 * @param {string} yyyyMm
 * @returns {{ from: string, to: string }} empty strings if invalid
 */
export const issueDateRangeFromManilaMonth = (yyyyMm) => {
  const month = String(yyyyMm || '').trim();
  if (!month) return { from: '', to: '' };
  const [yStr, mStr] = month.split('-');
  const yy = parseInt(yStr, 10);
  const mm = parseInt(mStr, 10);
  if (!Number.isInteger(yy) || !Number.isInteger(mm) || mm < 1 || mm > 12) return { from: '', to: '' };
  const first = `${month}-01`;
  const lastDay = new Date(yy, mm, 0).getDate();
  return { from: first, to: `${month}-${String(lastDay).padStart(2, '0')}` };
};

/**
 * Inclusive first/last calendar days for a calendar year (YYYY).
 * @param {string|number} yyyy
 * @returns {{ from: string, to: string }}
 */
export const issueDateRangeFromManilaYear = (yyyy) => {
  const year = parseInt(String(yyyy || '').trim(), 10);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return { from: '', to: '' };
  return { from: `${year}-01-01`, to: `${year}-12-31` };
};

/**
 * Format session code: p{phase}s{session}_{MMDDYY}_{HHMMam/pm}
 * Example: p1s1_020926_0100PM
 * @param {number} phaseNumber - Phase number
 * @param {number} sessionNumber - Session number within phase
 * @param {string} dateStr - Date YYYY-MM-DD
 * @param {string} timeStr - Time HH:MM:SS or HH:MM
 * @returns {string}
 */
export const formatSessionCode = (phaseNumber, sessionNumber, dateStr, timeStr) => {
  if (phaseNumber == null || sessionNumber == null) return '-';
  const p = `P${phaseNumber}S${sessionNumber}`;
  if (!dateStr || !timeStr) return p;
  const d = new Date(dateStr + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return p;
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  const year = d.getFullYear().toString().slice(-2);
  const mmddyy = `${month}${day}${year}`;
  const [hours, minutes] = String(timeStr).split(':').map(Number) || [0, 0];
  const period = hours >= 12 ? 'PM' : 'AM';
  let hour12 = hours % 12;
  if (hour12 === 0) hour12 = 12;
  const timePart = `${hour12.toString().padStart(2, '0')}${(minutes || 0).toString().padStart(2, '0')}${period}`;
  return `${p}_${mmddyy}_${timePart}`;
};
