import express from 'express';
import { body, param, query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query } from '../config/database.js';

const router = express.Router();

// All routes require authentication
router.use(verifyFirebaseToken);

/**
 * GET /api/sms/programs
 * Get all programs
 * Access: All authenticated users
 */
router.get(
  '/',
  [
    queryValidator('curriculum_id').optional().isInt().withMessage('Curriculum ID must be an integer'),
    queryValidator('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    queryValidator('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { curriculum_id, page = 1, limit = 20 } = req.query;
      const offset = (page - 1) * limit;

      let sql = `SELECT p.*, c.number_of_phase, c.number_of_session_per_phase, c.curriculum_name
                 FROM programstbl p
                 LEFT JOIN curriculumstbl c ON p.curriculum_id = c.curriculum_id
                 WHERE 1=1`;
      const params = [];
      let paramCount = 0;

      if (curriculum_id) {
        paramCount++;
        sql += ` AND p.curriculum_id = $${paramCount}`;
        params.push(curriculum_id);
      }

      sql += ` ORDER BY p.program_id DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
      params.push(limit, offset);

      const result = await query(sql, params);

      const programs = result.rows;

      // Get total count
      let countSql = 'SELECT COUNT(*) FROM programstbl WHERE 1=1';
      const countParams = [];
      if (curriculum_id) {
        countParams.push(curriculum_id);
        countSql += ' AND curriculum_id = $1';
      }
      const countResult = await query(countSql, countParams);
      const total = parseInt(countResult.rows[0].count);

      res.json({
        success: true,
        data: programs,
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
 * GET /api/sms/programs/:id
 * Get program by ID
 * Access: All authenticated users
 */
router.get(
  '/:id',
  [
    param('id').isInt().withMessage('Program ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const result = await query(
        `SELECT p.*, c.number_of_phase, c.number_of_session_per_phase, c.curriculum_name
         FROM programstbl p
         LEFT JOIN curriculumstbl c ON p.curriculum_id = c.curriculum_id
         WHERE p.program_id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Program not found',
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
 * POST /api/sms/programs
 * Create new program
 * Access: Superadmin, Admin
 */
router.post(
  '/',
  [
    body('program_name').notEmpty().withMessage('Program name is required'),
    body('program_code').optional().isString().withMessage('Program code must be a string'),
    body('curriculum_id').optional().isInt().withMessage('Curriculum ID must be an integer'),
    body('session_duration_hours').optional().isFloat({ min: 0.5, max: 8 }).withMessage('Session duration must be between 0.5 and 8 hours'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { program_name, program_code, curriculum_id, session_duration_hours } = req.body;

      // Verify curriculum exists if provided
      if (curriculum_id) {
        const curriculumCheck = await query('SELECT curriculum_id FROM curriculumstbl WHERE curriculum_id = $1', [curriculum_id]);
        if (curriculumCheck.rows.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'Curriculum not found',
          });
        }
      }

      // Validate session_duration_hours if provided
      if (session_duration_hours !== undefined && session_duration_hours !== null) {
        const numDuration = typeof session_duration_hours === 'string' ? parseFloat(session_duration_hours) : session_duration_hours;
        if (isNaN(numDuration) || numDuration < 0.5 || numDuration > 8) {
          return res.status(400).json({
            success: false,
            message: 'Session duration must be between 0.5 and 8 hours',
          });
        }
      }

      // Convert empty strings to null for optional fields
      const codeValue = program_code === '' ? null : (program_code || null);
      const curriculumValue = curriculum_id === '' ? null : (curriculum_id || null);
      const durationValue = session_duration_hours !== undefined && session_duration_hours !== null && session_duration_hours !== ''
        ? parseFloat(session_duration_hours)
        : null;

      const result = await query(
        `INSERT INTO programstbl (program_name, program_code, curriculum_id, session_duration_hours)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [program_name, codeValue, curriculumValue, durationValue]
      );

      res.status(201).json({
        success: true,
        message: 'Program created successfully',
        data: result.rows[0],
      });
    } catch (error) {
      // Check for unique constraint violation (duplicate program_code)
      if (error.code === '23505' && error.constraint === 'programstbl_program_code_key') {
        return res.status(400).json({
          success: false,
          message: 'A program with this code already exists',
        });
      }
      next(error);
    }
  }
);

/**
 * PUT /api/sms/programs/:id
 * Update program
 * Access: Superadmin, Admin
 */
router.put(
  '/:id',
  [
    param('id').isInt().withMessage('Program ID must be an integer'),
    body('program_name').optional().notEmpty().withMessage('Program name cannot be empty'),
    body('program_code').optional().isString().withMessage('Program code must be a string'),
    body('curriculum_id').optional().isInt().withMessage('Curriculum ID must be an integer'),
    body('session_duration_hours').optional().isFloat({ min: 0.5, max: 8 }).withMessage('Session duration must be between 0.5 and 8 hours'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { program_name, program_code, curriculum_id, session_duration_hours } = req.body;

      const existingProgram = await query('SELECT * FROM programstbl WHERE program_id = $1', [id]);
      if (existingProgram.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Program not found',
        });
      }

      // Verify curriculum exists if provided
      if (curriculum_id && curriculum_id !== '') {
        const curriculumCheck = await query('SELECT curriculum_id FROM curriculumstbl WHERE curriculum_id = $1', [curriculum_id]);
        if (curriculumCheck.rows.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'Curriculum not found',
          });
        }
      }

      // Validate session_duration_hours if provided
      if (session_duration_hours !== undefined && session_duration_hours !== null && session_duration_hours !== '') {
        const numDuration = typeof session_duration_hours === 'string' ? parseFloat(session_duration_hours) : session_duration_hours;
        if (isNaN(numDuration) || numDuration < 0.5 || numDuration > 8) {
          return res.status(400).json({
            success: false,
            message: 'Session duration must be between 0.5 and 8 hours',
          });
        }
      }

      const updates = [];
      const params = [];
      let paramCount = 0;

      // Convert empty strings to null for optional fields
      const fields = {
        program_name,
        program_code: program_code === '' ? null : program_code,
        curriculum_id: curriculum_id === '' ? null : (curriculum_id ? parseInt(curriculum_id) : undefined),
        session_duration_hours: session_duration_hours !== undefined && session_duration_hours !== null && session_duration_hours !== ''
          ? parseFloat(session_duration_hours)
          : (session_duration_hours === null ? null : undefined),
      };

      Object.entries(fields).forEach(([key, value]) => {
        if (value !== undefined) {
          paramCount++;
          updates.push(`${key} = $${paramCount}`);
          params.push(value);
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

      const sql = `UPDATE programstbl SET ${updates.join(', ')} WHERE program_id = $${paramCount} RETURNING *`;
      const result = await query(sql, params);

      res.json({
        success: true,
        message: 'Program updated successfully',
        data: programData,
      });
    } catch (error) {
      // Check for unique constraint violation (duplicate program_code)
      if (error.code === '23505' && error.constraint === 'programstbl_program_code_key') {
        return res.status(400).json({
          success: false,
          message: 'A program with this code already exists',
        });
      }
      next(error);
    }
  }
);

/**
 * DELETE /api/sms/programs/:id
 * Delete program
 * Access: Superadmin, Admin
 */
router.delete(
  '/:id',
  [
    param('id').isInt().withMessage('Program ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const existingProgram = await query('SELECT * FROM programstbl WHERE program_id = $1', [id]);
      if (existingProgram.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Program not found',
        });
      }

      await query('DELETE FROM programstbl WHERE program_id = $1', [id]);

      res.json({
        success: true,
        message: 'Program deleted successfully',
      });
    } catch (error) {
      // Check for foreign key constraint violations
      if (error.code === '23503') {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete program. It is being used by one or more classes.',
        });
      }
      next(error);
    }
  }
);

export default router;

