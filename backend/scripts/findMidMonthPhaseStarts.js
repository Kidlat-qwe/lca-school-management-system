/**
 * Read-only: list class+phase rows whose first session is mid-month.
 *
 * Phase start = MIN(scheduled_date) from classsessionstbl
 * (same rule as getPhaseStartDate / installment billing).
 *
 * Defaults:
 *   month     = 2026-08
 *   day-from  = 18
 *   day-to    = 30
 *
 * Run:
 *   node backend/scripts/findMidMonthPhaseStarts.js --production
 *   node backend/scripts/findMidMonthPhaseStarts.js --production --month=2026-08
 *   node backend/scripts/findMidMonthPhaseStarts.js --production --day-from=18 --day-to=30
 *   node backend/scripts/findMidMonthPhaseStarts.js --production --branch-id=1
 */

import '../config/loadEnv.js';
import { query } from '../config/database.js';

function argValue(flag) {
  const argv = process.argv.slice(2);
  const eqPrefix = `${flag}=`;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === flag) {
      const next = argv[i + 1];
      if (next == null || next.startsWith('--')) return null;
      return next;
    }
    if (token.startsWith(eqPrefix)) {
      return token.slice(eqPrefix.length) || null;
    }
  }
  return null;
}

const monthArg = String(argValue('--month') || '2026-08').trim();
const dayFrom = Number(argValue('--day-from') || 18);
const dayTo = Number(argValue('--day-to') || 30);
const branchIdArg = argValue('--branch-id');
const branchId = branchIdArg != null ? Number(branchIdArg) : null;

function parseMonth(value) {
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (!m) {
    throw new Error(`Invalid --month=${value}. Use YYYY-MM.`);
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) {
    throw new Error(`Invalid --month=${value}. Month must be 01–12.`);
  }
  const start = `${m[1]}-${m[2]}-01`;
  const endDate = new Date(Date.UTC(year, month, 0));
  const endDay = String(endDate.getUTCDate()).padStart(2, '0');
  const end = `${m[1]}-${m[2]}-${endDay}`;
  return { year, month, start, end };
}

async function main() {
  if (!Number.isInteger(dayFrom) || !Number.isInteger(dayTo) || dayFrom < 1 || dayTo > 31 || dayFrom > dayTo) {
    throw new Error(`Invalid day range: ${dayFrom}–${dayTo}`);
  }
  if (branchId != null && (!Number.isFinite(branchId) || branchId <= 0)) {
    throw new Error(`Invalid --branch-id=${branchIdArg}`);
  }

  const { start: monthStart, end: monthEnd } = parseMonth(monthArg);

  console.log('\nFind mid-month phase first sessions (READ ONLY)\n');
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);
  console.log(`Month: ${monthArg} (${monthStart} → ${monthEnd})`);
  console.log(`Mid-month day range: ${dayFrom}–${dayTo}`);
  console.log(`Branch filter: ${branchId != null ? branchId : 'all'}`);
  console.log('Phase start rule: MIN(classsessionstbl.scheduled_date) per class+phase\n');

  const params = [monthStart, monthEnd, dayFrom, dayTo];
  let branchSql = '';
  if (branchId != null) {
    params.push(branchId);
    branchSql = ` AND c.branch_id = $${params.length}`;
  }

  const result = await query(
    `SELECT b.branch_id,
            COALESCE(b.branch_nickname, b.branch_name) AS branch,
            c.class_id,
            c.class_name,
            TO_CHAR(c.start_date, 'YYYY-MM-DD') AS class_start,
            c.status AS class_status,
            p.phase_number,
            TO_CHAR(p.first_session, 'YYYY-MM-DD') AS first_session,
            TO_CHAR(p.last_session, 'YYYY-MM-DD') AS last_session,
            p.session_count,
            EXTRACT(DAY FROM p.first_session)::int AS first_session_day
     FROM (
       SELECT class_id,
              phase_number,
              MIN(scheduled_date) AS first_session,
              MAX(scheduled_date) AS last_session,
              COUNT(*)::int AS session_count
       FROM classsessionstbl
       GROUP BY class_id, phase_number
     ) p
     JOIN classestbl c ON c.class_id = p.class_id
     LEFT JOIN branchestbl b ON b.branch_id = c.branch_id
     WHERE p.first_session >= $1::date
       AND p.first_session <= $2::date
       AND EXTRACT(DAY FROM p.first_session) BETWEEN $3 AND $4
       ${branchSql}
     ORDER BY b.branch_id NULLS LAST, c.class_id, p.phase_number`,
    params
  );

  console.log(`Matches: ${result.rows.length}\n`);
  if (result.rows.length === 0) {
    console.log('No class+phase rows with a mid-month first session in this window.');
    return;
  }

  console.table(
    result.rows.map((r) => ({
      branch_id: r.branch_id,
      branch: r.branch,
      class_id: r.class_id,
      class_name: r.class_name,
      class_start: r.class_start,
      class_status: r.class_status,
      phase: r.phase_number,
      first_session: r.first_session,
      first_day: r.first_session_day,
      last_session: r.last_session,
      sessions: r.session_count,
    }))
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Finder failed:', err?.message || err);
    process.exit(1);
  });
