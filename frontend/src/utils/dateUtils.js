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
