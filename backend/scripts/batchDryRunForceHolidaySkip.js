/**
 * Batch dry-run: force holiday skip preview + conflict summary for many class IDs.
 * No DB writes.
 *
 *   node scripts/batchDryRunForceHolidaySkip.js --production
 *   node scripts/batchDryRunForceHolidaySkip.js --production --class-ids 172,150,170
 */

import '../config/loadEnv.js';
import { query } from '../config/database.js';
import { generateClassSessions } from '../utils/sessionCalculation.js';
import { getCustomHolidayDateSetForRange } from '../utils/holidayService.js';

const DEFAULT_IDS = [172, 150, 170, 56, 177, 40, 178, 171, 153, 173, 144];

const getArgValue = (flag) => {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return String(process.argv[idx + 1]).trim();
  return null;
};

const CLASS_IDS = (() => {
  const raw = getArgValue('--class-ids');
  if (!raw) return DEFAULT_IDS;
  return raw
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n));
})();

const toYmd = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  return String(value).slice(0, 10);
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

async function analyze(classId) {
  const cRes = await query(
    `SELECT c.class_id, c.class_name, c.start_date, c.end_date, c.branch_id, c.room_id,
            c.teacher_id, c.skip_holidays,
            COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
            r.room_name,
            p.curriculum_id, p.session_duration_hours,
            cu.number_of_phase, cu.number_of_session_per_phase
     FROM classestbl c
     LEFT JOIN branchestbl b ON c.branch_id = b.branch_id
     LEFT JOIN roomstbl r ON c.room_id = r.room_id
     LEFT JOIN programstbl p ON c.program_id = p.program_id
     LEFT JOIN curriculumstbl cu ON p.curriculum_id = cu.curriculum_id
     WHERE c.class_id = $1`,
    [classId]
  );
  const c = cRes.rows[0];
  if (!c) return { class_id: classId, error: 'not_found' };

  const startDate = toYmd(c.start_date);
  const days = (
    await query(
      `SELECT day_of_week, start_time::text AS start_time, end_time::text AS end_time
       FROM roomschedtbl WHERE class_id = $1`,
      [classId]
    )
  ).rows;
  if (!startDate || !days.length) {
    return { class_id: classId, name: c.class_name, error: 'missing_start_or_schedule' };
  }

  const y = Number(startDate.slice(0, 4));
  const holidayDateSet = await getCustomHolidayDateSetForRange(
    `${y}-01-01`,
    `${y + 3}-12-31`,
    c.branch_id
  );

  const phaseSessions = (
    await query(
      `SELECT phasesessiondetail_id, phase_number, phase_session_number
       FROM phasesessionstbl WHERE curriculum_id = $1
       ORDER BY phase_number, phase_session_number`,
      [c.curriculum_id]
    )
  ).rows;

  const generated = generateClassSessions(
    { class_id: classId, teacher_id: c.teacher_id, start_date: startDate },
    days.map((d) => ({ ...d, enabled: true })),
    phaseSessions,
    c.number_of_phase,
    c.number_of_session_per_phase,
    null,
    c.session_duration_hours || null,
    holidayDateSet
  );

  const existing = (
    await query(
      `SELECT phase_number, phase_session_number, scheduled_date::text AS scheduled_date,
              COALESCE(status, 'Scheduled') AS status
       FROM classsessionstbl WHERE class_id = $1`,
      [classId]
    )
  ).rows;

  const genMap = new Map(
    generated.map((s) => [`${s.phase_number}_${s.phase_session_number}`, s])
  );

  const changes = [];
  for (const row of existing) {
    const gen = genMap.get(`${row.phase_number}_${row.phase_session_number}`);
    if (!gen) continue;
    const oldDate = toYmd(row.scheduled_date);
    const newDate = toYmd(gen.scheduled_date);
    if (oldDate === newDate) continue;
    changes.push({
      old_date: oldDate,
      new_date: newDate,
      start_time: gen.scheduled_start_time,
      end_time: gen.scheduled_end_time,
      on_holiday_before: holidayDateSet.has(oldDate),
    });
  }

  // Static roomsched: same room + overlapping time
  let roomschedTimeConflicts = 0;
  if (c.room_id) {
    const others = await query(
      `SELECT rs.day_of_week, rs.start_time::text AS start_time, rs.end_time::text AS end_time,
              c2.class_name
       FROM roomschedtbl rs
       INNER JOIN classestbl c2 ON rs.class_id = c2.class_id
       WHERE c2.branch_id = $1 AND c2.class_id != $2 AND c2.status = 'Active'
         AND c2.room_id = $3
         AND rs.day_of_week = ANY($4::text[])`,
      [c.branch_id, classId, c.room_id, days.map((d) => d.day_of_week)]
    );
    for (const o of others.rows) {
      const hit = days.some(
        (d) =>
          d.day_of_week === o.day_of_week &&
          timesOverlap(d.start_time, d.end_time, o.start_time, o.end_time)
      );
      if (hit) roomschedTimeConflicts += 1;
    }
  }

  // New-date session collisions same room
  let newDateCollisions = 0;
  const collisionSamples = [];
  if (c.room_id && changes.length) {
    const newDates = [...new Set(changes.map((ch) => ch.new_date))];
    const others = await query(
      `SELECT cs.classsession_id, c2.class_name, cs.scheduled_date::text AS scheduled_date,
              cs.scheduled_start_time::text AS start_time,
              cs.scheduled_end_time::text AS end_time
       FROM classsessionstbl cs
       INNER JOIN classestbl c2 ON cs.class_id = c2.class_id
       WHERE c2.room_id = $1 AND c2.class_id != $2 AND c2.status = 'Active'
         AND COALESCE(cs.status, 'Scheduled') != 'Cancelled'
         AND cs.scheduled_date = ANY($3::date[])`,
      [c.room_id, classId, newDates]
    );
    for (const ch of changes) {
      for (const o of others.rows) {
        if (toYmd(o.scheduled_date) !== ch.new_date) continue;
        if (!timesOverlap(ch.start_time, ch.end_time, o.start_time, o.end_time)) continue;
        newDateCollisions += 1;
        if (collisionSamples.length < 5) {
          collisionSamples.push(
            `${ch.new_date} overlaps ${o.class_name} (${String(o.start_time).slice(0, 5)})`
          );
        }
      }
    }
  }

  const newEnd = generated.length ? toYmd(generated[generated.length - 1].scheduled_date) : null;

  return {
    class_id: classId,
    name: c.class_name,
    branch: c.branch_name,
    room: c.room_name || String(c.room_id || '-'),
    days: days.map((d) => d.day_of_week).join('/'),
    skip_flag: c.skip_holidays === true,
    sessions_shift: changes.length,
    holiday_escapes: changes.filter((ch) => ch.on_holiday_before).length,
    new_end: newEnd,
    old_end: toYmd(c.end_date),
    roomsched_time_conflicts: roomschedTimeConflicts,
    new_date_collisions: newDateCollisions,
    collision_samples: collisionSamples,
    safe:
      roomschedTimeConflicts === 0 &&
      newDateCollisions === 0 &&
      changes.length > 0,
  };
}

console.log('\n=== BATCH DRY RUN — force holiday skip (no DB writes) ===\n');
console.log('IDs:', CLASS_IDS.join(', '));

const results = [];
for (const id of CLASS_IDS) {
  results.push(await analyze(id));
}

console.log(
  '\nid | safe? | shifts | holiday_escapes | roomsched_overlap | new_date_collisions | old_end → new_end | name'
);
let anyUnsafe = false;
for (const r of results) {
  if (r.error) {
    console.log(`${r.class_id} | ERROR | ${r.error}`);
    anyUnsafe = true;
    continue;
  }
  const safeLabel =
    r.roomsched_time_conflicts === 0 && r.new_date_collisions === 0 ? 'YES' : 'NO';
  if (safeLabel === 'NO') anyUnsafe = true;
  console.log(
    `${r.class_id} | ${safeLabel} | ${r.sessions_shift} | ${r.holiday_escapes} | ${r.roomsched_time_conflicts} | ${r.new_date_collisions} | ${r.old_end || '-'} → ${r.new_end || '-'} | ${r.name}`
  );
  if (r.collision_samples?.length) {
    for (const s of r.collision_samples) console.log(`         ⚠ ${s}`);
  }
}

console.log(
  `\nOverall: ${anyUnsafe ? 'SOME CONFLICTS — review before apply' : 'ALL CLEAR on room/time conflicts for these IDs'}`
);
console.log('DRY RUN complete — nothing written.\n');
process.exit(anyUnsafe ? 2 : 0);
