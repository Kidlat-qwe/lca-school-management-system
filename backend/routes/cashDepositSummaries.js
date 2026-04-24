import express from 'express';
import { body, param, query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole, requireBranchAccess } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query } from '../config/database.js';

const router = express.Router();

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
       AND start_date <= $2::date
       AND end_date >= $3::date
     ORDER BY start_date ASC
     LIMIT 1`,
    [branchId, endDate, startDate]
  );

  return result.rows[0] || null;
};

const getCashDepositSnapshot = async ({ branchId, startDate, endDate }) => {
  const result = await query(
    `SELECT p.payment_id,
            p.invoice_id,
            p.student_id,
            p.branch_id,
            p.payment_method,
            p.payment_type,
            p.payable_amount,
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
       AND LOWER(TRIM(COALESCE(p.payment_method, ''))) = 'cash'
       AND p.issue_date >= $2::date
       AND p.issue_date <= $3::date
     ORDER BY p.issue_date ASC, p.payment_id ASC`,
    [branchId, startDate, endDate]
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

    const amount = parseFloat(row.payable_amount) || 0;
    totalCashAmount += amount;

    if (row.status === 'Completed') {
      totalDepositAmount += amount;
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

  const body = `${submittedBy} submitted Cash Deposit Summary for ${branchName} (${startDate} to ${endDate}). Deposit amount: ₱${formattedDeposit}; Total cash: ₱${formattedCash}; Payments: ${paymentCount || 0}.`;

  await query(
    `INSERT INTO announcementstbl (title, body, recipient_groups, status, priority, branch_id, created_by, navigation_key, navigation_query)
     VALUES ($1, $2, $3, 'Active', 'High', $4, $5, $6, $7)`,
    [
      'Cash Deposit Summary Submitted',
      body,
      ['Finance'],
      branchId,
      createdBy,
      'daily-summary-sales',
      `notificationTab=cashDeposit&cashDepositSummaryId=${cashDepositSummaryId}`,
    ]
  );

  // Explicitly notify all Superadmin users as targeted bell notifications.
  const superadminRes = await query(
    `SELECT user_id FROM userstbl WHERE LOWER(TRIM(user_type)) = 'superadmin'`
  );
  const superadminIds = (superadminRes.rows || [])
    .map((row) => row.user_id)
    .filter((id) => id != null && Number(id) !== Number(createdBy));

  if (superadminIds.length > 0) {
    await Promise.all(
      superadminIds.map((targetUserId) =>
        query(
          `INSERT INTO announcementstbl (title, body, recipient_groups, status, priority, branch_id, created_by, target_user_id, navigation_key, navigation_query)
           VALUES ($1, $2, $3, 'Active', 'High', $4, $5, $6, $7, $8)`,
          [
            'Cash Deposit Summary Submitted',
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

router.get(
  '/',
  [
    queryValidator('branch_id').optional().isInt().withMessage('branch_id must be an integer'),
    queryValidator('date').optional().isISO8601().withMessage('date must be YYYY-MM-DD'),
    queryValidator('status').optional().isIn(['Submitted', 'Approved', 'Rejected']).withMessage('status must be Submitted, Approved, or Rejected'),
    queryValidator('page').optional().isInt({ min: 1 }).withMessage('page must be positive'),
    queryValidator('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit 1-100'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { branch_id, date, status, page = 1, limit = 50 } = req.query;
      const userType = req.user.userType;
      const userBranchId = req.user.branchId;
      const limitNum = parseInt(limit, 10) || 50;
      const pageNum = parseInt(page, 10) || 1;
      const offset = (pageNum - 1) * limitNum;

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

      if (date) {
        pc++;
        sql += ` AND c.start_date <= $${pc}::date AND c.end_date >= $${pc}::date`;
        params.push(date);
      }

      if (status) {
        pc++;
        sql += ` AND c.status = $${pc}`;
        params.push(status);
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

      if (date) {
        cc++;
        countSql += ` AND c.start_date <= $${cc}::date AND c.end_date >= $${cc}::date`;
        countParams.push(date);
      }

      if (status) {
        cc++;
        countSql += ` AND c.status = $${cc}`;
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

      const overlappingSummary = await findOverlappingCashDepositSummary({
        branchId: userBranchId,
        startDate,
        endDate,
      });

      if (overlappingSummary) {
        return res.status(409).json({
          success: false,
          message: `Selected dates overlap an existing cash deposit summary (${overlappingSummary.start_date} to ${overlappingSummary.end_date}). Please choose dates outside already deposited periods.`,
          data: overlappingSummary,
        });
      }

      const snapshot = await getCashDepositSnapshot({
        branchId: userBranchId,
        startDate,
        endDate,
      });

      const insertRes = await query(
        `INSERT INTO cash_deposit_summarytbl (
           branch_id, start_date, end_date, total_deposit_amount, total_cash_amount,
           payment_count, completed_cash_count, status, submitted_by, reference_number, deposit_attachment_url, cash_payment_snapshot
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'Submitted', $8, $9, $10, $11::jsonb)
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
        message: 'Cash deposit summary submitted successfully',
        data: insertRes.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

router.put(
  '/:id/approve',
  requireRole('Finance'),
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

      if (userType === 'Finance' && userBranchId !== null && userBranchId !== undefined) {
        const branchCheck = await query(
          'SELECT branch_id FROM cash_deposit_summarytbl WHERE cash_deposit_summary_id = $1',
          [id]
        );
        const targetBranchId = branchCheck.rows[0]?.branch_id;
        if (targetBranchId && Number(targetBranchId) !== Number(userBranchId)) {
          return res.status(403).json({
            success: false,
            message: 'You can only verify cash deposit summaries for your assigned branch',
          });
        }
      } else if (userType !== 'Finance' && userType !== 'Superfinance') {
        return res.status(403).json({
          success: false,
          message: 'Only Finance and Superfinance can verify cash deposit summaries',
        });
      }

      const checkRes = await query(
        'SELECT cash_deposit_summary_id, status FROM cash_deposit_summarytbl WHERE cash_deposit_summary_id = $1',
        [id]
      );

      if (checkRes.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Cash deposit summary not found',
        });
      }

      const record = checkRes.rows[0];
      if (record.status !== 'Submitted') {
        return res.status(400).json({
          success: false,
          message: `Cannot change verification. Current status: ${record.status}`,
        });
      }

      const isApproved = approve === true || approve === 'true';
      const newStatus = isApproved ? 'Approved' : 'Rejected';

      await query(
        `UPDATE cash_deposit_summarytbl
         SET status = $1, approved_by = $2, approved_at = CURRENT_TIMESTAMP, remarks = $3, updated_at = CURRENT_TIMESTAMP
         WHERE cash_deposit_summary_id = $4`,
        [newStatus, req.user.userId, remarks || null, id]
      );

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
        message: isApproved ? 'Cash deposit summary verified' : 'Cash deposit summary rejected',
        data: updated.rows[0],
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
        `SELECT cash_deposit_summary_id, branch_id,
                TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
                TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date,
                cash_payment_snapshot
         FROM cash_deposit_summarytbl
         WHERE cash_deposit_summary_id = $1`,
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

      let payments = Array.isArray(summary.cash_payment_snapshot) ? summary.cash_payment_snapshot : [];
      if (payments.length === 0) {
        const snapshot = await getCashDepositSnapshot({
          branchId: summary.branch_id,
          startDate: summary.start_date,
          endDate: summary.end_date,
        });
        payments = snapshot.payments || [];
      }

      res.json({
        success: true,
        data: {
          payments,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
