/**
 * Repair phase installment invoices where issue_date goes backwards by phase number
 * (e.g. Phase 2 issue_date earlier than Phase 1) — typically from the Downpayment + Phase 1
 * AR path before acknowledgementreceipts.js aligned Phase 2 using max(AR date, Phase 1 issue_date).
 *
 * Scope: rows in invoicestbl with installmentinvoiceprofiles_id and remarks containing TARGET_PHASE:N.
 * Rule: after sorting by N ascending within each profile, each invoice's issue_date must be >= the
 * maximum issue_date among earlier phases. When fixing, new issue_date = that floor, unless it would
 * exceed due_date (then the row is skipped with a warning).
 *
 * Usage (from backend directory):
 *   node scripts/repairPhaseInstallmentIssueDateMonotonic.js           # dry-run (default)
 *   node scripts/repairPhaseInstallmentIssueDateMonotonic.js --apply # write changes
 *   npm run repair:phase-installment-issue-dates -- --apply
 *
 * Single invoice (same profile still loaded for correct phase order):
 *   node scripts/repairPhaseInstallmentIssueDateMonotonic.js --invoice-id=863
 *   node scripts/repairPhaseInstallmentIssueDateMonotonic.js --invoice-id=863 --apply
 *
 * If issue floor would be after due_date (CONFLICT), you may extend due to the floor (review with Finance):
 *   node scripts/repairPhaseInstallmentIssueDateMonotonic.js --invoice-id=863 --extend-due-when-needed --apply
 *
 * Set exact issue/due for one invoice (e.g. Phase 2 next cycle: issue 25th, due 5th next month):
 *   node scripts/repairPhaseInstallmentIssueDateMonotonic.js --invoice-id=863 --issue-date=2026-06-25 --due-date=2026-07-05 --apply
 */

import '../config/loadEnv.js';
import { query, getClient } from '../config/database.js';

const parseTargetPhase = (remarks) => {
  const m = String(remarks || '').match(/TARGET_PHASE:(\d+)/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isInteger(n) ? n : null;
};

const sliceYmd = (v) => {
  if (v == null) return null;
  const s = String(v).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

/** @returns {number | null} */
const parseSingleInvoiceIdFilter = () => {
  const eqArg = process.argv.find((a) => a.startsWith('--invoice-id='));
  if (eqArg) {
    const raw = eqArg.slice('--invoice-id='.length).trim();
    const n = parseInt(raw, 10);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  const idx = process.argv.indexOf('--invoice-id');
  if (idx >= 0) {
    const raw = process.argv[idx + 1];
    if (raw && !raw.startsWith('-')) {
      const n = parseInt(String(raw).trim(), 10);
      return Number.isInteger(n) && n > 0 ? n : null;
    }
  }
  return null;
};

/** @param {string} prefix e.g. '--issue-date=' */
const parseYmdEqualsArg = (prefix) => {
  const eqArg = process.argv.find((a) => a.startsWith(prefix));
  if (!eqArg) return null;
  const raw = eqArg.slice(prefix.length).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
};

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
repairPhaseInstallmentIssueDateMonotonic.js

  Fixes issue_date ordering for phase installment invoices (TARGET_PHASE in remarks).

  Options:
    (default)   Preview changes only — no database writes
    --apply     Commit UPDATEs to invoicestbl
    --invoice-id=N   Only consider updates for invoice_id N (still loads N's installment profile for phase order)
    --extend-due-when-needed   With --invoice-id only: if issue fix would exceed due_date, set due_date to the
                    same day as the new issue_date (minimal extension). Use only after business sign-off.
    --issue-date=YYYY-MM-DD   With --due-date and --invoice-id: set both columns on that invoice (next-cycle fix).
    --due-date=YYYY-MM-DD     Must be used together with --issue-date.
    --help, -h  This message

  Example:
    node scripts/repairPhaseInstallmentIssueDateMonotonic.js --apply
    node scripts/repairPhaseInstallmentIssueDateMonotonic.js --invoice-id=863 --apply
    node scripts/repairPhaseInstallmentIssueDateMonotonic.js --invoice-id=863 --extend-due-when-needed --apply
    node scripts/repairPhaseInstallmentIssueDateMonotonic.js --invoice-id=863 --issue-date=2026-06-25 --due-date=2026-07-05 --apply
`);
    process.exit(0);
  }

  const apply = process.argv.includes('--apply');
  const dryRun = !apply;
  const onlyInvoiceId = parseSingleInvoiceIdFilter();
  const extendDueWhenNeeded = process.argv.includes('--extend-due-when-needed');
  const issueExplicitYmd = parseYmdEqualsArg('--issue-date=');
  const dueExplicitYmd = parseYmdEqualsArg('--due-date=');
  const hasIssueExplicit = issueExplicitYmd != null;
  const hasDueExplicit = dueExplicitYmd != null;

  if (hasIssueExplicit !== hasDueExplicit) {
    console.error('Use both --issue-date=YYYY-MM-DD and --due-date=YYYY-MM-DD together, or neither.');
    process.exit(1);
  }
  if (hasIssueExplicit && onlyInvoiceId == null) {
    console.error('--issue-date / --due-date require --invoice-id=N.');
    process.exit(1);
  }
  if (hasIssueExplicit && extendDueWhenNeeded) {
    console.error('Do not combine --extend-due-when-needed with --issue-date / --due-date.');
    process.exit(1);
  }

  if (extendDueWhenNeeded && onlyInvoiceId == null) {
    console.error('Error: --extend-due-when-needed may only be used with --invoice-id=N.');
    process.exit(1);
  }

  console.log(
    `\nrepairPhaseInstallmentIssueDateMonotonic — ${dryRun ? 'DRY RUN (no writes; pass --apply to commit)' : 'APPLYING UPDATES'}${
      onlyInvoiceId != null ? ` — scoped to invoice_id ${onlyInvoiceId}` : ''
    }${extendDueWhenNeeded ? ' — extend due when needed' : ''}${
      hasIssueExplicit ? ` — explicit issue ${issueExplicitYmd} / due ${dueExplicitYmd}` : ''
    }\n`
  );

  if (hasIssueExplicit) {
    if (issueExplicitYmd > dueExplicitYmd) {
      console.error(
        `issue_date (${issueExplicitYmd}) must be on or before due_date (${dueExplicitYmd}) for the same invoice.`
      );
      process.exit(1);
    }

    const cur = await query(
      `SELECT invoice_id,
              issue_date::text AS issue_date,
              due_date::text AS due_date,
              invoice_description
       FROM invoicestbl
       WHERE invoice_id = $1`,
      [onlyInvoiceId]
    );
    if (cur.rows.length === 0) {
      console.error(`No invoice with invoice_id=${onlyInvoiceId}.`);
      process.exit(1);
    }
    const row = cur.rows[0];
    const fromI = sliceYmd(row.issue_date);
    const fromD = sliceYmd(row.due_date);
    if (fromI === issueExplicitYmd && fromD === dueExplicitYmd) {
      console.log(`Invoice ${onlyInvoiceId} already has issue_date=${issueExplicitYmd}, due_date=${dueExplicitYmd}. Nothing to do.`);
      process.exit(0);
    }
    console.log(
      `  Invoice ${onlyInvoiceId} (${row.invoice_description || 'n/a'}): issue_date ${fromI ?? row.issue_date} → ${issueExplicitYmd}, due_date ${fromD ?? row.due_date} → ${dueExplicitYmd}`
    );
    if (dryRun) {
      console.log('\nDry run: re-run with --apply to write.');
      process.exit(0);
    }
    const client = await getClient();
    try {
      await client.query(
        `UPDATE invoicestbl SET issue_date = $1::date, due_date = $2::date WHERE invoice_id = $3`,
        [issueExplicitYmd, dueExplicitYmd, onlyInvoiceId]
      );
      console.log('\nCommitted: 1 invoice updated (explicit issue/due).');
    } catch (e) {
      console.error('Failed:', e);
      process.exit(1);
    } finally {
      client.release();
    }
    process.exit(0);
  }

  let res;
  if (onlyInvoiceId != null) {
    res = await query(
      `SELECT i.invoice_id,
              i.installmentinvoiceprofiles_id,
              i.issue_date::text AS issue_date,
              i.due_date::text AS due_date,
              i.remarks,
              i.status
       FROM invoicestbl i
       WHERE i.installmentinvoiceprofiles_id IS NOT NULL
         AND i.remarks ILIKE '%TARGET_PHASE:%'
         AND i.installmentinvoiceprofiles_id = (
           SELECT installmentinvoiceprofiles_id FROM invoicestbl WHERE invoice_id = $1
         )`,
      [onlyInvoiceId]
    );
    if (res.rows.length === 0) {
      const exists = await query(`SELECT invoice_id FROM invoicestbl WHERE invoice_id = $1`, [onlyInvoiceId]);
      if (exists.rows.length === 0) {
        console.error(`No invoice with invoice_id=${onlyInvoiceId}.`);
      } else {
        console.error(
          `Invoice ${onlyInvoiceId} has no installment profile or no TARGET_PHASE remarks — nothing to repair with this script.`
        );
      }
      process.exit(1);
    }
  } else {
    res = await query(
      `SELECT i.invoice_id,
              i.installmentinvoiceprofiles_id,
              i.issue_date::text AS issue_date,
              i.due_date::text AS due_date,
              i.remarks,
              i.status
       FROM invoicestbl i
       WHERE i.installmentinvoiceprofiles_id IS NOT NULL
         AND i.remarks ILIKE '%TARGET_PHASE:%'`
    );
  }

  /** @type {Map<number, Array<Record<string, unknown> & { phase: number }>>} */
  const byProfile = new Map();
  for (const row of res.rows) {
    const phase = parseTargetPhase(row.remarks);
    if (phase == null) continue;
    const id = Number(row.installmentinvoiceprofiles_id);
    if (!Number.isInteger(id)) continue;
    if (!byProfile.has(id)) byProfile.set(id, []);
    byProfile.get(id).push({ ...row, phase });
  }

  let skippedConflict = 0;
  /** @type {Array<{ invoice_id: number, from: string, to: string, profile_id: number, phase: number, extendDue?: boolean, fromDue?: string, toDue?: string }>} */
  const rawUpdates = [];

  for (const [profileId, rows] of byProfile.entries()) {
    rows.sort((a, b) => a.phase - b.phase || Number(a.invoice_id) - Number(b.invoice_id));

    let runningMaxIssueYmd = null;

    for (const row of rows) {
      const issueYmd = sliceYmd(row.issue_date);
      const dueYmd = sliceYmd(row.due_date);

      if (!issueYmd) {
        console.warn(`  Skip invoice ${row.invoice_id} (profile ${profileId}): invalid issue_date`);
        continue;
      }

      if (runningMaxIssueYmd === null) {
        runningMaxIssueYmd = issueYmd;
        continue;
      }

      if (issueYmd >= runningMaxIssueYmd) {
        runningMaxIssueYmd = issueYmd > runningMaxIssueYmd ? issueYmd : runningMaxIssueYmd;
        continue;
      }

      const candidate = runningMaxIssueYmd;
      if (dueYmd && candidate > dueYmd) {
        const canExtendDue =
          extendDueWhenNeeded &&
          onlyInvoiceId != null &&
          Number(row.invoice_id) === onlyInvoiceId;
        if (canExtendDue) {
          const newDueYmd = candidate;
          rawUpdates.push({
            invoice_id: row.invoice_id,
            from: issueYmd,
            to: candidate,
            profile_id: profileId,
            phase: row.phase,
            extendDue: true,
            fromDue: dueYmd,
            toDue: newDueYmd,
          });
          runningMaxIssueYmd = candidate;
          console.log(
            `  CONFLICT → repair with extended due: invoice ${row.invoice_id} (profile ${profileId}, Phase ${row.phase}): issue_date ${issueYmd} → ${candidate}, due_date ${dueYmd} → ${newDueYmd}`
          );
          continue;
        }
        console.warn(
          `  CONFLICT skip invoice ${row.invoice_id} (profile ${profileId}, Phase ${row.phase}): need issue >= ${candidate} but due_date is ${dueYmd}`
        );
        skippedConflict += 1;
        continue;
      }

      rawUpdates.push({
        invoice_id: row.invoice_id,
        from: issueYmd,
        to: candidate,
        profile_id: profileId,
        phase: row.phase,
      });
      runningMaxIssueYmd = candidate;
    }
  }

  let updates = rawUpdates;
  if (onlyInvoiceId != null) {
    const scoped = rawUpdates.filter((u) => Number(u.invoice_id) === onlyInvoiceId);
    const dropped = rawUpdates.length - scoped.length;
    if (dropped > 0) {
      console.log(
        `\n(Scoped to invoice_id ${onlyInvoiceId}: ${dropped} other repair candidate(s) on the same profile were not applied.)`
      );
    }
    updates = scoped;
  }

  for (const u of updates) {
    if (u.extendDue && u.fromDue != null && u.toDue != null) {
      console.log(
        `  Invoice ${u.invoice_id} (profile ${u.profile_id}, Phase ${u.phase}): issue_date ${u.from} → ${u.to}, due_date ${u.fromDue} → ${u.toDue}`
      );
    } else {
      console.log(
        `  Invoice ${u.invoice_id} (profile ${u.profile_id}, Phase ${u.phase}): issue_date ${u.from} → ${u.to}`
      );
    }
  }

  if (updates.length === 0) {
    console.log('\nNo rows need issue_date repair.');
    process.exit(0);
  }

  if (dryRun) {
    console.log(`\nDry run: ${updates.length} invoice(s) would be updated. Re-run with --apply to write.`);
    process.exit(0);
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    for (const u of updates) {
      if (u.extendDue && u.toDue != null) {
        await client.query(
          `UPDATE invoicestbl SET issue_date = $1::date, due_date = $2::date WHERE invoice_id = $3`,
          [u.to, u.toDue, u.invoice_id]
        );
      } else {
        await client.query(`UPDATE invoicestbl SET issue_date = $1::date WHERE invoice_id = $2`, [
          u.to,
          u.invoice_id,
        ]);
      }
    }
    await client.query('COMMIT');
    console.log(`\nCommitted: ${updates.length} invoice(s) updated.`);
    if (skippedConflict > 0) {
      console.log(`Skipped (due_date conflict): ${skippedConflict}`);
    }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Failed:', e);
    process.exit(1);
  } finally {
    client.release();
  }
}

main();
