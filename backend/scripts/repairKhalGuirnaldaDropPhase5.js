/**
 * Khal Guirnalda — drop Phase 5 (manual ops / early delinquency drop).
 *
 * Student: 562 · khal.guirnalda@gmail.com
 * Profile: 457 · class 89 VMM_Playgroup_TTh 9:30 AM
 * Phase 5: INV-2154 · AR 261819 · due 2026-08-05 · Unpaid/Overdue
 *
 * Auto delinquency threshold (due + 30d) is Sep 4, 2026 — not reached yet on Sep 2.
 * Ops manual drop inserts Phase 5 dropped marker and deactivates profile.
 * Does not delete Phase 6+ invoices (INV-2587 remains).
 *
 * Run:
 *   node backend/scripts/repairKhalGuirnaldaDropPhase5.js --production
 *   node backend/scripts/repairKhalGuirnaldaDropPhase5.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { getChainRootInvoiceId, parseTargetPhase } from '../utils/balanceInvoice.js';
import {
  applyDelinquencyDropForAbsolutePhase,
  evaluateDelinquencyDropForChain,
} from '../utils/installmentDelinquencyDrop.js';
import { deactivateInstallmentProfileForClassDrop } from '../utils/billingNotificationEligibility.js';
import { PROGRAM_ENROLLMENT_STATUS } from '../utils/enrollmentStatus.js';

const STUDENT_ID = 562;
const STUDENT_EMAIL = 'khal.guirnalda@gmail.com';
const PROFILE_ID = 457;
const CLASS_ID = 89;
const CLASS_NAME = 'VMM_Playgroup_TTh 9:30 AM';
const PHASE5_INVOICE_ID = 2154;
const ABSOLUTE_PHASE = 5;

const REPAIR_NOTE = 'Ops repair 2026-09-02 — Khal Guirnalda manual Phase 5 delinquency drop';

const isApply = process.argv.includes('--apply');

async function applyOpsPhaseDrop(client, { studentId, classId, absolutePhase }) {
  const active = (
    await client.query(
      `SELECT classstudent_id, program_enrollment_status
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2 AND phase_number = $3
         AND removed_at IS NULL
         AND program_enrollment_status <> $4
       ORDER BY classstudent_id DESC
       LIMIT 1`,
      [studentId, classId, absolutePhase, PROGRAM_ENROLLMENT_STATUS.DROPPED]
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
    return { action: 'updated', classstudent_id: active.classstudent_id };
  }

  const dropped = (
    await client.query(
      `SELECT classstudent_id FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2 AND phase_number = $3
         AND program_enrollment_status = $4
       LIMIT 1`,
      [studentId, classId, absolutePhase, PROGRAM_ENROLLMENT_STATUS.DROPPED]
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
      absolutePhase,
      PROGRAM_ENROLLMENT_STATUS.DROPPED,
      REPAIR_NOTE,
      'System (Ops repair)',
    ]
  );
  return { action: 'inserted', classstudent_id: insert.rows[0]?.classstudent_id };
}

async function loadState(client) {
  const student = (
    await client.query(
      `SELECT user_id, full_name, email FROM userstbl
       WHERE user_id = $1 AND LOWER(TRIM(email)) = LOWER(TRIM($2))`,
      [STUDENT_ID, STUDENT_EMAIL]
    )
  ).rows[0];

  const profile = (
    await client.query(
      `SELECT ip.installmentinvoiceprofiles_id, ip.student_id, ip.class_id, ip.branch_id,
              ip.phase_start, ip.total_phases, ip.generated_count, ip.is_active,
              c.class_name
       FROM installmentinvoiceprofilestbl ip
       LEFT JOIN classestbl c ON c.class_id = ip.class_id
       WHERE ip.installmentinvoiceprofiles_id = $1 AND ip.student_id = $2`,
      [PROFILE_ID, STUDENT_ID]
    )
  ).rows[0];

  const phase5Invoice = (
    await client.query(
      `SELECT invoice_id, status, amount, invoice_ar_number, remarks,
              installmentinvoiceprofiles_id AS profile_id,
              TO_CHAR(due_date, 'YYYY-MM-DD') AS due_date
       FROM invoicestbl WHERE invoice_id = $1`,
      [PHASE5_INVOICE_ID]
    )
  ).rows[0];

  const enrollments = (
    await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status,
              TO_CHAR(enrolled_at, 'YYYY-MM-DD') AS enrolled,
              TO_CHAR(removed_at, 'YYYY-MM-DD') AS removed,
              removed_reason
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2
       ORDER BY phase_number, classstudent_id`,
      [STUDENT_ID, CLASS_ID]
    )
  ).rows;

  return { student, profile, phase5Invoice, enrollments };
}

async function main() {
  console.log(
    `\nKhal Guirnalda — drop Phase 5 (INV-${PHASE5_INVOICE_ID})` +
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

    const before = await loadState(client);
    if (!before.student) throw new Error('Student not found or email mismatch');
    if (!before.profile) throw new Error(`Profile ${PROFILE_ID} not found`);
    if (Number(before.profile.class_id) !== CLASS_ID) {
      throw new Error(`Profile class_id ${before.profile.class_id} ≠ ${CLASS_ID}`);
    }
    if (before.profile.class_name !== CLASS_NAME) {
      throw new Error(`Class name mismatch: ${before.profile.class_name}`);
    }

    const inv = before.phase5Invoice;
    if (!inv || Number(inv.profile_id) !== PROFILE_ID) {
      throw new Error(`INV-${PHASE5_INVOICE_ID} not on profile ${PROFILE_ID}`);
    }
    const phase = parseTargetPhase(inv.remarks);
    if (phase !== ABSOLUTE_PHASE) {
      throw new Error(`INV-${PHASE5_INVOICE_ID} TARGET_PHASE ${phase}, expected ${ABSOLUTE_PHASE}`);
    }
    if (['Paid', 'Cancelled', 'Canceled'].includes(String(inv.status))) {
      throw new Error(`INV-${PHASE5_INVOICE_ID} status ${inv.status} — cannot drop paid/cancelled phase`);
    }

    const chainRootId = await getChainRootInvoiceId(client, PHASE5_INVOICE_ID);
    const evaluation = await evaluateDelinquencyDropForChain(client, {
      chainRootId,
      dueDate: inv.due_date,
      branchId: before.profile.branch_id,
    });

    console.log('Student:', before.student.full_name, `(id ${before.student.user_id})`);
    console.log('\nProfile BEFORE:', {
      phase_start: before.profile.phase_start,
      total_phases: before.profile.total_phases,
      generated_count: before.profile.generated_count,
      is_active: before.profile.is_active,
    });
    console.log('\nPhase 5 invoice BEFORE:', {
      invoice_id: inv.invoice_id,
      status: inv.status,
      amount: inv.amount,
      ar: inv.invoice_ar_number,
      due_date: inv.due_date,
    });
    console.log('\nDelinquency evaluation:', evaluation);
    console.log('\nBEFORE enrollments:');
    console.table(before.enrollments);

    const existingPhase5Drop = before.enrollments.some(
      (row) =>
        Number(row.phase_number) === ABSOLUTE_PHASE &&
        String(row.program_enrollment_status) === 'dropped'
    );
    if (existingPhase5Drop) {
      console.log('\nPhase 5 already has a dropped enrollment marker. Nothing to do.');
      await client.query('ROLLBACK');
      return;
    }

    console.log('\nPlanned:');
    if (evaluation.eligible) {
      console.log(`  • Standard delinquency drop for Phase ${ABSOLUTE_PHASE}`);
    } else {
      console.log(
        `  • Ops manual drop Phase ${ABSOLUTE_PHASE} (auto threshold: ${evaluation.reason})`
      );
    }
    console.log('  • Insert/update dropped enrollment marker');
    console.log('  • Deactivate installment profile');
    console.log('  • Keep INV-2154 unpaid; keep Phase 6 invoice INV-2587');

    let dropResult;
    if (evaluation.eligible) {
      const applied = await applyDelinquencyDropForAbsolutePhase(client, {
        studentId: STUDENT_ID,
        classId: CLASS_ID,
        absolutePhase: ABSOLUTE_PHASE,
        finalDropoffDays: evaluation.finalDropoffDays || 30,
        dueDateYmd: inv.due_date,
      });
      if (applied) {
        await deactivateInstallmentProfileForClassDrop(client, {
          studentId: STUDENT_ID,
          classId: CLASS_ID,
        });
      }
      dropResult = { applied, reason: applied ? 'delinquency' : 'already_dropped' };
    } else {
      const enrollmentResult = await applyOpsPhaseDrop(client, {
        studentId: STUDENT_ID,
        classId: CLASS_ID,
        absolutePhase: ABSOLUTE_PHASE,
      });
      if (enrollmentResult.action !== 'already_dropped') {
        await deactivateInstallmentProfileForClassDrop(client, {
          studentId: STUDENT_ID,
          classId: CLASS_ID,
        });
      }
      dropResult = {
        applied: enrollmentResult.action !== 'already_dropped',
        reason: 'ops_manual_drop',
        enrollment: enrollmentResult,
      };
    }

    if (!dropResult.applied) {
      throw new Error(`Drop not applied: ${dropResult.reason || 'unknown'}`);
    }

    console.log('\nDrop result:', dropResult);

    const after = await loadState(client);
    const phase5Rows = after.enrollments.filter((r) => Number(r.phase_number) === ABSOLUTE_PHASE);

    console.log('\nProfile AFTER:', {
      is_active: after.profile.is_active,
      generated_count: after.profile.generated_count,
    });
    console.log('\nPhase 5 enrollment AFTER:');
    console.table(phase5Rows);

    const hasDropped = phase5Rows.some((r) => String(r.program_enrollment_status) === 'dropped');
    if (!hasDropped) {
      throw new Error('Phase 5 dropped enrollment row not found after apply');
    }

    console.log('\nExpected UI:');
    console.log('  Phase 5 Enrollment → dropped');
    console.log('  Phase 5 invoice INV-2154 → remains Overdue/Unpaid');
    console.log('  Plan → Inactive until rejoin/payment');

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
