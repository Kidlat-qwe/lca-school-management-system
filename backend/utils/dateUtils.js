const MANILA_TZ = 'Asia/Manila';

export const formatYmdLocal = (dateObj) => {
  const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const parseYmdToLocalNoon = (ymd) => {
  if (!ymd) return null;
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  // Noon avoids timezone/DST shifting issues when later formatted.
  return new Date(y, m - 1, d, 12, 0, 0, 0);
};

/**
 * Parse date input for display (YYYY-MM-DD safe).
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
    return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  }

  const parsed = new Date(str);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * Format date for display: "June 06, 2026" (system-wide display format).
 * @param {string|Date} dateInput
 * @param {{ fallback?: string }} [options]
 * @returns {string}
 */
export const formatLongDateDisplay = (dateInput, options = {}) => {
  const { fallback = '' } = options;
  const d = parseDateForDisplay(dateInput);
  if (!d) return fallback;
  return d.toLocaleDateString('en-US', {
    timeZone: MANILA_TZ,
    month: 'long',
    day: '2-digit',
    year: 'numeric',
  });
};

/**
 * @deprecated Use formatLongDateDisplay — kept for existing imports.
 */
export const formatDDMMYYYY = (dateInput) => formatLongDateDisplay(dateInput);
