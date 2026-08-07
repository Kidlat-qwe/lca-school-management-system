/**
 * Find students with doubled enrollment statuses on the same class track:
 *   - 2+ "rejoin" rows (should be only the first phase after a drop)
 *   - 2+ "new" rows (should be only the first enrolled phase on the class)
 *
 * Read-only. Prints a plain-text list (default) or JSON.
 *
 * Usage (from backend/):
 *   node scripts/auditDoubledRejoinOrNewStatus.js
 *   node scripts/auditDoubledRejoinOrNewStatus.js --branch-id=6
 *   node scripts/auditDoubledRejoinOrNewStatus.js --class-id=67
 *   node scripts/auditDoubledRejoinOrNewStatus.js --status=rejoin
 *   node scripts/auditDoubledRejoinOrNewStatus.js --status=new
 *   node scripts/auditDoubledRejoinOrNewStatus.js --include-removed
 *   node scripts/auditDoubledRejoinOrNewStatus.js --json
 */

import '../config/loadEnv.js';
import { query } from '../config/database.js';

const argValue = (name) => {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
};

const hasFlag = (name) =>
  process.argv.includes(`--${name}`) || process.argv.includes(`-${name}`);

const branchId = argValue('branch-id') ? parseInt(argValue('branch-id'), 10) : null;
const classId = argValue('class-id') ? parseInt(argValue('class-id'), 10) : null;
const statusFilter = String(argValue('status') || 'both')
  .trim()
  .toLowerCase();
const includeRemoved = hasFlag('include-removed');
const jsonOut = hasFlag('json');
const help = hasFlag('help') || hasFlag('h');

if (help) {
  console.log(`
Find students with doubled rejoin or new status on the same class.

Options:
  --branch-id=N       Optional branch filter
  --class-id=N        Optional class filter
  --status=rejoin|new|both   Which doubled status to find (default: both)
  --include-removed   Count removed enrollments too (default: active only)
  --json              Machine-readable output
  --help, -h          Show this help

Examples:
  node scripts/auditDoubledRejoinOrNewStatus.js
  node scripts/auditDoubledRejoinOrNewStatus.js --branch-id=6
  node scripts/auditDoubledRejoinOrNewStatus.js --status=rejoin
`);
  process.exit(0);
}

const statusesToCheck =
  statusFilter === 'rejoin'
    ? ['rejoin']
    : statusFilter === 'new'
      ? ['new']
      : statusFilter === 'both'
        ? ['rejoin', 'new']
        : null;

if (!statusesToCheck) {
  console.error(`Invalid --status=${statusFilter}. Use rejoin, new, or both.`);
  process.exit(1);
}

const main = async () => {
  const params = [];
  const filters = [];

  if (branchId != null && Number.isFinite(branchId)) {
    params.push(branchId);
    filters.push(`c.branch_id = $${params.length}`);
  }
  if (classId != null && Number.isFinite(classId)) {
    params.push(classId);
    filters.push(`cs.class_id = $${params.length}`);
  }
  if (!includeRemoved) {
    filters.push('cs.removed_at IS NULL');
  }

  params.push(statusesToCheck);
  const statusParam = `$${params.length}::text[]`;

  const whereExtra = filters.length ? `AND ${filters.join('\n         AND ')}` : '';

  const sql = `
    WITH ranked AS (
      SELECT
        cs.student_id,
        u.full_name AS student_name,
        u.email,
        cs.class_id,
        c.class_name,
        c.branch_id,
        b.branch_name,
        cs.program_enrollment_status AS status,
        cs.phase_number,
        cs.classstudent_id,
        TO_CHAR(TIMEZONE('Asia/Manila', cs.enrolled_at), 'YYYY-MM-DD') AS enrolled,
        TO_CHAR(TIMEZONE('Asia/Manila', cs.removed_at), 'YYYY-MM-DD') AS removed,
        COUNT(*) OVER (
          PARTITION BY cs.student_id, cs.class_id, cs.program_enrollment_status
        ) AS status_count_on_class
      FROM classstudentstbl cs
      INNER JOIN userstbl u
        ON u.user_id = cs.student_id
       AND u.user_type = 'Student'
      INNER JOIN classestbl c ON c.class_id = cs.class_id
      LEFT JOIN branchestbl b ON b.branch_id = c.branch_id
      WHERE cs.program_enrollment_status = ANY(${statusParam})
        AND COALESCE(cs.enrolled_by, '') NOT ILIKE '%Rejoin gap marker%'
        AND COALESCE(cs.enrolled_by, '') NOT ILIKE '%awaiting Phase 1 payment%'
        ${whereExtra}
    )
    SELECT *
    FROM ranked
    WHERE status_count_on_class >= 2
    ORDER BY status, branch_name NULLS LAST, class_name, student_name, phase_number, classstudent_id
  `;

  const { rows } = await query(sql, params);

  /** @type {Map<string, object>} */
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.student_id}:${row.class_id}:${row.status}`;
    if (!groups.has(key)) {
      groups.set(key, {
        student_id: row.student_id,
        student_name: row.student_name,
        email: row.email,
        class_id: row.class_id,
        class_name: row.class_name,
        branch_id: row.branch_id,
        branch_name: row.branch_name,
        status: row.status,
        count: Number(row.status_count_on_class) || 0,
        phases: [],
      });
    }
    groups.get(key).phases.push({
      phase_number: row.phase_number,
      classstudent_id: row.classstudent_id,
      enrolled: row.enrolled,
      removed: row.removed,
    });
  }

  const findings = [...groups.values()];
  const rejoinFindings = findings.filter((f) => f.status === 'rejoin');
  const newFindings = findings.filter((f) => f.status === 'new');

  if (jsonOut) {
    console.log(
      JSON.stringify(
        {
          scope: {
            branch_id: branchId,
            class_id: classId,
            status: statusFilter,
            include_removed: includeRemoved,
          },
          summary: {
            doubled_rejoin_tracks: rejoinFindings.length,
            doubled_new_tracks: newFindings.length,
            total_tracks: findings.length,
          },
          findings,
        },
        null,
        2
      )
    );
    process.exit(0);
  }

  const lines = [];
  lines.push('Doubled rejoin / new enrollment audit');
  lines.push('='.repeat(72));
  lines.push(
    `Scope: status=${statusFilter}` +
      (branchId != null ? ` | branch_id=${branchId}` : '') +
      (classId != null ? ` | class_id=${classId}` : '') +
      ` | rows=${includeRemoved ? 'including removed' : 'active only (removed_at IS NULL)'}`
  );
  lines.push(
    `Summary: doubled rejoin tracks=${rejoinFindings.length} | doubled new tracks=${newFindings.length} | total=${findings.length}`
  );
  lines.push('');

  const printSection = (title, sectionFindings) => {
    lines.push(title);
    lines.push('-'.repeat(72));
    if (sectionFindings.length === 0) {
      lines.push('(none)');
      lines.push('');
      return;
    }

    let n = 0;
    for (const f of sectionFindings) {
      n += 1;
      const phaseList = f.phases
        .map((p) => {
          const rem = p.removed ? ` removed=${p.removed}` : '';
          return `P${p.phase_number}(cs=${p.classstudent_id}, enrolled=${p.enrolled || '—'}${rem})`;
        })
        .join(', ');
      lines.push(
        `${n}. ${f.student_name} (id=${f.student_id}, ${f.email || 'no-email'})`
      );
      lines.push(
        `   class=${f.class_name} (id=${f.class_id}) | branch=${f.branch_name || '—'} (id=${f.branch_id ?? '—'})`
      );
      lines.push(`   doubled status=${f.status} count=${f.count} | ${phaseList}`);
      lines.push('');
    }
  };

  if (statusesToCheck.includes('rejoin')) {
    printSection('DOUBLED REJOIN (same student + class, 2+ rejoin rows)', rejoinFindings);
  }
  if (statusesToCheck.includes('new')) {
    printSection('DOUBLED NEW (same student + class, 2+ new rows)', newFindings);
  }

  console.log(lines.join('\n'));
  process.exit(0);
};

main().catch((err) => {
  console.error('Audit failed:', err.message || err);
  process.exit(1);
});
