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

export default router;
