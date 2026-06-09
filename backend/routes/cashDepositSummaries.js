import express from 'express';
import { body, param, query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole, requireBranchAccess } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query, getClient } from '../config/database.js';
import { getEffectiveSettings } from '../utils/settingsService.js';
import {
  DEFAULT_SCHOOL_NAME,
  renderMessagingTemplate,
} from '../utils/templateRenderService.js';
import { syncArVerifiedFromPaymentApproval } from '../lib/arPaymentVerificationSync.js';

const router = express.Router();

/** Rows that reserve cash payments (submitted, awaiting verify, or verified). */
const CASH_DEPOSIT_RESERVED_STATUSES = ['Pending', 'Submitted', 'Approved'];
/** Awaiting Superfinance verify (Submitted kept for legacy rows). */
const CASH_DEPOSIT_PENDING_VERIFY_STATUSES = ['Pending', 'Submitted'];

router.use(verifyFirebaseToken);
router.use(requireBranchAccess);

const findOverlappingCashDepositSummary = async ({ branchId, startDate, endDate }) => {
  const result = await query(
    `SELECT cash_deposit_summary_id,
            TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
            TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date,
            status
     FROM cash_deposit_summarytbl
     WHERE branch_id = $1
       AND start_date < $2::date
       AND end_date > $3::date
     ORDER BY start_date ASC
     LIMIT 1`,
    [branchId, endDate, startDate]
  );

  return result.rows[0] || null;
};

/**
 * Returns the cash payments for [startDate, endDate] in a branch that are NOT
 * already covered by any Submitted/Approved cash deposit summary **whose
 * declared period (start_date–end_date) contains the payment's issue_date**
 * and whose snapshot JSON lists that payment_id. This avoids orphan snapshot
 * lines (e.g. payment date corrected after submit) blocking a new deposit.
 *
 * @param {object} args
 * @param {number} args.branchId
 * @param {string} args.startDate            - YYYY-MM-DD inclusive
 * @param {string} args.endDate              - YYYY-MM-DD inclusive
 * @param {number} [args.excludeSummaryId]   - When set, the matching cash deposit
 *   summary row is ignored in the NOT EXISTS subquery so we DON'T mistakenly
 *   self-exclude its own payments. Used by `GET /:id/payments` (detail view) so
 *   the recalc reflects "what's currently in this summary's window minus OTHER
 *   deposits", instead of returning zero because every payment is in this very
 *   summary's snapshot. Create/resubmit flows leave this unset because they
 *   need to exclude every prior deposit, including their own.
 */
const getCashDepositSnapshot = async ({ branchId, startDate, endDate, excludeSummaryId } = {}) => {
  const params = [branchId, startDate, endDate];
  let excludeClause = '';
  if (excludeSummaryId !== undefined && excludeSummaryId !== null && Number.isFinite(Number(excludeSummaryId))) {
    params.push(Number(excludeSummaryId));
    excludeClause = ` AND c.cash_deposit_summary_id <> $${params.length}`;
  }

  const result = await query(
    `SELECT p.payment_id,
            p.invoice_id,
            p.student_id,
            p.branch_id,
            p.payment_method,
            p.payment_type,
            p.payable_amount,
            COALESCE(p.tip_amount, 0) AS tip_amount,
            TO_CHAR(p.issue_date, 'YYYY-MM-DD') AS issue_date,
            p.status,
            p.reference_number,
            p.remarks,
            p.payment_attachment_url,
            p.created_by,
            TO_CHAR(p.created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at,
            p.approval_status,
            p.approved_by,
            TO_CHAR(p.approved_at, 'YYYY-MM-DD HH24:MI:SS') AS approved_at,
            u.full_name AS student_name,
            u.email AS student_email,
            i.invoice_description,
            i.amount AS invoice_amount,
            COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
            approver.full_name AS approved_by_name,
            ar.prospect_student_name AS ar_prospect_student_name
     FROM paymenttbl p
     LEFT JOIN userstbl u ON p.student_id = u.user_id
     LEFT JOIN invoicestbl i ON p.invoice_id = i.invoice_id
     LEFT JOIN branchestbl b ON p.branch_id = b.branch_id
     LEFT JOIN userstbl approver ON p.approved_by = approver.user_id
     LEFT JOIN acknowledgement_receiptstbl ar ON ar.payment_id = p.payment_id
     WHERE p.branch_id = $1
       AND p.issue_date >= $2::date
       AND p.issue_date <= $3::date
       AND LOWER(TRIM(p.payment_method)) = 'cash'
       AND COALESCE(p.approval_status, 'Pending') <> 'Rejected'
       AND NOT EXISTS (
         SELECT 1
         FROM cash_deposit_summarytbl c
         CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.cash_payment_snapshot, '[]'::jsonb)) deposited(payment_row)
         WHERE c.branch_id = p.branch_id
           AND c.status IN ('Pending', 'Submitted', 'Approved')${excludeClause}
           AND p.issue_date >= c.start_date::date
           AND p.issue_date <= c.end_date::date
           AND deposited.payment_row ? 'payment_id'
           AND (deposited.payment_row->>'payment_id') ~ '^[0-9]+$'
           AND (deposited.payment_row->>'payment_id')::int = p.payment_id
       )
     ORDER BY p.issue_date ASC, p.payment_id ASC`,
    params
  );

  let totalDepositAmount = 0;
  let totalCashAmount = 0;
  let completedCashCount = 0;

  const payments = (result.rows || []).map((row) => {
    let studentName = row.student_name;
    let studentEmail = row.student_email;
    const isWalkIn = (studentEmail || '').toLowerCase() === 'walkin@merchandise.psms.internal';
    const prospectName = row.ar_prospect_student_name || null;

    if (isWalkIn && prospectName) {
      studentName = prospectName;
      studentEmail = null;
    }

    const payable = parseFloat(row.payable_amount) || 0;
    const tip = parseFloat(row.tip_amount) || 0;
    const lineAmount = payable + tip;
    totalCashAmount += lineAmount;

    if (row.status === 'Completed') {
      totalDepositAmount += lineAmount;
      completedCashCount += 1;
    }

    return {
      ...row,
      student_name: studentName,
      student_email: studentEmail,
    };
  });

  return {
    start_date: startDate,
    end_date: endDate,
    total_deposit_amount: Math.round(totalDepositAmount * 100) / 100,
    total_cash_amount: Math.round(totalCashAmount * 100) / 100,
    payment_count: payments.length,
    completed_cash_count: completedCashCount,
    payments,
  };
};

/** Payment IDs stored in cash_payment_snapshot at submit/resubmit time. */
function extractPaymentIdsFromCashSnapshot(snapshot) {
  const rows = Array.isArray(snapshot) ? snapshot : [];
  const ids = [];
  const seen = new Set();
  for (const row of rows) {
    const pid = Number(row?.payment_id);
    if (!Number.isFinite(pid) || pid <= 0 || seen.has(pid)) continue;
    seen.add(pid);
    ids.push(pid);
  }
  return ids;
}

/**
 * When Superfinance verifies a cash deposit summary, mark included cash payments Approved on Payment Logs.
 */
async function syncPaymentLogApprovalOnCashDepositVerify(
  client,
  { paymentIds, verifierUserId, depositReferenceNumber }
) {
  if (!paymentIds?.length || !verifierUserId) return 0;
  const depositRef = String(depositReferenceNumber || '').trim() || null;
  const result = await client.query(
    `UPDATE paymenttbl p
     SET approval_status = 'Approved',
         approved_by = $1,
         approved_at = COALESCE(p.approved_at, CURRENT_TIMESTAMP),
         finance_verified_reference_number = COALESCE(NULLIF(TRIM(p.reference_number), ''), $2)
     WHERE p.payment_id = ANY($3::int[])
       AND p.status = 'Completed'
       AND COALESCE(p.approval_status, 'Pending') NOT IN ('Returned', 'Rejected')
     RETURNING p.payment_id`,
    [verifierUserId, depositRef, paymentIds]
  );
  return result.rowCount;
}

const createCashDepositSubmissionNotification = async ({
  cashDepositSummaryId,
  branchId,
  startDate,
  endDate,
  totalDepositAmount,
  totalCashAmount,
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
  const formattedDeposit = Number(totalDepositAmount || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const formattedCash = Number(totalCashAmount || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const fallbackTitle = 'Cash Deposit Summary Pending Verification';
  const fallbackBody = `${submittedBy} submitted Cash Deposit Summary for ${branchName} (${startDate} to ${endDate}). Deposit amount: ₱${formattedDeposit}; Total cash: ₱${formattedCash}; Payments: ${paymentCount || 0}.`;

  let title = fallbackTitle;
  let body = fallbackBody;

  try {
    const rendered = await renderMessagingTemplate({
      templateKey: 'template_cash_deposit',
      branchId,
      variables: {
        branchName,
        depositDate: `${startDate} to ${endDate}`,
        cashTotal: `₱${formattedCash}`,
        submittedBy,
        schoolName: DEFAULT_SCHOOL_NAME,
      },
    });

    if (rendered?.enabled === false) {
      return;
    }

    if (rendered?.enabled) {
      title = rendered.title?.trim() || fallbackTitle;
      body = rendered.body?.trim() || fallbackBody;
    }
  } catch (templateErr) {
    console.warn('[cashDeposit] template load failed:', templateErr?.message || templateErr);
  }

  await query(
    `INSERT INTO announcementstbl (title, body, recipient_groups, status, priority, branch_id, created_by, navigation_key, navigation_query)
     VALUES ($1, $2, $3, 'Active', 'High', $4, $5, $6, $7)`,
    [
      title,
      body,
      ['All'],
      branchId,
      createdBy,
      'daily-summary-sales',
      `notificationTab=cashDeposit&cashDepositSummaryId=${cashDepositSummaryId}`,
    ]
  );

  const notifyUserTypes = ['superfinance', 'superadmin'];
  const notifyUsersRes = await query(
    `SELECT user_id, LOWER(TRIM(user_type)) AS user_type
     FROM userstbl
     WHERE LOWER(TRIM(user_type)) = ANY($1::text[])`,
    [notifyUserTypes]
  );
  const notifyUserIds = (notifyUsersRes.rows || [])
    .map((row) => row.user_id)
    .filter((id) => id != null && Number(id) !== Number(createdBy));

  if (notifyUserIds.length > 0) {
    await Promise.all(
      notifyUserIds.map((targetUserId) =>
        query(
          `INSERT INTO announcementstbl (title, body, recipient_groups, status, priority, branch_id, created_by, target_user_id, navigation_key, navigation_query)
           VALUES ($1, $2, $3, 'Active', 'High', $4, $5, $6, $7, $8)`,
          [
            title,
            body,
            ['All'],
            branchId,
            createdBy,
            targetUserId,
            'daily-summary-sales',
            `notificationTab=cashDeposit&cashDepositSummaryId=${cashDepositSummaryId}`,
          ]
        )
      )
    );
  }
};

/**
 * GET /cash-deposit-summaries/cash-holding-status
 *
 * Branch-Admin-only login-time endpoint that reports how much physical Cash
 * the branch is currently holding (i.e. cash payments not yet covered by a
 * Submitted/Approved cash_deposit_summarytbl row), and whether it has crossed
 * the Superadmin-configured alert threshold.
 *
 * Distinct from the rest of the cash-deposit endpoints because:
 *   - It filters strictly to `payment_method = 'Cash'` (literal cash on hand),
 *     unlike the broader deposit snapshot which spans every payment method.
 *   - It returns a single scalar across the branch's full unreconciled history
 *     (no date filters), so the frontend never has to guess a date window.
 *
 * Response shape:
 *   {
 *     success: true,
 *     data: {
 *       pending_cash_amount: number,   // PHP, 2dp
 *       pending_cash_count:  number,
 *       threshold_php:       number,   // 0 means feature disabled
 *       is_over_threshold:   boolean,
 *       branch_id:           number,
 *       branch_name:         string|null,
 *       as_of:               string,   // ISO timestamp
 *     }
 *   }
 */
router.get(
  '/cash-holding-status',
  requireRole('Admin'),
  async (req, res, next) => {
    let client;
    try {
      const userBranchId = req.user.branchId;
      if (!userBranchId) {
        return res.status(403).json({
          success: false,
          message: 'Only branch Admin users have a cash-holding status.',
        });
      }

      client = await getClient();

      const settingsRes = await getEffectiveSettings(
        client,
        ['cash_holding_alert_threshold_php'],
        userBranchId
      );
      const thresholdRaw = Number(
        settingsRes?.cash_holding_alert_threshold_php?.value
      );
      const threshold = Number.isFinite(thresholdRaw) && thresholdRaw >= 0 ? thresholdRaw : 0;

      // Keep this aligned with the branch-admin Deposit Cash modal rules so the
      // login-time "Cash on hand" figure matches "Total to deposit":
      //   - physical cash payments only
      //   - payment not already covered by Submitted/Approved deposit snapshots
      //   - only Completed payments (deposit-eligible)
      //   - exclude payment rows explicitly rejected in approval workflow
      //   - include tip in the amount shown to users (Total Amount semantics)
      const pendingRes = await client.query(
        `SELECT COALESCE(SUM(COALESCE(p.payable_amount, 0) + COALESCE(p.tip_amount, 0)), 0)::numeric AS pending_amount,
                COUNT(*)::int                                AS pending_count
         FROM paymenttbl p
         WHERE p.branch_id = $1
           AND LOWER(TRIM(p.payment_method)) = 'cash'
           AND p.status = 'Completed'
           AND COALESCE(p.approval_status, 'Pending') <> 'Rejected'
           AND NOT EXISTS (
             SELECT 1
             FROM cash_deposit_summarytbl c
             CROSS JOIN LATERAL jsonb_array_elements(
               COALESCE(c.cash_payment_snapshot, '[]'::jsonb)
             ) deposited(payment_row)
             WHERE c.branch_id = p.branch_id
               AND c.status IN ('Pending', 'Submitted', 'Approved')
               AND p.issue_date >= c.start_date::date
               AND p.issue_date <= c.end_date::date
               AND deposited.payment_row ? 'payment_id'
               AND (deposited.payment_row->>'payment_id') ~ '^[0-9]+$'
               AND (deposited.payment_row->>'payment_id')::int = p.payment_id
           )`,
        [userBranchId]
      );

      const branchRes = await client.query(
        `SELECT COALESCE(branch_nickname, branch_name) AS branch_name
         FROM branchestbl
         WHERE branch_id = $1`,
        [userBranchId]
      );

      const pendingAmount = Math.round(
        (parseFloat(pendingRes.rows[0]?.pending_amount) || 0) * 100
      ) / 100;
      const pendingCount = pendingRes.rows[0]?.pending_count || 0;
      const isOverThreshold = threshold > 0 && pendingAmount >= threshold;

      res.json({
        success: true,
        data: {
          pending_cash_amount: pendingAmount,
          pending_cash_count: pendingCount,
          threshold_php: threshold,
          is_over_threshold: isOverThreshold,
          branch_id: userBranchId,
          branch_name: branchRes.rows[0]?.branch_name || null,
          as_of: new Date().toISOString(),
        },
      });
    } catch (error) {
      next(error);
    } finally {
      if (client) {
        try {
          client.release();
        } catch {
          /* noop */
        }
      }
    }
  }
);

router.get(
  '/deposit-defaults',
  requireRole('Admin'),
  async (req, res, next) => {
    try {
      const userBranchId = req.user.branchId;
      if (!userBranchId) {
        return res.status(403).json({
          success: false,
          message: 'Only branch Admin can prepare cash deposit summaries.',
        });
      }

      // Cash Deposit covers literal physical Cash only (payment_method =
      // 'Cash'). The fallback "earliest payment date" therefore filters to
      // Cash so the From-date in the modal isn't pulled back to an old
      // online-banking payment that has nothing to do with cash on hand.
      const [latestDepositRes, earliestPaymentRes] = await Promise.all([
        query(
          `SELECT TO_CHAR(MAX(end_date), 'YYYY-MM-DD') AS latest_deposit_end_date,
                  TO_CHAR(MAX(end_date) + INTERVAL '1 day', 'YYYY-MM-DD') AS next_uncovered_start_date
           FROM cash_deposit_summarytbl
           WHERE branch_id = $1
             AND status IN ('Pending', 'Submitted', 'Approved')`,
          [userBranchId]
        ),
        query(
          `SELECT TO_CHAR(MIN(issue_date), 'YYYY-MM-DD') AS earliest_payment_date
           FROM paymenttbl
           WHERE branch_id = $1
             AND LOWER(TRIM(payment_method)) = 'cash'`,
          [userBranchId]
        ),
      ]);

      const latestDepositEndDate = latestDepositRes.rows[0]?.latest_deposit_end_date || null;
      const nextUncoveredStartDate = latestDepositRes.rows[0]?.next_uncovered_start_date || null;
      const earliestPaymentDate = earliestPaymentRes.rows[0]?.earliest_payment_date || null;

      res.json({
        success: true,
        data: {
          // Default the next deposit window to the day AFTER the previous
          // deposit's end_date so the same payment date is never reconciled
          // twice. Falls back to the earliest Cash payment on record, or
          // null if no Cash payments exist yet.
          default_start_date: nextUncoveredStartDate || earliestPaymentDate || null,
          latest_deposit_end_date: latestDepositEndDate,
          earliest_cash_payment_date: earliestPaymentDate,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/',
  [
    queryValidator('branch_id').optional().isInt().withMessage('branch_id must be an integer'),
    queryValidator('date').optional().isISO8601().withMessage('date must be YYYY-MM-DD'),
    // Range filter (preferred over single-day `date`). Either bound is
    // optional; if both omitted, no date filter is applied. If `date` is
    // also sent, the range params take precedence so old callers still work.
    // Range semantics: include any deposit whose [start_date, end_date]
    // period intersects the [date_from, date_to] window.
    queryValidator('date_from')
      .optional()
      .isISO8601()
      .withMessage('date_from must be YYYY-MM-DD'),
    queryValidator('date_to')
      .optional()
      .isISO8601()
      .withMessage('date_to must be YYYY-MM-DD'),
    queryValidator('created_date_from')
      .optional()
      .isISO8601()
      .withMessage('created_date_from must be YYYY-MM-DD'),
    queryValidator('created_date_to')
      .optional()
      .isISO8601()
      .withMessage('created_date_to must be YYYY-MM-DD'),
    queryValidator('status')
      .optional()
      .isIn(['Pending', 'Submitted', 'Approved', 'Rejected', 'Returned'])
      .withMessage('status must be Pending, Approved, Rejected, or Returned'),
    queryValidator('page').optional().isInt({ min: 1 }).withMessage('page must be positive'),
    // Cap raised from 100 -> 500 because the branch admin's "Deposit Cash"
    // modal requests `limit=200` to load the FULL list of prior deposit
    // ranges (used purely for client-side overlap detection / next-day
    // default computation). 500 keeps a safe upper bound while not breaking
    // older payloads.
    queryValidator('limit').optional().isInt({ min: 1, max: 500 }).withMessage('limit 1-500'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const {
        branch_id,
        date,
        date_from,
        date_to,
        status,
        page = 1,
        limit = 50,
      } = req.query;
      const userType = req.user.userType;
      const userBranchId = req.user.branchId;
      const limitNum = parseInt(limit, 10) || 50;
      const pageNum = parseInt(page, 10) || 1;
      const offset = (pageNum - 1) * limitNum;

      // Range params take precedence; fall back to legacy single-day filter.
      const dateFrom = date_from || null;
      const dateTo = date_to || null;
      const useRange = Boolean(dateFrom || dateTo);
      const legacyDate = !useRange && date ? date : null;

      const createdDateFrom = req.query.created_date_from
        ? String(req.query.created_date_from).trim().slice(0, 10)
        : '';
      const createdDateTo = req.query.created_date_to
        ? String(req.query.created_date_to).trim().slice(0, 10)
        : '';
      const useCreatedRange = Boolean(createdDateFrom || createdDateTo);
      if (useCreatedRange && createdDateFrom && createdDateTo && createdDateFrom > createdDateTo) {
        return res.status(400).json({
          success: false,
          message: 'created_date_from must be on or before created_date_to',
        });
      }

      let sql = `
        SELECT c.cash_deposit_summary_id, c.branch_id,
               TO_CHAR(c.start_date, 'YYYY-MM-DD') AS start_date,
               TO_CHAR(c.end_date, 'YYYY-MM-DD') AS end_date,
               c.total_deposit_amount, c.total_cash_amount, c.payment_count, c.completed_cash_count,
               c.status, c.submitted_by, c.submitted_at, c.approved_by, c.approved_at, c.remarks,
               c.reference_number, c.deposit_attachment_url,
               COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
               sub.full_name AS submitted_by_name,
               app.full_name AS approved_by_name
        FROM cash_deposit_summarytbl c
        LEFT JOIN branchestbl b ON c.branch_id = b.branch_id
        LEFT JOIN userstbl sub ON c.submitted_by = sub.user_id
        LEFT JOIN userstbl app ON c.approved_by = app.user_id
        WHERE 1=1`;
      const params = [];
      let pc = 0;

      if (userType === 'Admin' && userBranchId) {
        pc++;
        sql += ` AND c.branch_id = $${pc}`;
        params.push(userBranchId);
      } else if (branch_id) {
        pc++;
        sql += ` AND c.branch_id = $${pc}`;
        params.push(branch_id);
      }

      if (useCreatedRange) {
        if (createdDateFrom) {
          pc++;
          sql += ` AND c.submitted_at::date >= $${pc}::date`;
          params.push(createdDateFrom);
        }
        if (createdDateTo) {
          pc++;
          sql += ` AND c.submitted_at::date <= $${pc}::date`;
          params.push(createdDateTo);
        }
      } else if (useRange) {
        // Period overlap: include rows whose [start_date, end_date] window
        // intersects the requested [dateFrom, dateTo] range.
        if (dateTo) {
          pc++;
          sql += ` AND c.start_date <= $${pc}::date`;
          params.push(dateTo);
        }
        if (dateFrom) {
          pc++;
          sql += ` AND c.end_date >= $${pc}::date`;
          params.push(dateFrom);
        }
      } else if (legacyDate) {
        pc++;
        sql += ` AND c.start_date <= $${pc}::date AND c.end_date >= $${pc}::date`;
        params.push(legacyDate);
      }

      if (status) {
        if (status === 'Returned') {
          sql += ` AND c.status IN ('Returned', 'Rejected')`;
        } else if (status === 'Pending') {
          sql += ` AND c.status IN ('Pending', 'Submitted')`;
        } else {
          pc++;
          sql += ` AND c.status = $${pc}`;
          params.push(status);
        }
      }

      sql += ` ORDER BY c.start_date DESC, c.end_date DESC, c.branch_id ASC LIMIT $${pc + 1} OFFSET $${pc + 2}`;
      params.push(limitNum, offset);

      const result = await query(sql, params);

      let countSql = `SELECT COUNT(*) AS total FROM cash_deposit_summarytbl c WHERE 1=1`;
      const countParams = [];
      let cc = 0;

      if (userType === 'Admin' && userBranchId) {
        cc++;
        countSql += ` AND c.branch_id = $${cc}`;
        countParams.push(userBranchId);
      } else if (branch_id) {
        cc++;
        countSql += ` AND c.branch_id = $${cc}`;
        countParams.push(branch_id);
      }

      if (useCreatedRange) {
        if (createdDateFrom) {
          cc++;
          countSql += ` AND c.submitted_at::date >= $${cc}::date`;
          countParams.push(createdDateFrom);
        }
        if (createdDateTo) {
          cc++;
          countSql += ` AND c.submitted_at::date <= $${cc}::date`;
          countParams.push(createdDateTo);
        }
      } else if (useRange) {
        if (dateTo) {
          cc++;
          countSql += ` AND c.start_date <= $${cc}::date`;
          countParams.push(dateTo);
        }
        if (dateFrom) {
          cc++;
          countSql += ` AND c.end_date >= $${cc}::date`;
          countParams.push(dateFrom);
        }
      } else if (legacyDate) {
        cc++;
        countSql += ` AND c.start_date <= $${cc}::date AND c.end_date >= $${cc}::date`;
        countParams.push(legacyDate);
      }

      if (status) {
        if (status === 'Returned') {
          countSql += ` AND c.status IN ('Returned', 'Rejected')`;
        } else if (status === 'Pending') {
          countSql += ` AND c.status IN ('Pending', 'Submitted')`;
        } else {
          cc++;
          countSql += ` AND c.status = $${cc}`;
          countParams.push(status);
        }
      }

      const countRes = await query(countSql, countParams);
      const total = parseInt(countRes.rows[0]?.total || 0, 10);

      // Summary card (all-status) — all cash deposit submissions in the same branch/date scope.
      let submittedSql = `SELECT COUNT(*)::int AS submitted_count, COALESCE(SUM(c.total_deposit_amount), 0)::numeric AS submitted_total_amount
        FROM cash_deposit_summarytbl c
        WHERE 1=1`;
      const submittedParams = [];
      let sc = 0;
      if (userType === 'Admin' && userBranchId) {
        sc++;
        submittedSql += ` AND c.branch_id = $${sc}`;
        submittedParams.push(userBranchId);
      } else if (branch_id) {
        sc++;
        submittedSql += ` AND c.branch_id = $${sc}`;
        submittedParams.push(branch_id);
      }
      if (useCreatedRange) {
        if (createdDateFrom) {
          sc++;
          submittedSql += ` AND c.submitted_at::date >= $${sc}::date`;
          submittedParams.push(createdDateFrom);
        }
        if (createdDateTo) {
          sc++;
          submittedSql += ` AND c.submitted_at::date <= $${sc}::date`;
          submittedParams.push(createdDateTo);
        }
      } else if (useRange) {
        if (dateTo) {
          sc++;
          submittedSql += ` AND c.start_date <= $${sc}::date`;
          submittedParams.push(dateTo);
        }
        if (dateFrom) {
          sc++;
          submittedSql += ` AND c.end_date >= $${sc}::date`;
          submittedParams.push(dateFrom);
        }
      } else if (legacyDate) {
        sc++;
        submittedSql += ` AND c.start_date <= $${sc}::date AND c.end_date >= $${sc}::date`;
        submittedParams.push(legacyDate);
      }
      const submittedRes = await query(submittedSql, submittedParams);
      const submittedSummary = submittedRes.rows[0] || { submitted_count: 0, submitted_total_amount: 0 };

      // Summary card (filtered) — matches the list’s status filter (including Returned => Returned+Rejected).
      let filteredSql = `SELECT COUNT(*)::int AS filtered_count, COALESCE(SUM(c.total_deposit_amount), 0)::numeric AS filtered_total_amount
        FROM cash_deposit_summarytbl c
        WHERE 1=1`;
      const filteredParams = [];
      let fc = 0;
      if (userType === 'Admin' && userBranchId) {
        fc++;
        filteredSql += ` AND c.branch_id = $${fc}`;
        filteredParams.push(userBranchId);
      } else if (branch_id) {
        fc++;
        filteredSql += ` AND c.branch_id = $${fc}`;
        filteredParams.push(branch_id);
      }
      if (useCreatedRange) {
        if (createdDateFrom) {
          fc++;
          filteredSql += ` AND c.submitted_at::date >= $${fc}::date`;
          filteredParams.push(createdDateFrom);
        }
        if (createdDateTo) {
          fc++;
          filteredSql += ` AND c.submitted_at::date <= $${fc}::date`;
          filteredParams.push(createdDateTo);
        }
      } else if (useRange) {
        if (dateTo) {
          fc++;
          filteredSql += ` AND c.start_date <= $${fc}::date`;
          filteredParams.push(dateTo);
        }
        if (dateFrom) {
          fc++;
          filteredSql += ` AND c.end_date >= $${fc}::date`;
          filteredParams.push(dateFrom);
        }
      } else if (legacyDate) {
        fc++;
        filteredSql += ` AND c.start_date <= $${fc}::date AND c.end_date >= $${fc}::date`;
        filteredParams.push(legacyDate);
      }
      if (status) {
        if (status === 'Returned') {
          filteredSql += ` AND c.status IN ('Returned', 'Rejected')`;
        } else if (status === 'Pending') {
          filteredSql += ` AND c.status IN ('Pending', 'Submitted')`;
        } else {
          fc++;
          filteredSql += ` AND c.status = $${fc}`;
          filteredParams.push(status);
        }
      }
      const filteredRes = await query(filteredSql, filteredParams);
      const filteredSummary = filteredRes.rows[0] || { filtered_count: 0, filtered_total_amount: 0 };

      res.json({
        success: true,
        data: result.rows,
        submitted_summary: {
          count: Number(submittedSummary.submitted_count || 0),
          total_amount: Number(submittedSummary.submitted_total_amount || 0),
        },
        filtered_summary: {
          count: Number(filteredSummary.filtered_count || 0),
          total_amount: Number(filteredSummary.filtered_total_amount || 0),
        },
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

router.post(
  '/',
  requireRole('Admin'),
  [
    body('start_date').isISO8601().withMessage('start_date must be YYYY-MM-DD'),
    body('end_date').isISO8601().withMessage('end_date must be YYYY-MM-DD'),
    body('reference_number')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('reference_number is required'),
    body('deposit_attachment_url')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('deposit_attachment_url is required'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const userBranchId = req.user.branchId;
      const userId = req.user.userId;
      const startDate = String(req.body?.start_date || '').slice(0, 10);
      const endDate = String(req.body?.end_date || '').slice(0, 10);
      const referenceNumber = String(req.body?.reference_number || '').trim();
      const depositAttachmentUrl = String(req.body?.deposit_attachment_url || '').trim();

      if (!userBranchId) {
        return res.status(403).json({
          success: false,
          message: 'Only branch Admin can submit cash deposit summaries.',
        });
      }

      if (startDate > endDate) {
        return res.status(400).json({
          success: false,
          message: 'start_date must be on or before end_date',
        });
      }

      const snapshot = await getCashDepositSnapshot({
        branchId: userBranchId,
        startDate,
        endDate,
      });

      if (!snapshot.completed_cash_count || snapshot.completed_cash_count < 1) {
        const overlappingSummary = await findOverlappingCashDepositSummary({
          branchId: userBranchId,
          startDate,
          endDate,
        });
        const overlapHint = overlappingSummary
          ? ` An existing deposit summary covers part of this period (${overlappingSummary.start_date} to ${overlappingSummary.end_date}); cash rows in that window may already be deposited.`
          : '';
        return res.status(409).json({
          success: false,
          message: `No completed cash payments are available to deposit for ${startDate} to ${endDate}.${overlapHint} Adjust the date range or confirm payments are Completed and not already in a prior deposit.`,
        });
      }

      const insertRes = await query(
        `INSERT INTO cash_deposit_summarytbl (
           branch_id, start_date, end_date, total_deposit_amount, total_cash_amount,
           payment_count, completed_cash_count, status, submitted_by, reference_number, deposit_attachment_url, cash_payment_snapshot
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending', $8, $9, $10, $11::jsonb)
         RETURNING cash_deposit_summary_id, branch_id,
                   TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
                   TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date,
                   total_deposit_amount, total_cash_amount, payment_count, completed_cash_count,
                   status, submitted_at, reference_number, deposit_attachment_url`,
        [
          userBranchId,
          startDate,
          endDate,
          snapshot.total_deposit_amount,
          snapshot.total_cash_amount,
          snapshot.payment_count,
          snapshot.completed_cash_count,
          userId,
          referenceNumber,
          depositAttachmentUrl,
          JSON.stringify(snapshot.payments || []),
        ]
      );

      await createCashDepositSubmissionNotification({
        cashDepositSummaryId: insertRes.rows[0]?.cash_deposit_summary_id,
        branchId: userBranchId,
        startDate,
        endDate,
        totalDepositAmount: snapshot.total_deposit_amount,
        totalCashAmount: snapshot.total_cash_amount,
        paymentCount: snapshot.payment_count,
        createdBy: userId,
      });

      res.status(201).json({
        success: true,
        message: 'Cash deposit summary submitted and is pending Superfinance verification',
        data: insertRes.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

const isSuperfinanceOperator = (userType, branchId) =>
  userType === 'Superfinance' ||
  (userType === 'Finance' && (branchId === null || branchId === undefined));

router.put(
  '/:id/approve',
  requireRole('Finance', 'Superfinance'),
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

      if (!isSuperfinanceOperator(userType, userBranchId)) {
        return res.status(403).json({
          success: false,
          message: 'Only Superfinance can verify cash deposit summaries',
        });
      }

      const checkRes = await query(
        `SELECT cash_deposit_summary_id, status, cash_payment_snapshot, reference_number
         FROM cash_deposit_summarytbl
         WHERE cash_deposit_summary_id = $1`,
        [id]
      );

      if (checkRes.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Cash deposit summary not found',
        });
      }

      const record = checkRes.rows[0];
      const allowedVerifyStatuses = [...CASH_DEPOSIT_PENDING_VERIFY_STATUSES, 'Returned', 'Rejected'];
      if (!allowedVerifyStatuses.includes(record.status)) {
        return res.status(400).json({
          success: false,
          message: `Cannot change verification. Current status: ${record.status}`,
        });
      }

      const isApproved = approve === true || approve === 'true';
      const verifierUserId = req.user.userId || req.user.user_id || null;
      let paymentsApprovedCount = 0;
      let arsVerifiedCount = 0;

      const client = await getClient();
      try {
        await client.query('BEGIN');

        if (isApproved) {
          await client.query(
            `UPDATE cash_deposit_summarytbl
             SET status = 'Approved',
                 approved_by = $1,
                 approved_at = CURRENT_TIMESTAMP,
                 remarks = $2,
                 updated_at = CURRENT_TIMESTAMP
             WHERE cash_deposit_summary_id = $3`,
            [verifierUserId, remarks || null, id]
          );

          const paymentIds = extractPaymentIdsFromCashSnapshot(record.cash_payment_snapshot);
          paymentsApprovedCount = await syncPaymentLogApprovalOnCashDepositVerify(client, {
            paymentIds,
            verifierUserId,
            depositReferenceNumber: record.reference_number,
          });
          const arSync = await syncArVerifiedFromPaymentApproval(client, {
            paymentIds,
            verifierUserId,
          });
          arsVerifiedCount = arSync.verifiedCount;
        } else {
          await client.query(
            `UPDATE cash_deposit_summarytbl
             SET status = 'Returned',
                 approved_by = NULL,
                 approved_at = NULL,
                 remarks = $1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE cash_deposit_summary_id = $2`,
            [remarks || null, id]
          );
        }

        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      const updated = await query(
        `SELECT c.cash_deposit_summary_id, c.branch_id,
                TO_CHAR(c.start_date, 'YYYY-MM-DD') AS start_date,
                TO_CHAR(c.end_date, 'YYYY-MM-DD') AS end_date,
                c.total_deposit_amount, c.total_cash_amount, c.payment_count, c.completed_cash_count,
                c.status, c.approved_by, c.approved_at, c.remarks,
                c.reference_number, c.deposit_attachment_url,
                COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
                app.full_name AS approved_by_name
         FROM cash_deposit_summarytbl c
         LEFT JOIN branchestbl b ON c.branch_id = b.branch_id
         LEFT JOIN userstbl app ON c.approved_by = app.user_id
         WHERE c.cash_deposit_summary_id = $1`,
        [id]
      );

      res.json({
        success: true,
        message: isApproved
          ? paymentsApprovedCount > 0 || arsVerifiedCount > 0
            ? `Cash deposit summary verified.${paymentsApprovedCount > 0 ? ` ${paymentsApprovedCount} payment log row(s) approved.` : ''}${arsVerifiedCount > 0 ? ` ${arsVerifiedCount} acknowledgement receipt(s) verified.` : ''}`
            : 'Cash deposit summary verified'
          : 'Cash deposit summary returned for correction',
        data: updated.rows[0],
        payments_approved_count: isApproved ? paymentsApprovedCount : 0,
        ars_verified_count: isApproved ? arsVerifiedCount : 0,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/sms/cash-deposit-summaries/:id/resubmit
 * Branch Admin resubmits a rejected cash deposit summary (refreshes totals; optional reference/attachment updates).
 */
router.put(
  '/:id/resubmit',
  requireRole('Admin'),
  [
    param('id').isInt().withMessage('id must be an integer'),
    body('reference_number').optional({ nullable: true }).isString().withMessage('reference_number must be a string'),
    body('deposit_attachment_url')
      .optional({ nullable: true })
      .isString()
      .withMessage('deposit_attachment_url must be a string'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const userBranchId = req.user.branchId;
      const userId = req.user.userId;

      if (!userBranchId) {
        return res.status(403).json({
          success: false,
          message: 'Only branch Admin can resubmit cash deposit summaries.',
        });
      }

      const rowRes = await query(
        `SELECT cash_deposit_summary_id, branch_id,
                TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
                TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date,
                status, submitted_by, reference_number, deposit_attachment_url
         FROM cash_deposit_summarytbl
         WHERE cash_deposit_summary_id = $1`,
        [id]
      );
      if (rowRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Cash deposit summary not found' });
      }

      const rec = rowRes.rows[0];
      if (Number(rec.branch_id) !== Number(userBranchId)) {
        return res.status(403).json({
          success: false,
          message: 'You can only resubmit cash deposit summaries for your branch',
        });
      }
      if (rec.status !== 'Rejected' && rec.status !== 'Returned') {
        return res.status(400).json({
          success: false,
          message: `Only returned summaries can be resubmitted. Current status: ${rec.status}`,
        });
      }
      if (Number(rec.submitted_by) !== Number(userId)) {
        return res.status(403).json({
          success: false,
          message: 'Only the Admin who submitted this summary can resubmit it',
        });
      }

      const raw = req.body || {};
      const nextRef = Object.prototype.hasOwnProperty.call(raw, 'reference_number')
        ? String(raw.reference_number || '').trim()
        : String(rec.reference_number || '').trim();
      const nextAttach = Object.prototype.hasOwnProperty.call(raw, 'deposit_attachment_url')
        ? String(raw.deposit_attachment_url || '').trim()
        : String(rec.deposit_attachment_url || '').trim();

      if (!nextRef) {
        return res.status(400).json({
          success: false,
          message: 'reference_number is required',
        });
      }
      if (!nextAttach) {
        return res.status(400).json({
          success: false,
          message: 'deposit_attachment_url is required (upload deposit proof)',
        });
      }

      const snapshot = await getCashDepositSnapshot({
        branchId: rec.branch_id,
        startDate: rec.start_date,
        endDate: rec.end_date,
      });

      const updateRes = await query(
        `UPDATE cash_deposit_summarytbl
         SET total_deposit_amount = $1,
             total_cash_amount = $2,
             payment_count = $3,
             completed_cash_count = $4,
             cash_payment_snapshot = $5::jsonb,
             reference_number = $6,
             deposit_attachment_url = $7,
             status = 'Pending',
             approved_by = NULL,
             approved_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE cash_deposit_summary_id = $8
         RETURNING cash_deposit_summary_id, branch_id,
                   TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
                   TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date,
                   total_deposit_amount, total_cash_amount, payment_count, completed_cash_count,
                   status, submitted_at, reference_number, deposit_attachment_url`,
        [
          snapshot.total_deposit_amount,
          snapshot.total_cash_amount,
          snapshot.payment_count,
          snapshot.completed_cash_count,
          JSON.stringify(snapshot.payments || []),
          nextRef,
          nextAttach,
          id,
        ]
      );

      return res.json({
        success: true,
        message: 'Cash deposit summary resubmitted for verification',
        data: updateRes.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

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
        `SELECT c.cash_deposit_summary_id, c.branch_id,
                TO_CHAR(c.start_date, 'YYYY-MM-DD') AS start_date,
                TO_CHAR(c.end_date, 'YYYY-MM-DD') AS end_date,
                c.total_deposit_amount, c.total_cash_amount, c.payment_count, c.completed_cash_count,
                c.status, c.submitted_by, c.submitted_at, c.approved_by, c.approved_at, c.remarks,
                c.reference_number, c.deposit_attachment_url,
                COALESCE(c.cash_payment_snapshot, '[]'::jsonb) AS cash_payment_snapshot,
                COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
                sub.full_name AS submitted_by_name,
                app.full_name AS approved_by_name
         FROM cash_deposit_summarytbl c
         LEFT JOIN branchestbl b ON c.branch_id = b.branch_id
         LEFT JOIN userstbl sub ON c.submitted_by = sub.user_id
         LEFT JOIN userstbl app ON c.approved_by = app.user_id
         WHERE c.cash_deposit_summary_id = $1`,
        [id]
      );

      if (summaryRes.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Cash deposit summary not found',
        });
      }

      const summary = summaryRes.rows[0];

      if (userType === 'Admin' && userBranchId !== summary.branch_id) {
        return res.status(403).json({
          success: false,
          message: 'You can only view cash deposit summaries for your branch',
        });
      }

      if (userType === 'Finance' && userBranchId != null && userBranchId !== summary.branch_id) {
        return res.status(403).json({
          success: false,
          message: 'You can only view cash deposit summaries for your branch',
        });
      }

      // CRITICAL: pass excludeSummaryId so the recalc DOESN'T self-exclude every
      // payment in this summary's own snapshot (which would zero out the modal).
      const snapshot = await getCashDepositSnapshot({
        branchId: summary.branch_id,
        startDate: summary.start_date,
        endDate: summary.end_date,
        excludeSummaryId: summary.cash_deposit_summary_id,
      });

      // Surface the audit snapshot rows from the JSONB column so the frontend
      // can fall back to "what was originally submitted" if a payment was hard
      // deleted after submission.
      const snapshotRows = Array.isArray(summary.cash_payment_snapshot)
        ? summary.cash_payment_snapshot
        : [];

      res.json({
        success: true,
        data: {
          summary,
          payments: snapshot.payments || [],
          totals: {
            total_deposit_amount: snapshot.total_deposit_amount,
            total_cash_amount: snapshot.total_cash_amount,
            payment_count: snapshot.payment_count,
            completed_cash_count: snapshot.completed_cash_count,
          },
          submitted_snapshot: {
            total_deposit_amount: parseFloat(summary.total_deposit_amount) || 0,
            total_cash_amount: parseFloat(summary.total_cash_amount) || 0,
            payment_count: parseInt(summary.payment_count, 10) || 0,
            completed_cash_count: parseInt(summary.completed_cash_count, 10) || 0,
            payments: snapshotRows,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
