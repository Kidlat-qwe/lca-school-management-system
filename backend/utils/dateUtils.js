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
 * Format date for display as DD/MM/YYYY (system-wide display format).
 * @param {string|Date} dateInput - ISO date string or Date
 * @returns {string} e.g. "10/02/2026" or '' if invalid
 */
export const formatDDMMYYYY = (dateInput) => {
  if (!dateInput) return '';
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return '';
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${day}/${month}/${year}`;
};

