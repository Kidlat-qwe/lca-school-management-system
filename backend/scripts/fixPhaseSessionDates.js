/**
 * Fix phase/session dates for classes where sessions were generated with wrong start date
 * or outdated scheduling rules (e.g. inter-phase month jump vs continuous weekdays).
 *
 * This script:
 * 1. Finds the class by class_id or class_name (partial match), or all classes with sessions (--all)
 * 2. Regenerates correct session dates using class start_date and schedule (generateClassSessions)
 * 3. Updates classsessionstbl: scheduled_date, scheduled_start_time, scheduled_end_time, class_code
 * 4. Sets classestbl.end_date to MAX(scheduled_date) for non-cancelled sessions (class calendar end)
 *
 * Run from project root: node backend/scripts/fixPhaseSessionDates.js [class_id|class_name] [--dry-run]
 * Example: node backend/scripts/fixPhaseSessionDates.js 32
 * Example: node backend/scripts/fixPhaseSessionDates.js 123 --dry-run  (preview only)
 * Example: node backend/scripts/fixPhaseSessionDates.js --all --dry-run  (preview all classes)
 *
 * Alias for updating every class: node backend/scripts/updateAllClassSessionSchedules.js [--dry-run]
 */

import '../config/loadEnv.js';
import { query, getClient } from '../config/database.js';
import { generateClassSessions } from '../utils/sessionCalculation.js';
import { generateClassCode } from '../utils/classCodeGenerator.js';
import { getCustomHolidayDateSetForRange } from '../utils/holidayService.js';
import { syncClassEndDateFromSessions } from '../utils/classEndDateSync.js';

const getHolidayRangeFromStartDate = (startDate) => {
  if (!startDate) return { startYmd: null, endYmd: null };
  const y = Number(String(startDate).slice(0, 4));
  if (!Number.isInteger(y)) return { startYmd: null, endYmd: null };
  return {
    startYmd: `${y}-01-01`,
    endYmd: `${y + 3}-12-31`,
  };
};

async function findClass(identifier) {
  const trimmed = String(identifier || '').trim();
  if (!trimmed) return null;

  const byId = /^\d+$/.test(trimmed);
  if (byId) {
    const r = await query(
      `SELECT c.class_id, c.class_name, c.start_date, c.end_date, c.teacher_id, c.branch_id,
              c.skip_holidays, c.room_id,
              p.curriculum_id, p.program_code, p.session_duration_hours,
              cu.number_of_phase, cu.number_of_session_per_phase
       FROM classestbl c
       LEFT JOIN programstbl p ON c.program_id = p.program_id
       LEFT JOIN curriculumstbl cu ON p.curriculum_id = cu.curriculum_id
       WHERE c.class_id = $1`,
      [parseInt(trimmed, 10)]
    );
    return r.rows[0] || null;
  }

  const r = await query(
    `SELECT c.class_id, c.class_name, c.start_date, c.end_date, c.teacher_id, c.branch_id,
            c.skip_holidays, c.room_id,
            p.curriculum_id, p.program_code, p.session_duration_hours,
            cu.number_of_phase, cu.number_of_session_per_phase
     FROM classestbl c
     LEFT JOIN programstbl p ON c.program_id = p.program_id
     LEFT JOIN curriculumstbl cu ON p.curriculum_id = cu.curriculum_id
     WHERE c.class_name ILIKE $1`,
    [`%${trimmed}%`]
  );
  return r.rows[0] || null;
}

/**
 * @returns {Promise<{ ok: true, updated: number, skipped?: string } | { ok: false, error: string }>}
 */
async function fixClassSessionDatesForClass(classData, dryRun) {
  const classId = classData.class_id;
  const className = classData.class_name || classData.level_tag || `Class ${classId}`;

  let startDate = null;
  if (classData.start_date instanceof Date) {
    const y = classData.start_date.getFullYear();
    const m = String(classData.start_date.getMonth() + 1).padStart(2, '0');
    const d = String(classData.start_date.getDate()).padStart(2, '0');
    startDate = `${y}-${m}-${d}`;
  } else if (classData.start_date) {
    const str = String(classData.start_date);
    startDate = /^\d{4}-\d{2}-\d{2}$/.test(str) ? str : str.slice(0, 10);
  }

  console.log(`📌 Class: ${className} (ID: ${classId})`);
  console.log(`   Start date: ${startDate || 'NOT SET'}`);
  console.log(`   Program: ${classData.program_code || '-'}`);
  console.log(`   Phases: ${classData.number_of_phase}, Sessions/phase: ${classData.number_of_session_per_phase}`);

  if (!startDate || !classData.curriculum_id || !classData.number_of_phase || !classData.number_of_session_per_phase) {
    return { ok: false, error: 'Class missing start_date, curriculum_id, or phase/session config.' };
  }

  let schedulesResult = await query(
    'SELECT day_of_week, start_time, end_time FROM roomschedtbl WHERE class_id = $1 ORDER BY day_of_week',
    [classId]
  );
  if (schedulesResult.rows.length === 0) {
    schedulesResult = await query(
      `SELECT DISTINCT ON (EXTRACT(DOW FROM cs.scheduled_date))
         CASE EXTRACT(DOW FROM cs.scheduled_date)
           WHEN 0 THEN 'Sunday' WHEN 1 THEN 'Monday' WHEN 2 THEN 'Tuesday'
           WHEN 3 THEN 'Wednesday' WHEN 4 THEN 'Thursday' WHEN 5 THEN 'Friday'
           WHEN 6 THEN 'Saturday'
         END as day_of_week,
         cs.scheduled_start_time::text as start_time,
         cs.scheduled_end_time::text as end_time
       FROM classsessionstbl cs
       WHERE cs.class_id = $1
         AND COALESCE(cs.status, 'Scheduled') != 'Cancelled'
         AND cs.scheduled_start_time IS NOT NULL
         AND cs.scheduled_end_time IS NOT NULL
       ORDER BY EXTRACT(DOW FROM cs.scheduled_date), cs.scheduled_date`,
      [classId]
    );
  }
  if (schedulesResult.rows.length === 0) {
    return { ok: false, error: 'No schedule found (roomschedtbl or sessions).' };
  }

  const formattedDaysOfWeek = schedulesResult.rows.map((day) => ({
    day_of_week: day.day_of_week,
    start_time: day.start_time,
    end_time: day.end_time,
    enabled: true,
  }));
  console.log(`   Schedule: ${formattedDaysOfWeek.map((d) => d.day_of_week).join(', ')}`);

  const phaseSessionsResult = await query(
    `SELECT phasesessiondetail_id, phase_number, phase_session_number
     FROM phasesessionstbl
     WHERE curriculum_id = $1
     ORDER BY phase_number, phase_session_number`,
    [classData.curriculum_id]
  );

  const { startYmd, endYmd } = getHolidayRangeFromStartDate(startDate);
  const skipHolidays = classData.skip_holidays === true || classData.skip_holidays === 'true';
  const holidayDateSet =
    skipHolidays && startYmd && endYmd
      ? await getCustomHolidayDateSetForRange(startYmd, endYmd, classData.branch_id || null)
      : new Set();

  const debugTotalSessions =
    Number(classData.number_of_phase) * Number(classData.number_of_session_per_phase);
  console.log('   Debug generation params:', {
    startDate,
    daysOfWeekCount: formattedDaysOfWeek.length,
    number_of_phase: classData.number_of_phase,
    number_of_session_per_phase: classData.number_of_session_per_phase,
    totalSessions: debugTotalSessions,
  });

  const sessions = generateClassSessions(
    {
      class_id: classId,
      teacher_id: classData.teacher_id || null,
      start_date: startDate,
    },
    formattedDaysOfWeek,
    phaseSessionsResult.rows,
    classData.number_of_phase,
    classData.number_of_session_per_phase,
    null,
    classData.session_duration_hours || null,
    holidayDateSet
  );

  if (sessions.length === 0) {
    return { ok: false, error: 'No sessions generated. Check schedule and curriculum.' };
  }

  const sessionMap = new Map();
  sessions.forEach((s) => {
    sessionMap.set(`${s.phase_number}_${s.phase_session_number}`, s);
  });

  const existingSessions = await query(
    `SELECT classsession_id, phase_number, phase_session_number, scheduled_date, scheduled_start_time, scheduled_end_time, status, class_code
     FROM classsessionstbl
     WHERE class_id = $1
     ORDER BY phase_number, phase_session_number`,
    [classId]
  );

  const toUpdate = [];
  for (const row of existingSessions.rows) {
    const key = `${row.phase_number}_${row.phase_session_number}`;
    const generated = sessionMap.get(key);
    if (!generated) continue;

    const newDate = generated.scheduled_date;
    const oldDate = row.scheduled_date ? String(row.scheduled_date).slice(0, 10) : null;
    if (newDate === oldDate && generated.scheduled_start_time === row.scheduled_start_time) continue;

    let sessionClassCode = null;
    if (classData.program_code && generated.scheduled_date && generated.scheduled_start_time && className) {
      sessionClassCode = generateClassCode(
        classData.program_code,
        generated.scheduled_date,
        generated.scheduled_start_time,
        className
      );
    }

    toUpdate.push({
      classsession_id: row.classsession_id,
      phase_number: row.phase_number,
      phase_session_number: row.phase_session_number,
      old_date: oldDate,
      new_date: newDate,
      scheduled_start_time: generated.scheduled_start_time,
      scheduled_end_time: generated.scheduled_end_time,
      class_code: sessionClassCode,
      status: row.status,
    });
  }

  const lastSessionYmd =
    sessions.length > 0 ? sessions[sessions.length - 1].scheduled_date : null;

  if (toUpdate.length === 0) {
    console.log('\n✅ All sessions already have correct dates. No session row changes needed.');
    if (dryRun && lastSessionYmd) {
      console.log(`   (Would align class end_date with last session: ${lastSessionYmd})`);
    }
    if (!dryRun) {
      const sync = await syncClassEndDateFromSessions(query, classId);
      if (sync.updated) {
        console.log(`   Class end_date: ${sync.previous_end_date ?? 'null'} → ${sync.end_date}`);
      }
    }
    return { ok: true, updated: 0, endDateSynced: true };
  }

  console.log(`\n📋 ${dryRun ? 'Would update' : 'Updating'} ${toUpdate.length} session(s):\n`);
  for (const u of toUpdate) {
    console.log(
      `   P${u.phase_number}S${u.phase_session_number}: ${u.old_date} → ${u.new_date} ${u.status !== 'Scheduled' ? `[${u.status}]` : ''}`
    );
  }

  if (dryRun) {
    if (lastSessionYmd) {
      console.log(`\n   After apply, class end_date would align to last session: ${lastSessionYmd}`);
    }
    console.log('\n⚠️ Dry run - no changes made for this class.');
    return { ok: true, updated: toUpdate.length, dryRunPending: true };
  }

  const client = await getClient();
  try {
    for (const u of toUpdate) {
      await client.query(
        `UPDATE classsessionstbl
         SET scheduled_date = $1::date, scheduled_start_time = $2, scheduled_end_time = $3, class_code = COALESCE($4, class_code)
         WHERE classsession_id = $5`,
        [u.new_date, u.scheduled_start_time, u.scheduled_end_time, u.class_code, u.classsession_id]
      );
    }
    console.log('\n✅ Phase/session dates updated successfully.');
    const sync = await syncClassEndDateFromSessions(client, classId);
    if (sync.updated) {
      console.log(`📅 Class end_date: ${sync.previous_end_date ?? 'null'} → ${sync.end_date}`);
    }
    return { ok: true, updated: toUpdate.length };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    client.release();
  }
}

/**
 * Recompute and apply session dates for every class that has rows in classsessionstbl,
 * using the current generateClassSessions / sessionCalculation rules.
 *
 * @param {boolean} dryRun - If true, only print what would change.
 * @returns {Promise<{ processed: number, failures: number, totalSessionsTouched: number }>}
 */
export async function runFixAllClassSessionDates(dryRun) {
  console.log(`\n🔧 Fix Phase/Session Dates - ALL CLASSES${dryRun ? ' (DRY RUN - no changes)' : ''}\n`);

  const idsRes = await query(
    `SELECT DISTINCT c.class_id
     FROM classestbl c
     INNER JOIN classsessionstbl cs ON cs.class_id = c.class_id
     ORDER BY c.class_id`
  );

  let totalUpdated = 0;
  let failures = 0;
  for (const row of idsRes.rows) {
    const classData = await findClass(String(row.class_id));
    if (!classData) {
      console.warn(`⚠️ Skip class_id ${row.class_id}: not found in classestbl join.\n`);
      failures++;
      continue;
    }
    console.log('\n---');
    const result = await fixClassSessionDatesForClass(classData, dryRun);
    if (!result.ok) {
      console.error(`❌ ${result.error}`);
      failures++;
    } else if (result.updated > 0) {
      totalUpdated += result.updated;
    }
  }

  console.log(
    `\n📊 Done. Classes processed: ${idsRes.rows.length}, failures: ${failures}, sessions ${dryRun ? 'that would change' : 'updated'} (sum): ${totalUpdated}`
  );
  return { processed: idsRes.rows.length, failures, totalSessionsTouched: totalUpdated };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const allMode = args.includes('--all');
  const arg = args.find((a) => !a.startsWith('--'));

  if (allMode) {
    const summary = await runFixAllClassSessionDates(dryRun);
    if (summary.failures > 0) process.exit(1);
    return;
  }

  const identifier = arg || '32';
  console.log(`\n🔧 Fix Phase/Session Dates - Target: "${identifier}"${dryRun ? ' (DRY RUN - no changes)' : ''}\n`);

  const classData = await findClass(identifier);
  if (!classData) {
    console.error('❌ Class not found. Use class_id or class_name (partial match), or --all.');
    process.exit(1);
  }

  const result = await fixClassSessionDatesForClass(classData, dryRun);
  if (!result.ok) {
    console.error(`❌ ${result.error}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
