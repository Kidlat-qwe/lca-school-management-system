/**
 * Force holiday skip on class sessions: set skip_holidays=true, regenerate dates
 * with custom holidays skipped, update classsessionstbl, sync class end_date.
 *
 * Default: DRY RUN (no DB writes). Pass --apply to write.
 * Aborts --apply if same-room time collisions are found (use --force-conflicts to override).
 *
 * Usage (from backend/):
 *   # Batch dry-run (all FAIL IDs below)
 *   node scripts/forceHolidaySkipSessions.js --production
 *
 *   # Specific IDs dry-run
 *   node scripts/forceHolidaySkipSessions.js --production --class-ids 172,150,170
 *
 *   # Single class dry-run
 *   node scripts/forceHolidaySkipSessions.js --production --class-id 172
 *
 *   # Apply after you verified dry-run
 *   node scripts/forceHolidaySkipSessions.js --production --class-ids 172,150,170,56,177,40,178,171,153 --apply
 */

import '../config/loadEnv.js';
import { query, getClient } from '../config/database.js';
import { generateClassSessions } from '../utils/sessionCalculation.js';
import { generateClassCode } from '../utils/classCodeGenerator.js';
import { getCustomHolidayDateSetForRange } from '../utils/holidayService.js';
import { syncClassEndDateFromSessions } from '../utils/classEndDateSync.js';

const DEFAULT_IDS = [172, 150, 170, 56, 177, 40, 178, 171, 153, 173, 144];

const APPLY = process.argv.includes('--apply');
const FORCE_CONFLICTS = process.argv.includes('--force-conflicts');

const getArgValue = (flag) => {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return String(process.argv[idx + 1]).trim();
  return null;
};

const CLASS_IDS = (() => {
  const single = getArgValue('--class-id');
  if (single && /^\d+$/.test(single)) return [parseInt(single, 10)];
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

async function analyzeAndMaybeApply(classId) {
  const cRes = await query(
    `SELECT c.class_id, c.class_name, c.start_date, c.end_date, c.branch_id, c.room_id,
            c.teacher_id, c.skip_holidays,
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
      `SELECT classsession_id, phase_number, phase_session_number,
              scheduled_date::text AS scheduled_date,
              scheduled_start_time::text AS scheduled_start_time,
              scheduled_end_time::text AS scheduled_end_time,
              COALESCE(status, 'Scheduled') AS status
       FROM classsessionstbl WHERE class_id = $1
       ORDER BY phase_number, phase_session_number`,
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

    let sessionClassCode = null;
    if (c.program_code && gen.scheduled_date && gen.scheduled_start_time && c.class_name) {
      sessionClassCode = generateClassCode(
        c.program_code,
        gen.scheduled_date,
        gen.scheduled_start_time,
        c.class_name
      );
    }

    changes.push({
      classsession_id: row.classsession_id,
      phase: row.phase_number,
      session: row.phase_session_number,
      old_date: oldDate,
      new_date: newDate,
      start_time: gen.scheduled_start_time,
      end_time: gen.scheduled_end_time,
      class_code: sessionClassCode,
      on_holiday_before: holidayDateSet.has(oldDate),
    });
  }

  let roomschedTimeConflicts = 0;
  if (c.room_id) {
    const others = await query(
      `SELECT rs.day_of_week, rs.start_time::text AS start_time, rs.end_time::text AS end_time
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
  const hasConflicts = roomschedTimeConflicts > 0 || newDateCollisions > 0;

  const result = {
    class_id: classId,
    name: c.class_name,
    branch: c.branch_name,
    room: c.room_name || String(c.room_id || '-'),
    skip_flag_before: c.skip_holidays === true,
    sessions_shift: changes.length,
    holiday_escapes: changes.filter((ch) => ch.on_holiday_before).length,
    new_end: newEnd,
    old_end: toYmd(c.end_date),
    roomsched_time_conflicts: roomschedTimeConflicts,
    new_date_collisions: newDateCollisions,
    collision_samples: collisionSamples,
    applied: false,
    skipped_apply: false,
  };

  if (!APPLY) return result;

  if (hasConflicts && !FORCE_CONFLICTS) {
    result.skipped_apply = true;
    result.error = 'conflicts_block_apply';
    return result;
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE classestbl SET skip_holidays = true WHERE class_id = $1`, [classId]);

    for (const ch of changes) {
      await client.query(
        `UPDATE classsessionstbl
         SET scheduled_date = $1::date,
             scheduled_start_time = $2,
             scheduled_end_time = $3,
             class_code = COALESCE($4, class_code)
         WHERE classsession_id = $5`,
        [ch.new_date, ch.start_time, ch.end_time, ch.class_code, ch.classsession_id]
      );
    }

    const sync = await syncClassEndDateFromSessions(client, classId);
    await client.query('COMMIT');
    result.applied = true;
    result.end_date_sync = sync;
  } catch (err) {
    await client.query('ROLLBACK');
    result.error = err.message;
  } finally {
    client.release();
  }

  return result;
}

async function main() {
  console.log(
    `\n=== FORCE HOLIDAY SKIP — ${APPLY ? 'APPLY (writes DB)' : 'DRY RUN (no writes)'} ===\n`
  );
  console.log('IDs:', CLASS_IDS.join(', '));
  if (APPLY && FORCE_CONFLICTS) {
    console.log('⚠ --force-conflicts enabled: will apply even if room/time collisions exist');
  }

  const results = [];
  for (const id of CLASS_IDS) {
    results.push(await analyzeAndMaybeApply(id));
  }

  console.log(
    '\nid | safe? | shifts | holiday_escapes | roomsched_overlap | new_date_collisions | old_end → new_end | applied? | name'
  );

  let anyUnsafe = false;
  let anyError = false;
  for (const r of results) {
    if (r.error && r.error !== 'conflicts_block_apply') {
      console.log(`${r.class_id} | ERROR | ${r.error}`);
      anyError = true;
      continue;
    }
    const safeLabel =
      r.roomsched_time_conflicts === 0 && r.new_date_collisions === 0 ? 'YES' : 'NO';
    if (safeLabel === 'NO') anyUnsafe = true;
    const appliedLabel = !APPLY
      ? 'dry-run'
      : r.applied
        ? 'YES'
        : r.skipped_apply
          ? 'SKIPPED(conflicts)'
          : 'NO';
    console.log(
      `${r.class_id} | ${safeLabel} | ${r.sessions_shift} | ${r.holiday_escapes} | ${r.roomsched_time_conflicts} | ${r.new_date_collisions} | ${r.old_end || '-'} → ${r.new_end || '-'} | ${appliedLabel} | ${r.name}`
    );
    if (r.collision_samples?.length) {
      for (const s of r.collision_samples) console.log(`         ⚠ ${s}`);
    }
  }

  if (!APPLY) {
    console.log('\nDRY RUN complete — nothing written.');
    console.log('When ready to apply:');
    console.log(
      `  node scripts/forceHolidaySkipSessions.js --production --class-ids ${CLASS_IDS.join(',')} --apply`
    );
  } else {
    const appliedCount = results.filter((r) => r.applied).length;
    console.log(`\nAPPLY complete — ${appliedCount}/${results.length} class(es) updated.`);
  }

  if (anyError) process.exit(1);
  if (anyUnsafe && APPLY && !FORCE_CONFLICTS) process.exit(2);
  if (anyUnsafe && !APPLY) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
