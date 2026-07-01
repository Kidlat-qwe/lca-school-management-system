import express from 'express';
import { body, param, query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query } from '../config/database.js';

const router = express.Router();

router.use(verifyFirebaseToken);

/**
 * GET /api/sms/curriculum
 * Get all curricula
 * Access: All authenticated users
 */
router.get(
  '/',
  [
    queryValidator('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    queryValidator('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { page = 1, limit = 20 } = req.query;
      const offset = (page - 1) * limit;

      const result = await query(
        'SELECT * FROM curriculumstbl ORDER BY curriculum_id DESC LIMIT $1 OFFSET $2',
        [limit, offset]
      );

      const countResult = await query('SELECT COUNT(*) FROM curriculumstbl');
      const total = parseInt(countResult.rows[0].count);

      res.json({
        success: true,
        data: result.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/sms/curriculum/:id
 * Get curriculum by ID
 * Access: All authenticated users
 */
router.get(
  '/:id',
  [
    param('id').isInt().withMessage('Curriculum ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const result = await query('SELECT * FROM curriculumstbl WHERE curriculum_id = $1', [id]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Curriculum not found',
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
 * POST /api/sms/curriculum
 * Create new curriculum
 * Access: Superadmin, Admin
 */
router.post(
  '/',
  [
    body('curriculum_name').notEmpty().withMessage('Curriculum name is required'),
    body('number_of_phase').optional().isInt({ min: 1 }),
    body('number_of_session_per_phase').optional().isInt({ min: 1 }),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { curriculum_name, number_of_phase, number_of_session_per_phase, status } = req.body;

      // Convert empty strings to null for optional fields
      const phaseValue = number_of_phase === '' ? null : (number_of_phase || null);
      const sessionValue = number_of_session_per_phase === '' ? null : (number_of_session_per_phase || null);

      const result = await query(
        `INSERT INTO curriculumstbl (curriculum_name, number_of_phase, number_of_session_per_phase, status)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [curriculum_name, phaseValue, sessionValue, status || 'Active']
      );

      res.status(201).json({
        success: true,
        message: 'Curriculum created successfully',
        data: result.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/sms/curriculum/:id
 * Update curriculum
 * Access: Superadmin, Admin
 */
router.put(
  '/:id',
  [
    param('id').isInt().withMessage('Curriculum ID must be an integer'),
    body('curriculum_name').optional().notEmpty().withMessage('Curriculum name cannot be empty'),
    body('number_of_phase').optional().isInt({ min: 1 }).withMessage('Number of phases must be a positive integer'),
    body('number_of_session_per_phase').optional().isInt({ min: 1 }).withMessage('Number of sessions per phase must be a positive integer'),
    body('status').optional().isIn(['Active', 'Inactive']).withMessage('Status must be Active or Inactive'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { curriculum_name, number_of_phase, number_of_session_per_phase, status } = req.body;

      const existing = await query('SELECT * FROM curriculumstbl WHERE curriculum_id = $1', [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Curriculum not found' });
      }

      const updates = [];
      const params = [];
      let paramCount = 0;

      // Convert empty strings to null for optional fields
      const fields = {
        curriculum_name,
        number_of_phase: number_of_phase === '' ? null : number_of_phase,
        number_of_session_per_phase: number_of_session_per_phase === '' ? null : number_of_session_per_phase,
        status,
      };

      Object.entries(fields).forEach(([key, value]) => {
        if (value !== undefined) {
          paramCount++;
          updates.push(`${key} = $${paramCount}`);
          params.push(value);
        }
      });

      if (updates.length === 0) {
        return res.status(400).json({ success: false, message: 'No fields to update' });
      }

      paramCount++;
      params.push(id);

      const sql = `UPDATE curriculumstbl SET ${updates.join(', ')} WHERE curriculum_id = $${paramCount} RETURNING *`;
      const result = await query(sql, params);

      res.json({
        success: true,
        message: 'Curriculum updated successfully',
        data: result.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/sms/curriculum/:id
 * Delete curriculum
 * Access: Superadmin, Admin
 */
router.delete(
  '/:id',
  [
    param('id').isInt().withMessage('Curriculum ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const existing = await query('SELECT * FROM curriculumstbl WHERE curriculum_id = $1', [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Curriculum not found',
        });
      }

      await query('DELETE FROM curriculumstbl WHERE curriculum_id = $1', [id]);

      res.json({
        success: true,
        message: 'Curriculum deleted successfully',
      });
    } catch (error) {
      // Check for foreign key constraint violations
      if (error.code === '23503') {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete curriculum. It is being used by one or more programs.',
        });
      }
      next(error);
    }
  }
);

export default router;

