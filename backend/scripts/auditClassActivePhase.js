/**
 * Read-only audit: Class Details "Current" / auto-opened phase accuracy.
 *
 * Compares the OLD buggy active-phase rule (return next phase as soon as the
 * first completed phase is found — often stuck on Phase 2) against the FIXED
 * rule (first phase whose last session is still on/after today).
 *
 * "WOULD_OPEN_WRONG_PHASE" means schedule DATA is fine, but the OLD UI logic
 * would open a different (incorrect) Current phase than the fixed rule.
 * This is NOT a data-quality failure.
 *
 * Does NOT update the database. Use this before / after deploying the
 * classActivePhase fix to see which classes the old UI would open wrongly.
 *
 * Usage (from backend/):
 *   node scripts/auditClassActivePhase.js
 *   node scripts/auditClassActivePhase.js --mismatches-only
 *   node scripts/auditClassActivePhase.js --branch-id=3
 *   node scripts/auditClassActivePhase.js --class-id=123
 *   node scripts/auditClassActivePhase.js --today=2026-07-20
 *   node scripts/auditClassActivePhase.js --include-inactive
 *   node scripts/auditClassActivePhase.js --json
 *   node scripts/auditClassActivePhase.js --limit=50
 */
import '../config/loadEnv.js';
import { query } from '../config/database.js';
import { calculateSessionDate } from '../utils/sessionCalculation.js';
import { coerceToManilaYmd, todayYmdManila } from '../utils/dateUtils.js';

function argValue(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const todayOverride = argValue('today');
const branchId = argValue('branch-id');
const classId = argValue('class-id');
const limit = argValue('limit') ? parseInt(argValue('limit'), 10) : null;
const mismatchesOnly = hasFlag('mismatches-only');
const includeInactive = hasFlag('include-inactive');
const jsonOut = hasFlag('json');
const help = hasFlag('help') || hasFlag('h');

if (help) {
  console.log(`
Audit Class Details "Current" phase (old buggy logic vs fixed logic).

  node scripts/auditClassActivePhase.js
  node scripts/auditClassActivePhase.js --mismatches-only
  node scripts/auditClassActivePhase.js --branch-id=3 --today=2026-07-20
  node scripts/auditClassActivePhase.js --class-id=123 --json

Options:
  --today=YYYY-MM-DD   As-of date (default: today Asia/Manila)
  --branch-id=N        Filter by branch
  --class-id=N         Audit a single class
  --include-inactive   Include non-Active classes
  --mismatches-only    Print only classes where old UI would open wrong phase
  --limit=N            Max classes to scan
  --json               Machine-readable output
  --help               Show this help

  Flag WOULD_OPEN_WRONG_PHASE = old UI phase != correct phase (data is OK).
`);
  process.exit(0);
}

const todayStr =
  todayOverride && /^\d{4}-\d{2}-\d{2}$/.test(todayOverride)
    ? todayOverride
    : todayYmdManila();

const normalizeYmd = (value) => coerceToManilaYmd(value) || null;

const resolveSessionDate = (
  classSessions,
  classDetails,
  daysOfWeek,
  sessionsPerPhase,
  phaseNumber,
  phaseSessionNumber
) => {
  const fromDb = classSessions.find(
    (cs) =>
      cs.phase_number === phaseNumber &&
      cs.phase_session_number === phaseSessionNumber
  )?.scheduled_date;

  const dbYmd = normalizeYmd(fromDb);
  if (dbYmd) return dbYmd;

  const startYmd = normalizeYmd(classDetails?.start_date);
  if (!startYmd || !sessionsPerPhase) return null;

  return calculateSessionDate(
    startYmd,
    daysOfWeek,
    phaseNumber,
    phaseSessionNumber,
    sessionsPerPhase,
    classDetails.number_of_phase
  );
};

const groupPhaseSessions = (phaseSessions) => {
  const sessionsByPhase = (phaseSessions || []).reduce((acc, session) => {
    const phaseNum = Number(session.phase_number);
    if (!acc[phaseNum]) acc[phaseNum] = [];
    acc[phaseNum].push(session);
    return acc;
  }, {});

  return Object.keys(sessionsByPhase)
    .map(Number)
    .sort((a, b) => a - b)
    .map((phaseNum) => ({
      phaseNum,
      sessions: sessionsByPhase[phaseNum].sort(
        (a, b) => a.phase_session_number - b.phase_session_number
      ),
    }));
};

const getPhaseBounds = (
  phaseNum,
  sessions,
  classSessions,
  classDetails,
  daysOfWeek,
  sessionsPerPhase
) => {
  const first = sessions[0];
  const last = sessions[sessions.length - 1];
  return {
    first: resolveSessionDate(
      classSessions,
      classDetails,
      daysOfWeek,
      sessionsPerPhase,
      first.phase_number,
      first.phase_session_number
    ),
    last: resolveSessionDate(
      classSessions,
      classDetails,
      daysOfWeek,
      sessionsPerPhase,
      last.phase_number,
      last.phase_session_number
    ),
  };
};

/** OLD buggy rule — returns next phase as soon as the first completed phase is found. */
function calculateActivePhaseOld(
  today,
  phaseSessions,
  classSessions,
  classDetails,
  daysOfWeek,
  sessionsPerPhase
) {
  if (!phaseSessions?.length || !classDetails?.start_date) return 1;

  const phases = groupPhaseSessions(phaseSessions);

  for (const { phaseNum, sessions } of phases) {
    const bounds = getPhaseBounds(
      phaseNum,
      sessions,
      classSessions,
      classDetails,
      daysOfWeek,
      sessionsPerPhase
    );
    if (bounds.first && bounds.last) {
      if (today >= bounds.first && today <= bounds.last) return phaseNum;
    } else if (bounds.first && today >= bounds.first) {
      return phaseNum;
    }
  }

  const firstPhase = phases[0];
  if (firstPhase?.sessions?.length) {
    const bounds = getPhaseBounds(
      firstPhase.phaseNum,
      firstPhase.sessions,
      classSessions,
      classDetails,
      daysOfWeek,
      sessionsPerPhase
    );
    if (bounds.first && today < bounds.first) return firstPhase.phaseNum;
  }

  for (let i = 0; i < phases.length; i += 1) {
    const { phaseNum, sessions } = phases[i];
    const bounds = getPhaseBounds(
      phaseNum,
      sessions,
      classSessions,
      classDetails,
      daysOfWeek,
      sessionsPerPhase
    );
    if (bounds.last && today > bounds.last) {
      if (i < phases.length - 1) return phases[i + 1].phaseNum;
      return phaseNum;
    }
  }

  return phases[phases.length - 1]?.phaseNum || 1;
}

/** FIXED rule — first phase whose last session is still on/after today. */
function calculateActivePhaseFixed(
  today,
  phaseSessions,
  classSessions,
  classDetails,
  daysOfWeek,
  sessionsPerPhase
) {
  if (!phaseSessions?.length || !classDetails?.start_date) return 1;

  const phases = groupPhaseSessions(phaseSessions);

  for (const { phaseNum, sessions } of phases) {
    const bounds = getPhaseBounds(
      phaseNum,
      sessions,
      classSessions,
      classDetails,
      daysOfWeek,
      sessionsPerPhase
    );
    if (bounds.last && today <= bounds.last) return phaseNum;
    if (!bounds.last && bounds.first && today >= bounds.first) return phaseNum;
  }

  return phases[phases.length - 1]?.phaseNum || 1;
}

function buildPhaseSessionsFromClassSessions(classSessions) {
  const seen = new Set();
  const rows = [];
  for (const cs of classSessions) {
    const key = `${cs.phase_number}-${cs.phase_session_number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      phase_number: Number(cs.phase_number),
      phase_session_number: Number(cs.phase_session_number),
    });
  }
  return rows.sort(
    (a, b) =>
      a.phase_number - b.phase_number ||
      a.phase_session_number - b.phase_session_number
  );
}

function phaseRangeLabel(phaseNum, phases, classSessions, classDetails, daysOfWeek, sessionsPerPhase) {
  const group = phases.find((p) => p.phaseNum === phaseNum);
  if (!group) return 'n/a';
  const bounds = getPhaseBounds(
    phaseNum,
    group.sessions,
    classSessions,
    classDetails,
    daysOfWeek,
    sessionsPerPhase
  );
  return `${bounds.first || '?'} → ${bounds.last || '?'}`;
}

async function main() {
  const params = [];
  const where = ['c.start_date IS NOT NULL'];

  if (!includeInactive) {
    where.push(`COALESCE(c.status, 'Active') = 'Active'`);
  }
  if (branchId) {
    params.push(parseInt(branchId, 10));
    where.push(`c.branch_id = $${params.length}`);
  }
  if (classId) {
    params.push(parseInt(classId, 10));
    where.push(`c.class_id = $${params.length}`);
  }

  let limitSql = '';
  if (Number.isInteger(limit) && limit > 0) {
    params.push(limit);
    limitSql = ` LIMIT $${params.length}`;
  }

  const classesRes = await query(
    `SELECT
       c.class_id,
       c.class_name,
       c.level_tag,
       c.branch_id,
       c.status,
       TO_CHAR(c.start_date, 'YYYY-MM-DD') AS start_date,
       p.curriculum_id,
       cu.number_of_phase,
       cu.number_of_session_per_phase,
       b.branch_name,
       p.program_name
     FROM classestbl c
     LEFT JOIN branchestbl b ON b.branch_id = c.branch_id
     LEFT JOIN programstbl p ON p.program_id = c.program_id
     LEFT JOIN curriculumstbl cu ON cu.curriculum_id = p.curriculum_id
     WHERE ${where.join(' AND ')}
     ORDER BY b.branch_name NULLS LAST, c.class_id
     ${limitSql}`,
    params
  );

  const classes = classesRes.rows;
  if (classes.length === 0) {
    console.log('No classes matched the filters.');
    process.exit(0);
  }

  const classIds = classes.map((c) => c.class_id);

  const sessionsRes = await query(
    `SELECT
       class_id,
       phase_number,
       phase_session_number,
       TO_CHAR(scheduled_date, 'YYYY-MM-DD') AS scheduled_date
     FROM classsessionstbl
     WHERE class_id = ANY($1::int[])
       AND COALESCE(status, 'Scheduled') != 'Cancelled'
     ORDER BY class_id, scheduled_date, phase_number, phase_session_number`,
    [classIds]
  );

  const sessionsByClass = new Map();
  for (const row of sessionsRes.rows) {
    if (!sessionsByClass.has(row.class_id)) sessionsByClass.set(row.class_id, []);
    sessionsByClass.get(row.class_id).push(row);
  }

  const curriculumIds = [
    ...new Set(classes.map((c) => c.curriculum_id).filter((id) => id != null)),
  ];

  const phaseSessionsByCurriculum = new Map();
  if (curriculumIds.length > 0) {
    const phaseRes = await query(
      `SELECT curriculum_id, phase_number, phase_session_number
       FROM phasesessionstbl
       WHERE curriculum_id = ANY($1::int[])
       ORDER BY curriculum_id, phase_number, phase_session_number`,
      [curriculumIds]
    );
    for (const row of phaseRes.rows) {
      if (!phaseSessionsByCurriculum.has(row.curriculum_id)) {
        phaseSessionsByCurriculum.set(row.curriculum_id, []);
      }
      phaseSessionsByCurriculum.get(row.curriculum_id).push({
        phase_number: Number(row.phase_number),
        phase_session_number: Number(row.phase_session_number),
      });
    }
  }

  const results = [];
  let mismatchCount = 0;
  let skippedNoSchedule = 0;

  for (const cls of classes) {
    const classSessions = sessionsByClass.get(cls.class_id) || [];
    let phaseSessions =
      (cls.curriculum_id && phaseSessionsByCurriculum.get(cls.curriculum_id)) || [];

    if (!phaseSessions.length && classSessions.length) {
      phaseSessions = buildPhaseSessionsFromClassSessions(classSessions);
    }

    if (!phaseSessions.length) {
      skippedNoSchedule += 1;
      continue;
    }

    const classDetails = {
      start_date: normalizeYmd(cls.start_date),
      number_of_phase: cls.number_of_phase,
      number_of_session_per_phase: cls.number_of_session_per_phase,
    };
    const daysOfWeek = [];
    const sessionsPerPhase = cls.number_of_session_per_phase;

    const oldPhase = calculateActivePhaseOld(
      todayStr,
      phaseSessions,
      classSessions,
      classDetails,
      daysOfWeek,
      sessionsPerPhase
    );
    const fixedPhase = calculateActivePhaseFixed(
      todayStr,
      phaseSessions,
      classSessions,
      classDetails,
      daysOfWeek,
      sessionsPerPhase
    );

    const phases = groupPhaseSessions(phaseSessions);
    const wouldOpenWrongPhase = oldPhase !== fixedPhase;
    if (wouldOpenWrongPhase) mismatchCount += 1;

    const row = {
      class_id: cls.class_id,
      branch_id: cls.branch_id,
      branch_name: cls.branch_name || null,
      program_name: cls.program_name || null,
      class_name: cls.class_name || cls.level_tag || null,
      status: cls.status,
      start_date: classDetails.start_date,
      max_phase: phases[phases.length - 1]?.phaseNum || null,
      session_rows: classSessions.length,
      as_of: todayStr,
      old_ui_opened_phase: oldPhase,
      correct_opened_phase: fixedPhase,
      would_open_wrong_phase: wouldOpenWrongPhase,
      // Keep legacy keys for any prior consumers of --json
      old_opened_phase: oldPhase,
      fixed_opened_phase: fixedPhase,
      mismatch: wouldOpenWrongPhase,
      flag: wouldOpenWrongPhase ? 'WOULD_OPEN_WRONG_PHASE' : 'OK',
      note: wouldOpenWrongPhase
        ? 'Schedule data is fine; old UI logic would open the wrong Current phase.'
        : 'Old UI and fixed rule agree.',
      old_phase_range: phaseRangeLabel(
        oldPhase,
        phases,
        classSessions,
        classDetails,
        daysOfWeek,
        sessionsPerPhase
      ),
      correct_phase_range: phaseRangeLabel(
        fixedPhase,
        phases,
        classSessions,
        classDetails,
        daysOfWeek,
        sessionsPerPhase
      ),
      fixed_phase_range: phaseRangeLabel(
        fixedPhase,
        phases,
        classSessions,
        classDetails,
        daysOfWeek,
        sessionsPerPhase
      ),
    };

    if (!mismatchesOnly || wouldOpenWrongPhase) {
      results.push(row);
    }
  }

  const summary = {
    as_of: todayStr,
    classes_scanned: classes.length,
    skipped_no_schedule: skippedNoSchedule,
    would_open_wrong_phase_count: mismatchCount,
    mismatches: mismatchCount,
    meaning:
      'would_open_wrong_phase = old UI Current phase differs from correct phase; schedule data is not wrong',
    reported_rows: results.length,
  };

  if (jsonOut) {
    console.log(JSON.stringify({ summary, results }, null, 2));
    process.exit(mismatchCount > 0 ? 2 : 0);
  }

  console.log('=== Class Details Current-phase audit (read-only) ===');
  console.log(`As of (Asia/Manila): ${todayStr}`);
  console.log(`Classes scanned:              ${summary.classes_scanned}`);
  console.log(`Skipped (no phases):          ${summary.skipped_no_schedule}`);
  console.log(`Would open wrong phase (UI):  ${summary.would_open_wrong_phase_count}`);
  console.log('');
  console.log(
    'Note: WOULD_OPEN_WRONG_PHASE = schedule data is OK; old UI would open wrong Current phase.'
  );
  console.log('');

  if (results.length === 0) {
    console.log(
      mismatchesOnly
        ? 'None — old UI and correct rule agree for all scanned classes.'
        : 'No rows to report.'
    );
    process.exit(0);
  }

  const pad = (v, n) => String(v ?? '').padEnd(n).slice(0, n);
  console.log(
    [
      pad('class_id', 10),
      pad('branch', 18),
      pad('class', 28),
      pad('oldUI', 6),
      pad('correct', 8),
      pad('old range', 26),
      pad('correct range', 26),
      'flag',
    ].join(' ')
  );
  console.log('-'.repeat(140));

  for (const r of results) {
    console.log(
      [
        pad(r.class_id, 10),
        pad(r.branch_name || `b${r.branch_id}`, 18),
        pad(r.class_name, 28),
        pad(r.old_ui_opened_phase, 6),
        pad(r.correct_opened_phase, 8),
        pad(r.old_phase_range, 26),
        pad(r.correct_phase_range, 26),
        r.flag,
      ].join(' ')
    );
  }

  console.log('');
  console.log(
    'oldUI = phase Class Details opened under old logic; correct = date-based Current phase.'
  );
  console.log('This script does not modify any data. Deploy the UI fix manually when ready.');

  process.exit(mismatchCount > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error('Audit failed:', err?.message || err);
  process.exit(1);
});
