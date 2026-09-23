/**
 * Manual suspension makeup date window for a phase.
 *
 * Min = earliest session date in the phase.
 * Max = last calendar day of the month that contains the phase's latest session date
 * (so a phase spanning Sep–Oct allows makeup through Oct 31, not only the last session day).
 */

function toYmd(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return '';
}

/** Last calendar day YYYY-MM-DD of the month containing `ymd`. */
export function endOfMonthYmd(ymd) {
  const raw = toYmd(ymd);
  if (!raw) return '';
  const [y, m] = raw.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return '';
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

/**
 * @param {{ scheduled_date?: string|Date|null }[]} phaseSessions
 * @returns {{ minYmd: string, maxYmd: string, lastSessionYmd: string }}
 */
export function getManualMakeupDateBounds(phaseSessions = []) {
  const dates = (phaseSessions || [])
    .map((s) => toYmd(s?.scheduled_date))
    .filter(Boolean)
    .sort();
  if (!dates.length) {
    return { minYmd: '', maxYmd: '', lastSessionYmd: '' };
  }
  const minYmd = dates[0];
  const lastSessionYmd = dates[dates.length - 1];
  const maxYmd = endOfMonthYmd(lastSessionYmd);
  return { minYmd, maxYmd, lastSessionYmd };
}

/**
 * Compare YYYY-MM-DD strings (lexicographic works for ISO dates).
 * @returns {boolean} true when makeupYmd is inside [minYmd, maxYmd]
 */
export function isMakeupDateWithinManualBounds(makeupYmd, minYmd, maxYmd) {
  const d = toYmd(makeupYmd);
  const min = toYmd(minYmd);
  const max = toYmd(maxYmd);
  if (!d || !min || !max) return false;
  return d >= min && d <= max;
}

/**
 * Parse "HH:MM", "HH:MM:SS", or "h:mm AM/PM" to minutes from midnight.
 * @returns {number|null}
 */
export function timeToMinutes(timeStr) {
  if (timeStr == null || timeStr === '') return null;
  const raw = String(timeStr).trim();
  const ampm = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const m = parseInt(ampm[2], 10);
    const period = ampm[4].toUpperCase();
    if (period === 'PM' && h < 12) h += 12;
    if (period === 'AM' && h === 12) h = 0;
    return h * 60 + m;
  }
  const parts = raw.split(':');
  if (parts.length < 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/** True when [startA, endA) overlaps [startB, endB). Adjacent times (end === start) are OK. */
export function timesOverlap(startA, endA, startB, endB) {
  const a0 = timeToMinutes(startA);
  const a1 = timeToMinutes(endA);
  const b0 = timeToMinutes(startB);
  const b1 = timeToMinutes(endB);
  if (a0 == null || a1 == null || b0 == null || b1 == null) return false;
  return a0 < b1 && b0 < a1;
}

/**
 * Same date is allowed; overlapping clock time on that date is not.
 * Checks existing class sessions (non-Cancelled) and other makeup rows in the same batch.
 *
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function findManualMakeupTimeConflicts(opts = {}) {
  const byId = getManualMakeupTimeConflictsBySessionId(opts);
  const first = Object.values(byId)[0];
  if (!first) return { ok: true };
  return { ok: false, message: first };
}

/**
 * Per-makeup-row conflict messages keyed by `suspended_session_id`.
 * @returns {Record<string, string>}
 */
export function getManualMakeupTimeConflictsBySessionId({
  makeupSchedules = [],
  classSessions = [],
  excludeSessionIds = [],
} = {}) {
  const exclude = new Set(
    (excludeSessionIds || []).map((id) => Number(id)).filter((n) => Number.isFinite(n))
  );

  const activeSessions = (classSessions || []).filter((s) => {
    const id = Number(s.classsession_id ?? s.id);
    if (Number.isFinite(id) && exclude.has(id)) return false;
    const status = String(s.status || '').trim();
    if (status.toLowerCase() === 'cancelled') return false;
    return true;
  });

  /** @type {Record<string, string>} */
  const conflicts = {};

  for (let i = 0; i < makeupSchedules.length; i++) {
    const a = makeupSchedules[i];
    const key = String(a.suspended_session_id ?? i);
    if (conflicts[key]) continue;

    const aDate = toYmd(a.makeup_date);
    if (!aDate || !a.makeup_start_time || !a.makeup_end_time) continue;

    for (const session of activeSessions) {
      if (toYmd(session.scheduled_date) !== aDate) continue;
      if (
        !timesOverlap(
          a.makeup_start_time,
          a.makeup_end_time,
          session.scheduled_start_time,
          session.scheduled_end_time
        )
      ) {
        continue;
      }
      const label =
        session.phase_number != null && session.phase_session_number != null
          ? `Phase ${session.phase_number} Session ${session.phase_session_number}`
          : session.class_code || `session ${session.classsession_id}`;
      const timeRange = `${String(session.scheduled_start_time).slice(0, 5)}–${String(session.scheduled_end_time).slice(0, 5)}`;
      conflicts[key] = `Overlaps ${label} (${timeRange}). Same day is allowed; choose a different start time.`;
      break;
    }
    if (conflicts[key]) continue;

    for (let j = 0; j < makeupSchedules.length; j++) {
      if (i === j) continue;
      const b = makeupSchedules[j];
      if (toYmd(b.makeup_date) !== aDate) continue;
      if (
        !timesOverlap(
          a.makeup_start_time,
          a.makeup_end_time,
          b.makeup_start_time,
          b.makeup_end_time
        )
      ) {
        continue;
      }
      conflicts[key] =
        'Overlaps another makeup in this batch at the same time. Same day is allowed; choose a different start time.';
      break;
    }
  }

  return conflicts;
}
