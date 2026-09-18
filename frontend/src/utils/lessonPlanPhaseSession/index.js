/**
 * Phase / session helpers for Teacher Lesson Plans.
 * Options come from GET /classes/:id/sessions (classsessionstbl).
 */

import { parseDateForDisplay } from '../dateUtils.js';

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
  const m = String(value || '').trim().match(/(\d+)/);
  return m ? m[1] : '';
}

export function parseSessionNumber(value) {
  const m = String(value || '').trim().match(/Session\s*(\d+)/i);
  return m ? m[1] : '';
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
  return (classSessions || [])
    .filter((row) => {
      if (!isSchedulableClassSession(row) || Number(row.phase_number) !== phase) return false;
      const key = buildSessionKey(row.phase_number, row.phase_session_number);
      if (keepKey && key === keepKey) return true;
      return isLessonPlanSessionNotPast(row, todayYmd);
    })
    .sort((a, b) => Number(a.phase_session_number) - Number(b.phase_session_number))
    .map((row) => {
      const sessionNum = row.phase_session_number;
      const topic = String(row.topic || '').trim();
      const label = topic
        ? `Session ${sessionNum} — ${topic}`
        : `Session ${sessionNum}`;
      return {
        key: buildSessionKey(row.phase_number, sessionNum),
        phase_number: row.phase_number,
        phase_session_number: sessionNum,
      scheduled_date: row.scheduled_date
        ? toLessonPlanFormDateYmd(row.scheduled_date)
        : '',
        scheduled_date_label: row.scheduled_date
          ? formatLessonPlanDateDisplay(row.scheduled_date)
          : '',
        topic,
        label,
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
 * Select value tying CMS class + phase/session (session-scoped class code).
 * `sessionNumberOrKey` may be a bare session number (`6`) or a full key (`1-6`).
 */
export function buildLessonPlanClassCodeValue(classId, phaseNumber, sessionNumberOrKey) {
  const cid = String(classId || '').trim();
  const rawSession = String(sessionNumberOrKey ?? '').trim();
  // Form state stores full keys (`1-6`); option builders pass bare session numbers.
  const sessionKey = rawSession.includes('-')
    ? rawSession
    : buildSessionKey(phaseNumber, rawSession);
  if (!cid || !sessionKey) return '';
  return `${cid}|${sessionKey}`;
}

export function parseLessonPlanClassCodeValue(value) {
  const raw = String(value || '').trim();
  if (!raw || !raw.includes('|')) {
    return { class_id: '', phase: '', session: '' };
  }
  const [classId, sessionKey] = raw.split('|');
  const [phaseStr] = String(sessionKey || '').split('-');
  return {
    class_id: String(classId || ''),
    phase: String(phaseStr || ''),
    session: String(sessionKey || ''),
  };
}

/**
 * Class Code options = one row per class session (same codes as Classes → View Class Details).
 * Hides past sessions unless keepValue is set for editing.
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
  const rows = (classSessions || [])
    .filter((row) => {
      if (!isSchedulableClassSession(row)) return false;
      const value = buildLessonPlanClassCodeValue(
        cidFilter || row.class_id,
        row.phase_number,
        row.phase_session_number
      );
      if (keep && value === keep) return true;
      return isLessonPlanSessionNotPast(row, todayYmd);
    })
    .sort((a, b) => sessionSortKey(a).localeCompare(sessionSortKey(b)));

  return rows.map((row) => {
    const phase = row.phase_number;
    const sessionNum = row.phase_session_number;
    const value = buildLessonPlanClassCodeValue(
      cidFilter || row.class_id,
      phase,
      sessionNum
    );
    const code = String(row.class_code || '').trim();
    const phaseSessionLabel = `Phase ${phase} - Session ${sessionNum}`;
    // Match Classes → View Class Details: primary label is the session class_code.
    // Do not append the schedule date here — Phase/Session fields already show it.
    const label = code || phaseSessionLabel;
    return {
      value,
      class_id: String(cidFilter || row.class_id || ''),
      phase: String(phase),
      session: buildSessionKey(phase, sessionNum),
      class_code: code,
      scheduled_date: row.scheduled_date ? toLessonPlanFormDateYmd(row.scheduled_date) : '',
      topic: String(row.topic || '').trim(),
      label,
      secondary_label: phaseSessionLabel,
      phase_session_label: phaseSessionLabel,
    };
  });
}

/** Prefer class_code for dropdown / list display. */
export function formatLessonPlanClassOptionLabel(cls = null) {
  if (!cls) return '';
  const code = String(cls.class_code || '').trim();
  if (code) return code;
  return String(cls.label || cls.class_name || '').trim();
}

/** Session class_code for the selected phase/session (View Class Details style). */
export function resolveSelectedSessionClassCode(classSessions = [], sessionKey) {
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

/** Map form keys → API display strings + lesson date from scheduled session. */
export function buildLessonPlanPhaseSessionPayload(formData = {}, classSessions = []) {
  const phaseNum = String(formData.phase || '').trim();
  const sessionKey = String(formData.session || '').trim();
  let phase = phaseNum ? `Phase ${phaseNum}` : '';
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

/** Map saved plan → dropdown values (phase number + session key). */
export function parseLessonPlanPhaseSessionForm(plan = {}) {
  const phase = parsePhaseNumber(plan.phase);
  const sessionNum = parseSessionNumber(plan.session);
  return {
    phase,
    session: phase && sessionNum ? buildSessionKey(phase, sessionNum) : '',
  };
}
