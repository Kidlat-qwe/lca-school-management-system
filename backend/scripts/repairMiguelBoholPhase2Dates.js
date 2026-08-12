/**
 * Miguel Sebastian C. Bohol — fix Phase 2 issue/due dates (and Phase 1 so UI does not swap).
 *
 * Student: 78 · carlosgeline26@gmail.com
 * Profile: 54 · class 37 SOMO_Pre-Kinder_MWF_9:30-10:30AM
 *
 * DB today:
 *   INV-1850 TARGET_PHASE:1 (advance, Paid)  issue 2026-06-28 / due 2026-03-01
 *   INV-1927 TARGET_PHASE:2 (Unpaid)         issue 2026-04-25 / due 2026-05-05
 *
 * Student History swaps adjacent issue dates when Phase 1 issue > Phase 2 issue,
 * so Phase 2 currently DISPLAYS June 28 / March 1.
 *
 * Target:
 *   Phase 1 INV-1850  issue 2026-02-25 / due 2026-03-05  (keeps cadence before Phase 2)
 *   Phase 2 INV-1927  issue 2026-03-25 / due 2026-04-05  (requested)
 *
 * Does NOT change payments, penalty, enrollment (Phase 2 stays dropped), or profile.
 *
 * Run:
 *   node backend/scripts/repairMiguelBoholPhase2Dates.js --production
 *   node backend/scripts/repairMiguelBoholPhase2Dates.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';
import { normalizeAdjacentPhaseDisplayDates } from '../utils/installmentPhaseRowMapping.js';

const STUDENT_ID = 78;
const STUDENT_EMAIL = 'carlosgeline26@gmail.com';
const PROFILE_ID = 54;
const CLASS_ID = 37;

const PHASE1 = {
  invoiceId: 1850,
  phase: 1,
  currentIssue: '2026-06-28',
  currentDue: '2026-03-01',
  targetIssue: '2026-02-25',
  targetDue: '2026-03-05',
  expectedStatus: 'paid',
};

const PHASE2 = {
  invoiceId: 1927,
  phase: 2,
  currentIssue: '2026-04-25',
  currentDue: '2026-05-05',
  targetIssue: '2026-03-25',
  targetDue: '2026-04-05',
  expectedStatus: 'unpaid',
};

const REPAIR_NOTE =
  'Ops repair 2026-08-12 — Miguel Bohol Phase 2 issue/due Mar 25 / Apr 5 (Phase 1 Feb 25 / Mar 5 to unswap display)';

const isApply = process.argv.includes('--apply');

async function loadInvoice(client, invoiceId) {
  const r = await client.query(
    `SELECT invoice_id, status, amount, invoice_ar_number,
            installmentinvoiceprofiles_id AS profile_id,
            TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
            TO_CHAR(due_date, 'YYYY-MM-DD') AS due,
            remarks
     FROM invoicestbl WHERE invoice_id = $1`,
    [invoiceId]
  );
  const row = r.rows[0] || null;
  if (row) row.phase = parseTargetPhase(row.remarks);
  return row;
}

function assertDates(inv, cfg) {
  if (!inv) throw new Error(`INV-${cfg.invoiceId} not found`);
  if (Number(inv.profile_id) !== PROFILE_ID) {
    throw new Error(`INV-${cfg.invoiceId} profile ${inv.profile_id} ≠ ${PROFILE_ID}`);
  }
  if (inv.phase !== cfg.phase) {
    throw new Error(`INV-${cfg.invoiceId} TARGET_PHASE:${inv.phase}, expected ${cfg.phase}`);
  }
  const status = String(inv.status || '').toLowerCase();
  if (status !== cfg.expectedStatus) {
    throw new Error(`INV-${cfg.invoiceId} status ${inv.status}, expected ${cfg.expectedStatus}`);
  }
  const already = inv.issue === cfg.targetIssue && inv.due === cfg.targetDue;
  const matchesCurrent = inv.issue === cfg.currentIssue && inv.due === cfg.currentDue;
  if (!already && !matchesCurrent) {
    throw new Error(
      `INV-${cfg.invoiceId} unexpected dates issue=${inv.issue} due=${inv.due}`
    );
  }
  return already;
}

async function applyDates(client, inv, cfg) {
  const nextRemarks = String(inv.remarks || '').includes(REPAIR_NOTE)
    ? inv.remarks
    : [inv.remarks, REPAIR_NOTE].filter(Boolean).join(';');
  await client.query(
    `UPDATE invoicestbl
     SET issue_date = $1::date,
         due_date = $2::date,
         remarks = $3
     WHERE invoice_id = $4
       AND installmentinvoiceprofiles_id = $5`,
    [cfg.targetIssue, cfg.targetDue, nextRemarks, cfg.invoiceId, PROFILE_ID]
  );
  try {
    await syncProgramPaymentStatusForInvoice(client, cfg.invoiceId);
  } catch (e) {
    console.warn(`⚠ sync INV-${cfg.invoiceId}:`, e.message);
  }
}

async function main() {
  console.log(
    `\nMiguel Bohol — Phase 2 dates Mar 25 / Apr 5` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`Note: ${REPAIR_NOTE}`);
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);

  if (process.env.DB_NAME !== 'psms_production') {
    console.warn('⚠️ Expected psms_production. Pass --production.');
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const student = (
      await client.query(
        `SELECT user_id, full_name, email FROM userstbl
         WHERE user_id = $1 AND LOWER(TRIM(email)) = LOWER(TRIM($2))`,
        [STUDENT_ID, STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student) throw new Error('Student not found');
    console.log('Student:', student.full_name, student.email);

    const profile = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id, class_id, is_active, generated_count
         FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1 AND student_id = $2 AND class_id = $3`,
        [PROFILE_ID, STUDENT_ID, CLASS_ID]
      )
    ).rows[0];
    if (!profile) throw new Error('Profile not found');
    console.log('Profile:', profile);

    const inv1 = await loadInvoice(client, PHASE1.invoiceId);
    const inv2 = await loadInvoice(client, PHASE2.invoiceId);
    const p1Done = assertDates(inv1, PHASE1);
    const p2Done = assertDates(inv2, PHASE2);

    console.log('\nBEFORE:');
    console.table([
      { slot: 'Phase 1 DB', invoice_id: inv1.invoice_id, issue: inv1.issue, due: inv1.due, status: inv1.status },
      { slot: 'Phase 2 DB', invoice_id: inv2.invoice_id, issue: inv2.issue, due: inv2.due, status: inv2.status },
    ]);

    const beforeUi = normalizeAdjacentPhaseDisplayDates([
      { is_generated: true, issue_date: inv1.issue, due_date: inv1.due, status: inv1.status },
      { is_generated: true, issue_date: inv2.issue, due_date: inv2.due, status: inv2.status },
    ]);
    console.log('BEFORE UI display (after date-swap):');
    console.table([
      { slot: 'Phase 1 UI', issue: beforeUi[0].issue_date, due: beforeUi[0].due_date },
      { slot: 'Phase 2 UI', issue: beforeUi[1].issue_date, due: beforeUi[1].due_date },
    ]);

    console.log('\nPlanned:');
    console.log(
      p1Done
        ? `  • Phase 1 INV-1850 already ${PHASE1.targetIssue} / ${PHASE1.targetDue}`
        : `  • Phase 1 INV-1850 ${PHASE1.currentIssue}/${PHASE1.currentDue} → ${PHASE1.targetIssue}/${PHASE1.targetDue} (unswap)`
    );
    console.log(
      p2Done
        ? `  • Phase 2 INV-1927 already ${PHASE2.targetIssue} / ${PHASE2.targetDue}`
        : `  • Phase 2 INV-1927 ${PHASE2.currentIssue}/${PHASE2.currentDue} → ${PHASE2.targetIssue}/${PHASE2.targetDue}`
    );
    console.log('  • Leave unpaid amount, penalty, dropped enrollment, Inactive plan');

    if (!p1Done) {
      await applyDates(client, inv1, PHASE1);
      console.log('✅ Updated INV-1850');
    }
    if (!p2Done) {
      await applyDates(client, inv2, PHASE2);
      console.log('✅ Updated INV-1927');
    }

    const after1 = await loadInvoice(client, PHASE1.invoiceId);
    const after2 = await loadInvoice(client, PHASE2.invoiceId);
    if (after1.issue !== PHASE1.targetIssue || after1.due !== PHASE1.targetDue) {
      throw new Error(`Phase 1 dates not applied: ${after1.issue} / ${after1.due}`);
    }
    if (after2.issue !== PHASE2.targetIssue || after2.due !== PHASE2.targetDue) {
      throw new Error(`Phase 2 dates not applied: ${after2.issue} / ${after2.due}`);
    }

    const afterUi = normalizeAdjacentPhaseDisplayDates([
      { is_generated: true, issue_date: after1.issue, due_date: after1.due, status: after1.status },
      { is_generated: true, issue_date: after2.issue, due_date: after2.due, status: after2.status },
    ]);

    console.log('\nAFTER DB:');
    console.table([
      { slot: 'Phase 1 DB', invoice_id: after1.invoice_id, issue: after1.issue, due: after1.due, status: after1.status },
      { slot: 'Phase 2 DB', invoice_id: after2.invoice_id, issue: after2.issue, due: after2.due, status: after2.status },
    ]);
    console.log('AFTER UI display:');
    console.table([
      { slot: 'Phase 1 UI', issue: afterUi[0].issue_date, due: afterUi[0].due_date },
      { slot: 'Phase 2 UI', issue: afterUi[1].issue_date, due: afterUi[1].due_date },
    ]);

    if (afterUi[1].issue_date !== PHASE2.targetIssue || afterUi[1].due_date !== PHASE2.targetDue) {
      throw new Error(
        `UI Phase 2 would show ${afterUi[1].issue_date} / ${afterUi[1].due_date}, expected ${PHASE2.targetIssue} / ${PHASE2.targetDue}`
      );
    }

    console.log('\nExpected Student History Phase 2: Issued Mar 25, 2026  Due Apr 5, 2026');

    if (!isApply) {
      await client.query('ROLLBACK');
      console.log('\nDry run only — rolled back. Re-run with --apply to commit.');
      return;
    }

    await client.query('COMMIT');
    console.log('\nCommitted. Refresh Student History → Invoices.');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('\n❌ Repair failed:', err?.message || err);
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
