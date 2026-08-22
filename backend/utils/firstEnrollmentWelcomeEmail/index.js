/**
 * First-enrollment welcome email for Little Champions Academy.
 * Sends once when a student receives program_enrollment_status = 'new'.
 * Recipients: student email + primary guardian email (deduped case-insensitively).
 * Attaches downloadable AR PDF when an invoice/AR can be resolved (same as Payment Received).
 */

import { getClient, query as poolQuery } from '../../config/database.js';
import {
  isEmailConfigured,
  normalizeNotificationRecipients,
  sendSystemNotificationEmailToEach,
} from '../emailService.js';
import { buildArPdfAttachmentForPaymentConfirmation } from '../paymentArPdfAttachment.js';
import { plainTextToEmailHtml } from '../templateRenderService.js';

const NEW_ENROLLMENT_STATUS = 'new';
const LOG_ENTITY_TYPE = 'first_enrollment_welcome_email';
const DEFAULT_ACADEMIC_YEAR = '2026–2027';
const DEFAULT_QUEUE_DELAY_MS = 3000;

function academicYearLabel() {
  const fromEnv = String(process.env.FIRST_ENROLLMENT_WELCOME_ACADEMIC_YEAR || '').trim();
  return fromEnv || DEFAULT_ACADEMIC_YEAR;
}

function queueDelayMs() {
  const raw = Number(process.env.FIRST_ENROLLMENT_WELCOME_EMAIL_DELAY_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_QUEUE_DELAY_MS;
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

/**
 * Exact client welcome copy (Academic Year from env / default 2026–2027).
 * Same layout as payment confirmation emails (yellow header + gray footer).
 */
export function buildFirstEnrollmentWelcomePlainText({ includeArAttachmentNote = false } = {}) {
  const year = academicYearLabel();
  const lines = [
    'Congratulations!',
    '',
    `We are pleased to inform you that you are now officially enrolled at Little Champions Academy Inc. for Academic Year ${year}.`,
    '',
    'We are delighted to welcome you to the Little Champions family! We look forward to partnering with you in creating a meaningful and exciting learning journey filled with opportunities to play, learn, and succeed.',
    '',
    'Thank you for choosing Little Champions Academy. We are excited to have you with us!',
    '',
    'Welcome to Little Champions Academy!',
  ];

  if (includeArAttachmentNote) {
    lines.push(
      '',
      'Your acknowledgement receipt is attached to this email as a PDF for your records.'
    );
  }

  lines.push(
    '',
    'Best Regards,',
    'Little Champions Academy Inc.',
    'Play . Learn . Succeed'
  );

  return lines.join('\n');
}

/**
 * HTML matches Settings messaging emails (e.g. Payment Received):
 * yellow LCA banner, white body, gray automated footer.
 */
export function buildFirstEnrollmentWelcomeHtml(options = {}) {
  return plainTextToEmailHtml(buildFirstEnrollmentWelcomePlainText(options));
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

async function alreadySentWelcomeEmail(studentId) {
  const result = await poolQuery(
    `SELECT 1
     FROM system_logstbl
     WHERE entity_type = $1
       AND details->>'student_id' = $2
     LIMIT 1`,
    [LOG_ENTITY_TYPE, String(studentId)]
  );
  return result.rows.length > 0;
}

async function markWelcomeEmailSent(studentId, recipients, summary, meta = {}) {
  try {
    await poolQuery(
      `INSERT INTO system_logstbl (
         user_id, user_full_name, user_type, branch_id,
         http_method, http_status, request_path, action,
         entity_type, summary, details, ip_address
       ) VALUES (
         $1, NULL, 'System', NULL,
         'SYSTEM', 200, '/internal/first-enrollment-welcome-email', 'create',
         $2, $3, $4::jsonb, NULL
       )`,
      [
        studentId,
        LOG_ENTITY_TYPE,
        `First enrollment welcome email sent to ${recipients.join(', ')}`,
        JSON.stringify({
          student_id: Number(studentId),
          recipients,
          sent: summary?.sent ?? 0,
          failed: summary?.failed ?? 0,
          ar_pdf_attached: Boolean(meta.arPdfAttached),
          invoice_id: meta.invoiceId ?? null,
          ack_receipt_id: meta.ackReceiptId ?? null,
        }),
      ]
    );
  } catch (err) {
    console.error(
      '[firstEnrollmentWelcomeEmail] Failed to write idempotency log (email may have been sent):',
      err?.message || err
    );
  }
}

/**
 * True when this enrollment is the student's earliest `new` row (first official enroll).
 */
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

/**
 * Resolve invoice / AR for the enrollment welcome PDF when callers do not pass ids.
 */
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

/**
 * Send welcome email if this is the student's first `new` enrollment and not already sent.
 * Uses the shared DB pool (call after COMMIT, or via queueFirstEnrollmentWelcomeEmail).
 *
 * @param {{
 *   studentId: number,
 *   enrollmentStatus?: string,
 *   classstudentId?: number|null,
 *   invoiceId?: number|null,
 *   ackReceiptId?: number|null,
 * }} args
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
    console.warn(
      `[firstEnrollmentWelcomeEmail] Email not configured; skip student ${sid}`
    );
    return { skipped: true, reason: 'email_not_configured' };
  }

  if (await alreadySentWelcomeEmail(sid)) {
    console.warn(
      `[firstEnrollmentWelcomeEmail] Skip student ${sid}: already_sent ` +
        `(hard-delete billing does not clear this unless the wipe script removes the welcome log)`
    );
    return { skipped: true, reason: 'already_sent' };
  }

  if (!(await isEarliestNewEnrollment(sid, classstudentId))) {
    console.warn(
      `[firstEnrollmentWelcomeEmail] Skip student ${sid}: not_earliest_new_enrollment ` +
        `(classstudentId=${classstudentId ?? 'null'})`
    );
    return { skipped: true, reason: 'not_earliest_new_enrollment' };
  }

  const row = await loadStudentAndGuardianEmails(sid);
  if (!row) {
    return { skipped: true, reason: 'student_not_found' };
  }

  const recipients = normalizeNotificationRecipients([
    row.student_email,
    row.guardian_email,
  ]);
  if (recipients.length === 0) {
    console.warn(
      `[firstEnrollmentWelcomeEmail] No valid student/guardian email for student ${sid}`
    );
    return { skipped: true, reason: 'no_recipients' };
  }

  const arBundle = await buildWelcomeArAttachments(sid, { invoiceId, ackReceiptId });
  const subject = 'Welcome to Little Champions Academy!';
  const html = buildFirstEnrollmentWelcomeHtml({
    includeArAttachmentNote: arBundle.arPdfAttached,
  });

  const summary = await sendSystemNotificationEmailToEach({
    recipients,
    subject,
    html,
    attachments: arBundle.attachments,
  });

  if (summary.sent > 0) {
    await markWelcomeEmailSent(sid, recipients, summary, {
      arPdfAttached: arBundle.arPdfAttached,
      invoiceId: arBundle.resolved?.invoiceId ?? null,
      ackReceiptId: arBundle.resolved?.ackReceiptId ?? null,
    });
  }

  console.log(
    `[firstEnrollmentWelcomeEmail] student ${sid} (${row.full_name}): ` +
      `${summary.sent}/${summary.attempted} sent to ${recipients.join(', ')}` +
      `; arPdfAttached=${arBundle.arPdfAttached}`
  );

  return {
    skipped: false,
    studentId: sid,
    recipients,
    summary,
    arPdfAttached: arBundle.arPdfAttached,
    invoiceId: arBundle.resolved?.invoiceId ?? null,
    ackReceiptId: arBundle.resolved?.ackReceiptId ?? null,
  };
}

/**
 * Fire-and-forget after enrollment writes. Short delay lets the surrounding
 * DB transaction COMMIT before we read enrollment rows / build AR PDF.
 */
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
      console.error(
        `[firstEnrollmentWelcomeEmail] Failed for student ${sid}:`,
        err?.message || err
      );
    });
  }, delay);
}

export default {
  buildFirstEnrollmentWelcomePlainText,
  buildFirstEnrollmentWelcomeHtml,
  maybeSendFirstEnrollmentWelcomeEmail,
  queueFirstEnrollmentWelcomeEmail,
};
