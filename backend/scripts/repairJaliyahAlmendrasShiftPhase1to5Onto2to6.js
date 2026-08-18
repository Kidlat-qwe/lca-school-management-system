/**
 * Jaliyah Callie Almendras — start at Phase 2; shift paid Phase 1–5 → Phase 2–6.
 *
 * Student: 353 · rinadeleon713@gmail.com
 * Profile: 150 · class 47 SOMO_Playgroup_TTh_9:30-10:30AM · Branch SOMO (3)
 *
 * Today (phase_start NULL):
 *   INV-347  TARGET_PHASE:1 Paid  Mar 25 / Apr 5 · CS 328 new
 *   INV-605  TARGET_PHASE:2 Paid  Apr 25 / May 5 · CS 580 re_enrolled
 *   INV-1043 TARGET_PHASE:3 Paid  May 25 / Jun 5 · CS 931 re_enrolled
 *   INV-1525 TARGET_PHASE:4 Paid  Jun 25 / Jul 5 · CS 1319 re_enrolled
 *   INV-2151 TARGET_PHASE:5 Paid  Jul 25 / Aug 5 · CS 1945 re_enrolled
 *   INV-2343 TARGET_PHASE:6 Unpaid overdue ₱5,660.60 (orphan after shift)
 *   generated_count 6 · queue next_gen 2026-08-25 / next_month 2026-09-01
 *
 * Target:
 *   phase_start 2 (Phase 1 not displayed on Student History plan)
 *   INV-347→P2, 605→P3, 1043→P4, 1525→P5, 2151→P6 (issue/due/payments unchanged)
 *   Enrollments: CS phase_number +1 (new stays on first; others re_enrolled)
 *   Cancel + detach INV-2343 (no completed non-rejected payments)
 *   generated_count 5 · queue kept for next Phase 7 cycle
 *
 * Run:
 *   node backend/scripts/repairJaliyahAlmendrasShiftPhase1to5Onto2to6.js --production
 *   node backend/scripts/repairJaliyahAlmendrasShiftPhase1to5Onto2to6.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { rewriteTargetPhaseInRemarks } from '../utils/installmentPhaseBillingSync.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_ID = 353;
const STUDENT_EMAIL = 'rinadeleon713@gmail.com';
const PROFILE_ID = 150;
const CLASS_ID = 47;
const CLASS_NAME = 'SOMO_Playgroup_TTh_9:30-10:30AM';
const BRANCH_ID = 3;
const DOWNPAYMENT_INVOICE_ID = 346;
const ORPHAN_PHASE6_INVOICE_ID = 2343;

const NEXT_GEN = '2026-08-25';
const NEXT_MONTH = '2026-09-01';
const SCHEDULED_DUE = '2026-09-05';

/** Shift paid invoices 1→2 … 5→6. Keep issue/due; payments untouched. */
const PHASE_SHIFTS = [
  {
    invoiceId: 347,
    fromPhase: 1,
    toPhase: 2,
    classstudentId: 328,
    enrollmentStatus: 'new',
    expectedIssue: '2026-03-25',
    expectedDue: '2026-04-05',
    expectedStatus: 'paid',
  },
  {
    invoiceId: 605,
    fromPhase: 2,
    toPhase: 3,
    classstudentId: 580,
    enrollmentStatus: 're_enrolled',
    expectedIssue: '2026-04-25',
    expectedDue: '2026-05-05',
    expectedStatus: 'paid',
  },
  {
    invoiceId: 1043,
    fromPhase: 3,
    toPhase: 4,
    classstudentId: 931,
    enrollmentStatus: 're_enrolled',
    expectedIssue: '2026-05-25',
    expectedDue: '2026-06-05',
    expectedStatus: 'paid',
  },
  {
    invoiceId: 1525,
    fromPhase: 4,
    toPhase: 5,
    classstudentId: 1319,
    enrollmentStatus: 're_enrolled',
    expectedIssue: '2026-06-25',
    expectedDue: '2026-07-05',
    expectedStatus: 'paid',
  },
  {
    invoiceId: 2151,
    fromPhase: 5,
    toPhase: 6,
    classstudentId: 1945,
    enrollmentStatus: 're_enrolled',
    expectedIssue: '2026-07-25',
    expectedDue: '2026-08-05',
    expectedStatus: 'paid',
  },
];

const REPAIR_NOTE =
  'Ops repair 2026-08-15 — Jaliyah Almendras shift P1–5 → P2–6; phase_start 2; cancel orphan INV-2343';

const isApply = process.argv.includes('--apply');

async function loadInvoice(client, invoiceId) {
  const r = await client.query(
    `SELECT invoice_id, status, amount, invoice_ar_number, remarks,
            installmentinvoiceprofiles_id AS profile_id,
            TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
            TO_CHAR(due_date, 'YYYY-MM-DD') AS due
     FROM invoicestbl WHERE invoice_id = $1`,
    [invoiceId]
  );
  const row = r.rows[0] || null;
  if (row) row.phase = parseTargetPhase(row.remarks);
  return row;
}

async function loadProfileQueue(client) {
  const r = await client.query(
    `SELECT ip.installmentinvoiceprofiles_id AS profile_id, ip.student_id,
            ip.class_id, c.class_name, ip.is_active, ip.generated_count,
            ip.phase_start, ip.total_phases, ip.downpayment_invoice_id,
            ii.installmentinvoicedtl_id,
            TO_CHAR(ii.next_generation_date, 'YYYY-MM-DD') AS next_gen,
            TO_CHAR(ii.next_invoice_month, 'YYYY-MM-DD') AS next_month,
            TO_CHAR(ii.scheduled_date, 'YYYY-MM-DD') AS scheduled
     FROM installmentinvoiceprofilestbl ip
     LEFT JOIN classestbl c ON c.class_id = ip.class_id
     LEFT JOIN installmentinvoicestbl ii
       ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
     WHERE ip.installmentinvoiceprofiles_id = $1
       AND ip.student_id = $2`,
    [PROFILE_ID, STUDENT_ID]
  );
  return r.rows[0] || null;
}

async function loadEnrollments(client) {
  const r = await client.query(
    `SELECT cs.classstudent_id, cs.class_id, cs.phase_number,
            cs.program_enrollment_status AS status,
            TO_CHAR(TIMEZONE('Asia/Manila', cs.enrolled_at), 'YYYY-MM-DD') AS enrolled,
            TO_CHAR(TIMEZONE('Asia/Manila', cs.removed_at), 'YYYY-MM-DD') AS removed
     FROM classstudentstbl cs
     WHERE cs.student_id = $1 AND cs.class_id = $2
     ORDER BY cs.phase_number, cs.classstudent_id`,
    [STUDENT_ID, CLASS_ID]
  );
  return r.rows;
}

async function main() {
  console.log(
    `\nJaliyah Almendras — shift Phase 1–5 → 2–6` +
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
    console.log('Student:', student.full_name, student.email, `(id ${student.user_id})`);

    const klass = (
      await client.query(
        `SELECT class_id, class_name, branch_id FROM classestbl WHERE class_id = $1`,
        [CLASS_ID]
      )
    ).rows[0];
    if (!klass || klass.class_name !== CLASS_NAME) {
      throw new Error(`Class ${CLASS_ID} name mismatch: ${klass?.class_name}`);
    }
    if (Number(klass.branch_id) !== BRANCH_ID) {
      throw new Error(`Class branch ${klass.branch_id} ≠ ${BRANCH_ID}`);
    }

    const profile = await loadProfileQueue(client);
    if (!profile) throw new Error(`Profile ${PROFILE_ID} not found`);
    if (Number(profile.class_id) !== CLASS_ID) {
      throw new Error(`Profile class_id ${profile.class_id} ≠ ${CLASS_ID}`);
    }
    const phaseStartOk =
      profile.phase_start == null ||
      Number(profile.phase_start) === 1 ||
      Number(profile.phase_start) === 2;
    if (!phaseStartOk) {
      throw new Error(`phase_start=${profile.phase_start}, expected NULL/1/2`);
    }
    console.log('Profile/queue BEFORE:', profile);

    const beforeCs = await loadEnrollments(client);
    console.log('\nBEFORE enrollments (class 47):');
    console.table(beforeCs);

    for (const cfg of PHASE_SHIFTS) {
      const inv = await loadInvoice(client, cfg.invoiceId);
      if (!inv || Number(inv.profile_id) !== PROFILE_ID) {
        throw new Error(`INV-${cfg.invoiceId} not on profile ${PROFILE_ID}`);
      }
      if (String(inv.status).toLowerCase() !== cfg.expectedStatus) {
        throw new Error(`INV-${cfg.invoiceId} status ${inv.status}, expected ${cfg.expectedStatus}`);
      }
      const phaseOk = inv.phase === cfg.fromPhase || inv.phase === cfg.toPhase;
      if (!phaseOk) {
        throw new Error(
          `INV-${cfg.invoiceId} TARGET_PHASE:${inv.phase}, expected ${cfg.fromPhase} or ${cfg.toPhase}`
        );
      }
      if (inv.issue !== cfg.expectedIssue || inv.due !== cfg.expectedDue) {
        throw new Error(
          `INV-${cfg.invoiceId} unexpected dates ${inv.issue} / ${inv.due} ` +
            `(expected ${cfg.expectedIssue} / ${cfg.expectedDue})`
        );
      }

      const cs = beforeCs.find((r) => Number(r.classstudent_id) === cfg.classstudentId);
      if (!cs) throw new Error(`CS ${cfg.classstudentId} not found`);
      if (
        Number(cs.phase_number) !== cfg.fromPhase &&
        Number(cs.phase_number) !== cfg.toPhase
      ) {
        throw new Error(
          `CS ${cfg.classstudentId} phase ${cs.phase_number}, expected ${cfg.fromPhase} or ${cfg.toPhase}`
        );
      }

      console.log(`INV-${cfg.invoiceId} BEFORE:`, {
        phase: inv.phase,
        issue: inv.issue,
        due: inv.due,
        status: inv.status,
        ar: inv.invoice_ar_number,
      });
    }

    const orphan = await loadInvoice(client, ORPHAN_PHASE6_INVOICE_ID);
    if (!orphan) throw new Error(`Orphan INV-${ORPHAN_PHASE6_INVOICE_ID} not found`);
    const orphanPayments = (
      await client.query(
        `SELECT payment_id, status, COALESCE(approval_status, 'Pending') AS approval_status,
                payable_amount::text
         FROM paymenttbl WHERE invoice_id = $1`,
        [ORPHAN_PHASE6_INVOICE_ID]
      )
    ).rows;
    console.log('Orphan INV-2343 BEFORE:', {
      status: orphan.status,
      profile_id: orphan.profile_id,
      phase: orphan.phase,
      issue: orphan.issue,
      due: orphan.due,
      amount: orphan.amount,
      ar: orphan.invoice_ar_number,
    });
    console.table(orphanPayments.length ? orphanPayments : [{ note: '(no payments)' }]);

    const orphanAlreadyCancelled = ['cancelled', 'canceled'].includes(
      String(orphan.status || '').toLowerCase()
    );
    const orphanHasGoodPayment = orphanPayments.some(
      (p) =>
        String(p.status) === 'Completed' &&
        !['Rejected', 'Returned'].includes(String(p.approval_status || ''))
    );
    if (!orphanAlreadyCancelled && orphanHasGoodPayment) {
      throw new Error('INV-2343 has completed payments — refuse to cancel');
    }
    if (
      !orphanAlreadyCancelled &&
      orphan.phase != null &&
      orphan.phase !== 6 &&
      Number(orphan.profile_id) === PROFILE_ID
    ) {
      throw new Error(`INV-2343 TARGET_PHASE:${orphan.phase}, expected 6 before cancel`);
    }

    const dp = await loadInvoice(client, DOWNPAYMENT_INVOICE_ID);
    console.log('Downpayment remarks BEFORE:', String(dp?.remarks || '').slice(0, 160));

    console.log('\nPlanned:');
    for (const cfg of PHASE_SHIFTS) {
      console.log(
        `  • INV-${cfg.invoiceId} P${cfg.fromPhase}→P${cfg.toPhase} ` +
          `(keep ${cfg.expectedIssue}/${cfg.expectedDue}); ` +
          `CS ${cfg.classstudentId} → phase ${cfg.toPhase} ${cfg.enrollmentStatus}`
      );
    }
    console.log('  • Phase 1: not displayed (phase_start = 2)');
    console.log(
      `  • Cancel + detach INV-${ORPHAN_PHASE6_INVOICE_ID} (orphan unpaid Phase 6)`
    );
    console.log('  • phase_start → 2; generated_count → 5');
    console.log(
      `  • Queue → next_gen ${NEXT_GEN}, next_month ${NEXT_MONTH}, scheduled ${SCHEDULED_DUE}`
    );
    console.log('  • Payment dates / amounts unchanged');

    if (!isApply) {
      await client.query('ROLLBACK');
      console.log('\nDRY RUN — re-run with --apply to write changes.');
      return;
    }

    // Park TARGET_PHASE to avoid collisions, then assign final phases.
    for (const cfg of [...PHASE_SHIFTS].reverse()) {
      const inv = await loadInvoice(client, cfg.invoiceId);
      const parked = rewriteTargetPhaseInRemarks(inv.remarks || '', 1000 + cfg.invoiceId);
      await client.query(`UPDATE invoicestbl SET remarks = $1 WHERE invoice_id = $2`, [
        parked,
        cfg.invoiceId,
      ]);
    }

    for (const cfg of PHASE_SHIFTS) {
      const inv = await loadInvoice(client, cfg.invoiceId);
      let remarks = rewriteTargetPhaseInRemarks(inv.remarks || '', cfg.toPhase);
      if (!remarks.includes(REPAIR_NOTE)) {
        remarks = `${remarks};${REPAIR_NOTE}`;
      }
      await client.query(
        `UPDATE invoicestbl
         SET remarks = $1
         WHERE invoice_id = $2
           AND installmentinvoiceprofiles_id = $3`,
        [remarks, cfg.invoiceId, PROFILE_ID]
      );
      try {
        await syncProgramPaymentStatusForInvoice(client, cfg.invoiceId);
      } catch (e) {
        console.warn(`⚠ sync INV-${cfg.invoiceId}:`, e.message);
      }
      console.log(`✅ INV-${cfg.invoiceId} → TARGET_PHASE:${cfg.toPhase}`);
    }

    // Shift enrollments high→low so phase_number does not collide.
    for (const cfg of [...PHASE_SHIFTS].reverse()) {
      const upd = await client.query(
        `UPDATE classstudentstbl
         SET phase_number = $1,
             program_enrollment_status = $2,
             removed_at = NULL,
             removed_reason = NULL,
             removed_by = NULL
         WHERE classstudent_id = $3
           AND student_id = $4
           AND class_id = $5
         RETURNING classstudent_id, phase_number, program_enrollment_status`,
        [cfg.toPhase, cfg.enrollmentStatus, cfg.classstudentId, STUDENT_ID, CLASS_ID]
      );
      if (!upd.rows.length) {
        throw new Error(`Failed to update CS ${cfg.classstudentId}`);
      }
      console.log(
        `✅ CS ${cfg.classstudentId} → phase ${cfg.toPhase} ${cfg.enrollmentStatus}`
      );
    }

    const leftoverP1 = await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2 AND phase_number = 1`,
      [STUDENT_ID, CLASS_ID]
    );
    if (leftoverP1.rows.length) {
      throw new Error(
        `Phase 1 enrollment still present: ${JSON.stringify(leftoverP1.rows)}`
      );
    }

    if (!orphanAlreadyCancelled) {
      let orphanRemarks = String(orphan.remarks || '');
      if (!orphanRemarks.includes(REPAIR_NOTE)) {
        orphanRemarks = orphanRemarks
          ? `${orphanRemarks};${REPAIR_NOTE}`
          : REPAIR_NOTE;
      }
      await client.query(
        `UPDATE invoicestbl
         SET status = 'Cancelled',
             installmentinvoiceprofiles_id = NULL,
             remarks = $1
         WHERE invoice_id = $2
           AND installmentinvoiceprofiles_id = $3`,
        [orphanRemarks, ORPHAN_PHASE6_INVOICE_ID, PROFILE_ID]
      );
      console.log(`✅ INV-${ORPHAN_PHASE6_INVOICE_ID} → Cancelled + detached`);
    } else {
      console.log(`✅ INV-${ORPHAN_PHASE6_INVOICE_ID} already cancelled`);
    }

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET phase_start = 2,
           generated_count = 5
       WHERE installmentinvoiceprofiles_id = $1
         AND student_id = $2`,
      [PROFILE_ID, STUDENT_ID]
    );
    console.log('✅ Profile phase_start → 2, generated_count → 5');

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
      console.log(
        `✅ Queue → next_gen ${NEXT_GEN}, next_month ${NEXT_MONTH}, scheduled ${SCHEDULED_DUE}`
      );
    }

    const afterCs = await loadEnrollments(client);
    console.log('\nAFTER enrollments:');
    console.table(afterCs);

    const expectedPhases = [2, 3, 4, 5, 6];
    for (const phase of expectedPhases) {
      const row = afterCs.find((r) => Number(r.phase_number) === phase && !r.removed);
      if (!row) throw new Error(`Missing enrollment for phase ${phase} after apply`);
    }
    if (afterCs.some((r) => Number(r.phase_number) === 1)) {
      throw new Error('Phase 1 enrollment still present after apply');
    }

    for (const cfg of PHASE_SHIFTS) {
      const inv = await loadInvoice(client, cfg.invoiceId);
      if (inv.phase !== cfg.toPhase) {
        throw new Error(`INV-${cfg.invoiceId} phase ${inv.phase} ≠ ${cfg.toPhase}`);
      }
      if (inv.issue !== cfg.expectedIssue || inv.due !== cfg.expectedDue) {
        throw new Error(`INV-${cfg.invoiceId} dates changed unexpectedly`);
      }
    }

    const orphanAfter = await loadInvoice(client, ORPHAN_PHASE6_INVOICE_ID);
    if (
      String(orphanAfter?.status).toLowerCase() !== 'cancelled' ||
      orphanAfter?.profile_id != null
    ) {
      throw new Error('Orphan cancel/detach validation failed');
    }

    const profileAfter = await loadProfileQueue(client);
    if (Number(profileAfter.phase_start) !== 2 || Number(profileAfter.generated_count) !== 5) {
      throw new Error(
        `Profile after: phase_start=${profileAfter.phase_start} generated_count=${profileAfter.generated_count}`
      );
    }

    await client.query('COMMIT');
    console.log('\n✅ APPLY complete. Refresh Student History → Installment to verify.');
    console.log('   Expect Phase 1 hidden; Phase 2–6 = former Phase 1–5 (paid); Phase 7+ Not Generated.');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('\nFailed:', err.message || err);
    process.exit(1);
  } finally {
    client.release();
  }
}

main().then(() => process.exit(0));
