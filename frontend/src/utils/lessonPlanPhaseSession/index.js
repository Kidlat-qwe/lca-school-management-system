/**
 * Phase / session helpers for Teacher Lesson Plans.
 * Options come from GET /classes/:id/sessions (classsessionstbl).
 */

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

/** Unique phase numbers from class sessions, ascending. */
export function buildLessonPlanPhaseOptions(classSessions = []) {
  const nums = new Set();
  for (const row of classSessions) {
    if (!isSchedulableClassSession(row)) continue;
    const n = Number(row.phase_number);
    if (Number.isFinite(n) && n > 0) nums.add(n);
  }
  return [...nums].sort((a, b) => a - b);
}

/** Session rows for a phase, sorted by session number. */
export function buildLessonPlanSessionOptions(classSessions = [], phaseNumber) {
  if (phaseNumber == null || phaseNumber === '') return [];
  const phase = Number(phaseNumber);
  return (classSessions || [])
    .filter(
      (row) =>
        isSchedulableClassSession(row) && Number(row.phase_number) === phase
    )
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
          ? String(row.scheduled_date).slice(0, 10)
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

/** Map form keys → API display strings + lesson date from scheduled session. */
export function buildLessonPlanPhaseSessionPayload(formData = {}, classSessions = []) {
  const phaseNum = String(formData.phase || '').trim();
  const sessionKey = String(formData.session || '').trim();
  let phase = phaseNum ? `Phase ${phaseNum}` : '';
  let session = '';
  let lesson_date = formData.lesson_date;

  if (sessionKey) {
    const row = findLessonPlanSession(classSessions, sessionKey);
    const sessionNum = sessionKey.split('-')[1] || '';
    if (row?.topic) {
      session = `Session ${sessionNum} — ${row.topic}`;
    } else if (sessionNum) {
      session = `Session ${sessionNum}`;
    }
    if (row?.scheduled_date) {
      lesson_date = String(row.scheduled_date).slice(0, 10);
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
