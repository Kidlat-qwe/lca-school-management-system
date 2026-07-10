/**
 * Matthew R. Sabino — correct installment invoice issue/due dates and drop phase 3.
 *
 * Student: eumarck.sabino@gmail.com | Profile 154 | VMM_Pre-Kinder_MWF 1PM (class 69)
 *
 * Targets:
 *   Phase 2 — issue 2026-04-25, due 2026-05-05  (INV-901, Paid — dates only)
 *   Phase 3 — issue 2026-05-25, due 2026-06-05  (INV-1738, Unpaid — drop enrollment)
 *   Phase 4 — issue 2026-06-25, due 2026-07-05  (INV-1815, Unpaid — dates only)
 *
 * Run:
 *   node backend/scripts/repairMatthewSabinoInstallmentPhases.js
 *   node backend/scripts/repairMatthewSabinoInstallmentPhases.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { rewriteTargetPhaseInRemarks } from '../utils/installmentPhaseBillingSync.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';
import { buildPhaseInstallmentSchedule } from '../utils/phaseInstallmentUtils.js';
import { coerceToManilaYmd } from '../utils/dateUtils.js';
import { PROGRAM_ENROLLMENT_STATUS } from '../utils/enrollmentStatus.js';

const STUDENT_EMAIL = 'eumarck.sabino@gmail.com';
const STUDENT_ID = 333;
const PROFILE_ID = 154;
const CLASS_ID = 69;
const REPAIR_NOTE = 'Ops repair 2026-07-10 — Matthew Sabino phase 2–4 issue/due dates; phase 3 dropped';

const PHASE_TARGETS = {
  901: { absolute_phase: 2, issue_date: '2026-04-25', due_date: '2026-05-05' },
  1738: { absolute_phase: 3, issue_date: '2026-05-25', due_date: '2026-06-05' },
  1815: { absolute_phase: 4, issue_date: '2026-06-25', due_date: '2026-07-05' },
};

const PHASE_3 = 3;
const isApply = process.argv.includes('--apply');

const ymd = (value) => (value == null ? '' : String(value).slice(0, 10));

async function dropPhaseEnrollment(client, { studentId, classId, phase }) {
  const active = (
    await client.query(
      `SELECT classstudent_id, program_enrollment_status
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2 AND phase_number = $3
         AND removed_at IS NULL
         AND program_enrollment_status <> $4
       ORDER BY classstudent_id DESC
       LIMIT 1`,
      [studentId, classId, phase, PROGRAM_ENROLLMENT_STATUS.DROPPED]
    )
  ).rows[0];

  if (active) {
    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = $1,
           removed_at = CURRENT_TIMESTAMP,
           removed_reason = $2,
           removed_by = $3
       WHERE classstudent_id = $4`,
      [PROGRAM_ENROLLMENT_STATUS.DROPPED, REPAIR_NOTE, 'System (Ops repair)', active.classstudent_id]
    );
    return { action: 'updated', classstudent_id: active.classstudent_id, from: active.program_enrollment_status };
  }

  const dropped = (
    await client.query(
      `SELECT classstudent_id FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2 AND phase_number = $3
         AND program_enrollment_status = $4
       LIMIT 1`,
      [studentId, classId, phase, PROGRAM_ENROLLMENT_STATUS.DROPPED]
    )
  ).rows[0];

  if (dropped) {
    return { action: 'already_dropped', classstudent_id: dropped.classstudent_id };
  }

  const insert = await client.query(
    `INSERT INTO classstudentstbl (
       student_id, class_id, enrolled_by, phase_number,
       program_enrollment_status, enrolled_at, removed_at, removed_reason, removed_by
     )
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP - INTERVAL '1 second', CURRENT_TIMESTAMP, $6, $7)
     RETURNING classstudent_id`,
    [
      studentId,
      classId,
      'System (Ops repair)',
      phase,
      PROGRAM_ENROLLMENT_STATUS.DROPPED,
      REPAIR_NOTE,
      'System (Ops repair)',
    ]
  );
  return { action: 'inserted', classstudent_id: insert.rows[0]?.classstudent_id };
}

async function main() {
  console.log(
    `\nMatthew Sabino — installment issue/due date repair${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );

  const client = await getClient();
  const changes = [];

  try {
    const student = (
      await client.query(
        `SELECT user_id, full_name, email FROM userstbl
         WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))`,
        [STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student || Number(student.user_id) !== STUDENT_ID) {
      throw new Error(`Student ${STUDENT_EMAIL} not found`);
    }

    const profile = (
      await client.query(`SELECT * FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`, [
        PROFILE_ID,
      ])
    ).rows[0];
    if (!profile || Number(profile.student_id) !== STUDENT_ID) {
      throw new Error(`Profile ${PROFILE_ID} not found`);
    }

    const enrollments = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status, removed_at::text
         FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2
         ORDER BY phase_number, classstudent_id`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows;

    console.log('Student:', student.full_name);
    console.log('Profile:', {
      id: PROFILE_ID,
      generated_count: profile.generated_count,
      class_id: profile.class_id,
    });
    console.log('Enrollments:', enrollments);

    for (const [invoiceIdStr, target] of Object.entries(PHASE_TARGETS)) {
      const invoiceId = Number(invoiceIdStr);
      const inv = (
        await client.query(
          `SELECT invoice_id, status, remarks,
                  issue_date::text AS issue_date,
                  due_date::text AS due_date,
                  installmentinvoiceprofiles_id
           FROM invoicestbl WHERE invoice_id = $1`,
          [invoiceId]
        )
      ).rows[0];

      if (!inv) throw new Error(`Invoice ${invoiceId} not found`);
      if (Number(inv.installmentinvoiceprofiles_id) !== PROFILE_ID) {
        throw new Error(`Invoice ${invoiceId} not on profile ${PROFILE_ID}`);
      }

      const curIssue = ymd(inv.issue_date);
      const curDue = ymd(inv.due_date);
      const curTp = parseTargetPhase(inv.remarks);
      const nextRemarks =
        curTp === target.absolute_phase
          ? inv.remarks
          : rewriteTargetPhaseInRemarks(inv.remarks, target.absolute_phase);

      const dateChange = curIssue !== target.issue_date || curDue !== target.due_date;
      const remarkChange = nextRemarks !== inv.remarks;

      if (dateChange || remarkChange) {
        changes.push({
          invoice_id: invoiceId,
          phase: target.absolute_phase,
          status: inv.status,
          from_issue: curIssue,
          from_due: curDue,
          to_issue: target.issue_date,
          to_due: target.due_date,
          target_phase: `${curTp ?? '—'} → ${target.absolute_phase}`,
        });
      }
    }

    const phase3Enroll = enrollments.find(
      (e) => Number(e.phase_number) === PHASE_3 && e.program_enrollment_status !== PROGRAM_ENROLLMENT_STATUS.DROPPED
    );
    const phase3Dropped = enrollments.find(
      (e) => Number(e.phase_number) === PHASE_3 && e.program_enrollment_status === PROGRAM_ENROLLMENT_STATUS.DROPPED
    );

    console.log('\nPhase 3 enrollment action:', phase3Dropped
      ? `already dropped (classstudent_id ${phase3Dropped.classstudent_id})`
      : phase3Enroll
        ? `drop classstudent_id ${phase3Enroll.classstudent_id} (${phase3Enroll.program_enrollment_status})`
        : 'insert dropped marker row');

    if (!changes.length && phase3Dropped) {
      console.log('\nNo invoice date changes needed — dates already match targets.');
    } else if (changes.length) {
      console.log('\nPlanned invoice changes:');
      console.table(changes);
    }

    const sched = await buildPhaseInstallmentSchedule({
      db: client,
      profile: {
        installmentinvoiceprofiles_id: profile.installmentinvoiceprofiles_id,
        class_id: profile.class_id,
        phase_start: profile.phase_start,
        total_phases: profile.total_phases,
        generated_count: profile.generated_count,
      },
      generatedCountOverride: parseInt(profile.generated_count || 0, 10),
    });

    const ii = (
      await client.query(`SELECT * FROM installmentinvoicestbl WHERE installmentinvoiceprofiles_id = $1`, [
        PROFILE_ID,
      ])
    ).rows[0];

    const expectedGen = sched?.current_generation_date;
    const expectedMonth = sched?.current_invoice_month;
    const storedGen = coerceToManilaYmd(ii?.next_generation_date);
    const storedMonth = coerceToManilaYmd(ii?.next_invoice_month);

    console.log('\nInstallment invoice queue:');
    console.table([
      {
        stored_next_gen: storedGen,
        stored_next_month: storedMonth,
        schedule_next_gen: expectedGen,
        schedule_next_month: expectedMonth,
        needs_queue_sync: storedGen !== expectedGen || storedMonth !== expectedMonth,
      },
    ]);

    if (!isApply) {
      console.log('\nRe-run with --apply to write changes.');
      return;
    }

    await client.query('BEGIN');

    for (const [invoiceIdStr, target] of Object.entries(PHASE_TARGETS)) {
      const invoiceId = Number(invoiceIdStr);
      const inv = (
        await client.query(`SELECT * FROM invoicestbl WHERE invoice_id = $1`, [invoiceId])
      ).rows[0];
      const curTp = parseTargetPhase(inv.remarks);
      const nextRemarks =
        curTp === target.absolute_phase
          ? inv.remarks
          : rewriteTargetPhaseInRemarks(inv.remarks, target.absolute_phase);

      await client.query(
        `UPDATE invoicestbl
         SET issue_date = $1::date,
             due_date = $2::date,
             remarks = $3,
             late_penalty_applied_for_due_date = NULL
         WHERE invoice_id = $4`,
        [target.issue_date, target.due_date, nextRemarks, invoiceId]
      );

      await client.query(
        `DELETE FROM invoiceitemstbl
         WHERE invoice_id = $1 AND COALESCE(penalty_amount, 0) > 0`,
        [invoiceId]
      );

      await syncProgramPaymentStatusForInvoice(client, invoiceId);
    }

    const dropResult = await dropPhaseEnrollment(client, {
      studentId: STUDENT_ID,
      classId: CLASS_ID,
      phase: PHASE_3,
    });
    console.log('✅ Phase 3 enrollment:', dropResult);

    if (ii && expectedGen && expectedMonth && (storedGen !== expectedGen || storedMonth !== expectedMonth)) {
      await client.query(
        `UPDATE installmentinvoicestbl
         SET status = NULL, next_generation_date = $1, next_invoice_month = $2
         WHERE installmentinvoicedtl_id = $3`,
        [expectedGen, expectedMonth, ii.installmentinvoicedtl_id]
      );
      console.log(`✅ Queue synced → ${expectedGen} / ${expectedMonth}`);
    }

    await client.query('COMMIT');

    const verify = (
      await client.query(
        `SELECT invoice_id, status, remarks,
                TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue,
                TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due
         FROM invoicestbl
         WHERE installmentinvoiceprofiles_id = $1
           AND invoice_id <> $2
         ORDER BY invoice_id`,
        [PROFILE_ID, profile.downpayment_invoice_id]
      )
    ).rows;

    const enrollAfter = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status, removed_at::text
         FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2 AND phase_number IN (2, 3, 4)
         ORDER BY phase_number, classstudent_id`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows;

    console.log('\nAfter repair — invoices:');
    console.table(
      verify.map((r) => ({
        invoice_id: r.invoice_id,
        target_phase: parseTargetPhase(r.remarks),
        issue: r.issue,
        due: r.due,
        status: r.status,
      }))
    );
    console.log('\nAfter repair — enrollments (phases 2–4):');
    console.table(enrollAfter);

    console.log('\n✅ Done. Refresh Student History → Invoices for Matthew R. Sabino.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nFailed:', err.message || err);
    process.exit(1);
  });
