/**
 * Audit timezone alignment for billing (installment penalties, due dates, dashboards).
 * Expected standard: Asia/Manila (UTC+8) for all business calendar dates.
 *
 * Usage (from backend folder):
 *   node scripts/checkSystemTimezone.js
 *   node scripts/checkSystemTimezone.js --sample-due=2026-06-05
 *   node scripts/checkSystemTimezone.js --json
 */
import '../config/loadEnv.js';
import { query, getClient } from '../config/database.js';
import { formatYmdLocal, parseYmdToLocalNoon } from '../utils/dateUtils.js';

const EXPECTED_TZ = 'Asia/Manila';
const EXPECTED_OFFSET_MINUTES = 480; // UTC+8

const args = process.argv.slice(2);
const jsonOut = args.includes('--json');
const sampleDueArg = args.find((a) => a.startsWith('--sample-due='));
const sampleDueYmd = sampleDueArg
  ? String(sampleDueArg.split('=')[1] || '').trim().slice(0, 10)
  : '2026-06-05';

const todayManilaYmd = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: EXPECTED_TZ });

const formatYmdManila = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-CA', { timeZone: EXPECTED_TZ });
};

const addDaysYmd = (ymd, days) => {
  const base = parseYmdToLocalNoon(ymd);
  if (!base) return null;
  base.setDate(base.getDate() + (Number(days) || 0));
  return formatYmdLocal(base);
};

const compareYmd = (a, b) => {
  if (!a || !b) return 0;
  return a === b ? 0 : a < b ? -1 : 1;
};

function collectNodeTimezone() {
  const now = new Date();
  const offsetMinutes = -now.getTimezoneOffset();
  const resolved =
    typeof Intl !== 'undefined' && Intl.DateTimeFormat
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : null;

  return {
    process_env_TZ: process.env.TZ ?? null,
    node_timezone_offset_minutes: offsetMinutes,
    node_timezone_offset_label: formatOffset(offsetMinutes),
    intl_resolved_timezone: resolved,
    node_local_ymd: formatYmdLocal(now),
    manila_ymd: todayManilaYmd(),
    node_local_iso: now.toString(),
    manila_datetime: now.toLocaleString('en-GB', {
      timeZone: EXPECTED_TZ,
      hour12: false,
    }),
    utc_iso: now.toISOString(),
  };
}

function formatOffset(minutes) {
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

async function collectPostgresTimezone(client) {
  const sessionTz = await client.query('SHOW timezone');
  const settings = await client.query(
    `SELECT
       current_setting('TIMEZONE') AS timezone_setting,
       TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS OF') AS now_timestamptz,
       TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD') AS current_date_session_ymd,
       TO_CHAR((NOW() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS today_manila_ymd,
       TO_CHAR(NOW() AT TIME ZONE $1, 'YYYY-MM-DD HH24:MI:SS') AS now_manila_text,
       TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS TZ') AS now_session_text,
       (CURRENT_DATE < (NOW() AT TIME ZONE $1)::date) AS session_date_before_manila,
       (CURRENT_DATE > (NOW() AT TIME ZONE $1)::date) AS session_date_after_manila`,
    [EXPECTED_TZ]
  );
  const row = settings.rows[0] || {};
  return {
    show_timezone: sessionTz.rows[0]?.TimeZone ?? sessionTz.rows[0]?.timezone ?? null,
    timezone_setting: row.timezone_setting,
    now_timestamptz: row.now_timestamptz,
    current_date_session_ymd: row.current_date_session_ymd,
    today_manila_ymd: row.today_manila_ymd,
    now_manila_text: row.now_manila_text,
    now_session_text: row.now_session_text,
    session_date_before_manila: row.session_date_before_manila,
    session_date_after_manila: row.session_date_after_manila,
  };
}

/** How node-pg DATE columns are read vs Manila (penalty job uses formatYmdLocal). */
function simulatePgDateRead(storedYmd) {
  const pgStyleUtcMidnight = new Date(`${storedYmd}T00:00:00.000Z`);
  return {
    stored_ymd: storedYmd,
    pg_date_as_js_date_iso: pgStyleUtcMidnight.toISOString(),
    formatYmdLocal_result: formatYmdLocal(pgStyleUtcMidnight),
    formatYmdManila_result: formatYmdManila(pgStyleUtcMidnight),
    parseYmdToLocalNoon_then_local: formatYmdLocal(parseYmdToLocalNoon(storedYmd)),
    local_vs_manila_match:
      formatYmdLocal(pgStyleUtcMidnight) === formatYmdManila(pgStyleUtcMidnight),
  };
}

/** Mirrors installmentDelinquencyService.js overdue + grace (current implementation). */
function simulateDelinquencyDates({ dueYmd, graceDays, pg, db }) {
  const todayJsLocal = formatYmdLocal(new Date());
  const dueFromPg = pg.due_date_js;
  const graceThreshold = addDaysYmd(formatYmdLocal(dueFromPg), graceDays + 1);
  const sqlWouldSelect = compareYmd(dueYmd, db.today_manila) < 0;
  const jsPenaltyEligible = compareYmd(todayJsLocal, graceThreshold) >= 0;

  const manilaDue = formatYmdManila(dueFromPg);
  const todayManila = db.today_manila;
  const manilaGraceThreshold = addDaysYmd(manilaDue, graceDays + 1);
  const manilaPenaltyEligible = compareYmd(todayManila, manilaGraceThreshold) >= 0;

  return {
    due_ymd_stored: dueYmd,
    grace_days: graceDays,
    db_today_manila: db.today_manila,
    db_today_session: db.today_session,
    node_today_local: todayJsLocal,
    node_today_manila: todayManila,
    sql_filter_due_lt_current_date: sqlWouldSelect,
    js_due_via_formatYmdLocal: formatYmdLocal(dueFromPg),
    js_grace_threshold_local: graceThreshold,
    js_penalty_eligible_current_code: jsPenaltyEligible,
    manila_due: manilaDue,
    manila_grace_threshold: manilaGraceThreshold,
    manila_penalty_eligible_recommended: manilaPenaltyEligible,
    mismatch_node_local_vs_manila_today: todayJsLocal !== todayManila,
    mismatch_pg_date_local_vs_manila:
      formatYmdLocal(dueFromPg) !== manilaDue,
  };
}

function buildChecks(node, pg, pgDateSim, delinq) {
  const checks = [];

  checks.push({
    id: 'node_offset_utc8',
    ok: node.node_timezone_offset_minutes === EXPECTED_OFFSET_MINUTES,
    message: `Node offset is ${node.node_timezone_offset_label} (expected UTC+8)`,
  });

  checks.push({
    id: 'node_env_tz_manila',
    ok: !process.env.TZ || process.env.TZ === EXPECTED_TZ,
    message: process.env.TZ
      ? `process.env.TZ=${process.env.TZ}`
      : 'process.env.TZ is unset (Node uses OS timezone)',
  });

  checks.push({
    id: 'node_today_matches_manila',
    ok: node.node_local_ymd === node.manila_ymd,
    message: `Node local today (${node.node_local_ymd}) vs Manila today (${node.manila_ymd})`,
  });

  checks.push({
    id: 'postgres_session_timezone',
    ok:
      String(pg.show_timezone || '').toLowerCase() === EXPECTED_TZ.toLowerCase() ||
      String(pg.timezone_setting || '').toLowerCase() === EXPECTED_TZ.toLowerCase(),
    message: `PostgreSQL session timezone: SHOW=${pg.show_timezone}, setting=${pg.timezone_setting}`,
  });

  checks.push({
    id: 'postgres_current_date_matches_manila',
    ok:
      String(pg.current_date_session_ymd) === String(pg.today_manila_ymd) &&
      !pg.session_date_before_manila &&
      !pg.session_date_after_manila,
    message: `CURRENT_DATE (${pg.current_date_session_ymd}) vs Manila today (${pg.today_manila_ymd})`,
  });

  checks.push({
    id: 'pg_date_reads_same_in_local_and_manila',
    ok: pgDateSim.local_vs_manila_match,
    message: `Sample DATE ${pgDateSim.stored_ymd}: formatYmdLocal=${pgDateSim.formatYmdLocal_result}, Manila=${pgDateSim.formatYmdManila_result}`,
  });

  checks.push({
    id: 'delinquency_no_local_manila_drift',
    ok:
      !delinq.mismatch_node_local_vs_manila_today &&
      !delinq.mismatch_pg_date_local_vs_manila,
    message: 'Delinquency date helpers aligned with Manila calendar',
  });

  return checks;
}

function printReport(payload) {
  if (jsonOut) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log('\n=== System timezone audit (expected: Asia/Manila UTC+8) ===\n');

  console.log('--- Node.js ---');
  console.table(payload.node);

  console.log('\n--- PostgreSQL ---');
  console.table(payload.postgres);

  console.log('\n--- PostgreSQL DATE via node-pg (UTC midnight) ---');
  console.table(payload.pg_date_simulation);

  console.log('\n--- Installment delinquency simulation ---');
  console.log(`Sample due_date: ${payload.delinquency_simulation.due_ymd_stored}, grace_days: 0`);
  console.table(payload.delinquency_simulation);

  console.log('\n--- Checks ---');
  for (const c of payload.checks) {
    const mark = c.ok ? 'PASS' : 'FAIL';
    console.log(`[${mark}] ${c.id}: ${c.message}`);
  }

  const failed = payload.checks.filter((c) => !c.ok);
  console.log('\n--- Summary ---');
  if (failed.length === 0) {
    console.log('All checks passed. Calendar dates align with Asia/Manila.');
  } else {
    console.log(`${failed.length} check(s) failed.`);
    console.log('\nRecommendations:');
    if (failed.some((f) => f.id.startsWith('node'))) {
      console.log('- Set TZ=Asia/Manila for the Node process (Windows: setx TZ Asia/Manila, or start server with TZ=Asia/Manila).');
    }
    if (failed.some((f) => f.id.startsWith('postgres'))) {
      console.log(
        '- Set PostgreSQL session TimeZone to Asia/Manila (Neon: connect with options or SET TIME ZONE in pool init).'
      );
      console.log('  Example pool option: options: "-c timezone=Asia/Manila"');
    }
    if (failed.some((f) => f.id.includes('pg_date') || f.id.includes('delinquency'))) {
      console.log('- Use Manila YMD helpers for billing jobs (not formatYmdLocal on raw pg Date objects).');
    }
  }
  console.log('');
}

async function main() {
  const client = await getClient();
  try {
    const node = collectNodeTimezone();
    const pg = await collectPostgresTimezone(client);
    const pgDateSim = simulatePgDateRead(sampleDueYmd);

    const dbTodayManila = String(pg.today_manila_ymd || '');
    const dbTodaySession = String(pg.current_date_session_ymd || '');

    const delinq = simulateDelinquencyDates({
      dueYmd: sampleDueYmd,
      graceDays: 0,
      pg: {
        due_date_js: new Date(`${sampleDueYmd}T00:00:00.000Z`),
      },
      db: {
        today_manila: dbTodayManila,
        today_session: dbTodaySession,
      },
    });

    const checks = buildChecks(node, pg, pgDateSim, delinq);
    const payload = {
      expected: { timezone: EXPECTED_TZ, utc_offset: 'UTC+8' },
      node,
      postgres: pg,
      pg_date_simulation: pgDateSim,
      delinquency_simulation: delinq,
      checks,
      all_passed: checks.every((c) => c.ok),
    };

    printReport(payload);
    process.exitCode = payload.all_passed ? 0 : 1;
  } catch (err) {
    console.error('Timezone audit failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main();
