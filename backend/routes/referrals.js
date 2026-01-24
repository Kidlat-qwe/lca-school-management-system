import express from 'express';
import { body, param, query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole, requireBranchAccess } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query, getClient } from '../config/database.js';

const router = express.Router();

// All routes require authentication
router.use(verifyFirebaseToken);
router.use(requireBranchAccess);

/**
 * GET /api/v1/referrals
 * Get all referrals with filters
 * Access: Superadmin, Admin
 */
router.get(
  '/',
  [
    queryValidator('referrer_student_id').optional().isInt().withMessage('Referrer student ID must be an integer'),
    queryValidator('referred_student_id').optional().isInt().withMessage('Referred student ID must be an integer'),
    queryValidator('status').optional().isIn(['Pending', 'Verified', 'Used']).withMessage('Status must be Pending, Verified, or Used'),
    queryValidator('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    queryValidator('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { referrer_student_id, referred_student_id, status, page = 1, limit = 20 } = req.query;
      const offset = (page - 1) * limit;

      let sql = `
        SELECT 
          r.referral_id,
          r.referrer_student_id,
          r.referred_student_id,
          r.referral_code,
          r.referred_at,
          r.status,
          referrer.full_name as referrer_name,
          referrer.email as referrer_email,
          referred.full_name as referred_name,
          referred.email as referred_email
        FROM referralstbl r
        LEFT JOIN userstbl referrer ON r.referrer_student_id = referrer.user_id
        LEFT JOIN userstbl referred ON r.referred_student_id = referred.user_id
        WHERE 1=1
      `;
      const params = [];
      let paramCount = 0;

      // Filter by referrer
      if (referrer_student_id) {
        paramCount++;
        sql += ` AND r.referrer_student_id = $${paramCount}`;
        params.push(referrer_student_id);
      }

      // Filter by referred
      if (referred_student_id) {
        paramCount++;
        sql += ` AND r.referred_student_id = $${paramCount}`;
        params.push(referred_student_id);
      }

      // Filter by status
      if (status) {
        paramCount++;
        sql += ` AND r.status = $${paramCount}`;
        params.push(status);
      }

      sql += ` ORDER BY r.referred_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
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
 * GET /api/v1/referrals/student/:studentId
 * Get referrals for a student (as referrer or referred)
 */
router.get(
  '/student/:studentId',
  [
    param('studentId').isInt().withMessage('Student ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { studentId } = req.params;

      const result = await query(
        `SELECT 
          r.referral_id,
          r.referrer_student_id,
          r.referred_student_id,
          r.referral_code,
          r.referred_at,
          r.status,
          referrer.full_name as referrer_name,
          referrer.email as referrer_email,
          referred.full_name as referred_name,
          referred.email as referred_email
        FROM referralstbl r
        LEFT JOIN userstbl referrer ON r.referrer_student_id = referrer.user_id
        LEFT JOIN userstbl referred ON r.referred_student_id = referred.user_id
        WHERE r.referrer_student_id = $1 OR r.referred_student_id = $1
        ORDER BY r.referred_at DESC`,
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
 * POST /api/v1/referrals
 * Create referral
 * Access: Superadmin, Admin
 */
router.post(
  '/',
  [
    body('referrer_student_id').isInt().withMessage('Referrer student ID is required'),
    body('referred_student_id').isInt().withMessage('Referred student ID is required'),
    body('referral_code').optional().isString().withMessage('Referral code must be a string'),
    body('status').optional().isIn(['Pending', 'Verified']).withMessage('Status must be Pending or Verified'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { referrer_student_id, referred_student_id, referral_code, status = 'Pending' } = req.body;

      // Validate students exist and are students
      const referrerCheck = await client.query(
        'SELECT user_id, user_type FROM userstbl WHERE user_id = $1',
        [referrer_student_id]
      );
      if (referrerCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Referrer student not found',
        });
      }
      if (referrerCheck.rows[0].user_type !== 'Student') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Referrer is not a student',
        });
      }

      const referredCheck = await client.query(
        'SELECT user_id, user_type FROM userstbl WHERE user_id = $1',
        [referred_student_id]
      );
      if (referredCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Referred student not found',
        });
      }
      if (referredCheck.rows[0].user_type !== 'Student') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Referred user is not a student',
        });
      }

      // Check if student is already referred
      const existingCheck = await client.query(
        'SELECT referral_id FROM referralstbl WHERE referred_student_id = $1',
        [referred_student_id]
      );
      if (existingCheck.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Student has already been referred',
        });
      }

      // Check if referring themselves
      if (referrer_student_id === referred_student_id) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Student cannot refer themselves',
        });
      }

      const result = await client.query(
        `INSERT INTO referralstbl (referrer_student_id, referred_student_id, referral_code, status)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [referrer_student_id, referred_student_id, referral_code || null, status]
      );

      await client.query('COMMIT');

      res.status(201).json({
        success: true,
        message: 'Referral created successfully',
        data: result.rows[0],
      });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally {
      client.release();
    }
  }
);

/**
 * PUT /api/v1/referrals/:id/verify
 * Verify a referral
 * Access: Superadmin, Admin
 */
router.put(
  '/:id/verify',
  [
    param('id').isInt().withMessage('Referral ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const existingReferral = await query('SELECT * FROM referralstbl WHERE referral_id = $1', [id]);
      if (existingReferral.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Referral not found',
        });
      }

      await query(
        'UPDATE referralstbl SET status = $1 WHERE referral_id = $2 RETURNING *',
        ['Verified', id]
      );

      res.json({
        success: true,
        message: 'Referral verified successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/v1/referrals/:id
 * Update referral
 * Access: Superadmin, Admin
 */
router.put(
  '/:id',
  [
    param('id').isInt().withMessage('Referral ID must be an integer'),
    body('status').optional().isIn(['Pending', 'Verified', 'Used']).withMessage('Status must be Pending, Verified, or Used'),
    body('referral_code').optional().isString().withMessage('Referral code must be a string'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { status, referral_code } = req.body;

      const existingReferral = await query('SELECT * FROM referralstbl WHERE referral_id = $1', [id]);
      if (existingReferral.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Referral not found',
        });
      }

      const updates = [];
      const params = [];
      let paramCount = 0;

      if (status !== undefined) {
        paramCount++;
        updates.push(`status = $${paramCount}`);
        params.push(status);
      }

      if (referral_code !== undefined) {
        paramCount++;
        updates.push(`referral_code = $${paramCount}`);
        params.push(referral_code || null);
      }

      if (updates.length > 0) {
        paramCount++;
        params.push(id);
        const sql = `UPDATE referralstbl SET ${updates.join(', ')} WHERE referral_id = $${paramCount} RETURNING *`;
        await query(sql, params);
      }

      res.json({
        success: true,
        message: 'Referral updated successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/v1/referrals/:id
 * Delete referral
 * Access: Superadmin, Admin
 */
router.delete(
  '/:id',
  [
    param('id').isInt().withMessage('Referral ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const existingReferral = await query('SELECT * FROM referralstbl WHERE referral_id = $1', [id]);
      if (existingReferral.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Referral not found',
        });
      }

      await query('DELETE FROM referralstbl WHERE referral_id = $1', [id]);

      res.json({
        success: true,
        message: 'Referral deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;

