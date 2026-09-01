/**
 * Kiev Zion Z. Serrano — shift Phase 1–3 issue/due dates; undrop Phase 3; un-generate Phase 4.
 *
 * Student: 581 · juliepearlserrano01@gmail.com
 * Profile: 384 · VMM Nursery MWF 2:30 PM (billing class)
 *
 * Target:
 *   Phase 1 INV-1213  new         · issue 2026-05-03 · due 2026-07-03  (Paid)
 *   Phase 2 INV-2281  re_enrolled · issue 2026-07-25 · due 2026-08-05  (Paid)
 *   Phase 3 INV-2336  — (no enrollment) · issue 2026-08-25 · due 2026-09-05  (Unpaid)
 *   Phase 4 INV-2352  delete      → Not Generated
 *
 * Queue after: generated_count 3, next_gen 2026-09-25, next_month 2026-10-01,
 * scheduled 2026-10-05 (Phase 4 generates on Sep 25).
 *
 * Run:
 *   node backend/scripts/repairKievZionSerranoPhase123DatesUndropPhase4.js --production
 *   node backend/scripts/repairKievZionSerranoPhase123DatesUndropPhase4.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { rewriteTargetPhaseInRemarks } from '../utils/installmentPhaseBillingSync.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_EMAIL = 'juliepearlserrano01@gmail.com';
const STUDENT_ID = 581;
const PROFILE_ID = 384;

const PHASE1_INVOICE_ID = 1213;
const PHASE2_INVOICE_ID = 2281;
const PHASE3_INVOICE_ID = 2336;
const PHASE4_INVOICE_ID = 2352;

const EXPECTED_GENERATED_COUNT = 3;
const NEXT_GEN = '2026-09-25';
const NEXT_MONTH = '2026-10-01';
const SCHEDULED_DUE = '2026-10-05';

const DATE_UPDATES = [
  {
    invoiceId: PHASE1_INVOICE_ID,
    phase: 1,
    enrollmentStatus: 'new',
    targetIssue: '2026-05-03',
    targetDue: '2026-07-03',
    currentIssues: ['2026-05-03'],
    currentDues: ['2026-05-03', '2026-07-03'],
    allowPaidOnly: true,
  },
  {
    invoiceId: PHASE2_INVOICE_ID,
    phase: 2,
    enrollmentStatus: 're_enrolled',
    targetIssue: '2026-07-25',
    targetDue: '2026-08-05',
    currentIssues: ['2026-05-25', '2026-07-25'],
    currentDues: ['2026-06-05', '2026-08-05'],
    allowPaidOnly: true,
  },
  {
    invoiceId: PHASE3_INVOICE_ID,
    phase: 3,
    removeEnrollment: true,
    targetIssue: '2026-08-25',
    targetDue: '2026-09-05',
    currentIssues: ['2026-06-25', '2026-08-25'],
    currentDues: ['2026-07-05', '2026-09-05'],
    allowPaidOnly: false,
  },
];

const REPAIR_NOTE =
  'Ops repair 2026-08-29 — Kiev Serrano Phase1–3 dates + remove Phase3 enrollment + un-generate Phase4';

const DROP_WAIVE_FLAG = 'DELINQUENCY_DROP_WAIVED';

const isApply = process.argv.includes('--apply');

function ymd(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

function stampRemarks(currentRemarks, phase, { waiveDrop = false } = {}) {
  let remarks = rewriteTargetPhaseInRemarks(currentRemarks || '', phase);
  if (waiveDrop && !remarks.includes(DROP_WAIVE_FLAG)) {
    remarks = remarks ? `${remarks};${DROP_WAIVE_FLAG}` : DROP_WAIVE_FLAG;
  }
  if (!remarks.includes(REPAIR_NOTE)) {
    remarks = remarks ? `${remarks};${REPAIR_NOTE}` : REPAIR_NOTE;
  }
  return remarks;
}

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

async function deleteInvoiceCascade(client, invoiceId) {
  const payments = await client.query(
    `SELECT payment_id, status, approval_status
     FROM paymenttbl WHERE invoice_id = $1`,
    [invoiceId]
  );
  const blocking = payments.rows.filter(
    (p) =>
      String(p.status) === 'Completed' && String(p.approval_status || '') !== 'Rejected'
  );
  if (blocking.length) {
    throw new Error(
      `Invoice ${invoiceId} has ${blocking.length} completed payment(s); refuse to delete`
    );
  }
  await client.query(`DELETE FROM program_payment_statustbl WHERE invoice_id = $1`, [invoiceId]);
  await client.query(`DELETE FROM invoicestudentstbl WHERE invoice_id = $1`, [invoiceId]);
  await client.query(`DELETE FROM invoiceitemstbl WHERE invoice_id = $1`, [invoiceId]);
  await client.query(
    `UPDATE invoicestbl SET balance_invoice_id = NULL WHERE balance_invoice_id = $1`,
    [invoiceId]
  );
  await client.query(`DELETE FROM invoicestbl WHERE invoice_id = $1`, [invoiceId]);
}

async function loadInvoice(client, invoiceId) {
  const r = await client.query(
    `SELECT invoice_id, status, amount, invoice_ar_number,
            installmentinvoiceprofiles_id AS profile_id,
            TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue,
            TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due,
            late_penalty_applied_for_due_date,
            remarks
     FROM invoicestbl WHERE invoice_id = $1`,
    [invoiceId]
  );
  const row = r.rows[0] || null;
  if (row) row.phase = parseTargetPhase(row.remarks);
  return row;
}

async function loadProfile(client) {
  const r = await client.query(
    `SELECT ip.installmentinvoiceprofiles_id, ip.student_id, ip.class_id, c.class_name,
            ip.is_active, ip.generated_count, ip.phase_start, ip.total_phases,
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

async function loadEnrollments(client, classId) {
  const r = await client.query(
    `SELECT cs.classstudent_id, cs.class_id, cs.phase_number,
            cs.program_enrollment_status AS status,
            TO_CHAR(TIMEZONE('Asia/Manila', cs.enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled,
            TO_CHAR(TIMEZONE('Asia/Manila', cs.removed_at), 'YYYY-MM-DD HH24:MI') AS removed,
            LEFT(COALESCE(cs.removed_reason, ''), 80) AS removed_reason
     FROM classstudentstbl cs
     WHERE cs.student_id = $1 AND cs.class_id = $2
     ORDER BY cs.phase_number NULLS LAST, cs.classstudent_id`,
    [STUDENT_ID, classId]
  );
  return r.rows;
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
    `\nKiev Zion Serrano — Phase 1–3 dates + blank Phase 3 enrollment + un-generate Phase 4` +
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

    const profile = await loadProfile(client);
    if (!profile) throw new Error(`Profile ${PROFILE_ID} not found`);
    const classId = Number(profile.class_id);
    console.log('Profile/queue BEFORE:', profile);

    const enrollmentsBefore = await loadEnrollments(client, classId);
    console.log('\nEnrollments BEFORE:');
    console.table(enrollmentsBefore);

    console.log('\nProfile invoices BEFORE:');
    console.table(await loadProfileInvoices(client));

    const datePlan = [];
    for (const cfg of DATE_UPDATES) {
      const inv = await loadInvoice(client, cfg.invoiceId);
      if (!inv) throw new Error(`INV-${cfg.invoiceId} not found`);
      if (Number(inv.profile_id) !== PROFILE_ID) {
        throw new Error(`INV-${cfg.invoiceId} profile ${inv.profile_id} ≠ ${PROFILE_ID}`);
      }
      if (inv.phase !== cfg.phase) {
        throw new Error(`INV-${cfg.invoiceId} TARGET_PHASE:${inv.phase}, expected ${cfg.phase}`);
      }
      const status = String(inv.status || '').toLowerCase();
      if (cfg.allowPaidOnly && status !== 'paid') {
        throw new Error(`INV-${cfg.invoiceId} status ${inv.status}, expected Paid`);
      }
      if (!cfg.allowPaidOnly && !['paid', 'unpaid', 'overdue', 'partially paid'].includes(status)) {
        throw new Error(`INV-${cfg.invoiceId} unexpected status ${inv.status}`);
      }

      const alreadyTarget = inv.issue === cfg.targetIssue && inv.due === cfg.targetDue;
      const matchesCurrent = matchesDatePair(inv.issue, inv.due, cfg);
      if (!alreadyTarget && !matchesCurrent) {
        throw new Error(
          `INV-${cfg.invoiceId} unexpected dates issue=${inv.issue} due=${inv.due}`
        );
      }
      datePlan.push({ cfg, inv, alreadyTarget });
    }

    const phase4 = await loadInvoice(client, PHASE4_INVOICE_ID);
    const phase4Exists = Boolean(phase4 && Number(phase4.profile_id) === PROFILE_ID);
    if (phase4Exists) {
      if (phase4.phase !== 4) {
        throw new Error(`INV-${PHASE4_INVOICE_ID} TARGET_PHASE:${phase4.phase}, expected 4`);
      }
      const p4Status = String(phase4.status || '').toLowerCase();
      if (!['unpaid', 'overdue'].includes(p4Status)) {
        throw new Error(
          `INV-${PHASE4_INVOICE_ID} status ${phase4.status} — refuse to delete (expected Unpaid/Overdue)`
        );
      }
    }

    const phase3Enrollment = enrollmentsBefore.find((e) => Number(e.phase_number) === 3);
    const phase4Enrollment = enrollmentsBefore.find((e) => Number(e.phase_number) === 4);

    console.log('\nPlanned:');
    for (const { cfg, inv, alreadyTarget } of datePlan) {
      console.log(
        alreadyTarget
          ? `  • Phase ${cfg.phase} INV-${cfg.invoiceId} already ${cfg.targetIssue} / ${cfg.targetDue}`
          : `  • Phase ${cfg.phase} INV-${cfg.invoiceId} ${inv.issue}/${inv.due} → ${cfg.targetIssue}/${cfg.targetDue}`
      );
      if (cfg.removeEnrollment) {
        console.log(
          phase3Enrollment
            ? `    DELETE phase ${cfg.phase} enrollment CS ${phase3Enrollment.classstudent_id} (${phase3Enrollment.status}) → — until paid`
            : `    Phase ${cfg.phase} enrollment already absent`
        );
      } else {
        console.log(`    Enrollment phase ${cfg.phase} → ${cfg.enrollmentStatus}`);
      }
    }
    console.log(
      phase4Exists
        ? `  • DELETE Phase 4 INV-${PHASE4_INVOICE_ID} (${phase4.issue}/${phase4.due} ${phase4.status})`
        : `  • Phase 4 INV-${PHASE4_INVOICE_ID} already absent`
    );
    if (phase4Enrollment) {
      console.log(
        `  • DELETE phase 4 enrollment row classstudent_id ${phase4Enrollment.classstudent_id}`
      );
    }
    console.log(
      `  • generated_count ${profile.generated_count} → ${EXPECTED_GENERATED_COUNT}`
    );
    console.log(
      `  • Queue → next_gen ${NEXT_GEN}, next_month ${NEXT_MONTH}, scheduled ${SCHEDULED_DUE}`
    );
    console.log('  • Profile is_active → true');
    console.log(
      `  • Phase 3 INV-${PHASE3_INVOICE_ID}: clear late penalty + add ${DROP_WAIVE_FLAG}`
    );

    for (const { cfg, inv, alreadyTarget } of datePlan) {
      const stampedRemarks = stampRemarks(inv.remarks || '', cfg.phase, {
        waiveDrop: cfg.phase === 3,
      });

      await client.query(
        `UPDATE invoicestbl
         SET issue_date = $1::date,
             due_date = $2::date,
             late_penalty_applied_for_due_date = NULL,
             remarks = $3
         WHERE invoice_id = $4
           AND installmentinvoiceprofiles_id = $5`,
        [cfg.targetIssue, cfg.targetDue, stampedRemarks, cfg.invoiceId, PROFILE_ID]
      );

      if (cfg.phase === 3) {
        const cleared = await clearInvoicePenalty(client, cfg.invoiceId);
        if (cleared) {
          console.log(`✅ Cleared late penalty on INV-${cfg.invoiceId}`);
        }
      }

      try {
        await syncProgramPaymentStatusForInvoice(client, cfg.invoiceId);
      } catch (e) {
        console.warn(`⚠ syncProgramPaymentStatus INV-${cfg.invoiceId}:`, e.message);
      }

      if (cfg.removeEnrollment) {
        const enrollmentRow = enrollmentsBefore.find(
          (e) => Number(e.phase_number) === cfg.phase
        );
        if (enrollmentRow) {
          await client.query(`DELETE FROM classstudentstbl WHERE classstudent_id = $1`, [
            enrollmentRow.classstudent_id,
          ]);
          console.log(
            `✅ Updated INV-${cfg.invoiceId}; deleted phase ${cfg.phase} enrollment CS ${enrollmentRow.classstudent_id}`
          );
        } else {
          console.log(`✅ Updated INV-${cfg.invoiceId}; phase ${cfg.phase} enrollment already absent`);
        }
        continue;
      }

      const enrollmentRow = enrollmentsBefore.find(
        (e) => Number(e.phase_number) === cfg.phase
      );
      if (!enrollmentRow) {
        throw new Error(`No enrollment row for phase ${cfg.phase} on class ${classId}`);
      }

      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = $1::text,
             enrolled_at = ($2::text || '+08')::timestamptz,
             removed_at = NULL,
             removed_reason = NULL,
             removed_by = NULL,
             enrolled_by = CASE
               WHEN enrolled_by IS NULL OR TRIM(enrolled_by) = '' THEN $3::text
               WHEN enrolled_by ILIKE '%' || $3::text || '%' THEN enrolled_by
               ELSE enrolled_by || ' | ' || $3::text
             END
         WHERE classstudent_id = $4
           AND student_id = $5
           AND class_id = $6
           AND phase_number = $7`,
        [
          cfg.enrollmentStatus,
          `${cfg.targetDue} 12:00:00`,
          REPAIR_NOTE,
          enrollmentRow.classstudent_id,
          STUDENT_ID,
          classId,
          cfg.phase,
        ]
      );

      console.log(
        alreadyTarget
          ? `✅ Phase ${cfg.phase} dates already correct; enrollment → ${cfg.enrollmentStatus}`
          : `✅ Updated INV-${cfg.invoiceId} + phase ${cfg.phase} enrollment`
      );
    }

    if (phase4Exists) {
      await deleteInvoiceCascade(client, PHASE4_INVOICE_ID);
      console.log(`✅ Deleted INV-${PHASE4_INVOICE_ID}`);
    }

    if (phase4Enrollment) {
      await client.query(`DELETE FROM classstudentstbl WHERE classstudent_id = $1`, [
        phase4Enrollment.classstudent_id,
      ]);
      console.log(`✅ Deleted phase 4 enrollment CS ${phase4Enrollment.classstudent_id}`);
    }

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET generated_count = $1,
           is_active = true
       WHERE installmentinvoiceprofiles_id = $2
         AND student_id = $3`,
      [EXPECTED_GENERATED_COUNT, PROFILE_ID, STUDENT_ID]
    );

    if (!profile.installmentinvoicedtl_id) {
      throw new Error(`No installment queue row for profile ${PROFILE_ID}`);
    }
    await client.query(
      `UPDATE installmentinvoicestbl
       SET next_generation_date = $1::date,
           next_invoice_month = $2::date,
           scheduled_date = $3::date
       WHERE installmentinvoicedtl_id = $4
         AND installmentinvoiceprofiles_id = $5`,
      [NEXT_GEN, NEXT_MONTH, SCHEDULED_DUE, profile.installmentinvoicedtl_id, PROFILE_ID]
    );
    console.log('✅ Queue + generated_count updated');

    const afterInvoices = await loadProfileInvoices(client);
    if (afterInvoices.some((r) => Number(r.phase) === 4 || Number(r.invoice_id) === PHASE4_INVOICE_ID)) {
      throw new Error('Phase 4 invoice still linked to profile');
    }

    for (const cfg of DATE_UPDATES) {
      const after = await loadInvoice(client, cfg.invoiceId);
      if (after.issue !== cfg.targetIssue || after.due !== cfg.targetDue) {
        throw new Error(
          `INV-${cfg.invoiceId} dates not applied: ${after.issue} / ${after.due}`
        );
      }
    }

    const afterProfile = await loadProfile(client);
    if (Number(afterProfile.generated_count) !== EXPECTED_GENERATED_COUNT) {
      throw new Error(`generated_count=${afterProfile.generated_count}, expected 3`);
    }
    if (
      afterProfile.next_gen !== NEXT_GEN ||
      afterProfile.next_month !== NEXT_MONTH ||
      afterProfile.scheduled !== SCHEDULED_DUE
    ) {
      throw new Error(
        `Queue mismatch next_gen=${afterProfile.next_gen} next_month=${afterProfile.next_month} scheduled=${afterProfile.scheduled}`
      );
    }

    const afterEnrollments = await loadEnrollments(client, classId);
    for (const cfg of DATE_UPDATES.filter((c) => c.enrollmentStatus)) {
      const row = afterEnrollments.find((e) => Number(e.phase_number) === cfg.phase);
      if (!row || row.status !== cfg.enrollmentStatus || row.removed) {
        throw new Error(
          `Phase ${cfg.phase} enrollment ${row?.status} removed=${row?.removed}`
        );
      }
    }
    if (afterEnrollments.some((e) => Number(e.phase_number) === 3)) {
      throw new Error('Phase 3 enrollment row still present (expected — until paid)');
    }
    if (afterEnrollments.some((e) => Number(e.phase_number) === 4)) {
      throw new Error('Phase 4 enrollment row still present');
    }

    console.log('\nAFTER invoices:');
    console.table(afterInvoices);
    console.log('AFTER profile/queue:', afterProfile);
    console.log('\nEnrollments AFTER:');
    console.table(afterEnrollments);

    console.log('\nExpected UI:');
    console.log('  Phase 1  new          · May 3 / Jul 3   · Paid');
    console.log('  Phase 2  re enrolled  · Jul 25 / Aug 5  · Paid');
    console.log('  Phase 3  —            · Aug 25 / Sep 5  · Unpaid (not enrolled until paid)');
    console.log('  Phase 4  Not Generated');

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
