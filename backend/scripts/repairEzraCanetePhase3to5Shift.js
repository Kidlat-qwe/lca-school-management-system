/**
 * Ezra Gabrielle M. Cañete — shift wrong Phase 4–6 start → Phase 3–5.
 *
 * Student: 599 · jericacanete01@gmail.com
 * Profile: 410 · class 162 VMP_Pre-Kindergarten_MWF 11AM · Branch VMP (6)
 *
 * Today:
 *   phase_start 4 · generated_count 3
 *   INV-1331 TARGET_PHASE:4 Paid  Jun 5 / Jul 5
 *   INV-1884 TARGET_PHASE:5 Paid  Jul 3 / Aug 5
 *   INV-2421 TARGET_PHASE:6 Paid  Aug 5 / Oct 5
 *   Enrollments on 162: P4 new, P5 re_enrolled, P6 re_enrolled
 *   Queue: next_gen 2026-09-25 / next_month 2026-10-01
 *   INV-1330 Cancelled TARGET_PHASE:3 still on profile (orphan)
 *
 * Target:
 *   phase_start 3 · generated_count 3 (still 3 paid invoices)
 *   INV-1331 → Phase 3 · May 31 / Jun 5 · enrollment new
 *   INV-1884 → Phase 4 · Jun 25 / Jul 5 · enrollment re_enrolled
 *   INV-2421 → Phase 5 · Jul 25 / Aug 5 · enrollment re_enrolled
 *   Phase 6 not enrolled / Not Generated
 *   Queue: next_gen 2026-08-25 / next_month 2026-09-01 / scheduled 2026-09-05
 *   Downpayment PHASE_START:3 PHASE_END:9
 *   Detach cancelled INV-1330
 *
 * Run:
 *   node backend/scripts/repairEzraCanetePhase3to5Shift.js --production
 *   node backend/scripts/repairEzraCanetePhase3to5Shift.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { rewriteTargetPhaseInRemarks } from '../utils/installmentPhaseBillingSync.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_ID = 599;
const STUDENT_EMAIL = 'jericacanete01@gmail.com';
const PROFILE_ID = 410;
const CLASS_ID = 162;
const CLASS_NAME = 'VMP_Pre-Kindergarten_MWF 11AM';
const BRANCH_ID = 6;
const DOWNPAYMENT_INVOICE_ID = 1329;
const ORPHAN_PHASE3_INVOICE_ID = 1330;

const NEXT_GEN = '2026-08-25';
const NEXT_MONTH = '2026-09-01';
const SCHEDULED_DUE = '2026-09-05';

/** Shift paid invoices 4→3, 5→4, 6→5 with new dates + enrollment rows. */
const PHASE_SHIFTS = [
  {
    invoiceId: 1331,
    fromPhase: 4,
    toPhase: 3,
    classstudentId: 1165,
    enrollmentStatus: 'new',
    currentIssue: '2026-06-05',
    currentDue: '2026-07-05',
    targetIssue: '2026-05-31',
    targetDue: '2026-06-05',
    expectedStatus: 'paid',
  },
  {
    invoiceId: 1884,
    fromPhase: 5,
    toPhase: 4,
    classstudentId: 1571,
    enrollmentStatus: 're_enrolled',
    currentIssue: '2026-07-03',
    currentDue: '2026-08-05',
    targetIssue: '2026-06-25',
    targetDue: '2026-07-05',
    expectedStatus: 'paid',
  },
  {
    invoiceId: 2421,
    fromPhase: 6,
    toPhase: 5,
    classstudentId: 2205,
    enrollmentStatus: 're_enrolled',
    currentIssue: '2026-08-05',
    currentDue: '2026-10-05',
    targetIssue: '2026-07-25',
    targetDue: '2026-08-05',
    expectedStatus: 'paid',
  },
];

const REPAIR_NOTE =
  'Ops repair 2026-08-14 — Ezra Cañete shift P4–6 → P3–5; dates May31/Jun5, Jun25/Jul5, Jul25/Aug5; queue Aug25/Sep1';

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
            TO_CHAR(TIMEZONE('Asia/Manila', cs.enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled,
            TO_CHAR(TIMEZONE('Asia/Manila', cs.removed_at), 'YYYY-MM-DD HH24:MI') AS removed
     FROM classstudentstbl cs
     WHERE cs.student_id = $1 AND cs.class_id = $2
     ORDER BY cs.phase_number, cs.classstudent_id`,
    [STUDENT_ID, CLASS_ID]
  );
  return r.rows;
}

function rewriteAdvancePaymentLabel(remarks, absolutePhase) {
  let next = String(remarks || '');
  if (/Advance payment\s*[—\-]\s*Phase\s*\d+/i.test(next)) {
    next = next.replace(
      /Advance payment\s*[—\-]\s*Phase\s*\d+/i,
      `Advance payment — Phase ${absolutePhase}`
    );
  }
  return next;
}

async function main() {
  console.log(
    `\nEzra Cañete — shift Phase 4–6 → 3–5` +
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
      Number(profile.phase_start) === 4 || Number(profile.phase_start) === 3;
    if (!phaseStartOk) {
      throw new Error(`phase_start=${profile.phase_start}, expected 4 or 3`);
    }
    console.log('Profile/queue BEFORE:', profile);

    const beforeCs = await loadEnrollments(client);
    console.log('\nBEFORE enrollments (class 162):');
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
      const datesOk =
        (inv.issue === cfg.currentIssue && inv.due === cfg.currentDue) ||
        (inv.issue === cfg.targetIssue && inv.due === cfg.targetDue);
      if (!datesOk) {
        throw new Error(
          `INV-${cfg.invoiceId} unexpected dates ${inv.issue} / ${inv.due}`
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

    const orphan = await loadInvoice(client, ORPHAN_PHASE3_INVOICE_ID);
    console.log('Orphan INV-1330 BEFORE:', {
      status: orphan?.status,
      profile_id: orphan?.profile_id,
      phase: orphan?.phase,
    });

    const dp = await loadInvoice(client, DOWNPAYMENT_INVOICE_ID);
    console.log('Downpayment remarks BEFORE:', String(dp?.remarks || '').slice(0, 120));

    console.log('\nPlanned:');
    for (const cfg of PHASE_SHIFTS) {
      console.log(
        `  • INV-${cfg.invoiceId} P${cfg.fromPhase}→P${cfg.toPhase} ` +
          `${cfg.targetIssue}/${cfg.targetDue}; CS ${cfg.classstudentId} → ${cfg.enrollmentStatus}`
      );
    }
    console.log('  • Phase 6: no enrollment / Not Generated');
    console.log('  • phase_start 4 → 3; PHASE_START/END 3/9');
    console.log(
      `  • Queue → next_gen ${NEXT_GEN}, next_month ${NEXT_MONTH}, scheduled ${SCHEDULED_DUE}`
    );
    console.log('  • Detach cancelled INV-1330 if still on profile');

    // Park TARGET_PHASE to avoid collisions, then assign final phases + dates.
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
      remarks = rewriteAdvancePaymentLabel(remarks, cfg.toPhase);
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
        [cfg.targetIssue, cfg.targetDue, remarks, cfg.invoiceId, PROFILE_ID]
      );
      try {
        await syncProgramPaymentStatusForInvoice(client, cfg.invoiceId);
      } catch (e) {
        console.warn(`⚠ sync INV-${cfg.invoiceId}:`, e.message);
      }
      console.log(
        `✅ INV-${cfg.invoiceId} → TARGET_PHASE:${cfg.toPhase} ${cfg.targetIssue}/${cfg.targetDue}`
      );
    }

    for (const cfg of PHASE_SHIFTS) {
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

    // Ensure no Phase 6 enrollment remains on this class.
    const leftoverP6 = await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2 AND phase_number = 6`,
      [STUDENT_ID, CLASS_ID]
    );
    if (leftoverP6.rows.length) {
      throw new Error(
        `Phase 6 enrollment still present: ${JSON.stringify(leftoverP6.rows)}`
      );
    }

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET phase_start = 3,
           generated_count = 3
       WHERE installmentinvoiceprofiles_id = $1
         AND student_id = $2`,
      [PROFILE_ID, STUDENT_ID]
    );
    console.log('✅ Profile phase_start → 3, generated_count → 3');

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
    } else {
      throw new Error('Missing installmentinvoicestbl queue row');
    }

    if (dp) {
      let nextDp = String(dp.remarks || '')
        .replace(/PHASE_START:\d+/i, 'PHASE_START:3')
        .replace(/PHASE_END:\d+/i, 'PHASE_END:9');
      if (!/CLASS_ID:\d+/i.test(nextDp)) {
        nextDp = `CLASS_ID:${CLASS_ID};${nextDp}`;
      } else {
        nextDp = nextDp.replace(/CLASS_ID:\d+/i, `CLASS_ID:${CLASS_ID}`);
      }
      if (!nextDp.includes(REPAIR_NOTE)) nextDp = `${nextDp};${REPAIR_NOTE}`;
      await client.query(`UPDATE invoicestbl SET remarks = $1 WHERE invoice_id = $2`, [
        nextDp,
        DOWNPAYMENT_INVOICE_ID,
      ]);
      console.log('✅ Downpayment CLASS_ID:162 PHASE_START:3 PHASE_END:9');
    }

    if (
      orphan &&
      (orphan.profile_id != null ||
        !['cancelled', 'canceled'].includes(String(orphan.status || '').toLowerCase()))
    ) {
      const orphanRemarks = [orphan.remarks, REPAIR_NOTE, 'ORPHAN_OLD_PHASE3'].filter(Boolean).join(';');
      await client.query(
        `UPDATE invoicestbl
         SET status = 'Cancelled',
             installmentinvoiceprofiles_id = NULL,
             remarks = $1
         WHERE invoice_id = $2`,
        [orphanRemarks, ORPHAN_PHASE3_INVOICE_ID]
      );
      console.log('✅ Detached cancelled INV-1330 from profile');
    } else if (orphan) {
      console.log('ℹ️ INV-1330 already cancelled/detached');
    }

    const afterProfile = await loadProfileQueue(client);
    const afterCs = await loadEnrollments(client);
    const remaining = (
      await client.query(
        `SELECT invoice_id, status, invoice_ar_number,
                TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
                TO_CHAR(due_date, 'YYYY-MM-DD') AS due,
                SUBSTRING(remarks FROM 'TARGET_PHASE:([0-9]+)') AS phase
         FROM invoicestbl
         WHERE installmentinvoiceprofiles_id = $1
           AND COALESCE(status, '') NOT IN ('Cancelled', 'Canceled')
         ORDER BY invoice_id`,
        [PROFILE_ID]
      )
    ).rows;

    console.log('\nProfile/queue AFTER:', afterProfile);
    console.log('AFTER enrollments:');
    console.table(afterCs);
    console.log('Remaining profile invoices:');
    console.table(remaining);

    if (Number(afterProfile.phase_start) !== 3) {
      throw new Error(`phase_start ${afterProfile.phase_start} ≠ 3`);
    }
    if (Number(afterProfile.generated_count) !== 3) {
      throw new Error(`generated_count ${afterProfile.generated_count} ≠ 3`);
    }
    if (afterProfile.next_gen !== NEXT_GEN || afterProfile.next_month !== NEXT_MONTH) {
      throw new Error(
        `Queue ${afterProfile.next_gen}/${afterProfile.next_month} ≠ ${NEXT_GEN}/${NEXT_MONTH}`
      );
    }
    if (afterProfile.scheduled !== SCHEDULED_DUE) {
      throw new Error(`scheduled ${afterProfile.scheduled} ≠ ${SCHEDULED_DUE}`);
    }

    const expectedInv = [
      { id: 1331, phase: 3, issue: '2026-05-31', due: '2026-06-05' },
      { id: 1884, phase: 4, issue: '2026-06-25', due: '2026-07-05' },
      { id: 2421, phase: 5, issue: '2026-07-25', due: '2026-08-05' },
    ];
    for (const exp of expectedInv) {
      const row = remaining.find((r) => Number(r.invoice_id) === exp.id);
      if (!row || Number(row.phase) !== exp.phase) {
        throw new Error(`INV-${exp.id} phase ${row?.phase} ≠ ${exp.phase}`);
      }
      if (row.issue !== exp.issue || row.due !== exp.due) {
        throw new Error(`INV-${exp.id} dates ${row.issue}/${row.due}`);
      }
    }
    if (remaining.some((r) => Number(r.phase) === 6)) {
      throw new Error('Phase 6 invoice still on profile');
    }

    const expectedCs = [
      { phase: 3, status: 'new' },
      { phase: 4, status: 're_enrolled' },
      { phase: 5, status: 're_enrolled' },
    ];
    for (const exp of expectedCs) {
      const row = afterCs.find((r) => Number(r.phase_number) === exp.phase);
      if (!row || String(row.status) !== exp.status || row.removed != null) {
        throw new Error(
          `Phase ${exp.phase} enrollment status=${row?.status} removed=${row?.removed}`
        );
      }
    }
    if (afterCs.some((r) => Number(r.phase_number) === 6)) {
      throw new Error('Phase 6 enrollment still present');
    }

    const afterOrphan = await loadInvoice(client, ORPHAN_PHASE3_INVOICE_ID);
    if (afterOrphan?.profile_id != null) {
      throw new Error('INV-1330 still linked to profile');
    }

    console.log('\nExpected UI:');
    console.log('  Plan starts at Phase 3');
    console.log('  Phase 3: new · Issued May 31 · Due Jun 5 · Paid');
    console.log('  Phase 4: re enrolled · Issued Jun 25 · Due Jul 5 · Paid');
    console.log('  Phase 5: re enrolled · Issued Jul 25 · Due Aug 5 · Paid');
    console.log('  Phase 6: — / Not Generated (not enrolled)');
    console.log('  Installment queue: next gen Aug 25 · invoice month Sep 1');

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
