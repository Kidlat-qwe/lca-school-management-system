/**
 * Dry-run only: preview forcing holiday skip on a class's sessions, and check
 * whether new weekend dates collide with other classes (same room / overlapping time).
 *
 * Does NOT update the database (no --apply).
 *
 * Usage (from backend/):
 *   node scripts/dryRunForceHolidaySkipSessions.js --production
 *   node scripts/dryRunForceHolidaySkipSessions.js --production --class-id 172
 *   node scripts/dryRunForceHolidaySkipSessions.js --production --class-name "VMP_Playgroup_SS_1:00PM"
 */

import '../config/loadEnv.js';
import { query } from '../config/database.js';
import { generateClassSessions } from '../utils/sessionCalculation.js';
import { getCustomHolidayDateSetForRange } from '../utils/holidayService.js';

const DEFAULT_NAME = 'VMP_Playgroup_SS_1:00PM';

const getArgValue = (flag) => {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return String(process.argv[idx + 1]).trim();
  return null;
};

const CLASS_ID_ARG = getArgValue('--class-id');
const CLASS_NAME_ARG = getArgValue('--class-name') || DEFAULT_NAME;

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

const timeToMinutes = (timeStr) => {
  if (!timeStr) return 0;
  const parts = String(timeStr).split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1] || 0, 10);
};

const timesOverlap = (aStart, aEnd, bStart, bEnd) => {
  const as = timeToMinutes(aStart);
  const ae = timeToMinutes(aEnd);
  const bs = timeToMinutes(bStart);
  const be = timeToMinutes(bEnd);
  return as < be && bs < ae;
};

const getHolidayRangeFromStartDate = (startDate) => {
  const y = Number(String(startDate).slice(0, 4));
  return { startYmd: `${y}-01-01`, endYmd: `${y + 3}-12-31` };
};

async function findClass() {
  if (CLASS_ID_ARG && /^\d+$/.test(CLASS_ID_ARG)) {
    const r = await query(
      `SELECT c.class_id, c.class_name, c.start_date, c.end_date, c.branch_id, c.room_id,
              c.teacher_id, c.skip_holidays, c.level_tag, c.status,
              COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
              r.room_name,
              p.program_code, p.curriculum_id, p.session_duration_hours,
              cu.number_of_phase, cu.number_of_session_per_phase
       FROM classestbl c
       LEFT JOIN branchestbl b ON c.branch_id = b.branch_id
       LEFT JOIN roomstbl r ON c.room_id = r.room_id
       LEFT JOIN programstbl p ON c.program_id = p.program_id
       LEFT JOIN curriculumstbl cu ON p.curriculum_id = cu.curriculum_id
       WHERE c.class_id = $1`,
      [parseInt(CLASS_ID_ARG, 10)]
    );
    return r.rows[0] || null;
  }

  const r = await query(
    `SELECT c.class_id, c.class_name, c.start_date, c.end_date, c.branch_id, c.room_id,
            c.teacher_id, c.skip_holidays, c.level_tag, c.status,
            COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
            r.room_name,
            p.program_code, p.curriculum_id, p.session_duration_hours,
            cu.number_of_phase, cu.number_of_session_per_phase
     FROM classestbl c
     LEFT JOIN branchestbl b ON c.branch_id = b.branch_id
     LEFT JOIN roomstbl r ON c.room_id = r.room_id
     LEFT JOIN programstbl p ON c.program_id = p.program_id
     LEFT JOIN curriculumstbl cu ON p.curriculum_id = cu.curriculum_id
     WHERE c.class_name ILIKE $1
     ORDER BY c.class_id
     LIMIT 5`,
    [`%${CLASS_NAME_ARG}%`]
  );
  if (r.rows.length > 1) {
    console.log('Multiple matches — use --class-id:');
    for (const row of r.rows) console.log(`  ${row.class_id}: ${row.class_name}`);
    return null;
  }
  return r.rows[0] || null;
}

async function loadDaysOfWeek(classId) {
  const r = await query(
    `SELECT day_of_week, start_time::text AS start_time, end_time::text AS end_time
     FROM roomschedtbl WHERE class_id = $1 ORDER BY day_of_week`,
    [classId]
  );
  return r.rows;
}

async function main() {
  console.log('\n=== DRY RUN ONLY — force holiday skip preview (no DB writes) ===\n');

  const classData = await findClass();
  if (!classData) {
    console.error('Class not found.');
    process.exitCode = 1;
    return;
  }

  const startDate = toYmd(classData.start_date);
  const classId = classData.class_id;
  const daysOfWeek = await loadDaysOfWeek(classId);
  if (!startDate || daysOfWeek.length === 0) {
    console.error('Missing start_date or roomschedtbl schedule.');
    process.exitCode = 1;
    return;
  }

  console.log(`Class:     ${classData.class_name} (ID ${classId})`);
  console.log(`Branch:    ${classData.branch_name} (${classData.branch_id})`);
  console.log(`Room:      ${classData.room_name || '-'} (${classData.room_id || '-'})`);
  console.log(`Teacher:   ${classData.teacher_id || '-'}`);
  console.log(`Start:     ${startDate}`);
  console.log(`Current end_date: ${toYmd(classData.end_date) || '-'}`);
  console.log(`skip_holidays flag today: ${classData.skip_holidays === true}`);
  console.log(`Schedule days: ${daysOfWeek.map((d) => `${d.day_of_week} ${String(d.start_time).slice(0, 5)}-${String(d.end_time).slice(0, 5)}`).join(', ')}`);

  // --- Other classes on same days of week (same branch) ---
  const scheduleDays = daysOfWeek.map((d) => d.day_of_week);
  const otherSched = await query(
    `SELECT c.class_id, c.class_name, c.level_tag, c.status,
            c.room_id, r.room_name, c.teacher_id,
            rs.day_of_week, rs.start_time::text AS start_time, rs.end_time::text AS end_time,
            TO_CHAR(c.start_date, 'YYYY-MM-DD') AS start_date,
            TO_CHAR(c.end_date, 'YYYY-MM-DD') AS end_date
     FROM roomschedtbl rs
     INNER JOIN classestbl c ON rs.class_id = c.class_id
     LEFT JOIN roomstbl r ON c.room_id = r.room_id
     WHERE c.branch_id = $1
       AND c.class_id != $2
       AND c.status = 'Active'
       AND rs.day_of_week = ANY($3::text[])
     ORDER BY rs.day_of_week, rs.start_time, c.class_name`,
    [classData.branch_id, classId, scheduleDays]
  );

  console.log(`\n--- Other Active classes on same weekdays (${scheduleDays.join('/')}) in branch ---`);
  if (otherSched.rows.length === 0) {
    console.log('  (none)');
  } else {
    for (const row of otherSched.rows) {
      const sameRoom = classData.room_id && row.room_id === classData.room_id;
      const sameTeacher = classData.teacher_id && row.teacher_id === classData.teacher_id;
      const overlap = daysOfWeek.some(
        (d) =>
          d.day_of_week === row.day_of_week &&
          timesOverlap(d.start_time, d.end_time, row.start_time, row.end_time)
      );
      const flags = [
        sameRoom ? 'SAME_ROOM' : null,
        sameTeacher ? 'SAME_TEACHER' : null,
        overlap && (sameRoom || sameTeacher) ? 'TIME_OVERLAP' : null,
      ]
        .filter(Boolean)
        .join(', ');
      console.log(
        `  [${row.day_of_week}] ${String(row.start_time).slice(0, 5)}-${String(row.end_time).slice(0, 5)}  ` +
          `${row.class_name} (ID ${row.class_id}, ${row.level_tag || '-'})  ` +
          `room=${row.room_name || row.room_id || '-'}  ` +
          `${flags ? `⚠ ${flags}` : 'ok'}`
      );
    }
  }

  const roomTimeConflicts = otherSched.rows.filter((row) => {
    if (!classData.room_id || row.room_id !== classData.room_id) return false;
    return daysOfWeek.some(
      (d) =>
        d.day_of_week === row.day_of_week &&
        timesOverlap(d.start_time, d.end_time, row.start_time, row.end_time)
    );
  });

  // --- Force holiday skip generation ---
  const { startYmd, endYmd } = getHolidayRangeFromStartDate(startDate);
  const holidayDateSet = await getCustomHolidayDateSetForRange(
    startYmd,
    endYmd,
    classData.branch_id || null
  );

  const phaseSessionsResult = await query(
    `SELECT phasesessiondetail_id, phase_number, phase_session_number
     FROM phasesessionstbl
     WHERE curriculum_id = $1
     ORDER BY phase_number, phase_session_number`,
    [classData.curriculum_id]
  );

  const generated = generateClassSessions(
    {
      class_id: classId,
      teacher_id: classData.teacher_id || null,
      start_date: startDate,
    },
    daysOfWeek.map((d) => ({
      day_of_week: d.day_of_week,
      start_time: d.start_time,
      end_time: d.end_time,
      enabled: true,
    })),
    phaseSessionsResult.rows,
    classData.number_of_phase,
    classData.number_of_session_per_phase,
    null,
    classData.session_duration_hours || null,
    holidayDateSet
  );

  const existing = await query(
    `SELECT classsession_id, phase_number, phase_session_number,
            scheduled_date::text AS scheduled_date,
            scheduled_start_time::text AS scheduled_start_time,
            scheduled_end_time::text AS scheduled_end_time,
            COALESCE(status, 'Scheduled') AS status
     FROM classsessionstbl
     WHERE class_id = $1
     ORDER BY phase_number, phase_session_number`,
    [classId]
  );

  const genMap = new Map(
    generated.map((s) => [`${s.phase_number}_${s.phase_session_number}`, s])
  );

  const changes = [];
  for (const row of existing.rows) {
    const key = `${row.phase_number}_${row.phase_session_number}`;
    const gen = genMap.get(key);
    if (!gen) continue;
    const oldDate = toYmd(row.scheduled_date);
    const newDate = toYmd(gen.scheduled_date);
    if (oldDate === newDate) continue;
    changes.push({
      classsession_id: row.classsession_id,
      phase: row.phase_number,
      session: row.phase_session_number,
      old_date: oldDate,
      new_date: newDate,
      start_time: gen.scheduled_start_time,
      end_time: gen.scheduled_end_time,
      status: row.status,
      on_holiday_before: holidayDateSet.has(oldDate),
    });
  }

  const newEnd = generated.length ? toYmd(generated[generated.length - 1].scheduled_date) : null;

  console.log(`\n--- Forced holiday-skip preview ---`);
  console.log(`Holidays in range: ${holidayDateSet.size}`);
  console.log(`Sessions that would change date: ${changes.length}`);
  console.log(`New last session / class end_date would be: ${newEnd}`);

  const holidayEscapes = changes.filter((c) => c.on_holiday_before);
  console.log(`Of those, currently ON a holiday: ${holidayEscapes.length}`);
  if (holidayEscapes.length) {
    console.log('\nHoliday escapes (old → new):');
    for (const c of holidayEscapes) {
      console.log(
        `  P${c.phase}S${c.session}: ${c.old_date} → ${c.new_date}  [${c.status}]`
      );
    }
  }

  if (changes.length && changes.length <= 40) {
    console.log('\nAll date shifts:');
    for (const c of changes) {
      console.log(`  P${c.phase}S${c.session}: ${c.old_date} → ${c.new_date}`);
    }
  } else if (changes.length > 40) {
    console.log('\nFirst 20 date shifts:');
    for (const c of changes.slice(0, 20)) {
      console.log(`  P${c.phase}S${c.session}: ${c.old_date} → ${c.new_date}`);
    }
    console.log(`  ... +${changes.length - 20} more`);
  }

  // --- Session-level collisions on NEW dates (same room + overlapping time) ---
  console.log('\n--- Session collisions on NEW dates (same room + overlapping time) ---');
  let collisionCount = 0;
  if (classData.room_id) {
    const newDates = [...new Set(changes.map((c) => c.new_date))];
    if (newDates.length === 0) {
      console.log('  (no date changes — skip collision check)');
    } else {
      const others = await query(
        `SELECT cs.classsession_id, cs.class_id, c.class_name,
                cs.scheduled_date::text AS scheduled_date,
                cs.scheduled_start_time::text AS start_time,
                cs.scheduled_end_time::text AS end_time,
                COALESCE(cs.status, 'Scheduled') AS status
         FROM classsessionstbl cs
         INNER JOIN classestbl c ON cs.class_id = c.class_id
         WHERE c.room_id = $1
           AND c.class_id != $2
           AND c.status = 'Active'
           AND COALESCE(cs.status, 'Scheduled') != 'Cancelled'
           AND cs.scheduled_date = ANY($3::date[])`,
        [classData.room_id, classId, newDates]
      );

      for (const ch of changes) {
        const hits = others.rows.filter(
          (o) =>
            toYmd(o.scheduled_date) === ch.new_date &&
            timesOverlap(ch.start_time, ch.end_time, o.start_time, o.end_time)
        );
        for (const h of hits) {
          collisionCount += 1;
          console.log(
            `  ⚠ P${ch.phase}S${ch.session} new ${ch.new_date} ${String(ch.start_time).slice(0, 5)} ` +
              `overlaps ${h.class_name} (session ${h.classsession_id})`
          );
        }
      }
      if (collisionCount === 0) console.log('  None found.');
    }
  } else {
    console.log('  (class has no room_id — skipped)');
  }

  console.log('\n=== Summary ===');
  console.log(`Would set skip_holidays=true and shift ${changes.length} session date(s).`);
  console.log(
    `Other weekday schedule room/time conflicts (static roomsched): ${roomTimeConflicts.length}`
  );
  if (roomTimeConflicts.length) {
    for (const row of roomTimeConflicts) {
      console.log(
        `  ⚠ ${row.class_name} [${row.day_of_week} ${String(row.start_time).slice(0, 5)}-${String(row.end_time).slice(0, 5)}]`
      );
    }
  } else {
    console.log('  No same-room overlapping Saturday/Sunday roomsched with other Active classes.');
  }
  console.log(`New-date session collisions in same room: ${collisionCount}`);
  console.log('\nDRY RUN complete — no changes written.\n');

  if (roomTimeConflicts.length > 0 || collisionCount > 0) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
