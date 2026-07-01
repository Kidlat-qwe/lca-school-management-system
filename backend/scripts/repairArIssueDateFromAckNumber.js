/**
 * Audit / repair acknowledgement_receiptstbl.issue_date vs embedded date in legacy
 * ack_receipt_number: AR-YYYYMMDD-HHMMSS-<id>
 *
 * Run from repo root:
 *   node backend/scripts/repairArIssueDateFromAckNumber.js
 *   node backend/scripts/repairArIssueDateFromAckNumber.js --apply
 *   node backend/scripts/repairArIssueDateFromAckNumber.js --apply --apply-all
 *
 * --apply        UPDATE only rows with [Returned] or [Resubmitted] in notes (recommended).
 * --apply-all    UPDATE every legacy-format mismatch (use if notes were edited).
 */

import '../config/loadEnv.js';
import { query } from '../config/database.js';

const APPLY = process.argv.includes('--apply');
const APPLY_ALL = process.argv.includes('--apply-all');

/** Postgres date or JS Date → YYYY-MM-DD for logs */
function fmtYmd(v) {
  if (v == null) return '(null)';
  const s = typeof v === 'string' ? v : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  return s.slice(0, 10);
}

/** Same filters: legacy AR # shape + embedded date parses + differs from issue_date */
const LEGACY_MISMATCH_BASE = `
    ar.ack_receipt_number ~ '^AR-[0-9]{8}-[0-9]{6}-[0-9]+$'
    AND substring(ar.ack_receipt_number from '^AR-([0-9]{8})') IS NOT NULL
    AND ar.issue_date::date IS DISTINCT FROM to_date(substring(ar.ack_receipt_number from '^AR-([0-9]{8})'), 'YYYYMMDD')
`;

async function main() {
  const auditSql = `
    SELECT
      ar.ack_receipt_id,
      ar.ack_receipt_number,
      ar.issue_date::date AS issue_date,
      ar.status,
      ar.prospect_student_notes,
      to_date(substring(ar.ack_receipt_number from '^AR-([0-9]{8})'), 'YYYYMMDD') AS embedded_issue_date,
      (
        ar.prospect_student_notes LIKE '%[Returned]%'
        OR ar.prospect_student_notes LIKE '%[Resubmitted]%'
      ) AS eligible_safe_repair
    FROM acknowledgement_receiptstbl ar
    WHERE ${LEGACY_MISMATCH_BASE}
    ORDER BY ar.ack_receipt_id;
  `;

  const res = await query(auditSql);
  const rows = res.rows || [];

  console.log(
    '\n=== Audit: legacy AR # (AR-YYYYMMDD-HHMMSS-id) vs issue_date ===\n' +
      '(Rows listed only when embedded YYYYMMDD ≠ issue_date in DB.)\n'
  );

  if (rows.length === 0) {
    console.log('No mismatches found for this pattern.\n');
    process.exit(0);
    return;
  }

  const safe = rows.filter((r) => r.eligible_safe_repair);
  const other = rows.filter((r) => !r.eligible_safe_repair);

  console.log(`Total mismatches: ${rows.length}`);
  console.log(`  · Eligible for default --apply ([Returned] or [Resubmitted] in notes): ${safe.length}`);
  console.log(`  · Other mismatches (review manually or use --apply-all): ${other.length}\n`);

  for (const r of rows) {
    const tag = r.eligible_safe_repair ? '[safe]' : '[review]';
    console.log(
      `  ${tag} id=${r.ack_receipt_id}  ${r.ack_receipt_number}  status=${r.status ?? '-'}`
    );
    console.log(
      `       issue_date=${fmtYmd(r.issue_date)}  embedded=${fmtYmd(r.embedded_issue_date)}  → should use ${fmtYmd(r.embedded_issue_date)}`
    );
  }

  if (!APPLY) {
    console.log(
      '\nDry run. Re-run with --apply to fix rows marked [safe], or --apply --apply-all to fix every row above.\n'
    );
    process.exit(0);
    return;
  }

  if (!APPLY_ALL && safe.length === 0 && other.length > 0) {
    console.log(
      '\nNo rows qualify for default --apply (missing [Returned]/[Resubmitted] in notes). Use --apply --apply-all to repair those rows anyway.\n'
    );
    process.exit(1);
    return;
  }

  if (APPLY_ALL && other.length > 0) {
    console.log(
      `\n--apply-all: updating ALL ${rows.length} mismatch row(s), including ${other.length} without [Returned]/[Resubmitted] in notes.\n`
    );
  }

  const updateSql = APPLY_ALL
    ? `
    UPDATE acknowledgement_receiptstbl ar
    SET issue_date = to_date(substring(ar.ack_receipt_number from '^AR-([0-9]{8})'), 'YYYYMMDD')
    WHERE ${LEGACY_MISMATCH_BASE};
  `
    : `
    UPDATE acknowledgement_receiptstbl ar
    SET issue_date = to_date(substring(ar.ack_receipt_number from '^AR-([0-9]{8})'), 'YYYYMMDD')
    WHERE ${LEGACY_MISMATCH_BASE}
      AND (
        ar.prospect_student_notes LIKE '%[Returned]%'
        OR ar.prospect_student_notes LIKE '%[Resubmitted]%'
      );
  `;

  const upd = await query(updateSql);
  console.log(`Updated ${upd.rowCount ?? 0} row(s). issue_date now matches YYYYMMDD inside ack_receipt_number.\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
