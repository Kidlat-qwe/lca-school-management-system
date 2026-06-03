import express from 'express';
import { body, param, query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole, requireBranchAccess } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query, getClient } from '../config/database.js';
import {
  sendSystemNotificationEmail,
  sendSystemNotificationEmailToEach,
  normalizeNotificationRecipients,
} from '../utils/emailService.js';
import { plainTextToEmailHtml } from '../utils/templateRenderService.js';
import { formatYmdLocal } from '../utils/dateUtils.js';
import {
  buildPhaseInstallmentSchedule,
  getPhaseDueDateYmd,
  isPhaseInstallmentProfile,
} from '../utils/phaseInstallmentUtils.js';
import { paymentLogApprovalFromArVerification } from '../lib/paymentLogArApproval.js';
import {
  PROGRAM_ENROLLMENT_STATUS,
  determineRejoinAwarePhaseStatus,
  ensurePendingEnrollmentAfterDownpaymentPaid,
  isRejoinClassInvoice,
  parseInstallmentProfileIdFromRemarks,
  parseRejoinPhaseFromRemarks,
  promotePendingEnrollmentIfPhaseInvoicePaid,
  removePendingEnrollmentPlaceholderForProfile,
  syncInstallmentProfileAfterRejoinPayment,
} from '../utils/enrollmentStatus.js';
import { paymenttblHasActionOwnerUserIdColumn } from '../utils/paymentSchema.js';
import { sendInvoicePaymentConfirmationByInvoiceId } from '../utils/paymentConfirmationEmailService.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';
import { tryIssuePackageMerchandiseOnFirstPayment } from '../lib/merchandiseReleaseLog.js';
import {
  computeOriginalInvoiceAmount,
  computeOriginalAfterDeletingPayment,
  computeInvoiceOriginalForRecalc,
  createBalanceInvoiceFromPartial,
  getCanonicalInstallmentPhaseCounts,
  getChainRootInvoiceId,
  removeUnusedBalanceInvoice,
} from '../utils/balanceInvoice.js';
import {
  deriveInvoiceStatusForInvoice,
  invoiceHasRejectedPayment,
} from '../utils/invoicePaymentStatus.js';
import { syncInstallmentEnrollmentForPaidInvoice } from '../utils/installmentEnrollmentSync.js';

const router = express.Router();

// Payment Logs / dashboard "payment date" uses paymenttbl.issue_date: the calendar date
// entered when recording payment (actual client-paid date), not when the row was created.
const PAYMENT_LOG_BUSINESS_DATE_SQL = `p.issue_date`;
const AR_PAYMENT_BUSINESS_DATE_SQL = `ar.issue_date`;

const getFullPaymentPhaseEnrollmentStatus = async ({ client, studentId, classId, phaseNumber, phaseStart }) => {
  const defaultStatus =
    Number(phaseNumber) === Number(phaseStart)
      ? PROGRAM_ENROLLMENT_STATUS.NEW
      : PROGRAM_ENROLLMENT_STATUS.RE_ENROLLED;

  return determineRejoinAwarePhaseStatus({
    db: client,
    studentId,
    classId,
    phaseNumber,
    defaultStatus,
  });
};

const enrollStudentForFullPaymentPhases = async ({
  client,
  studentId,
  classId,
  phaseStart,
  phaseEnd,
  sourceLabel,
}) => {
  let insertedOrReactivated = 0;
  for (let phase = phaseStart; phase <= phaseEnd; phase++) {
    const activePhase = await client.query(
      `SELECT classstudent_id
       FROM classstudentstbl
       WHERE student_id = $1
         AND class_id = $2
         AND phase_number = $3
         AND program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin')
         AND removed_at IS NULL
       LIMIT 1`,
      [studentId, classId, phase]
    );
    if (activePhase.rows.length > 0) continue;

    const defaultStatus =
      phase === phaseEnd && phaseEnd > phaseStart
        ? PROGRAM_ENROLLMENT_STATUS.COMPLETED
        : Number(phase) === Number(phaseStart)
          ? PROGRAM_ENROLLMENT_STATUS.NEW
          : PROGRAM_ENROLLMENT_STATUS.RE_ENROLLED;

    const fullPayStatus = await determineRejoinAwarePhaseStatus({
      db: client,
      studentId,
      classId,
      phaseNumber: phase,
      defaultStatus,
    });

    const droppedPhase = await client.query(
      `SELECT classstudent_id
       FROM classstudentstbl
       WHERE student_id = $1
         AND class_id = $2
         AND phase_number = $3
         AND program_enrollment_status = 'dropped'
       ORDER BY removed_at DESC NULLS LAST, classstudent_id DESC
       LIMIT 1`,
      [studentId, classId, phase]
    );

    if (droppedPhase.rows.length > 0) {
      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = $1,
             removed_at = NULL,
             removed_reason = NULL,
             removed_by = NULL,
             enrolled_by = $2,
             enrolled_at = CURRENT_TIMESTAMP
         WHERE classstudent_id = $3`,
        [fullPayStatus, sourceLabel, droppedPhase.rows[0].classstudent_id]
      );
    } else {
      await client.query(
        `INSERT INTO classstudentstbl (student_id, class_id, enrolled_by, phase_number, program_enrollment_status)
         VALUES ($1, $2, $3, $4, $5)`,
        [studentId, classId, sourceLabel, phase, fullPayStatus]
      );
    }

    insertedOrReactivated += 1;
  }

  return insertedOrReactivated;
};

/** After a rejoin class invoice is paid, sync installment billing to the rejoin phase (skip dropped gaps). */
const syncInstallmentProfileForRejoinInvoice = async ({ client, invoice, studentId }) => {
  if (!invoice?.remarks || !isRejoinClassInvoice(invoice.remarks)) return;

  const profileId =
    invoice.installmentinvoiceprofiles_id != null
      ? parseInt(invoice.installmentinvoiceprofiles_id, 10)
      : parseInstallmentProfileIdFromRemarks(invoice.remarks);
  const rejoinPhase = parseRejoinPhaseFromRemarks(invoice.remarks);
  if (!profileId || !rejoinPhase) return;

  const synced = await syncInstallmentProfileAfterRejoinPayment(
    client,
    profileId,
    studentId,
    rejoinPhase
  );
  if (synced) {
    console.log(
      `✅ Rejoin: synced installment profile ${synced.installmentinvoiceprofiles_id} ` +
        `(generated_count=${synced.generated_count ?? 0}, billing resumes after phase ${rejoinPhase})`
    );
  }
};

/**
 * Rejected tab: latest rejection per invoice while invoicestbl.status is still Rejected.
 * Once the branch records a new completed payment and the invoice is Paid/Partially Paid again,
 * the row leaves this tab (payment row remains in DB for audit).
 */

/**
 * Resubmit after rejection creates another payment row; both stay Rejected in history.
 * The Rejected tab should list only the latest rejection per invoice (newest rejected_at).
 */
const PAYMENT_LOG_REJECTED_TAB_LATEST_PER_INVOICE_SQL = `
  AND (
    p.invoice_id IS NULL
    OR p.payment_id = (
      SELECT p3.payment_id
      FROM paymenttbl p3
      WHERE p3.invoice_id = p.invoice_id
        AND COALESCE(p3.approval_status, '') = 'Rejected'
      ORDER BY COALESCE(p3.rejected_at, p3.created_at) DESC NULLS LAST, p3.payment_id DESC
      LIMIT 1
    )
  )`;

/** Hide rejected rows when invoice is no longer Rejected (paid again). */
const PAYMENT_LOG_REJECTED_TAB_INVOICE_STILL_REJECTED_SQL = `
  AND (
    p.invoice_id IS NULL
    OR COALESCE(i.status, '') = 'Rejected'
  )`;
// All routes require authentication
router.use(verifyFirebaseToken);
router.use(requireBranchAccess);

/** Branch-side owner for return fixes: invoice issuer first, then action owner, then payment encoder. */
const getPaymentReturnOwnerId = (payment, invoiceCreatedBy) =>
  invoiceCreatedBy ?? payment?.action_owner_user_id ?? payment?.created_by ?? null;

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

let announcementTargetUserIdSupportPromise = null;
const announcementstblHasTargetUserIdColumn = async () => {
  if (!announcementTargetUserIdSupportPromise) {
    announcementTargetUserIdSupportPromise = (async () => {
      try {
        const res = await query(
          `SELECT 1
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'announcementstbl'
             AND column_name = 'target_user_id'
           LIMIT 1`
        );
        return res.rows.length > 0;
      } catch (err) {
        console.error('announcementstblHasTargetUserIdColumn:', err?.message || err);
        return false;
      }
    })();
  }
  return announcementTargetUserIdSupportPromise;
};

/**
 * Finance/Superfinance may edit returned payments for operational reasons.
 * Admin must be the assigned owner; Superadmin may override.
 */
const assertBranchUserMayEditReturnedPayment = (req, payment) => {
  if (!payment || payment.approval_status !== 'Returned') {
    return { ok: true };
  }
  const ut = req.user.userType;
  if (ut === 'Finance' || ut === 'Superfinance') {
    return { ok: true };
  }
  if (ut === 'Superadmin') {
    return { ok: true };
  }
  if (ut !== 'Admin') {
    return { ok: false, status: 403, message: 'Access denied' };
  }
  const ownerId = getPaymentReturnOwnerId(payment);
  const uid = req.user.userId;
  if (ownerId == null) {
    return {
      ok: false,
      status: 403,
      message:
        'This returned payment has no assigned invoice owner. Please contact a superadmin.',
    };
  }
  if (Number(ownerId) === Number(uid)) {
    return { ok: true };
  }
  return {
    ok: false,
    status: 403,
    message: 'Only the staff member who issued the invoice may fix this returned payment.',
  };
};

const createFirstInstallmentRecordAfterDownpayment = async ({
  client,
  profileId,
  profile,
  studentName,
  paymentIssueDate,
}) => {
  const paymentDateYmd = paymentIssueDate || formatYmdLocal(new Date());

  let scheduledDateYmd = profile.bill_invoice_due_date || paymentDateYmd;
  let firstGenerationYmd = paymentDateYmd;
  let currentInvoiceMonthYmd = paymentDateYmd;
  let phaseSchedule = null;

  if (isPhaseInstallmentProfile(profile)) {
    phaseSchedule = await buildPhaseInstallmentSchedule({
      db: client,
      profile,
      generatedCountOverride: 0,
      issueDateOverride: paymentDateYmd,
    });
    if (phaseSchedule?.current_due_date) {
      scheduledDateYmd = phaseSchedule.current_due_date;
    }
    if (phaseSchedule?.current_generation_date) {
      firstGenerationYmd = phaseSchedule.current_generation_date;
    }
    if (phaseSchedule?.current_invoice_month) {
      currentInvoiceMonthYmd = phaseSchedule.current_invoice_month;
    }
  } else if (profile.class_id) {
    const nonPhaseFirstDueYmd = await getPhaseDueDateYmd(client, profile.class_id, 1);
    if (nonPhaseFirstDueYmd) {
      scheduledDateYmd = nonPhaseFirstDueYmd;
    }
  }

  const firstInvoiceRecordResult = await client.query(
    `INSERT INTO installmentinvoicestbl 
     (installmentinvoiceprofiles_id, scheduled_date, status, student_name, 
      total_amount_including_tax, total_amount_excluding_tax, frequency, 
      next_generation_date, next_invoice_month)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      profileId,
      scheduledDateYmd,
      'Pending',
      studentName,
      profile.amount,
      profile.amount,
      profile.frequency || '1 month(s)',
      firstGenerationYmd,
      currentInvoiceMonthYmd,
    ]
  );

  return {
    firstInvoiceRecord: firstInvoiceRecordResult.rows[0],
    phaseSchedule,
  };
};

/**
 * In-app notifications via announcementstbl (same pattern as merchandise: Active, Medium priority).
 * Does not throw — logs on failure so payment APIs still succeed.
 */
const notifyPaymentReturnedToBranch = async ({
  paymentId,
  branchId,
  invoiceId,
  reason,
  returnedByUserId,
  actionOwnerUserId,
  invoiceOwnerUserId,
}) => {
  try {
    if (!branchId) return;
    const hasTargetUserIdColumn = await announcementstblHasTargetUserIdColumn();
    const [branchRes, userRes, payRes] = await Promise.all([
      query(
        `SELECT COALESCE(branch_nickname, branch_name) AS branch_name FROM branchestbl WHERE branch_id = $1`,
        [branchId]
      ),
      query(`SELECT full_name, email FROM userstbl WHERE user_id = $1`, [returnedByUserId]),
      query(
        `SELECT COALESCE(u.full_name, u.email, 'Student') AS student_label
         FROM paymenttbl p
         LEFT JOIN userstbl u ON p.student_id = u.user_id
         WHERE p.payment_id = $1`,
        [paymentId]
      ),
    ]);
    const branchName = branchRes.rows[0]?.branch_name || `Branch ${branchId}`;
    const returnedBy = userRes.rows[0]?.full_name || userRes.rows[0]?.email || 'Finance';
    const studentLabel = payRes.rows[0]?.student_label || 'Student';
    const invLabel = invoiceId != null ? `INV-${invoiceId}` : `Payment #${paymentId}`;
    const reasonText = reason && String(reason).trim() ? ` Note from Finance: ${String(reason).trim()}` : '';
    const detailBody = `${returnedBy} returned ${invLabel} (${studentLabel}) at ${branchName} for reference or attachment correction.${reasonText}`;
    const returnTitleMain = 'Payment returned — action needed';
    const returnTitleSuper = 'Payment returned — superadmin review';

    if (!hasTargetUserIdColumn) {
      // Fallback for environments that have not applied target_user_id migration yet.
      // Admin recipient group is visible to branch admins; superadmin (branch_id NULL) also sees all.
      await query(
        `INSERT INTO announcementstbl (title, body, recipient_groups, status, priority, branch_id, created_by, navigation_key, navigation_query)
         VALUES ($1, $2, $3, 'Active', 'Medium', $4, $5, $6, $7)`,
        [
          returnTitleMain,
          detailBody,
          ['Admin'],
          branchId,
          returnedByUserId,
          'payment-logs',
          'notificationTab=return',
        ]
      );
    } else {
      const ownerTargetIds = Array.from(
        new Set(
          [invoiceOwnerUserId, actionOwnerUserId]
            .map((id) => (id == null ? null : Number(id)))
            .filter((id) => id != null && !Number.isNaN(id))
        )
      );

      if (ownerTargetIds.length > 0) {
        await Promise.all(
          ownerTargetIds.map(async (targetUserId) => {
            const targetBody =
              Number(targetUserId) === Number(returnedByUserId)
                ? `You returned ${invLabel} (${studentLabel}) for correction.${reasonText}`
                : `${invLabel} (${studentLabel}) was returned by ${returnedBy} for correction.${reasonText}`;
            return query(
              `INSERT INTO announcementstbl (title, body, recipient_groups, status, priority, branch_id, created_by, target_user_id, navigation_key, navigation_query)
               VALUES ($1, $2, $3, 'Active', 'Medium', $4, $5, $6, $7, $8)`,
              [
                returnTitleMain,
                targetBody,
                ['All'],
                branchId,
                returnedByUserId,
                targetUserId,
                'payment-logs',
                'notificationTab=return',
              ]
            );
          })
        );
      } else {
        console.warn(
          `notifyPaymentReturnedToBranch: skipped in-app announcement for payment_id=${paymentId} because action owner is missing`
        );
      }

      // Always notify superadmins for visibility when Finance/Superfinance returns a payment.
      try {
        const superadminRes = await query(
          `SELECT user_id
           FROM userstbl
           WHERE LOWER(TRIM(user_type)) = 'superadmin'`
        );
        const superadminIds = (superadminRes.rows || [])
          .map((row) => row.user_id)
          .filter(
            (uid) =>
              uid != null &&
              Number(uid) !== Number(actionOwnerUserId) &&
              Number(uid) !== Number(invoiceOwnerUserId)
          );
        if (superadminIds.length > 0) {
          await Promise.all(
            superadminIds.map((superadminUserId) =>
              query(
                `INSERT INTO announcementstbl (title, body, recipient_groups, status, priority, branch_id, created_by, target_user_id, navigation_key, navigation_query)
                 VALUES ($1, $2, $3, 'Active', 'Medium', $4, $5, $6, $7, $8)`,
                [
                  returnTitleSuper,
                  detailBody,
                  ['All'],
                  branchId,
                  returnedByUserId,
                  superadminUserId,
                  'payment-logs',
                  'notificationTab=return',
                ]
              )
            )
          );
        }
      } catch (superadminNotifyErr) {
        console.error(
          'notifyPaymentReturnedToBranch superadmin notify:',
          superadminNotifyErr?.message || superadminNotifyErr
        );
      }
    }

    if (
      actionOwnerUserId &&
      Number(actionOwnerUserId) !== Number(returnedByUserId)
    ) {
      try {
        const ownerRes = await query(
          `SELECT full_name, email FROM userstbl WHERE user_id = $1`,
          [actionOwnerUserId]
        );
        const rawEmail = ownerRes.rows[0]?.email;
        const [to] = normalizeNotificationRecipients([rawEmail]);
        if (to) {
          const ownerFirst = ownerRes.rows[0]?.full_name || 'there';
          const emailSubject = `Payment returned — ${invLabel} (${branchName})`;
          const emailBody = `Hi ${ownerFirst},\n\n${returnedBy} returned ${invLabel} for student ${studentLabel} at ${branchName} so you can fix the reference or attachment.${reason && String(reason).trim() ? `\n\nNote from Finance: ${String(reason).trim()}` : ''}\n\nOpen Payment Logs and use the Return tab to update this payment.`;
          await sendSystemNotificationEmail({
            to,
            subject: emailSubject,
            html: plainTextToEmailHtml(emailBody),
          });
        }
      } catch (emailErr) {
        console.error(
          'notifyPaymentReturnedToBranch email:',
          emailErr?.message || emailErr
        );
      }
    }
  } catch (err) {
    console.error('notifyPaymentReturnedToBranch:', err?.message || err);
  }
};

const notifyPaymentResubmittedForVerification = async ({
  paymentId,
  branchId,
  invoiceId,
  resubmittedByUserId,
}) => {
  try {
    if (!branchId) return;
    const [branchRes, userRes, payRes] = await Promise.all([
      query(
        `SELECT COALESCE(branch_nickname, branch_name) AS branch_name FROM branchestbl WHERE branch_id = $1`,
        [branchId]
      ),
      query(`SELECT full_name, email FROM userstbl WHERE user_id = $1`, [resubmittedByUserId]),
      query(
        `SELECT COALESCE(u.full_name, u.email, 'Student') AS student_label
         FROM paymenttbl p
         LEFT JOIN userstbl u ON p.student_id = u.user_id
         WHERE p.payment_id = $1`,
        [paymentId]
      ),
    ]);
    const branchName = branchRes.rows[0]?.branch_name || `Branch ${branchId}`;
    const submittedBy = userRes.rows[0]?.full_name || userRes.rows[0]?.email || 'Branch staff';
    const studentLabel = payRes.rows[0]?.student_label || 'Student';
    const invLabel = invoiceId != null ? `INV-${invoiceId}` : `Payment #${paymentId}`;
    const resubmitTitle = 'Payment resubmitted for verification';
    const resubmitBody = `${submittedBy} resubmitted ${invLabel} (${studentLabel}) at ${branchName} for finance verification. Please review it in Payment Logs.`;

    await query(
      `INSERT INTO announcementstbl (title, body, recipient_groups, status, priority, branch_id, created_by, navigation_key, navigation_query)
       VALUES ($1, $2, $3, 'Active', 'Medium', $4, $5, $6, $7)`,
      [resubmitTitle, resubmitBody, ['Finance'], branchId, resubmittedByUserId, 'payment-logs', 'notificationTab=main']
    );

    try {
      const financeRecipientsRes = await query(
        `SELECT DISTINCT TRIM(email) AS email
         FROM userstbl
         WHERE COALESCE(TRIM(email), '') <> ''
           AND (
             LOWER(TRIM(user_type)) = 'superfinance'
             OR (
               LOWER(TRIM(user_type)) = 'finance'
               AND ($1::int IS NULL OR branch_id = $1)
             )
           )`,
        [branchId ?? null]
      );
      const recipients = normalizeNotificationRecipients(
        (financeRecipientsRes.rows || []).map((r) => r.email)
      );
      if (recipients.length > 0) {
        const emailSubject = `Payment resubmitted for verification — ${invLabel} (${branchName})`;
        const emailBody = `${submittedBy} resubmitted ${invLabel} for student ${studentLabel} at ${branchName}. Please review this payment in Payment Logs under your main verification queue.`;
        await sendSystemNotificationEmailToEach({
          recipients,
          subject: emailSubject,
          html: plainTextToEmailHtml(emailBody),
        });
      }
    } catch (emailErr) {
      console.error(
        'notifyPaymentResubmittedForVerification email:',
        emailErr?.message || emailErr
      );
    }
  } catch (err) {
    console.error('notifyPaymentResubmittedForVerification:', err?.message || err);
  }
};

const notifyPaymentRejectedToBranch = async ({
  paymentId,
  branchId,
  invoiceId,
  reason,
  rejectedByUserId,
  actionOwnerUserId,
  invoiceOwnerUserId,
}) => {
  try {
    if (!branchId) return;
    const hasTargetUserIdColumn = await announcementstblHasTargetUserIdColumn();
    const [branchRes, userRes, payRes] = await Promise.all([
      query(
        `SELECT COALESCE(branch_nickname, branch_name) AS branch_name FROM branchestbl WHERE branch_id = $1`,
        [branchId]
      ),
      query(`SELECT full_name, email FROM userstbl WHERE user_id = $1`, [rejectedByUserId]),
      query(
        `SELECT COALESCE(u.full_name, u.email, 'Student') AS student_label
         FROM paymenttbl p
         LEFT JOIN userstbl u ON p.student_id = u.user_id
         WHERE p.payment_id = $1`,
        [paymentId]
      ),
    ]);
    const branchName = branchRes.rows[0]?.branch_name || `Branch ${branchId}`;
    const rejectedBy = userRes.rows[0]?.full_name || userRes.rows[0]?.email || 'Finance';
    const studentLabel = payRes.rows[0]?.student_label || 'Student';
    const invLabel = invoiceId != null ? `INV-${invoiceId}` : `Payment #${paymentId}`;
    const reasonText = reason && String(reason).trim() ? ` Reason: ${String(reason).trim()}` : '';
    const detailBody = `${rejectedBy} rejected ${invLabel} (${studentLabel}) at ${branchName}.${reasonText}`;
    const rejectTitleMain = 'Payment rejected — action needed';
    const rejectTitleSuper = 'Payment rejected — superadmin review';

    if (!hasTargetUserIdColumn) {
      await query(
        `INSERT INTO announcementstbl (title, body, recipient_groups, status, priority, branch_id, created_by, navigation_key, navigation_query)
         VALUES ($1, $2, $3, 'Active', 'High', $4, $5, $6, $7)`,
        [
          rejectTitleMain,
          detailBody,
          ['Admin'],
          branchId,
          rejectedByUserId,
          'payment-logs',
          'notificationTab=rejected',
        ]
      );
    } else {
      const ownerTargetIds = Array.from(
        new Set(
          [invoiceOwnerUserId, actionOwnerUserId]
            .map((id) => (id == null ? null : Number(id)))
            .filter((id) => id != null && !Number.isNaN(id))
        )
      );

      if (ownerTargetIds.length > 0) {
        await Promise.all(
          ownerTargetIds.map(async (targetUserId) => {
            const targetBody = `${invLabel} (${studentLabel}) was rejected by ${rejectedBy}.${reasonText}`;
            return query(
              `INSERT INTO announcementstbl (title, body, recipient_groups, status, priority, branch_id, created_by, target_user_id, navigation_key, navigation_query)
               VALUES ($1, $2, $3, 'Active', 'High', $4, $5, $6, $7, $8)`,
              [
                rejectTitleMain,
                targetBody,
                ['All'],
                branchId,
                rejectedByUserId,
                targetUserId,
                'payment-logs',
                'notificationTab=rejected',
              ]
            );
          })
        );
      }

      const superadminRes = await query(
        `SELECT user_id
         FROM userstbl
         WHERE LOWER(TRIM(user_type)) = 'superadmin'`
      );
      const superadminIds = (superadminRes.rows || [])
        .map((row) => row.user_id)
        .filter(
          (uid) =>
            uid != null &&
            !ownerTargetIds.some((ownerId) => Number(ownerId) === Number(uid))
        );
      if (superadminIds.length > 0) {
        await Promise.all(
          superadminIds.map((superadminUserId) =>
            query(
              `INSERT INTO announcementstbl (title, body, recipient_groups, status, priority, branch_id, created_by, target_user_id, navigation_key, navigation_query)
               VALUES ($1, $2, $3, 'Active', 'High', $4, $5, $6, $7, $8)`,
              [
                rejectTitleSuper,
                detailBody,
                ['All'],
                branchId,
                rejectedByUserId,
                superadminUserId,
                'payment-logs',
                'notificationTab=rejected',
              ]
            )
          )
        );
      }
    }

    if (
      actionOwnerUserId &&
      Number(actionOwnerUserId) !== Number(rejectedByUserId)
    ) {
      try {
        const ownerRes = await query(
          `SELECT full_name, email FROM userstbl WHERE user_id = $1`,
          [actionOwnerUserId]
        );
        const rawEmail = ownerRes.rows[0]?.email;
        const [to] = normalizeNotificationRecipients([rawEmail]);
        if (to) {
          const ownerFirst = ownerRes.rows[0]?.full_name || 'there';
          const emailSubject = `Payment rejected — ${invLabel} (${branchName})`;
          const emailBody = `Hi ${ownerFirst},\n\n${rejectedBy} rejected ${invLabel} for student ${studentLabel} at ${branchName}.\n\nReason: ${String(reason || '').trim()}\n\nOpen Payment Logs and use the Rejected tab to review the payment, then go to the invoice to record a new payment.`;
          await sendSystemNotificationEmail({
            to,
            subject: emailSubject,
            html: plainTextToEmailHtml(emailBody),
          });
        }
      } catch (emailErr) {
        console.error(
          'notifyPaymentRejectedToBranch email:',
          emailErr?.message || emailErr
        );
      }
    }
  } catch (err) {
    console.error('notifyPaymentRejectedToBranch:', err?.message || err);
  }
};

/**
 * GET /api/sms/payments/financial-dashboard-metrics
 * Single round-trip aggregates for finance/superfinance dashboards (replaces many paginated /payments calls).
 * Filters by payment business date: paymenttbl.issue_date (client-paid date entered at recording).
 */
router.get(
  '/financial-dashboard-metrics',
  [
    queryValidator('branch_id').optional().isInt().withMessage('Branch ID must be an integer'),
    queryValidator('payment_date_from')
      .optional()
      .isISO8601()
      .withMessage('payment_date_from must be YYYY-MM-DD'),
    queryValidator('payment_date_to')
      .optional()
      .isISO8601()
      .withMessage('payment_date_to must be YYYY-MM-DD'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const branchIdParam = req.query.branch_id ? parseInt(String(req.query.branch_id), 10) : null;
      const payFrom = req.query.payment_date_from
        ? String(req.query.payment_date_from).trim().slice(0, 10)
        : '';
      const payTo = req.query.payment_date_to ? String(req.query.payment_date_to).trim().slice(0, 10) : '';
      if (payFrom && payTo && payFrom > payTo) {
        return res.status(400).json({
          success: false,
          message: 'payment_date_from must be on or before payment_date_to',
        });
      }

      const params = [];
      let pc = 0;
      let whereExtra = '';

      if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        pc += 1;
        whereExtra += ` AND p.branch_id = $${pc}`;
        params.push(req.user.branchId);
      } else if (branchIdParam) {
        pc += 1;
        whereExtra += ` AND p.branch_id = $${pc}`;
        params.push(branchIdParam);
      }

      if (payFrom) {
        pc += 1;
        whereExtra += ` AND ${PAYMENT_LOG_BUSINESS_DATE_SQL} >= $${pc}::date`;
        params.push(payFrom);
      }
      if (payTo) {
        pc += 1;
        whereExtra += ` AND ${PAYMENT_LOG_BUSINESS_DATE_SQL} <= $${pc}::date`;
        params.push(payTo);
      }

      const baseFrom = `
        FROM paymenttbl p
        LEFT JOIN invoicestbl i ON p.invoice_id = i.invoice_id
        LEFT JOIN branchestbl b ON p.branch_id = b.branch_id
      `;

      const statsSql = `
        SELECT
          COALESCE(
            SUM(CASE WHEN p.status = 'Completed'
              AND COALESCE(p.approval_status, 'Pending') NOT IN ('Returned', 'Rejected')
              THEN COALESCE(p.payable_amount, 0) + COALESCE(p.tip_amount, 0) ELSE 0 END),
          0)::numeric AS total_revenue,
          COUNT(*) FILTER (WHERE p.status = 'Completed')::int AS completed_count,
          COUNT(*) FILTER (
            WHERE p.status = 'Completed' AND COALESCE(p.approval_status, 'Pending') = 'Approved'
          )::int AS verified_count,
          COALESCE(
            SUM(COALESCE(p.payable_amount, 0) + COALESCE(p.tip_amount, 0)) FILTER (
              WHERE p.status = 'Completed' AND COALESCE(p.approval_status, 'Pending') = 'Approved'
            ),
            0
          )::numeric AS verified_amount,
          COUNT(*) FILTER (
            WHERE p.status = 'Completed'
              AND COALESCE(p.approval_status, 'Pending') <> 'Approved'
              AND COALESCE(p.approval_status, 'Pending') NOT IN ('Returned', 'Rejected')
          )::int AS unverified_count,
          COALESCE(
            SUM(COALESCE(p.payable_amount, 0) + COALESCE(p.tip_amount, 0)) FILTER (
              WHERE p.status = 'Completed'
                AND COALESCE(p.approval_status, 'Pending') <> 'Approved'
                AND COALESCE(p.approval_status, 'Pending') NOT IN ('Returned', 'Rejected')
            ),
            0
          )::numeric AS unverified_amount
        ${baseFrom}
        WHERE 1=1
        ${whereExtra}
      `;

      const byBranchSql = `
        SELECT
          p.branch_id,
          COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
          COALESCE(SUM(COALESCE(p.payable_amount, 0) + COALESCE(p.tip_amount, 0)), 0)::numeric AS revenue
        ${baseFrom}
        WHERE 1=1
        ${whereExtra}
          AND p.status = 'Completed'
          AND COALESCE(p.approval_status, 'Pending') NOT IN ('Returned', 'Rejected')
        GROUP BY p.branch_id, b.branch_nickname, b.branch_name
        ORDER BY revenue DESC NULLS LAST
        LIMIT 5
      `;

      const recentSql = `
        SELECT
          p.payment_id,
          p.invoice_id,
          p.student_id,
          p.branch_id,
          p.payable_amount,
          COALESCE(p.tip_amount, 0) AS tip_amount,
          TO_CHAR(p.issue_date, 'YYYY-MM-DD') AS issue_date,
          TO_CHAR(${PAYMENT_LOG_BUSINESS_DATE_SQL}, 'YYYY-MM-DD') AS payment_date,
          p.status,
          p.approval_status,
          p.payment_method,
          TO_CHAR(p.created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at,
          COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
          u.full_name AS student_name
        FROM paymenttbl p
        LEFT JOIN invoicestbl i ON p.invoice_id = i.invoice_id
        LEFT JOIN branchestbl b ON p.branch_id = b.branch_id
        LEFT JOIN userstbl u ON p.student_id = u.user_id
        WHERE 1=1
        ${whereExtra}
          AND p.status = 'Completed'
          AND COALESCE(p.approval_status, 'Pending') NOT IN ('Returned', 'Rejected')
        ORDER BY p.payment_id DESC
        LIMIT 3
      `;

      const paramsCopy = () => [...params];

      const [statsRes, byBranchRes, recentRes] = await Promise.all([
        query(statsSql, paramsCopy()),
        query(byBranchSql, paramsCopy()),
        query(recentSql, paramsCopy()),
      ]);

      const row = statsRes.rows[0] || {};

      res.json({
        success: true,
        data: {
          totalRevenue: parseFloat(row.total_revenue) || 0,
          completedPayments: parseInt(row.completed_count, 10) || 0,
          verifiedPaymentsCount: parseInt(row.verified_count, 10) || 0,
          verifiedPaymentsAmount: parseFloat(row.verified_amount) || 0,
          unverifiedPaymentsCount: parseInt(row.unverified_count, 10) || 0,
          unverifiedPaymentsAmount: parseFloat(row.unverified_amount) || 0,
          revenueByBranch: (byBranchRes.rows || []).map((r) => ({
            branch_id: r.branch_id,
            branch_name: r.branch_name || (r.branch_id != null ? `Branch ${r.branch_id}` : ''),
            revenue: parseFloat(r.revenue) || 0,
          })),
          recentPayments: recentRes.rows || [],
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/sms/payments
 * Get all payments with optional filters
 * Access: All authenticated users
 */
router.get(
  '/',
  [
    queryValidator('invoice_id').optional().isInt().withMessage('Invoice ID must be an integer'),
    queryValidator('student_id').optional().isInt().withMessage('Student ID must be an integer'),
    queryValidator('branch_id').optional().isInt().withMessage('Branch ID must be an integer'),
    queryValidator('issue_date').optional().isISO8601().withMessage('issue_date must be YYYY-MM-DD'),
    queryValidator('issue_date_from').optional().isISO8601().withMessage('issue_date_from must be YYYY-MM-DD'),
    queryValidator('issue_date_to').optional().isISO8601().withMessage('issue_date_to must be YYYY-MM-DD'),
    queryValidator('invoice_issue_date_from')
      .optional()
      .isISO8601()
      .withMessage('invoice_issue_date_from must be YYYY-MM-DD'),
    queryValidator('invoice_issue_date_to')
      .optional()
      .isISO8601()
      .withMessage('invoice_issue_date_to must be YYYY-MM-DD'),
    queryValidator('payment_date_from')
      .optional()
      .isISO8601()
      .withMessage('payment_date_from must be YYYY-MM-DD'),
    queryValidator('payment_date_to')
      .optional()
      .isISO8601()
      .withMessage('payment_date_to must be YYYY-MM-DD'),
    queryValidator('created_date_from')
      .optional()
      .isISO8601()
      .withMessage('created_date_from must be YYYY-MM-DD'),
    queryValidator('created_date_to')
      .optional()
      .isISO8601()
      .withMessage('created_date_to must be YYYY-MM-DD'),
    queryValidator('status').optional().isString().withMessage('Status must be a string'),
    queryValidator('invoice_statuses').optional().isString().withMessage('invoice_statuses must be a comma-separated string'),
    queryValidator('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    queryValidator('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    queryValidator('approval_status').optional().isString().withMessage('approval_status must be a string'),
    queryValidator('exclude_approval_status').optional().isString().withMessage('exclude_approval_status must be a string'),
    queryValidator('returned_by_me').optional().isString().withMessage('returned_by_me must be a string'),
    queryValidator('my_return_queue').optional().isString().withMessage('my_return_queue must be a string'),
    queryValidator('issued_by_me').optional().isString().withMessage('issued_by_me must be a string'),
    queryValidator('payment_method').optional().isString().withMessage('payment_method must be a string'),
    queryValidator('search').optional().isString().withMessage('search must be a string'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const {
        invoice_id,
        student_id,
        branch_id,
        issue_date,
        issue_date_from: issueDateFrom,
        issue_date_to: issueDateTo,
        status,
        invoice_statuses: invoiceStatusesRaw,
        approval_status: approvalStatus,
        exclude_approval_status: excludeApprovalStatus,
        returned_by_me: returnedByMeRaw,
        my_return_queue: myReturnQueueRaw,
        issued_by_me: issuedByMeRaw,
        payment_method: paymentMethodRaw,
        search,
        page = 1,
        limit = 20,
      } = req.query;
      const paymentMethodFilter = paymentMethodRaw != null && String(paymentMethodRaw).trim() !== ''
        ? String(paymentMethodRaw).trim()
        : '';
      const searchTerm = search ? String(search).trim() : '';
      const invoiceStatuses = invoiceStatusesRaw
        ? String(invoiceStatusesRaw)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const isRejectedPaymentLogsTab = String(approvalStatus || '').trim() === 'Rejected';
      const returnedByMe =
        returnedByMeRaw === '1' || String(returnedByMeRaw).toLowerCase() === 'true';
      let myReturnQueue =
        myReturnQueueRaw === '1' || String(myReturnQueueRaw || '').toLowerCase() === 'true';
      let issuedByMe =
        issuedByMeRaw === '1' || String(issuedByMeRaw || '').toLowerCase() === 'true';
      if (myReturnQueue && !['Superadmin', 'Admin', 'Finance'].includes(req.user.userType)) {
        myReturnQueue = false;
      }
      if (issuedByMe && req.user.userType !== 'Admin') {
        issuedByMe = false;
      }
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 20;
      const offset = (pageNum - 1) * limitNum;

      const hasActionOwnerCol = await paymenttblHasActionOwnerUserIdColumn();
      const ownerSelectSql = hasActionOwnerCol
        ? 'p.action_owner_user_id'
        : 'NULL::integer AS action_owner_user_id';

      let sql = `SELECT p.payment_id, p.invoice_id, p.student_id, p.branch_id, 
                        p.payment_method, p.payment_type, p.payable_amount, COALESCE(p.discount_amount, 0) AS discount_amount, COALESCE(p.tip_amount, 0) AS tip_amount,
                        TO_CHAR(p.issue_date, 'YYYY-MM-DD') as issue_date, 
                        TO_CHAR(i.issue_date, 'YYYY-MM-DD') AS invoice_issue_date,
                        TO_CHAR(${PAYMENT_LOG_BUSINESS_DATE_SQL}, 'YYYY-MM-DD') as payment_date,
                        p.status, p.reference_number, p.remarks, p.payment_attachment_url, p.created_by,
                        ${ownerSelectSql},
                        TO_CHAR(p.created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at,
                        p.approval_status, p.approved_by,
                        TO_CHAR(p.approved_at, 'YYYY-MM-DD HH24:MI:SS') as approved_at,
                        p.return_reason,
                        TO_CHAR(p.returned_at, 'YYYY-MM-DD HH24:MI:SS') as returned_at,
                        p.returned_by,
                        returner.full_name as returned_by_name,
                        p.reject_reason,
                        TO_CHAR(p.rejected_at, 'YYYY-MM-DD HH24:MI:SS') as rejected_at,
                        p.rejected_by,
                        rejecter.full_name as rejected_by_name,
                        u.full_name as student_name, u.email as student_email, u.level_tag as student_level_tag,
                        i.invoice_description, i.amount as invoice_amount,
                        i.status AS invoice_status,
                        COALESCE(i.amount, 0) + COALESCE((
                          SELECT SUM(COALESCE(px.tip_amount, 0))
                          FROM paymenttbl px
                          WHERE px.invoice_id = p.invoice_id
                            AND px.status = 'Completed'
                        ), 0) AS invoice_total_amount,
                        i.invoice_ar_number AS invoice_ar_number,
                        COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
                        approver.full_name as approved_by_name,
                        payment_creator.full_name as payment_created_by_name,
                        payment_creator.email as payment_created_by_email,
                        invoice_issuer.full_name as invoice_issued_by_name,
                        invoice_issuer.email as invoice_issued_by_email,
                        ar.prospect_student_name as ar_prospect_student_name
                 FROM paymenttbl p
                 LEFT JOIN userstbl u ON p.student_id = u.user_id
                 LEFT JOIN invoicestbl i ON p.invoice_id = i.invoice_id
                 LEFT JOIN userstbl payment_creator ON p.created_by = payment_creator.user_id
                 LEFT JOIN userstbl invoice_issuer ON i.created_by = invoice_issuer.user_id
                 LEFT JOIN branchestbl b ON p.branch_id = b.branch_id
                 LEFT JOIN userstbl approver ON p.approved_by = approver.user_id
                 LEFT JOIN userstbl returner ON p.returned_by = returner.user_id
                 LEFT JOIN userstbl rejecter ON p.rejected_by = rejecter.user_id
                 LEFT JOIN acknowledgement_receiptstbl ar ON ar.payment_id = p.payment_id
                 WHERE 1=1`;
      const params = [];
      let paramCount = 0;

      // Filter by branch (non-superadmin users are limited to their branch)
      if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        paramCount++;
        sql += ` AND p.branch_id = $${paramCount}`;
        params.push(req.user.branchId);
      } else if (branch_id) {
        paramCount++;
        sql += ` AND p.branch_id = $${paramCount}`;
        params.push(branch_id);
      }

      if (invoice_id) {
        paramCount++;
        sql += ` AND p.invoice_id = $${paramCount}`;
        params.push(invoice_id);
      }

      if (student_id) {
        paramCount++;
        sql += ` AND p.student_id = $${paramCount}`;
        params.push(student_id);
      }

      const fromTrim = issueDateFrom ? String(issueDateFrom).trim().slice(0, 10) : '';
      const toTrim = issueDateTo ? String(issueDateTo).trim().slice(0, 10) : '';
      const useIssueRange = Boolean(fromTrim || toTrim);

      if (useIssueRange) {
        if (fromTrim && toTrim && fromTrim > toTrim) {
          return res.status(400).json({
            success: false,
            message: 'issue_date_from must be on or before issue_date_to',
          });
        }
        if (fromTrim) {
          paramCount++;
          sql += ` AND p.issue_date >= $${paramCount}::date`;
          params.push(fromTrim);
        }
        if (toTrim) {
          paramCount++;
          sql += ` AND p.issue_date <= $${paramCount}::date`;
          params.push(toTrim);
        }
      } else if (issue_date) {
        paramCount++;
        sql += ` AND p.issue_date = $${paramCount}::date`;
        params.push(issue_date);
      }

      const invIssueFrom = req.query.invoice_issue_date_from
        ? String(req.query.invoice_issue_date_from).trim().slice(0, 10)
        : '';
      const invIssueTo = req.query.invoice_issue_date_to
        ? String(req.query.invoice_issue_date_to).trim().slice(0, 10)
        : '';
      const useInvoiceIssueRange = Boolean(invIssueFrom || invIssueTo);
      if (useInvoiceIssueRange) {
        if (invIssueFrom && invIssueTo && invIssueFrom > invIssueTo) {
          return res.status(400).json({
            success: false,
            message: 'invoice_issue_date_from must be on or before invoice_issue_date_to',
          });
        }
        if (invIssueFrom) {
          paramCount++;
          sql += ` AND i.issue_date >= $${paramCount}::date`;
          params.push(invIssueFrom);
        }
        if (invIssueTo) {
          paramCount++;
          sql += ` AND i.issue_date <= $${paramCount}::date`;
          params.push(invIssueTo);
        }
      }

      const payDateFrom = req.query.payment_date_from
        ? String(req.query.payment_date_from).trim().slice(0, 10)
        : '';
      const payDateTo = req.query.payment_date_to ? String(req.query.payment_date_to).trim().slice(0, 10) : '';
      const usePaymentDateRange = Boolean(payDateFrom || payDateTo);
      if (usePaymentDateRange) {
        if (payDateFrom && payDateTo && payDateFrom > payDateTo) {
          return res.status(400).json({
            success: false,
            message: 'payment_date_from must be on or before payment_date_to',
          });
        }
        if (payDateFrom) {
          paramCount++;
          sql += ` AND ${PAYMENT_LOG_BUSINESS_DATE_SQL} >= $${paramCount}::date`;
          params.push(payDateFrom);
        }
        if (payDateTo) {
          paramCount++;
          sql += ` AND ${PAYMENT_LOG_BUSINESS_DATE_SQL} <= $${paramCount}::date`;
          params.push(payDateTo);
        }
      }

      // Optional filter on payment issue date (p.issue_date). Same business date as
      // the Payment Logs "Issue Date" column; query params remain created_date_from/to
      // for backward compatibility with existing clients.
      const createdFrom = req.query.created_date_from
        ? String(req.query.created_date_from).trim().slice(0, 10)
        : '';
      const createdTo = req.query.created_date_to
        ? String(req.query.created_date_to).trim().slice(0, 10)
        : '';
      if (createdFrom || createdTo) {
        if (createdFrom && createdTo && createdFrom > createdTo) {
          return res.status(400).json({
            success: false,
            message: 'created_date_from must be on or before created_date_to',
          });
        }
        if (createdFrom) {
          paramCount++;
          sql += ` AND p.issue_date >= $${paramCount}::date`;
          params.push(createdFrom);
        }
        if (createdTo) {
          paramCount++;
          sql += ` AND p.issue_date <= $${paramCount}::date`;
          params.push(createdTo);
        }
      }

      if (status) {
        paramCount++;
        sql += ` AND p.status = $${paramCount}`;
        params.push(status);
      }
      if (invoiceStatuses.length === 1) {
        paramCount++;
        sql += ` AND i.status = $${paramCount}`;
        params.push(invoiceStatuses[0]);
      } else if (invoiceStatuses.length > 1) {
        paramCount++;
        sql += ` AND i.status = ANY($${paramCount}::text[])`;
        params.push(invoiceStatuses);
      }

      if (approvalStatus) {
        const list = String(approvalStatus)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (list.length === 1) {
          paramCount++;
          sql += ` AND p.approval_status = $${paramCount}`;
          params.push(list[0]);
        } else if (list.length > 1) {
          paramCount++;
          sql += ` AND p.approval_status = ANY($${paramCount}::text[])`;
          params.push(list);
        }
      }

      if (excludeApprovalStatus) {
        const excl = String(excludeApprovalStatus)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (excl.length > 0) {
          paramCount++;
          sql += ` AND (p.approval_status IS NULL OR NOT (p.approval_status = ANY($${paramCount}::text[])))`;
          params.push(excl);
        }
      }

      if (returnedByMe) {
        paramCount++;
        sql += ` AND p.returned_by = $${paramCount}`;
        params.push(req.user.userId);
      }

      if (myReturnQueue) {
        paramCount++;
        sql += ` AND p.approval_status = 'Returned'`;
        if (hasActionOwnerCol) {
          sql += ` AND (
          p.action_owner_user_id = $${paramCount}
          OR (p.action_owner_user_id IS NULL AND p.created_by = $${paramCount})
        )`;
        } else {
          sql += ` AND p.created_by = $${paramCount}`;
        }
        params.push(req.user.userId);
      }

      if (issuedByMe) {
        paramCount++;
        if (hasActionOwnerCol) {
          sql += ` AND COALESCE(p.action_owner_user_id, i.created_by, p.created_by) = $${paramCount}`;
        } else {
          sql += ` AND COALESCE(i.created_by, p.created_by) = $${paramCount}`;
        }
        params.push(req.user.userId);
      }

      if (paymentMethodFilter) {
        paramCount++;
        sql += ` AND p.payment_method = $${paramCount}`;
        params.push(paymentMethodFilter);
      }

      if (searchTerm) {
        paramCount++;
        sql += ` AND (
          p.payment_id::text ILIKE $${paramCount}
          OR COALESCE(i.invoice_description, '') ILIKE $${paramCount}
          OR COALESCE(u.full_name, '') ILIKE $${paramCount}
          OR COALESCE(u.email, '') ILIKE $${paramCount}
          OR COALESCE(ar.prospect_student_name, '') ILIKE $${paramCount}
          OR COALESCE(i.invoice_ar_number, '') ILIKE $${paramCount}
          OR COALESCE(p.reference_number, '') ILIKE $${paramCount}
          OR COALESCE(invoice_issuer.full_name, '') ILIKE $${paramCount}
          OR COALESCE(invoice_issuer.email, '') ILIKE $${paramCount}
          OR COALESCE(payment_creator.full_name, '') ILIKE $${paramCount}
          OR COALESCE(payment_creator.email, '') ILIKE $${paramCount}
          OR COALESCE(returner.full_name, '') ILIKE $${paramCount}
        )`;
        params.push(`%${searchTerm}%`);
      }

      if (isRejectedPaymentLogsTab) {
        sql += PAYMENT_LOG_REJECTED_TAB_LATEST_PER_INVOICE_SQL;
        sql += PAYMENT_LOG_REJECTED_TAB_INVOICE_STILL_REJECTED_SQL;
      }

      sql += ` ORDER BY p.payment_id DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
      params.push(limitNum, offset);

      const result = await query(sql, params);

      // Post-process to replace Walk-in Customer with AR prospect name when applicable
      const payments = [];
      for (const row of result.rows) {
        let studentName = row.student_name;
        let studentEmail = row.student_email;

        const isWalkIn = (studentEmail || '').toLowerCase() === 'walkin@merchandise.psms.internal';
        const prospectName = row.ar_prospect_student_name || null;
        if (isWalkIn && prospectName) {
          studentName = prospectName;
          studentEmail = null; // Merchandise AR: show student name only, no email
        }

        payments.push({
          ...row,
          student_name: studentName,
          student_email: studentEmail,
        });
      }

      // Get total count for pagination
      let countSql = `SELECT COUNT(*) as total
                      FROM paymenttbl p
                      LEFT JOIN invoicestbl i ON p.invoice_id = i.invoice_id
                      LEFT JOIN userstbl u ON p.student_id = u.user_id
                      LEFT JOIN userstbl payment_creator ON p.created_by = payment_creator.user_id
                      LEFT JOIN userstbl invoice_issuer ON i.created_by = invoice_issuer.user_id
                      LEFT JOIN userstbl returner ON p.returned_by = returner.user_id
                      LEFT JOIN acknowledgement_receiptstbl ar ON ar.payment_id = p.payment_id
                      WHERE 1=1`;
      const countParams = [];
      let countParamCount = 0;

      if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        countParamCount++;
        countSql += ` AND p.branch_id = $${countParamCount}`;
        countParams.push(req.user.branchId);
      } else if (branch_id) {
        countParamCount++;
        countSql += ` AND p.branch_id = $${countParamCount}`;
        countParams.push(branch_id);
      }

      if (invoice_id) {
        countParamCount++;
        countSql += ` AND p.invoice_id = $${countParamCount}`;
        countParams.push(invoice_id);
      }

      if (student_id) {
        countParamCount++;
        countSql += ` AND p.student_id = $${countParamCount}`;
        countParams.push(student_id);
      }

      if (useIssueRange) {
        if (fromTrim) {
          countParamCount++;
          countSql += ` AND p.issue_date >= $${countParamCount}::date`;
          countParams.push(fromTrim);
        }
        if (toTrim) {
          countParamCount++;
          countSql += ` AND p.issue_date <= $${countParamCount}::date`;
          countParams.push(toTrim);
        }
      } else if (issue_date) {
        countParamCount++;
        countSql += ` AND p.issue_date = $${countParamCount}::date`;
        countParams.push(issue_date);
      }

      if (useInvoiceIssueRange) {
        if (invIssueFrom) {
          countParamCount++;
          countSql += ` AND i.issue_date >= $${countParamCount}::date`;
          countParams.push(invIssueFrom);
        }
        if (invIssueTo) {
          countParamCount++;
          countSql += ` AND i.issue_date <= $${countParamCount}::date`;
          countParams.push(invIssueTo);
        }
      }

      if (usePaymentDateRange) {
        if (payDateFrom) {
          countParamCount++;
          countSql += ` AND ${PAYMENT_LOG_BUSINESS_DATE_SQL} >= $${countParamCount}::date`;
          countParams.push(payDateFrom);
        }
        if (payDateTo) {
          countParamCount++;
          countSql += ` AND ${PAYMENT_LOG_BUSINESS_DATE_SQL} <= $${countParamCount}::date`;
          countParams.push(payDateTo);
        }
      }

      // Mirror the created_at filter on the count/sum query so the page
      // count and "Total amount" badges line up with the rows returned.
      if (createdFrom || createdTo) {
        if (createdFrom) {
          countParamCount++;
          countSql += ` AND p.issue_date >= $${countParamCount}::date`;
          countParams.push(createdFrom);
        }
        if (createdTo) {
          countParamCount++;
          countSql += ` AND p.issue_date <= $${countParamCount}::date`;
          countParams.push(createdTo);
        }
      }

      if (status) {
        countParamCount++;
        countSql += ` AND p.status = $${countParamCount}`;
        countParams.push(status);
      }
      if (invoiceStatuses.length === 1) {
        countParamCount++;
        countSql += ` AND i.status = $${countParamCount}`;
        countParams.push(invoiceStatuses[0]);
      } else if (invoiceStatuses.length > 1) {
        countParamCount++;
        countSql += ` AND i.status = ANY($${countParamCount}::text[])`;
        countParams.push(invoiceStatuses);
      }

      if (approvalStatus) {
        const list = String(approvalStatus)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (list.length === 1) {
          countParamCount++;
          countSql += ` AND p.approval_status = $${countParamCount}`;
          countParams.push(list[0]);
        } else if (list.length > 1) {
          countParamCount++;
          countSql += ` AND p.approval_status = ANY($${countParamCount}::text[])`;
          countParams.push(list);
        }
      }

      if (excludeApprovalStatus) {
        const excl = String(excludeApprovalStatus)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (excl.length > 0) {
          countParamCount++;
          countSql += ` AND (p.approval_status IS NULL OR NOT (p.approval_status = ANY($${countParamCount}::text[])))`;
          countParams.push(excl);
        }
      }

      if (returnedByMe) {
        countParamCount++;
        countSql += ` AND p.returned_by = $${countParamCount}`;
        countParams.push(req.user.userId);
      }

      if (myReturnQueue) {
        countParamCount++;
        countSql += ` AND p.approval_status = 'Returned'`;
        if (hasActionOwnerCol) {
          countSql += ` AND (
          p.action_owner_user_id = $${countParamCount}
          OR (p.action_owner_user_id IS NULL AND p.created_by = $${countParamCount})
        )`;
        } else {
          countSql += ` AND p.created_by = $${countParamCount}`;
        }
        countParams.push(req.user.userId);
      }

      if (issuedByMe) {
        countParamCount++;
        if (hasActionOwnerCol) {
          countSql += ` AND COALESCE(p.action_owner_user_id, i.created_by, p.created_by) = $${countParamCount}`;
        } else {
          countSql += ` AND COALESCE(i.created_by, p.created_by) = $${countParamCount}`;
        }
        countParams.push(req.user.userId);
      }

      if (paymentMethodFilter) {
        countParamCount++;
        countSql += ` AND p.payment_method = $${countParamCount}`;
        countParams.push(paymentMethodFilter);
      }

      if (searchTerm) {
        countParamCount++;
        countSql += ` AND (
          p.payment_id::text ILIKE $${countParamCount}
          OR COALESCE(i.invoice_description, '') ILIKE $${countParamCount}
          OR COALESCE(u.full_name, '') ILIKE $${countParamCount}
          OR COALESCE(u.email, '') ILIKE $${countParamCount}
          OR COALESCE(ar.prospect_student_name, '') ILIKE $${countParamCount}
          OR COALESCE(i.invoice_ar_number, '') ILIKE $${countParamCount}
          OR COALESCE(p.reference_number, '') ILIKE $${countParamCount}
          OR COALESCE(invoice_issuer.full_name, '') ILIKE $${countParamCount}
          OR COALESCE(invoice_issuer.email, '') ILIKE $${countParamCount}
          OR COALESCE(payment_creator.full_name, '') ILIKE $${countParamCount}
          OR COALESCE(payment_creator.email, '') ILIKE $${countParamCount}
          OR COALESCE(returner.full_name, '') ILIKE $${countParamCount}
        )`;
        countParams.push(`%${searchTerm}%`);
      }

      if (isRejectedPaymentLogsTab) {
        countSql += PAYMENT_LOG_REJECTED_TAB_LATEST_PER_INVOICE_SQL;
        countSql += PAYMENT_LOG_REJECTED_TAB_INVOICE_STILL_REJECTED_SQL;
      }

      // acknowledgement_receiptstbl can produce multiple join rows per payment; COUNT/SUM must
      // be per payment_id so pagination totals and line amounts match the visible row set.
      const countInnerCore = countSql.replace(
        /SELECT COUNT\(\*\) as total/i,
        'SELECT p.payment_id, MAX(COALESCE(p.payable_amount, 0) + COALESCE(p.tip_amount, 0)) AS line_amt',
      );
      const countSqlDeduped = `SELECT COUNT(*)::bigint AS total FROM (${countInnerCore} GROUP BY p.payment_id) _cnt`;
      const sumSqlDeduped = `SELECT COALESCE(SUM(line_amt), 0)::numeric AS total_line_amount FROM (${countInnerCore} GROUP BY p.payment_id) _sum`;

      const [countResult, sumResult] = await Promise.all([
        query(countSqlDeduped, countParams),
        query(sumSqlDeduped, countParams),
      ]);
      const total = parseInt(countResult.rows[0].total, 10) || 0;
      const filterTotalLineAmount = parseFloat(sumResult.rows[0]?.total_line_amount ?? 0) || 0;

      res.json({
        success: true,
        data: payments,
        filterTotalLineAmount,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/sms/payments/finance-unified
 * Unified payment logs (main tab):
 * - regular payment rows
 * - unapplied verified package AR rows (no payment_id/invoice_id yet); Payment Logs approval when Finance verified (not Admin)
 * Access: Finance, Superfinance, Superadmin, Admin (branch-scoped via user branch or branch_id query)
 */
router.get(
  '/finance-unified',
  [
    queryValidator('branch_id').optional().isInt().withMessage('Branch ID must be an integer'),
    queryValidator('issue_date').optional().isISO8601().withMessage('issue_date must be YYYY-MM-DD'),
    queryValidator('issue_date_from').optional().isISO8601().withMessage('issue_date_from must be YYYY-MM-DD'),
    queryValidator('issue_date_to').optional().isISO8601().withMessage('issue_date_to must be YYYY-MM-DD'),
    queryValidator('payment_date_from')
      .optional()
      .isISO8601()
      .withMessage('payment_date_from must be YYYY-MM-DD'),
    queryValidator('payment_date_to')
      .optional()
      .isISO8601()
      .withMessage('payment_date_to must be YYYY-MM-DD'),
    queryValidator('created_date_from')
      .optional()
      .isISO8601()
      .withMessage('created_date_from must be YYYY-MM-DD'),
    queryValidator('created_date_to')
      .optional()
      .isISO8601()
      .withMessage('created_date_to must be YYYY-MM-DD'),
    queryValidator('pending_only').optional().isString().withMessage('pending_only must be a string'),
    queryValidator('approval_status').optional().isString().withMessage('approval_status must be a string'),
    queryValidator('payment_method').optional().isString().withMessage('payment_method must be a string'),
    queryValidator('search').optional().isString().withMessage('search must be a string'),
    queryValidator('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    queryValidator('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    handleValidationErrors,
  ],
  requireRole('Finance', 'Superfinance', 'Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const {
        branch_id,
        issue_date,
        issue_date_from: issueDateFrom,
        issue_date_to: issueDateTo,
        pending_only: pendingOnlyRaw,
        approval_status: approvalStatusRaw,
        payment_method: paymentMethodRaw,
        search,
        page = 1,
        limit = 20,
      } = req.query;
      // Normalise to 'Approved' | 'Pending' | '' — only 'Approved' and '' matter for this endpoint.
      const approvalStatusFilter = approvalStatusRaw ? String(approvalStatusRaw).trim() : '';
      const pmFilter =
        paymentMethodRaw != null && String(paymentMethodRaw).trim() !== ''
          ? String(paymentMethodRaw).trim()
          : '';

      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 20;
      const offset = (pageNum - 1) * limitNum;
      const pendingOnly =
        pendingOnlyRaw === '1' || String(pendingOnlyRaw || '').toLowerCase() === 'true';
      const searchTerm = search ? String(search).trim() : '';

      const fromTrim = issueDateFrom ? String(issueDateFrom).trim().slice(0, 10) : '';
      const toTrim = issueDateTo ? String(issueDateTo).trim().slice(0, 10) : '';
      const useIssueRange = Boolean(fromTrim || toTrim);
      if (useIssueRange && fromTrim && toTrim && fromTrim > toTrim) {
        return res.status(400).json({
          success: false,
          message: 'issue_date_from must be on or before issue_date_to',
        });
      }

      const payDateFrom = req.query.payment_date_from
        ? String(req.query.payment_date_from).trim().slice(0, 10)
        : '';
      const payDateTo = req.query.payment_date_to ? String(req.query.payment_date_to).trim().slice(0, 10) : '';
      const usePaymentDateRange = Boolean(payDateFrom || payDateTo);
      if (usePaymentDateRange && payDateFrom && payDateTo && payDateFrom > payDateTo) {
        return res.status(400).json({
          success: false,
          message: 'payment_date_from must be on or before payment_date_to',
        });
      }

      const createdFrom = req.query.created_date_from
        ? String(req.query.created_date_from).trim().slice(0, 10)
        : '';
      const createdTo = req.query.created_date_to
        ? String(req.query.created_date_to).trim().slice(0, 10)
        : '';
      if (createdFrom && createdTo && createdFrom > createdTo) {
        return res.status(400).json({
          success: false,
          message: 'created_date_from must be on or before created_date_to',
        });
      }
      const useCreatedDateRange = Boolean(createdFrom || createdTo);

      // ---------- 1) Normal payment rows ----------
      let paySql = `SELECT p.payment_id, p.invoice_id, p.student_id, p.branch_id,
                           p.payment_method, p.payment_type, p.payable_amount, COALESCE(p.discount_amount, 0) AS discount_amount, COALESCE(p.tip_amount, 0) AS tip_amount,
                           TO_CHAR(p.issue_date, 'YYYY-MM-DD') as issue_date,
                           TO_CHAR(${PAYMENT_LOG_BUSINESS_DATE_SQL}, 'YYYY-MM-DD') as payment_date,
                           p.status, p.reference_number, p.remarks, p.payment_attachment_url, p.created_by,
                           TO_CHAR(p.created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at,
                           p.approval_status, p.approved_by,
                           TO_CHAR(p.approved_at, 'YYYY-MM-DD HH24:MI:SS') as approved_at,
                           p.return_reason,
                           TO_CHAR(p.returned_at, 'YYYY-MM-DD HH24:MI:SS') as returned_at,
                           p.returned_by,
                           returner.full_name as returned_by_name,
                           p.reject_reason,
                           TO_CHAR(p.rejected_at, 'YYYY-MM-DD HH24:MI:SS') as rejected_at,
                           p.rejected_by,
                           rejecter.full_name as rejected_by_name,
                           u.full_name as student_name, u.email as student_email, u.level_tag as student_level_tag,
                           i.invoice_description, i.amount as invoice_amount,
                           COALESCE(i.amount, 0) + COALESCE((
                             SELECT SUM(COALESCE(px.tip_amount, 0))
                             FROM paymenttbl px
                             WHERE px.invoice_id = p.invoice_id
                               AND px.status = 'Completed'
                           ), 0) AS invoice_total_amount,
                           i.invoice_ar_number AS invoice_ar_number,
                           COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
                           approver.full_name as approved_by_name,
                           payment_creator.full_name as payment_created_by_name,
                           payment_creator.email as payment_created_by_email,
                           invoice_issuer.full_name as invoice_issued_by_name,
                           invoice_issuer.email as invoice_issued_by_email,
                           ar.prospect_student_name as ar_prospect_student_name
                    FROM paymenttbl p
                    LEFT JOIN userstbl u ON p.student_id = u.user_id
                    LEFT JOIN invoicestbl i ON p.invoice_id = i.invoice_id
                    LEFT JOIN userstbl payment_creator ON p.created_by = payment_creator.user_id
                    LEFT JOIN userstbl invoice_issuer ON i.created_by = invoice_issuer.user_id
                    LEFT JOIN branchestbl b ON p.branch_id = b.branch_id
                    LEFT JOIN userstbl approver ON p.approved_by = approver.user_id
                    LEFT JOIN userstbl returner ON p.returned_by = returner.user_id
                    LEFT JOIN userstbl rejecter ON p.rejected_by = rejecter.user_id
                    LEFT JOIN acknowledgement_receiptstbl ar ON ar.payment_id = p.payment_id
                    WHERE 1=1`;
      const payParams = [];
      let payPc = 0;

      if (req.user.userType !== 'Superfinance' && req.user.branchId) {
        payPc++;
        paySql += ` AND p.branch_id = $${payPc}`;
        payParams.push(req.user.branchId);
      } else if (branch_id) {
        payPc++;
        paySql += ` AND p.branch_id = $${payPc}`;
        payParams.push(branch_id);
      }

      if (useIssueRange) {
        if (fromTrim) {
          payPc++;
          paySql += ` AND p.issue_date >= $${payPc}::date`;
          payParams.push(fromTrim);
        }
        if (toTrim) {
          payPc++;
          paySql += ` AND p.issue_date <= $${payPc}::date`;
          payParams.push(toTrim);
        }
      } else if (issue_date) {
        payPc++;
        paySql += ` AND p.issue_date = $${payPc}::date`;
        payParams.push(issue_date);
      }

      if (usePaymentDateRange) {
        if (payDateFrom) {
          payPc++;
          paySql += ` AND ${PAYMENT_LOG_BUSINESS_DATE_SQL} >= $${payPc}::date`;
          payParams.push(payDateFrom);
        }
        if (payDateTo) {
          payPc++;
          paySql += ` AND ${PAYMENT_LOG_BUSINESS_DATE_SQL} <= $${payPc}::date`;
          payParams.push(payDateTo);
        }
      }

      if (useCreatedDateRange) {
        if (createdFrom) {
          payPc++;
          paySql += ` AND p.issue_date >= $${payPc}::date`;
          payParams.push(createdFrom);
        }
        if (createdTo) {
          payPc++;
          paySql += ` AND p.issue_date <= $${payPc}::date`;
          payParams.push(createdTo);
        }
      }

      if (approvalStatusFilter === 'Approved') {
        // Verified-only: Completed + explicitly Approved, excluding Returned/Rejected.
        paySql += ` AND p.status = 'Completed'
                    AND p.approval_status = 'Approved'`;
      } else if (pendingOnly) {
        paySql += ` AND p.status = 'Completed'
                    AND (p.approval_status IS NULL OR p.approval_status NOT IN ('Approved', 'Returned', 'Rejected'))`;
      } else {
        // "All" queue: completed payments Finance has not Returned/Rejected (matches Payment Logs + dashboard totals).
        paySql += ` AND p.status = 'Completed'
                    AND COALESCE(p.approval_status, 'Pending') NOT IN ('Returned', 'Rejected')`;
      }

      if (pmFilter && pmFilter !== 'Acknowledgement Receipt') {
        payPc++;
        paySql += ` AND p.payment_method = $${payPc}`;
        payParams.push(pmFilter);
      } else if (pmFilter === 'Acknowledgement Receipt') {
        paySql += ` AND FALSE`;
      }

      if (searchTerm) {
        payPc++;
        paySql += ` AND (
          p.payment_id::text ILIKE $${payPc}
          OR COALESCE(i.invoice_description, '') ILIKE $${payPc}
          OR COALESCE(u.full_name, '') ILIKE $${payPc}
          OR COALESCE(u.email, '') ILIKE $${payPc}
          OR COALESCE(ar.prospect_student_name, '') ILIKE $${payPc}
          OR COALESCE(i.invoice_ar_number, '') ILIKE $${payPc}
          OR COALESCE(p.reference_number, '') ILIKE $${payPc}
          OR COALESCE(invoice_issuer.full_name, '') ILIKE $${payPc}
          OR COALESCE(invoice_issuer.email, '') ILIKE $${payPc}
          OR COALESCE(payment_creator.full_name, '') ILIKE $${payPc}
          OR COALESCE(payment_creator.email, '') ILIKE $${payPc}
          OR COALESCE(returner.full_name, '') ILIKE $${payPc}
        )`;
        payParams.push(`%${searchTerm}%`);
      }

      paySql += ` ORDER BY p.issue_date DESC, p.payment_id DESC`;

      const payRes = await query(paySql, payParams);
      const paymentRows = (payRes.rows || []).map((row) => {
        let studentName = row.student_name;
        let studentEmail = row.student_email;
        const isWalkIn = (studentEmail || '').toLowerCase() === 'walkin@merchandise.psms.internal';
        if (isWalkIn && row.ar_prospect_student_name) {
          studentName = row.ar_prospect_student_name;
          studentEmail = null;
        }
        return {
          ...row,
          student_name: studentName,
          student_email: studentEmail,
          source_type: 'PAYMENT',
          source_id: `PAY-${row.payment_id}`,
          sort_id: Number(row.payment_id) || 0,
        };
      });

      // ---------- 2) Unapplied verified AR rows ----------
      let arSql = `SELECT ar.ack_receipt_id,
                          ar.branch_id,
                          ar.prospect_student_name,
                          ar.prospect_student_email,
                          ar.package_name_snapshot,
                          ar.payment_amount,
                          ar.tip_amount,
                          ar.reference_number,
                          ar.payment_attachment_url,
                          ar.level_tag,
                          ar.status,
                          ar.verified_by_user_id,
                          TO_CHAR(ar.verified_at, 'YYYY-MM-DD HH24:MI:SS') as verified_at,
                          TO_CHAR(ar.issue_date, 'YYYY-MM-DD') as issue_date,
                          ar.ack_receipt_number,
                          ar.created_by,
                          creator.full_name AS created_by_name,
                          creator.email AS created_by_email,
                          verifier.full_name AS verified_by_name,
                          verifier.user_type AS verifier_user_type,
                          COALESCE(b.branch_nickname, b.branch_name) AS branch_name
                   FROM acknowledgement_receiptstbl ar
                   LEFT JOIN userstbl creator ON ar.created_by = creator.user_id
                   LEFT JOIN userstbl verifier ON ar.verified_by_user_id = verifier.user_id
                   LEFT JOIN branchestbl b ON ar.branch_id = b.branch_id
                   WHERE ar.ar_type = 'Package'
                     AND ar.status = 'Verified'
                     AND ar.payment_id IS NULL
                     AND ar.invoice_id IS NULL`;
      const arParams = [];
      let arPc = 0;

      if (req.user.userType !== 'Superfinance' && req.user.branchId) {
        arPc++;
        arSql += ` AND ar.branch_id = $${arPc}`;
        arParams.push(req.user.branchId);
      } else if (branch_id) {
        arPc++;
        arSql += ` AND ar.branch_id = $${arPc}`;
        arParams.push(branch_id);
      }

      if (useIssueRange) {
        if (fromTrim) {
          arPc++;
          arSql += ` AND ar.issue_date >= $${arPc}::date`;
          arParams.push(fromTrim);
        }
        if (toTrim) {
          arPc++;
          arSql += ` AND ar.issue_date <= $${arPc}::date`;
          arParams.push(toTrim);
        }
      } else if (issue_date) {
        arPc++;
        arSql += ` AND ar.issue_date = $${arPc}::date`;
        arParams.push(issue_date);
      }

      if (usePaymentDateRange) {
        if (payDateFrom) {
          arPc++;
          arSql += ` AND ${AR_PAYMENT_BUSINESS_DATE_SQL} >= $${arPc}::date`;
          arParams.push(payDateFrom);
        }
        if (payDateTo) {
          arPc++;
          arSql += ` AND ${AR_PAYMENT_BUSINESS_DATE_SQL} <= $${arPc}::date`;
          arParams.push(payDateTo);
        }
      }

      if (useCreatedDateRange) {
        if (createdFrom) {
          arPc++;
          arSql += ` AND ar.issue_date >= $${arPc}::date`;
          arParams.push(createdFrom);
        }
        if (createdTo) {
          arPc++;
          arSql += ` AND ar.issue_date <= $${arPc}::date`;
          arParams.push(createdTo);
        }
      }

      if (searchTerm) {
        arPc++;
        arSql += ` AND (
          ('AR-' || ar.ack_receipt_id::text) ILIKE $${arPc}
          OR ar.ack_receipt_id::text ILIKE $${arPc}
          OR COALESCE(ar.ack_receipt_number, '') ILIKE $${arPc}
          OR COALESCE(ar.prospect_student_name, '') ILIKE $${arPc}
          OR COALESCE(ar.prospect_student_email, '') ILIKE $${arPc}
          OR COALESCE(ar.package_name_snapshot, '') ILIKE $${arPc}
          OR COALESCE(ar.reference_number, '') ILIKE $${arPc}
          OR COALESCE(creator.full_name, '') ILIKE $${arPc}
          OR COALESCE(creator.email, '') ILIKE $${arPc}
          OR COALESCE(verifier.full_name, '') ILIKE $${arPc}
          OR COALESCE(verifier.email, '') ILIKE $${arPc}
        )`;
        arParams.push(`%${searchTerm}%`);
      }

      arSql += ` ORDER BY ar.issue_date DESC, ar.ack_receipt_id DESC`;
      let arRows = [];
      // Unapplied verified package AR: Payment Logs approval only when Finance/Superfinance verified (not Admin).
      const includeUnappliedAr = !pmFilter || pmFilter === 'Acknowledgement Receipt';
      if (includeUnappliedAr) {
        const arRes = await query(arSql, arParams);
        arRows = (arRes.rows || []).map((row) => {
          const plApproval = paymentLogApprovalFromArVerification(row);
          return {
            payment_id: `AR-${row.ack_receipt_id}`,
            invoice_id: null,
            student_id: null,
            branch_id: row.branch_id,
            payment_method: 'Acknowledgement Receipt',
            payment_type: 'Unapplied Acknowledgement Receipt',
            payable_amount: Number(row.payment_amount || 0) + Number(row.tip_amount || 0),
            issue_date: row.issue_date,
            status: 'Verified',
            reference_number: row.reference_number,
            remarks: 'Awaiting enrollment attachment',
            payment_attachment_url: row.payment_attachment_url,
            created_by: row.created_by,
            created_at: null,
            approval_status: plApproval.approval_status,
            approved_by: plApproval.approved_by,
            approved_at: plApproval.approved_at,
            return_reason: null,
            returned_at: null,
            returned_by: null,
            returned_by_name: null,
            student_name: row.prospect_student_name || 'Walk-in / Acknowledgement Receipt',
            student_email: row.prospect_student_email || null,
            student_level_tag: row.level_tag || null,
            invoice_description: row.package_name_snapshot || 'Acknowledgement Receipt (Unapplied)',
            invoice_amount: null,
            invoice_ar_number: row.ack_receipt_number || `AR-${row.ack_receipt_id}`,
            branch_name: row.branch_name,
            approved_by_name: plApproval.approved_by_name,
            payment_created_by_name: row.created_by_name || null,
            payment_created_by_email: row.created_by_email || null,
            invoice_issued_by_name: null,
            invoice_issued_by_email: null,
            ar_prospect_student_name: row.prospect_student_name || null,
            source_type: 'UNAPPLIED_AR',
            source_id: `AR-${row.ack_receipt_id}`,
            sort_id: Number(row.ack_receipt_id) || 0,
          };
        });
        if (approvalStatusFilter === 'Approved') {
          arRows = arRows.filter((r) => r.approval_status === 'Approved');
        } else if (pendingOnly) {
          arRows = arRows.filter((r) => r.approval_status !== 'Approved');
        }
      }

      // ---------- 3) Merge, sort, paginate ----------
      const merged = [...paymentRows, ...arRows].sort((a, b) => {
        const dateA = String(a.issue_date || '');
        const dateB = String(b.issue_date || '');
        if (dateA !== dateB) return dateA < dateB ? 1 : -1;
        return (b.sort_id || 0) - (a.sort_id || 0);
      });

      const total = merged.length;
      const pageData = merged.slice(offset, offset + limitNum).map(({ sort_id, ...rest }) => rest);

      // List header total: payment rows only (unapplied AR rows are omitted; use AR dashboard cards for those).
      const filterTotalLineAmount = paymentRows.reduce(
        (s, r) => s + (Number(r.payable_amount) || 0) + (Number(r.tip_amount) || 0),
        0,
      );

      return res.json({
        success: true,
        data: pageData,
        filterTotalLineAmount,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum) || 1,
        },
      });
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * GET /api/sms/payments/cash-deposit-summary
 * Cash payment lines for the branch admin "Deposit Cash" preview, filtered by
 * the same **payment date** semantics as Payment Logs (`payment_date_from` /
 * `payment_date_to` map to `PAYMENT_LOG_BUSINESS_DATE_SQL` / `paymenttbl.issue_date`).
 *
 * Pass **either** `payment_date_from` + `payment_date_to` **or** `start_date` +
 * `end_date` (legacy aliases; same inclusive range). If both pairs are sent,
 * `payment_date_*` wins.
 *
 * Restricted to Cash; excludes finance-rejected rows; splits pending vs
 * `already_deposited_payments` using cash_deposit_summary snapshots.
 */
router.get(
  '/cash-deposit-summary',
  [
    queryValidator('start_date').optional().isISO8601().withMessage('start_date must be YYYY-MM-DD'),
    queryValidator('end_date').optional().isISO8601().withMessage('end_date must be YYYY-MM-DD'),
    queryValidator('payment_date_from')
      .optional()
      .isISO8601()
      .withMessage('payment_date_from must be YYYY-MM-DD'),
    queryValidator('payment_date_to')
      .optional()
      .isISO8601()
      .withMessage('payment_date_to must be YYYY-MM-DD'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const sliceYmd = (v) => (v != null ? String(v).trim().slice(0, 10) : '');
      const payFrom = sliceYmd(req.query.payment_date_from);
      const payTo = sliceYmd(req.query.payment_date_to);
      const legacyStart = sliceYmd(req.query.start_date);
      const legacyEnd = sliceYmd(req.query.end_date);
      const ymdOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

      let start;
      let end;
      if (ymdOk(payFrom) && ymdOk(payTo)) {
        start = payFrom;
        end = payTo;
      } else if (ymdOk(legacyStart) && ymdOk(legacyEnd)) {
        start = legacyStart;
        end = legacyEnd;
      } else {
        return res.status(400).json({
          success: false,
          message:
            'Provide payment_date_from and payment_date_to (same as Payment Logs), or start_date and end_date (YYYY-MM-DD each).',
        });
      }

      if (start > end) {
        return res.status(400).json({
          success: false,
          message: 'Payment date range: from must be on or before to.',
        });
      }

      const paymentDateSql = PAYMENT_LOG_BUSINESS_DATE_SQL;

      const selectCols = `SELECT p.payment_id, p.invoice_id, p.student_id, p.branch_id,
                        p.payment_method, p.payment_type, p.payable_amount, COALESCE(p.discount_amount, 0) AS discount_amount,
                        COALESCE(p.tip_amount, 0) AS tip_amount,
                        TO_CHAR(p.issue_date, 'YYYY-MM-DD') as issue_date,
                        p.status, p.reference_number, p.remarks, p.payment_attachment_url, p.created_by,
                        TO_CHAR(p.created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at,
                        p.approval_status, p.approved_by,
                        TO_CHAR(p.approved_at, 'YYYY-MM-DD HH24:MI:SS') as approved_at,
                        u.full_name as student_name, u.email as student_email,
                        i.invoice_description, i.amount as invoice_amount,
                        COALESCE(i.amount, 0) + COALESCE((
                          SELECT SUM(COALESCE(px.tip_amount, 0))
                          FROM paymenttbl px
                          WHERE px.invoice_id = p.invoice_id
                            AND px.status = 'Completed'
                        ), 0) AS invoice_total_amount,
                        i.invoice_ar_number AS invoice_ar_number,
                        COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
                        approver.full_name as approved_by_name,
                        ar.prospect_student_name as ar_prospect_student_name`;

      const joins = `FROM paymenttbl p
                 LEFT JOIN userstbl u ON p.student_id = u.user_id
                 LEFT JOIN invoicestbl i ON p.invoice_id = i.invoice_id
                 LEFT JOIN branchestbl b ON p.branch_id = b.branch_id
                 LEFT JOIN userstbl approver ON p.approved_by = approver.user_id
                 LEFT JOIN acknowledgement_receiptstbl ar ON ar.payment_id = p.payment_id`;

      const baseWhere = `WHERE ${paymentDateSql} >= $1::date AND ${paymentDateSql} <= $2::date
                   AND LOWER(TRIM(p.payment_method)) = 'cash'
                   AND COALESCE(p.approval_status, 'Pending') <> 'Rejected'`;

      const notYetDepositedClause = `AND NOT EXISTS (
                     SELECT 1
                     FROM cash_deposit_summarytbl c
                     CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.cash_payment_snapshot, '[]'::jsonb)) deposited(payment_row)
                     WHERE c.branch_id = p.branch_id
                       AND c.status IN ('Pending', 'Submitted', 'Approved')
                       AND p.issue_date >= c.start_date::date
                       AND p.issue_date <= c.end_date::date
                       AND deposited.payment_row ? 'payment_id'
                       AND (deposited.payment_row->>'payment_id') ~ '^[0-9]+$'
                       AND (deposited.payment_row->>'payment_id')::int = p.payment_id
                   )`;

      const params = [start, end];
      let paramCount = 2;
      let branchClause = '';
      if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        paramCount++;
        branchClause = ` AND p.branch_id = $${paramCount}`;
        params.push(req.user.branchId);
      }

      let sql = `${selectCols}
                 ${joins}
                 ${baseWhere}
                 ${notYetDepositedClause}${branchClause}
                 ORDER BY ${paymentDateSql} ASC, p.payment_id ASC`;

      const result = await query(sql, params);

      let sqlAlready = `${selectCols},
                        dep.cash_deposit_summary_id AS deposit_summary_id,
                        dep.deposit_status AS deposit_summary_status,
                        dep.deposit_start AS deposit_summary_start_date,
                        dep.deposit_end AS deposit_summary_end_date
                 ${joins}
                 INNER JOIN LATERAL (
                   SELECT c.cash_deposit_summary_id,
                          c.status AS deposit_status,
                          TO_CHAR(c.start_date, 'YYYY-MM-DD') AS deposit_start,
                          TO_CHAR(c.end_date, 'YYYY-MM-DD') AS deposit_end
                   FROM cash_deposit_summarytbl c
                   CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.cash_payment_snapshot, '[]'::jsonb)) deposited(payment_row)
                   WHERE c.branch_id = p.branch_id
                     AND c.status IN ('Pending', 'Submitted', 'Approved')
                     AND p.issue_date >= c.start_date::date
                     AND p.issue_date <= c.end_date::date
                     AND deposited.payment_row ? 'payment_id'
                     AND (deposited.payment_row->>'payment_id') ~ '^[0-9]+$'
                     AND (deposited.payment_row->>'payment_id')::int = p.payment_id
                   ORDER BY c.submitted_at DESC NULLS LAST, c.cash_deposit_summary_id DESC
                   LIMIT 1
                 ) dep ON true
                 ${baseWhere}${branchClause}
                 ORDER BY ${paymentDateSql} ASC, p.payment_id ASC`;

      const alreadyResult = await query(sqlAlready, params);

      const mapCashDepositRow = (row) => {
        let studentName = row.student_name;
        let studentEmail = row.student_email;
        const isWalkIn = (studentEmail || '').toLowerCase() === 'walkin@merchandise.psms.internal';
        const prospectName = row.ar_prospect_student_name || null;
        if (isWalkIn && prospectName) {
          studentName = prospectName;
          studentEmail = null;
        }
        const out = {
          ...row,
          student_name: studentName,
          student_email: studentEmail,
        };
        if (row.deposit_summary_id != null) {
          out.deposit_summary_id = row.deposit_summary_id;
          out.deposit_summary_status = row.deposit_summary_status;
          out.deposit_summary_start_date = row.deposit_summary_start_date;
          out.deposit_summary_end_date = row.deposit_summary_end_date;
        }
        return out;
      };

      const payments = [];
      let totalCompleted = 0;
      let totalAll = 0;
      let completedCount = 0;

      for (const row of result.rows) {
        const mapped = mapCashDepositRow(row);
        const lineAmount =
          (parseFloat(mapped.payable_amount) || 0) + (parseFloat(mapped.tip_amount) || 0);
        totalAll += lineAmount;
        if (mapped.status === 'Completed') {
          totalCompleted += lineAmount;
          completedCount += 1;
        }
        payments.push(mapped);
      }

      const alreadyDepositedPayments = (alreadyResult.rows || []).map((row) => mapCashDepositRow(row));

      res.json({
        success: true,
        data: {
          start_date: start,
          end_date: end,
          payment_date_from: start,
          payment_date_to: end,
          payment_count: payments.length,
          completed_cash_count: completedCount,
          total_cash_all_amount: Math.round(totalAll * 100) / 100,
          total_cash_deposit_amount: Math.round(totalCompleted * 100) / 100,
          payments,
          already_deposited_payments: alreadyDepositedPayments,
          already_deposited_count: alreadyDepositedPayments.length,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/sms/payments/:id
 * Get payment by ID
 * Access: All authenticated users
 */
router.get(
  '/:id',
  [
    param('id').isInt().withMessage('Payment ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const result = await query(
        `SELECT p.payment_id, p.invoice_id, p.student_id, p.branch_id, 
                p.payment_method, p.payment_type, p.payable_amount, COALESCE(p.discount_amount, 0) AS discount_amount, 
                TO_CHAR(p.issue_date, 'YYYY-MM-DD') as issue_date, 
                p.status, p.reference_number, p.remarks, p.payment_attachment_url, p.created_by,
                TO_CHAR(p.created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at,
                u.full_name as student_name, u.email as student_email,
                i.invoice_description, i.amount as invoice_amount,
                COALESCE(i.amount, 0) + COALESCE((
                  SELECT SUM(COALESCE(px.tip_amount, 0))
                  FROM paymenttbl px
                  WHERE px.invoice_id = p.invoice_id
                    AND px.status = 'Completed'
                ), 0) AS invoice_total_amount,
                i.invoice_ar_number AS invoice_ar_number,
                COALESCE(b.branch_nickname, b.branch_name) AS branch_name
         FROM paymenttbl p
         LEFT JOIN userstbl u ON p.student_id = u.user_id
         LEFT JOIN invoicestbl i ON p.invoice_id = i.invoice_id
         LEFT JOIN branchestbl b ON p.branch_id = b.branch_id
         WHERE p.payment_id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Payment not found',
        });
      }

      // Check branch access
      const payment = result.rows[0];
      if (req.user.userType !== 'Superadmin' && req.user.branchId && payment.branch_id !== req.user.branchId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied',
        });
      }

      res.json({
        success: true,
        data: payment,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/sms/payments/invoice/:invoice_id
 * Get all payments for a specific invoice
 * Access: All authenticated users
 */
router.get(
  '/invoice/:invoice_id',
  [
    param('invoice_id').isInt().withMessage('Invoice ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { invoice_id } = req.params;

      const result = await query(
        `SELECT p.payment_id, p.invoice_id, p.student_id, p.branch_id, 
                p.payment_method, p.payment_type, p.payable_amount, COALESCE(p.discount_amount, 0) AS discount_amount, 
                TO_CHAR(p.issue_date, 'YYYY-MM-DD') as issue_date, 
                p.status, p.reference_number, p.remarks, p.created_by,
                TO_CHAR(p.created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at,
                u.full_name as student_name, u.email as student_email,
                i.invoice_ar_number AS invoice_ar_number
         FROM paymenttbl p
         LEFT JOIN userstbl u ON p.student_id = u.user_id
         LEFT JOIN invoicestbl i ON p.invoice_id = i.invoice_id
         WHERE p.invoice_id = $1
         ORDER BY p.payment_id DESC`,
        [invoice_id]
      );

      res.json({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/sms/payments
 * Create new payment
 * Access: Superadmin, Admin
 */
router.post(
  '/',
  [
    body('invoice_id').isInt().withMessage('Invoice ID is required and must be an integer'),
    body('student_id').isInt().withMessage('Student ID is required and must be an integer'),
    body('payment_method').notEmpty().isString().withMessage('Payment method is required'),
    body('payment_type').notEmpty().isString().withMessage('Payment type is required'),
    body('payable_amount').isFloat({ min: 0.01 }).withMessage('Payable amount is required and must be greater than 0'),
    body('discount_amount').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Discount amount must be 0 or greater'),
    body('tip_amount').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Tip amount must be 0 or greater'),
    body('issue_date').isISO8601().withMessage('Issue date is required and must be a valid date'),
    body('status').optional().isString().withMessage('Status must be a string'),
    body('reference_number').notEmpty().trim().isString().withMessage('Reference number is required'),
    body('remarks').optional().isString().withMessage('Remarks must be a string'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Finance', 'Superfinance'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const {
        invoice_id,
        student_id,
        payment_method,
        payment_type,
        payable_amount,
        discount_amount,
        tip_amount,
        issue_date,
        status = 'Completed',
        reference_number,
        remarks,
        attachment_url,
      } = req.body;

      // Verify invoice exists (include ack_receipt_id for merchandise AR stock deduction)
      const invoiceCheck = await client.query(
        'SELECT *, installmentinvoiceprofiles_id, ack_receipt_id FROM invoicestbl WHERE invoice_id = $1',
        [invoice_id]
      );
      if (invoiceCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Invoice not found',
        });
      }

      const invoice = invoiceCheck.rows[0];

      if (invoice.status === 'Paid') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Cannot record payment: this invoice is already fully paid.',
        });
      }

      if (invoice.balance_invoice_id) {
        await client.query('ROLLBACK');
        const tip = await client.query(
          `SELECT invoice_description FROM invoicestbl WHERE invoice_id = $1`,
          [invoice.balance_invoice_id]
        );
        const lab = tip.rows[0]?.invoice_description || `INV-${invoice.balance_invoice_id}`;
        return res.status(400).json({
          success: false,
          message: `This invoice is closed for new payments. Record payments on ${lab} (balance invoice).`,
        });
      }

      // Verify student exists
      const studentCheck = await client.query('SELECT * FROM userstbl WHERE user_id = $1', [student_id]);
      if (studentCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Student not found',
        });
      }

      // Verify student is associated with the invoice
      const invoiceStudentCheck = await client.query(
        'SELECT * FROM invoicestudentstbl WHERE invoice_id = $1 AND student_id = $2',
        [invoice_id, student_id]
      );
      if (invoiceStudentCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Student is not associated with this invoice',
        });
      }

      // Get branch_id from invoice
      const branch_id = invoice.branch_id || req.user.branchId || null;

      // Verify branch exists if provided
      if (branch_id) {
        const branchCheck = await client.query('SELECT branch_id FROM branchestbl WHERE branch_id = $1', [branch_id]);
        if (branchCheck.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({
            success: false,
            message: 'Branch not found',
          });
        }
      }

      // Get created_by from authenticated user
      const createdBy = req.user.userId || null;
      const actionOwnerUserId =
        invoice.created_by != null ? invoice.created_by : createdBy;

      const hasActionOwnerCol = await paymenttblHasActionOwnerUserIdColumn();
      const normalizedDiscountAmount = Math.max(0, parseFloat(discount_amount || 0) || 0);

      // Create payment
      const paymentResult = hasActionOwnerCol
        ? await client.query(
            `INSERT INTO paymenttbl (invoice_id, student_id, branch_id, payment_method, payment_type, 
                                 payable_amount, discount_amount, tip_amount, issue_date, status, reference_number, remarks, created_by, payment_attachment_url, action_owner_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING *`,
            [
              invoice_id,
              student_id,
              branch_id,
              payment_method,
              payment_type,
              payable_amount,
              normalizedDiscountAmount,
              tip_amount || 0,
              issue_date,
              status,
              reference_number || null,
              remarks || null,
              createdBy,
              attachment_url || null,
              actionOwnerUserId,
            ]
          )
        : await client.query(
            `INSERT INTO paymenttbl (invoice_id, student_id, branch_id, payment_method, payment_type, 
                                 payable_amount, discount_amount, tip_amount, issue_date, status, reference_number, remarks, created_by, payment_attachment_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING *`,
            [
              invoice_id,
              student_id,
              branch_id,
              payment_method,
              payment_type,
              payable_amount,
              normalizedDiscountAmount,
              tip_amount || 0,
              issue_date,
              status,
              reference_number || null,
              remarks || null,
              createdBy,
              attachment_url || null,
            ]
          );

      const newPayment = paymentResult.rows[0];

      const totalPaymentsResult = await client.query(
        `SELECT COALESCE(SUM(payable_amount), 0) as total_paid,
                COALESCE(SUM(COALESCE(payable_amount, 0) + COALESCE(discount_amount, 0)), 0) as total_settled
         FROM paymenttbl
         WHERE invoice_id = $1
           AND status = $2
           AND COALESCE(approval_status, 'Pending') <> 'Rejected'`,
        [invoice_id, 'Completed']
      );
      const totalPaid = parseFloat(totalPaymentsResult.rows[0].total_paid) || 0;
      const totalSettled = parseFloat(totalPaymentsResult.rows[0].total_settled) || totalPaid;
      const currentSettlementAmount = (parseFloat(payable_amount) || 0) + normalizedDiscountAmount;

      const { originalInvoiceAmount } = await computeOriginalInvoiceAmount(
        client,
        invoice_id,
        invoice,
        totalSettled,
        currentSettlementAmount
      );

      const remainingBalance = Math.max(0, originalInvoiceAmount - totalSettled);

      let newInvoiceStatus = invoice.status;
      let createdBalanceInvoiceId = null;

      const isPartialPaymentType = String(payment_type || '').trim() === 'Partial Payment';

      if (isPartialPaymentType && remainingBalance > 0.01) {
        const { balance_invoice_id } = await createBalanceInvoiceFromPartial({
          client,
          parentInvoice: invoice,
          remainingBalance,
          createdBy,
          issueDateYmd: formatYmdLocal(new Date(issue_date)),
        });
        createdBalanceInvoiceId = balance_invoice_id;
        newInvoiceStatus = 'Partially Paid';
      } else {
        await client.query('UPDATE invoicestbl SET amount = $1 WHERE invoice_id = $2', [
          remainingBalance,
          invoice_id,
        ]);

        if (totalSettled >= originalInvoiceAmount) {
          newInvoiceStatus = 'Paid';
        } else if (totalSettled > 0) {
          newInvoiceStatus = 'Partially Paid';
        } else {
          const hasRejectedPayment = await invoiceHasRejectedPayment(client, invoice_id);
          if (hasRejectedPayment) {
            newInvoiceStatus = 'Rejected';
          } else if (invoice.status === 'Paid' || invoice.status === 'Partially Paid') {
            newInvoiceStatus = 'Unpaid';

            if (
              !invoice.installmentinvoiceprofiles_id &&
              invoice.invoice_description &&
              !invoice.invoice_description.includes('Reservation Fee')
            ) {
              try {
                const invoiceStudentResult = await client.query(
                  `SELECT ist.student_id
                   FROM invoicestudentstbl ist
                   WHERE ist.invoice_id = $1
                   LIMIT 1`,
                  [invoice_id]
                );

                if (invoiceStudentResult.rows.length > 0) {
                  const invoiceStudentId = invoiceStudentResult.rows[0].student_id;

                  const enrollmentResult = await client.query(
                    `SELECT cs.classstudent_id, cs.class_id, cs.phase_number, cs.student_id, cs.enrolled_at
                     FROM classstudentstbl cs
                     WHERE cs.student_id = $1
                       AND cs.enrolled_at >= $2::date - INTERVAL '24 hours'
                       AND cs.enrolled_at <= $2::date + INTERVAL '24 hours'
                     ORDER BY cs.enrolled_at DESC`,
                    [invoiceStudentId, invoice.issue_date]
                  );

                  for (const enrollment of enrollmentResult.rows) {
                    await client.query(`DELETE FROM classstudentstbl WHERE classstudent_id = $1`, [
                      enrollment.classstudent_id,
                    ]);
                    console.log(
                      `⚠️ Student ${enrollment.student_id} removed from class ${enrollment.class_id}, phase ${enrollment.phase_number} due to unpaid package price invoice`
                    );
                  }
                }
              } catch (removalError) {
                console.error('Error removing student enrollment due to unpaid invoice:', removalError);
              }
            }
          }
        }

        if (newInvoiceStatus !== invoice.status) {
          await client.query('UPDATE invoicestbl SET status = $1 WHERE invoice_id = $2', [
            newInvoiceStatus,
            invoice_id,
          ]);
        }
      }

      // ── AR-linked invoice: finalize AR status when invoice is fully paid ──
      if (newInvoiceStatus === 'Paid' && invoice.ack_receipt_id) {
        try {
          const ackResult = await client.query(
            `SELECT ar_type, merchandise_items_snapshot FROM acknowledgement_receiptstbl WHERE ack_receipt_id = $1`,
            [invoice.ack_receipt_id]
          );
          if (ackResult.rows.length > 0) {
            const ackRow = ackResult.rows[0];
            if (ackRow.ar_type === 'Merchandise') {
              const items = ackRow.merchandise_items_snapshot;
              if (items && Array.isArray(items)) {
                for (const item of items) {
                  const merchId = item.merchandise_id;
                  const qty = parseInt(item.quantity, 10) || 1;
                  await client.query(
                    `UPDATE merchandisestbl SET quantity = GREATEST(0, COALESCE(quantity, 0) - $1) WHERE merchandise_id = $2`,
                    [qty, merchId]
                  );
                  console.log(`✅ Merchandise AR payment: deducted ${qty} from merchandise_id ${merchId}`);
                }
              }
              await client.query(
                `UPDATE acknowledgement_receiptstbl SET status = 'Paid', payment_id = $1 WHERE ack_receipt_id = $2`,
                [newPayment.payment_id, invoice.ack_receipt_id]
              );
            } else {
              // Package ARs become Applied once converted into an actual invoice payment.
              await client.query(
                `UPDATE acknowledgement_receiptstbl SET status = 'Applied', payment_id = $1 WHERE ack_receipt_id = $2`,
                [newPayment.payment_id, invoice.ack_receipt_id]
              );
            }
          }
        } catch (merchErr) {
          console.error('Error deducting merchandise stock for AR payment:', merchErr);
        }
      }

      // Check if this invoice is linked to a reservation
      // If yes, and invoice is now fully paid, update reservation status to "Fee Paid"
      // Note: Student is NOT auto-enrolled here. Enrollment only happens when reservation is upgraded.
      if (newInvoiceStatus === 'Paid') {
        const reservationChainRootId = await getChainRootInvoiceId(client, invoice_id);
        const reservationCheck = await client.query(
          `SELECT r.reserved_id, r.status, r.student_id, r.class_id, r.phase_number, r.branch_id
           FROM reservedstudentstbl r
           WHERE r.invoice_id = $1 OR r.invoice_id = $2`,
          [invoice_id, reservationChainRootId]
        );
        
        if (reservationCheck.rows.length > 0) {
          const reservation = reservationCheck.rows[0];
          // Only update if reservation is still in "Reserved" status
          if (reservation.status === 'Reserved') {
            await client.query(
              `UPDATE reservedstudentstbl 
               SET status = 'Fee Paid', reservation_fee_paid_at = CURRENT_TIMESTAMP
               WHERE reserved_id = $1`,
              [reservation.reserved_id]
            );
            console.log(`✅ Reservation ${reservation.reserved_id} status updated to "Fee Paid" after payment`);
            // Note: Student is NOT auto-enrolled here. Enrollment only happens when reservation is upgraded.
          }
        }
      }

      // Check if this is a downpayment invoice payment
      // If yes, mark downpayment as paid and create first installment invoice record
      if (newInvoiceStatus === 'Paid' && invoice.installmentinvoiceprofiles_id) {
        try {
          if (isRejoinClassInvoice(invoice.remarks)) {
            let rejoinClassId = null;
            if (invoice.remarks && invoice.remarks.includes('CLASS_ID:')) {
              const classMatch = invoice.remarks.match(/CLASS_ID:(\d+)/);
              if (classMatch) rejoinClassId = parseInt(classMatch[1], 10);
            }
            const rejoinPhase = parseRejoinPhaseFromRemarks(invoice.remarks);
            if (rejoinClassId && rejoinPhase) {
              await enrollStudentForFullPaymentPhases({
                client,
                studentId: student_id,
                classId: rejoinClassId,
                phaseStart: rejoinPhase,
                phaseEnd: rejoinPhase,
                sourceLabel: 'System (Auto-enrolled via rejoin payment)',
              });
              await syncInstallmentProfileForRejoinInvoice({
                client,
                invoice,
                studentId: student_id,
              });
            }
          } else {
              // Get installment invoice profile to check if this is a downpayment invoice
              const profileResult = await client.query(
                `SELECT ip.class_id, ip.student_id, ip.total_phases, ip.generated_count, 
                    ip.downpayment_paid, ip.downpayment_invoice_id, ip.amount, ip.frequency,
                    ip.first_generation_date, ip.next_invoice_due_date, ip.bill_invoice_due_date,
                    ip.branch_id, ip.package_id, ip.description, ip.phase_start
             FROM installmentinvoiceprofilestbl ip
             WHERE ip.installmentinvoiceprofiles_id = $1`,
                [invoice.installmentinvoiceprofiles_id]
              );

          if (profileResult.rows.length > 0) {
            const profile = profileResult.rows[0];
            
            // Treat as downpayment if: (a) profile explicitly links this invoice, OR (b) profile has no downpayment_invoice_id set
            // (e.g. reservation flow) and this is the first payment - then backfill and proceed
            const isDownpaymentInvoice = Number(profile.downpayment_invoice_id) === Number(invoice_id);
            const isFirstLinkedInvoice = !profile.downpayment_invoice_id && !profile.downpayment_paid && (profile.generated_count || 0) === 0;
            
            if ((isDownpaymentInvoice || isFirstLinkedInvoice) && !profile.downpayment_paid) {
              // Backfill downpayment_invoice_id if profile never had it set (e.g. from reservation upgrade)
              if (!profile.downpayment_invoice_id) {
                await client.query(
                  `UPDATE installmentinvoiceprofilestbl SET downpayment_invoice_id = $1 WHERE installmentinvoiceprofiles_id = $2`,
                  [invoice_id, invoice.installmentinvoiceprofiles_id]
                );
              }
              // Mark downpayment as paid
              await client.query(
                `UPDATE installmentinvoiceprofilestbl 
                 SET downpayment_paid = true 
                 WHERE installmentinvoiceprofiles_id = $1`,
                [invoice.installmentinvoiceprofiles_id]
              );
              
              // Get student name for installment invoice record
              const studentResult = await client.query(
                'SELECT full_name FROM userstbl WHERE user_id = $1',
                [student_id]
              );
              const studentName = studentResult.rows[0]?.full_name || 'Student';
              
              const { firstInvoiceRecord } = await createFirstInstallmentRecordAfterDownpayment({
                client,
                profileId: invoice.installmentinvoiceprofiles_id,
                profile,
                studentName,
                paymentIssueDate: issue_date,
              });
              
              console.log(`✅ Downpayment paid: Created first installment invoice record for profile ${invoice.installmentinvoiceprofiles_id}`);
              
              // Store invoice generation data to process after transaction commits
              // This avoids transaction conflicts
              const invoiceGenData = {
                firstInvoiceRecord,
                profile: {
                  student_id: profile.student_id,
                  branch_id: profile.branch_id || invoice.branch_id || null,
                  package_id: profile.package_id || invoice.package_id || null,
                  amount: profile.amount,
                  frequency: profile.frequency || '1 month(s)',
                  description: profile.description || 'Monthly Installment Payment',
                  generated_count: profile.generated_count || 0,
                  class_id: profile.class_id,
                  total_phases: profile.total_phases,
                  phase_start: profile.phase_start,
                },
                profileId: invoice.installmentinvoiceprofiles_id
              };
              
              await ensurePendingEnrollmentAfterDownpaymentPaid(client, profile, student_id);

              const downpaymentMerchIssue = await tryIssuePackageMerchandiseOnFirstPayment(client, {
                invoice: { ...invoice, package_id: invoice.package_id || profile.package_id },
                studentId: student_id,
                paymentId: newPayment.payment_id,
                paymentIssueDate: issue_date,
                createdBy: req.user.userId || req.user.user_id || null,
              });
              if (downpaymentMerchIssue.issued) {
                console.log(
                  `✅ Package merchandise issued on downpayment (payment ${newPayment.payment_id})`
                );
              }
              
              // Skip the rest of the installment payment logic since this is just the downpayment
              // The actual installment invoices will be handled separately
              
              // Generate invoice after transaction commits (to avoid conflicts)
              // This will be done in a separate async operation after COMMIT
              if (invoiceGenData) {
                // Store for processing after commit
                req._pendingInvoiceGeneration = invoiceGenData;
              }
            } else {
              // This is a regular installment invoice payment (not downpayment)
              // Continue with existing logic
              
              // Only proceed if we have class_id and student_id matches
              if (profile.class_id && profile.student_id === student_id) {
                await syncInstallmentEnrollmentForPaidInvoice({
                  client,
                  profileId: invoice.installmentinvoiceprofiles_id,
                  profile,
                  studentId: student_id,
                  sourceLabel: 'System (Auto-enrolled via installment payment)',
                  invoice,
                });

                const installmentMerchIssue = await tryIssuePackageMerchandiseOnFirstPayment(client, {
                  invoice: { ...invoice, package_id: invoice.package_id || profile.package_id },
                  studentId: student_id,
                  paymentId: newPayment.payment_id,
                  paymentIssueDate: issue_date,
                  createdBy: req.user.userId || req.user.user_id || null,
                });
                if (installmentMerchIssue.issued) {
                  console.log(
                    `✅ Package merchandise issued on installment payment (payment ${newPayment.payment_id})`
                  );
                }
              }
            }
          }
          }
        } catch (phaseError) {
          // Log error but don't fail payment processing
          console.error('Error processing installment payment:', phaseError);
        }
      }

      if (newInvoiceStatus === 'Paid' && !invoice.installmentinvoiceprofiles_id) {
        try {
          await promotePendingEnrollmentIfPhaseInvoicePaid(client, {
            studentId: student_id,
            invoice: { ...invoice, status: newInvoiceStatus },
            sourceLabel: 'System (Auto-enrolled via installment payment)',
          });

          const phasePayMerchIssue = await tryIssuePackageMerchandiseOnFirstPayment(client, {
            invoice: { ...invoice, status: newInvoiceStatus },
            studentId: student_id,
            paymentId: newPayment.payment_id,
            paymentIssueDate: issue_date,
            createdBy: req.user.userId || req.user.user_id || null,
          });
          if (phasePayMerchIssue.issued) {
            console.log(
              `✅ Package merchandise issued on phase invoice payment (payment ${newPayment.payment_id})`
            );
          }
        } catch (promoteErr) {
          console.error('Error promoting pending enrollment after payment:', promoteErr);
        }
      }
      
      // Check if this is a full payment invoice (not installment, not reservation fee)
      // If yes, and invoice is now fully paid, enroll student in all phases
      // For Phase packages, only enroll in the specified phase range (PHASE_START/PHASE_END in remarks)
      if (newInvoiceStatus === 'Paid' && 
          !invoice.installmentinvoiceprofiles_id && 
          invoice.invoice_description && 
          !invoice.invoice_description.includes('Reservation Fee')) {
        try {
          // Get class_id from invoice remarks field (stored as CLASS_ID:class_id)
          let classId = null;
          if (invoice.remarks && invoice.remarks.includes('CLASS_ID:')) {
            const match = invoice.remarks.match(/CLASS_ID:(\d+)/);
            if (match) {
              classId = parseInt(match[1]);
            }
          }
          
          if (classId) {
            // Get class and curriculum info
            const classResult = await client.query(
              `SELECT c.class_id, c.program_id, cu.number_of_phase
               FROM classestbl c
               LEFT JOIN programstbl p ON c.program_id = p.program_id
               LEFT JOIN curriculumstbl cu ON p.curriculum_id = cu.curriculum_id
               WHERE c.class_id = $1`,
              [classId]
            );
            
            if (classResult.rows.length > 0) {
              const classData = classResult.rows[0];
              const totalPhases = classData.number_of_phase || 1;
              
              // Determine phase range for enrollment
              // Default: 1..totalPhases (full payment for entire class)
              // Phase packages: override using PHASE_START / PHASE_END from remarks
              let phaseStart = 1;
              let phaseEnd = totalPhases;
              if (invoice.remarks && invoice.remarks.includes('PHASE_START:')) {
                const startMatch = invoice.remarks.match(/PHASE_START:(\d+)/);
                if (startMatch) {
                  phaseStart = parseInt(startMatch[1]) || 1;
                }
              }
              if (invoice.remarks && invoice.remarks.includes('PHASE_END:')) {
                const endMatch = invoice.remarks.match(/PHASE_END:(\d+)/);
                if (endMatch) {
                  phaseEnd = parseInt(endMatch[1]) || phaseStart;
                }
              }
              // Clamp to valid range
              if (phaseStart < 1) phaseStart = 1;
              if (phaseEnd > totalPhases) phaseEnd = totalPhases;
              if (phaseEnd < phaseStart) phaseEnd = phaseStart;
              
              const changedPhaseRows = await enrollStudentForFullPaymentPhases({
                client,
                studentId: student_id,
                classId,
                phaseStart,
                phaseEnd,
                sourceLabel: 'System (Auto-enrolled via full payment)',
              });

              if (changedPhaseRows > 0) {
                console.log(`✅ Full payment: Auto-enrolled/reactivated ${changedPhaseRows} phase row(s) for student ${student_id} in phases ${phaseStart}-${phaseEnd} of class ${classId} after payment`);
              }

              const fullPayMerchIssue = await tryIssuePackageMerchandiseOnFirstPayment(client, {
                invoice,
                studentId: student_id,
                paymentId: newPayment.payment_id,
                paymentIssueDate: issue_date,
                createdBy: req.user.userId || req.user.user_id || null,
              });
              if (fullPayMerchIssue.issued) {
                console.log(
                  `✅ Package merchandise issued on full payment (payment ${newPayment.payment_id})`
                );
              }

              await syncInstallmentProfileForRejoinInvoice({
                client,
                invoice,
                studentId: student_id,
              });
            }
          }
        } catch (fullPaymentError) {
          // Log error but don't fail payment processing
          console.error('Error auto-enrolling student for full payment:', fullPaymentError);
        }
      }

      await syncProgramPaymentStatusForInvoice(client, invoice_id);
      if (createdBalanceInvoiceId) {
        await syncProgramPaymentStatusForInvoice(client, createdBalanceInvoiceId);
      }

      await client.query('COMMIT');

      // Generate first installment invoice after transaction commits (if downpayment was paid)
      if (req._pendingInvoiceGeneration) {
        const { firstInvoiceRecord, profile, profileId } = req._pendingInvoiceGeneration;
        // Process asynchronously so it doesn't block the response
        (async () => {
          try {
            const { generateInvoiceFromInstallment } = await import('../utils/installmentInvoiceGenerator.js');
            
            // Generate the first installment invoice immediately (so it appears in invoice page)
            const generatedInvoice = await generateInvoiceFromInstallment(firstInvoiceRecord, profile);
            
            console.log(`✅ Downpayment paid: Generated first installment invoice ${generatedInvoice.invoice_id} for profile ${profileId}`);
          } catch (invoiceGenError) {
            // Log error but don't fail the payment - invoice generation can be retried
            console.error(`⚠️ Error generating first installment invoice for profile ${profileId}:`, invoiceGenError);
            // The installment invoice record is already created, so it can be generated later by the cron job
          }
        })();
        delete req._pendingInvoiceGeneration;
      }

      // Fetch the complete payment with related data
      const paymentWithDetails = await query(
        `SELECT p.payment_id, p.invoice_id, p.student_id, p.branch_id, 
                p.payment_method, p.payment_type, p.payable_amount, COALESCE(p.discount_amount, 0) AS discount_amount, 
                COALESCE(p.tip_amount, 0) AS tip_amount,
                TO_CHAR(p.issue_date, 'YYYY-MM-DD') as issue_date, 
                p.status, p.reference_number, p.remarks, p.payment_attachment_url, p.created_by,
                TO_CHAR(p.created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at,
                u.full_name as student_name, u.email as student_email,
                i.invoice_description, i.amount as invoice_amount,
                COALESCE(i.amount, 0) + COALESCE((
                  SELECT SUM(COALESCE(px.tip_amount, 0))
                  FROM paymenttbl px
                  WHERE px.invoice_id = p.invoice_id
                    AND px.status = 'Completed'
                ), 0) AS invoice_total_amount,
                i.invoice_ar_number AS invoice_ar_number,
                COALESCE(b.branch_nickname, b.branch_name) AS branch_name
         FROM paymenttbl p
         LEFT JOIN userstbl u ON p.student_id = u.user_id
         LEFT JOIN invoicestbl i ON p.invoice_id = i.invoice_id
         LEFT JOIN branchestbl b ON p.branch_id = b.branch_id
         WHERE p.payment_id = $1`,
        [newPayment.payment_id]
      );

      const paymentData = paymentWithDetails.rows[0];

      if (newInvoiceStatus === 'Paid' && !createdBalanceInvoiceId) {
        (async () => {
          try {
            const emailClient = await getClient();
            try {
              const summary = await sendInvoicePaymentConfirmationByInvoiceId(emailClient, invoice_id);
              console.log(
                `✅ Invoice payment confirmation email done for invoice ${invoice_id}: ${summary.sent}/${summary.attempted} sent`
              );
            } finally {
              emailClient.release();
            }
          } catch (emailError) {
            console.error(`❌ Error sending invoice payment confirmation for invoice ${invoice_id}:`, emailError);
          }
        })();
      }

      res.status(201).json({
        success: true,
        message: createdBalanceInvoiceId
          ? 'Payment recorded. Remaining balance was moved to a new invoice.'
          : 'Payment created successfully',
        data: {
          ...paymentData,
          ...(createdBalanceInvoiceId ? { balance_invoice_id: createdBalanceInvoiceId } : {}),
        },
      });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally {
      client.release();
    }
  }
);

/**
 * PUT /api/sms/payments/:id
 * Update payment
 * Access: Superadmin, Admin, Finance, Superfinance
 */
router.put(
  '/:id',
  [
    param('id').isInt().withMessage('Payment ID must be an integer'),
    body('payment_method').optional().isString().withMessage('Payment method must be a string'),
    body('payment_type').optional().isString().withMessage('Payment type must be a string'),
    body('payable_amount').optional().isFloat({ min: 0.01 }).withMessage('Payable amount must be greater than 0'),
    body('tip_amount').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Tip amount must be 0 or greater'),
    body('discount_amount').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Discount amount must be 0 or greater'),
    body('issue_date').optional().isISO8601().withMessage('Issue date must be a valid date'),
    body('status').optional().isString().withMessage('Status must be a string'),
    body('reference_number').optional().isString().withMessage('Reference number must be a string'),
    body('remarks').optional().isString().withMessage('Remarks must be a string'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Finance', 'Superfinance'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { id } = req.params;
      const {
        payment_method,
        payment_type,
        payable_amount,
        tip_amount,
        discount_amount,
        issue_date,
        status,
        reference_number,
        remarks,
        attachment_url,
      } = req.body;

      // Check if payment exists
      const existingPayment = await client.query('SELECT * FROM paymenttbl WHERE payment_id = $1', [id]);
      if (existingPayment.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Payment not found',
        });
      }

      const payment = existingPayment.rows[0];

      // Check branch access
      if (req.user.userType !== 'Superadmin' && req.user.branchId && payment.branch_id !== req.user.branchId) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          success: false,
          message: 'Access denied',
        });
      }

      const returnEdit = assertBranchUserMayEditReturnedPayment(req, payment);
      if (!returnEdit.ok) {
        await client.query('ROLLBACK');
        return res.status(returnEdit.status).json({
          success: false,
          message: returnEdit.message,
        });
      }

      const remarksText = String(payment.remarks || '');
      const hadReturnedTag = remarksText.includes('[Returned]');

      if (hadReturnedTag && remarks !== undefined) {
        const nextRemarks = String(remarks ?? '');
        if (!nextRemarks.includes('[Returned]')) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message:
              'Remarks must keep the Finance return marker ([Returned]). You may add detail, but do not remove that history.',
          });
        }
      }

      const effectiveIssueDateForLogic =
        issue_date !== undefined && issue_date !== null && String(issue_date).trim() !== ''
          ? issue_date
          : payment.issue_date;

      // Build update query
      const updates = [];
      const params = [];
      let paramCount = 0;

      const fields = {
        payment_method,
        payment_type,
        payable_amount,
        tip_amount,
        discount_amount,
        issue_date,
        status,
        reference_number,
        remarks,
      };
      Object.entries(fields).forEach(([key, value]) => {
        if (value !== undefined) {
          paramCount++;
          updates.push(`${key} = $${paramCount}`);
          params.push(value);
        }
      });
      if (attachment_url !== undefined) {
        paramCount++;
        updates.push(`payment_attachment_url = $${paramCount}`);
        params.push(attachment_url || null);
      }

      if (updates.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'No fields to update',
        });
      }

      paramCount++;
      params.push(id);

      const updateSql = `UPDATE paymenttbl SET ${updates.join(', ')} WHERE payment_id = $${paramCount}`;
      await client.query(updateSql, params);

      // If amount components or status changed, recalculate invoice amount and status
      if (
        payable_amount !== undefined ||
        discount_amount !== undefined ||
        tip_amount !== undefined ||
        status !== undefined
      ) {
        const invoiceResult = await client.query(
          'SELECT *, installmentinvoiceprofiles_id FROM invoicestbl WHERE invoice_id = $1', 
          [payment.invoice_id]
        );
        if (invoiceResult.rows.length > 0) {
          const invoice = invoiceResult.rows[0];

          const totalPaymentsResult = await client.query(
            `SELECT COALESCE(SUM(COALESCE(payable_amount, 0) + COALESCE(discount_amount, 0)), 0) as total_paid
             FROM paymenttbl
             WHERE invoice_id = $1
               AND status = $2
               AND COALESCE(approval_status, 'Pending') <> 'Rejected'`,
            [payment.invoice_id, 'Completed']
          );
          const totalPaid = parseFloat(totalPaymentsResult.rows[0].total_paid) || 0;

          const { originalInvoiceAmount } = await computeInvoiceOriginalForRecalc(
            client,
            payment.invoice_id,
            invoice
          );

          // Calculate remaining balance (original amount - total paid)
          const remainingBalance = Math.max(0, originalInvoiceAmount - totalPaid);
          
          // Update invoice amount to reflect remaining balance
          await client.query('UPDATE invoicestbl SET amount = $1 WHERE invoice_id = $2', [
            remainingBalance,
            payment.invoice_id,
          ]);

          let newInvoiceStatus = invoice.status;
          if (totalPaid >= originalInvoiceAmount) {
            newInvoiceStatus = 'Paid';
          } else if (totalPaid > 0) {
            newInvoiceStatus = 'Partially Paid';
          } else {
            newInvoiceStatus = await deriveInvoiceStatusForInvoice(client, payment.invoice_id, {
              totalSettled: totalPaid,
              originalInvoiceAmount,
              previousStatus: invoice.status,
            });
          }

          if (newInvoiceStatus !== invoice.status) {
            await client.query('UPDATE invoicestbl SET status = $1 WHERE invoice_id = $2', [
              newInvoiceStatus,
              payment.invoice_id,
            ]);
          }

          // Check if this invoice is linked to a reservation
          // If yes, and invoice is now fully paid, update reservation status to "Fee Paid" and auto-enroll student
          if (newInvoiceStatus === 'Paid') {
            const reservationChainRootId = await getChainRootInvoiceId(client, payment.invoice_id);
            const reservationCheck = await client.query(
              `SELECT r.reserved_id, r.status, r.student_id, r.class_id, r.phase_number, r.branch_id
               FROM reservedstudentstbl r
               WHERE r.invoice_id = $1 OR r.invoice_id = $2`,
              [payment.invoice_id, reservationChainRootId]
            );

            if (reservationCheck.rows.length > 0) {
              const reservation = reservationCheck.rows[0];
              if (reservation.status === 'Reserved') {
                await client.query(
                  `UPDATE reservedstudentstbl 
                   SET status = 'Fee Paid', reservation_fee_paid_at = CURRENT_TIMESTAMP
                   WHERE reserved_id = $1`,
                  [reservation.reserved_id]
                );
                console.log(`✅ Reservation ${reservation.reserved_id} status updated to "Fee Paid" after payment update`);
              }
            }
          }

          // Check if invoice becomes unpaid and is a package price invoice
          // If yes, remove student enrollment
          if (newInvoiceStatus === 'Unpaid' && 
              !invoice.installmentinvoiceprofiles_id && 
              invoice.invoice_description && 
              !invoice.invoice_description.includes('Reservation Fee')) {
            try {
              // Get student from invoice
              const invoiceStudentResult = await client.query(
                `SELECT ist.student_id 
                 FROM invoicestudentstbl ist
                 WHERE ist.invoice_id = $1
                 LIMIT 1`,
                [payment.invoice_id]
              );
              
              if (invoiceStudentResult.rows.length > 0) {
                const invoiceStudentId = invoiceStudentResult.rows[0].student_id;
                
                // Find enrollments for this student that were created around the same time as the invoice
                const enrollmentResult = await client.query(
                  `SELECT cs.classstudent_id, cs.class_id, cs.phase_number, cs.student_id, cs.enrolled_at
                   FROM classstudentstbl cs
                   WHERE cs.student_id = $1
                     AND cs.enrolled_at >= $2::date - INTERVAL '24 hours'
                     AND cs.enrolled_at <= $2::date + INTERVAL '24 hours'
                   ORDER BY cs.enrolled_at DESC`,
                  [invoiceStudentId, invoice.issue_date]
                );
                
                // Remove all enrollments that were created around the same time as the invoice
                for (const enrollment of enrollmentResult.rows) {
                  await client.query(
                    `DELETE FROM classstudentstbl WHERE classstudent_id = $1`,
                    [enrollment.classstudent_id]
                  );
                  console.log(`⚠️ Student ${enrollment.student_id} removed from class ${enrollment.class_id}, phase ${enrollment.phase_number} due to unpaid package price invoice`);
                }
              }
            } catch (removalError) {
              console.error('Error removing student enrollment due to unpaid invoice:', removalError);
              // Don't fail the payment update if removal fails
            }
          }

          // Check if this is a full payment invoice (not installment, not reservation fee)
          // If yes, and invoice is now fully paid, enroll student in all phases
          // For Phase packages, only enroll in the specified phase range (PHASE_START/PHASE_END in remarks)
          if (newInvoiceStatus === 'Paid' && 
              !invoice.installmentinvoiceprofiles_id && 
              invoice.invoice_description && 
              !invoice.invoice_description.includes('Reservation Fee')) {
            try {
              // Get class_id from invoice remarks field (stored as CLASS_ID:class_id)
              let classId = null;
              if (invoice.remarks && invoice.remarks.includes('CLASS_ID:')) {
                const match = invoice.remarks.match(/CLASS_ID:(\d+)/);
                if (match) {
                  classId = parseInt(match[1]);
                }
              }
              
              if (classId) {
                // Get class and curriculum info
                const classResult = await client.query(
                  `SELECT c.class_id, c.program_id, cu.number_of_phase
                   FROM classestbl c
                   LEFT JOIN programstbl p ON c.program_id = p.program_id
                   LEFT JOIN curriculumstbl cu ON p.curriculum_id = cu.curriculum_id
                   WHERE c.class_id = $1`,
                  [classId]
                );
                
                if (classResult.rows.length > 0) {
                  const classData = classResult.rows[0];
                  const totalPhases = classData.number_of_phase || 1;
                  
                  // Determine phase range for enrollment
                  // Default: 1..totalPhases (full payment for entire class)
                  // Phase packages: override using PHASE_START / PHASE_END from remarks
                  let phaseStart = 1;
                  let phaseEnd = totalPhases;
                  if (invoice.remarks && invoice.remarks.includes('PHASE_START:')) {
                    const startMatch = invoice.remarks.match(/PHASE_START:(\d+)/);
                    if (startMatch) {
                      phaseStart = parseInt(startMatch[1]) || 1;
                    }
                  }
                  if (invoice.remarks && invoice.remarks.includes('PHASE_END:')) {
                    const endMatch = invoice.remarks.match(/PHASE_END:(\d+)/);
                    if (endMatch) {
                      phaseEnd = parseInt(endMatch[1]) || phaseStart;
                    }
                  }
                  // Clamp to valid range
                  if (phaseStart < 1) phaseStart = 1;
                  if (phaseEnd > totalPhases) phaseEnd = totalPhases;
                  if (phaseEnd < phaseStart) phaseEnd = phaseStart;
                  
                  const changedPhaseRows = await enrollStudentForFullPaymentPhases({
                    client,
                    studentId: payment.student_id,
                    classId,
                    phaseStart,
                    phaseEnd,
                    sourceLabel: 'System (Auto-enrolled via full payment)',
                  });

                  if (changedPhaseRows > 0) {
                    console.log(`✅ Full payment: Auto-enrolled/reactivated ${changedPhaseRows} phase row(s) for student ${payment.student_id} in phases ${phaseStart}-${phaseEnd} of class ${classId} after payment update`);
                  }

                  await syncInstallmentProfileForRejoinInvoice({
                    client,
                    invoice,
                    studentId: payment.student_id,
                  });
                }
              }
            } catch (fullPaymentError) {
              // Log error but don't fail payment update
              console.error('Error auto-enrolling student for full payment:', fullPaymentError);
            }
          }
          
          // Check if this invoice is from an installment invoice profile and is now fully paid
          // If yes, check if it's a downpayment invoice or regular installment invoice
          if (newInvoiceStatus === 'Paid' && invoice.installmentinvoiceprofiles_id) {
            try {
              if (isRejoinClassInvoice(invoice.remarks)) {
                let rejoinClassId = null;
                if (invoice.remarks && invoice.remarks.includes('CLASS_ID:')) {
                  const classMatch = invoice.remarks.match(/CLASS_ID:(\d+)/);
                  if (classMatch) rejoinClassId = parseInt(classMatch[1], 10);
                }
                const rejoinPhase = parseRejoinPhaseFromRemarks(invoice.remarks);
                if (rejoinClassId && rejoinPhase) {
                  await enrollStudentForFullPaymentPhases({
                    client,
                    studentId: payment.student_id,
                    classId: rejoinClassId,
                    phaseStart: rejoinPhase,
                    phaseEnd: rejoinPhase,
                    sourceLabel: 'System (Auto-enrolled via rejoin payment)',
                  });
                  await syncInstallmentProfileForRejoinInvoice({
                    client,
                    invoice,
                    studentId: payment.student_id,
                  });
                }
              } else {
              // Get installment invoice profile to check if this is a downpayment invoice
              const profileResult = await client.query(
                `SELECT ip.class_id, ip.student_id, ip.total_phases, ip.generated_count,
                        ip.downpayment_paid, ip.downpayment_invoice_id, ip.amount, ip.frequency,
                        ip.first_generation_date, ip.next_invoice_due_date, ip.bill_invoice_due_date,
                        ip.branch_id, ip.package_id, ip.description, ip.phase_start
                 FROM installmentinvoiceprofilestbl ip
                 WHERE ip.installmentinvoiceprofiles_id = $1`,
                [invoice.installmentinvoiceprofiles_id]
              );

              if (profileResult.rows.length > 0) {
                const profile = profileResult.rows[0];
                
                // Treat as downpayment if: (a) profile explicitly links this invoice, OR (b) profile has no downpayment_invoice_id set
                const isDownpaymentInvoice = Number(profile.downpayment_invoice_id) === Number(payment.invoice_id);
                const isFirstLinkedInvoice = !profile.downpayment_invoice_id && !profile.downpayment_paid && (profile.generated_count || 0) === 0;
                
                if ((isDownpaymentInvoice || isFirstLinkedInvoice) && !profile.downpayment_paid) {
                  if (!profile.downpayment_invoice_id) {
                    await client.query(
                      `UPDATE installmentinvoiceprofilestbl SET downpayment_invoice_id = $1 WHERE installmentinvoiceprofiles_id = $2`,
                      [payment.invoice_id, invoice.installmentinvoiceprofiles_id]
                    );
                  }
                  // Mark downpayment as paid
                  await client.query(
                    `UPDATE installmentinvoiceprofilestbl 
                     SET downpayment_paid = true 
                     WHERE installmentinvoiceprofiles_id = $1`,
                    [invoice.installmentinvoiceprofiles_id]
                  );
                  
                  // Get student name for installment invoice record
                  const studentResult = await client.query(
                    'SELECT full_name FROM userstbl WHERE user_id = $1',
                    [payment.student_id]
                  );
                  const studentName = studentResult.rows[0]?.full_name || 'Student';
                  
                  const firstPaymentIssueDate =
                    effectiveIssueDateForLogic != null && effectiveIssueDateForLogic !== ''
                      ? formatYmdLocal(new Date(effectiveIssueDateForLogic))
                      : formatYmdLocal(new Date());
                  const { firstInvoiceRecord } = await createFirstInstallmentRecordAfterDownpayment({
                    client,
                    profileId: invoice.installmentinvoiceprofiles_id,
                    profile,
                    studentName,
                    paymentIssueDate: firstPaymentIssueDate,
                  });
                  
                  console.log(`✅ Downpayment paid (via update): Created first installment invoice record for profile ${invoice.installmentinvoiceprofiles_id}`);
                  
                  // Store invoice generation data to process after transaction commits
                  // This avoids transaction conflicts
                  const invoiceGenData = {
                    firstInvoiceRecord,
                    profile: {
                      student_id: profile.student_id,
                      branch_id: profile.branch_id || invoice.branch_id || null,
                      package_id: profile.package_id || invoice.package_id || null,
                      generated_count: profile.generated_count || 0,
                      class_id: profile.class_id,
                      amount: profile.amount,
                      frequency: profile.frequency || '1 month(s)',
                      description: profile.description || 'Monthly Installment Payment',
                      total_phases: profile.total_phases,
                      phase_start: profile.phase_start,
                    },
                    profileId: invoice.installmentinvoiceprofiles_id
                  };
                  
                  await ensurePendingEnrollmentAfterDownpaymentPaid(client, profile, payment.student_id);
                  
                  // Skip the rest of the installment payment logic since this is just the downpayment
                  // The actual installment invoices will be handled separately
                  
                  // Generate invoice after transaction commits (to avoid conflicts)
                  // This will be done in a separate async operation after COMMIT
                  if (invoiceGenData) {
                    // Store for processing after commit
                    req._pendingInvoiceGeneration = invoiceGenData;
                  }
                } else {
                  // This is a regular installment invoice payment (not downpayment)
                  // Continue with existing logic
                  
                  // Only proceed if we have class_id and student_id matches
                  if (profile.class_id && profile.student_id === payment.student_id) {
                    await syncInstallmentEnrollmentForPaidInvoice({
                      client,
                      profileId: invoice.installmentinvoiceprofiles_id,
                      profile,
                      studentId: payment.student_id,
                      sourceLabel: 'System (Auto-enrolled via installment payment)',
                      invoice,
                    });
                  }
                }
              }
              }
            } catch (phaseError) {
              // Log error but don't fail payment update
              console.error('Error processing installment payment:', phaseError);
            }
          }

          if (newInvoiceStatus === 'Paid' && !invoice.installmentinvoiceprofiles_id) {
            try {
              await promotePendingEnrollmentIfPhaseInvoicePaid(client, {
                studentId: payment.student_id,
                invoice: { ...invoice, status: newInvoiceStatus },
                sourceLabel: 'System (Auto-enrolled via installment payment)',
              });
            } catch (promoteErr) {
              console.error('Error promoting pending enrollment after payment update:', promoteErr);
            }
          }
        }
      }

      await syncProgramPaymentStatusForInvoice(client, payment.invoice_id);

      await client.query('COMMIT');

      // Generate first installment invoice after transaction commits (if downpayment was paid)
      if (req._pendingInvoiceGeneration) {
        const { firstInvoiceRecord, profile, profileId } = req._pendingInvoiceGeneration;
        // Process asynchronously so it doesn't block the response
        (async () => {
          try {
            const { generateInvoiceFromInstallment } = await import('../utils/installmentInvoiceGenerator.js');
            
            // Generate the first installment invoice immediately (so it appears in invoice page)
            const generatedInvoice = await generateInvoiceFromInstallment(firstInvoiceRecord, profile);
            
            console.log(`✅ Downpayment paid (via update): Generated first installment invoice ${generatedInvoice.invoice_id} for profile ${profileId}`);
          } catch (invoiceGenError) {
            // Log error but don't fail the payment - invoice generation can be retried
            console.error(`⚠️ Error generating first installment invoice for profile ${profileId}:`, invoiceGenError);
            // The installment invoice record is already created, so it can be generated later by the cron job
          }
        })();
        delete req._pendingInvoiceGeneration;
      }

      // Fetch updated payment
      const updatedPayment = await query(
        `SELECT p.payment_id, p.invoice_id, p.student_id, p.branch_id, 
                p.payment_method, p.payment_type, p.payable_amount, COALESCE(p.discount_amount, 0) AS discount_amount, 
                TO_CHAR(p.issue_date, 'YYYY-MM-DD') as issue_date, 
                p.status, p.reference_number, p.remarks, p.payment_attachment_url, p.created_by,
                TO_CHAR(p.created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at,
                u.full_name as student_name, u.email as student_email,
                i.invoice_description, i.amount as invoice_amount,
                COALESCE(i.amount, 0) + COALESCE((
                  SELECT SUM(COALESCE(px.tip_amount, 0))
                  FROM paymenttbl px
                  WHERE px.invoice_id = p.invoice_id
                    AND px.status = 'Completed'
                ), 0) AS invoice_total_amount,
                i.invoice_ar_number AS invoice_ar_number,
                COALESCE(b.branch_nickname, b.branch_name) AS branch_name
         FROM paymenttbl p
         LEFT JOIN userstbl u ON p.student_id = u.user_id
         LEFT JOIN invoicestbl i ON p.invoice_id = i.invoice_id
         LEFT JOIN branchestbl b ON p.branch_id = b.branch_id
         WHERE p.payment_id = $1`,
        [id]
      );

      res.json({
        success: true,
        message: 'Payment updated successfully',
        data: updatedPayment.rows[0],
      });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally {
      client.release();
    }
  }
);

/**
 * DELETE /api/sms/payments/:id
 * Delete payment
 * Access: Superadmin, Admin
 */
router.delete(
  '/:id',
  [
    param('id').isInt().withMessage('Payment ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Finance'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { id } = req.params;

      // Check if payment exists
      const existingPayment = await client.query('SELECT * FROM paymenttbl WHERE payment_id = $1', [id]);
      if (existingPayment.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Payment not found',
        });
      }

      const payment = existingPayment.rows[0];

      // Check branch access
      if (req.user.userType !== 'Superadmin' && req.user.branchId && payment.branch_id !== req.user.branchId) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          success: false,
          message: 'Access denied',
        });
      }

      const invoiceForDeleteCheck = await client.query(
        `SELECT balance_invoice_id, status FROM invoicestbl WHERE invoice_id = $1`,
        [payment.invoice_id]
      );
      const invDel = invoiceForDeleteCheck.rows[0];
      if (invDel?.balance_invoice_id) {
        const childPaid = await client.query(
          `SELECT COALESCE(SUM(COALESCE(payable_amount, 0) + COALESCE(discount_amount, 0)), 0) AS t
           FROM paymenttbl
           WHERE invoice_id = $1
             AND status = 'Completed'
             AND COALESCE(approval_status, 'Pending') <> 'Rejected'`,
          [invDel.balance_invoice_id]
        );
        if (parseFloat(childPaid.rows[0]?.t || 0) > 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message:
              'Cannot delete this payment because a balance invoice exists and already has payments. Reverse balance payments first.',
          });
        }
        await removeUnusedBalanceInvoice(client, invDel.balance_invoice_id);
      }

      const invoiceBeforeRow = await client.query(`SELECT * FROM invoicestbl WHERE invoice_id = $1`, [
        payment.invoice_id,
      ]);
      const invoiceSnap = invoiceBeforeRow.rows[0];

      // Delete payment
      await client.query('DELETE FROM paymenttbl WHERE payment_id = $1', [id]);

      // Recalculate invoice amount and status (include installmentinvoiceprofiles_id for phase tracking)
      const invoiceResult = await client.query(
        'SELECT *, installmentinvoiceprofiles_id FROM invoicestbl WHERE invoice_id = $1',
        [payment.invoice_id]
      );
      if (invoiceResult.rows.length > 0) {
        const invoice = invoiceResult.rows[0];

        const totalPaymentsResult = await client.query(
          `SELECT COALESCE(SUM(COALESCE(payable_amount, 0) + COALESCE(discount_amount, 0)), 0) as total_paid
           FROM paymenttbl
           WHERE invoice_id = $1
             AND status = $2
             AND COALESCE(approval_status, 'Pending') <> 'Rejected'`,
          [payment.invoice_id, 'Completed']
        );
        const totalPaid = parseFloat(totalPaymentsResult.rows[0].total_paid) || 0;

        const { originalInvoiceAmount } = await computeOriginalAfterDeletingPayment(
          client,
          payment.invoice_id,
          invoiceSnap,
          totalPaid,
          payment.status === 'Completed'
            ? (Number(payment.payable_amount || 0) + Number(payment.discount_amount || 0))
            : 0
        );

        // Calculate remaining balance (original amount - total paid)
        const remainingBalance = Math.max(0, originalInvoiceAmount - totalPaid);
        
        // Update invoice amount to reflect remaining balance
        await client.query('UPDATE invoicestbl SET amount = $1 WHERE invoice_id = $2', [
          remainingBalance,
          payment.invoice_id,
        ]);

        const newInvoiceStatus = await deriveInvoiceStatusForInvoice(client, payment.invoice_id, {
          totalSettled: totalPaid,
          originalInvoiceAmount,
          previousStatus: invoice.status,
        });

        await client.query('UPDATE invoicestbl SET status = $1 WHERE invoice_id = $2', [
          newInvoiceStatus,
          payment.invoice_id,
        ]);
        
        // Check if this was a downpayment invoice that became unpaid
        if (newInvoiceStatus === 'Unpaid' && invoice.installmentinvoiceprofiles_id) {
          try {
            const profileResult = await client.query(
              `SELECT downpayment_invoice_id, downpayment_paid 
               FROM installmentinvoiceprofilestbl 
               WHERE installmentinvoiceprofiles_id = $1 AND downpayment_invoice_id = $2`,
              [invoice.installmentinvoiceprofiles_id, payment.invoice_id]
            );
            
            if (profileResult.rows.length > 0 && profileResult.rows[0].downpayment_paid) {
              // Downpayment was paid but payment was deleted - revert downpayment status
              await client.query(
                `UPDATE installmentinvoiceprofilestbl 
                 SET downpayment_paid = false 
                 WHERE installmentinvoiceprofiles_id = $1`,
                [invoice.installmentinvoiceprofiles_id]
              );
              
              // Delete the first installment invoice record if it exists
              await client.query(
                `DELETE FROM installmentinvoicestbl 
                 WHERE installmentinvoiceprofiles_id = $1 
                 AND status = 'Pending'
                 ORDER BY scheduled_date ASC
                 LIMIT 1`,
                [invoice.installmentinvoiceprofiles_id]
              );

              await removePendingEnrollmentPlaceholderForProfile(client, invoice.installmentinvoiceprofiles_id);
              
              console.log(`⚠️ Downpayment payment deleted: Reverted downpayment status and removed first installment invoice record`);
            }
          } catch (downpaymentError) {
            console.error('Error handling downpayment payment deletion:', downpaymentError);
          }
        }
        
        // Check if invoice becomes unpaid
        if (newInvoiceStatus === 'Unpaid') {
          // Check if this is a reservation fee invoice
          const isReservationFee = invoice.invoice_description && 
            invoice.invoice_description.includes('Reservation Fee');
          
          if (isReservationFee) {
            // Handle reservation fee invoice becoming unpaid
            try {
              const reservationResult = await client.query(
                `SELECT r.reserved_id, r.status, r.student_id, r.class_id, r.phase_number, r.due_date
                 FROM reservedstudentstbl r
                 WHERE r.invoice_id = $1`,
                [payment.invoice_id]
              );
              
              if (reservationResult.rows.length > 0) {
                const reservation = reservationResult.rows[0];
                
                // If reservation was upgraded, unenroll the student
                if (reservation.status === 'Upgraded') {
                  const enrollmentResult = await client.query(
                    `SELECT cs.classstudent_id 
                     FROM classstudentstbl cs
                     WHERE cs.student_id = $1 
                       AND cs.class_id = $2
                       ${reservation.phase_number ? `AND cs.phase_number = $3` : ''}`,
                    reservation.phase_number 
                      ? [reservation.student_id, reservation.class_id, reservation.phase_number]
                      : [reservation.student_id, reservation.class_id]
                  );
                  
                  // Unenroll student
                  for (const enrollment of enrollmentResult.rows) {
                    await client.query(
                      'DELETE FROM classstudentstbl WHERE classstudent_id = $1',
                      [enrollment.classstudent_id]
                    );
                    console.log(`⚠️ Student ${reservation.student_id} unenrolled from class ${reservation.class_id} due to reservation fee payment deletion`);
                  }
                }
                
                // Update reservation status based on due date
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const dueDate = reservation.due_date ? new Date(reservation.due_date) : null;
                
                if (dueDate && dueDate < today) {
                  // Past due date - expire reservation
                  await client.query(
                    `UPDATE reservedstudentstbl 
                     SET status = 'Expired', expired_at = CURRENT_TIMESTAMP
                     WHERE reserved_id = $1`,
                    [reservation.reserved_id]
                  );
                  console.log(`✅ Reservation ${reservation.reserved_id} expired due to unpaid reservation fee (past due date)`);
                } else {
                  // Not past due date yet - revert to 'Reserved'
                  await client.query(
                    `UPDATE reservedstudentstbl 
                     SET status = 'Reserved', reservation_fee_paid_at = NULL
                     WHERE reserved_id = $1`,
                    [reservation.reserved_id]
                  );
                  console.log(`✅ Reservation ${reservation.reserved_id} status reverted to 'Reserved' due to reservation fee payment deletion`);
                }
              }
            } catch (reservationError) {
              console.error('Error handling reservation fee invoice payment deletion:', reservationError);
              // Don't fail the payment deletion if reservation handling fails
            }
          } else if (!invoice.installmentinvoiceprofiles_id) {
            // Handle package price invoice becoming unpaid - remove student enrollment
            try {
              // Get student from invoice
              const invoiceStudentResult = await client.query(
                `SELECT ist.student_id 
                 FROM invoicestudentstbl ist
                 WHERE ist.invoice_id = $1
                 LIMIT 1`,
                [payment.invoice_id]
              );
              
              if (invoiceStudentResult.rows.length > 0) {
                const invoiceStudentId = invoiceStudentResult.rows[0].student_id;
                
                // Find enrollments for this student that were created around the same time as the invoice
                const enrollmentResult = await client.query(
                  `SELECT cs.classstudent_id, cs.class_id, cs.phase_number, cs.student_id, cs.enrolled_at
                   FROM classstudentstbl cs
                   WHERE cs.student_id = $1
                     AND cs.enrolled_at >= $2::timestamp - INTERVAL '1 hour'
                     AND cs.enrolled_at <= $2::timestamp + INTERVAL '1 hour'
                   ORDER BY cs.enrolled_at DESC`,
                  [invoiceStudentId, invoice.issue_date || invoice.created_at]
                );
                
                // Remove all enrollments that were created around the same time as the invoice
                for (const enrollment of enrollmentResult.rows) {
                  await client.query(
                    `DELETE FROM classstudentstbl WHERE classstudent_id = $1`,
                    [enrollment.classstudent_id]
                  );
                  console.log(`⚠️ Student ${enrollment.student_id} removed from class ${enrollment.class_id}, phase ${enrollment.phase_number} due to unpaid package price invoice (payment deleted)`);
                }
              }
            } catch (removalError) {
              console.error('Error removing student enrollment due to unpaid invoice:', removalError);
              // Don't fail the payment deletion if removal fails
            }
          }
        }
      }

      await syncProgramPaymentStatusForInvoice(client, payment.invoice_id);

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Payment deleted successfully',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally {
      client.release();
    }
  }
);

/**
 * GET /api/sms/payments/student/:studentId
 * Get payment logs for a specific student
 * Access: Students (can only view their own payments)
 */
router.get(
  '/student/:studentId',
  [
    param('studentId').isInt().withMessage('Student ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Student'),
  async (req, res, next) => {
    try {
      const { studentId } = req.params;
      const studentUserId = req.user.userId || req.user.user_id;

      // Check access permission - students can only view their own payments
      if (parseInt(studentId) !== parseInt(studentUserId)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only view your own payment logs.',
        });
      }

      const result = await query(
        `SELECT p.payment_id, p.invoice_id, p.student_id, p.branch_id, 
                p.payment_method, p.payment_type, p.payable_amount, COALESCE(p.discount_amount, 0) AS discount_amount,
                TO_CHAR(p.issue_date, 'YYYY-MM-DD') as issue_date, 
                p.status, p.reference_number, p.remarks, p.payment_attachment_url, p.created_by,
                TO_CHAR(p.created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at,
                u.full_name as student_name, u.email as student_email,
                i.invoice_description, i.amount as invoice_amount,
                COALESCE(i.amount, 0) + COALESCE((
                  SELECT SUM(COALESCE(px.tip_amount, 0))
                  FROM paymenttbl px
                  WHERE px.invoice_id = p.invoice_id
                    AND px.status = 'Completed'
                ), 0) AS invoice_total_amount,
                i.invoice_ar_number AS invoice_ar_number,
                COALESCE(b.branch_nickname, b.branch_name) AS branch_name
         FROM paymenttbl p
         LEFT JOIN userstbl u ON p.student_id = u.user_id
         LEFT JOIN invoicestbl i ON p.invoice_id = i.invoice_id
         LEFT JOIN branchestbl b ON p.branch_id = b.branch_id
         WHERE p.student_id = $1
         ORDER BY p.payment_id DESC`,
        [studentId]
      );

      res.json({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/sms/payments/:id/approve
 * Approve or unapprove a payment (finance team confirmation)
 * Access: Superadmin, Superfinance can approve all; Finance/Admin can approve their branch only
 */
router.put(
  '/:id/approve',
  requireRole('Superadmin', 'Finance', 'Superfinance', 'Admin'),
  [
    param('id').isInt().withMessage('Payment ID must be an integer'),
    body('approve').isBoolean().withMessage('approve must be a boolean'),
    body('finance_verified_reference_number')
      .optional({ nullable: true })
      .isString()
      .withMessage('finance_verified_reference_number must be a string'),
    body('payment_date')
      .optional({ nullable: true })
      .matches(/^\d{4}-\d{2}-\d{2}$/)
      .withMessage('payment_date must be YYYY-MM-DD'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { approve } = req.body;
      const financeVerifiedReferenceNumber = String(
        req.body?.finance_verified_reference_number || ''
      ).trim();
      // Optional updated payment date (stored in paymenttbl.issue_date, which is
      // the source column aliased as payment_date everywhere in payment logs).
      const rawPaymentDate = req.body?.payment_date;
      const paymentDateUpdate =
        typeof rawPaymentDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawPaymentDate.trim())
          ? rawPaymentDate.trim()
          : null;
      const userId = req.user.userId;
      const userType = req.user.userType;
      const userBranchId = req.user.branchId;

      // Get payment details including branch
      const paymentCheck = await query(
        `SELECT payment_id, invoice_id, branch_id, approval_status, reference_number
         FROM paymenttbl
         WHERE payment_id = $1`,
        [id]
      );

      if (paymentCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Payment not found',
        });
      }

      const payment = paymentCheck.rows[0];
      let invoiceCreatedBy = null;
      if (payment.invoice_id != null) {
        const invoiceOwnerRes = await query(
          'SELECT created_by FROM invoicestbl WHERE invoice_id = $1',
          [payment.invoice_id]
        );
        invoiceCreatedBy = invoiceOwnerRes.rows[0]?.created_by ?? null;
      }

      if (approve && payment.approval_status === 'Returned') {
        return res.status(400).json({
          success: false,
          message:
            'This payment was returned for correction. The branch must update reference/attachment and resubmit for verification before it can be approved.',
        });
      }
      if (approve && payment.approval_status === 'Rejected') {
        return res.status(400).json({
          success: false,
          message:
            'This payment was rejected. Please record a new payment from the rejected invoice instead.',
        });
      }

      if (approve && !financeVerifiedReferenceNumber) {
        return res.status(400).json({
          success: false,
          message: 'Finance/Superfinance reference number is required when approving payment',
        });
      }

      if (approve) {
        const issuedReferenceNumber = String(payment.reference_number || '').trim();
        if (!issuedReferenceNumber) {
          return res.status(400).json({
            success: false,
            message:
              'This payment has no issued reference number yet. Please return it to branch and request correction before approval.',
          });
        }
        if (financeVerifiedReferenceNumber !== issuedReferenceNumber) {
          return res.status(400).json({
            success: false,
            message:
              'Reference number mismatch. Approval is blocked. Please return this payment to branch for correction.',
          });
        }
      }

      // Permission check: branch-bound Finance/Admin can only approve payments from their own branch
      // Superfinance is represented as Finance with no branch_id and should NOT be restricted here
      if (
        (userType === 'Finance' || userType === 'Admin') &&
        userBranchId !== null &&
        userBranchId !== undefined &&
        payment.branch_id !== userBranchId
      ) {
        return res.status(403).json({
          success: false,
          message: 'You can only approve payments from your assigned branch',
        });
      }

      // Superadmin and Superfinance can approve any payment (no branch restriction)

      // Update approval status. When approving, optionally also update issue_date
      // so the corrected payment date is reflected wherever payment_date is shown
      // (payment_date in queries is a SQL alias for paymenttbl.issue_date).
      let updateSql;
      let updateParams;
      if (approve) {
        if (paymentDateUpdate) {
          updateSql = `UPDATE paymenttbl
             SET approval_status = 'Approved',
                 approved_by = $1,
                 approved_at = CURRENT_TIMESTAMP,
                 finance_verified_reference_number = $2,
                 issue_date = $3::date
             WHERE payment_id = $4
             RETURNING payment_id, approval_status, approved_by,
                       TO_CHAR(approved_at, 'YYYY-MM-DD HH24:MI:SS') as approved_at,
                       finance_verified_reference_number,
                       TO_CHAR(issue_date, 'YYYY-MM-DD') as issue_date,
                       TO_CHAR(issue_date, 'YYYY-MM-DD') as payment_date`;
          updateParams = [userId, financeVerifiedReferenceNumber, paymentDateUpdate, id];
        } else {
          updateSql = `UPDATE paymenttbl
             SET approval_status = 'Approved',
                 approved_by = $1,
                 approved_at = CURRENT_TIMESTAMP,
                 finance_verified_reference_number = $2
             WHERE payment_id = $3
             RETURNING payment_id, approval_status, approved_by,
                       TO_CHAR(approved_at, 'YYYY-MM-DD HH24:MI:SS') as approved_at,
                       finance_verified_reference_number,
                       TO_CHAR(issue_date, 'YYYY-MM-DD') as issue_date,
                       TO_CHAR(issue_date, 'YYYY-MM-DD') as payment_date`;
          updateParams = [userId, financeVerifiedReferenceNumber, id];
        }
      } else {
        updateSql = `UPDATE paymenttbl
           SET approval_status = 'Pending',
               approved_by = NULL,
               approved_at = NULL,
               finance_verified_reference_number = NULL
           WHERE payment_id = $1
           RETURNING payment_id, approval_status, approved_by, approved_at, finance_verified_reference_number,
                     TO_CHAR(issue_date, 'YYYY-MM-DD') as issue_date,
                     TO_CHAR(issue_date, 'YYYY-MM-DD') as payment_date`;
        updateParams = [id];
      }

      const result = await query(updateSql, updateParams);

      res.json({
        success: true,
        message: approve ? 'Payment approved successfully' : 'Payment approval revoked',
        data: result.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/sms/payments/:id/return
 * Finance/Superfinance: send payment back to branch when reference vs attachment does not match.
 */
router.put(
  '/:id/return',
  requireRole('Finance', 'Superfinance'),
  [
    param('id').isInt().withMessage('Payment ID must be an integer'),
    body('reason')
      .trim()
      .notEmpty()
      .withMessage('Return notes are required')
      .isString()
      .withMessage('Return notes must be text'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const reason = String(req.body.reason).trim();
      const userId = req.user.userId;
      const userType = req.user.userType;
      const userBranchId = req.user.branchId;

      const paymentCheck = await query('SELECT * FROM paymenttbl WHERE payment_id = $1', [id]);

      if (paymentCheck.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Payment not found' });
      }

      const payment = paymentCheck.rows[0];
      let invoiceCreatedBy = null;
      if (payment.invoice_id != null) {
        const invoiceOwnerRes = await query(
          'SELECT created_by FROM invoicestbl WHERE invoice_id = $1',
          [payment.invoice_id]
        );
        invoiceCreatedBy = invoiceOwnerRes.rows[0]?.created_by ?? null;
      }

      if (payment.approval_status === 'Returned') {
        return res.status(400).json({
          success: false,
          message: 'This payment is already marked as returned.',
        });
      }
      if (payment.approval_status === 'Approved') {
        return res.status(400).json({
          success: false,
          message: 'Approved payments cannot be returned. Revoke approval first if needed.',
        });
      }

      if (
        userType === 'Finance' &&
        userBranchId !== null &&
        userBranchId !== undefined &&
        payment.branch_id !== userBranchId
      ) {
        return res.status(403).json({
          success: false,
          message: 'You can only return payments from your assigned branch',
        });
      }

      const result = await query(
        `UPDATE paymenttbl
         SET approval_status = 'Returned',
             return_reason = $1,
             returned_by = $2,
             returned_at = CURRENT_TIMESTAMP,
             reject_reason = NULL,
             rejected_by = NULL,
             rejected_at = NULL,
             approved_by = NULL,
             approved_at = NULL,
             remarks = CASE
               WHEN COALESCE(remarks, '') LIKE '%[Returned]%' THEN remarks
               ELSE RTRIM(COALESCE(remarks, '') || E'\\n[Returned] ' || COALESCE($1::text, ''))
             END
         WHERE payment_id = $3
         RETURNING payment_id, approval_status, return_reason,
                   TO_CHAR(returned_at, 'YYYY-MM-DD HH24:MI:SS') as returned_at, returned_by`,
        [reason, userId, id]
      );

      void notifyPaymentReturnedToBranch({
        paymentId: parseInt(id, 10),
        branchId: payment.branch_id,
        invoiceId: payment.invoice_id,
        reason,
        returnedByUserId: userId,
        actionOwnerUserId: getPaymentReturnOwnerId(payment, invoiceCreatedBy),
        invoiceOwnerUserId: invoiceCreatedBy,
      });

      res.json({
        success: true,
        message: 'Payment returned to branch for correction.',
        data: result.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/sms/payments/:id/reject
 * Finance/Superfinance: permanently reject a payment. Rejected payments no
 * longer count as revenue, but enrollment remains unchanged.
 */
router.put(
  '/:id/reject',
  requireRole('Finance', 'Superfinance'),
  [
    param('id').isInt().withMessage('Payment ID must be an integer'),
    body('reason')
      .trim()
      .notEmpty()
      .withMessage('Reject reason is required')
      .isString()
      .withMessage('Reject reason must be text'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    const client = await getClient();
    try {
      const { id } = req.params;
      const reason = String(req.body.reason).trim();
      const userId = req.user.userId;
      const userType = req.user.userType;
      const userBranchId = req.user.branchId;

      await client.query('BEGIN');

      const paymentCheck = await client.query(
        `SELECT p.*, i.created_by AS invoice_created_by
         FROM paymenttbl p
         LEFT JOIN invoicestbl i ON p.invoice_id = i.invoice_id
         WHERE p.payment_id = $1
         FOR UPDATE OF p`,
        [id]
      );

      if (paymentCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: 'Payment not found' });
      }

      const payment = paymentCheck.rows[0];

      if (payment.approval_status === 'Rejected' || payment.status === 'Rejected') {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'This payment is already rejected.' });
      }

      if (payment.approval_status === 'Approved') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Approved payments cannot be rejected. Revoke approval first if needed.',
        });
      }

      if (
        userType === 'Finance' &&
        userBranchId !== null &&
        userBranchId !== undefined &&
        payment.branch_id !== userBranchId
      ) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          success: false,
          message: 'You can only reject payments from your assigned branch',
        });
      }

      const result = await client.query(
        `UPDATE paymenttbl
         SET status = 'Rejected',
             approval_status = 'Rejected',
             reject_reason = $1,
             rejected_by = $2,
             rejected_at = CURRENT_TIMESTAMP,
             return_reason = NULL,
             returned_by = NULL,
             returned_at = NULL,
             approved_by = NULL,
             approved_at = NULL,
             finance_verified_reference_number = NULL,
             remarks = CASE
               WHEN COALESCE(remarks, '') LIKE '%[Rejected]%' THEN remarks
               ELSE RTRIM(COALESCE(remarks, '') || E'\\n[Rejected] ' || COALESCE($1::text, ''))
             END
         WHERE payment_id = $3
         RETURNING payment_id, invoice_id, branch_id, status, approval_status, reject_reason,
                   TO_CHAR(rejected_at, 'YYYY-MM-DD HH24:MI:SS') as rejected_at,
                   rejected_by`,
        [reason, userId, id]
      );

      if (payment.invoice_id != null) {
        await client.query(
          `UPDATE invoicestbl
           SET status = 'Rejected',
               amount = COALESCE(amount, 0) + COALESCE($1::numeric, 0)
           WHERE invoice_id = $2`,
          [Number(payment.payable_amount || 0) + Number(payment.discount_amount || 0), payment.invoice_id]
        );
      }

      await client.query('COMMIT');

      void notifyPaymentRejectedToBranch({
        paymentId: parseInt(id, 10),
        branchId: payment.branch_id,
        invoiceId: payment.invoice_id,
        reason,
        rejectedByUserId: userId,
        actionOwnerUserId: getPaymentReturnOwnerId(payment, payment.invoice_created_by),
        invoiceOwnerUserId: payment.invoice_created_by,
      });

      res.json({
        success: true,
        message: 'Payment rejected successfully.',
        data: result.rows[0],
      });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally {
      client.release();
    }
  }
);

/**
 * PUT /api/sms/payments/:id/resubmit-for-verification
 * Superadmin/Admin: after fixing reference/attachment, send payment back to Finance queue (Pending).
 */
router.put(
  '/:id/resubmit-for-verification',
  requireRole('Superadmin', 'Admin'),
  [
    param('id').isInt().withMessage('Payment ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const paymentCheck = await query('SELECT * FROM paymenttbl WHERE payment_id = $1', [id]);

      if (paymentCheck.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Payment not found' });
      }

      const payment = paymentCheck.rows[0];

      if (payment.approval_status !== 'Returned') {
        return res.status(400).json({
          success: false,
          message: 'Only payments in Returned status can be resubmitted for verification.',
        });
      }

      if (req.user.userType !== 'Superadmin' && req.user.branchId && payment.branch_id !== req.user.branchId) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      const resubmitPerm = assertBranchUserMayEditReturnedPayment(req, payment);
      if (!resubmitPerm.ok) {
        return res.status(resubmitPerm.status).json({
          success: false,
          message: resubmitPerm.message,
        });
      }

      const userId = req.user.userId;

      const result = await query(
        `UPDATE paymenttbl
         SET approval_status = 'Pending',
             return_reason = NULL,
             returned_by = NULL,
             returned_at = NULL,
             approved_by = NULL,
             approved_at = NULL
         WHERE payment_id = $1
         RETURNING payment_id, approval_status`,
        [id]
      );

      void notifyPaymentResubmittedForVerification({
        paymentId: parseInt(id, 10),
        branchId: payment.branch_id,
        invoiceId: payment.invoice_id,
        resubmittedByUserId: userId,
      });

      res.json({
        success: true,
        message: 'Payment resubmitted for finance verification.',
        data: result.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;

