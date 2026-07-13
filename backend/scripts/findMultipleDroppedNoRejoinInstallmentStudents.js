/**
 * Find installment students with multiple dropped phases who never continued
 * (no rejoin / active enrollment after the latest drop).
 *
 * Match pattern (e.g. Maverick Playgroup): several delinquency drops on a
 * class track, then plan stops — no `rejoin` and no later active phase row.
 *
 * Usage:
 *   node backend/scripts/findMultipleDroppedNoRejoinInstallmentStudents.js
 *   node backend/scripts/findMultipleDroppedNoRejoinInstallmentStudents.js --min-drops=2
 *   node backend/scripts/findMultipleDroppedNoRejoinInstallmentStudents.js --branch-id=5
 *   node backend/scripts/findMultipleDroppedNoRejoinInstallmentStudents.js --csv
 *   node backend/scripts/findMultipleDroppedNoRejoinInstallmentStudents.js --json
 */

import '../config/loadEnv.js';
import { writeFileSync } from 'fs';
import { query } from '../config/database.js';

function parseArgs() {
  const argv = process.argv.slice(2);
  let minDrops = 2;
  let branchId = null;
  let asJson = false;
  let csvPath = null;
  let includeContinued = false;

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') asJson = true;
    else if (a === '--include-continued') includeContinued = true;
    else if (a.startsWith('--min-drops=')) {
      minDrops = Math.max(2, parseInt(a.split('=')[1], 10) || 2);
    } else if (a === '--min-drops') {
      minDrops = Math.max(2, parseInt(argv[++i], 10) || 2);
    } else if (a.startsWith('--branch-id=')) {
      branchId = parseInt(a.split('=')[1], 10);
    } else if (a === '--branch-id') {
      branchId = parseInt(argv[++i], 10);
    } else if (a === '--csv') {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        csvPath = next;
        i += 1;
      } else {
        csvPath = `multiple-dropped-no-rejoin-${Date.now()}.csv`;
      }
    } else if (a === '--help' || a === '-h') {
      console.log(`
Find installment tracks with multiple dropped phases and no rejoin / continue.

  --min-drops=N          Minimum dropped phase rows (default 2)
  --branch-id=N          Limit to branch
  --include-continued    Also list tracks that DID rejoin/continue (for contrast)
  --csv [path]           Write CSV (default timestamped path)
  --json                 JSON output
`);
      process.exit(0);
    }
  }

  if (branchId != null && !Number.isFinite(branchId)) {
    throw new Error('Invalid --branch-id');
  }

  return { minDrops, branchId, asJson, csvPath, includeContinued };
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function main() {
  const { minDrops, branchId, asJson, csvPath, includeContinued } = parseArgs();

  console.log(
    `\nMultiple-dropped installment tracks (min drops=${minDrops}` +
      `${branchId != null ? `, branch=${branchId}` : ''}` +
      `${includeContinued ? ', including continued' : ', no-rejoin only'})\n`
  );

  const params = [minDrops];
  let branchFilter = '';
  if (branchId != null) {
    params.push(branchId);
    branchFilter = `AND c.branch_id = $${params.length}`;
  }

  const result = await query(
    `
    WITH installment_tracks AS (
      SELECT DISTINCT
        ip.student_id,
        ip.class_id,
        MAX(ip.installmentinvoiceprofiles_id) AS profile_id
      FROM installmentinvoiceprofilestbl ip
      WHERE ip.class_id IS NOT NULL
      GROUP BY ip.student_id, ip.class_id
    ),
    dropped AS (
      SELECT
        cs.student_id,
        cs.class_id,
        COUNT(*)::int AS dropped_count,
        COUNT(DISTINCT COALESCE(cs.phase_number, 1))::int AS dropped_phase_count,
        MIN(COALESCE(cs.phase_number, 1)) AS first_dropped_phase,
        MAX(COALESCE(cs.phase_number, 1)) AS last_dropped_phase,
        MIN(cs.removed_at) AS first_removed_at,
        MAX(cs.removed_at) AS last_removed_at,
        STRING_AGG(
          COALESCE(cs.phase_number, 1)::text,
          ',' ORDER BY COALESCE(cs.phase_number, 1), cs.classstudent_id
        ) AS dropped_phases,
        BOOL_OR(cs.removed_reason ILIKE '%Installment delinquency%') AS has_delinquency_drop
      FROM classstudentstbl cs
      INNER JOIN installment_tracks it
        ON it.student_id = cs.student_id AND it.class_id = cs.class_id
      WHERE cs.program_enrollment_status = 'dropped'
      GROUP BY cs.student_id, cs.class_id
      HAVING COUNT(*) >= $1
    ),
    continued AS (
      SELECT
        d.student_id,
        d.class_id,
        BOOL_OR(
          cs.program_enrollment_status = 'rejoin'
          AND (
            d.last_removed_at IS NULL
            OR cs.enrolled_at > d.last_removed_at
            OR (cs.removed_at IS NULL AND cs.enrolled_at IS NOT NULL)
          )
        ) AS has_rejoin_after_drop,
        BOOL_OR(
          cs.program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin')
          AND cs.removed_at IS NULL
          AND (
            d.last_removed_at IS NULL
            OR cs.enrolled_at > d.last_removed_at
          )
          AND COALESCE(cs.phase_number, 1) > d.last_dropped_phase
        ) AS has_active_after_drop,
        MAX(
          CASE
            WHEN cs.program_enrollment_status = 'rejoin' THEN COALESCE(cs.phase_number, 1)
            ELSE NULL
          END
        ) AS rejoin_phase,
        MAX(
          CASE
            WHEN cs.program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin')
              AND cs.removed_at IS NULL
              AND COALESCE(cs.phase_number, 1) > d.last_dropped_phase
            THEN COALESCE(cs.phase_number, 1)
            ELSE NULL
          END
        ) AS later_active_phase
      FROM dropped d
      LEFT JOIN classstudentstbl cs
        ON cs.student_id = d.student_id
       AND cs.class_id = d.class_id
      GROUP BY d.student_id, d.class_id
    ),
    profile_info AS (
      SELECT DISTINCT ON (ip.student_id, ip.class_id)
        ip.student_id,
        ip.class_id,
        ip.installmentinvoiceprofiles_id AS profile_id,
        ip.phase_start,
        ip.total_phases,
        ip.generated_count,
        ip.is_active,
        ip.amount
      FROM installmentinvoiceprofilestbl ip
      INNER JOIN dropped d
        ON d.student_id = ip.student_id AND d.class_id = ip.class_id
      ORDER BY ip.student_id, ip.class_id, ip.installmentinvoiceprofiles_id DESC
    ),
    invoice_stats AS (
      SELECT
        ip.student_id,
        ip.class_id,
        COUNT(*) FILTER (
          WHERE i.status NOT IN ('Paid', 'Cancelled', 'Canceled')
            AND COALESCE(i.invoice_description, '') NOT ILIKE '%downpayment%'
        )::int AS open_phase_invoices,
        COUNT(*) FILTER (
          WHERE i.status = 'Paid'
            AND COALESCE(i.invoice_description, '') NOT ILIKE '%downpayment%'
        )::int AS paid_phase_invoices,
        MAX(i.invoice_id) FILTER (
          WHERE COALESCE(i.invoice_description, '') NOT ILIKE '%downpayment%'
        ) AS latest_invoice_id
      FROM installmentinvoiceprofilestbl ip
      INNER JOIN dropped d
        ON d.student_id = ip.student_id AND d.class_id = ip.class_id
      INNER JOIN invoicestbl i
        ON i.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
      GROUP BY ip.student_id, ip.class_id
    )
    SELECT
      u.user_id AS student_id,
      u.full_name,
      u.email,
      u.branch_id,
      b.branch_name,
      c.class_id,
      c.class_name,
      c.level_tag,
      c.status AS class_status,
      p.profile_id,
      p.phase_start,
      p.total_phases,
      p.generated_count,
      p.is_active AS profile_is_active,
      p.amount AS phase_amount,
      d.dropped_count,
      d.dropped_phase_count,
      d.first_dropped_phase,
      d.last_dropped_phase,
      d.dropped_phases,
      d.has_delinquency_drop,
      TO_CHAR(TIMEZONE('Asia/Manila', d.first_removed_at), 'YYYY-MM-DD') AS first_removed_ymd,
      TO_CHAR(TIMEZONE('Asia/Manila', d.last_removed_at), 'YYYY-MM-DD') AS last_removed_ymd,
      COALESCE(cont.has_rejoin_after_drop, false) AS has_rejoin_after_drop,
      COALESCE(cont.has_active_after_drop, false) AS has_active_after_drop,
      cont.rejoin_phase,
      cont.later_active_phase,
      COALESCE(inv.open_phase_invoices, 0) AS open_phase_invoices,
      COALESCE(inv.paid_phase_invoices, 0) AS paid_phase_invoices,
      inv.latest_invoice_id,
      CASE
        WHEN COALESCE(cont.has_rejoin_after_drop, false)
          OR COALESCE(cont.has_active_after_drop, false)
        THEN true
        ELSE false
      END AS continued_after_drops
    FROM dropped d
    INNER JOIN userstbl u ON u.user_id = d.student_id AND u.user_type = 'Student'
    INNER JOIN classestbl c ON c.class_id = d.class_id
    LEFT JOIN branchestbl b ON b.branch_id = u.branch_id
    LEFT JOIN profile_info p ON p.student_id = d.student_id AND p.class_id = d.class_id
    LEFT JOIN continued cont ON cont.student_id = d.student_id AND cont.class_id = d.class_id
    LEFT JOIN invoice_stats inv ON inv.student_id = d.student_id AND inv.class_id = d.class_id
    WHERE 1=1
      ${branchFilter}
    ORDER BY u.full_name ASC, c.class_name ASC
    `,
    params
  );

  let rows = result.rows;
  if (!includeContinued) {
    rows = rows.filter((r) => !r.continued_after_drops);
  }

  console.log(`Found ${rows.length} track(s).\n`);

  if (!rows.length) {
    console.log('No matching students.');
    return;
  }

  if (asJson) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    console.table(
      rows.map((r) => ({
        student_id: r.student_id,
        name: r.full_name,
        email: r.email,
        branch: r.branch_name || r.branch_id,
        class: r.class_name,
        profile: r.profile_id,
        drops: r.dropped_phases,
        drop_count: r.dropped_count,
        last_drop: r.last_removed_ymd,
        gen: r.generated_count,
        active: r.profile_is_active,
        open_inv: r.open_phase_invoices,
        continued: r.continued_after_drops,
        rejoin_phase: r.rejoin_phase,
      }))
    );
  }

  if (csvPath) {
    const headers = [
      'student_id',
      'full_name',
      'email',
      'branch_id',
      'branch_name',
      'class_id',
      'class_name',
      'level_tag',
      'class_status',
      'profile_id',
      'phase_start',
      'total_phases',
      'generated_count',
      'profile_is_active',
      'phase_amount',
      'dropped_count',
      'dropped_phase_count',
      'first_dropped_phase',
      'last_dropped_phase',
      'dropped_phases',
      'has_delinquency_drop',
      'first_removed_ymd',
      'last_removed_ymd',
      'has_rejoin_after_drop',
      'has_active_after_drop',
      'rejoin_phase',
      'later_active_phase',
      'open_phase_invoices',
      'paid_phase_invoices',
      'latest_invoice_id',
      'continued_after_drops',
    ];
    const lines = [
      headers.join(','),
      ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(',')),
    ];
    writeFileSync(csvPath, lines.join('\n'), 'utf8');
    console.log(`\nCSV written: ${csvPath}`);
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
