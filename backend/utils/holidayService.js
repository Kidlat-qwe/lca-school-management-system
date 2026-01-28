import Holidays from 'date-holidays';

/**
 * Philippines national holiday helper (in-memory cached by year).
 *
 * Notes:
 * - We return dates as YYYY-MM-DD strings to avoid timezone ambiguity.
 * - `date-holidays` returns holiday entries with a `date` field that may include time + timezone;
 *   we safely normalize by taking the first 10 chars when possible.
 */

const hd = new Holidays('PH');

/** @type {Map<number, Array<any>>} */
const yearCache = new Map();

function toYmd(value) {
  if (!value) return null;

  // If it's already an ISO-like string, keep only YYYY-MM-DD.
  if (typeof value === 'string') {
    // Common formats: '2026-12-25 00:00:00', '2026-12-25T00:00:00.000Z', etc.
    if (value.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(value)) {
      return value.slice(0, 10);
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      const y = parsed.getFullYear();
      const m = String(parsed.getMonth() + 1).padStart(2, '0');
      const d = String(parsed.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return null;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return null;
}

export function getNationalHolidaysForYear(year) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 1900 || y > 2100) return [];

  if (yearCache.has(y)) return yearCache.get(y);

  const list = hd.getHolidays(y) || [];
  yearCache.set(y, list);
  return list;
}

export function getNationalHolidaySetForYears(years) {
  const set = new Set();
  const meta = [];

  (years || []).forEach((year) => {
    const list = getNationalHolidaysForYear(year);
    list.forEach((h) => {
      const date = toYmd(h?.date);
      if (!date) return;
      set.add(date);
      meta.push({
        date,
        name: h?.name || null,
        type: h?.type || null,
      });
    });
  });

  return { dateSet: set, holidays: meta };
}

export function getNationalHolidaysInRange(startYmd, endYmd) {
  const start = toYmd(startYmd);
  const end = toYmd(endYmd);
  if (!start || !end || start > end) {
    return { dateSet: new Set(), holidays: [] };
  }

  const startYear = Number(start.slice(0, 4));
  const endYear = Number(end.slice(0, 4));
  const years = [];
  for (let y = startYear; y <= endYear; y++) years.push(y);

  const { dateSet, holidays } = getNationalHolidaySetForYears(years);

  const filtered = holidays.filter((h) => h.date >= start && h.date <= end);
  const filteredSet = new Set(filtered.map((h) => h.date));

  return { dateSet: filteredSet, holidays: filtered };
}

