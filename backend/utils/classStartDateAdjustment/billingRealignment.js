/**
 * Billing realignment after class start date / session schedule changes.
 *
 * @module utils/classStartDateAdjustment/billingRealignment
 */

import { parseTargetPhase } from '../balanceInvoice.js';
import {
  buildPhaseInstallmentSchedule,
  isPhaseInstallmentProfile,
} from '../phaseInstallmentUtils.js';
import { formatYmdLocal, parseYmdToLocalNoon, todayYmdManila } from '../dateUtils.js';
import { syncProgramPaymentStatusForInvoice } from '../programPaymentStatusService.js';

export const PHASE_DUE_DAYS_BEFORE = 1;
const DOWNPAYMENT_DUE_DAYS = 7;

const ymd = (value) => (value == null ? '' : String(value).slice(0, 10));

/** PostgreSQL date bind param — never pass empty string to ::date casts. */
export const dateParam = (value) => {
  const normalized = ymd(value);
  return normalized || null;
};

export const addDaysYmd = (dateYmd, deltaDays) => {
  const d = parseYmdToLocalNoon(ymd(dateYmd));
  if (!d) return null;
  d.setDate(d.getDate() + deltaDays);
  return formatYmdLocal(d);
};

export const computePhaseDueFromStart = (phaseStartYmd) =>
  phaseStartYmd ? addDaysYmd(phaseStartYmd, -PHASE_DUE_DAYS_BEFORE) : null;

export const isSettledInvoiceStatus = (status) =>
  status === 'Paid' || status === 'Partially Paid';

export function resolveIssueDateAfterDueAlign(issueYmd, dueYmd) {
  const issue = ymd(issueYmd);
  const due = ymd(dueYmd);
  if (!due) return issue || todayYmdManila();
  if (!issue || issue > due) {
    return due;
  }
  return issue;
}

/**
 * Count of generated phase invoices still on the profile after realignment.
 * Uses invoice count (not max phase number) so mid-package enrollments stay correct.
 *
 * @param {object[]} phaseInvoices
 * @param {number[]} deleteInvoiceIds
 */
export function resolveTargetGeneratedCount(phaseInvoices, deleteInvoiceIds = []) {
  const remaining = phaseInvoices.filter(
    (inv) => inv.phase != null && !deleteInvoiceIds.includes(inv.invoice_id)
  );
  return remaining.length;
}

/**
 * @param {object} profile
 * @param {object[]} phaseInvoices
 * @param {object|null} enrollment
 * @param {Record<number, string>} phaseStartDateMap
 */
export function planProfileBillingRealignment(
  profile,
  phaseInvoices,
  enrollment,
  phaseStartDateMap
) {
  const changes = [];
  const deleteInvoiceIds = [];

  const phase1Invoices = phaseInvoices.filter((inv) => inv.phase === 1);
  const phase2Plus = phaseInvoices.filter((inv) => inv.phase != null && inv.phase >= 2);

  for (const inv of phase1Invoices) {
    if (isSettledInvoiceStatus(inv.status)) continue;
    const newDue = computePhaseDueFromStart(phaseStartDateMap[1]);
    if (!newDue) {
      changes.push({
        type: 'warning',
        code: 'missing_phase1_session',
        invoice_id: inv.invoice_id,
        message: 'Cannot compute new due date for phase 1 (no sessions).',
      });
      continue;
    }
    const newIssue = resolveIssueDateAfterDueAlign(inv.issue_ymd, newDue);
    const needDue = ymd(inv.due_ymd) !== newDue;
    const needIssue = ymd(inv.issue_ymd) !== newIssue;
    if (needDue || needIssue) {
      changes.push({
        type: 'update_phase_invoice',
        invoice_id: inv.invoice_id,
        invoice_ar_number: inv.invoice_ar_number,
        phase: 1,
        status: inv.status,
        old_issue_date: ymd(inv.issue_ymd),
        new_issue_date: newIssue,
        old_due_date: ymd(inv.due_ymd),
        new_due_date: newDue,
        clear_penalty: true,
      });
    }
  }

  for (const inv of phase2Plus) {
    if (isSettledInvoiceStatus(inv.status)) continue;

    const phaseStart = phaseStartDateMap[inv.phase];
    const newDue = phaseStart ? computePhaseDueFromStart(phaseStart) : null;
    if (!newDue) {
      changes.push({
        type: 'warning',
        code: 'missing_phase_session',
        invoice_id: inv.invoice_id,
        phase: inv.phase,
        message: `Cannot compute new due date for phase ${inv.phase} (no sessions).`,
      });
      continue;
    }

    const newIssue = resolveIssueDateAfterDueAlign(inv.issue_ymd, newDue);
    const needDue = ymd(inv.due_ymd) !== newDue;
    const needIssue = ymd(inv.issue_ymd) !== newIssue;
    if (needDue || needIssue) {
      changes.push({
        type: 'update_phase_invoice',
        invoice_id: inv.invoice_id,
        invoice_ar_number: inv.invoice_ar_number,
        phase: inv.phase,
        status: inv.status,
        old_issue_date: ymd(inv.issue_ymd),
        new_issue_date: newIssue,
        old_due_date: ymd(inv.due_ymd),
        new_due_date: newDue,
        clear_penalty: true,
      });
    }
  }

  const targetGeneratedCount = resolveTargetGeneratedCount(phaseInvoices, deleteInvoiceIds);

  if (targetGeneratedCount > 0 && Number(profile.generated_count) !== targetGeneratedCount) {
    changes.push({
      type: 'set_generated_count',
      old_value: Number(profile.generated_count) || 0,
      new_value: targetGeneratedCount,
    });
  }

  const hasUnpaidPhase1 = phase1Invoices.some(
    (inv) => !isSettledInvoiceStatus(inv.status) && !deleteInvoiceIds.includes(inv.invoice_id)
  );
  const phase1Paid = phase1Invoices.some((inv) => isSettledInvoiceStatus(inv.status));

  if (
    enrollment &&
    enrollment.program_enrollment_status === 'dropped' &&
    String(enrollment.removed_reason || '').toLowerCase().includes('delinquency')
  ) {
    changes.push({
      type: 'restore_enrollment',
      classstudent_id: enrollment.classstudent_id,
      student_id: profile.student_id,
      new_status: phase1Paid ? 'new' : 'pending_enrollment',
      removed_reason: enrollment.removed_reason,
    });
  }

  if (!profile.is_active && (hasUnpaidPhase1 || targetGeneratedCount < (profile.total_phases || 99))) {
    changes.push({
      type: 'reactivate_profile',
      profile_id: profile.installmentinvoiceprofiles_id,
    });
  }

  return {
    profile_id: profile.installmentinvoiceprofiles_id,
    student_id: profile.student_id,
    student_name: profile.full_name,
    student_email: profile.email,
    changes,
    deleteInvoiceIds,
    targetGeneratedCount,
  };
}

/**
 * @param {import('pg').PoolClient} client
 * @param {number} classId
 * @param {Record<number, string>} phaseStartDateMap
 * @param {{ completedWithAttendance?: number }} [options]
 */
export async function loadBillingProfilesForClass(client, classId) {
  const res = await client.query(
    `SELECT ip.*,
            u.full_name,
            u.email,
            TO_CHAR(TIMEZONE('Asia/Manila', ii.next_generation_date), 'YYYY-MM-DD') AS next_gen,
            TO_CHAR(TIMEZONE('Asia/Manila', ii.next_invoice_month), 'YYYY-MM-DD') AS next_month,
            TO_CHAR(TIMEZONE('Asia/Manila', ip.bill_invoice_due_date), 'YYYY-MM-DD') AS bill_due,
            TO_CHAR(TIMEZONE('Asia/Manila', ip.next_invoice_due_date), 'YYYY-MM-DD') AS next_bill_due,
            ii.installmentinvoicedtl_id
     FROM installmentinvoiceprofilestbl ip
     INNER JOIN userstbl u ON u.user_id = ip.student_id
     LEFT JOIN LATERAL (
       SELECT installmentinvoicedtl_id, next_generation_date, next_invoice_month
       FROM installmentinvoicestbl
       WHERE installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
         AND COALESCE(status, '') != 'Generated'
       ORDER BY installmentinvoicedtl_id DESC
       LIMIT 1
     ) ii ON true
     WHERE ip.class_id = $1
     ORDER BY u.full_name, ip.installmentinvoiceprofiles_id`,
    [classId]
  );
  return res.rows;
}

/**
 * @param {import('pg').PoolClient} client
 * @param {number} profileId
 * @param {object} [profile]
 */
export function resolveInvoicePhaseForRealignment(row, profile = {}, index = 0) {
  const explicit = parseTargetPhase(row.remarks);
  if (explicit != null && Number.isFinite(explicit)) {
    return explicit;
  }

  const phaseStartRaw = profile.phase_start != null ? parseInt(profile.phase_start, 10) : 1;
  const phaseStart = Number.isFinite(phaseStartRaw) && phaseStartRaw > 0 ? phaseStartRaw : 1;
  const generatedCount = parseInt(profile.generated_count || 0, 10) || 0;

  const remarks = String(row.remarks || '');
  const phaseStartMatch = remarks.match(/PHASE_START:(\d+)/i);
  if (phaseStartMatch && index === 0 && generatedCount >= 1) {
    const fromRemarks = parseInt(phaseStartMatch[1], 10);
    if (Number.isFinite(fromRemarks) && fromRemarks > 0) {
      return fromRemarks;
    }
  }

  if (generatedCount >= 1 && index < generatedCount) {
    return phaseStart + index;
  }

  return null;
}

export async function loadPhaseInvoicesForProfile(client, profileId, profile = {}) {
  const res = await client.query(
    `SELECT i.invoice_id, i.status, i.invoice_ar_number, i.remarks, i.invoice_description,
            TO_CHAR(TIMEZONE('Asia/Manila', i.issue_date), 'YYYY-MM-DD') AS issue_ymd,
            TO_CHAR(TIMEZONE('Asia/Manila', i.due_date), 'YYYY-MM-DD') AS due_ymd
     FROM invoicestbl i
     LEFT JOIN installmentinvoiceprofilestbl ip
       ON ip.installmentinvoiceprofiles_id = i.installmentinvoiceprofiles_id
     WHERE i.installmentinvoiceprofiles_id = $1
       AND i.invoice_id IS DISTINCT FROM ip.downpayment_invoice_id
       AND COALESCE(i.invoice_description, '') NOT ILIKE '%downpayment%'
       AND COALESCE(i.remarks, '') NOT ILIKE '%downpayment%'
     ORDER BY i.invoice_id`,
    [profileId]
  );

  return res.rows
    .map((row, index) => {
      const phase = resolveInvoicePhaseForRealignment(row, profile, index);
      return phase == null ? null : { ...row, phase };
    })
    .filter(Boolean);
}

/**
 * @param {import('pg').PoolClient} client
 * @param {number} studentId
 * @param {number} classId
 */
export async function loadPhase1Enrollment(client, studentId, classId) {
  const res = await client.query(
    `SELECT classstudent_id, program_enrollment_status, removed_reason, phase_number
     FROM classstudentstbl
     WHERE student_id = $1 AND class_id = $2 AND COALESCE(phase_number, 1) = 1
     ORDER BY classstudent_id
     LIMIT 1`,
    [studentId, classId]
  );
  return res.rows[0] || null;
}

/**
 * @param {import('pg').PoolClient} client
 * @param {number} profileId
 */
export async function loadDownpaymentInvoice(client, profileId) {
  const res = await client.query(
    `SELECT i.invoice_id, i.status,
            TO_CHAR(TIMEZONE('Asia/Manila', i.issue_date), 'YYYY-MM-DD') AS issue_ymd,
            TO_CHAR(TIMEZONE('Asia/Manila', i.due_date), 'YYYY-MM-DD') AS due_ymd,
            ip.student_id,
            ip.class_id
     FROM installmentinvoiceprofilestbl ip
     INNER JOIN invoicestbl i ON i.invoice_id = ip.downpayment_invoice_id
     WHERE ip.installmentinvoiceprofiles_id = $1
       AND ip.downpayment_invoice_id IS NOT NULL`,
    [profileId]
  );
  return res.rows[0] || null;
}

export function planDownpaymentRealignment(downpaymentInvoice, enrollmentDateYmd) {
  if (!downpaymentInvoice || isSettledInvoiceStatus(downpaymentInvoice.status)) {
    return null;
  }
  const baseYmd = ymd(enrollmentDateYmd) || ymd(downpaymentInvoice.issue_ymd);
  const newDue = addDaysYmd(baseYmd, DOWNPAYMENT_DUE_DAYS);
  if (!newDue || ymd(downpaymentInvoice.due_ymd) === newDue) {
    return null;
  }
  return {
    type: 'update_downpayment',
    invoice_id: downpaymentInvoice.invoice_id,
    old_due_date: ymd(downpaymentInvoice.due_ymd),
    new_due_date: newDue,
    clear_penalty: true,
  };
}

/**
 * @param {import('pg').PoolClient} client
 * @param {number} classId
 * @param {object} profile
 * @param {object} profilePlan
 * @param {Record<number, string>} phaseStartDateMap
 * @param {{ previewMode?: boolean }} [options]
 */
export async function planQueueRealignmentForProfile(
  client,
  classId,
  profile,
  profilePlan,
  phaseStartDateMap,
  options = {}
) {
  try {
    const generatedCount = profilePlan.targetGeneratedCount ?? profile.generated_count ?? 0;
    const schedule = await buildPhaseInstallmentSchedule({
      db: client,
      profile: {
        class_id: classId,
        phase_start: profile.phase_start,
        total_phases: profile.total_phases,
        generated_count: generatedCount,
      },
      generatedCountOverride: generatedCount,
      phaseStartDateMapOverride: phaseStartDateMap,
      ignoreStoredQueueAnchor: true,
    });

    if (!schedule || schedule.is_last_phase) {
      return null;
    }

    const nextGen = ymd(schedule.current_generation_date);
    const nextMonth = ymd(schedule.current_invoice_month);
    const billDue = ymd(schedule.current_due_date);
    const nextBillDue = ymd(schedule.next_due_date);
    const changed =
      ymd(profile.next_gen) !== nextGen ||
      ymd(profile.next_month) !== nextMonth ||
      ymd(profile.bill_due) !== billDue ||
      ymd(profile.next_bill_due) !== nextBillDue;

    if (!options.previewMode && !changed) {
      return null;
    }

    return {
      type: 'rebuild_queue',
      installmentinvoicedtl_id: profile.installmentinvoicedtl_id,
      old_next_generation_date: ymd(profile.next_gen),
      new_next_generation_date: nextGen,
      old_next_invoice_month: ymd(profile.next_month),
      new_next_invoice_month: nextMonth,
      bill_invoice_due_date: billDue,
      next_invoice_due_date: nextBillDue,
      scheduled_date: billDue,
      current_phase_number: schedule.current_phase_number,
      next_phase_number: schedule.next_phase_number,
      changed,
    };
  } catch (queueErr) {
    return {
      type: 'warning',
      code: 'queue_rebuild_failed',
      message: queueErr.message,
    };
  }
}

/**
 * @param {import('pg').PoolClient} client
 * @param {number} classId
 * @param {Record<number, string>} phaseStartDateMap
 * @param {{ previewMode?: boolean }} [options]
 */
export async function planBillingRealignmentForClass(client, classId, phaseStartDateMap, options = {}) {
  const profiles = await loadBillingProfilesForClass(client, classId);
  const impacts = [];

  for (const profile of profiles) {
    if (!isPhaseInstallmentProfile(profile)) {
      impacts.push({
        profile_id: profile.installmentinvoiceprofiles_id,
        student_id: profile.student_id,
        student_name: profile.full_name,
        skipped: true,
        reason: 'Not a phase-installment profile',
        changes: [],
      });
      continue;
    }

    const phaseInvoices = await loadPhaseInvoicesForProfile(
      client,
      profile.installmentinvoiceprofiles_id,
      profile
    );
    const enrollment = await loadPhase1Enrollment(client, profile.student_id, classId);
    const downpayment = await loadDownpaymentInvoice(client, profile.installmentinvoiceprofiles_id);

    const enrollRes = await client.query(
      `SELECT MIN(enrolled_at::date)::text AS d
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2
         AND program_enrollment_status <> 'dropped'
         AND removed_at IS NULL`,
      [profile.student_id, classId]
    );
    const enrollmentDateYmd = enrollRes.rows[0]?.d;

    const changes = [];
    const dpChange = planDownpaymentRealignment(downpayment, enrollmentDateYmd);
    if (dpChange) changes.push(dpChange);

    const profilePlan = planProfileBillingRealignment(
      profile,
      phaseInvoices,
      enrollment,
      phaseStartDateMap
    );
    changes.push(...profilePlan.changes);

    const queueChange = await planQueueRealignmentForProfile(
      client,
      classId,
      profile,
      profilePlan,
      phaseStartDateMap,
      options
    );
    if (queueChange) {
      changes.push(queueChange);
    }

    impacts.push({
      ...profilePlan,
      changes,
      deleteInvoiceIds: profilePlan.deleteInvoiceIds,
      queueChange,
    });
  }

  return impacts;
}

/**
 * @param {import('pg').PoolClient} client
 * @param {number} invoiceId
 */
export async function clearInvoicePenalty(client, invoiceId) {
  const items = await client.query(
    `SELECT invoice_item_id, penalty_amount, amount
     FROM invoiceitemstbl
     WHERE invoice_id = $1 AND COALESCE(penalty_amount, 0) > 0`,
    [invoiceId]
  );

  for (const item of items.rows) {
    const penalty = Number(item.penalty_amount) || 0;
    const amount = Number(item.amount) || 0;
    await client.query(
      `UPDATE invoiceitemstbl
       SET amount = $1, penalty_amount = 0
       WHERE invoice_item_id = $2`,
      [Math.max(0, amount - penalty), item.invoice_item_id]
    );
  }

  if (items.rows.length) {
    const totals = await client.query(
      `SELECT COALESCE(SUM(amount), 0)
              - COALESCE(SUM(COALESCE(discount_amount, 0)), 0)
              + COALESCE(SUM(COALESCE(penalty_amount, 0)), 0) AS grand
       FROM invoiceitemstbl WHERE invoice_id = $1`,
      [invoiceId]
    );
    await client.query(
      `UPDATE invoicestbl
       SET amount = $1, late_penalty_applied_for_due_date = NULL
       WHERE invoice_id = $2`,
      [Number(totals.rows[0]?.grand || 0), invoiceId]
    );
  }

  return items.rows.length > 0;
}

/**
 * @param {import('pg').PoolClient} client
 * @param {number} invoiceId
 */
async function deleteInvoiceCascade(client, invoiceId) {
  const payments = await client.query(
    `SELECT payment_id FROM paymenttbl WHERE invoice_id = $1`,
    [invoiceId]
  );
  if (payments.rows.length) {
    throw new Error(`Invoice ${invoiceId} has payments; cannot delete`);
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

/**
 * @param {import('pg').PoolClient} client
 * @param {object[]} billingImpacts
 * @param {number|null} adjustmentId
 */
export async function applyBillingRealignment(client, billingImpacts, adjustmentId = null) {
  const summary = {
    invoices_updated: 0,
    invoices_deleted: 0,
    penalties_cleared: 0,
    profiles_updated: 0,
    enrollments_restored: 0,
    profiles_reactivated: 0,
  };

  const remarkSuffix = adjustmentId ? ` START_DATE_ADJUSTMENT:${adjustmentId}` : '';

  for (const impact of billingImpacts) {
    if (impact.skipped) continue;

    for (const change of impact.changes || []) {
      if (change.type === 'update_phase_invoice' || change.type === 'update_downpayment') {
        const newDueDate = dateParam(change.new_due_date);
        if (!newDueDate) continue;

        await client.query(
          `UPDATE invoicestbl
           SET issue_date = COALESCE($1::date, issue_date),
               due_date = $2::date,
               remarks = CASE
                 WHEN remarks IS NULL OR remarks = '' THEN $3
                 WHEN remarks LIKE '%START_DATE_ADJUSTMENT:%' THEN remarks
                 ELSE remarks || $3
               END
           WHERE invoice_id = $4`,
          [dateParam(change.new_issue_date), newDueDate, remarkSuffix.trim(), change.invoice_id]
        );
        if (change.clear_penalty) {
          const cleared = await clearInvoicePenalty(client, change.invoice_id);
          if (cleared) summary.penalties_cleared += 1;
        }
        await syncProgramPaymentStatusForInvoice(client, change.invoice_id);
        summary.invoices_updated += 1;
      }

      if (change.type === 'set_generated_count') {
        await client.query(
          `UPDATE installmentinvoiceprofilestbl
           SET generated_count = $1
           WHERE installmentinvoiceprofiles_id = $2`,
          [change.new_value, impact.profile_id]
        );
        summary.profiles_updated += 1;
      }

      if (change.type === 'rebuild_queue') {
        const billDueDate = dateParam(change.bill_invoice_due_date);
        const nextBillDueDate = dateParam(change.next_invoice_due_date);
        const nextInvoiceMonth = dateParam(change.new_next_invoice_month);
        const nextGenerationDate = dateParam(change.new_next_generation_date);
        const scheduledDate = dateParam(change.scheduled_date);

        if (!billDueDate && !nextBillDueDate && !nextInvoiceMonth && !nextGenerationDate) {
          continue;
        }

        await client.query(
          `UPDATE installmentinvoiceprofilestbl
           SET bill_invoice_due_date = COALESCE($1::date, bill_invoice_due_date),
               next_invoice_due_date = COALESCE($2::date, next_invoice_due_date),
               first_billing_month = COALESCE($3::date, first_billing_month),
               first_generation_date = COALESCE($4::date, first_generation_date)
           WHERE installmentinvoiceprofiles_id = $5`,
          [
            billDueDate,
            nextBillDueDate,
            nextInvoiceMonth,
            nextGenerationDate,
            impact.profile_id,
          ]
        );
        if (change.installmentinvoicedtl_id && (scheduledDate || nextGenerationDate || nextInvoiceMonth)) {
          await client.query(
            `UPDATE installmentinvoicestbl
             SET scheduled_date = COALESCE($1::date, scheduled_date),
                 next_generation_date = COALESCE($2::date, next_generation_date),
                 next_invoice_month = COALESCE($3::date, next_invoice_month)
             WHERE installmentinvoicedtl_id = $4`,
            [
              scheduledDate,
              nextGenerationDate,
              nextInvoiceMonth,
              change.installmentinvoicedtl_id,
            ]
          );
        }
        summary.profiles_updated += 1;
      }

      if (change.type === 'restore_enrollment') {
        await client.query(
          `UPDATE classstudentstbl
           SET program_enrollment_status = $1,
               removed_at = NULL,
               removed_reason = NULL,
               removed_by = NULL
           WHERE classstudent_id = $2`,
          [change.new_status, change.classstudent_id]
        );
        summary.enrollments_restored += 1;
      }

      if (change.type === 'reactivate_profile') {
        await client.query(
          `UPDATE installmentinvoiceprofilestbl
           SET is_active = true
           WHERE installmentinvoiceprofiles_id = $1`,
          [change.profile_id || impact.profile_id]
        );
        summary.profiles_reactivated += 1;
      }
    }

    for (const invoiceId of impact.deleteInvoiceIds || []) {
      await deleteInvoiceCascade(client, invoiceId);
      summary.invoices_deleted += 1;
    }
  }

  return summary;
}
