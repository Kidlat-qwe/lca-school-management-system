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
 * GET /api/sms/packages
 * Get all packages with their details
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

      let sql = `SELECT 
        package_id,
        package_name,
        branch_id,
        status,
        package_price,
        level_tag,
        package_type,
        phase_start,
        phase_end,
        downpayment_amount
      FROM packagestbl WHERE 1=1`;
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

      sql += ` ORDER BY package_id DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
      params.push(limit, offset);

      const result = await query(sql, params);

      // Fetch package details for each package
      const packagesWithDetails = await Promise.all(
        result.rows.map(async (pkg) => {
          // Ensure is_included column exists
          try {
            await query(`
              DO $$ 
              BEGIN
                IF NOT EXISTS (
                  SELECT 1 FROM information_schema.columns 
                  WHERE table_name = 'packagedetailstbl' AND column_name = 'is_included'
                ) THEN
                  ALTER TABLE packagedetailstbl ADD COLUMN is_included BOOLEAN DEFAULT true;
                END IF;
              END $$;
            `);
          } catch (err) {
            // Column might already exist, ignore error
            console.log('is_included column check:', err.message);
          }

          const detailsResult = await query(
            `SELECT pd.*, 
              pl.name as pricing_name, pl.level_tag as pricing_level_tag, pl.price as pricing_price,
              m.merchandise_name, m.size, m.price as merchandise_price, m.gender as merchandise_gender, m.type as merchandise_type,
              m.quantity as merchandise_quantity
             FROM packagedetailstbl pd
             LEFT JOIN pricingliststbl pl ON pd.pricinglist_id = pl.pricinglist_id
             LEFT JOIN merchandisestbl m ON pd.merchandise_id = m.merchandise_id
             WHERE pd.package_id = $1`,
            [pkg.package_id]
          );

          return {
            ...pkg,
            details: detailsResult.rows,
          };
        })
      );

      res.json({
        success: true,
        data: packagesWithDetails,
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
 * GET /api/sms/packages/:id
 * Get package by ID with details
 */
router.get(
  '/:id',
  [
    param('id').isInt().withMessage('Package ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const result = await query(
        `SELECT 
          package_id,
          package_name,
          branch_id,
          status,
          package_price,
          level_tag,
          package_type,
          phase_start,
          phase_end,
          downpayment_amount
        FROM packagestbl WHERE package_id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Package not found',
        });
      }

      // Ensure is_included column exists
      try {
        await query(`
          DO $$ 
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = 'packagedetailstbl' AND column_name = 'is_included'
            ) THEN
              ALTER TABLE packagedetailstbl ADD COLUMN is_included BOOLEAN DEFAULT true;
            END IF;
          END $$;
        `);
      } catch (err) {
        console.log('is_included column check:', err.message);
      }

      // Fetch package details
      const detailsResult = await query(
        `SELECT pd.*, 
          pl.name as pricing_name, pl.level_tag as pricing_level_tag, pl.price as pricing_price,
          m.merchandise_name, m.size, m.price as merchandise_price, m.gender as merchandise_gender, m.type as merchandise_type,
          m.quantity as merchandise_quantity
         FROM packagedetailstbl pd
         LEFT JOIN pricingliststbl pl ON pd.pricinglist_id = pl.pricinglist_id
         LEFT JOIN merchandisestbl m ON pd.merchandise_id = m.merchandise_id
         WHERE pd.package_id = $1`,
        [id]
      );

      const pkg = result.rows[0];

      res.json({
        success: true,
        data: {
          ...pkg,
          details: detailsResult.rows,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/sms/packages
 * Create new package with details
 * Access: Superadmin, Admin
 */
router.post(
  '/',
  [
    body('package_name').notEmpty().withMessage('Package name is required'),
    body('branch_id').optional().isInt().withMessage('Branch ID must be an integer'),
    body('status').optional().isIn(['Active', 'Inactive']).withMessage('Status must be Active or Inactive'),
    body('package_price').optional({ nullable: true, checkFalsy: true }).isFloat({ min: 0 }).withMessage('Package price must be a positive number'),
    body('level_tag').optional().isString().withMessage('Level tag must be a string'),
    body('package_type').optional().isIn(['Fullpayment', 'Installment', 'Reserved', 'Phase']).withMessage('Package type must be Fullpayment, Installment, Reserved, or Phase'),
    body('phase_start').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }).withMessage('Phase start must be a positive integer'),
    body('phase_end').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }).withMessage('Phase end must be a positive integer'),
    body('downpayment_amount').optional({ nullable: true, checkFalsy: true }).isFloat({ min: 0 }).withMessage('Downpayment amount must be a positive number'),
    body('details').optional().isArray().withMessage('Details must be an array'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { package_name, branch_id, status, package_price, level_tag, package_type, phase_start, phase_end, downpayment_amount, details = [] } = req.body;

      // Verify branch exists if provided
      if (branch_id) {
        const branchCheck = await client.query('SELECT branch_id FROM branchestbl WHERE branch_id = $1', [branch_id]);
        if (branchCheck.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: 'Branch not found',
          });
        }
      }

      // Validate phase range if package type is Phase
      if (package_type === 'Phase') {
        if (!phase_start) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: 'Phase start is required for Phase package type',
          });
        }
        const startNum = parseInt(phase_start);
        const endNum = phase_end ? parseInt(phase_end) : startNum;
        if (endNum < startNum) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: 'Phase end must be greater than or equal to phase start',
          });
        }
      }

      // Validate downpayment for Installment packages
      // Note: package_price for Installment packages is the monthly installment amount, not total
      // Downpayment is REQUIRED for Installment packages
      if (package_type === 'Installment') {
        if (!downpayment_amount || downpayment_amount === '' || downpayment_amount === null || downpayment_amount === undefined) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: 'Downpayment amount is required for Installment packages',
          });
        }
        const downpayment = parseFloat(downpayment_amount);
        if (isNaN(downpayment) || downpayment <= 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: 'Downpayment amount must be a positive number',
          });
        }
        // Also require package_price (monthly installment amount)
        if (!package_price || package_price === '' || package_price === null || package_price === undefined) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: 'Monthly installment amount (package price) is required for Installment packages',
          });
        }
      } else if (package_type !== 'Installment' && downpayment_amount !== undefined && downpayment_amount !== null) {
        // Clear downpayment for non-Installment packages
        downpayment_amount = null;
      }

      // Create package
      // Ensure phase_start, phase_end, and downpayment_amount columns exist
      try {
        await client.query(`
          DO $$ 
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = 'packagestbl' AND column_name = 'phase_start'
            ) THEN
              ALTER TABLE packagestbl ADD COLUMN phase_start INTEGER;
            END IF;
            IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = 'packagestbl' AND column_name = 'phase_end'
            ) THEN
              ALTER TABLE packagestbl ADD COLUMN phase_end INTEGER;
            END IF;
            IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = 'packagestbl' AND column_name = 'downpayment_amount'
            ) THEN
              ALTER TABLE packagestbl ADD COLUMN downpayment_amount NUMERIC(10, 2) DEFAULT NULL;
            END IF;
          END $$;
        `);
      } catch (err) {
        console.log('Column check:', err.message);
      }

      const packageResult = await client.query(
        `INSERT INTO packagestbl (package_name, branch_id, status, package_price, level_tag, package_type, phase_start, phase_end, downpayment_amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          package_name, 
          branch_id || null, 
          status || 'Active', 
          package_price || null, 
          level_tag || null, 
          package_type || 'Fullpayment',
          package_type === 'Phase' && phase_start ? parseInt(phase_start) : null,
          package_type === 'Phase'
            ? (phase_end ? parseInt(phase_end) : (phase_start ? parseInt(phase_start) : null))
            : null,
          package_type === 'Installment' && downpayment_amount !== undefined && downpayment_amount !== null
            ? parseFloat(downpayment_amount)
            : null
        ]
      );

      const newPackage = packageResult.rows[0];

      // Create package details if provided
      if (details && details.length > 0) {
        for (const detail of details) {
          const { pricinglist_id, merchandise_id } = detail;

          // Validate that either pricinglist_id or merchandise_id is provided, but not both
          if (!pricinglist_id && !merchandise_id) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              message: 'Each package detail must have either a pricing list ID or merchandise ID',
            });
          }

          if (pricinglist_id && merchandise_id) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              message: 'Package detail cannot have both pricing list ID and merchandise ID',
            });
          }

          // Verify pricing list exists if provided
          if (pricinglist_id) {
            const pricingCheck = await client.query('SELECT pricinglist_id FROM pricingliststbl WHERE pricinglist_id = $1', [pricinglist_id]);
            if (pricingCheck.rows.length === 0) {
              await client.query('ROLLBACK');
              return res.status(400).json({
                success: false,
                message: `Pricing list with ID ${pricinglist_id} not found`,
              });
            }
          }

          // Verify merchandise exists if provided
          if (merchandise_id) {
            const merchandiseCheck = await client.query('SELECT merchandise_id FROM merchandisestbl WHERE merchandise_id = $1', [merchandise_id]);
            if (merchandiseCheck.rows.length === 0) {
              await client.query('ROLLBACK');
              return res.status(400).json({
                success: false,
                message: `Merchandise with ID ${merchandise_id} not found`,
              });
            }
          }

          // Ensure is_included column exists
          try {
            await client.query(`
              DO $$ 
              BEGIN
                IF NOT EXISTS (
                  SELECT 1 FROM information_schema.columns 
                  WHERE table_name = 'packagedetailstbl' AND column_name = 'is_included'
                ) THEN
                  ALTER TABLE packagedetailstbl ADD COLUMN is_included BOOLEAN DEFAULT true;
                END IF;
              END $$;
            `);
          } catch (err) {
            console.log('is_included column check:', err.message);
          }

          const is_included = detail.is_included !== undefined ? detail.is_included : true; // Default to true (included/freebie)

          await client.query(
            `INSERT INTO packagedetailstbl (package_id, pricinglist_id, merchandise_id, is_included)
             VALUES ($1, $2, $3, $4)`,
            [newPackage.package_id, pricinglist_id || null, merchandise_id || null, is_included]
          );
        }
      }

      await client.query('COMMIT');

      // Fetch the complete package with details
      const detailsResult = await query(
        `SELECT pd.*, 
          pl.name as pricing_name, pl.level_tag as pricing_level_tag, pl.price as pricing_price,
          m.merchandise_name, m.size, m.price as merchandise_price, m.gender as merchandise_gender, m.type as merchandise_type,
          m.quantity as merchandise_quantity
         FROM packagedetailstbl pd
         LEFT JOIN pricingliststbl pl ON pd.pricinglist_id = pl.pricinglist_id
         LEFT JOIN merchandisestbl m ON pd.merchandise_id = m.merchandise_id
         WHERE pd.package_id = $1`,
        [newPackage.package_id]
      );

      res.status(201).json({
        success: true,
        message: 'Package created successfully',
        data: {
          ...newPackage,
          details: detailsResult.rows,
        },
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
 * PUT /api/sms/packages/:id
 * Update package and its details
 * Access: Superadmin, Admin
 */
router.put(
  '/:id',
  [
    param('id').isInt().withMessage('Package ID must be an integer'),
    body('package_name').optional().notEmpty().withMessage('Package name cannot be empty'),
    body('status').optional().isIn(['Active', 'Inactive']).withMessage('Status must be Active or Inactive'),
    body('package_price').optional({ nullable: true, checkFalsy: true }).isFloat({ min: 0 }).withMessage('Package price must be a positive number'),
    body('level_tag').optional().isString().withMessage('Level tag must be a string'),
    body('package_type').optional().isIn(['Fullpayment', 'Installment', 'Reserved', 'Phase']).withMessage('Package type must be Fullpayment, Installment, Reserved, or Phase'),
    body('phase_start').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }).withMessage('Phase start must be a positive integer'),
    body('phase_end').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }).withMessage('Phase end must be a positive integer'),
    body('downpayment_amount').optional({ nullable: true, checkFalsy: true }).isFloat({ min: 0 }).withMessage('Downpayment amount must be a positive number'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { package_name, branch_id, status, package_price, level_tag, package_type, phase_start, phase_end, downpayment_amount } = req.body;

      // Check if package exists
      const existingPackage = await query('SELECT * FROM packagestbl WHERE package_id = $1', [id]);
      if (existingPackage.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Package not found',
        });
      }

      // Check if package has active installment profiles (prevent downpayment changes)
      if (downpayment_amount !== undefined) {
        const activeProfiles = await query(
          'SELECT COUNT(*) as count FROM installmentinvoiceprofilestbl WHERE package_id = $1 AND is_active = true',
          [id]
        );
        if (parseInt(activeProfiles.rows[0].count) > 0) {
          return res.status(400).json({
            success: false,
            message: 'Cannot update downpayment amount for packages with active installment profiles',
          });
        }
      }

      // Validate phase range if package type is Phase
      if (package_type === 'Phase') {
        if (!phase_start) {
          return res.status(400).json({
            success: false,
            message: 'Phase start is required for Phase package type',
          });
        }
        const startNum = parseInt(phase_start);
        const endNum = phase_end ? parseInt(phase_end) : startNum;
        if (endNum < startNum) {
          return res.status(400).json({
            success: false,
            message: 'Phase end must be greater than or equal to phase start',
          });
        }
      }

      // Validate downpayment for Installment packages
      // Note: package_price for Installment packages is the monthly installment amount, not total
      // Downpayment is REQUIRED for Installment packages
      if (package_type === 'Installment') {
        if (!downpayment_amount || downpayment_amount === '' || downpayment_amount === null || downpayment_amount === undefined) {
          return res.status(400).json({
            success: false,
            message: 'Downpayment amount is required for Installment packages',
          });
        }
        const downpayment = parseFloat(downpayment_amount);
        if (isNaN(downpayment) || downpayment <= 0) {
          return res.status(400).json({
            success: false,
            message: 'Downpayment amount must be a positive number',
          });
        }
        // Also require package_price (monthly installment amount)
        if (!package_price || package_price === '' || package_price === null || package_price === undefined) {
          return res.status(400).json({
            success: false,
            message: 'Monthly installment amount (package price) is required for Installment packages',
          });
        }
      } else if (package_type !== 'Installment' && downpayment_amount !== undefined && downpayment_amount !== null) {
        // Clear downpayment for non-Installment packages
        downpayment_amount = null;
      }

      // Build update query
      const updates = [];
      const params = [];
      let paramCount = 0;

      const fields = { 
        package_name, 
        branch_id, 
        status, 
        package_price, 
        level_tag, 
        package_type,
        phase_start: phase_start !== undefined ? (phase_start ? parseInt(phase_start) : null) : undefined,
        phase_end: phase_end !== undefined ? (phase_end ? parseInt(phase_end) : null) : undefined,
        downpayment_amount: downpayment_amount !== undefined 
          ? (package_type === 'Installment' && downpayment_amount !== null ? parseFloat(downpayment_amount) : null)
          : undefined
      };
      Object.entries(fields).forEach(([key, value]) => {
        if (value !== undefined) {
          paramCount++;
          updates.push(`${key} = $${paramCount}`);
          params.push(value);
        }
      });

      if (updates.length > 0) {
        paramCount++;
        params.push(id);
        const sql = `UPDATE packagestbl SET ${updates.join(', ')} WHERE package_id = $${paramCount} RETURNING *`;
        const result = await query(sql, params);
      }

      // Ensure is_included column exists
      try {
        await query(`
          DO $$ 
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = 'packagedetailstbl' AND column_name = 'is_included'
            ) THEN
              ALTER TABLE packagedetailstbl ADD COLUMN is_included BOOLEAN DEFAULT true;
            END IF;
          END $$;
        `);
      } catch (err) {
        console.log('is_included column check:', err.message);
      }

      // Fetch updated package with details
      const packageResult = await query('SELECT * FROM packagestbl WHERE package_id = $1', [id]);
      const detailsResult = await query(
        `SELECT pd.*, 
          pl.name as pricing_name, pl.level_tag as pricing_level_tag, pl.price as pricing_price,
          m.merchandise_name, m.size, m.price as merchandise_price, m.gender as merchandise_gender, m.type as merchandise_type,
          m.quantity as merchandise_quantity
         FROM packagedetailstbl pd
         LEFT JOIN pricingliststbl pl ON pd.pricinglist_id = pl.pricinglist_id
         LEFT JOIN merchandisestbl m ON pd.merchandise_id = m.merchandise_id
         WHERE pd.package_id = $1`,
        [id]
      );

      res.json({
        success: true,
        message: 'Package updated successfully',
        data: {
          ...packageResult.rows[0],
          details: detailsResult.rows,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/sms/packages/:id
 * Delete package and its details
 * Access: Superadmin, Admin
 */
router.delete(
  '/:id',
  [
    param('id').isInt().withMessage('Package ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { id } = req.params;

      const existingPackage = await client.query('SELECT * FROM packagestbl WHERE package_id = $1', [id]);
      if (existingPackage.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Package not found',
        });
      }

      // Delete package details first (due to foreign key)
      await client.query('DELETE FROM packagedetailstbl WHERE package_id = $1', [id]);

      // Delete package
      await client.query('DELETE FROM packagestbl WHERE package_id = $1', [id]);

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Package deleted successfully',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      // Check for foreign key constraint violations
      if (error.code === '23503') {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete package. It is being used by one or more records.',
        });
      }
      next(error);
    } finally {
      client.release();
    }
  }
);

/**
 * POST /api/sms/packages/:id/details
 * Add a detail to a package
 * Access: Superadmin, Admin
 */
router.post(
  '/:id/details',
  [
    param('id').isInt().withMessage('Package ID must be an integer'),
    body('pricinglist_id').optional({ nullable: true, checkFalsy: true }).isInt().withMessage('Pricing list ID must be an integer'),
    body('merchandise_id').optional({ nullable: true, checkFalsy: true }).isInt().withMessage('Merchandise ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { pricinglist_id, merchandise_id } = req.body;

      // Check if package exists
      const packageCheck = await query('SELECT package_id FROM packagestbl WHERE package_id = $1', [id]);
      if (packageCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Package not found',
        });
      }

      // Validate that either pricinglist_id or merchandise_id is provided, but not both
      if (!pricinglist_id && !merchandise_id) {
        return res.status(400).json({
          success: false,
          message: 'Either pricing list ID or merchandise ID must be provided',
        });
      }

      if (pricinglist_id && merchandise_id) {
        return res.status(400).json({
          success: false,
          message: 'Cannot provide both pricing list ID and merchandise ID',
        });
      }

      // Verify pricing list exists if provided
      if (pricinglist_id) {
        const pricingCheck = await query('SELECT pricinglist_id FROM pricingliststbl WHERE pricinglist_id = $1', [pricinglist_id]);
        if (pricingCheck.rows.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'Pricing list not found',
          });
        }
      }

      // Verify merchandise exists if provided
      if (merchandise_id) {
        const merchandiseCheck = await query('SELECT merchandise_id FROM merchandisestbl WHERE merchandise_id = $1', [merchandise_id]);
        if (merchandiseCheck.rows.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'Merchandise not found',
          });
        }
      }

      // Ensure is_included column exists
      try {
        await query(`
          DO $$ 
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = 'packagedetailstbl' AND column_name = 'is_included'
            ) THEN
              ALTER TABLE packagedetailstbl ADD COLUMN is_included BOOLEAN DEFAULT true;
            END IF;
          END $$;
        `);
      } catch (err) {
        console.log('is_included column check:', err.message);
      }

      const is_included = req.body.is_included !== undefined ? req.body.is_included : true; // Default to true (included/freebie)

      const result = await query(
        `INSERT INTO packagedetailstbl (package_id, pricinglist_id, merchandise_id, is_included)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [id, pricinglist_id || null, merchandise_id || null, is_included]
      );

      res.status(201).json({
        success: true,
        message: 'Package detail added successfully',
        data: result.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/sms/packages/:id/details/:detailId
 * Remove a detail from a package
 * Access: Superadmin, Admin
 */
router.delete(
  '/:id/details/:detailId',
  [
    param('id').isInt().withMessage('Package ID must be an integer'),
    param('detailId').isInt().withMessage('Detail ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id, detailId } = req.params;

      // Verify detail belongs to package
      const detailCheck = await query('SELECT * FROM packagedetailstbl WHERE packagedtl_id = $1 AND package_id = $2', [detailId, id]);
      if (detailCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Package detail not found',
        });
      }

      await query('DELETE FROM packagedetailstbl WHERE packagedtl_id = $1', [detailId]);

      res.json({
        success: true,
        message: 'Package detail removed successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;

