/**
 * Daily Summary Sales
 * - Admin: Submit daily summary for TODAY only (amount auto-calculated from paymenttbl)
 * - One submission per branch per calendar day; stores the full day total (all payments with issue_date = summary date).
 * - Admin submissions are auto-verified (Approved) on submit
 * - Superadmin / Superfinance: List summaries and optionally flag for review
 */
import express from 'express';
import { param, query as queryValidator, body } from 'express-validator';
import { verifyFirebaseToken, requireRole, requireBranchAccess } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query } from '../config/database.js';
import {
  sendSystemNotificationEmailToEach,
  normalizeNotificationRecipients,
} from '../utils/emailService.js';

const router = express.Router();
router.use(verifyFirebaseToken);
router.use(requireBranchAccess);

/**
 * GET /api/sms/daily-summary-sales
 * List daily summaries with filters.
 * Admin: only their branch. Superadmin/Superfinance: all branches (optional branch_id filter).
 */
router.get(
  '/',
  [
    queryValidator('branch_id').optional().isInt().withMessage('branch_id must be an integer'),
    queryValidator('summary_date').optional().isISO8601().withMessage('summary_date must be YYYY-MM-DD'),
    queryValidator('status').optional().isIn(['Submitted', 'Approved', 'Rejected']).withMessage('status must be Submitted, Approved, or Rejected'),
    queryValidator('page').optional().isInt({ min: 1 }).withMessage('page must be positive'),
    queryValidator('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit 1-100'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { branch_id, summary_date, status, page = 1, limit = 50 } = req.query;
      const userType = req.user.userType;
      const userBranchId = req.user.branchId;
      const limitNum = parseInt(limit) || 50;
      const pageNum = parseInt(page) || 1;
      const offset = (pageNum - 1) * limitNum;

      let sql = `
        SELECT d.daily_summary_id, d.branch_id, d.summary_date, d.total_amount, d.payment_count,
               d.status, d.submitted_by, d.submitted_at, d.approved_by, d.approved_at, d.remarks,
               COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
               sub.full_name AS submitted_by_name,
               app.full_name AS approved_by_name
        FROM daily_summary_salestbl d
        LEFT JOIN branchestbl b ON d.branch_id = b.branch_id
        LEFT JOIN userstbl sub ON d.submitted_by = sub.user_id
        LEFT JOIN userstbl app ON d.approved_by = app.user_id
        WHERE 1=1`;
      const params = [];
      let pc = 0;

      // Admin: restrict to their branch
      if (userType === 'Admin' && userBranchId) {
        pc++;
        sql += ` AND d.branch_id = $${pc}`;
        params.push(userBranchId);
      } else if (branch_id) {
        pc++;
        sql += ` AND d.branch_id = $${pc}`;
        params.push(branch_id);
      }

      if (summary_date) {
        pc++;
        sql += ` AND d.summary_date = $${pc}`;
        params.push(summary_date);
      }
      if (status) {
        pc++;
        sql += ` AND d.status = $${pc}`;
        params.push(status);
      }

      sql += ` ORDER BY d.summary_date DESC, d.branch_id ASC LIMIT $${pc + 1} OFFSET $${pc + 2}`;
      params.push(limitNum, offset);

      const result = await query(sql, params);

      // Count total
      let countSql = `SELECT COUNT(*) AS total FROM daily_summary_salestbl d WHERE 1=1`;
      const countParams = [];
      let cc = 0;
      if (userType === 'Admin' && userBranchId) {
        cc++;
        countSql += ` AND d.branch_id = $${cc}`;
        countParams.push(userBranchId);
      } else if (branch_id) {
        cc++;
        countSql += ` AND d.branch_id = $${cc}`;
        countParams.push(branch_id);
      }
      if (summary_date) {
        cc++;
        countSql += ` AND d.summary_date = $${cc}`;
        countParams.push(summary_date);
      }
      if (status) {
        cc++;
        countSql += ` AND d.status = $${cc}`;
        countParams.push(status);
      }
      const countRes = await query(countSql, countParams);
      const total = parseInt(countRes.rows[0]?.total || 0, 10);

      res.json({
        success: true,
        data: result.rows,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum) || 1,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/sms/daily-summary-sales/preview
 * Preview today's calculated total for a branch (from paymenttbl).
 * Admin: only their branch. Superadmin/Superfinance: require branch_id.
 */
router.get(
  '/preview',
  [
    queryValidator('branch_id').optional().isInt().withMessage('branch_id must be an integer'),
    queryValidator('date').optional().isISO8601().withMessage('date must be YYYY-MM-DD'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const userType = req.user.userType;
      const userBranchId = req.user.branchId;
      const { branch_id, date } = req.query;

      let targetBranchId = branch_id ? parseInt(branch_id, 10) : userBranchId;
      const targetDateRaw = date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
      const targetDate = String(targetDateRaw).slice(0, 10);

      if (!targetBranchId) {
        return res.status(400).json({
          success: false,
          message: 'branch_id is required for Superadmin/Superfinance',
        });
      }

      if (userType === 'Admin' && targetBranchId !== userBranchId) {
        return res.status(403).json({
          success: false,
          message: 'You can only preview your assigned branch',
        });
      }

      const lastSubmittedAt = await getLastEodSubmittedAt({
        branchId: targetBranchId,
        summaryDate: targetDate,
      });
      const snapshot = await getEodPaymentSnapshot({
        branchId: targetBranchId,
        summaryDate: targetDate,
        submittedAfter: null,
      });

      res.json({
        success: true,
        data: {
          branch_id: targetBranchId,
          summary_date: targetDate,
          total_amount: snapshot.total,
          payment_count: snapshot.paymentCount,
          payments: snapshot.payments,
          last_submitted_at: lastSubmittedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

const TODAY_MANILA = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

const getLastEodSubmittedAt = async ({ branchId, summaryDate }) => {
  const result = await query(
    `SELECT submitted_at
     FROM daily_summary_salestbl
     WHERE branch_id = $1 AND summary_date = $2::date
     LIMIT 1`,
    [branchId, summaryDate]
  );
  return result.rows[0]?.submitted_at || null;
};

const getEodPaymentSnapshot = async ({ branchId, summaryDate, submittedAfter = null }) => {
  const whereParts = ['p.branch_id = $1', 'p.issue_date = $2::date'];
  const params = [branchId, summaryDate];
  let pc = 2;

  if (submittedAfter) {
    pc += 1;
    whereParts.push(`p.created_at > $${pc}`);
    params.push(submittedAfter);
  }

  const whereClause = whereParts.join(' AND ');

  const sumRes = await query(
    `SELECT COALESCE(SUM(p.payable_amount), 0) AS total,
            COUNT(*) AS payment_count
     FROM paymenttbl p
     WHERE ${whereClause}`,
    params
  );

  const paymentsRes = await query(
    `SELECT p.payment_id,
            p.invoice_id,
            p.student_id,
            p.payment_method,
            p.payable_amount,
            p.reference_number,
            TO_CHAR(p.issue_date, 'YYYY-MM-DD') AS issue_date,
            u.full_name AS student_name,
            u.email AS student_email,
            i.invoice_description,
            i.ack_receipt_id
     FROM paymenttbl p
     LEFT JOIN userstbl u ON p.student_id = u.user_id
     LEFT JOIN invoicestbl i ON p.invoice_id = i.invoice_id
     WHERE ${whereClause}
     ORDER BY p.payment_id DESC`,
    params
  );

  const row = sumRes.rows[0];
  const total = Math.round((parseFloat(row?.total || 0)) * 100) / 100;
  const paymentCount = parseInt(row?.payment_count || 0, 10);

  // Replace Walk-in Customer with AR prospect name for merchandise AR payments
  const payments = [];
  for (const paymentRow of paymentsRes.rows || []) {
    let studentName = paymentRow.student_name;
    let studentEmail = paymentRow.student_email;

    const isWalkIn = (studentEmail || '').toLowerCase() === 'walkin@merchandise.psms.internal';
    if (isWalkIn && paymentRow.ack_receipt_id) {
      const arResult = await query(
        'SELECT prospect_student_name FROM acknowledgement_receiptstbl WHERE ack_receipt_id = $1',
        [paymentRow.ack_receipt_id]
      );
      const prospectName = arResult.rows[0]?.prospect_student_name || null;
      if (prospectName) {
        studentName = prospectName;
      }
    }

    payments.push({
      ...paymentRow,
      student_name: studentName,
      student_email: studentEmail,
    });
  }

  return {
    total,
    paymentCount,
    payments,
  };
};

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** e.g. 2026-04-08 → Wednesday, April 8, 2026 (for formal email copy) */
const formatBusinessDateFormal = (ymd) => {
  const s = String(ymd || '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const d = parseInt(m[3], 10);
  const dt = new Date(Date.UTC(y, mo, d));
  return dt.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
};

/**
 * Wrap HTML for email clients that use dark UI: force a light content area so #111827 text stays readable.
 */
const wrapEodNotificationHtml = (innerBodyHtml) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:0;background-color:#e5e7eb;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#e5e7eb;">
  <tr>
    <td align="center" style="padding:20px 12px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background-color:#ffffff;border-radius:8px;border:1px solid #d1d5db;">
        <tr>
          <td style="padding:20px 24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#111827;">
${innerBodyHtml}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

const sendEodEmailNotifications = async ({
  submittedBranchId,
  summaryDate,
  totalAmount,
  paymentCount,
  submittedByUserId,
}) => {
  try {
    const [branchResult, submitterResult, stakeholderRecipientsResult, branchAdminsResult, activeBranchesResult, submittedBranchesResult] =
      await Promise.all([
      query(
        `SELECT COALESCE(branch_nickname, branch_name) AS branch_name
         FROM branchestbl
         WHERE branch_id = $1`,
        [submittedBranchId]
      ),
      query(
        `SELECT full_name, email
         FROM userstbl
         WHERE user_id = $1`,
        [submittedByUserId]
      ),
      query(
        `SELECT DISTINCT TRIM(email) AS email
         FROM userstbl
         WHERE LOWER(TRIM(user_type)) IN ('superadmin', 'finance')
           AND COALESCE(TRIM(email), '') <> ''`
      ),
      query(
        `SELECT DISTINCT TRIM(email) AS email
         FROM userstbl
         WHERE LOWER(TRIM(user_type)) = 'admin'
           AND branch_id = $1
           AND COALESCE(TRIM(email), '') <> ''`,
        [submittedBranchId]
      ),
      query(
        `SELECT branch_id, COALESCE(branch_nickname, branch_name) AS branch_name
         FROM branchestbl
         WHERE COALESCE(status, 'Active') = 'Active'
         ORDER BY COALESCE(branch_nickname, branch_name) ASC`
      ),
      query(
        `SELECT d.branch_id, COALESCE(b.branch_nickname, b.branch_name) AS branch_name
         FROM daily_summary_salestbl d
         LEFT JOIN branchestbl b ON d.branch_id = b.branch_id
         WHERE d.summary_date = $1::date
         ORDER BY COALESCE(b.branch_nickname, b.branch_name) ASC`,
        [summaryDate]
      ),
    ]);

    const submitterEmail = submitterResult.rows[0]?.email
      ? String(submitterResult.rows[0].email).trim()
      : null;
    const submitterName = submitterResult.rows[0]?.full_name || submitterEmail || 'Branch Admin';
    const submittedBranchName = branchResult.rows[0]?.branch_name || `Branch ${submittedBranchId}`;

    const uniqueStakeholderEmails = normalizeNotificationRecipients(
      (stakeholderRecipientsResult.rows || []).map((row) => row.email)
    );

    const branchAdminEmails = normalizeNotificationRecipients(
      (branchAdminsResult.rows || []).map((row) => row.email)
    );
    const branchConfirmationEmails = normalizeNotificationRecipients([
      ...branchAdminEmails,
      submitterEmail,
    ]);

    const submittedBranchIds = new Set((submittedBranchesResult.rows || []).map((row) => Number(row.branch_id)));
    const submittedBranchNames = (submittedBranchesResult.rows || [])
      .map((row) => row.branch_name)
      .filter(Boolean);
    const missingBranchNames = (activeBranchesResult.rows || [])
      .filter((row) => !submittedBranchIds.has(Number(row.branch_id)))
      .map((row) => row.branch_name)
      .filter(Boolean);

    const formattedTotal = Number(totalAmount || 0).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const dateFormal = formatBusinessDateFormal(summaryDate);
    const payLabel =
      Number(paymentCount) === 1 ? '1 payment transaction' : `${escapeHtml(String(paymentCount))} payment transactions`;

    const stakeholderSubject = `[PSMS] End of Day recorded — ${submittedBranchName} (${summaryDate})`;
    const stakeholderInner = `
            <p style="margin:0 0 16px;color:#374151;font-size:13px;text-transform:uppercase;letter-spacing:0.06em;">Physical School Management System</p>
            <h2 style="margin:0 0 16px;font-size:18px;font-weight:700;color:#111827;line-height:1.35;">End of Day — Management Notification</h2>
            <p style="margin:0 0 16px;color:#111827;line-height:1.6;">
              Dear Management Team,
            </p>
            <p style="margin:0 0 16px;color:#111827;line-height:1.6;">
              Please be advised that an <strong style="color:#0f172a;">End of Day (EOD)</strong> cash closure has been recorded for the business date indicated below. This message is provided for your oversight of branch compliance and consolidated reporting.
            </p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 20px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
              <tr>
                <td style="padding:12px 14px;background-color:#f9fafb;border-bottom:1px solid #e5e7eb;font-size:12px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:0.04em;">Submission summary</td>
              </tr>
              <tr>
                <td style="padding:14px 16px;background-color:#ffffff;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="font-size:14px;color:#111827;">
                    <tr><td style="padding:6px 0;border-bottom:1px solid #f3f4f6;"><span style="color:#6b7280;">Recorded by</span></td><td style="padding:6px 0;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:600;color:#0f172a;">${escapeHtml(submitterName)}</td></tr>
                    <tr><td style="padding:6px 0;border-bottom:1px solid #f3f4f6;"><span style="color:#6b7280;">Branch</span></td><td style="padding:6px 0;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:600;color:#0f172a;">${escapeHtml(submittedBranchName)}</td></tr>
                    <tr><td style="padding:6px 0;border-bottom:1px solid #f3f4f6;"><span style="color:#6b7280;">Business date</span></td><td style="padding:6px 0;border-bottom:1px solid #f3f4f6;text-align:right;">${escapeHtml(dateFormal)} <span style="color:#9ca3af;font-size:12px;">(${escapeHtml(summaryDate)})</span></td></tr>
                    <tr><td style="padding:6px 0;"><span style="color:#6b7280;">Total amount declared</span></td><td style="padding:6px 0;text-align:right;font-weight:700;color:#0f172a;">PHP ${escapeHtml(formattedTotal)}</td></tr>
                    <tr><td style="padding:6px 0 0;"><span style="color:#6b7280;">Supporting transactions</span></td><td style="padding:6px 0 0;text-align:right;">${payLabel}</td></tr>
                  </table>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#111827;text-transform:uppercase;letter-spacing:0.03em;">Branches — EOD completed (${submittedBranchNames.length})</p>
            <ul style="margin:0 0 18px 20px;padding:0;color:#111827;line-height:1.55;">
              ${(submittedBranchNames.length ? submittedBranchNames : ['None']).map((name) => `<li style="margin-bottom:4px;">${escapeHtml(name)}</li>`).join('')}
            </ul>
            <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#111827;text-transform:uppercase;letter-spacing:0.03em;">Branches — EOD outstanding (${missingBranchNames.length})</p>
            <ul style="margin:0 0 20px 20px;padding:0;color:#111827;line-height:1.55;">
              ${(missingBranchNames.length ? missingBranchNames : ['None']).map((name) => `<li style="margin-bottom:4px;">${escapeHtml(name)}</li>`).join('')}
            </ul>
            <p style="margin:0 0 12px;color:#111827;line-height:1.6;">
              Kindly follow up with branches that have not yet filed their End of Day, as required by internal policy.
            </p>
            <p style="margin:0 0 16px;color:#111827;line-height:1.6;">
              Respectfully yours,<br/>
              <span style="color:#6b7280;font-size:14px;">Physical School Management System (PSMS)</span>
            </p>
            <p style="margin:0;padding-top:14px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;line-height:1.5;">
              This is an automated message. Please do not reply to this email. For assistance, contact your system administrator.
            </p>`;
    const stakeholderHtml = wrapEodNotificationHtml(stakeholderInner);

    const submitterSubject = `[PSMS] Confirmation — End of Day submitted (${summaryDate})`;
    const submitterInner = `
            <p style="margin:0 0 16px;color:#374151;font-size:13px;text-transform:uppercase;letter-spacing:0.06em;">Physical School Management System</p>
            <h2 style="margin:0 0 16px;font-size:18px;font-weight:700;color:#111827;line-height:1.35;">End of Day — Acknowledgement of Receipt</h2>
            <p style="margin:0 0 16px;color:#111827;line-height:1.6;">
              Dear Colleague,
            </p>
            <p style="margin:0 0 16px;color:#111827;line-height:1.6;">
              This email confirms that the <strong style="color:#0f172a;">End of Day (EOD)</strong> submission for your branch has been received and recorded in PSMS for the business date stated below.
            </p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 20px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
              <tr>
                <td style="padding:12px 14px;background-color:#f9fafb;border-bottom:1px solid #e5e7eb;font-size:12px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:0.04em;">Your submission</td>
              </tr>
              <tr>
                <td style="padding:14px 16px;background-color:#ffffff;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="font-size:14px;color:#111827;">
                    <tr><td style="padding:6px 0;border-bottom:1px solid #f3f4f6;"><span style="color:#6b7280;">Branch</span></td><td style="padding:6px 0;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:600;color:#0f172a;">${escapeHtml(submittedBranchName)}</td></tr>
                    <tr><td style="padding:6px 0;border-bottom:1px solid #f3f4f6;"><span style="color:#6b7280;">Business date</span></td><td style="padding:6px 0;border-bottom:1px solid #f3f4f6;text-align:right;">${escapeHtml(dateFormal)} <span style="color:#9ca3af;font-size:12px;">(${escapeHtml(summaryDate)})</span></td></tr>
                    <tr><td style="padding:6px 0;"><span style="color:#6b7280;">Total amount declared</span></td><td style="padding:6px 0;text-align:right;font-weight:700;color:#0f172a;">PHP ${escapeHtml(formattedTotal)}</td></tr>
                    <tr><td style="padding:6px 0 0;"><span style="color:#6b7280;">Supporting transactions</span></td><td style="padding:6px 0 0;text-align:right;">${payLabel}</td></tr>
                  </table>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 16px;color:#111827;line-height:1.6;">
              Thank you for completing your End of Day procedures in a timely manner.
            </p>
            <p style="margin:0 0 16px;color:#111827;line-height:1.6;">
              Respectfully yours,<br/>
              <span style="color:#6b7280;font-size:14px;">Physical School Management System (PSMS)</span>
            </p>
            <p style="margin:0;padding-top:14px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;line-height:1.5;">
              This is an automated message. Please do not reply to this email.
            </p>`;
    const submitterHtml = wrapEodNotificationHtml(submitterInner);

    // 1) Superadmin + Finance: one email each (whole-branch submitted / not submitted lists)
    try {
      if (uniqueStakeholderEmails.length > 0) {
        const summary = await sendSystemNotificationEmailToEach({
          recipients: uniqueStakeholderEmails,
          subject: stakeholderSubject,
          html: stakeholderHtml,
        });
        console.log('[EOD email] Stakeholder digest:', {
          attempted: summary.attempted,
          sent: summary.sent,
          failed: summary.failed,
          ...(summary.errors?.length ? { errors: summary.errors } : {}),
        });
      } else {
        console.warn(
          '[EOD email] No stakeholder recipients: ensure Superadmin/Finance users have a valid email in Personnel / userstbl.'
        );
      }
    } catch (err) {
      console.error('[EOD email] Stakeholder digest unexpected error:', err?.message || err);
    }

    // 2) Branch Admin(s) + submitter: confirmation for this branch’s EOD
    try {
      if (branchConfirmationEmails.length > 0) {
        const summary = await sendSystemNotificationEmailToEach({
          recipients: branchConfirmationEmails,
          subject: submitterSubject,
          html: submitterHtml,
        });
        console.log('[EOD email] Branch confirmation:', {
          attempted: summary.attempted,
          sent: summary.sent,
          failed: summary.failed,
          ...(summary.errors?.length ? { errors: summary.errors } : {}),
        });
      } else {
        console.warn(
          '[EOD email] No branch confirmation recipients: set a valid email on the submitting Admin and on branch Admin users (same branch_id in userstbl). Login email in Firebase alone is not used unless synced to userstbl.email.'
        );
      }
    } catch (err) {
      console.error('[EOD email] Branch confirmation unexpected error:', err?.message || err);
    }
  } catch (error) {
    // Never block EOD submission if email sending fails.
    console.error('Failed to send EOD email notifications:', error);
  }
};

const createDailySummarySubmissionNotification = async ({
  branchId,
  summaryDate,
  totalAmount,
  paymentCount,
  createdBy,
}) => {
  const [branchResult, userResult] = await Promise.all([
    query(
      `SELECT COALESCE(branch_nickname, branch_name) AS branch_name
       FROM branchestbl
       WHERE branch_id = $1`,
      [branchId]
    ),
    query(
      `SELECT full_name, email
       FROM userstbl
       WHERE user_id = $1`,
      [createdBy]
    ),
  ]);

  const branchName = branchResult.rows[0]?.branch_name || `Branch ${branchId}`;
  const submittedBy = userResult.rows[0]?.full_name || userResult.rows[0]?.email || 'Branch Admin';

  const body = `${submittedBy} submitted End of Shift for ${branchName} on ${summaryDate}. Total: ₱${Number(totalAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${paymentCount || 0} payment${Number(paymentCount || 0) === 1 ? '' : 's'}).`;

  await query(
    `INSERT INTO announcementstbl (title, body, recipient_groups, status, priority, branch_id, created_by)
     VALUES ($1, $2, $3, 'Active', 'High', $4, $5)`,
    ['End of Shift Submitted', body, ['Admin', 'Finance'], branchId, createdBy]
  );
};

/**
 * POST /api/sms/daily-summary-sales
 * Submit daily summary for TODAY only. Admin only.
 * Amount is auto-calculated from paymenttbl (no manual input).
 * Body: { summary_date } optional - must be today (Manila). Defaults to today Manila.
 */
router.post(
  '/',
  requireRole('Admin'),
  [body('summary_date').optional().isISO8601().withMessage('summary_date must be YYYY-MM-DD')],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const userBranchId = req.user.branchId;
      const userId = req.user.userId;

      if (!userBranchId) {
        return res.status(403).json({
          success: false,
          message: 'Only branch Admin can submit daily summary. Superadmin/Superfinance use the approval page.',
        });
      }

      const today = TODAY_MANILA();
      const requestedDate = (req.body?.summary_date || today).slice(0, 10);
      if (requestedDate !== today) {
        return res.status(400).json({
          success: false,
          message: `You can only submit for today (${today}). Received: ${requestedDate}`,
        });
      }

      const already = await query(
        `SELECT daily_summary_id FROM daily_summary_salestbl WHERE branch_id = $1 AND summary_date = $2::date LIMIT 1`,
        [userBranchId, requestedDate]
      );
      if (already.rows.length > 0) {
        return res.status(409).json({
          success: false,
          message:
            'End of day for this date has already been submitted. Only one EOD submission per branch per day is allowed.',
        });
      }

      const snapshot = await getEodPaymentSnapshot({
        branchId: userBranchId,
        summaryDate: requestedDate,
        submittedAfter: null,
      });
      const totalAmount = snapshot.total;
      const paymentCount = snapshot.paymentCount;

      let insertRes;
      try {
        insertRes = await query(
          `INSERT INTO daily_summary_salestbl (branch_id, summary_date, total_amount, payment_count, status, submitted_by, approved_by, approved_at)
           VALUES ($1, $2, $3, $4, 'Approved', $5, $5, CURRENT_TIMESTAMP)
           RETURNING daily_summary_id, branch_id, summary_date, total_amount, payment_count, status, submitted_at`,
          [userBranchId, requestedDate, totalAmount, paymentCount, userId]
        );
      } catch (dbErr) {
        if (dbErr.code === '23505') {
          return res.status(409).json({
            success: false,
            message:
              'End of day for this date has already been submitted. Only one EOD submission per branch per day is allowed.',
          });
        }
        throw dbErr;
      }

      await createDailySummarySubmissionNotification({
        branchId: userBranchId,
        summaryDate: requestedDate,
        totalAmount,
        paymentCount,
        createdBy: userId,
      });

      await sendEodEmailNotifications({
        submittedBranchId: userBranchId,
        summaryDate: requestedDate,
        totalAmount,
        paymentCount,
        submittedByUserId: userId,
      });

      res.status(201).json({
        success: true,
        message: 'Daily summary submitted and auto-verified successfully',
        data: insertRes.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/sms/daily-summary-sales/:id/approve
 * Verify (approve: true) or flag for review (approve: false) a daily summary. Superadmin and Superfinance only.
 */
router.put(
  '/:id/approve',
  requireRole('Superadmin', 'Finance'),
  [
    param('id').isInt().withMessage('id must be an integer'),
    body('approve').optional().isBoolean().withMessage('approve must be boolean'),
    body('remarks').optional().isString().withMessage('remarks must be string'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { approve, remarks } = req.body || {};
      const userType = req.user.userType;
      const userBranchId = req.user.branchId;

      // Only Superadmin and Superfinance (Finance with no branch) can verify
      if (userType === 'Finance' && (userBranchId !== null && userBranchId !== undefined)) {
        return res.status(403).json({
          success: false,
          message: 'Only Superadmin and Superfinance can verify daily summaries',
        });
      }

      const checkRes = await query(
        'SELECT daily_summary_id, status FROM daily_summary_salestbl WHERE daily_summary_id = $1',
        [id]
      );
      if (checkRes.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Daily summary not found',
        });
      }
      const rec = checkRes.rows[0];
      if (rec.status !== 'Submitted') {
        return res.status(400).json({
          success: false,
          message: `Cannot change verification. Current status: ${rec.status}`,
        });
      }

      const isApproved = approve === true || approve === 'true';
      const newStatus = isApproved ? 'Approved' : 'Rejected';

      await query(
        `UPDATE daily_summary_salestbl
         SET status = $1, approved_by = $2, approved_at = CURRENT_TIMESTAMP, remarks = $3, updated_at = CURRENT_TIMESTAMP
         WHERE daily_summary_id = $4`,
        [newStatus, req.user.userId, remarks || null, id]
      );

      const updated = await query(
        `SELECT d.daily_summary_id, d.branch_id, d.summary_date, d.total_amount, d.payment_count, d.status,
                d.approved_by, d.approved_at, d.remarks,
                COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
                app.full_name AS approved_by_name
         FROM daily_summary_salestbl d
         LEFT JOIN branchestbl b ON d.branch_id = b.branch_id
         LEFT JOIN userstbl app ON d.approved_by = app.user_id
         WHERE d.daily_summary_id = $1`,
        [id]
      );

      res.json({
        success: true,
        message: isApproved ? 'Daily summary verified' : 'Daily summary flagged for review',
        data: updated.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/sms/daily-summary-sales/check-today
 * Check if Admin has already submitted for today (their branch).
 */
router.get(
  '/check-today',
  requireRole('Admin'),
  async (req, res, next) => {
    try {
      const userBranchId = req.user.branchId;
      if (!userBranchId) {
        return res.json({ success: true, data: { submitted: false, record: null } });
      }
      const today = TODAY_MANILA();
      const result = await query(
        `SELECT daily_summary_id, branch_id, summary_date, total_amount, payment_count, status, submitted_at
         FROM daily_summary_salestbl
         WHERE branch_id = $1 AND summary_date = $2`,
        [userBranchId, today]
      );
      const record = result.rows[0] || null;
      res.json({
        success: true,
        data: {
          submitted: !!record,
          record,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/sms/daily-summary-sales/:id/payments
 * Get payment records for a daily summary (by summary id). Uses the summary's stored branch_id and summary_date.
 * Access: Superadmin, Superfinance (and Admin for their own branch).
 */
router.get(
  '/:id/payments',
  [param('id').isInt().withMessage('id must be an integer')],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const userType = req.user.userType;
      const userBranchId = req.user.branchId;

      const summaryRes = await query(
        `SELECT daily_summary_id, branch_id, summary_date FROM daily_summary_salestbl WHERE daily_summary_id = $1`,
        [id]
      );
      if (summaryRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Daily summary not found' });
      }
      const summary = summaryRes.rows[0];
      const branchId = summary.branch_id;
      const summaryDate = summary.summary_date;

      if (userType === 'Admin' && userBranchId !== branchId) {
        return res.status(403).json({
          success: false,
          message: 'You can only view payments for your branch',
        });
      }
      if (userType === 'Finance' && userBranchId != null && userBranchId !== branchId) {
        return res.status(403).json({
          success: false,
          message: 'You can only view payments for your branch',
        });
      }

      const paymentsRes = await query(
        `SELECT p.payment_id,
                p.invoice_id,
                p.student_id,
                p.payment_method,
                p.payable_amount,
                p.reference_number,
                TO_CHAR(p.issue_date, 'YYYY-MM-DD') AS issue_date,
                u.full_name AS student_name,
                i.invoice_description
         FROM paymenttbl p
         LEFT JOIN userstbl u ON p.student_id = u.user_id
         LEFT JOIN invoicestbl i ON p.invoice_id = i.invoice_id
         WHERE p.branch_id = $1 AND p.issue_date = $2
         ORDER BY p.payment_id DESC`,
        [branchId, summaryDate]
      );

      res.json({
        success: true,
        data: paymentsRes.rows || [],
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
