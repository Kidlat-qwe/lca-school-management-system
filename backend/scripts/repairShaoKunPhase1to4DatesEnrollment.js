/**
 * Shao Kun Calingasin Wang — fix Phase 1–4 issue/due dates + enrollment labels.
 *
 * Student: 115 · calingasinhelen@gmail.com
 * Profile: 81 · class 56 NC_Nursery_MWF
 *
 * Target:
 *   Phase 1 INV-249  — new         · issue 2026-02-03 · due 2026-02-04
 *   Phase 2 INV-257  — re_enrolled · issue 2026-02-25 · due 2026-03-05
 *   Phase 3 INV-611  — re_enrolled · issue 2026-03-25 · due 2026-04-05
 *   Phase 4 INV-1091 — re_enrolled · issue 2026-04-25 · due 2026-05-05
 *
 * Also stamps TARGET_PHASE on those invoices and aligns enrolled_at to the due date.
 * Does NOT touch Phase 5+ invoices/enrollments (incl. dropped Phase 6).
 *
 * Run:
 *   node backend/scripts/repairShaoKunPhase1to4DatesEnrollment.js --production
 *   node backend/scripts/repairShaoKunPhase1to4DatesEnrollment.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { rewriteTargetPhaseInRemarks } from '../utils/installmentPhaseBillingSync.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_ID = 115;
const STUDENT_EMAIL = 'calingasinhelen@gmail.com';
const PROFILE_ID = 81;
const CLASS_ID = 56;

const PHASES = [
  {
    phase: 1,
    invoice_id: 249,
    enrollment_status: 'new',
    classstudent_id: 215,
    issue: '2026-02-03',
    due: '2026-02-04',
    current_issue: '2026-02-25',
    current_due: '2026-02-04',
  },
  {
    phase: 2,
    invoice_id: 257,
    enrollment_status: 're_enrolled',
    classstudent_id: 346,
    issue: '2026-02-25',
    due: '2026-03-05',
    current_issue: '2026-03-25',
    current_due: '2026-04-05',
  },
  {
    phase: 3,
    invoice_id: 611,
    enrollment_status: 're_enrolled',
    classstudent_id: 680,
    issue: '2026-03-25',
    due: '2026-04-05',
    current_issue: '2026-04-25',
    current_due: '2026-05-05',
  },
  {
    phase: 4,
    invoice_id: 1091,
    enrollment_status: 're_enrolled',
    classstudent_id: 1109,
    issue: '2026-04-25',
    due: '2026-05-05',
    current_issue: '2026-05-25',
    current_due: '2026-06-05',
  },
];

const REPAIR_NOTE =
  'Ops repair 2026-08-08 — Shao Kun Phase1–4 issue/due + enrollment (new / re_enrolled)';

const isApply = process.argv.includes('--apply');

async function loadInvoice(client, invoiceId) {
  const r = await client.query(
    `SELECT invoice_id, status, amount, invoice_ar_number,
            installmentinvoiceprofiles_id AS profile_id,
            TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
            TO_CHAR(due_date, 'YYYY-MM-DD') AS due,
            LEFT(COALESCE(remarks,''), 140) AS remarks
     FROM invoicestbl WHERE invoice_id = $1`,
    [invoiceId]
  );
  const row = r.rows[0] || null;
  if (row) row.phase = parseTargetPhase(row.remarks);
  return row;
}

async function loadEnrollments(client) {
  return (
    await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status AS status,
              TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD') AS enrolled,
              TO_CHAR(TIMEZONE('Asia/Manila', removed_at), 'YYYY-MM-DD') AS removed
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2
       ORDER BY phase_number NULLS LAST, classstudent_id`,
      [STUDENT_ID, CLASS_ID]
    )
  ).rows;
}

async function main() {
  console.log(
    `\nShao Kun — Phase 1–4 dates + enrollment` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`Note: ${REPAIR_NOTE}`);
  console.log(`DB: ${process.env.DB_NAME} | NODE_ENV=${process.env.NODE_ENV}\n`);

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
         WHERE installmentinvoiceprofiles_id = $1
           AND student_id = $2
           AND class_id = $3`,
        [PROFILE_ID, STUDENT_ID, CLASS_ID]
      )
    ).rows[0];
    if (!profile) throw new Error('Profile not found');
    console.log('Profile:', profile);

    console.log('\nEnrollments BEFORE:');
    console.table(await loadEnrollments(client));

    console.log('\nInvoices BEFORE (Phase 1–4):');
    const beforeRows = [];
    for (const cfg of PHASES) {
      const inv = await loadInvoice(client, cfg.invoice_id);
      if (!inv) throw new Error(`INV-${cfg.invoice_id} not found`);
      if (Number(inv.profile_id) !== PROFILE_ID) {
        throw new Error(`INV-${cfg.invoice_id} not on profile ${PROFILE_ID}`);
      }
      if (String(inv.status).toLowerCase() !== 'paid') {
        throw new Error(`INV-${cfg.invoice_id} status ${inv.status}, expected Paid`);
      }
      // Allow already-fixed or expected current
      const atTarget = inv.issue === cfg.issue && inv.due === cfg.due;
      const atExpectedCurrent =
        inv.issue === cfg.current_issue && inv.due === cfg.current_due;
      if (!atTarget && !atExpectedCurrent) {
        throw new Error(
          `INV-${cfg.invoice_id} unexpected dates ${inv.issue}/${inv.due} ` +
            `(want current ${cfg.current_issue}/${cfg.current_due} or target ${cfg.issue}/${cfg.due})`
        );
      }
      beforeRows.push({ ...inv, target_phase: cfg.phase });
    }
    console.table(beforeRows);

    console.log('\nPlanned:');
    for (const cfg of PHASES) {
      console.log(
        `  Phase ${cfg.phase}: INV-${cfg.invoice_id} → ${cfg.issue} / ${cfg.due}; ` +
          `CS ${cfg.classstudent_id} → ${cfg.enrollment_status}`
      );
    }

    for (const cfg of PHASES) {
      const inv = await loadInvoice(client, cfg.invoice_id);
      let remarks = rewriteTargetPhaseInRemarks(inv.remarks || '', cfg.phase);
      if (!remarks.includes(REPAIR_NOTE)) {
        remarks = `${remarks};${REPAIR_NOTE}`;
      }

      await client.query(
        `UPDATE invoicestbl
         SET issue_date = $1::date,
             due_date = $2::date,
             remarks = $3
         WHERE invoice_id = $4
           AND installmentinvoiceprofiles_id = $5`,
        [cfg.issue, cfg.due, remarks, cfg.invoice_id, PROFILE_ID]
      );

      // Explicit +08 noon so Manila calendar day matches the due date.
      const enr = await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = $1::text,
             enrolled_at = ($2::text || '+08')::timestamptz,
             removed_at = NULL,
             removed_reason = NULL,
             removed_by = NULL
         WHERE classstudent_id = $3
           AND student_id = $4
           AND class_id = $5
           AND phase_number = $6
         RETURNING classstudent_id, phase_number, program_enrollment_status AS status,
                   TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD') AS enrolled`,
        [
          cfg.enrollment_status,
          `${cfg.due} 12:00:00`,
          cfg.classstudent_id,
          STUDENT_ID,
          CLASS_ID,
          cfg.phase,
        ]
      );
      if (!enr.rows.length) {
        throw new Error(
          `Failed enrollment update phase ${cfg.phase} CS ${cfg.classstudent_id}`
        );
      }

      try {
        await syncProgramPaymentStatusForInvoice(client, cfg.invoice_id);
      } catch (e) {
        console.warn(`⚠ sync INV-${cfg.invoice_id}:`, e.message);
      }

      console.log(
        `✅ Phase ${cfg.phase}: INV-${cfg.invoice_id} ${cfg.issue}/${cfg.due}; ` +
          `enrollment ${enr.rows[0].status} @ ${enr.rows[0].enrolled}`
      );
    }

    console.log('\nInvoices AFTER (Phase 1–4):');
    const afterInv = [];
    for (const cfg of PHASES) {
      afterInv.push(await loadInvoice(client, cfg.invoice_id));
    }
    console.table(afterInv);

    console.log('\nEnrollments AFTER:');
    console.table(await loadEnrollments(client));

    for (const cfg of PHASES) {
      const inv = afterInv.find((i) => Number(i.invoice_id) === cfg.invoice_id);
      if (inv.issue !== cfg.issue || inv.due !== cfg.due) {
        throw new Error(`Phase ${cfg.phase} dates not applied`);
      }
      if (parseTargetPhase(inv.remarks) !== cfg.phase) {
        throw new Error(`Phase ${cfg.phase} TARGET_PHASE missing`);
      }
    }
    const afterEnr = await loadEnrollments(client);
    for (const cfg of PHASES) {
      const row = afterEnr.find((e) => Number(e.phase_number) === cfg.phase);
      if (!row || String(row.status) !== cfg.enrollment_status) {
        throw new Error(
          `Phase ${cfg.phase} enrollment ${row?.status} ≠ ${cfg.enrollment_status}`
        );
      }
    }

    console.log('\nExpected UI:');
    console.log('  Phase 1 new · Feb 3 / Feb 4');
    console.log('  Phase 2 re_enrolled · Feb 25 / Mar 5');
    console.log('  Phase 3 re_enrolled · Mar 25 / Apr 5');
    console.log('  Phase 4 re_enrolled · Apr 25 / May 5');

    if (!isApply) {
      await client.query('ROLLBACK');
      console.log('\nDry run only — rolled back. Re-run with --apply to commit.');
      return;
    }

    await client.query('COMMIT');
    console.log('\nCommitted.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('\nFAILED — rolled back:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main();
