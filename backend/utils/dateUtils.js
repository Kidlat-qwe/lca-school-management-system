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

