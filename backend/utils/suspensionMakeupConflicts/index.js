/**
 * Manual makeup time conflict helpers (same day allowed; overlapping clock time not).
 */

export function toYmd(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : '';
}

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

export function timesOverlap(startA, endA, startB, endB) {
  const a0 = timeToMinutes(startA);
  const a1 = timeToMinutes(endA);
  const b0 = timeToMinutes(startB);
  const b1 = timeToMinutes(endB);
  if (a0 == null || a1 == null || b0 == null || b1 == null) return false;
  return a0 < b1 && b0 < a1;
}

/**
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function findManualMakeupTimeConflicts({
  makeupSchedules = [],
  classSessions = [],
  excludeSessionIds = [],
} = {}) {
  const exclude = new Set(
    (excludeSessionIds || []).map((id) => Number(id)).filter((n) => Number.isFinite(n))
  );

  const activeSessions = (classSessions || []).filter((s) => {
    const id = Number(s.classsession_id);
    if (Number.isFinite(id) && exclude.has(id)) return false;
    if (String(s.status || '').toLowerCase() === 'cancelled') return false;
    return true;
  });

  for (let i = 0; i < makeupSchedules.length; i++) {
    const a = makeupSchedules[i];
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
          : `session ${session.classsession_id}`;
      return {
        ok: false,
        message: `Makeup on ${aDate} overlaps an existing class session (${label}). Same day is allowed, but the time must not overlap.`,
      };
    }

    for (let j = i + 1; j < makeupSchedules.length; j++) {
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
      return {
        ok: false,
        message: `Two makeup sessions overlap on ${aDate}. Same day is allowed, but times must not overlap.`,
      };
    }
  }

  return { ok: true };
}
