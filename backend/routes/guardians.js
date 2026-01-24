import express from 'express';
import { body, param, query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query, getClient } from '../config/database.js';

const router = express.Router();

// All routes require authentication
router.use(verifyFirebaseToken);

/**
 * GET /api/sms/guardians
 * Get all guardians (optionally filtered by student_id)
 * Access: Superadmin, Admin
 */
router.get(
  '/',
  requireRole('Superadmin', 'Admin'),
  [
    queryValidator('student_id').optional().isInt().withMessage('Student ID must be an integer'),
    queryValidator('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    queryValidator('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { student_id, page = 1, limit = 20 } = req.query;
      const offset = (page - 1) * limit;

      let sql = `
        SELECT g.*, u.full_name AS student_name, u.email AS student_email, u.branch_id AS student_branch_id
        FROM guardianstbl g
        LEFT JOIN userstbl u ON g.student_id = u.user_id
        WHERE 1=1`;
      const params = [];
      let paramCount = 0;

      // For non-superadmin users, filter by their branch through students
      if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        paramCount++;
        sql += ` AND u.branch_id = $${paramCount}`;
        params.push(req.user.branchId);
      }

      if (student_id) {
        paramCount++;
        sql += ` AND student_id = $${paramCount}`;
        params.push(student_id);
      }

      sql += ` ORDER BY g.guardian_id DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
      params.push(limit, offset);

      const result = await query(sql, params);

      res.json({
        success: true,
        data: result.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/sms/guardians/:id
 * Get guardian by ID
 */
router.get(
  '/:id',
  [
    param('id').isInt().withMessage('Guardian ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const result = await query(
        `SELECT g.*, u.full_name AS student_name, u.email AS student_email
         FROM guardianstbl g
         LEFT JOIN userstbl u ON g.student_id = u.user_id
         WHERE g.guardian_id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Guardian not found',
        });
      }

      res.json({
        success: true,
        data: result.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/sms/guardians/student/:studentId
 * Get guardians for a specific student
 */
router.get(
  '/student/:studentId',
  [
    param('studentId').isInt().withMessage('Student ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { studentId } = req.params;
      const result = await query(
        `SELECT g.*, u.full_name AS student_name, u.email AS student_email
         FROM guardianstbl g
         LEFT JOIN userstbl u ON g.student_id = u.user_id
         WHERE g.student_id = $1
         ORDER BY g.guardian_id DESC`,
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
 * POST /api/sms/guardians
 * Create new guardian
 * Access: Superadmin, Admin
 */
router.post(
  '/',
  [
    body('student_id').isInt().withMessage('Student ID is required and must be an integer'),
    body('guardian_name').notEmpty().withMessage('Guardian name is required'),
    body('email').optional({ nullable: true, checkFalsy: true }).custom((value) => {
      // Skip validation if value is null, undefined, or empty string
      if (!value || value === null || value === undefined || value === '') {
        return true;
      }
      // Use a simple email regex for validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) {
        throw new Error('Valid email is required if provided');
      }
      return true;
    }),
    body('relationship').optional({ nullable: true, checkFalsy: true }).isString().withMessage('Relationship must be a string'),
    body('guardian_phone_number').optional({ nullable: true, checkFalsy: true }).isString().withMessage('Phone number must be a string'),
    body('gender').optional({ nullable: true, checkFalsy: true }).isIn(['Male', 'Female', 'Other']).withMessage('Invalid gender'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const {
        student_id,
        guardian_name,
        email,
        relationship,
        guardian_phone_number,
        gender,
        address,
        city,
        postal_code,
        country,
        state_province_region,
      } = req.body;

      // Verify student exists
      const studentCheck = await query('SELECT user_id FROM userstbl WHERE user_id = $1', [student_id]);
      if (studentCheck.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Student not found',
        });
      }

      const result = await query(
        `INSERT INTO guardianstbl 
         (student_id, guardian_name, email, relationship, guardian_phone_number, gender, address, city, postal_code, country, state_province_region)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          student_id,
          guardian_name,
          email || null,
          relationship || null,
          guardian_phone_number || null,
          gender || null,
          address || null,
          city || null,
          postal_code || null,
          country || null,
          state_province_region || null,
        ]
      );

      res.status(201).json({
        success: true,
        message: 'Guardian created successfully',
        data: result.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/sms/guardians/:id
 * Update guardian
 * Access: Superadmin, Admin
 */
router.put(
  '/:id',
  [
    param('id').isInt().withMessage('Guardian ID must be an integer'),
    body('guardian_name').optional({ nullable: true }).notEmpty().withMessage('Guardian name cannot be empty'),
    body('email').optional({ nullable: true, checkFalsy: true }).custom((value) => {
      // Skip validation if value is null, undefined, or empty string
      if (!value || value === null || value === undefined || value === '') {
        return true;
      }
      // Use a simple email regex for validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) {
        throw new Error('Valid email is required if provided');
      }
      return true;
    }),
    body('relationship').optional({ nullable: true, checkFalsy: true }).isString().withMessage('Relationship must be a string'),
    body('guardian_phone_number').optional({ nullable: true, checkFalsy: true }).isString().withMessage('Phone number must be a string'),
    body('gender').optional({ nullable: true, checkFalsy: true }).isIn(['Male', 'Female', 'Other']).withMessage('Invalid gender'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const {
        guardian_name,
        email,
        relationship,
        guardian_phone_number,
        gender,
        address,
        city,
        postal_code,
        country,
        state_province_region,
      } = req.body;

      // Check if guardian exists
      const existingGuardian = await query('SELECT * FROM guardianstbl WHERE guardian_id = $1', [id]);
      if (existingGuardian.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Guardian not found',
        });
      }

      // Build update query
      const updates = [];
      const params = [];
      let paramCount = 0;

      const fields = {
        guardian_name,
        email,
        relationship,
        guardian_phone_number,
        gender,
        address,
        city,
        postal_code,
        country,
        state_province_region,
      };

      Object.entries(fields).forEach(([key, value]) => {
        if (value !== undefined) {
          paramCount++;
          updates.push(`${key} = $${paramCount}`);
          params.push(value === '' ? null : value);
        }
      });

      if (updates.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No fields to update',
        });
      }

      paramCount++;
      params.push(id);
      const sql = `UPDATE guardianstbl SET ${updates.join(', ')} WHERE guardian_id = $${paramCount} RETURNING *`;
      
      console.log('🔄 Updating guardian:', { guardian_id: id, updates, params });
      const result = await query(sql, params);
      console.log('✅ Guardian updated:', result.rows[0]);

      res.json({
        success: true,
        message: 'Guardian updated successfully',
        data: result.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/sms/guardians/:id
 * Delete guardian
 * Access: Superadmin, Admin
 */
router.delete(
  '/:id',
  [
    param('id').isInt().withMessage('Guardian ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const existingGuardian = await query('SELECT * FROM guardianstbl WHERE guardian_id = $1', [id]);
      if (existingGuardian.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Guardian not found',
        });
      }

      await query('DELETE FROM guardianstbl WHERE guardian_id = $1', [id]);

      res.json({
        success: true,
        message: 'Guardian deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;

