/**
 * First-enrollment onboarding email sequence for Little Champions Academy.
 *
 * Sends once when a student receives program_enrollment_status = 'new':
 *   1. Onboarding (official welcome + optional AR PDF)
 *   2. Class Schedule (CMS start date + weekly schedule)
 *   3. Things to Prepare
 *   4. Important Reminders
 *   5. Stay Connected (Facebook page)
 *
 * Recipients: student email + primary guardian email (deduped).
 */

import { getClient, query as poolQuery } from '../../config/database.js';
import {
  isEmailConfigured,
  normalizeNotificationRecipients,
  sendSystemNotificationEmailToEach,
} from '../emailService.js';
import { buildArPdfAttachmentForPaymentConfirmation } from '../paymentArPdfAttachment.js';
import {
  academicYearLabel,
  buildSequenceEmail,
  facebookPageUrl,
  ONBOARDING_EMAIL,
  SEQUENCE_EMAIL_IDS,
} from './emailBodies.js';
import { resolveBranchGroupChat } from './branchGroupChat.js';
import { resolveSequenceEmailContent } from './templateConfig.js';
import {
  loadEnrollmentClassContext,
  loadEnrollmentClassContextForStudent,
} from './classContext.js';

const NEW_ENROLLMENT_STATUS = 'new';
const LOG_ENTITY_SEQUENCE = 'first_enrollment_onboarding_sequence';
const LOG_ENTITY_LEGACY = ONBOARDING_EMAIL.legacyLogType;

const DEFAULT_QUEUE_DELAY_MS = 3000;
const DEFAULT_STEP_DELAY_MS = 45000;

function queueDelayMs() {
  const raw = Number(process.env.FIRST_ENROLLMENT_WELCOME_EMAIL_DELAY_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_QUEUE_DELAY_MS;
}

function stepDelayMs() {
  const raw = Number(process.env.FIRST_ENROLLMENT_SEQUENCE_STEP_DELAY_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_STEP_DELAY_MS;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toEmailAttachments(pdfResult) {
  if (!pdfResult?.buffer) return [];
  return [
    {
      filename: pdfResult.filename || 'acknowledgement-receipt.pdf',
      content: pdfResult.buffer,
      contentType: 'application/pdf',
    },
  ];
}

async function loadStudentAndGuardianEmails(studentId) {
  const result = await poolQuery(
    `SELECT u.user_id,
            u.full_name,
            u.email AS student_email,
            g.email AS guardian_email
     FROM userstbl u
     LEFT JOIN LATERAL (
       SELECT email
       FROM guardianstbl
       WHERE student_id = u.user_id
       ORDER BY guardian_id ASC
       LIMIT 1
     ) g ON true
     WHERE u.user_id = $1
       AND u.user_type = 'Student'
     LIMIT 1`,
    [studentId]
  );
  return result.rows[0] || null;
}

async function alreadySentOnboardingSequence(studentId) {
  const sid = Number(studentId);
  const result = await poolQuery(
    `SELECT 1
     FROM system_logstbl
     WHERE entity_type = ANY($1::text[])
       AND (
         user_id = $2
         OR details->>'student_id' = $3
       )
     LIMIT 1`,
    [[LOG_ENTITY_SEQUENCE, LOG_ENTITY_LEGACY], sid, String(sid)]
  );
  return result.rows.length > 0;
}

/**
 * Remove onboarding idempotency logs so the 5-email sequence can send again.
 * Used by hard-delete wipe scripts and manual test resets.
 */
export async function clearOnboardingEmailLogsForStudents(studentIds = []) {
  const ids = [...new Set(studentIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (!ids.length) return 0;

  const result = await poolQuery(
    `DELETE FROM system_logstbl
     WHERE entity_type = ANY($1::text[])
       AND (
         user_id = ANY($2::int[])
         OR (details->>'student_id')::int = ANY($2::int[])
       )`,
    [[LOG_ENTITY_SEQUENCE, LOG_ENTITY_LEGACY], ids]
  );
  return result.rowCount ?? 0;
}

async function markOnboardingSequenceSent(studentId, recipients, results, meta = {}) {
  try {
    await poolQuery(
      `INSERT INTO system_logstbl (
         user_id, user_full_name, user_type, branch_id,
         http_method, http_status, request_path, action,
         entity_type, summary, details, ip_address
       ) VALUES (
         $1, NULL, 'System', NULL,
         'SYSTEM', 200, '/internal/first-enrollment-onboarding-sequence', 'create',
         $2, $3, $4::jsonb, NULL
       )`,
      [
        studentId,
        LOG_ENTITY_SEQUENCE,
        `First enrollment onboarding sequence (${results.length} emails) sent to ${recipients.join(', ')}`,
        JSON.stringify({
          student_id: Number(studentId),
          recipients,
          emails: results.map((r) => ({
            id: r.id,
            subject: r.subject,
            sent: r.summary?.sent ?? 0,
            failed: r.summary?.failed ?? 0,
          })),
          ar_pdf_attached: Boolean(meta.arPdfAttached),
          invoice_id: meta.invoiceId ?? null,
          ack_receipt_id: meta.ackReceiptId ?? null,
          class_id: meta.classId ?? null,
        }),
      ]
    );
  } catch (err) {
    console.error(
      '[firstEnrollmentWelcomeEmail] Failed to write sequence idempotency log:',
      err?.message || err
    );
  }
}

async function isEarliestNewEnrollment(studentId, classstudentId = null) {
  const earliest = await poolQuery(
    `SELECT classstudent_id
     FROM classstudentstbl
     WHERE student_id = $1
       AND program_enrollment_status = $2
     ORDER BY enrolled_at ASC NULLS LAST, classstudent_id ASC
     LIMIT 1`,
    [studentId, NEW_ENROLLMENT_STATUS]
  );
  if (earliest.rows.length === 0) return false;
  if (classstudentId == null) return true;
  return Number(earliest.rows[0].classstudent_id) === Number(classstudentId);
}

async function resolveEnrollmentArContext(client, studentId, { invoiceId = null, ackReceiptId = null } = {}) {
  let invId = Number(invoiceId);
  let ackId = Number(ackReceiptId);

  if (Number.isFinite(ackId) && ackId > 0) {
    return {
      invoiceId: Number.isFinite(invId) && invId > 0 ? invId : null,
      ackReceiptId: ackId,
    };
  }

  if (Number.isFinite(invId) && invId > 0) {
    return { invoiceId: invId, ackReceiptId: null };
  }

  const ackRes = await client.query(
    `SELECT ar.ack_receipt_id, ar.invoice_id
     FROM acknowledgement_receiptstbl ar
     WHERE ar.student_id = $1
     ORDER BY ar.ack_receipt_id DESC
     LIMIT 1`,
    [studentId]
  );
  if (ackRes.rows[0]?.ack_receipt_id) {
    return {
      invoiceId: ackRes.rows[0].invoice_id != null ? Number(ackRes.rows[0].invoice_id) : null,
      ackReceiptId: Number(ackRes.rows[0].ack_receipt_id),
    };
  }

  const invRes = await client.query(
    `SELECT i.invoice_id, i.ack_receipt_id
     FROM invoicestudentstbl ist
     INNER JOIN invoicestbl i ON i.invoice_id = ist.invoice_id
     WHERE ist.student_id = $1
       AND (
         NULLIF(TRIM(i.invoice_ar_number), '') IS NOT NULL
         OR i.ack_receipt_id IS NOT NULL
         OR EXISTS (
           SELECT 1 FROM acknowledgement_receiptstbl ar WHERE ar.invoice_id = i.invoice_id
         )
         OR EXISTS (
           SELECT 1
           FROM paymenttbl p
           WHERE p.invoice_id = i.invoice_id
             AND p.status = 'Completed'
         )
       )
     ORDER BY
       CASE WHEN LOWER(TRIM(COALESCE(i.status, ''))) IN ('paid', 'partially paid') THEN 0 ELSE 1 END,
       i.invoice_id DESC
     LIMIT 1`,
    [studentId]
  );
  if (invRes.rows[0]?.invoice_id) {
    return {
      invoiceId: Number(invRes.rows[0].invoice_id),
      ackReceiptId:
        invRes.rows[0].ack_receipt_id != null ? Number(invRes.rows[0].ack_receipt_id) : null,
    };
  }

  return { invoiceId: null, ackReceiptId: null };
}

async function buildWelcomeArAttachments(studentId, { invoiceId = null, ackReceiptId = null } = {}) {
  const client = await getClient();
  try {
    const resolved = await resolveEnrollmentArContext(client, studentId, {
      invoiceId,
      ackReceiptId,
    });
    if (!resolved.invoiceId && !resolved.ackReceiptId) {
      return { attachments: [], resolved, arPdfAttached: false };
    }

    const pdf = await buildArPdfAttachmentForPaymentConfirmation(client, {
      invoiceId: resolved.invoiceId,
      ackReceiptId: resolved.ackReceiptId,
    });
    const attachments = toEmailAttachments(pdf);
    return {
      attachments,
      resolved,
      arPdfAttached: attachments.length > 0,
    };
  } catch (err) {
    console.error(
      `[firstEnrollmentWelcomeEmail] AR PDF build failed for student ${studentId}:`,
      err?.message || err
    );
    return { attachments: [], resolved: { invoiceId, ackReceiptId }, arPdfAttached: false };
  } finally {
    client.release();
  }
}

async function sendSequenceEmail({
  emailId,
  recipients,
  context,
  attachments = [],
  branchId = null,
}) {
  const content = await resolveSequenceEmailContent({
    emailId,
    context,
    branchId,
  });

  if (content.skipped || !content.enabled) {
    return {
      id: emailId,
      subject: content.subject || '',
      summary: { sent: 0, failed: 0, attempted: 0, skipped: true },
      skipped: true,
      source: content.source,
    };
  }

  const summary = await sendSystemNotificationEmailToEach({
    recipients,
    subject: content.subject,
    html: content.html,
    attachments,
  });
  return {
    id: emailId,
    subject: content.subject,
    summary,
    source: content.source,
  };
}

/**
 * Send the full first-enrollment onboarding sequence.
 */
export async function maybeSendFirstEnrollmentWelcomeEmail({
  studentId,
  enrollmentStatus = NEW_ENROLLMENT_STATUS,
  classstudentId = null,
  invoiceId = null,
  ackReceiptId = null,
} = {}) {
  const sid = Number(studentId);
  if (!Number.isFinite(sid) || sid <= 0) {
    return { skipped: true, reason: 'invalid_student_id' };
  }

  if (String(enrollmentStatus || '').trim() !== NEW_ENROLLMENT_STATUS) {
    return { skipped: true, reason: 'not_new_status' };
  }

  if (!isEmailConfigured()) {
    console.warn(`[firstEnrollmentWelcomeEmail] Email not configured; skip student ${sid}`);
    return { skipped: true, reason: 'email_not_configured' };
  }

  if (await alreadySentOnboardingSequence(sid)) {
    console.warn(`[firstEnrollmentWelcomeEmail] Skip student ${sid}: already_sent`);
    return { skipped: true, reason: 'already_sent' };
  }

  if (!(await isEarliestNewEnrollment(sid, classstudentId))) {
    console.warn(`[firstEnrollmentWelcomeEmail] Skip student ${sid}: not_earliest_new_enrollment`);
    return { skipped: true, reason: 'not_earliest_new_enrollment' };
  }

  const row = await loadStudentAndGuardianEmails(sid);
  if (!row) {
    return { skipped: true, reason: 'student_not_found' };
  }

  const recipients = normalizeNotificationRecipients([row.student_email, row.guardian_email]);
  if (recipients.length === 0) {
    console.warn(`[firstEnrollmentWelcomeEmail] No valid student/guardian email for student ${sid}`);
    return { skipped: true, reason: 'no_recipients' };
  }

  const classContext =
    (classstudentId != null ? await loadEnrollmentClassContext(classstudentId) : null) ||
    (await loadEnrollmentClassContextForStudent(sid));

  const arBundle = await buildWelcomeArAttachments(sid, { invoiceId, ackReceiptId });
  const year = academicYearLabel();
  const groupChat = resolveBranchGroupChat({
    branchId: classContext?.branchId ?? null,
    branchName: classContext?.branchName,
    branchNickname: classContext?.branchNickname,
  });
  const sharedContext = {
    academicYear: year,
    classStartDateDisplay: classContext?.classStartDateDisplay || 'To be announced',
    classScheduleText: classContext?.classScheduleText || 'Please contact your branch for your class schedule.',
    branchName: classContext?.branchName || '',
    branchId: classContext?.branchId ?? null,
    facebookUrl: facebookPageUrl(),
    groupChatUrl: groupChat.url,
    groupChatLabel: groupChat.displayLabel,
  };

  const results = [];
  const stepDelay = stepDelayMs();

  for (let i = 0; i < SEQUENCE_EMAIL_IDS.length; i += 1) {
    const emailId = SEQUENCE_EMAIL_IDS[i];
    if (i > 0 && stepDelay > 0) {
      await sleep(stepDelay);
    }

    const emailContext =
      emailId === 'onboarding'
        ? { ...sharedContext, includeArAttachmentNote: arBundle.arPdfAttached }
        : sharedContext;

    const attachments = emailId === 'onboarding' ? arBundle.attachments : [];

    const sent = await sendSequenceEmail({
      emailId,
      recipients,
      context: emailContext,
      attachments,
      branchId: classContext?.branchId ?? null,
    });
    results.push(sent);

    if (sent.skipped) {
      console.log(
        `[firstEnrollmentWelcomeEmail] student ${sid} email "${emailId}": skipped (${sent.source || 'disabled'})`
      );
      continue;
    }

    console.log(
      `[firstEnrollmentWelcomeEmail] student ${sid} email "${emailId}": ` +
        `${sent.summary.sent}/${sent.summary.attempted} sent (${sent.source || 'unknown'})`
    );

    if (sent.summary.sent === 0) {
      console.warn(
        `[firstEnrollmentWelcomeEmail] Abort sequence for student ${sid} — "${emailId}" failed`
      );
      return {
        skipped: false,
        studentId: sid,
        recipients,
        partial: true,
        results,
        arPdfAttached: arBundle.arPdfAttached,
      };
    }
  }

  const sentCount = results.filter((r) => !r.skipped && (r.summary?.sent ?? 0) > 0).length;
  if (sentCount === 0) {
    return {
      skipped: true,
      reason: 'all_steps_skipped_or_failed',
      studentId: sid,
      recipients,
      results,
    };
  }

  await markOnboardingSequenceSent(sid, recipients, results, {
    arPdfAttached: arBundle.arPdfAttached,
    invoiceId: arBundle.resolved?.invoiceId ?? null,
    ackReceiptId: arBundle.resolved?.ackReceiptId ?? null,
    classId: classContext?.classId ?? null,
  });

  console.log(
    `[firstEnrollmentWelcomeEmail] student ${sid} (${row.full_name}): ` +
      `sequence complete (${results.length} emails) to ${recipients.join(', ')}`
  );

  return {
    skipped: false,
    studentId: sid,
    recipients,
    results,
    arPdfAttached: arBundle.arPdfAttached,
    invoiceId: arBundle.resolved?.invoiceId ?? null,
    ackReceiptId: arBundle.resolved?.ackReceiptId ?? null,
    classId: classContext?.classId ?? null,
  };
}

/** Fire-and-forget after enrollment writes. */
export function queueFirstEnrollmentWelcomeEmail({
  studentId,
  enrollmentStatus,
  classstudentId = null,
  invoiceId = null,
  ackReceiptId = null,
} = {}) {
  if (String(enrollmentStatus || '').trim() !== NEW_ENROLLMENT_STATUS) {
    return;
  }

  const sid = Number(studentId);
  if (!Number.isFinite(sid) || sid <= 0) return;

  const delay = queueDelayMs();
  setTimeout(() => {
    maybeSendFirstEnrollmentWelcomeEmail({
      studentId: sid,
      enrollmentStatus: NEW_ENROLLMENT_STATUS,
      classstudentId,
      invoiceId,
      ackReceiptId,
    }).catch((err) => {
      console.error(`[firstEnrollmentWelcomeEmail] Failed for student ${sid}:`, err?.message || err);
    });
  }, delay);
}

export {
  academicYearLabel,
  buildClassSchedulePlainText,
  buildFirstEnrollmentWelcomeHtml,
  buildFirstEnrollmentWelcomePlainText,
  buildImportantRemindersPlainText,
  buildOnboardingHtml,
  buildOnboardingPlainText,
  buildSequenceEmail,
  buildStayConnectedHtml,
  buildStayConnectedPlainText,
  buildThingsToPreparePlainText,
  facebookPageUrl,
  SEQUENCE_EMAIL_IDS,
} from './emailBodies.js';

export {
  formatClassScheduleText,
  loadEnrollmentClassContext,
  loadEnrollmentClassContextForStudent,
} from './classContext.js';

export {
  DEFAULT_BRANCH_GROUP_CHAT_LINKS,
  groupChatFallbackText,
  resolveBranchGroupChat,
} from './branchGroupChat.js';

export {
  resolveSequenceEmailContent,
  EMAIL_ID_TO_TEMPLATE_KEY,
  buildFirstEnrollmentTemplateVariables,
  FIRST_ENROLLMENT_TEMPLATE_KEYS,
} from './templateConfig.js';

export default {
  maybeSendFirstEnrollmentWelcomeEmail,
  queueFirstEnrollmentWelcomeEmail,
  clearOnboardingEmailLogsForStudents,
};
