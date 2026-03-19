/**
 * Daily Summary Sales
 * - Admin: Submit daily summary for TODAY only (amount auto-calculated from paymenttbl)
 * - Superadmin / Superfinance: List and verify (or flag for review) summaries submitted by branch Admins
 */
import express from 'express';
import { param, query as queryValidator, body } from 'express-validator';
import { verifyFirebaseToken, requireRole, requireBranchAccess } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query } from '../config/database.js';

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

      const sumRes = await query(
        `SELECT COALESCE(SUM(payable_amount), 0) AS total, COUNT(*) AS payment_count
         FROM paymenttbl
         WHERE branch_id = $1 AND issue_date = $2::date`,
        [targetBranchId, targetDate]
      );
      const row = sumRes.rows[0];
      const total = parseFloat(row?.total || 0);
      const paymentCount = parseInt(row?.payment_count || 0, 10);

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
         WHERE p.branch_id = $1 AND p.issue_date = $2::date
         ORDER BY p.payment_id DESC`,
        [targetBranchId, targetDate]
      );

      // Replace Walk-in Customer with AR prospect name for merchandise AR payments
      const payments = [];
      for (const row of paymentsRes.rows || []) {
        let studentName = row.student_name;
        let studentEmail = row.student_email;

        const isWalkIn = (studentEmail || '').toLowerCase() === 'walkin@merchandise.psms.internal';
        if (isWalkIn && row.ack_receipt_id) {
          const arResult = await query(
            'SELECT prospect_student_name FROM acknowledgement_receiptstbl WHERE ack_receipt_id = $1',
            [row.ack_receipt_id]
          );
          const prospectName = arResult.rows[0]?.prospect_student_name || null;
          if (prospectName) {
            studentName = prospectName;
          }
        }

        payments.push({
          ...row,
          student_name: studentName,
          student_email: studentEmail,
        });
      }

      res.json({
        success: true,
        data: {
          branch_id: targetBranchId,
          summary_date: targetDate,
          total_amount: Math.round(total * 100) / 100,
          payment_count: paymentCount,
          payments,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

const TODAY_MANILA = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

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

      const sumRes = await query(
        `SELECT COALESCE(SUM(payable_amount), 0) AS total, COUNT(*) AS payment_count
         FROM paymenttbl
         WHERE branch_id = $1 AND issue_date = $2`,
        [userBranchId, requestedDate]
      );
      const row = sumRes.rows[0];
      const totalAmount = Math.round((parseFloat(row?.total || 0)) * 100) / 100;
      const paymentCount = parseInt(row?.payment_count || 0, 10);

      const insertRes = await query(
        `INSERT INTO daily_summary_salestbl (branch_id, summary_date, total_amount, payment_count, status, submitted_by)
         VALUES ($1, $2, $3, $4, 'Submitted', $5)
         ON CONFLICT (branch_id, summary_date)
         DO UPDATE SET total_amount = EXCLUDED.total_amount, payment_count = EXCLUDED.payment_count,
                       submitted_by = EXCLUDED.submitted_by, submitted_at = CURRENT_TIMESTAMP,
                       status = 'Submitted', approved_by = NULL, approved_at = NULL, updated_at = CURRENT_TIMESTAMP
         RETURNING daily_summary_id, branch_id, summary_date, total_amount, payment_count, status, submitted_at`,
        [userBranchId, requestedDate, totalAmount, paymentCount, userId]
      );

      res.status(201).json({
        success: true,
        message: 'Daily summary submitted successfully',
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
