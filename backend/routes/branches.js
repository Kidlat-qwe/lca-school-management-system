import express from 'express';
import { body, param, query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query } from '../config/database.js';

const router = express.Router();

// All routes require authentication
router.use(verifyFirebaseToken);

/**
 * GET /api/sms/branches
 * Get all branches
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
        'SELECT * FROM branchestbl ORDER BY branch_id DESC LIMIT $1 OFFSET $2',
        [limit, offset]
      );

      const countResult = await query('SELECT COUNT(*) FROM branchestbl');
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
 * GET /api/sms/branches/:id
 * Get branch by ID
 * Access: All authenticated users
 */
router.get(
  '/:id',
  [
    param('id').isInt().withMessage('Branch ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const result = await query('SELECT * FROM branchestbl WHERE branch_id = $1', [id]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Branch not found',
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
 * POST /api/sms/branches
 * Create new branch
 * Access: Superadmin, Admin
 */
router.post(
  '/',
  [
    body('branch_name').notEmpty().withMessage('Branch name is required'),
    body('branch_email').optional().isEmail().withMessage('Valid email is required'),
    body('branch_address').optional().isString().withMessage('Address must be a string'),
    body('branch_phone_number').optional().isString().withMessage('Phone number must be a string'),
    body('status').optional().isIn(['Active', 'Inactive']).withMessage('Status must be Active or Inactive'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const {
        branch_name,
        branch_email,
        branch_address,
        branch_phone_number,
        status,
        city,
        postal_code,
        business_registration_number,
        registered_tax_id,
        establishment_date,
        country,
        state_province_region,
        locale,
        currency,
      } = req.body;

      const result = await query(
        `INSERT INTO branchestbl (
          branch_name, branch_email, branch_address, branch_phone_number, status,
          city, postal_code, business_registration_number, registered_tax_id,
          establishment_date, country, state_province_region, locale, currency
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING *`,
        [
          branch_name,
          branch_email || null,
          branch_address || null,
          branch_phone_number || null,
          status || 'Active',
          city || null,
          postal_code || null,
          business_registration_number || null,
          registered_tax_id || null,
          establishment_date || null,
          country || null,
          state_province_region || null,
          locale || null,
          currency || 'PHP',
        ]
      );

      res.status(201).json({
        success: true,
        message: 'Branch created successfully',
        data: result.rows[0],
      });
    } catch (error) {
      // Handle unique constraint violation (e.g., duplicate email)
      if (error.code === '23505') {
        if (error.constraint === 'branchestbl_branch_email_key') {
          return res.status(400).json({
            success: false,
            message: 'A branch with this email already exists',
          });
        }
      }
      next(error);
    }
  }
);

/**
 * PUT /api/sms/branches/:id
 * Update branch
 * Access: Superadmin, Admin
 */
router.put(
  '/:id',
  [
    param('id').isInt().withMessage('Branch ID must be an integer'),
    body('branch_name').optional().notEmpty().withMessage('Branch name cannot be empty'),
    body('branch_email').optional().isEmail().withMessage('Valid email is required'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const {
        branch_name,
        branch_email,
        branch_address,
        branch_phone_number,
        status,
        city,
        postal_code,
        business_registration_number,
        registered_tax_id,
        establishment_date,
        country,
        state_province_region,
        locale,
        currency,
      } = req.body;

      // Check if branch exists
      const existingBranch = await query('SELECT * FROM branchestbl WHERE branch_id = $1', [id]);
      if (existingBranch.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Branch not found',
        });
      }

      // Build update query dynamically
      const updates = [];
      const params = [];
      let paramCount = 0;

      const fields = {
        branch_name,
        branch_email,
        branch_address,
        branch_phone_number,
        status,
        city,
        postal_code,
        business_registration_number,
        registered_tax_id,
        establishment_date,
        country,
        state_province_region,
        locale,
        currency,
      };

      Object.entries(fields).forEach(([key, value]) => {
        if (value !== undefined) {
          paramCount++;
          updates.push(`${key} = $${paramCount}`);
          // Convert empty strings to null for optional fields (except branch_name which is required)
          const optionalFields = ['branch_email', 'branch_address', 'branch_phone_number', 'city', 'postal_code', 
                                  'business_registration_number', 'registered_tax_id', 'establishment_date', 
                                  'country', 'state_province_region', 'locale', 'currency'];
          if (optionalFields.includes(key) && value === '') {
            params.push(null);
          } else {
            params.push(value);
          }
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

      const sql = `UPDATE branchestbl SET ${updates.join(', ')} WHERE branch_id = $${paramCount} RETURNING *`;
      const result = await query(sql, params);

      res.json({
        success: true,
        message: 'Branch updated successfully',
        data: result.rows[0],
      });
    } catch (error) {
      // Handle unique constraint violation (e.g., duplicate email)
      if (error.code === '23505') {
        if (error.constraint === 'branchestbl_branch_email_key') {
          return res.status(400).json({
            success: false,
            message: 'A branch with this email already exists',
          });
        }
      }
      next(error);
    }
  }
);

/**
 * DELETE /api/sms/branches/:id
 * Delete branch
 * Access: Superadmin only
 */
router.delete(
  '/:id',
  [
    param('id').isInt().withMessage('Branch ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      // Check if branch exists
      const existingBranch = await query('SELECT * FROM branchestbl WHERE branch_id = $1', [id]);
      if (existingBranch.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Branch not found',
        });
      }

      await query('DELETE FROM branchestbl WHERE branch_id = $1', [id]);

      res.json({
        success: true,
        message: 'Branch deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;

