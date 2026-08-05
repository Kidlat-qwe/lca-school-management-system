/**
 * Read-only: find classes where the next 25th issue is within N days of class start.
 *
 * Proposed lock rule (not applied — finder only):
 *   If next 25th on/after class.start_date is <= 7 days after start,
 *   Phase 2+ would lock to the 1st. Otherwise keep current 25th/5th.
 *
 * Defaults:
 *   --day-gap=7
 *   hits only (gap <= day-gap)
 *   all branches, classes with a start_date
 *
 * Run:
 *   node backend/scripts/findSevenDayClassStartGap.js --production
 *   node backend/scripts/findSevenDayClassStartGap.js --production --all
 *   node backend/scripts/findSevenDayClassStartGap.js --production --day-gap=7
 *   node backend/scripts/findSevenDayClassStartGap.js --production --branch-id=1
 *   node backend/scripts/findSevenDayClassStartGap.js --production --active-only
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

const showAll = process.argv.includes('--all');
const activeOnly = process.argv.includes('--active-only');
const dayGap = Number(argValue('--day-gap') || 7);
const branchIdArg = argValue('--branch-id');
const branchId = branchIdArg != null ? Number(branchIdArg) : null;

async function main() {
  if (!Number.isInteger(dayGap) || dayGap < 0 || dayGap > 31) {
    throw new Error(`Invalid --day-gap=${argValue('--day-gap')}. Use 0–31.`);
  }
  if (branchId != null && (!Number.isFinite(branchId) || branchId <= 0)) {
    throw new Error(`Invalid --branch-id=${branchIdArg}`);
  }

  console.log('\nFind classes with start → next 25th gap (READ ONLY)\n');
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);
  console.log(`Lock threshold: gap_days <= ${dayGap}`);
  console.log(`Show: ${showAll ? 'all classes with start_date' : 'hits only'}`);
  console.log(`Status filter: ${activeOnly ? 'Active only' : 'all statuses'}`);
  console.log(`Branch filter: ${branchId != null ? branchId : 'all'}`);
  console.log('next_25th = first 25th on/after class.start_date\n');

  const params = [dayGap];
  const innerFilters = ['c.start_date IS NOT NULL'];
  const outerFilters = [];

  if (activeOnly) {
    innerFilters.push(`LOWER(TRIM(COALESCE(c.status, ''))) = 'active'`);
  }
  if (branchId != null) {
    params.push(branchId);
    innerFilters.push(`c.branch_id = $${params.length}`);
  }
  if (!showAll) {
    outerFilters.push(`x.gap_days <= $1`);
  }

  const outerWhere = outerFilters.length ? `WHERE ${outerFilters.join('\n       AND ')}` : '';

  const result = await query(
    `WITH base AS (
       SELECT c.class_id,
              c.class_name,
              c.status,
              c.branch_id,
              c.start_date,
              CASE
                WHEN EXTRACT(DAY FROM c.start_date)::int <= 25 THEN
                  make_date(
                    EXTRACT(YEAR FROM c.start_date)::int,
                    EXTRACT(MONTH FROM c.start_date)::int,
                    25
                  )
                ELSE
                  make_date(
                    EXTRACT(YEAR FROM (c.start_date + INTERVAL '1 month'))::int,
                    EXTRACT(MONTH FROM (c.start_date + INTERVAL '1 month'))::int,
                    25
                  )
              END AS next_25th,
              p1.first_session AS phase1_first_session
       FROM classestbl c
       LEFT JOIN (
         SELECT class_id, MIN(scheduled_date) AS first_session
         FROM classsessionstbl
         WHERE phase_number = 1
         GROUP BY class_id
       ) p1 ON p1.class_id = c.class_id
       WHERE ${innerFilters.join('\n         AND ')}
     ),
     calc AS (
       SELECT b.*,
              (b.next_25th - b.start_date)::int AS gap_days
       FROM base b
     )
     SELECT x.class_id,
            x.class_name,
            x.status,
            x.branch_id,
            COALESCE(br.branch_nickname, br.branch_name) AS branch,
            TO_CHAR(x.start_date, 'YYYY-MM-DD') AS class_start,
            EXTRACT(DAY FROM x.start_date)::int AS start_day,
            TO_CHAR(x.phase1_first_session, 'YYYY-MM-DD') AS phase1_first_session,
            TO_CHAR(x.next_25th, 'YYYY-MM-DD') AS next_25th,
            x.gap_days,
            (x.gap_days <= $1) AS would_lock
     FROM calc x
     LEFT JOIN branchestbl br ON br.branch_id = x.branch_id
     ${outerWhere}
     ORDER BY x.gap_days ASC, x.start_date, x.branch_id, x.class_id`,
    params
  );

  const hits = result.rows.filter((r) => r.would_lock);
  console.log(`Rows: ${result.rows.length}  |  Would lock: ${hits.length}\n`);

  if (result.rows.length === 0) {
    console.log('No matching classes.');
    return;
  }

  console.table(
    result.rows.map((r) => ({
      branch_id: r.branch_id,
      branch: r.branch,
      class_id: r.class_id,
      class_name: r.class_name,
      status: r.status,
      class_start: r.class_start,
      start_day: r.start_day,
      phase1_first: r.phase1_first_session,
      next_25th: r.next_25th,
      gap_days: r.gap_days,
      would_lock: r.would_lock ? 'YES' : 'no',
    }))
  );

  if (!showAll) {
    console.log('\nThese classes would switch Phase 2+ to 1st-of-month under the proposed rule.');
    console.log('Early-month starts (gap > 7) stay on current 25th/5th — omitted unless you pass --all.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Finder failed:', err?.message || err);
    process.exit(1);
  });
