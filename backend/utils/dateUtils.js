const MANILA_TZ = 'Asia/Manila';

/** Business timezone for all calendar dates (Philippines, UTC+8). */
export { MANILA_TZ };

/**
 * Format a timestamp as YYYY-MM-DD in Asia/Manila (Philippines business calendar).
 * Use this for issue dates, due dates, "today", and invoice month filters.
 * @param {Date|string|number} dateObj
 * @returns {string|null}
 */
export const formatYmdLocal = (dateObj) => {
  const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-CA', { timeZone: MANILA_TZ });
};

/** Today's date in Asia/Manila as YYYY-MM-DD. */
export const todayYmdManila = () => formatYmdLocal(new Date());

const YMD_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalize any date input to YYYY-MM-DD on the Philippines business calendar.
 * Plain YYYY-MM-DD strings are returned as-is (no timezone shift).
 * Timestamps are converted using Asia/Manila.
 * @param {string|Date|number|null|undefined} dateInput
 * @param {{ fallbackToToday?: boolean }} [options]
 * @returns {string|null}
 */
export const coerceToManilaYmd = (dateInput, { fallbackToToday = false } = {}) => {
  if (dateInput == null || String(dateInput).trim() === '') {
    return fallbackToToday ? todayYmdManila() : null;
  }

  if (dateInput instanceof Date) {
    const formatted = formatYmdLocal(dateInput);
    if (formatted) return formatted;
    return fallbackToToday ? todayYmdManila() : null;
  }

  const str = String(dateInput).trim();
  if (YMD_ONLY_RE.test(str)) {
    return str;
  }

  const formatted = formatYmdLocal(new Date(str));
  if (formatted) return formatted;
  return fallbackToToday ? todayYmdManila() : null;
};

export const parseYmdToLocalNoon = (ymd) => {
  if (!ymd) return null;
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  // Noon avoids timezone/DST shifting issues when later formatted.
  return new Date(y, m - 1, d, 12, 0, 0, 0);
};

/** Add calendar days to a YYYY-MM-DD string; returns YYYY-MM-DD or null. */
export const addDaysToYmd = (ymd, days) => {
  const base = parseYmdToLocalNoon(ymd);
  if (!base || !Number.isFinite(days)) return null;
  const result = new Date(base.getTime());
  result.setDate(result.getDate() + days);
  return formatYmdLocal(result);
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
