/**
 * Phase / session helpers for Teacher Lesson Plans.
 * Options come from GET /classes/:id/sessions (classsessionstbl).
 *
 * Kindergarten and Grade School use a Week dropdown (1–44) instead of Phase.
 * Class Code still shows Phase + Session from the scheduled class session.
 */

import { parseDateForDisplay } from '../dateUtils.js';

/** Max week option for Kindergarten / Grade School lesson plans. */
export const LESSON_PLAN_WEEK_MAX = 44;

/** Week numbers 1..44 for the Week dropdown. */
export const LESSON_PLAN_WEEK_OPTIONS = Array.from(
  { length: LESSON_PLAN_WEEK_MAX },
  (_, i) => i + 1
);

function normalizeGradeLevelKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, ' ');
}

/**
 * Grades that show Week instead of Phase on the lesson plan form.
 * Class Code still displays Phase and Session from the schedule.
 */
export function isLessonPlanWeekGradeLevel(gradeLevel) {
  const key = normalizeGradeLevelKey(gradeLevel);
  if (!key) return false;
  if (key === 'kindergarten' || key === 'grade school') return true;
  // Legacy / alternate tags used in GRADE_LEVEL_OPTIONS
  if (/^grade [1-6]$/.test(key)) return true;
  return false;
}

/** True when saved phase string is a curriculum Week (not schedule Phase). */
export function isLessonPlanWeekPhaseValue(value) {
  return /^Week\s*\d+/i.test(String(value || '').trim());
}

export function parseWeekNumber(value) {
  const m = String(value || '').trim().match(/Week\s*(\d+)/i);
  if (!m) return '';
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1 || n > LESSON_PLAN_WEEK_MAX) return '';
  return String(n);
}

/** Display YYYY-MM-DD the same way as `<input type="date">` in the browser (locale-aware). */
export function formatLessonPlanDateDisplay(ymd) {
  const raw = String(ymd || '').trim().slice(0, 10);
  if (!raw) return '';
  const d = parseDateForDisplay(raw);
  if (!d) return raw;
  return d.toLocaleDateString(undefined, {
    timeZone: 'Asia/Manila',
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });
}

export function parsePhaseNumber(value) {
  // Do not treat "Week 12" as schedule Phase 12.
  if (isLessonPlanWeekPhaseValue(value)) return '';
  const m = String(value || '').trim().match(/(\d+)/);
  return m ? m[1] : '';
}

export function parseSessionNumber(value) {
  const raw = String(value || '').trim();
  const withLabel = raw.match(/Session\s*(\d+)/i);
  if (withLabel) return withLabel[1];
  // Bare number or "1-3" key → use last segment
  if (/^\d+$/.test(raw)) return raw;
  const keyPart = raw.match(/-(\d+)$/);
  if (keyPart) return keyPart[1];
  return '';
}

export function buildSessionKey(phaseNumber, sessionNumber) {
  if (phaseNumber == null || phaseNumber === '' || sessionNumber == null || sessionNumber === '') {
    return '';
  }
  return `${phaseNumber}-${sessionNumber}`;
}

export function isSchedulableClassSession(session) {
  const status = String(session?.status || 'Scheduled').trim();
  return status !== 'Cancelled';
}

export function isLessonPlanCancelledSession(session) {
  return String(session?.status || '').trim().toLowerCase() === 'cancelled';
}

/**
 * Makeup / rescheduled sessions created after a suspension.
 * Prefer suspension_id; also treat status Rescheduled as makeup.
 */
export function isLessonPlanMakeupSession(session) {
  if (!session) return false;
  if (isLessonPlanCancelledSession(session)) return false;
  if (session.is_makeup === true) return true;
  if (session.suspension_id != null && session.suspension_id !== '') return true;
  const status = String(session.status || '').trim().toLowerCase();
  if (status === 'rescheduled') return true;
  const notes = String(session.notes || '').toLowerCase();
  return notes.includes('makeup');
}

/**
 * Phase/Session secondary label.
 * Uses display session number (Class Details style) when provided.
 */
export function formatLessonPlanPhaseSessionLabel(
  phaseNumber,
  sessionNumber,
  { makeup = false, cancelled = false } = {}
) {
  const phase = phaseNumber != null && phaseNumber !== '' ? `Phase ${phaseNumber}` : '';
  const session = sessionNumber != null && sessionNumber !== '' ? `Session ${sessionNumber}` : '';
  const base = phase && session ? `${phase} - ${session}` : phase || session || '';
  if (!base) {
    if (cancelled) return 'Cancelled';
    if (makeup) return 'Makeup';
    return '';
  }
  if (cancelled) return `Cancelled · ${base}`;
  if (makeup) return `Makeup · ${base}`;
  return base;
}

/**
 * Display session numbers matching Class Details:
 * cancelled keep DB number; active + makeup renumber chronologically within each class+phase.
 * @returns {Map<string, number>} key from lessonPlanSessionRowKey
 */
export function buildLessonPlanDisplaySessionNumberMap(classSessions = []) {
  const byClassPhase = new Map();
  for (const row of classSessions || []) {
    const phase = Number(row?.phase_number);
    if (!Number.isFinite(phase) || phase <= 0) continue;
    const classId = String(row?.class_id ?? '');
    const groupKey = `${classId}|${phase}`;
    if (!byClassPhase.has(groupKey)) byClassPhase.set(groupKey, []);
    byClassPhase.get(groupKey).push(row);
  }

  const map = new Map();
  for (const [, rows] of byClassPhase) {
    const sorted = [...rows].sort((a, b) => sessionSortKey(a).localeCompare(sessionSortKey(b)));
    let activeCount = 0;
    for (const row of sorted) {
      const key = lessonPlanSessionRowKey(row);
      if (isLessonPlanCancelledSession(row)) {
        map.set(key, Number(row.phase_session_number) || 0);
        continue;
      }
      activeCount += 1;
      map.set(key, activeCount);
    }
  }
  return map;
}

export function lessonPlanSessionRowKey(row) {
  if (row?.classsession_id != null && row.classsession_id !== '') {
    return `cs:${row.classsession_id}`;
  }
  return `ps:${row?.phase_number}-${row?.phase_session_number}`;
}

/** True when session date is today or later (Manila YMD). Undated sessions stay available. */
export function isLessonPlanSessionNotPast(session, todayYmd) {
  const d = String(session?.scheduled_date || '').trim().slice(0, 10);
  if (!d) return true;
  const today = String(todayYmd || '').trim().slice(0, 10);
  if (!today) return true;
  return d >= today;
}

function sessionSortKey(row) {
  const date = String(row?.scheduled_date || '').slice(0, 10) || '9999-12-31';
  const phase = Number(row?.phase_number) || 0;
  const session = Number(row?.phase_session_number) || 0;
  return `${date}|${String(phase).padStart(4, '0')}|${String(session).padStart(4, '0')}`;
}

/**
 * Unique phase numbers from class sessions, ascending.
 * Hides phases that only have past sessions (unless keepPhase is set for editing).
 */
export function buildLessonPlanPhaseOptions(
  classSessions = [],
  { todayYmd = '', keepPhase = '' } = {}
) {
  const keep = String(keepPhase || '').trim();
  const nums = new Set();
  for (const row of classSessions) {
    if (!isSchedulableClassSession(row)) continue;
    const n = Number(row.phase_number);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (keep && String(n) === keep) {
      nums.add(n);
      continue;
    }
    if (!isLessonPlanSessionNotPast(row, todayYmd)) continue;
    nums.add(n);
  }
  return [...nums].sort((a, b) => a - b);
}

/**
 * Session rows for a phase, sorted by session number.
 * Hides past sessions unless keepSessionKey matches (editing an existing plan).
 */
export function buildLessonPlanSessionOptions(
  classSessions = [],
  phaseNumber,
  { todayYmd = '', keepSessionKey = '' } = {}
) {
  if (phaseNumber == null || phaseNumber === '') return [];
  const phase = Number(phaseNumber);
  const keepKey = String(keepSessionKey || '').trim();
  const phaseRows = (classSessions || []).filter(
    (row) => Number(row.phase_number) === phase
  );
  const displayMap = buildLessonPlanDisplaySessionNumberMap(phaseRows);
  return phaseRows
    .filter((row) => {
      if (!isSchedulableClassSession(row)) return false;
      const key = buildSessionKey(row.phase_number, row.phase_session_number);
      if (keepKey && key === keepKey) return true;
      return isLessonPlanSessionNotPast(row, todayYmd);
    })
    .sort((a, b) => Number(a.phase_session_number) - Number(b.phase_session_number))
    .map((row) => {
      const sessionNum = row.phase_session_number;
      const topic = String(row.topic || '').trim();
      const makeup = isLessonPlanMakeupSession(row);
      const displaySession =
        displayMap.get(lessonPlanSessionRowKey(row)) || Number(sessionNum) || sessionNum;
      // Dropdown shows numbers only; full "Session N" labels are for Class Code secondary text.
      let label = String(displaySession);
      if (makeup) {
        label = `${label} (Makeup)`;
      }
      return {
        key: buildSessionKey(row.phase_number, sessionNum),
        phase_number: row.phase_number,
        phase_session_number: sessionNum,
        display_session_number: displaySession,
        classsession_id:
          row.classsession_id != null ? String(row.classsession_id) : '',
        scheduled_date: row.scheduled_date
          ? toLessonPlanFormDateYmd(row.scheduled_date)
          : '',
        scheduled_date_label: row.scheduled_date
          ? formatLessonPlanDateDisplay(row.scheduled_date)
          : '',
        topic,
        label,
        is_makeup: makeup,
        is_cancelled: false,
      };
    });
}

export function findLessonPlanSession(classSessions = [], sessionKey) {
  if (!sessionKey) return null;
  const [phaseStr, sessionStr] = String(sessionKey).split('-');
  const phase = Number(phaseStr);
  const sessionNum = Number(sessionStr);
  if (!Number.isFinite(phase) || !Number.isFinite(sessionNum)) return null;
  return (
    (classSessions || []).find(
      (row) =>
        Number(row.phase_number) === phase &&
        Number(row.phase_session_number) === sessionNum
    ) || null
  );
}

/** Build a set of "phase-session" keys already covered by lesson plans for a class. */
export function buildExistingLessonPlanSessionKeys(lessonPlans = [], classId) {
  const keys = new Set();
  const cid = String(classId || '');
  if (!cid) return keys;
  for (const plan of lessonPlans || []) {
    if (String(plan?.class_id || '') !== cid) continue;
    const { phase, session } = parseLessonPlanPhaseSessionForm(plan);
    if (phase && session) keys.add(session);
  }
  return keys;
}

/**
 * Next upcoming phase/session that does not already have a lesson plan.
 * Used as the default when creating a new plan for a class.
 */
export function findNextUncreatedLessonPlanDefaults(
  classSessions = [],
  lessonPlans = [],
  classId,
  todayYmd = ''
) {
  const existing = buildExistingLessonPlanSessionKeys(lessonPlans, classId);
  const upcoming = (classSessions || [])
    .filter(
      (row) =>
        isSchedulableClassSession(row) && isLessonPlanSessionNotPast(row, todayYmd)
    )
    .sort((a, b) => sessionSortKey(a).localeCompare(sessionSortKey(b)));

  for (const row of upcoming) {
    const key = buildSessionKey(row.phase_number, row.phase_session_number);
    if (!key || existing.has(key)) continue;
    return {
      phase: String(row.phase_number),
      session: key,
      lesson_date: row.scheduled_date ? toLessonPlanFormDateYmd(row.scheduled_date) : '',
      topic: String(row.topic || '').trim(),
      class_code: String(row.class_code || '').trim(),
    };
  }
  return null;
}

/**
 * Select value tying CMS class + phase/session (+ classsession_id when available).
 * `sessionNumberOrKey` may be a bare session number (`6`) or a full key (`1-6`).
 */
export function buildLessonPlanClassCodeValue(
  classId,
  phaseNumber,
  sessionNumberOrKey,
  classsessionId = ''
) {
  const cid = String(classId || '').trim();
  const rawSession = String(sessionNumberOrKey ?? '').trim();
  // Form state stores full keys (`1-6`); option builders pass bare session numbers.
  const sessionKey = rawSession.includes('-')
    ? rawSession
    : buildSessionKey(phaseNumber, rawSession);
  if (!cid || !sessionKey) return '';
  const csId = String(classsessionId || '').trim();
  return csId ? `${cid}|${sessionKey}|${csId}` : `${cid}|${sessionKey}`;
}

export function parseLessonPlanClassCodeValue(value) {
  const raw = String(value || '').trim();
  if (!raw || !raw.includes('|')) {
    return { class_id: '', phase: '', session: '', classsession_id: '' };
  }
  const parts = raw.split('|');
  const classId = parts[0] || '';
  const sessionKey = parts[1] || '';
  const classsessionId = parts[2] || '';
  const [phaseStr] = String(sessionKey || '').split('-');
  return {
    class_id: String(classId || ''),
    phase: String(phaseStr || ''),
    session: String(sessionKey || ''),
    classsession_id: String(classsessionId || ''),
  };
}

/**
 * Class Code options = one row per class session (same codes as Classes → View Class Details).
 * Includes Cancelled / Makeup with Class Details display session numbers.
 * Past Scheduled sessions are hidden unless keepValue is set; Cancelled always shown
 * so teachers can see suspended originals next to makeup.
 */
export function buildLessonPlanClassCodeOptions(
  classSessions = [],
  {
    todayYmd = '',
    keepValue = '',
    classId = '',
  } = {}
) {
  const keep = String(keepValue || '').trim();
  const cidFilter = String(classId || '').trim();
  const source = classSessions || [];
  const displayMap = buildLessonPlanDisplaySessionNumberMap(source);

  const rows = source
    .filter((row) => {
      const value = buildLessonPlanClassCodeValue(
        cidFilter || row.class_id,
        row.phase_number,
        row.phase_session_number,
        row.classsession_id
      );
      if (keep && value === keep) return true;
      // Always show cancelled (suspended) and makeup so both are visible.
      if (isLessonPlanCancelledSession(row) || isLessonPlanMakeupSession(row)) {
        return true;
      }
      if (!isSchedulableClassSession(row)) return false;
      return isLessonPlanSessionNotPast(row, todayYmd);
    })
    .sort((a, b) => sessionSortKey(a).localeCompare(sessionSortKey(b)));

  return rows.map((row) => {
    const phase = row.phase_number;
    const sessionNum = row.phase_session_number;
    const value = buildLessonPlanClassCodeValue(
      cidFilter || row.class_id,
      phase,
      sessionNum,
      row.classsession_id
    );
    const code = String(row.class_code || '').trim();
    const cancelled = isLessonPlanCancelledSession(row);
    const makeup = isLessonPlanMakeupSession(row);
    const displaySession =
      displayMap.get(lessonPlanSessionRowKey(row)) || Number(sessionNum) || sessionNum;
    const phaseSessionLabel = formatLessonPlanPhaseSessionLabel(phase, displaySession, {
      makeup,
      cancelled,
    });
    const label = code || phaseSessionLabel;
    return {
      value,
      class_id: String(cidFilter || row.class_id || ''),
      classsession_id:
        row.classsession_id != null ? String(row.classsession_id) : '',
      phase: String(phase),
      session: buildSessionKey(phase, sessionNum),
      phase_session_number: sessionNum,
      display_session_number: displaySession,
      class_code: code,
      scheduled_date: row.scheduled_date ? toLessonPlanFormDateYmd(row.scheduled_date) : '',
      topic: String(row.topic || '').trim(),
      label,
      secondary_label: phaseSessionLabel,
      phase_session_label: phaseSessionLabel,
      is_makeup: makeup,
      is_cancelled: cancelled,
      // Cancelled originals are visible for context; teachers should pick makeup/active.
      selectable: !cancelled,
      status: String(row.status || '').trim() || 'Scheduled',
    };
  });
}

/** Prefer class name for the Class dropdown (Class Code is a separate field). */
export function formatLessonPlanClassOptionLabel(cls = null) {
  if (!cls) return '';
  const name = String(cls.class_name || cls.label || '').trim();
  if (name) return name;
  const code = String(cls.class_code || '').trim();
  if (code) return code;
  const id = cls.class_id;
  return id != null ? `Class ${id}` : '';
}

/** Session class_code for the selected phase/session (View Class Details style). */
export function resolveSelectedSessionClassCode(
  classSessions = [],
  sessionKey,
  classsessionId = ''
) {
  const csId = String(classsessionId || '').trim();
  if (csId) {
    const byId = (classSessions || []).find(
      (row) => String(row?.classsession_id) === csId
    );
    if (byId) return String(byId.class_code || '').trim();
  }
  const row = findLessonPlanSession(classSessions, sessionKey);
  return String(row?.class_code || '').trim();
}

/** Coerce session/form dates to YYYY-MM-DD for lesson_date API field. */
export function toLessonPlanFormDateYmd(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const iso = value.toISOString?.();
    if (iso && /^\d{4}-\d{2}-\d{2}/.test(iso)) return iso.slice(0, 10);
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  }
  return '';
}

/**
 * Recover schedule Phase + Session from a saved plan using session class_code
 * (preferred) or class_id + session number.
 */
export function resolveSchedulePhaseSessionFromPlan(plan = {}, classSessions = []) {
  const sessions = classSessions || [];
  const code = String(plan.class_code || plan.subject || '').trim().toLowerCase();
  if (code) {
    const byCode = sessions.find(
      (row) => String(row?.class_code || '').trim().toLowerCase() === code
    );
    if (byCode) {
      return {
        phase: String(byCode.phase_number),
        session: buildSessionKey(byCode.phase_number, byCode.phase_session_number),
        classsession_id:
          byCode.classsession_id != null ? String(byCode.classsession_id) : '',
      };
    }
  }
  const sessionNum = parseSessionNumber(plan.session);
  if (!sessionNum) return { phase: '', session: '', classsession_id: '' };
  const matches = sessions.filter(
    (row) => String(row?.phase_session_number) === String(sessionNum)
  );
  if (matches.length === 1) {
    const row = matches[0];
    return {
      phase: String(row.phase_number),
      session: buildSessionKey(row.phase_number, row.phase_session_number),
      classsession_id: row.classsession_id != null ? String(row.classsession_id) : '',
    };
  }
  return { phase: '', session: '', classsession_id: '' };
}

/** Map form keys → API display strings + lesson date from scheduled session. */
export function buildLessonPlanPhaseSessionPayload(formData = {}, classSessions = []) {
  const phaseNum = String(formData.phase || '').trim();
  const weekNum = String(formData.week || '').trim();
  const sessionKey = String(formData.session || '').trim();
  const useWeek =
    isLessonPlanWeekGradeLevel(formData.grade_level) || Boolean(weekNum);

  let phase = '';
  if (useWeek && weekNum) {
    phase = `Week ${weekNum}`;
  } else if (phaseNum) {
    phase = `Phase ${phaseNum}`;
  }

  let session = '';
  let lesson_date = toLessonPlanFormDateYmd(formData.lesson_date);

  if (sessionKey) {
    const row = findLessonPlanSession(classSessions, sessionKey);
    const sessionNum = sessionKey.split('-')[1] || '';
    if (row?.topic) {
      session = `Session ${sessionNum} — ${row.topic}`;
    } else if (sessionNum) {
      session = `Session ${sessionNum}`;
    }
    const sessionYmd = toLessonPlanFormDateYmd(row?.scheduled_date);
    if (sessionYmd) {
      lesson_date = sessionYmd;
    }
  }

  return { phase, session, lesson_date };
}

/**
 * Map saved plan → form dropdown values.
 * For Week plans, `week` is set and schedule `phase`/`session` may need
 * `resolveSchedulePhaseSessionFromPlan` once class sessions are loaded.
 */
export function parseLessonPlanPhaseSessionForm(plan = {}) {
  const week = parseWeekNumber(plan.phase);
  if (week) {
    return {
      phase: '',
      week,
      session: '',
    };
  }
  const phase = parsePhaseNumber(plan.phase);
  const sessionNum = parseSessionNumber(plan.session);
  return {
    phase,
    week: '',
    session: phase && sessionNum ? buildSessionKey(phase, sessionNum) : '',
  };
}
