/**
 * Read-only check: whether a class's sessions correctly skipped holidays.
 *
 * Compares actual classsessionstbl dates against:
 *   A) Expected schedule WITH holiday skip (current rules when skip_holidays=true)
 *   B) Expected schedule WITHOUT holiday skip
 *
 * Reports:
 *   - Sessions that fall ON a holiday (holiday not skipped)
 *   - Dates present in DB but not in expected-with-holidays
 *   - Dates expected-with-holidays but missing from DB
 *   - Whether DB looks closer to "skipped holidays" or "ignored holidays"
 *
 * Does NOT modify any data.
 *
 * Usage (from backend/ or repo root):
 *   node scripts/checkClassHolidaySkip.js
 *   node scripts/checkClassHolidaySkip.js "VMP_Playgroup_SS_1:00PM"
 *   node scripts/checkClassHolidaySkip.js --class-id 123
 *   node scripts/checkClassHolidaySkip.js --class-name "VMP_Playgroup"
 *   node scripts/checkClassHolidaySkip.js --production
 *   node scripts/checkClassHolidaySkip.js --production --json
 *
 * Default class name when no args: VMP_Playgroup_SS_1:00PM
 * Also matches class_code (ILIKE).
 */

import '../config/loadEnv.js';
import { query } from '../config/database.js';
import { computeSessionScheduleDates } from '../utils/sessionCalculation.js';
import { getCustomHolidayDateSetForRange } from '../utils/holidayService.js';

const DEFAULT_CLASS_NAME = 'VMP_Playgroup_SS_1:00PM';

const getArgValue = (flag) => {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return String(process.argv[idx + 1]).trim();
  return null;
};

const AS_JSON = process.argv.includes('--json');
const CLASS_ID_ARG = getArgValue('--class-id');
const CLASS_NAME_ARG =
  getArgValue('--class-name') ||
  process.argv.find(
    (a, i) => i > 1 && !a.startsWith('--') && process.argv[i - 1] !== '--class-id' && process.argv[i - 1] !== '--class-name'
  ) ||
  DEFAULT_CLASS_NAME;

const getHolidayRangeFromStartDate = (startDate) => {
  if (!startDate) return { startYmd: null, endYmd: null };
  const y = Number(String(startDate).slice(0, 4));
  if (!Number.isInteger(y)) return { startYmd: null, endYmd: null };
  return {
    startYmd: `${y}-01-01`,
    endYmd: `${y + 3}-12-31`,
  };
};

const toYmd = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const str = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(str) ? str.slice(0, 10) : null;
};

async function findClass() {
  if (CLASS_ID_ARG && /^\d+$/.test(CLASS_ID_ARG)) {
    const r = await query(
      `SELECT c.class_id, c.class_name, c.start_date, c.end_date, c.branch_id, c.skip_holidays,
              c.level_tag, c.status,
              COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
              p.program_code, p.curriculum_id,
              cu.number_of_phase, cu.number_of_session_per_phase
       FROM classestbl c
       LEFT JOIN branchestbl b ON c.branch_id = b.branch_id
       LEFT JOIN programstbl p ON c.program_id = p.program_id
       LEFT JOIN curriculumstbl cu ON p.curriculum_id = cu.curriculum_id
       WHERE c.class_id = $1`,
      [parseInt(CLASS_ID_ARG, 10)]
    );
    return r.rows;
  }

  const r = await query(
    `SELECT c.class_id, c.class_name, c.start_date, c.end_date, c.branch_id, c.skip_holidays,
            c.level_tag, c.status,
            COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
            p.program_code, p.curriculum_id,
            cu.number_of_phase, cu.number_of_session_per_phase
     FROM classestbl c
     LEFT JOIN branchestbl b ON c.branch_id = b.branch_id
     LEFT JOIN programstbl p ON c.program_id = p.program_id
     LEFT JOIN curriculumstbl cu ON p.curriculum_id = cu.curriculum_id
     WHERE c.class_name ILIKE $1
        OR EXISTS (
             SELECT 1 FROM classsessionstbl cs
             WHERE cs.class_id = c.class_id
               AND cs.class_code ILIKE $1
           )
     ORDER BY c.class_id`,
    [`%${CLASS_NAME_ARG}%`]
  );
  return r.rows;
}

async function loadDaysOfWeek(classId) {
  let schedulesResult = await query(
    `SELECT day_of_week, start_time::text AS start_time, end_time::text AS end_time
     FROM roomschedtbl
     WHERE class_id = $1
     ORDER BY day_of_week`,
    [classId]
  );
  if (schedulesResult.rows.length === 0) {
    schedulesResult = await query(
      `SELECT DISTINCT ON (EXTRACT(DOW FROM cs.scheduled_date))
         CASE EXTRACT(DOW FROM cs.scheduled_date)
           WHEN 0 THEN 'Sunday' WHEN 1 THEN 'Monday' WHEN 2 THEN 'Tuesday'
           WHEN 3 THEN 'Wednesday' WHEN 4 THEN 'Thursday' WHEN 5 THEN 'Friday'
           WHEN 6 THEN 'Saturday'
         END AS day_of_week,
         cs.scheduled_start_time::text AS start_time,
         cs.scheduled_end_time::text AS end_time
       FROM classsessionstbl cs
       WHERE cs.class_id = $1
         AND COALESCE(cs.status, 'Scheduled') != 'Cancelled'
         AND cs.scheduled_start_time IS NOT NULL
       ORDER BY EXTRACT(DOW FROM cs.scheduled_date), cs.scheduled_date`,
      [classId]
    );
  }
  return schedulesResult.rows.map((day) => ({
    day_of_week: day.day_of_week,
    start_time: day.start_time,
    end_time: day.end_time,
  }));
}

async function loadActualSessions(classId) {
  const r = await query(
    `SELECT classsession_id, phase_number, phase_session_number,
            scheduled_date::text AS scheduled_date,
            COALESCE(status, 'Scheduled') AS status,
            class_code
     FROM classsessionstbl
     WHERE class_id = $1
     ORDER BY scheduled_date, phase_number, phase_session_number`,
    [classId]
  );
  return r.rows.map((row) => ({
    ...row,
    scheduled_date: toYmd(row.scheduled_date),
  }));
}

async function loadHolidayDetails(startYmd, endYmd, branchId) {
  const params = [startYmd, endYmd];
  let sql = `
    SELECT holiday_date::text AS date, name,
           CASE WHEN branch_id IS NULL THEN 'global' ELSE 'branch' END AS scope
    FROM custom_holidaystbl
    WHERE holiday_date >= $1 AND holiday_date <= $2
  `;
  if (branchId != null) {
    sql += ` AND (branch_id IS NULL OR branch_id = $3)`;
    params.push(branchId);
  }
  sql += ` ORDER BY holiday_date, name`;
  const r = await query(sql, params);
  return r.rows;
}

function setDiff(a, b) {
  const out = [];
  for (const x of a) {
    if (!b.has(x)) out.push(x);
  }
  return out.sort();
}

function analyzeClass(classData, daysOfWeek, actualSessions, holidayDateSet, holidayDetails) {
  const startDate = toYmd(classData.start_date);
  const skipHolidaysFlag =
    classData.skip_holidays === true || classData.skip_holidays === 'true';

  const expectedWithSkip = computeSessionScheduleDates({
    startDate,
    daysOfWeek,
    number_of_phase: classData.number_of_phase,
    number_of_session_per_phase: classData.number_of_session_per_phase,
    holidayDateSet,
  });

  const expectedWithoutSkip = computeSessionScheduleDates({
    startDate,
    daysOfWeek,
    number_of_phase: classData.number_of_phase,
    number_of_session_per_phase: classData.number_of_session_per_phase,
    holidayDateSet: null,
  });

  const nonCancelled = actualSessions.filter(
    (s) => String(s.status || '').toLowerCase() !== 'cancelled'
  );
  const actualDates = nonCancelled.map((s) => s.scheduled_date).filter(Boolean);
  const actualDateSet = new Set(actualDates);
  const expectedWithSkipSet = new Set(expectedWithSkip);
  const expectedWithoutSkipSet = new Set(expectedWithoutSkip);

  const sessionsOnHoliday = nonCancelled.filter(
    (s) => s.scheduled_date && holidayDateSet.has(s.scheduled_date)
  );

  const holidayHits = holidayDetails
    .filter((h) => actualDateSet.has(h.date))
    .map((h) => ({
      date: h.date,
      name: h.name,
      scope: h.scope,
      sessions: nonCancelled.filter((s) => s.scheduled_date === h.date).map((s) => ({
        classsession_id: s.classsession_id,
        phase: s.phase_number,
        session: s.phase_session_number,
        status: s.status,
      })),
    }));

  const inDbNotInExpectedSkip = setDiff(actualDateSet, expectedWithSkipSet);
  const expectedSkipMissingInDb = setDiff(expectedWithSkipSet, actualDateSet);
  const inDbNotInExpectedNoSkip = setDiff(actualDateSet, expectedWithoutSkipSet);
  const expectedNoSkipMissingInDb = setDiff(expectedWithoutSkipSet, actualDateSet);

  const matchWithSkip =
    inDbNotInExpectedSkip.length === 0 && expectedSkipMissingInDb.length === 0;
  const matchWithoutSkip =
    inDbNotInExpectedNoSkip.length === 0 && expectedNoSkipMissingInDb.length === 0;

  let verdict;
  if (sessionsOnHoliday.length > 0) {
    verdict =
      'FAIL — one or more non-cancelled sessions fall on a holiday (holidays were not skipped for those dates).';
  } else if (matchWithSkip) {
    verdict = skipHolidaysFlag
      ? 'OK — session dates match expected schedule with holiday skip.'
      : 'OK — session dates match holiday-skipped schedule (even though skip_holidays flag is false).';
  } else if (matchWithoutSkip) {
    verdict =
      'LIKELY SKIPPED HOLIDAYS OFF — session dates match schedule generated WITHOUT skipping holidays.';
  } else {
    verdict =
      'MIXED / OTHER — dates match neither pure with-skip nor without-skip schedule (manual edits, makeup, or older rules).';
  }

  return {
    class_id: classData.class_id,
    class_name: classData.class_name,
    branch_id: classData.branch_id,
    branch_name: classData.branch_name,
    level_tag: classData.level_tag,
    status: classData.status,
    start_date: startDate,
    end_date: toYmd(classData.end_date),
    skip_holidays_flag: skipHolidaysFlag,
    schedule_days: daysOfWeek.map((d) => d.day_of_week),
    number_of_phase: classData.number_of_phase,
    number_of_session_per_phase: classData.number_of_session_per_phase,
    holiday_count_in_range: holidayDateSet.size,
    holidays_in_range: holidayDetails,
    actual_session_count: actualSessions.length,
    actual_non_cancelled_count: nonCancelled.length,
    expected_with_skip_count: expectedWithSkip.length,
    expected_without_skip_count: expectedWithoutSkip.length,
    sessions_on_holiday_count: sessionsOnHoliday.length,
    sessions_on_holiday: sessionsOnHoliday,
    holidays_that_have_sessions: holidayHits,
    db_dates_not_in_expected_with_skip: inDbNotInExpectedSkip,
    expected_with_skip_missing_from_db: expectedSkipMissingInDb,
    db_dates_not_in_expected_without_skip: inDbNotInExpectedNoSkip,
    expected_without_skip_missing_from_db: expectedNoSkipMissingInDb,
    matches_expected_with_skip: matchWithSkip,
    matches_expected_without_skip: matchWithoutSkip,
    verdict,
  };
}

function printReport(report) {
  console.log('\n========================================');
  console.log('Class holiday-skip check (read-only)');
  console.log('========================================');
  console.log(`Class:     ${report.class_name} (ID ${report.class_id})`);
  console.log(`Branch:    ${report.branch_name || '-'} (${report.branch_id})`);
  console.log(`Level:     ${report.level_tag || '-'}`);
  console.log(`Status:    ${report.status || '-'}`);
  console.log(`Start:     ${report.start_date}`);
  console.log(`End:       ${report.end_date || '-'}`);
  console.log(`skip_holidays flag: ${report.skip_holidays_flag}`);
  console.log(`Schedule:  ${report.schedule_days.join(', ') || '(none)'}`);
  console.log(
    `Curriculum: ${report.number_of_phase} phase(s) × ${report.number_of_session_per_phase} session(s)/phase`
  );
  console.log(`Holidays in generation range: ${report.holiday_count_in_range}`);
  console.log(`Actual sessions (all): ${report.actual_session_count}`);
  console.log(`Actual non-cancelled:  ${report.actual_non_cancelled_count}`);
  console.log(`Expected with skip:    ${report.expected_with_skip_count}`);
  console.log(`Expected without skip: ${report.expected_without_skip_count}`);

  if (report.holidays_that_have_sessions.length > 0) {
    console.log('\n--- Sessions ON holidays (problem) ---');
    for (const h of report.holidays_that_have_sessions) {
      console.log(`  ${h.date} — ${h.name} (${h.scope})`);
      for (const s of h.sessions) {
        console.log(
          `    session ${s.classsession_id}  Phase ${s.phase} Session ${s.session}  [${s.status}]`
        );
      }
    }
  } else {
    console.log('\nNo non-cancelled sessions fall on a holiday date.');
  }

  if (report.db_dates_not_in_expected_with_skip.length > 0) {
    console.log('\n--- DB dates not in expected-with-skip ---');
    console.log(`  ${report.db_dates_not_in_expected_with_skip.join(', ')}`);
  }
  if (report.expected_with_skip_missing_from_db.length > 0) {
    console.log('\n--- Expected-with-skip missing from DB ---');
    console.log(`  ${report.expected_with_skip_missing_from_db.join(', ')}`);
  }

  console.log(`\nMatches expected WITH holiday skip:    ${report.matches_expected_with_skip}`);
  console.log(`Matches expected WITHOUT holiday skip: ${report.matches_expected_without_skip}`);
  console.log(`\nVERDICT: ${report.verdict}\n`);
}

async function main() {
  const classes = await findClass();
  if (!classes.length) {
    console.error(
      `No class found for ${CLASS_ID_ARG ? `class_id=${CLASS_ID_ARG}` : `name ~ ${CLASS_NAME_ARG}`}`
    );
    process.exitCode = 1;
    return;
  }

  if (classes.length > 1 && !CLASS_ID_ARG) {
    console.log(`Multiple classes matched "${CLASS_NAME_ARG}". Checking all:\n`);
    for (const c of classes) {
      console.log(`  - ${c.class_id}: ${c.class_name}`);
    }
    console.log('');
  }

  const reports = [];
  for (const classData of classes) {
    const startDate = toYmd(classData.start_date);
    if (!startDate) {
      console.error(`Class ${classData.class_id} has no start_date — skipped.`);
      continue;
    }
    if (!classData.number_of_phase || !classData.number_of_session_per_phase) {
      console.error(
        `Class ${classData.class_id} missing curriculum phase/session counts — skipped.`
      );
      continue;
    }

    const daysOfWeek = await loadDaysOfWeek(classData.class_id);
    if (daysOfWeek.length === 0) {
      console.error(`Class ${classData.class_id} has no schedule — skipped.`);
      continue;
    }

    const { startYmd, endYmd } = getHolidayRangeFromStartDate(startDate);
    const holidayDateSet = await getCustomHolidayDateSetForRange(
      startYmd,
      endYmd,
      classData.branch_id || null
    );
    const holidayDetails = await loadHolidayDetails(
      startYmd,
      endYmd,
      classData.branch_id || null
    );
    const actualSessions = await loadActualSessions(classData.class_id);

    const report = analyzeClass(
      classData,
      daysOfWeek,
      actualSessions,
      holidayDateSet,
      holidayDetails
    );
    reports.push(report);

    if (!AS_JSON) printReport(report);
  }

  if (AS_JSON) {
    console.log(JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2));
  }

  const anyFail = reports.some((r) => r.sessions_on_holiday_count > 0);
  if (anyFail) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
