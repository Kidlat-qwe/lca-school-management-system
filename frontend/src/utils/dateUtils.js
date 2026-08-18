/**
 * Date utilities for Asia/Manila (Philippines) timezone UTC+8.
 * Display format across the system: "June 06, 2026" (long month, zero-padded day).
 */

const MANILA_TZ = 'Asia/Manila';
/** Philippines has no DST — always UTC+8. */
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const pad2 = (value) => String(value).padStart(2, '0');

/** Calendar parts in Asia/Manila from an absolute instant (05:24Z → 13:24). */
export const getManilaDateTimeParts = (date) => {
  const manila = new Date(date.getTime() + MANILA_OFFSET_MS);
  return {
    year: manila.getUTCFullYear(),
    month: manila.getUTCMonth() + 1,
    day: manila.getUTCDate(),
    hour: manila.getUTCHours(),
    minute: manila.getUTCMinutes(),
    second: manila.getUTCSeconds(),
  };
};

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

  // Absolute instants from JSON Date / ISO (`...Z` or `...+08:00`).
  // Coolify serializes pg timestamps as UTC ISO; do not re-tag those digits as +08:00.
  if (/^\d{4}-\d{2}-\d{2}T/.test(str) && /(?:Z|[+-]\d{2}:\d{2})$/i.test(str)) {
    const parsed = new Date(str);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  // Naive YYYY-MM-DD HH:MM:SS — already Manila wall clock (e.g. payment-log TO_CHAR).
  const ymdHms = str.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (ymdHms) {
    const isoManila = `${ymdHms[1]}-${ymdHms[2]}-${ymdHms[3]}T${ymdHms[4]}:${ymdHms[5]}:${ymdHms[6] || '00'}+08:00`;
    const parsed = new Date(isoManila);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  // YYYY-MM-DD date only (issue/payment business dates)
  const ymd = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) {
    const y = parseInt(ymd[1], 10);
    const m = parseInt(ymd[2], 10);
    const d = parseInt(ymd[3], 10);
    if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const parsed = new Date(`${ymd[1]}-${ymd[2]}-${ymd[3]}T12:00:00+08:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(str);
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
  const p = getManilaDateTimeParts(d);
  return `${MONTH_NAMES[p.month - 1]} ${pad2(p.day)}, ${p.year}`;
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
  const p = getManilaDateTimeParts(d);
  const datePart = `${MONTH_NAMES[p.month - 1]} ${pad2(p.day)}, ${p.year}`;
  let hour = p.hour;
  let suffix = '';
  if (hour12) {
    suffix = hour >= 12 ? ' PM' : ' AM';
    hour = hour % 12;
    if (hour === 0) hour = 12;
  }
  const timePart = `${hour12 ? String(hour) : pad2(hour)}:${pad2(p.minute)}:${pad2(p.second)}${suffix}`;
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
