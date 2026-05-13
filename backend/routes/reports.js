import express from 'express';
import { query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole, requireBranchAccess } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query } from '../config/database.js';

const router = express.Router();

router.use(verifyFirebaseToken);
router.use(requireBranchAccess);

/**
 * GET /api/sms/reports/students
 * Report: list students with enrollment status (active = enrolled, inactive = registered but not enrolled).
 * Access: Superadmin, Admin.
 * Query: status=all|active|inactive, branch_id (optional, Superadmin only), search, page, limit.
 */
router.get(
  '/students',
  requireRole('Superadmin', 'Admin'),
  [
    queryValidator('status')
      .optional()
      .isIn(['all', 'active', 'inactive'])
      .withMessage('status must be all, active, or inactive'),
    queryValidator('branch_id').optional().isInt().withMessage('branch_id must be an integer'),
    queryValidator('search').optional().isString().withMessage('search must be a string'),
    queryValidator('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    queryValidator('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { status = 'all', branch_id, search, page = 1, limit = 50 } = req.query;
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 50;
      const offset = (pageNum - 1) * limitNum;

      const params = [];
      let paramCount = 0;

      // Base: all students (user_type = 'Student') with computed enrollment status and enrolled class names
      // Active = has at least one row in classstudentstbl with program_enrollment_status IN ('new','re_enrolled','upsell')
      let sql = `
        SELECT
          u.user_id,
          u.full_name,
          u.email,
          u.phone_number,
          u.gender,
          u.branch_id,
          u.level_tag,
          COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
          CASE
            WHEN EXISTS (
              SELECT 1 FROM classstudentstbl cs
              WHERE cs.student_id = u.user_id
                AND cs.program_enrollment_status IN ('new', 're_enrolled', 'upsell')
            ) THEN 'Active'
            ELSE 'Inactive'
          END AS enrollment_status,
          (
            SELECT string_agg(class_label, ', ' ORDER BY class_label)
            FROM (
              SELECT DISTINCT COALESCE(NULLIF(TRIM(c.class_name), ''), 'Class #' || COALESCE(c.class_id, cs.class_id)::text) AS class_label
              FROM classstudentstbl cs
              LEFT JOIN classestbl c ON c.class_id = cs.class_id
              WHERE cs.student_id = u.user_id
                AND cs.program_enrollment_status IN ('new', 're_enrolled', 'upsell')
            ) AS distinct_classes
          ) AS enrolled_classes
        FROM userstbl u
        LEFT JOIN branchestbl b ON u.branch_id = b.branch_id
        WHERE u.user_type = 'Student'
      `;

      // Branch: Superadmin can filter by branch_id; Admin is restricted to their branch
      if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        paramCount++;
        sql += ` AND u.branch_id = $${paramCount}`;
        params.push(req.user.branchId);
      } else if (branch_id) {
        paramCount++;
        sql += ` AND u.branch_id = $${paramCount}`;
        params.push(branch_id);
      }

      // Status filter: active = enrolled, inactive = not enrolled
      if (status === 'active') {
        sql += ` AND EXISTS (
          SELECT 1 FROM classstudentstbl cs
          WHERE cs.student_id = u.user_id
            AND cs.program_enrollment_status IN ('new', 're_enrolled', 'upsell')
        )`;
      } else if (status === 'inactive') {
        sql += ` AND NOT EXISTS (
          SELECT 1 FROM classstudentstbl cs
          WHERE cs.student_id = u.user_id
            AND cs.program_enrollment_status IN ('new', 're_enrolled', 'upsell')
        )`;
      }

      const searchTerm = search ? String(search).trim() : '';
      if (searchTerm) {
        paramCount++;
        sql += ` AND (
          COALESCE(u.full_name, '') ILIKE $${paramCount}
          OR COALESCE(u.email, '') ILIKE $${paramCount}
          OR COALESCE(u.phone_number, '') ILIKE $${paramCount}
          OR COALESCE(u.level_tag, '') ILIKE $${paramCount}
          OR COALESCE(b.branch_nickname, b.branch_name, '') ILIKE $${paramCount}
        )`;
        params.push(`%${searchTerm}%`);
      }

      const orderBy = ' ORDER BY u.full_name ASC';
      const countSql = `SELECT COUNT(*) AS total FROM (${sql}) AS rep`;
      const countResult = await query(countSql, params);
      const total = parseInt(countResult.rows[0].total, 10);

      sql += orderBy + ` LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
      params.push(limitNum, offset);

      const result = await query(sql, params);

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

const REPORT_BASE_VALIDATORS = [
  queryValidator('branch_id').optional().isInt().withMessage('branch_id must be an integer'),
  queryValidator('search').optional().isString().withMessage('search must be a string'),
  queryValidator('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
  queryValidator('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
];

const REPORT_ACTIVE_BRANCH_CLAUSE = (req, branchId, params, paramCount, branchSqlExpression) => {
  let sql = '';
  if (req.user.userType !== 'Superadmin' && req.user.branchId) {
    paramCount++;
    sql += ` AND ${branchSqlExpression} = $${paramCount}`;
    params.push(req.user.branchId);
  } else if (branchId) {
    paramCount++;
    sql += ` AND ${branchSqlExpression} = $${paramCount}`;
    params.push(branchId);
  }
  return { sql, paramCount };
};

/**
 * GET /api/sms/reports/student-status
 * Source table: student_statustbl (one row per student).
 */
router.get(
  '/student-status',
  requireRole('Superadmin', 'Admin'),
  [
    ...REPORT_BASE_VALIDATORS,
    queryValidator('status')
      .optional()
      .isIn(['all', 'active', 'inactive'])
      .withMessage('status must be all, active, or inactive'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { status = 'all', branch_id, search, page = 1, limit = 10 } = req.query;
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 10;
      const offset = (pageNum - 1) * limitNum;
      const searchTerm = String(search || '').trim();

      const params = [];
      let paramCount = 0;
      let whereSql = ` WHERE LOWER(u.user_type) = 'student'`;

      const branchFilter = REPORT_ACTIVE_BRANCH_CLAUSE(req, branch_id, params, paramCount, 'u.branch_id');
      whereSql += branchFilter.sql;
      paramCount = branchFilter.paramCount;

      if (status === 'active' || status === 'inactive') {
        paramCount++;
        whereSql += ` AND base.status = $${paramCount}`;
        params.push(status);
      }

      if (searchTerm) {
        paramCount++;
        whereSql += ` AND (
          COALESCE(base.student_name, u.full_name, '') ILIKE $${paramCount}
          OR COALESCE(u.email, '') ILIKE $${paramCount}
          OR COALESCE(u.level_tag, '') ILIKE $${paramCount}
          OR COALESCE(b.branch_nickname, b.branch_name, '') ILIKE $${paramCount}
        )`;
        params.push(`%${searchTerm}%`);
      }

      const baseSql = `
        SELECT
          base.student_status_id,
          base.student_id AS user_id,
          COALESCE(base.student_name, u.full_name) AS full_name,
          u.email,
          u.level_tag,
          COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
          u.branch_id,
          base.status,
          base.updated_at,
          base.updated_reason
        FROM public.student_statustbl base
        JOIN public.userstbl u ON u.user_id = base.student_id
        LEFT JOIN public.branchestbl b ON b.branch_id = u.branch_id
      `;

      const countResult = await query(`SELECT COUNT(*) AS total FROM (${baseSql} ${whereSql}) t`, params);
      const total = parseInt(countResult.rows[0]?.total || '0', 10);

      const dataSql = `
        ${baseSql}
        ${whereSql}
        ORDER BY COALESCE(base.student_name, u.full_name) ASC
        LIMIT $${paramCount + 1}
        OFFSET $${paramCount + 2}
      `;
      const dataParams = [...params, limitNum, offset];
      const result = await query(dataSql, dataParams);

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
 * GET /api/sms/reports/program-payment-status
 * Source table: program_payment_statustbl (invoice/program payment lifecycle).
 */
router.get(
  '/program-payment-status',
  requireRole('Superadmin', 'Admin'),
  [
    ...REPORT_BASE_VALIDATORS,
    queryValidator('status')
      .optional()
      .isIn(['all', 'wait_for_payment', 'paid', 'under_grace_period', 'due_date'])
      .withMessage('invalid status filter'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { status = 'all', branch_id, search, page = 1, limit = 10 } = req.query;
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 10;
      const offset = (pageNum - 1) * limitNum;
      const searchTerm = String(search || '').trim();

      const params = [];
      let paramCount = 0;
      let whereSql = ' WHERE 1=1';

      const branchFilter = REPORT_ACTIVE_BRANCH_CLAUSE(req, branch_id, params, paramCount, 'base.branch_id');
      whereSql += branchFilter.sql;
      paramCount = branchFilter.paramCount;

      if (status !== 'all') {
        paramCount++;
        whereSql += ` AND base.status = $${paramCount}`;
        params.push(status);
      }

      if (searchTerm) {
        paramCount++;
        whereSql += ` AND (
          COALESCE(u.full_name, '') ILIKE $${paramCount}
          OR COALESCE(u.email, '') ILIKE $${paramCount}
          OR COALESCE(inv.invoice_description, '') ILIKE $${paramCount}
          OR COALESCE(base.invoice_id::text, '') ILIKE $${paramCount}
          OR COALESCE(cls.class_name, '') ILIKE $${paramCount}
          OR COALESCE(b.branch_nickname, b.branch_name, '') ILIKE $${paramCount}
        )`;
        params.push(`%${searchTerm}%`);
      }

      const baseSql = `
        SELECT
          base.program_payment_status_id,
          base.student_id,
          base.class_id,
          base.invoice_id,
          base.branch_id,
          base.installmentinvoiceprofiles_id,
          base.status,
          base.invoice_status_snapshot,
          base.invoice_due_date,
          base.grace_until,
          base.paid_at,
          base.computed_at,
          base.created_at,
          base.updated_at,
          u.full_name,
          u.email,
          u.level_tag,
          COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
          COALESCE(inv.invoice_description, 'INV-' || base.invoice_id::text) AS invoice_description,
          cls.class_name
        FROM public.program_payment_statustbl base
        LEFT JOIN public.userstbl u ON u.user_id = base.student_id
        LEFT JOIN public.branchestbl b ON b.branch_id = base.branch_id
        LEFT JOIN public.invoicestbl inv ON inv.invoice_id = base.invoice_id
        LEFT JOIN public.classestbl cls ON cls.class_id = base.class_id
      `;

      const countResult = await query(`SELECT COUNT(*) AS total FROM (${baseSql} ${whereSql}) t`, params);
      const total = parseInt(countResult.rows[0]?.total || '0', 10);

      const dataSql = `
        ${baseSql}
        ${whereSql}
        ORDER BY base.updated_at DESC, base.program_payment_status_id DESC
        LIMIT $${paramCount + 1}
        OFFSET $${paramCount + 2}
      `;
      const result = await query(dataSql, [...params, limitNum, offset]);

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
 * GET /api/sms/reports/program-enrollment-status
 * Source table: classstudentstbl.program_enrollment_status.
 */
router.get(
  '/program-enrollment-status',
  requireRole('Superadmin', 'Admin'),
  [
    ...REPORT_BASE_VALIDATORS,
    queryValidator('status')
      .optional()
      .isIn(['all', 'reserved', 'pending_enrollment', 'new', 're_enrolled', 'upsell', 'dropped', 'completed'])
      .withMessage('invalid status filter'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { status = 'all', branch_id, search, page = 1, limit = 10 } = req.query;
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 10;
      const offset = (pageNum - 1) * limitNum;
      const searchTerm = String(search || '').trim();

      const params = [];
      let paramCount = 0;
      let whereSql = ' WHERE 1=1';

      const branchFilter = REPORT_ACTIVE_BRANCH_CLAUSE(req, branch_id, params, paramCount, 'COALESCE(cls.branch_id, u.branch_id)');
      whereSql += branchFilter.sql;
      paramCount = branchFilter.paramCount;

      if (status !== 'all') {
        paramCount++;
        whereSql += ` AND base.program_enrollment_status = $${paramCount}`;
        params.push(status);
      }

      if (searchTerm) {
        paramCount++;
        whereSql += ` AND (
          COALESCE(u.full_name, '') ILIKE $${paramCount}
          OR COALESCE(u.email, '') ILIKE $${paramCount}
          OR COALESCE(cls.class_name, '') ILIKE $${paramCount}
          OR COALESCE(u.level_tag, '') ILIKE $${paramCount}
          OR COALESCE(b.branch_nickname, b.branch_name, '') ILIKE $${paramCount}
        )`;
        params.push(`%${searchTerm}%`);
      }

      const baseSql = `
        SELECT
          base.classstudent_id,
          base.student_id,
          base.class_id,
          base.program_enrollment_status,
          base.enrolled_at AS created_at,
          base.removed_at,
          u.full_name,
          u.email,
          u.level_tag,
          u.branch_id,
          COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
          cls.class_name
        FROM public.classstudentstbl base
        LEFT JOIN public.userstbl u ON u.user_id = base.student_id
        LEFT JOIN public.classestbl cls ON cls.class_id = base.class_id
        LEFT JOIN public.branchestbl b ON b.branch_id = COALESCE(cls.branch_id, u.branch_id)
      `;

      const countResult = await query(`SELECT COUNT(*) AS total FROM (${baseSql} ${whereSql}) t`, params);
      const total = parseInt(countResult.rows[0]?.total || '0', 10);

      const dataSql = `
        ${baseSql}
        ${whereSql}
        ORDER BY base.enrolled_at DESC NULLS LAST, base.classstudent_id DESC
        LIMIT $${paramCount + 1}
        OFFSET $${paramCount + 2}
      `;
      const result = await query(dataSql, [...params, limitNum, offset]);

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

export default router;
