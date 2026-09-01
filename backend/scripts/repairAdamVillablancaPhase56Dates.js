/**
 * Adam M. Villablanca De Mendoza — shift Phase 5 & 6 issue/due dates.
 *
 * Student: 395 · xamarguelle@gmail.com
 * Profile: 294 · VMM_Pre-Kinder_MWF 1PM (class 69)
 *
 *   Phase 5 INV-1945 / INV-1946 (balance chain, Paid) · Jul 8 / Nov 5 → Jul 8 / Aug 5
 *   Phase 6 INV-2249 (Unpaid)                         · Jul 25 / Aug 5 → Aug 25 / Sep 5
 *
 * Queue after: next_gen 2026-09-25, next_month 2026-10-01, scheduled 2026-10-05
 *
 * Run:
 *   node backend/scripts/repairAdamVillablancaPhase56Dates.js --production
 *   node backend/scripts/repairAdamVillablancaPhase56Dates.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_EMAIL = 'xamarguelle@gmail.com';
const STUDENT_ID = 395;
const PROFILE_ID = 294;
const CLASS_ID = 69;

const PHASE5_PARENT_INVOICE_ID = 1945;
const PHASE5_BALANCE_INVOICE_ID = 1946;
const PHASE6_INVOICE_ID = 2249;

const NEXT_GEN = '2026-09-25';
const NEXT_MONTH = '2026-10-01';
const SCHEDULED_DUE = '2026-10-05';

const DATE_UPDATES = [
  {
    invoiceIds: [PHASE5_PARENT_INVOICE_ID, PHASE5_BALANCE_INVOICE_ID],
    phase: 5,
    targetIssue: '2026-07-08',
    targetDue: '2026-08-05',
    currentIssues: ['2026-07-08'],
    currentDues: ['2026-11-05', '2026-08-05'],
    expectPaidChain: true,
  },
  {
    invoiceIds: [PHASE6_INVOICE_ID],
    phase: 6,
    targetIssue: '2026-08-25',
    targetDue: '2026-09-05',
    currentIssues: ['2026-07-25', '2026-08-25'],
    currentDues: ['2026-08-05', '2026-09-05'],
    expectPaidChain: false,
  },
];

const REPAIR_NOTE =
  'Ops repair 2026-08-29 — Adam Villablanca Phase 5/6 issue-due (Jul8/Aug5, Aug25/Sep5)';

const isApply = process.argv.includes('--apply');

async function clearInvoicePenalty(client, invoiceId) {
  const items = await client.query(
    `SELECT invoice_item_id, penalty_amount
     FROM invoiceitemstbl
     WHERE invoice_id = $1 AND COALESCE(penalty_amount, 0) > 0`,
    [invoiceId]
  );
  if (!items.rows.length) return false;

  for (const item of items.rows) {
    await client.query(
      `UPDATE invoiceitemstbl SET amount = 0, penalty_amount = 0 WHERE invoice_item_id = $1`,
      [item.invoice_item_id]
    );
  }

  const totals = await client.query(
    `SELECT COALESCE(SUM(amount), 0) - COALESCE(SUM(discount_amount), 0)
            + COALESCE(SUM(penalty_amount), 0) AS grand
     FROM invoiceitemstbl WHERE invoice_id = $1`,
    [invoiceId]
  );
  const grand = Number(totals.rows[0]?.grand || 0);
  await client.query(
    `UPDATE invoicestbl
     SET amount = $1, late_penalty_applied_for_due_date = NULL
     WHERE invoice_id = $2`,
    [grand, invoiceId]
  );
  return true;
}

async function loadInvoice(client, invoiceId) {
  const r = await client.query(
    `SELECT invoice_id, status, amount, invoice_ar_number,
            installmentinvoiceprofiles_id AS profile_id,
            parent_invoice_id, balance_invoice_id,
            TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue,
            TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due,
            remarks
     FROM invoicestbl WHERE invoice_id = $1`,
    [invoiceId]
  );
  const row = r.rows[0] || null;
  if (row) row.phase = parseTargetPhase(row.remarks);
  return row;
}

async function loadProfileQueue(client) {
  const r = await client.query(
    `SELECT ip.installmentinvoiceprofiles_id, ip.class_id, c.class_name,
            ip.is_active, ip.generated_count,
            ii.installmentinvoicedtl_id,
            TO_CHAR(TIMEZONE('Asia/Manila', ii.next_generation_date), 'YYYY-MM-DD') AS next_gen,
            TO_CHAR(TIMEZONE('Asia/Manila', ii.next_invoice_month), 'YYYY-MM-DD') AS next_month,
            TO_CHAR(TIMEZONE('Asia/Manila', ii.scheduled_date), 'YYYY-MM-DD') AS scheduled
     FROM installmentinvoiceprofilestbl ip
     LEFT JOIN classestbl c ON c.class_id = ip.class_id
     LEFT JOIN installmentinvoicestbl ii
       ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
      AND COALESCE(ii.status, '') != 'Generated'
     WHERE ip.installmentinvoiceprofiles_id = $1
       AND ip.student_id = $2`,
    [PROFILE_ID, STUDENT_ID]
  );
  return r.rows[0] || null;
}

async function loadProfileInvoices(client) {
  const r = await client.query(
    `SELECT invoice_id, status, amount, invoice_ar_number,
            SUBSTRING(remarks FROM 'TARGET_PHASE:([0-9]+)') AS phase,
            TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue,
            TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due
     FROM invoicestbl
     WHERE installmentinvoiceprofiles_id = $1
       AND COALESCE(status, '') NOT IN ('Cancelled', 'Canceled')
     ORDER BY invoice_id`,
    [PROFILE_ID]
  );
  return r.rows;
}

function matchesDatePair(issue, due, cfg) {
  return cfg.currentIssues.includes(issue) && cfg.currentDues.includes(due);
}

async function main() {
  console.log(
    `\nAdam Villablanca — Phase 5 & 6 issue/due dates${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
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

    const profile = await loadProfileQueue(client);
    if (!profile) throw new Error(`Profile ${PROFILE_ID} not found`);
    if (Number(profile.class_id) !== CLASS_ID) {
      throw new Error(`Profile class_id=${profile.class_id}, expected ${CLASS_ID}`);
    }

    console.log('Student:', student.full_name, student.email);
    console.log('Profile/queue BEFORE:', profile);
    console.log('\nInvoices BEFORE:');
    console.table(await loadProfileInvoices(client));

    for (const cfg of DATE_UPDATES) {
      for (const invoiceId of cfg.invoiceIds) {
        const inv = await loadInvoice(client, invoiceId);
        if (!inv) throw new Error(`INV-${invoiceId} not found`);
        if (Number(inv.profile_id) !== PROFILE_ID) {
          throw new Error(`INV-${invoiceId} profile ${inv.profile_id} ≠ ${PROFILE_ID}`);
        }
        if (inv.phase !== cfg.phase) {
          throw new Error(`INV-${invoiceId} TARGET_PHASE:${inv.phase}, expected ${cfg.phase}`);
        }

        const alreadyTarget = inv.issue === cfg.targetIssue && inv.due === cfg.targetDue;
        const matchesCurrent = matchesDatePair(inv.issue, inv.due, cfg);
        if (!alreadyTarget && !matchesCurrent) {
          throw new Error(
            `INV-${invoiceId} unexpected dates issue=${inv.issue} due=${inv.due}`
          );
        }

        if (cfg.expectPaidChain) {
          const status = String(inv.status || '').toLowerCase();
          if (!['paid', 'partially paid'].includes(status)) {
            throw new Error(`INV-${invoiceId} status ${inv.status}, expected Paid chain`);
          }
        } else {
          const status = String(inv.status || '').toLowerCase();
          if (!['paid', 'unpaid', 'overdue', 'partially paid'].includes(status)) {
            throw new Error(`INV-${invoiceId} unexpected status ${inv.status}`);
          }
        }
      }
    }

    console.log('\nPlanned:');
    console.log('  • Phase 5 INV-1945 / INV-1946 → 2026-07-08 / 2026-08-05 (Paid, keep payments)');
    console.log('  • Phase 6 INV-2249 → 2026-08-25 / 2026-09-05 (clear penalty if present)');
    console.log(
      `  • Queue scheduled → ${SCHEDULED_DUE} (next_gen ${NEXT_GEN}, next_month ${NEXT_MONTH})`
    );

    for (const cfg of DATE_UPDATES) {
      for (const invoiceId of cfg.invoiceIds) {
        const inv = await loadInvoice(client, invoiceId);
        const stampedRemarks = String(inv.remarks || '').includes(REPAIR_NOTE)
          ? inv.remarks
          : [inv.remarks, REPAIR_NOTE].filter(Boolean).join(';');

        await client.query(
          `UPDATE invoicestbl
           SET issue_date = $1::date,
               due_date = $2::date,
               late_penalty_applied_for_due_date = NULL,
               remarks = $3
           WHERE invoice_id = $4
             AND installmentinvoiceprofiles_id = $5`,
          [cfg.targetIssue, cfg.targetDue, stampedRemarks, invoiceId, PROFILE_ID]
        );

        if (cfg.phase === 6) {
          const cleared = await clearInvoicePenalty(client, invoiceId);
          if (cleared) console.log(`✅ Cleared late penalty on INV-${invoiceId}`);
        }

        try {
          await syncProgramPaymentStatusForInvoice(client, invoiceId);
        } catch (e) {
          console.warn(`⚠ syncProgramPaymentStatus INV-${invoiceId}:`, e.message);
        }
      }
      console.log(`✅ Phase ${cfg.phase} dates updated (${cfg.invoiceIds.map((id) => `INV-${id}`).join(', ')})`);
    }

    if (profile.installmentinvoicedtl_id) {
      await client.query(
        `UPDATE installmentinvoicestbl
         SET next_generation_date = $1::date,
             next_invoice_month = $2::date,
             scheduled_date = $3::date
         WHERE installmentinvoicedtl_id = $4
           AND installmentinvoiceprofiles_id = $5`,
        [NEXT_GEN, NEXT_MONTH, SCHEDULED_DUE, profile.installmentinvoicedtl_id, PROFILE_ID]
      );
      console.log('✅ Queue scheduled_date aligned');
    }

    const phase5Enrollment = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status AS status
         FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2 AND phase_number = 5`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows[0];
    if (phase5Enrollment) {
      await client.query(
        `UPDATE classstudentstbl
         SET enrolled_at = ($1::text || '+08')::timestamptz
         WHERE classstudent_id = $2`,
        ['2026-08-05 12:00:00', phase5Enrollment.classstudent_id]
      );
      console.log(`✅ Phase 5 enrollment enrolled_at → 2026-08-05`);
    }

    for (const cfg of DATE_UPDATES) {
      for (const invoiceId of cfg.invoiceIds) {
        const after = await loadInvoice(client, invoiceId);
        if (after.issue !== cfg.targetIssue || after.due !== cfg.targetDue) {
          throw new Error(
            `INV-${invoiceId} dates not applied: ${after.issue} / ${after.due}`
          );
        }
      }
    }

    const afterProfile = await loadProfileQueue(client);
    if (afterProfile.scheduled !== SCHEDULED_DUE) {
      throw new Error(`scheduled_date=${afterProfile.scheduled}, expected ${SCHEDULED_DUE}`);
    }

    console.log('\nAFTER invoices:');
    console.table(await loadProfileInvoices(client));
    console.log('AFTER profile/queue:', afterProfile);

    console.log('\nExpected UI:');
    console.log('  Phase 5  re enrolled  · Jul 8 / Aug 5   · Paid');
    console.log('  Phase 6  —            · Aug 25 / Sep 5  · Unpaid');

    if (!isApply) {
      await client.query('ROLLBACK');
      console.log('\nDry run only — rolled back. Re-run with --apply to commit.');
      return;
    }

    await client.query('COMMIT');
    console.log('\nCommitted. Refresh Student History → Installment.');
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
