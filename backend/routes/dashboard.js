import express from 'express';
import { query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole, requireBranchAccess } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query } from '../config/database.js';

const router = express.Router();

router.use(verifyFirebaseToken);
router.use(requireBranchAccess);

const formatMonthLabel = (date) => {
  return date.toLocaleString('default', { month: 'short', year: 'numeric' });
};

const buildMonthSequence = (monthsBack = 6, anchorDateInput = new Date()) => {
  const today = anchorDateInput instanceof Date ? anchorDateInput : new Date(anchorDateInput);
  const anchorDate = Number.isNaN(today.getTime()) ? new Date() : today;
  const sequence = [];
  for (let i = monthsBack - 1; i >= 0; i -= 1) {
    const date = new Date(anchorDate.getFullYear(), anchorDate.getMonth() - i, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    sequence.push({
      key,
      label: formatMonthLabel(date),
    });
  }
  return sequence;
};

const parseMonthRange = (monthKey) => {
  if (!monthKey || !/^\d{4}-\d{2}$/.test(String(monthKey))) return null;
  const [yearStr, monthStr] = String(monthKey).split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));
  return {
    key: `${yearStr}-${monthStr}`,
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    anchorDate: new Date(year, month - 1, 1),
  };
};

const getTodayManila = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
const getCurrentManilaMonthKey = () => getTodayManila().slice(0, 7);

const buildRecentDaySequence = (daysBack = 7, endDateIso = getTodayManila()) => {
  const baseDate = endDateIso ? new Date(`${endDateIso}T12:00:00+08:00`) : new Date();
  const anchorDate = Number.isNaN(baseDate.getTime()) ? new Date() : baseDate;
  const formatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Manila',
  });

  const sequence = [];
  for (let i = daysBack - 1; i >= 0; i -= 1) {
    const date = new Date(anchorDate);
    date.setDate(anchorDate.getDate() - i);
    const iso = date.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    sequence.push({
      key: iso,
      label: formatter.format(date),
    });
  }
  return sequence;
};

router.get(
  '/',
  [
    queryValidator('branch_id').optional().isInt().withMessage('Branch ID must be an integer'),
    queryValidator('month').optional().matches(/^\d{4}-\d{2}$/).withMessage('month must be YYYY-MM'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { branch_id, month } = req.query;
      const branchFilter = branch_id ? parseInt(branch_id, 10) : null;
      const monthRange = parseMonthRange(month);
      if (monthRange && monthRange.key > getCurrentManilaMonthKey()) {
        return res.status(400).json({
          success: false,
          message: 'month cannot be in the future',
        });
      }
      const selectedMonth = monthRange?.key || null;

      // Build queries with parameterized values for security
      const branchParams = branchFilter ? [branchFilter] : [];

      const totalsQuery = branchFilter
        ? `
          SELECT
            (SELECT COUNT(*) FROM branchestbl WHERE branch_id = $1) AS total_branches,
            (SELECT COUNT(*) FROM userstbl WHERE user_type = 'Student' AND branch_id = $1) AS total_students,
            (SELECT COUNT(*) FROM userstbl WHERE user_type = 'Teacher' AND branch_id = $1) AS total_teachers,
            (SELECT COUNT(*) FROM classestbl WHERE status = 'Active' AND branch_id = $1) AS active_classes
        `
        : `
          SELECT
            (SELECT COUNT(*) FROM branchestbl) AS total_branches,
            (SELECT COUNT(*) FROM userstbl WHERE user_type = 'Student') AS total_students,
            (SELECT COUNT(*) FROM userstbl WHERE user_type = 'Teacher') AS total_teachers,
            (SELECT COUNT(*) FROM classestbl WHERE status = 'Active') AS active_classes
        `;

      const [totalsResult] = await Promise.all([
        query(totalsQuery, branchParams),
      ]);

      const totals = totalsResult.rows[0] || {
        total_branches: 0,
        total_students: 0,
        total_teachers: 0,
        active_classes: 0,
      };

      const monthSequence = buildMonthSequence(6, monthRange?.anchorDate || new Date());
      const monthKeys = monthSequence.map((m) => m.key);
      const monthStartDate = monthRange?.start || null;
      const monthEndDate = monthRange?.end || null;

      const enrollmentsQuery = branchFilter
        ? `
          SELECT
            TO_CHAR(DATE_TRUNC('month', cs.enrolled_at), 'YYYY-MM') AS month,
            COUNT(*) AS count
          FROM classstudentstbl cs
          INNER JOIN classestbl c ON cs.class_id = c.class_id
          WHERE cs.enrolled_at >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'
            AND c.branch_id = $1
          GROUP BY 1
          ORDER BY 1
        `
        : `
          SELECT
            TO_CHAR(DATE_TRUNC('month', cs.enrolled_at), 'YYYY-MM') AS month,
            COUNT(*) AS count
          FROM classstudentstbl cs
          INNER JOIN classestbl c ON cs.class_id = c.class_id
          WHERE cs.enrolled_at >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'
          GROUP BY 1
          ORDER BY 1
        `;
      const enrollmentsResult = await query(enrollmentsQuery, branchParams);
      const enrollmentMap = enrollmentsResult.rows.reduce((acc, row) => {
        acc[row.month] = parseInt(row.count, 10);
        return acc;
      }, {});
      const monthlyEnrollments = monthSequence.map((month) => ({
        month: month.label,
        count: enrollmentMap[month.key] || 0,
      }));

      const invoiceTrendQuery = branchFilter
        ? `
          SELECT
            TO_CHAR(DATE_TRUNC('month', issue_date), 'YYYY-MM') AS month,
            COALESCE(SUM(amount), 0) AS total
          FROM invoicestbl i
          WHERE issue_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'
            AND i.branch_id = $1
          GROUP BY 1
          ORDER BY 1
        `
        : `
          SELECT
            TO_CHAR(DATE_TRUNC('month', issue_date), 'YYYY-MM') AS month,
            COALESCE(SUM(amount), 0) AS total
          FROM invoicestbl i
          WHERE issue_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'
          GROUP BY 1
          ORDER BY 1
        `;
      const invoiceTrendResult = await query(invoiceTrendQuery, branchParams);
      const invoiceMap = invoiceTrendResult.rows.reduce((acc, row) => {
        acc[row.month] = parseFloat(row.total);
        return acc;
      }, {});
      const invoiceTrend = monthSequence.map((month) => ({
        month: month.label,
        total: invoiceMap[month.key] || 0,
      }));

      const studentsByBranchQuery = branchFilter
        ? `
          SELECT
            b.branch_id,
            COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
            COUNT(u.user_id) FILTER (WHERE u.user_type = 'Student') AS student_count
          FROM branchestbl b
          LEFT JOIN userstbl u ON u.branch_id = b.branch_id AND u.user_type = 'Student'
          WHERE b.branch_id = $1
          GROUP BY b.branch_id, b.branch_nickname, b.branch_name
          ORDER BY student_count DESC NULLS LAST, COALESCE(b.branch_nickname, b.branch_name)
        `
        : `
          SELECT
            b.branch_id,
            COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
            COUNT(u.user_id) FILTER (WHERE u.user_type = 'Student') AS student_count
          FROM branchestbl b
          LEFT JOIN userstbl u ON u.branch_id = b.branch_id AND u.user_type = 'Student'
          GROUP BY b.branch_id, b.branch_nickname, b.branch_name
          ORDER BY student_count DESC NULLS LAST, COALESCE(b.branch_nickname, b.branch_name)
        `;
      const studentsByBranchResult = await query(studentsByBranchQuery, branchParams);

      const invoiceStatusQuery = branchFilter
        ? `
          SELECT
            status,
            COUNT(*) AS count,
            COALESCE(SUM(amount), 0) AS total_amount
          FROM invoicestbl i
          WHERE i.branch_id = $1
            ${monthStartDate ? 'AND i.issue_date >= $2::date AND i.issue_date < $3::date' : ''}
          GROUP BY status
        `
        : `
          SELECT
            status,
            COUNT(*) AS count,
            COALESCE(SUM(amount), 0) AS total_amount
          FROM invoicestbl i
          ${monthStartDate ? 'WHERE i.issue_date >= $1::date AND i.issue_date < $2::date' : ''}
          GROUP BY status
        `;
      const invoiceStatusParams = branchFilter
        ? (monthStartDate ? [...branchParams, monthStartDate, monthEndDate] : branchParams)
        : (monthStartDate ? [monthStartDate, monthEndDate] : []);
      const invoiceStatusResult = await query(invoiceStatusQuery, invoiceStatusParams);

      // Completed payments split by Finance/Superfinance approval (same rules as Payment Logs)
      const paymentVerificationQuery = branchFilter
        ? `
          SELECT
            COUNT(*) FILTER (
              WHERE p.status = 'Completed' AND p.approval_status = 'Approved'
            )::bigint AS verified_count,
            COALESCE(
              SUM(COALESCE(p.payable_amount, 0) + COALESCE(p.tip_amount, 0)) FILTER (
                WHERE p.status = 'Completed' AND p.approval_status = 'Approved'
              ),
              0
            ) AS verified_amount,
            COUNT(*) FILTER (
              WHERE p.status = 'Completed' AND COALESCE(p.approval_status, 'Pending') <> 'Approved'
            )::bigint AS unverified_count,
            COALESCE(
              SUM(COALESCE(p.payable_amount, 0) + COALESCE(p.tip_amount, 0)) FILTER (
                WHERE p.status = 'Completed' AND COALESCE(p.approval_status, 'Pending') <> 'Approved'
              ),
              0
            ) AS unverified_amount
          FROM paymenttbl p
          WHERE p.branch_id = $1
            ${monthStartDate ? 'AND p.issue_date >= $2::date AND p.issue_date < $3::date' : ''}
        `
        : `
          SELECT
            COUNT(*) FILTER (
              WHERE p.status = 'Completed' AND p.approval_status = 'Approved'
            )::bigint AS verified_count,
            COALESCE(
              SUM(COALESCE(p.payable_amount, 0) + COALESCE(p.tip_amount, 0)) FILTER (
                WHERE p.status = 'Completed' AND p.approval_status = 'Approved'
              ),
              0
            ) AS verified_amount,
            COUNT(*) FILTER (
              WHERE p.status = 'Completed' AND COALESCE(p.approval_status, 'Pending') <> 'Approved'
            )::bigint AS unverified_count,
            COALESCE(
              SUM(COALESCE(p.payable_amount, 0) + COALESCE(p.tip_amount, 0)) FILTER (
                WHERE p.status = 'Completed' AND COALESCE(p.approval_status, 'Pending') <> 'Approved'
              ),
              0
            ) AS unverified_amount
          FROM paymenttbl p
          ${monthStartDate ? 'WHERE p.issue_date >= $1::date AND p.issue_date < $2::date' : ''}
        `;
      const paymentVerificationParams = branchFilter
        ? (monthStartDate ? [...branchParams, monthStartDate, monthEndDate] : branchParams)
        : (monthStartDate ? [monthStartDate, monthEndDate] : []);
      const paymentVerificationResult = await query(paymentVerificationQuery, paymentVerificationParams);
      const pvRow = paymentVerificationResult.rows[0] || {};

      // Package AR lifecycle split for verification monitoring.
      // Verified includes already-applied ARs since those passed verification.
      const arVerificationQuery = branchFilter
        ? `
          SELECT
            COUNT(*) FILTER (
              WHERE ar.ar_type = 'Package' AND ar.status IN ('Verified', 'Applied')
            )::bigint AS verified_count,
            COALESCE(
              SUM(COALESCE(ar.payment_amount, 0) + COALESCE(ar.tip_amount, 0)) FILTER (
                WHERE ar.ar_type = 'Package' AND ar.status IN ('Verified', 'Applied')
              ),
              0
            ) AS verified_amount,
            COUNT(*) FILTER (
              WHERE ar.ar_type = 'Package' AND COALESCE(ar.status, 'Submitted') NOT IN ('Verified', 'Applied', 'Rejected', 'Cancelled')
            )::bigint AS unverified_count,
            COALESCE(
              SUM(COALESCE(ar.payment_amount, 0) + COALESCE(ar.tip_amount, 0)) FILTER (
                WHERE ar.ar_type = 'Package' AND COALESCE(ar.status, 'Submitted') NOT IN ('Verified', 'Applied', 'Rejected', 'Cancelled')
              ),
              0
            ) AS unverified_amount
          FROM acknowledgement_receiptstbl ar
          WHERE ar.branch_id = $1
            ${monthStartDate ? 'AND ar.issue_date >= $2::date AND ar.issue_date < $3::date' : ''}
        `
        : `
          SELECT
            COUNT(*) FILTER (
              WHERE ar.ar_type = 'Package' AND ar.status IN ('Verified', 'Applied')
            )::bigint AS verified_count,
            COALESCE(
              SUM(COALESCE(ar.payment_amount, 0) + COALESCE(ar.tip_amount, 0)) FILTER (
                WHERE ar.ar_type = 'Package' AND ar.status IN ('Verified', 'Applied')
              ),
              0
            ) AS verified_amount,
            COUNT(*) FILTER (
              WHERE ar.ar_type = 'Package' AND COALESCE(ar.status, 'Submitted') NOT IN ('Verified', 'Applied', 'Rejected', 'Cancelled')
            )::bigint AS unverified_count,
            COALESCE(
              SUM(COALESCE(ar.payment_amount, 0) + COALESCE(ar.tip_amount, 0)) FILTER (
                WHERE ar.ar_type = 'Package' AND COALESCE(ar.status, 'Submitted') NOT IN ('Verified', 'Applied', 'Rejected', 'Cancelled')
              ),
              0
            ) AS unverified_amount
          FROM acknowledgement_receiptstbl ar
          ${monthStartDate ? 'WHERE ar.issue_date >= $1::date AND ar.issue_date < $2::date' : ''}
        `;
      const arVerificationParams = branchFilter
        ? (monthStartDate ? [...branchParams, monthStartDate, monthEndDate] : branchParams)
        : (monthStartDate ? [monthStartDate, monthEndDate] : []);
      const arVerificationResult = await query(arVerificationQuery, arVerificationParams);
      const arvRow = arVerificationResult.rows[0] || {};

      const reservationStatusQuery = branchFilter
        ? `
          SELECT
            status,
            COUNT(*) AS count
          FROM reservedstudentstbl r
          WHERE r.branch_id = $1
            ${monthStartDate ? 'AND r.reserved_at >= $2::date AND r.reserved_at < $3::date' : ''}
          GROUP BY status
        `
        : `
          SELECT
            status,
            COUNT(*) AS count
          FROM reservedstudentstbl r
          ${monthStartDate ? 'WHERE r.reserved_at >= $1::date AND r.reserved_at < $2::date' : ''}
          GROUP BY status
        `;
      const reservationStatusParams = branchFilter
        ? (monthStartDate ? [...branchParams, monthStartDate, monthEndDate] : branchParams)
        : (monthStartDate ? [monthStartDate, monthEndDate] : []);
      const reservationStatusResult = await query(reservationStatusQuery, reservationStatusParams);

      // Get all branches for filter dropdown
      const branchesResult = await query(`
        SELECT 
          branch_id, 
          COALESCE(branch_nickname, branch_name) AS branch_name
        FROM branchestbl
        ORDER BY COALESCE(branch_nickname, branch_name)
      `);

      // Get crossing procedures data (students enrolled in classes from different branches)
      const crossingProceduresQuery = branchFilter
        ? `
          SELECT
            cs.classstudent_id,
            u.user_id as student_id,
            u.full_name as student_name,
            u.branch_id as student_branch_id,
            COALESCE(b_student.branch_nickname, b_student.branch_name) as student_branch_name,
            c.class_id,
            c.class_name,
            c.level_tag,
            c.branch_id as class_branch_id,
            COALESCE(b_class.branch_nickname, b_class.branch_name) as class_branch_name,
            p.program_name,
            cs.enrolled_at,
            cs.phase_number
          FROM classstudentstbl cs
          INNER JOIN userstbl u ON cs.student_id = u.user_id
          INNER JOIN classestbl c ON cs.class_id = c.class_id
          LEFT JOIN branchestbl b_student ON u.branch_id = b_student.branch_id
          LEFT JOIN branchestbl b_class ON c.branch_id = b_class.branch_id
          LEFT JOIN programstbl p ON c.program_id = p.program_id
          WHERE u.user_type = 'Student'
            AND u.branch_id IS NOT NULL
            AND c.branch_id IS NOT NULL
            AND u.branch_id != c.branch_id
            AND (u.branch_id = $1 OR c.branch_id = $1)
            ${monthStartDate ? 'AND cs.enrolled_at >= $2::date AND cs.enrolled_at < $3::date' : ''}
          ORDER BY cs.enrolled_at DESC
          LIMIT 50
        `
        : `
          SELECT
            cs.classstudent_id,
            u.user_id as student_id,
            u.full_name as student_name,
            u.branch_id as student_branch_id,
            COALESCE(b_student.branch_nickname, b_student.branch_name) as student_branch_name,
            c.class_id,
            c.class_name,
            c.level_tag,
            c.branch_id as class_branch_id,
            COALESCE(b_class.branch_nickname, b_class.branch_name) as class_branch_name,
            p.program_name,
            cs.enrolled_at,
            cs.phase_number
          FROM classstudentstbl cs
          INNER JOIN userstbl u ON cs.student_id = u.user_id
          INNER JOIN classestbl c ON cs.class_id = c.class_id
          LEFT JOIN branchestbl b_student ON u.branch_id = b_student.branch_id
          LEFT JOIN branchestbl b_class ON c.branch_id = b_class.branch_id
          LEFT JOIN programstbl p ON c.program_id = p.program_id
          WHERE u.user_type = 'Student'
            AND u.branch_id IS NOT NULL
            AND c.branch_id IS NOT NULL
            AND u.branch_id != c.branch_id
            ${monthStartDate ? 'AND cs.enrolled_at >= $1::date AND cs.enrolled_at < $2::date' : ''}
          ORDER BY cs.enrolled_at DESC
          LIMIT 50
        `;
      const crossingProceduresParams = branchFilter
        ? (monthStartDate ? [...branchParams, monthStartDate, monthEndDate] : branchParams)
        : (monthStartDate ? [monthStartDate, monthEndDate] : []);
      const crossingProceduresResult = await query(crossingProceduresQuery, crossingProceduresParams);

      res.json({
        success: true,
        data: {
          totals: {
            total_branches: parseInt(totals.total_branches, 10) || 0,
            total_students: parseInt(totals.total_students, 10) || 0,
            total_teachers: parseInt(totals.total_teachers, 10) || 0,
            active_classes: parseInt(totals.active_classes, 10) || 0,
          },
          monthly_enrollments: monthlyEnrollments,
          invoice_trend: invoiceTrend,
          students_by_branch: studentsByBranchResult.rows.map((row) => ({
            branch_id: row.branch_id,
            branch_name: row.branch_name || 'Unassigned',
            student_count: parseInt(row.student_count, 10) || 0,
          })),
          invoice_status: invoiceStatusResult.rows.map((row) => ({
            status: row.status || 'Unknown',
            count: parseInt(row.count, 10) || 0,
            total_amount: parseFloat(row.total_amount) || 0,
          })),
          reservation_status: reservationStatusResult.rows.map((row) => ({
            status: row.status || 'Unknown',
            count: parseInt(row.count, 10) || 0,
          })),
          branches: branchesResult.rows.map((row) => ({
            branch_id: row.branch_id,
            branch_name: row.branch_name,
          })),
          payment_verification: {
            verified_count: parseInt(pvRow.verified_count, 10) || 0,
            verified_amount: parseFloat(pvRow.verified_amount) || 0,
            unverified_count: parseInt(pvRow.unverified_count, 10) || 0,
            unverified_amount: parseFloat(pvRow.unverified_amount) || 0,
          },
          ar_verification: {
            verified_count: parseInt(arvRow.verified_count, 10) || 0,
            verified_amount: parseFloat(arvRow.verified_amount) || 0,
            unverified_count: parseInt(arvRow.unverified_count, 10) || 0,
            unverified_amount: parseFloat(arvRow.unverified_amount) || 0,
          },
          crossing_procedures: {
            total_violations: crossingProceduresResult.rows.length,
            violations: crossingProceduresResult.rows.map((row) => ({
              classstudent_id: row.classstudent_id,
              student_id: row.student_id,
              student_name: row.student_name,
              student_branch_id: row.student_branch_id,
              student_branch_name: row.student_branch_name || 'Unassigned',
              class_id: row.class_id,
              class_name: row.class_name || row.level_tag,
              level_tag: row.level_tag,
              class_branch_id: row.class_branch_id,
              class_branch_name: row.class_branch_name || 'Unassigned',
              program_name: row.program_name,
              enrolled_at: row.enrolled_at ? row.enrolled_at.toISOString() : null,
              phase_number: row.phase_number,
            })),
          },
          selected_month: selectedMonth,
          selected_branch_id: branchFilter,
          updated_at: new Date().toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/daily-operational',
  [
    queryValidator('branch_id').optional().isInt().withMessage('Branch ID must be an integer'),
    queryValidator('summary_date').optional().isISO8601({ strict: true }).withMessage('summary_date must be YYYY-MM-DD'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const isAdmin = req.user.userType === 'Admin';
      const branchFilter = isAdmin
        ? (req.user.branchId || null)
        : (req.query.branch_id ? parseInt(req.query.branch_id, 10) : null);
      const todayManila = getTodayManila();
      const summaryDate = req.query.summary_date || todayManila;
      const recentDaySequence = buildRecentDaySequence(7, summaryDate);
      const branchParams = branchFilter ? [branchFilter] : [];
      const branchWhereClause = branchFilter ? 'WHERE b.branch_id = $1' : '';

      const [branchesResult, branchMetricsResult, salesTrendResult] = await Promise.all([
        query(
          `
            SELECT
              b.branch_id,
              COALESCE(b.branch_nickname, b.branch_name) AS branch_name
            FROM branchestbl b
            ORDER BY COALESCE(b.branch_nickname, b.branch_name)
          `
        ),
        query(
          `
            WITH branch_scope AS (
              SELECT
                b.branch_id,
                COALESCE(b.branch_nickname, b.branch_name) AS branch_name
              FROM branchestbl b
              ${branchWhereClause}
            ),
            new_enrollees AS (
              SELECT
                c.branch_id,
                COUNT(DISTINCT cs.student_id) AS new_enrollees
              FROM classstudentstbl cs
              INNER JOIN classestbl c ON cs.class_id = c.class_id
              WHERE TIMEZONE('Asia/Manila', cs.enrolled_at)::date = $${branchParams.length + 1}::date
              GROUP BY c.branch_id
            ),
            daily_sales AS (
              SELECT
                p.branch_id,
                COALESCE(SUM(COALESCE(p.payable_amount, 0) + COALESCE(p.tip_amount, 0)), 0) AS daily_sales_amount
              FROM paymenttbl p
              LEFT JOIN invoicestbl i ON p.invoice_id = i.invoice_id
              LEFT JOIN acknowledgement_receiptstbl ar ON i.ack_receipt_id = ar.ack_receipt_id
              WHERE p.status = 'Completed'
                AND COALESCE(ar.issue_date, p.issue_date) = $${branchParams.length + 1}::date
              GROUP BY p.branch_id
            ),
            ar_sales AS (
              SELECT
                ar.branch_id,
                COUNT(*)::bigint AS ar_sales_count,
                COALESCE(SUM(COALESCE(ar.payment_amount, 0) + COALESCE(ar.tip_amount, 0)), 0) AS ar_sales_amount
              FROM acknowledgement_receiptstbl ar
              WHERE ar.issue_date = $${branchParams.length + 1}::date
                AND COALESCE(ar.status, 'Submitted') NOT IN ('Rejected', 'Cancelled', 'Applied')
                AND ar.payment_id IS NULL
                AND ar.invoice_id IS NULL
              GROUP BY ar.branch_id
            ),
            merchandise_release AS (
              SELECT
                p.branch_id,
                COUNT(DISTINCT p.payment_id) AS merchandise_released_count,
                COALESCE(SUM(COALESCE(NULLIF(item.quantity, '')::numeric, 0)), 0) AS merchandise_released_quantity
              FROM paymenttbl p
              INNER JOIN invoicestbl i ON p.invoice_id = i.invoice_id
              INNER JOIN acknowledgement_receiptstbl ar ON i.ack_receipt_id = ar.ack_receipt_id
              LEFT JOIN LATERAL jsonb_to_recordset(
                CASE
                  WHEN ar.merchandise_items_snapshot IS NULL THEN '[]'::jsonb
                  ELSE ar.merchandise_items_snapshot::jsonb
                END
              ) AS item(merchandise_id INTEGER, quantity TEXT) ON TRUE
              WHERE p.status = 'Completed'
                AND p.issue_date = $${branchParams.length + 1}::date
                AND ar.ar_type = 'Merchandise'
              GROUP BY p.branch_id
            ),
            re_enrollment AS (
              SELECT
                p.branch_id,
                COUNT(DISTINCT p.student_id) AS re_enrollment_count
              FROM paymenttbl p
              INNER JOIN invoicestbl i ON p.invoice_id = i.invoice_id
              INNER JOIN installmentinvoiceprofilestbl ip
                ON i.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
              WHERE p.status = 'Completed'
                AND p.issue_date = $${branchParams.length + 1}::date
                AND i.installmentinvoiceprofiles_id IS NOT NULL
                AND (
                  ip.downpayment_invoice_id IS NULL OR
                  COALESCE(i.invoice_chain_root_id, i.invoice_id) != ip.downpayment_invoice_id::INTEGER
                )
              GROUP BY p.branch_id
            ),
            dropped_unenrolled AS (
              SELECT
                c.branch_id,
                COUNT(DISTINCT cs.student_id) AS dropped_unenrolled_count
              FROM classstudentstbl cs
              INNER JOIN classestbl c ON cs.class_id = c.class_id
              WHERE cs.enrollment_status = 'Removed'
                AND cs.removed_at IS NOT NULL
                AND cs.enrolled_at IS NOT NULL
                AND cs.enrolled_at < cs.removed_at
                AND TIMEZONE('Asia/Manila', cs.removed_at)::date = $${branchParams.length + 1}::date
              GROUP BY c.branch_id
            ),
            pay_verified AS (
              SELECT
                p.branch_id,
                COUNT(*)::bigint AS pay_verified_count,
                COALESCE(SUM(COALESCE(p.payable_amount, 0) + COALESCE(p.tip_amount, 0)), 0) AS pay_verified_amount
              FROM paymenttbl p
              WHERE p.status = 'Completed'
                AND p.issue_date = $${branchParams.length + 2}::date
                AND p.approval_status = 'Approved'
              GROUP BY p.branch_id
            ),
            pay_unverified AS (
              SELECT
                p.branch_id,
                COUNT(*)::bigint AS pay_unverified_count,
                COALESCE(SUM(COALESCE(p.payable_amount, 0) + COALESCE(p.tip_amount, 0)), 0) AS pay_unverified_amount
              FROM paymenttbl p
              WHERE p.status = 'Completed'
                AND p.issue_date = $${branchParams.length + 2}::date
                AND (p.approval_status IS NULL OR p.approval_status <> 'Approved')
              GROUP BY p.branch_id
            ),
            ar_verified AS (
              SELECT
                ar.branch_id,
                COUNT(*)::bigint AS ar_verified_count,
                COALESCE(SUM(COALESCE(ar.payment_amount, 0) + COALESCE(ar.tip_amount, 0)), 0) AS ar_verified_amount
              FROM acknowledgement_receiptstbl ar
              WHERE ar.ar_type = 'Package'
                AND ar.issue_date = $${branchParams.length + 2}::date
                AND ar.status IN ('Verified', 'Applied')
              GROUP BY ar.branch_id
            ),
            ar_unverified AS (
              SELECT
                ar.branch_id,
                COUNT(*)::bigint AS ar_unverified_count,
                COALESCE(SUM(COALESCE(ar.payment_amount, 0) + COALESCE(ar.tip_amount, 0)), 0) AS ar_unverified_amount
              FROM acknowledgement_receiptstbl ar
              WHERE ar.ar_type = 'Package'
                AND ar.issue_date = $${branchParams.length + 2}::date
                AND COALESCE(ar.status, 'Submitted') NOT IN ('Verified', 'Applied', 'Rejected', 'Cancelled')
              GROUP BY ar.branch_id
            )
            SELECT
              bs.branch_id,
              bs.branch_name,
              COALESCE(ne.new_enrollees, 0)::bigint AS new_enrollees,
              COALESCE(ds.daily_sales_amount, 0) AS daily_sales_amount,
              COALESCE(ars.ar_sales_count, 0)::bigint AS ar_sales_count,
              COALESCE(ars.ar_sales_amount, 0) AS ar_sales_amount,
              COALESCE(mr.merchandise_released_count, 0)::bigint AS merchandise_released_count,
              COALESCE(mr.merchandise_released_quantity, 0) AS merchandise_released_quantity,
              COALESCE(re.re_enrollment_count, 0)::bigint AS re_enrollment_count,
              COALESCE(du.dropped_unenrolled_count, 0)::bigint AS dropped_unenrolled_count,
              COALESCE(pv.pay_verified_count, 0)::bigint AS pay_verified_count,
              COALESCE(pv.pay_verified_amount, 0) AS pay_verified_amount,
              COALESCE(puv.pay_unverified_count, 0)::bigint AS pay_unverified_count,
              COALESCE(puv.pay_unverified_amount, 0) AS pay_unverified_amount,
              COALESCE(arv.ar_verified_count, 0)::bigint AS ar_verified_count,
              COALESCE(arv.ar_verified_amount, 0) AS ar_verified_amount,
              COALESCE(aruv.ar_unverified_count, 0)::bigint AS ar_unverified_count,
              COALESCE(aruv.ar_unverified_amount, 0) AS ar_unverified_amount
            FROM branch_scope bs
            LEFT JOIN new_enrollees ne ON ne.branch_id = bs.branch_id
            LEFT JOIN daily_sales ds ON ds.branch_id = bs.branch_id
            LEFT JOIN ar_sales ars ON ars.branch_id = bs.branch_id
            LEFT JOIN merchandise_release mr ON mr.branch_id = bs.branch_id
            LEFT JOIN re_enrollment re ON re.branch_id = bs.branch_id
            LEFT JOIN dropped_unenrolled du ON du.branch_id = bs.branch_id
            LEFT JOIN pay_verified pv ON pv.branch_id = bs.branch_id
            LEFT JOIN pay_unverified puv ON puv.branch_id = bs.branch_id
            LEFT JOIN ar_verified arv ON arv.branch_id = bs.branch_id
            LEFT JOIN ar_unverified aruv ON aruv.branch_id = bs.branch_id
            ORDER BY
              COALESCE(ds.daily_sales_amount, 0) DESC,
              COALESCE(ne.new_enrollees, 0) DESC,
              bs.branch_name ASC
          `,
          [...branchParams, summaryDate, todayManila]
        ),
        query(
          `
            SELECT
              COALESCE(ar.issue_date, p.issue_date)::text AS issue_date,
              COALESCE(SUM(COALESCE(p.payable_amount, 0) + COALESCE(p.tip_amount, 0)), 0) AS total_amount
            FROM paymenttbl p
            LEFT JOIN invoicestbl i ON p.invoice_id = i.invoice_id
            LEFT JOIN acknowledgement_receiptstbl ar ON i.ack_receipt_id = ar.ack_receipt_id
            WHERE p.status = 'Completed'
              AND COALESCE(ar.issue_date, p.issue_date) >= $${branchParams.length + 1}::date - INTERVAL '6 days'
              AND COALESCE(ar.issue_date, p.issue_date) <= $${branchParams.length + 1}::date
              ${branchFilter ? 'AND p.branch_id = $1' : ''}
            GROUP BY COALESCE(ar.issue_date, p.issue_date)
            ORDER BY COALESCE(ar.issue_date, p.issue_date) ASC
          `,
          [...branchParams, summaryDate]
        ),
      ]);

      const branches = branchesResult.rows.map((row) => ({
        branch_id: row.branch_id,
        branch_name: row.branch_name,
      }));

      const branchBreakdown = branchMetricsResult.rows.map((row) => ({
        branch_id: row.branch_id,
        branch_name: row.branch_name,
        new_enrollees: parseInt(row.new_enrollees, 10) || 0,
        daily_sales_amount: parseFloat(row.daily_sales_amount) || 0,
        ar_sales_count: parseInt(row.ar_sales_count, 10) || 0,
        ar_sales_amount: parseFloat(row.ar_sales_amount) || 0,
        merchandise_released_count: parseInt(row.merchandise_released_count, 10) || 0,
        merchandise_released_quantity: parseFloat(row.merchandise_released_quantity) || 0,
        re_enrollment_count: parseInt(row.re_enrollment_count, 10) || 0,
        dropped_unenrolled_count: parseInt(row.dropped_unenrolled_count, 10) || 0,
        pay_verified_count: parseInt(row.pay_verified_count, 10) || 0,
        pay_verified_amount: parseFloat(row.pay_verified_amount) || 0,
        pay_unverified_count: parseInt(row.pay_unverified_count, 10) || 0,
        pay_unverified_amount: parseFloat(row.pay_unverified_amount) || 0,
        ar_verified_count: parseInt(row.ar_verified_count, 10) || 0,
        ar_verified_amount: parseFloat(row.ar_verified_amount) || 0,
        ar_unverified_count: parseInt(row.ar_unverified_count, 10) || 0,
        ar_unverified_amount: parseFloat(row.ar_unverified_amount) || 0,
      }));

      const totals = branchBreakdown.reduce(
        (acc, row) => ({
          new_enrollees: acc.new_enrollees + row.new_enrollees,
          daily_sales_amount: acc.daily_sales_amount + row.daily_sales_amount,
          ar_sales_count: acc.ar_sales_count + row.ar_sales_count,
          ar_sales_amount: acc.ar_sales_amount + row.ar_sales_amount,
          merchandise_released_count: acc.merchandise_released_count + row.merchandise_released_count,
          merchandise_released_quantity: acc.merchandise_released_quantity + row.merchandise_released_quantity,
          re_enrollment_count: acc.re_enrollment_count + row.re_enrollment_count,
          dropped_unenrolled_count: acc.dropped_unenrolled_count + row.dropped_unenrolled_count,
          pay_verified_count: acc.pay_verified_count + row.pay_verified_count,
          pay_verified_amount: acc.pay_verified_amount + row.pay_verified_amount,
          pay_unverified_count: acc.pay_unverified_count + row.pay_unverified_count,
          pay_unverified_amount: acc.pay_unverified_amount + row.pay_unverified_amount,
          ar_verified_count: acc.ar_verified_count + row.ar_verified_count,
          ar_verified_amount: acc.ar_verified_amount + row.ar_verified_amount,
          ar_unverified_count: acc.ar_unverified_count + row.ar_unverified_count,
          ar_unverified_amount: acc.ar_unverified_amount + row.ar_unverified_amount,
          active_branches:
            acc.active_branches +
            (row.new_enrollees > 0 ||
            row.daily_sales_amount > 0 ||
            row.ar_sales_amount > 0 ||
            row.merchandise_released_count > 0 ||
            row.re_enrollment_count > 0 ||
            row.dropped_unenrolled_count > 0
              ? 1
              : 0),
        }),
        {
          new_enrollees: 0,
          daily_sales_amount: 0,
          ar_sales_count: 0,
          ar_sales_amount: 0,
          merchandise_released_count: 0,
          merchandise_released_quantity: 0,
          re_enrollment_count: 0,
          dropped_unenrolled_count: 0,
          pay_verified_count: 0,
          pay_verified_amount: 0,
          pay_unverified_count: 0,
          pay_unverified_amount: 0,
          ar_verified_count: 0,
          ar_verified_amount: 0,
          ar_unverified_count: 0,
          ar_unverified_amount: 0,
          active_branches: 0,
        }
      );

      const salesTrendMap = salesTrendResult.rows.reduce((acc, row) => {
        acc[String(row.issue_date).slice(0, 10)] = parseFloat(row.total_amount) || 0;
        return acc;
      }, {});

      const salesLast7Days = recentDaySequence.map((day) => ({
        date: day.key,
        label: day.label,
        total_amount: salesTrendMap[day.key] || 0,
      }));

      res.json({
        success: true,
        data: {
          summary_date: summaryDate,
          /** Manila calendar date (YYYY-MM-DD) used for payment/AR verification columns and totals — always "today", not the date picker. */
          verification_as_of: todayManila,
          totals,
          branch_breakdown: branchBreakdown,
          charts: {
            branch_metrics: branchBreakdown.map((row) => ({
              branch_id: row.branch_id,
              branch_name: row.branch_name,
              new_enrollees: row.new_enrollees,
              daily_sales_amount: row.daily_sales_amount,
              ar_sales_count: row.ar_sales_count,
              ar_sales_amount: row.ar_sales_amount,
              merchandise_released_count: row.merchandise_released_count,
              merchandise_released_quantity: row.merchandise_released_quantity,
              re_enrollment_count: row.re_enrollment_count,
              dropped_unenrolled_count: row.dropped_unenrolled_count,
              pay_verified_count: row.pay_verified_count,
              pay_verified_amount: row.pay_verified_amount,
              pay_unverified_count: row.pay_unverified_count,
              pay_unverified_amount: row.pay_unverified_amount,
              ar_verified_count: row.ar_verified_count,
              ar_verified_amount: row.ar_verified_amount,
              ar_unverified_count: row.ar_unverified_count,
              ar_unverified_amount: row.ar_unverified_amount,
            })),
            activity_mix: [
              { name: 'New Enrollees', value: totals.new_enrollees },
              { name: 'AR Sales', value: totals.ar_sales_count },
              { name: 'Merchandise Released', value: totals.merchandise_released_quantity },
              { name: 'Re-enrollment', value: totals.re_enrollment_count },
              { name: 'Dropped / Unenrolled', value: totals.dropped_unenrolled_count },
            ],
            sales_last_7_days: salesLast7Days,
          },
          branches,
          selected_branch_id: branchFilter,
          updated_at: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error('Error fetching daily operational dashboard:', error);
      next(error);
    }
  }
);

/**
 * GET /api/sms/dashboard/enrollment
 * Enrollment dashboard: active/inactive students, reserved-only, monthly enrollments, charts data.
 * Active = student with at least one enrollment where enrollment_status = 'Active' and removed_at IS NULL.
 * Inactive = student with no active enrollments (includes reserved-only and never enrolled).
 * Access: Superadmin, Admin, Finance (Admin/Finance see their branch only)
 */
router.get(
  '/enrollment',
  [
    queryValidator('branch_id').optional().isInt().withMessage('Branch ID must be an integer'),
    queryValidator('month').optional().matches(/^\d{4}-\d{2}$/).withMessage('month must be YYYY-MM'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Finance'),
  async (req, res, next) => {
    try {
      const isSuperadmin = req.user.userType === 'Superadmin';
      const isFinanceNoBranch = req.user.userType === 'Finance' && (req.user.branchId == null);
      const monthRange = parseMonthRange(req.query.month);
      if (monthRange && monthRange.key > getCurrentManilaMonthKey()) {
        return res.status(400).json({
          success: false,
          message: 'month cannot be in the future',
        });
      }
      const branchFilter = isSuperadmin || isFinanceNoBranch
        ? (req.query.branch_id ? parseInt(req.query.branch_id, 10) : null)
        : (req.user.branchId || null);
      const branchParams = branchFilter ? [branchFilter] : [];
      const monthStartDate = monthRange?.start || null;
      const monthEndDate = monthRange?.end || null;

      const studentWhere = branchFilter
        ? 'WHERE u.user_type = \'Student\' AND u.branch_id = $1'
        : 'WHERE u.user_type = \'Student\'';
      const activeEnrollment = "COALESCE(cs.enrollment_status, 'Active') = 'Active' AND cs.removed_at IS NULL";

      // KPI cards: always system snapshot (not month-scoped). Month only affects the enrollments trend chart.
      const totalStudentsResult = await query(
        `SELECT COUNT(*) AS count FROM userstbl u ${studentWhere}`,
        branchParams
      );
      const totalStudents = parseInt(totalStudentsResult.rows[0]?.count, 10) || 0;

      const activeQuery = branchFilter
        ? `
          SELECT COUNT(DISTINCT cs.student_id) AS count
          FROM classstudentstbl cs
          INNER JOIN classestbl c ON cs.class_id = c.class_id AND c.branch_id = $1
          WHERE ${activeEnrollment}
        `
        : `
          SELECT COUNT(DISTINCT cs.student_id) AS count
          FROM classstudentstbl cs
          INNER JOIN classestbl c ON cs.class_id = c.class_id
          WHERE ${activeEnrollment}
        `;
      const activeResult = await query(activeQuery, branchParams);
      const activeStudents = parseInt(activeResult.rows[0]?.count, 10) || 0;
      const inactiveStudents = Math.max(0, totalStudents - activeStudents);

      // Re-enrollment: more than one classstudent row for the same (student, class) = enrolled again in that class.
      // Rate = active students who have at least one such same-class re-enrollment / all active students.
      const reEnrollmentQuery = branchFilter
        ? `
          WITH enrollment_rows AS (
            SELECT cs.student_id, cs.class_id
            FROM classstudentstbl cs
            INNER JOIN classestbl c ON cs.class_id = c.class_id
            WHERE c.branch_id = $1
          ),
          reenrollment_pairs AS (
            SELECT student_id, class_id
            FROM enrollment_rows
            GROUP BY student_id, class_id
            HAVING COUNT(*) > 1
          ),
          active_students AS (
            SELECT DISTINCT cs.student_id
            FROM classstudentstbl cs
            INNER JOIN classestbl c ON cs.class_id = c.class_id AND c.branch_id = $1
            WHERE ${activeEnrollment}
          )
          SELECT
            (
              SELECT COUNT(DISTINCT rp.student_id)
              FROM reenrollment_pairs rp
              INNER JOIN active_students a ON a.student_id = rp.student_id
            )::int AS reenrolled_active_count
        `
        : `
          WITH enrollment_rows AS (
            SELECT cs.student_id, cs.class_id
            FROM classstudentstbl cs
            INNER JOIN classestbl c ON cs.class_id = c.class_id
          ),
          reenrollment_pairs AS (
            SELECT student_id, class_id
            FROM enrollment_rows
            GROUP BY student_id, class_id
            HAVING COUNT(*) > 1
          ),
          active_students AS (
            SELECT DISTINCT cs.student_id
            FROM classstudentstbl cs
            INNER JOIN classestbl c ON cs.class_id = c.class_id
            WHERE ${activeEnrollment}
          )
          SELECT
            (
              SELECT COUNT(DISTINCT rp.student_id)
              FROM reenrollment_pairs rp
              INNER JOIN active_students a ON a.student_id = rp.student_id
            )::int AS reenrolled_active_count
        `;
      const reEnrollmentResult = await query(reEnrollmentQuery, branchParams);
      const reEnrollmentCount = parseInt(reEnrollmentResult.rows[0]?.reenrolled_active_count, 10) || 0;
      const reEnrollmentBaseStudents = activeStudents;
      const enrollmentRate = totalStudents > 0
        ? Number(((activeStudents / totalStudents) * 100).toFixed(2))
        : 0;
      const reEnrollmentRate = reEnrollmentBaseStudents > 0
        ? Number(((reEnrollmentCount / reEnrollmentBaseStudents) * 100).toFixed(2))
        : 0;

      // Reserved-only: at least one reservation, no current active enrollment (not month-scoped)
      const reservedOnlyQuery = branchFilter
        ? `
          SELECT COUNT(DISTINCT r.student_id) AS count
          FROM reservedstudentstbl r
          WHERE r.branch_id = $1
            AND r.status = 'Reserved'
            AND NOT EXISTS (
              SELECT 1 FROM classstudentstbl cs
              INNER JOIN classestbl c ON cs.class_id = c.class_id AND c.branch_id = r.branch_id
              WHERE cs.student_id = r.student_id
                AND ${activeEnrollment}
            )
        `
        : `
          SELECT COUNT(DISTINCT r.student_id) AS count
          FROM reservedstudentstbl r
          WHERE r.status = 'Reserved'
            AND NOT EXISTS (
              SELECT 1 FROM classstudentstbl cs
              INNER JOIN classestbl c ON cs.class_id = c.class_id
              WHERE cs.student_id = r.student_id
                AND ${activeEnrollment}
            )
        `;
      const reservedOnlyResult = await query(reservedOnlyQuery, branchParams);
      const reservedOnlyCount = parseInt(reservedOnlyResult.rows[0]?.count, 10) || 0;

      // Monthly enrollments (last 6 months) for bar chart
      const monthSequence = buildMonthSequence(6, monthRange?.anchorDate || new Date());
      const monthKeys = monthSequence.map((m) => m.key);
      const enrollmentsByMonthQuery = branchFilter
        ? `
          SELECT TO_CHAR(DATE_TRUNC('month', cs.enrolled_at), 'YYYY-MM') AS month, COUNT(*) AS count
          FROM classstudentstbl cs
          INNER JOIN classestbl c ON cs.class_id = c.class_id AND c.branch_id = $1
          WHERE cs.enrolled_at >= ${
            monthStartDate ? '($2::date - INTERVAL \'5 months\')' : "DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'"
          }
            ${monthStartDate ? 'AND cs.enrolled_at < $3::date' : ''}
          GROUP BY 1 ORDER BY 1
        `
        : `
          SELECT TO_CHAR(DATE_TRUNC('month', cs.enrolled_at), 'YYYY-MM') AS month, COUNT(*) AS count
          FROM classstudentstbl cs
          INNER JOIN classestbl c ON cs.class_id = c.class_id
          WHERE cs.enrolled_at >= ${
            monthStartDate ? '($1::date - INTERVAL \'5 months\')' : "DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'"
          }
            ${monthStartDate ? 'AND cs.enrolled_at < $2::date' : ''}
          GROUP BY 1 ORDER BY 1
        `;
      const enrollmentsByMonthParams = branchFilter
        ? (monthStartDate ? [...branchParams, monthStartDate, monthEndDate] : branchParams)
        : (monthStartDate ? [monthStartDate, monthEndDate] : []);
      const enrollmentsByMonthResult = await query(enrollmentsByMonthQuery, enrollmentsByMonthParams);
      const enrollmentMap = enrollmentsByMonthResult.rows.reduce((acc, row) => {
        acc[row.month] = parseInt(row.count, 10);
        return acc;
      }, {});
      const monthly_enrollments = monthSequence.map((m) => ({
        month: m.label,
        count: enrollmentMap[m.key] || 0,
      }));

      // Active vs Inactive by branch (bar chart when no branch filter; same snapshot as KPI cards)
      let active_inactive_by_branch = [];
      if (!branchFilter) {
        const byBranchQuery = `
          SELECT
            b.branch_id,
            COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
            COUNT(DISTINCT u.user_id) AS total,
            COUNT(DISTINCT CASE WHEN EXISTS (
              SELECT 1 FROM classstudentstbl cs
              INNER JOIN classestbl c ON cs.class_id = c.class_id AND c.branch_id = b.branch_id
              WHERE cs.student_id = u.user_id AND ${activeEnrollment}
            ) THEN u.user_id END) AS active_count
          FROM branchestbl b
          LEFT JOIN userstbl u ON u.branch_id = b.branch_id AND u.user_type = 'Student'
          GROUP BY b.branch_id, b.branch_nickname, b.branch_name
          ORDER BY COALESCE(b.branch_nickname, b.branch_name)
        `;
        const byBranchResult = await query(byBranchQuery);
        active_inactive_by_branch = byBranchResult.rows.map((row) => ({
          branch_id: row.branch_id,
          branch_name: row.branch_name || 'Unassigned',
          total: parseInt(row.total, 10) || 0,
          active: parseInt(row.active_count, 10) || 0,
          inactive: Math.max(0, (parseInt(row.total, 10) || 0) - (parseInt(row.active_count, 10) || 0)),
        }));
      }

      // Branches list for filter
      const branchesResult = await query(`
        SELECT branch_id, COALESCE(branch_nickname, branch_name) AS branch_name
        FROM branchestbl ORDER BY COALESCE(branch_nickname, branch_name)
      `);

      res.json({
        success: true,
        data: {
          total_students: totalStudents,
          active_students: activeStudents,
          inactive_students: inactiveStudents,
          enrollment_rate: enrollmentRate,
          re_enrollment_count: reEnrollmentCount,
          re_enrollment_base_students: reEnrollmentBaseStudents,
          re_enrollment_rate: reEnrollmentRate,
          reserved_only_count: reservedOnlyCount,
          monthly_enrollments,
          active_inactive_by_branch,
          branches: branchesResult.rows.map((r) => ({ branch_id: r.branch_id, branch_name: r.branch_name })),
          selected_month: monthRange?.key || null,
          selected_branch_id: branchFilter,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/sms/dashboard/cohort-retention
 * Get cohort retention analysis (students grouped by enrollment month, tracked over time)
 * Access: Superadmin, Admin, Finance
 */
router.get(
  '/cohort-retention',
  [
    queryValidator('branch_id').optional().isInt().withMessage('Branch ID must be an integer'),
    queryValidator('teacher_id').optional().isInt().withMessage('Teacher ID must be an integer'),
    queryValidator('room_id').optional().isInt().withMessage('Room ID must be an integer'),
    queryValidator('program_id').optional().isInt().withMessage('Program ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Finance'),
  async (req, res, next) => {
    try {
      const { branch_id, teacher_id, room_id, program_id } = req.query;

      // Build filter conditions
      const filterConditions = [];
      const filterParams = [];
      let paramCount = 0;

      if (branch_id) {
        paramCount++;
        filterConditions.push(`c.branch_id = $${paramCount}`);
        filterParams.push(parseInt(branch_id, 10));
      } else if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        // For non-superadmin, filter by their branch
        paramCount++;
        filterConditions.push(`c.branch_id = $${paramCount}`);
        filterParams.push(req.user.branchId);
      }

      if (teacher_id) {
        paramCount++;
        filterConditions.push(`c.teacher_id = $${paramCount}`);
        filterParams.push(parseInt(teacher_id, 10));
      }

      if (room_id) {
        paramCount++;
        filterConditions.push(`c.room_id = $${paramCount}`);
        filterParams.push(parseInt(room_id, 10));
      }

      if (program_id) {
        paramCount++;
        filterConditions.push(`c.program_id = $${paramCount}`);
        filterParams.push(parseInt(program_id, 10));
      }

      const filterWhere = filterConditions.length > 0
        ? `AND ${filterConditions.join(' AND ')}`
        : '';

      // Cohort retention:
      // - Cohort month = student's first enrollment month (paid enrollment flow creates classstudent row)
      // - Retention at month M = % of that original cohort with at least one enrollment record in month M
      // This aligns with standard cohort analysis where denominator is fixed at cohort start.
      const cohortsQuery = `
        WITH filtered_enrollments AS (
          SELECT 
            cs.student_id,
            DATE_TRUNC('month', cs.enrolled_at)::date AS enrollment_month
          FROM classstudentstbl cs
          INNER JOIN classestbl c ON cs.class_id = c.class_id
          WHERE cs.enrolled_at IS NOT NULL ${filterWhere}
        ),
        student_first_enrollment AS (
          SELECT
            fe.student_id,
            MIN(fe.enrollment_month)::date AS cohort_month
          FROM filtered_enrollments fe
          GROUP BY fe.student_id
        ),
        cohort_sizes AS (
          SELECT
            sfe.cohort_month,
            COUNT(DISTINCT sfe.student_id)::int AS cohort_size
          FROM student_first_enrollment sfe
          GROUP BY sfe.cohort_month
        ),
        cohort_activity AS (
          SELECT 
            sfe.cohort_month,
            sfe.student_id,
            fe.enrollment_month AS activity_month
          FROM student_first_enrollment sfe
          INNER JOIN filtered_enrollments fe ON fe.student_id = sfe.student_id
          GROUP BY sfe.cohort_month, sfe.student_id, fe.enrollment_month
        ),
        month_bounds AS (
          SELECT
            MIN(cohort_month)::date AS min_month,
            DATE_TRUNC('month', CURRENT_DATE)::date AS max_month
          FROM cohort_sizes
        ),
        month_grid AS (
          SELECT generate_series(mb.min_month, mb.max_month, interval '1 month')::date AS activity_month
          FROM month_bounds mb
          WHERE mb.min_month IS NOT NULL
        ),
        cohort_month_matrix AS (
          SELECT
            cs.cohort_month,
            mg.activity_month
          FROM cohort_sizes cs
          INNER JOIN month_grid mg ON mg.activity_month >= cs.cohort_month
        ),
        retention_counts AS (
          SELECT
            cmm.cohort_month,
            cmm.activity_month,
            cs.cohort_size,
            COUNT(DISTINCT ca.student_id)::int AS retained_count
          FROM cohort_month_matrix cmm
          INNER JOIN cohort_sizes cs ON cs.cohort_month = cmm.cohort_month
          LEFT JOIN cohort_activity ca
            ON ca.cohort_month = cmm.cohort_month
           AND ca.activity_month = cmm.activity_month
          GROUP BY cmm.cohort_month, cmm.activity_month, cs.cohort_size
        )
        SELECT 
          TO_CHAR(cohort_month, 'Mon YYYY') AS cohort_label,
          cohort_month,
          TO_CHAR(activity_month, 'Mon YYYY') AS activity_label,
          activity_month,
          retained_count AS active_count,
          cohort_size
        FROM retention_counts
        ORDER BY cohort_month, activity_month;
      `;

      const result = await query(cohortsQuery, filterParams);

      // Transform to cohort structure: { cohort: 'Jan 2025', months: { 'Jan 2025': {active, total, pct}, 'Feb 2025': {...}, ... } }
      const cohortMap = {};
      for (const row of result.rows) {
        const cohortLabel = row.cohort_label;
        const activityLabel = row.activity_label;
        const activeCount = parseInt(row.active_count, 10);
        const cohortSize = parseInt(row.cohort_size, 10);
        const percentage = cohortSize > 0 ? ((activeCount / cohortSize) * 100).toFixed(1) : '0.0';

        if (!cohortMap[cohortLabel]) {
          cohortMap[cohortLabel] = {
            cohort_month: row.cohort_month,
            cohort_label: cohortLabel,
            total: cohortSize,
            months: {},
          };
        }

        cohortMap[cohortLabel].months[activityLabel] = {
          active: activeCount,
          total: cohortSize,
          percentage: parseFloat(percentage),
        };
      }

      const cohorts = Object.values(cohortMap);

      res.json({
        success: true,
        data: {
          cohorts,
        },
      });
    } catch (error) {
      console.error('Error fetching cohort retention:', error);
      next(error);
    }
  }
);

/**
 * GET /api/sms/dashboard/operational-summary
 * Returns: students per class, students per teacher, students per room (active enrollments only)
 * Access: Superadmin, Admin, Finance
 */
router.get(
  '/operational-summary',
  [
    queryValidator('branch_id').optional().isInt().withMessage('Branch ID must be an integer'),
    queryValidator('teacher_id').optional().isInt().withMessage('Teacher ID must be an integer'),
    queryValidator('room_id').optional().isInt().withMessage('Room ID must be an integer'),
    queryValidator('program_id').optional().isInt().withMessage('Program ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Finance'),
  async (req, res, next) => {
    try {
      const { branch_id, teacher_id, room_id, program_id } = req.query;

      const filterConditions = [];
      const filterParams = [];
      let paramCount = 0;

      if (branch_id) {
        paramCount++;
        filterConditions.push(`c.branch_id = $${paramCount}`);
        filterParams.push(parseInt(branch_id, 10));
      } else if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        paramCount++;
        filterConditions.push(`c.branch_id = $${paramCount}`);
        filterParams.push(req.user.branchId);
      }

      if (teacher_id) {
        paramCount++;
        filterConditions.push(`c.teacher_id = $${paramCount}`);
        filterParams.push(parseInt(teacher_id, 10));
      }

      if (room_id) {
        paramCount++;
        filterConditions.push(`c.room_id = $${paramCount}`);
        filterParams.push(parseInt(room_id, 10));
      }

      if (program_id) {
        paramCount++;
        filterConditions.push(`c.program_id = $${paramCount}`);
        filterParams.push(parseInt(program_id, 10));
      }

      const filterWhere = filterConditions.length > 0
        ? `AND ${filterConditions.join(' AND ')}`
        : '';

      const activeEnrollment = `cs.enrollment_status = 'Active' AND cs.removed_at IS NULL`;

      const [perClassResult, perTeacherResult, perRoomResult] = await Promise.all([
        query(
          `SELECT c.class_id, c.class_name, c.level_tag, p.program_name, c.branch_id,
                  COUNT(DISTINCT cs.student_id) AS student_count
           FROM classestbl c
           LEFT JOIN classstudentstbl cs ON c.class_id = cs.class_id AND ${activeEnrollment}
           LEFT JOIN programstbl p ON c.program_id = p.program_id
           WHERE 1=1 ${filterWhere}
           GROUP BY c.class_id, c.class_name, c.level_tag, p.program_name, c.branch_id
           ORDER BY student_count DESC`,
          filterParams
        ),
        query(
          `SELECT c.teacher_id, u.full_name AS teacher_name, COUNT(DISTINCT cs.student_id) AS student_count
           FROM classestbl c
           INNER JOIN classstudentstbl cs ON c.class_id = cs.class_id AND ${activeEnrollment}
           LEFT JOIN userstbl u ON c.teacher_id = u.user_id
           WHERE 1=1 ${filterWhere}
           GROUP BY c.teacher_id, u.full_name
           ORDER BY student_count DESC`,
          filterParams
        ),
        query(
          `SELECT c.room_id, r.room_name, COUNT(DISTINCT cs.student_id) AS student_count
           FROM classestbl c
           INNER JOIN classstudentstbl cs ON c.class_id = cs.class_id AND ${activeEnrollment}
           LEFT JOIN roomstbl r ON c.room_id = r.room_id
           WHERE 1=1 ${filterWhere}
           GROUP BY c.room_id, r.room_name
           ORDER BY student_count DESC`,
          filterParams
        ),
      ]);

      res.json({
        success: true,
        data: {
          studentsPerClass: perClassResult.rows.map((row) => ({
            class_id: row.class_id,
            class_name: row.class_name || row.level_tag || `Class ${row.class_id}`,
            level_tag: row.level_tag,
            program_name: row.program_name,
            branch_id: row.branch_id,
            student_count: parseInt(row.student_count, 10) || 0,
          })),
          studentsPerTeacher: perTeacherResult.rows.map((row) => ({
            teacher_id: row.teacher_id,
            teacher_name: row.teacher_name || `Teacher ${row.teacher_id}`,
            student_count: parseInt(row.student_count, 10) || 0,
          })),
          studentsPerRoom: perRoomResult.rows.map((row) => ({
            room_id: row.room_id,
            room_name: row.room_name || `Room ${row.room_id}`,
            student_count: parseInt(row.student_count, 10) || 0,
          })),
        },
      });
    } catch (error) {
      console.error('Error fetching operational summary:', error);
      next(error);
    }
  }
);

export default router;

