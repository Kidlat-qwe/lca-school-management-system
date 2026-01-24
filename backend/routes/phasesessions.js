import express from 'express';
import { body, param, query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query } from '../config/database.js';

const router = express.Router();

router.use(verifyFirebaseToken);

/**
 * GET /api/sms/phasesessions
 * Get all phase sessions (with optional curriculum_id filter)
 * Access: All authenticated users
 */
router.get(
  '/',
  [
    queryValidator('curriculum_id').optional().isInt({ min: 1 }).withMessage('Curriculum ID must be a positive integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { curriculum_id } = req.query;

      let sql = 'SELECT * FROM phasesessionstbl';
      const params = [];

      if (curriculum_id) {
        sql += ' WHERE curriculum_id = $1';
        params.push(curriculum_id);
      }

      sql += ' ORDER BY curriculum_id, phase_number, phase_session_number';

      const result = await query(sql, params);

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
 * GET /api/sms/phasesessions/:id
 * Get phase session by ID
 * Access: All authenticated users
 */
router.get(
  '/:id',
  [
    param('id').isInt().withMessage('Phase session ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const result = await query('SELECT * FROM phasesessionstbl WHERE phasesessiondetail_id = $1', [id]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Phase session not found',
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
 * POST /api/sms/phasesessions
 * Create new phase session
 * Access: Superadmin, Admin
 */
router.post(
  '/',
  [
    body('curriculum_id').isInt({ min: 1 }).withMessage('Curriculum ID is required and must be a positive integer'),
    body('phase_number').isInt({ min: 1 }).withMessage('Phase number is required and must be a positive integer'),
    body('phase_session_number').isInt({ min: 1 }).withMessage('Phase session number is required and must be a positive integer'),
    body('topic').optional().trim(),
    body('goal').optional().trim(),
    body('agenda').optional().trim(),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { curriculum_id, phase_number, phase_session_number, topic, goal, agenda } = req.body;

      // Check if curriculum exists
      const curriculumCheck = await query('SELECT * FROM curriculumstbl WHERE curriculum_id = $1', [curriculum_id]);
      if (curriculumCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Curriculum not found',
        });
      }

      // Check for duplicate phase/session combination for this curriculum
      const duplicateCheck = await query(
        'SELECT * FROM phasesessionstbl WHERE curriculum_id = $1 AND phase_number = $2 AND phase_session_number = $3',
        [curriculum_id, phase_number, phase_session_number]
      );

      if (duplicateCheck.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'A phase session with this phase number and session number already exists for this curriculum',
        });
      }

      const result = await query(
        `INSERT INTO phasesessionstbl (curriculum_id, phase_number, phase_session_number, topic, goal, agenda)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          curriculum_id,
          phase_number,
          phase_session_number,
          topic || null,
          goal || null,
          agenda || null,
        ]
      );

      res.status(201).json({
        success: true,
        message: 'Phase session created successfully',
        data: result.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/sms/phasesessions/:id
 * Update phase session
 * Access: Superadmin, Admin
 */
router.put(
  '/:id',
  [
    param('id').isInt().withMessage('Phase session ID must be an integer'),
    body('curriculum_id').optional().isInt({ min: 1 }).withMessage('Curriculum ID must be a positive integer'),
    body('phase_number').optional().isInt({ min: 1 }).withMessage('Phase number must be a positive integer'),
    body('phase_session_number').optional().isInt({ min: 1 }).withMessage('Phase session number must be a positive integer'),
    body('topic').optional().trim(),
    body('goal').optional().trim(),
    body('agenda').optional().trim(),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { curriculum_id, phase_number, phase_session_number, topic, goal, agenda } = req.body;

      const existing = await query('SELECT * FROM phasesessionstbl WHERE phasesessiondetail_id = $1', [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Phase session not found',
        });
      }

      // If phase_number or phase_session_number is being updated, check for duplicates
      if (phase_number !== undefined || phase_session_number !== undefined) {
        const currentCurriculumId = curriculum_id || existing.rows[0].curriculum_id;
        const currentPhaseNumber = phase_number || existing.rows[0].phase_number;
        const currentSessionNumber = phase_session_number || existing.rows[0].phase_session_number;

        const duplicateCheck = await query(
          'SELECT * FROM phasesessionstbl WHERE curriculum_id = $1 AND phase_number = $2 AND phase_session_number = $3 AND phasesessiondetail_id != $4',
          [currentCurriculumId, currentPhaseNumber, currentSessionNumber, id]
        );

        if (duplicateCheck.rows.length > 0) {
          return res.status(400).json({
            success: false,
            message: 'A phase session with this phase number and session number already exists for this curriculum',
          });
        }
      }

      // If curriculum_id is being updated, verify it exists
      if (curriculum_id !== undefined) {
        const curriculumCheck = await query('SELECT * FROM curriculumstbl WHERE curriculum_id = $1', [curriculum_id]);
        if (curriculumCheck.rows.length === 0) {
          return res.status(404).json({
            success: false,
            message: 'Curriculum not found',
          });
        }
      }

      const updates = [];
      const params = [];
      let paramCount = 0;

      const fields = {
        curriculum_id,
        phase_number,
        phase_session_number,
        topic: topic === '' ? null : topic,
        goal: goal === '' ? null : goal,
        agenda: agenda === '' ? null : agenda,
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

      const sql = `UPDATE phasesessionstbl SET ${updates.join(', ')} WHERE phasesessiondetail_id = $${paramCount} RETURNING *`;
      const result = await query(sql, params);

      res.json({
        success: true,
        message: 'Phase session updated successfully',
        data: result.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/sms/phasesessions/:id
 * Delete phase session
 * Access: Superadmin, Admin
 */
router.delete(
  '/:id',
  [
    param('id').isInt().withMessage('Phase session ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const existing = await query('SELECT * FROM phasesessionstbl WHERE phasesessiondetail_id = $1', [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Phase session not found',
        });
      }

      await query('DELETE FROM phasesessionstbl WHERE phasesessiondetail_id = $1', [id]);

      res.json({
        success: true,
        message: 'Phase session deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;

