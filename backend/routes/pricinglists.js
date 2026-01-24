import express from 'express';
import { body, param, query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole, requireBranchAccess } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query } from '../config/database.js';

const router = express.Router();

// All routes require authentication
router.use(verifyFirebaseToken);
router.use(requireBranchAccess);

/**
 * GET /api/sms/pricinglists
 * Get all pricing lists
 * Access: All authenticated users
 */
router.get(
  '/',
  [
    queryValidator('branch_id').optional().isInt().withMessage('Branch ID must be an integer'),
    queryValidator('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    queryValidator('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { branch_id, page = 1, limit = 20 } = req.query;
      const offset = (page - 1) * limit;

      let sql = 'SELECT * FROM pricingliststbl WHERE 1=1';
      const params = [];
      let paramCount = 0;

      // Filter by branch (non-superadmin users are limited to their branch)
      if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        paramCount++;
        sql += ` AND branch_id = $${paramCount}`;
        params.push(req.user.branchId);
      } else if (branch_id) {
        paramCount++;
        sql += ` AND branch_id = $${paramCount}`;
        params.push(branch_id);
      }

      sql += ` ORDER BY pricinglist_id DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
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
 * GET /api/sms/pricinglists/:id
 * Get pricing list by ID
 */
router.get(
  '/:id',
  [
    param('id').isInt().withMessage('Pricing list ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const result = await query('SELECT * FROM pricingliststbl WHERE pricinglist_id = $1', [id]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Pricing list not found',
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
 * POST /api/sms/pricinglists
 * Create new pricing list
 * Access: Superadmin, Admin
 */
router.post(
  '/',
  [
    body('name').notEmpty().withMessage('Name is required'),
    body('level_tag').optional().isString().withMessage('Level tag must be a string'),
    body('price').optional().isFloat({ min: 0 }).withMessage('Price must be a positive number'),
    body('branch_id').optional().isInt().withMessage('Branch ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { name, level_tag, price, branch_id } = req.body;

      // Verify branch exists if provided
      if (branch_id) {
        const branchCheck = await query('SELECT branch_id FROM branchestbl WHERE branch_id = $1', [branch_id]);
        if (branchCheck.rows.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'Branch not found',
          });
        }
      }

      const result = await query(
        `INSERT INTO pricingliststbl (name, level_tag, price, branch_id)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [name, level_tag || null, price || null, branch_id || null]
      );

      res.status(201).json({
        success: true,
        message: 'Pricing list created successfully',
        data: result.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/sms/pricinglists/:id
 * Update pricing list
 * Access: Superadmin, Admin
 */
router.put(
  '/:id',
  [
    param('id').isInt().withMessage('Pricing list ID must be an integer'),
    body('name').optional().notEmpty().withMessage('Name cannot be empty'),
    body('level_tag').optional().isString().withMessage('Level tag must be a string'),
    body('price').optional().isFloat({ min: 0 }).withMessage('Price must be a positive number'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { name, level_tag, price, branch_id } = req.body;

      const existingPricing = await query('SELECT * FROM pricingliststbl WHERE pricinglist_id = $1', [id]);
      if (existingPricing.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Pricing list not found',
        });
      }

      const updates = [];
      const params = [];
      let paramCount = 0;

      const fields = { name, level_tag, price, branch_id };
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

      const sql = `UPDATE pricingliststbl SET ${updates.join(', ')} WHERE pricinglist_id = $${paramCount} RETURNING *`;
      const result = await query(sql, params);

      res.json({
        success: true,
        message: 'Pricing list updated successfully',
        data: result.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/sms/pricinglists/:id
 * Delete pricing list
 * Access: Superadmin, Admin
 */
router.delete(
  '/:id',
  [
    param('id').isInt().withMessage('Pricing list ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const existingPricing = await query('SELECT * FROM pricingliststbl WHERE pricinglist_id = $1', [id]);
      if (existingPricing.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Pricing list not found',
        });
      }

      await query('DELETE FROM pricingliststbl WHERE pricinglist_id = $1', [id]);

      res.json({
        success: true,
        message: 'Pricing list deleted successfully',
      });
    } catch (error) {
      // Check for foreign key constraint violations
      if (error.code === '23503') {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete pricing list. It is being used by one or more packages.',
        });
      }
      next(error);
    }
  }
);

export default router;

