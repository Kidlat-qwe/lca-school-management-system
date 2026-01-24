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
 * GET /api/sms/merchandise
 * Get all merchandise
 * Access: All authenticated users
 */
router.get(
  '/',
  [
    queryValidator('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    queryValidator('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    queryValidator('branch_id').optional().isInt().withMessage('Branch ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { page = 1, limit = 20, branch_id } = req.query;
      const offset = (page - 1) * limit;

      // Ensure image_url column exists
      try {
        await query(`
          DO $$ 
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = 'merchandisestbl' AND column_name = 'image_url'
            ) THEN
              ALTER TABLE merchandisestbl ADD COLUMN image_url VARCHAR(500);
            END IF;
          END $$;
        `);
      } catch (err) {
        console.log('image_url column check:', err.message);
      }

      let queryText = 'SELECT * FROM merchandisestbl';
      const params = [];
      
      if (branch_id) {
        queryText += ' WHERE branch_id = $1';
        params.push(parseInt(branch_id));
        queryText += ` ORDER BY merchandise_id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(parseInt(limit), offset);
      } else {
        queryText += ` ORDER BY merchandise_id DESC LIMIT $1 OFFSET $2`;
        params.push(parseInt(limit), offset);
      }

      const result = await query(queryText, params);

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
 * GET /api/sms/merchandise/:id
 * Get merchandise by ID
 */
router.get(
  '/:id',
  [
    param('id').isInt().withMessage('Merchandise ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const result = await query('SELECT * FROM merchandisestbl WHERE merchandise_id = $1', [id]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Merchandise not found',
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
 * POST /api/sms/merchandise
 * Create new merchandise
 * Access: Superadmin, Admin
 */
router.post(
  '/',
  [
    body('merchandise_name').notEmpty().withMessage('Merchandise name is required'),
    body('size').optional({ nullable: true, checkFalsy: true }).custom((value) => {
      if (value === null || value === undefined || value === '') return true;
      return typeof value === 'string';
    }).withMessage('Size must be a string'),
    body('quantity').optional({ nullable: true, checkFalsy: true }).custom((value) => {
      if (value === null || value === undefined || value === '') return true;
      const num = parseInt(value);
      return !isNaN(num) && num >= 0;
    }).withMessage('Quantity must be a non-negative integer'),
    body('price').optional({ nullable: true, checkFalsy: true }).custom((value) => {
      if (value === null || value === undefined || value === '') return true;
      const num = parseFloat(value);
      return !isNaN(num) && num >= 0;
    }).withMessage('Price must be a positive number'),
    body('branch_id').optional({ nullable: true, checkFalsy: true }).custom((value) => {
      if (value === null || value === undefined || value === '') return true;
      const num = parseInt(value);
      return !isNaN(num);
    }).withMessage('Branch ID must be an integer'),
    body('gender').optional({ nullable: true, checkFalsy: true }).isIn(['Men', 'Women', 'Unisex', null, '']).withMessage('Gender must be one of: Men, Women, Unisex'),
    body('type').optional({ nullable: true, checkFalsy: true }).isIn(['Top', 'Bottom', null, '']).withMessage('Type must be one of: Top, Bottom'),
    body('image_url').optional({ nullable: true, checkFalsy: true }).isURL().withMessage('Image URL must be a valid URL'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      // Ensure new columns exist
      try {
        await query(`
          DO $$ 
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = 'merchandisestbl' AND column_name = 'image_url'
            ) THEN
              ALTER TABLE merchandisestbl ADD COLUMN image_url VARCHAR(500);
            END IF;
            IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = 'merchandisestbl' AND column_name = 'gender'
            ) THEN
              ALTER TABLE merchandisestbl ADD COLUMN gender VARCHAR(20);
            END IF;
            IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = 'merchandisestbl' AND column_name = 'type'
            ) THEN
              ALTER TABLE merchandisestbl ADD COLUMN type VARCHAR(30);
            END IF;
          END $$;
        `);
      } catch (err) {
        console.log('Column check:', err.message);
      }

      const { merchandise_name, size, quantity, price, branch_id, gender, type, image_url } = req.body;

      const result = await query(
        `INSERT INTO merchandisestbl (merchandise_name, size, quantity, price, branch_id, gender, type, image_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [merchandise_name, size || null, quantity || null, price || null, branch_id ? parseInt(branch_id) : null, gender || null, type || null, image_url || null]
      );

      res.status(201).json({
        success: true,
        message: 'Merchandise created successfully',
        data: result.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/sms/merchandise/:id
 * Update merchandise
 * Access: Superadmin, Admin
 */
router.put(
  '/:id',
  [
    param('id').isInt().withMessage('Merchandise ID must be an integer'),
    body('merchandise_name').optional().notEmpty().withMessage('Merchandise name cannot be empty'),
    body('size').optional({ nullable: true, checkFalsy: true }).custom((value) => {
      if (value === null || value === undefined || value === '') return true;
      return typeof value === 'string';
    }).withMessage('Size must be a string'),
    body('quantity').optional({ nullable: true, checkFalsy: true }).custom((value) => {
      if (value === null || value === undefined || value === '') return true;
      const num = parseInt(value);
      return !isNaN(num) && num >= 0;
    }).withMessage('Quantity must be a non-negative integer'),
    body('price').optional({ nullable: true, checkFalsy: true }).custom((value) => {
      if (value === null || value === undefined || value === '') return true;
      const num = parseFloat(value);
      return !isNaN(num) && num >= 0;
    }).withMessage('Price must be a positive number'),
    body('branch_id').optional({ nullable: true, checkFalsy: true }).custom((value) => {
      if (value === null || value === undefined || value === '') return true;
      const num = parseInt(value);
      return !isNaN(num);
    }).withMessage('Branch ID must be an integer'),
    body('gender').optional({ nullable: true, checkFalsy: true }).isIn(['Men', 'Women', 'Unisex', null, '']).withMessage('Gender must be one of: Men, Women, Unisex'),
    body('type').optional({ nullable: true, checkFalsy: true }).isIn(['Top', 'Bottom', null, '']).withMessage('Type must be one of: Top, Bottom'),
    body('image_url').optional({ nullable: true, checkFalsy: true }).isURL().withMessage('Image URL must be a valid URL'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      // Ensure new columns exist
      try {
        await query(`
          DO $$ 
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = 'merchandisestbl' AND column_name = 'image_url'
            ) THEN
              ALTER TABLE merchandisestbl ADD COLUMN image_url VARCHAR(500);
            END IF;
            IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = 'merchandisestbl' AND column_name = 'gender'
            ) THEN
              ALTER TABLE merchandisestbl ADD COLUMN gender VARCHAR(20);
            END IF;
            IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = 'merchandisestbl' AND column_name = 'type'
            ) THEN
              ALTER TABLE merchandisestbl ADD COLUMN type VARCHAR(30);
            END IF;
          END $$;
        `);
      } catch (err) {
        console.log('Column check:', err.message);
      }

      const { id } = req.params;
      const { merchandise_name, size, quantity, price, branch_id, gender, type, image_url } = req.body;

      const existingMerchandise = await query('SELECT * FROM merchandisestbl WHERE merchandise_id = $1', [id]);
      if (existingMerchandise.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Merchandise not found',
        });
      }

      const updates = [];
      const params = [];
      let paramCount = 0;

      const fields = { 
        merchandise_name, 
        size, 
        quantity, 
        price, 
        branch_id: branch_id !== undefined ? (branch_id ? parseInt(branch_id) : null) : undefined,
        gender: gender !== undefined ? (gender || null) : undefined,
        type: type !== undefined ? (type || null) : undefined,
        image_url: image_url !== undefined ? (image_url || null) : undefined
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

      const sql = `UPDATE merchandisestbl SET ${updates.join(', ')} WHERE merchandise_id = $${paramCount} RETURNING *`;
      const result = await query(sql, params);

      res.json({
        success: true,
        message: 'Merchandise updated successfully',
        data: result.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/sms/merchandise/:id
 * Delete merchandise
 * Access: Superadmin, Admin
 */
router.delete(
  '/:id',
  [
    param('id').isInt().withMessage('Merchandise ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const existingMerchandise = await query('SELECT * FROM merchandisestbl WHERE merchandise_id = $1', [id]);
      if (existingMerchandise.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Merchandise not found',
        });
      }

      await query('DELETE FROM merchandisestbl WHERE merchandise_id = $1', [id]);

      res.json({
        success: true,
        message: 'Merchandise deleted successfully',
      });
    } catch (error) {
      // Check for foreign key constraint violations
      if (error.code === '23503') {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete merchandise. It is being used by one or more packages.',
        });
      }
      next(error);
    }
  }
);

export default router;

