/**
 * Kirsten Celesse J. Mahinay (cherryjaodmd@gmail.com) — correct Phase 3 & 4
 * installment invoice issue_date and due_date only.
 *
 * Does NOT modify Phase 1 or Phase 2 (or downpayment).
 *
 * Target dates:
 *   Phase 3 — issue 2026-04-25, due 2026-05-05
 *   Phase 4 — issue 2026-05-25, due 2026-06-05
 *
 * Run (preview):
 *   node backend/scripts/repairKirstenMahinayPhase34IssueDueDates.js --dry-run
 *
 * Apply:
 *   node backend/scripts/repairKirstenMahinayPhase34IssueDueDates.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';

const STUDENT_EMAIL = 'cherryjaodmd@gmail.com';

/** Profile-local phase slot → { issue_date, due_date } */
const PHASE_DATE_TARGETS = {
  3: { issue_date: '2026-04-25', due_date: '2026-05-05' },
  4: { issue_date: '2026-05-25', due_date: '2026-06-05' },
};

const isDryRun = !process.argv.includes('--apply');

const ymd = (value) => (value == null ? '' : String(value).slice(0, 10));

function resolvePhaseSlot(invoice, sequentialIndex) {
  const fromRemarks = parseTargetPhase(invoice.remarks);
  if (fromRemarks != null && Number.isFinite(fromRemarks)) {
    return fromRemarks;
  }
  return sequentialIndex;
}

async function loadStudentAndProfile(client) {
  const userRes = await client.query(
    `SELECT user_id, full_name, email, branch_id
     FROM userstbl
     WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))`,
    [STUDENT_EMAIL]
  );
  if (userRes.rows.length === 0) {
    throw new Error(`Student not found for email ${STUDENT_EMAIL}`);
  }
  const student = userRes.rows[0];

  const profileRes = await client.query(
    `SELECT ip.installmentinvoiceprofiles_id, ip.class_id, ip.downpayment_invoice_id,
            pkg.package_name, c.class_name
     FROM installmentinvoiceprofilestbl ip
     LEFT JOIN packagestbl pkg ON pkg.package_id = ip.package_id
     LEFT JOIN classestbl c ON c.class_id = ip.class_id
     WHERE ip.student_id = $1 AND ip.is_active = true
     ORDER BY ip.installmentinvoiceprofiles_id DESC
     LIMIT 1`,
    [student.user_id]
  );
  if (profileRes.rows.length === 0) {
    throw new Error(`No active installment profile for user_id ${student.user_id}`);
  }

  return { student, profile: profileRes.rows[0] };
}

async function loadInstallmentInvoices(client, profileId, downpaymentInvoiceId) {
  const res = await client.query(
    `SELECT invoice_id, status, issue_date::text AS issue_date, due_date::text AS due_date,
            remarks, invoice_ar_number
     FROM invoicestbl
     WHERE installmentinvoiceprofiles_id = $1
       AND invoice_id IS DISTINCT FROM $2
     ORDER BY invoice_id ASC`,
    [profileId, downpaymentInvoiceId ?? -1]
  );
  return res.rows;
}

async function main() {
  console.log(
    `\nRepair Kirsten Mahinay Phase 3/4 issue & due dates${isDryRun ? ' (DRY RUN)' : ' (APPLY)'}\n`
  );

  const client = await getClient();
  try {
    const { student, profile } = await loadStudentAndProfile(client);
    console.log('Student:', {
      user_id: student.user_id,
      full_name: student.full_name,
      email: student.email,
    });
    console.log('Profile:', profile);

    const invoices = await loadInstallmentInvoices(
      client,
      profile.installmentinvoiceprofiles_id,
      profile.downpayment_invoice_id
    );

    const phaseMap = new Map();
    invoices.forEach((inv, idx) => {
      const slot = resolvePhaseSlot(inv, idx + 1);
      if (phaseMap.has(slot)) {
        console.warn(
          `Warning: multiple invoices map to phase slot ${slot} (keeping first: invoice ${phaseMap.get(slot).invoice_id})`
        );
        return;
      }
      phaseMap.set(slot, inv);
    });

    console.log('\nCurrent installment phase invoices (excluding downpayment):');
    console.table(
      [...phaseMap.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([slot, inv]) => ({
          phase_slot: slot,
          invoice_id: inv.invoice_id,
          status: inv.status,
          issue_date: ymd(inv.issue_date),
          due_date: ymd(inv.due_date),
          ar: inv.invoice_ar_number,
        }))
    );

    const updates = [];
    for (const [phaseSlot, target] of Object.entries(PHASE_DATE_TARGETS)) {
      const slot = Number(phaseSlot);
      const inv = phaseMap.get(slot);
      if (!inv) {
        throw new Error(`Phase ${slot} invoice not found on profile ${profile.installmentinvoiceprofiles_id}`);
      }
      const nextIssue = target.issue_date;
      const nextDue = target.due_date;
      const curIssue = ymd(inv.issue_date);
      const curDue = ymd(inv.due_date);
      if (curIssue === nextIssue && curDue === nextDue) {
        console.log(`Phase ${slot} (invoice ${inv.invoice_id}): already correct (${curIssue} / ${curDue})`);
        continue;
      }
      updates.push({
        phase_slot: slot,
        invoice_id: inv.invoice_id,
        status: inv.status,
        from_issue: curIssue,
        from_due: curDue,
        to_issue: nextIssue,
        to_due: nextDue,
      });
    }

    if (updates.length === 0) {
      console.log('\nNo invoice date changes needed.');
      return;
    }

    console.log('\nPlanned invoicestbl updates (dates only):');
    console.table(updates);

    if (isDryRun) {
      console.log('\nDry run complete. Re-run with --apply to write changes.');
      return;
    }

    await client.query('BEGIN');
    for (const row of updates) {
      await client.query(
        `UPDATE invoicestbl
         SET issue_date = $1::date,
             due_date = $2::date
         WHERE invoice_id = $3`,
        [row.to_issue, row.to_due, row.invoice_id]
      );
      console.log(
        `Updated invoice ${row.invoice_id} (phase ${row.phase_slot}): issue ${row.from_issue} → ${row.to_issue}, due ${row.from_due} → ${row.to_due}`
      );
    }
    await client.query('COMMIT');
    console.log('\nDone. Phase 1 and Phase 2 were not modified.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
