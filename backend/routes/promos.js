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
 * GET /api/v1/promos
 * Get all promos with filters
 * Access: All authenticated users
 */
router.get(
  '/',
  [
    queryValidator('package_id').optional().isInt().withMessage('Package ID must be an integer'),
    queryValidator('branch_id').optional().isInt().withMessage('Branch ID must be an integer'),
    queryValidator('status').optional().isIn(['Active', 'Inactive', 'Expired']).withMessage('Status must be Active, Inactive, or Expired'),
    queryValidator('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    queryValidator('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { package_id, branch_id, status, page = 1, limit = 20 } = req.query;
      const offset = (page - 1) * limit;

      // Auto-deactivate expired or max-uses-reached promos before fetching
      // Use CURRENT_DATE for accurate date comparison
      await query(
        `UPDATE promostbl 
         SET status = 'Inactive', updated_at = CURRENT_TIMESTAMP
         WHERE status = 'Active' 
           AND (
             (end_date < CURRENT_DATE) 
             OR (max_uses IS NOT NULL AND current_uses >= max_uses)
           )`
      );

      let sql = `
        SELECT 
          p.promo_id,
          p.promo_name,
          p.package_id,
          p.branch_id,
          p.promo_type,
          p.promo_code,
          p.discount_percentage,
          p.discount_amount,
          p.min_payment_amount,
          TO_CHAR(p.start_date, 'YYYY-MM-DD') as start_date,
          TO_CHAR(p.end_date, 'YYYY-MM-DD') as end_date,
          p.max_uses,
          p.current_uses,
          p.eligibility_type,
          p.status,
          p.description,
          p.created_at,
          p.updated_at,
          p.installment_apply_scope,
          p.installment_months_to_apply,
          pkg.package_name,
          b.branch_name
        FROM promostbl p
        LEFT JOIN packagestbl pkg ON p.package_id = pkg.package_id
        LEFT JOIN branchestbl b ON p.branch_id = b.branch_id
        WHERE 1=1
      `;
      const params = [];
      let paramCount = 0;

      // Filter by package (check both old package_id and new junction table)
      if (package_id) {
        paramCount++;
        sql += ` AND (
          p.package_id = $${paramCount} 
          OR EXISTS (
            SELECT 1 FROM promopackagestbl pp 
            WHERE pp.promo_id = p.promo_id 
            AND pp.package_id = $${paramCount}
          )
        )`;
        params.push(package_id);
      }

      // Filter by branch (non-superadmin users are limited to their branch)
      if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        paramCount++;
        sql += ` AND (p.branch_id = $${paramCount} OR p.branch_id IS NULL)`;
        params.push(req.user.branchId);
      } else if (branch_id) {
        paramCount++;
        sql += ` AND (p.branch_id = $${paramCount} OR p.branch_id IS NULL)`;
        params.push(branch_id);
      }

      // Filter by status
      if (status) {
        paramCount++;
        sql += ` AND p.status = $${paramCount}`;
        params.push(status);
      }

      sql += ` ORDER BY p.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
      params.push(limit, offset);

      const result = await query(sql, params);

      // Helper function to check and update promo status
      const checkAndUpdatePromoStatus = async (promo) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const endDate = promo.end_date ? new Date(promo.end_date) : null;
        const isExpired = endDate && endDate < today;
        const isMaxUsesReached = promo.max_uses !== null && promo.max_uses !== undefined && 
                                 (promo.current_uses || 0) >= promo.max_uses;
        
        // Auto-deactivate if expired or max uses reached
        if (promo.status === 'Active' && (isExpired || isMaxUsesReached)) {
          await query(
            'UPDATE promostbl SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE promo_id = $2',
            ['Inactive', promo.promo_id]
          );
          promo.status = 'Inactive';
        }
        
        return {
          isExpired,
          isMaxUsesReached,
          isActive: promo.status === 'Active' && !isExpired && !isMaxUsesReached,
        };
      };

      // Fetch promo merchandise and packages for each promo and check/update status
      const promosWithDetails = await Promise.all(
        result.rows.map(async (promo) => {
          // Check and update promo status if needed
          const statusCheck = await checkAndUpdatePromoStatus(promo);
          
          // Fetch packages from junction table
          const packagesResult = await query(
            `SELECT 
              pp.promopackage_id,
              pp.package_id,
              pkg.package_name,
              pkg.level_tag,
              pkg.package_price
             FROM promopackagestbl pp
             LEFT JOIN packagestbl pkg ON pp.package_id = pkg.package_id
             WHERE pp.promo_id = $1`,
            [promo.promo_id]
          );
          
          // If no packages in junction table, fall back to old package_id for backward compatibility
          let packages = packagesResult.rows;
          if (packages.length === 0 && promo.package_id) {
            const legacyPackageResult = await query(
              `SELECT 
                package_id,
                package_name,
                level_tag,
                package_price
               FROM packagestbl
               WHERE package_id = $1`,
              [promo.package_id]
            );
            if (legacyPackageResult.rows.length > 0) {
              packages = legacyPackageResult.rows.map(pkg => ({
                promopackage_id: null,
                package_id: pkg.package_id,
                package_name: pkg.package_name,
                level_tag: pkg.level_tag,
                package_price: pkg.package_price,
              }));
            }
          }
          
          const merchandiseResult = await query(
            `SELECT 
              pm.promomerchandise_id,
              pm.merchandise_id,
              pm.quantity,
              m.merchandise_name,
              m.size,
              m.price as merchandise_price
             FROM promomerchandisetbl pm
             LEFT JOIN merchandisestbl m ON pm.merchandise_id = m.merchandise_id
             WHERE pm.promo_id = $1`,
            [promo.promo_id]
          );

          return {
            ...promo,
            packages: packages,
            package_ids: packages.map(p => p.package_id), // For easy filtering
            merchandise: merchandiseResult.rows,
            is_expired: statusCheck.isExpired,
            is_max_uses_reached: statusCheck.isMaxUsesReached,
            is_active: statusCheck.isActive,
          };
        })
      );

      res.json({
        success: true,
        data: promosWithDetails,
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
 * GET /api/v1/promos/:id
 * Get promo by ID with details
 */
router.get(
  '/:id',
  [
    param('id').isInt().withMessage('Promo ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const result = await query(
        `        SELECT 
          p.promo_id,
          p.promo_name,
          p.package_id,
          p.branch_id,
          p.promo_type,
          p.promo_code,
          p.discount_percentage,
          p.discount_amount,
          p.min_payment_amount,
          TO_CHAR(p.start_date, 'YYYY-MM-DD') as start_date,
          TO_CHAR(p.end_date, 'YYYY-MM-DD') as end_date,
          p.max_uses,
          p.current_uses,
          p.eligibility_type,
          p.status,
          p.description,
          p.created_at,
          p.updated_at,
          p.installment_apply_scope,
          p.installment_months_to_apply,
          pkg.package_name,
          b.branch_name
        FROM promostbl p
        LEFT JOIN packagestbl pkg ON p.package_id = pkg.package_id
        LEFT JOIN branchestbl b ON p.branch_id = b.branch_id
        WHERE p.promo_id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Promo not found',
        });
      }

      const promo = result.rows[0];

      // Fetch packages from junction table
      const packagesResult = await query(
        `SELECT 
          pp.promopackage_id,
          pp.package_id,
          pkg.package_name,
          pkg.level_tag,
          pkg.package_price
         FROM promopackagestbl pp
         LEFT JOIN packagestbl pkg ON pp.package_id = pkg.package_id
         WHERE pp.promo_id = $1`,
        [id]
      );
      
      // If no packages in junction table, fall back to old package_id for backward compatibility
      let packages = packagesResult.rows;
      if (packages.length === 0 && promo.package_id) {
        const legacyPackageResult = await query(
          `SELECT 
            package_id,
            package_name,
            level_tag,
            package_price
           FROM packagestbl
           WHERE package_id = $1`,
          [promo.package_id]
        );
        if (legacyPackageResult.rows.length > 0) {
          packages = legacyPackageResult.rows.map(pkg => ({
            promopackage_id: null,
            package_id: pkg.package_id,
            package_name: pkg.package_name,
            level_tag: pkg.level_tag,
            package_price: pkg.package_price,
          }));
        }
      }

      // Fetch promo merchandise
      const merchandiseResult = await query(
        `SELECT 
          pm.promomerchandise_id,
          pm.merchandise_id,
          pm.quantity,
          m.merchandise_name,
          m.size,
          m.price as merchandise_price
         FROM promomerchandisetbl pm
         LEFT JOIN merchandisestbl m ON pm.merchandise_id = m.merchandise_id
         WHERE pm.promo_id = $1`,
        [id]
      );

      // Check and update promo status if needed
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const endDate = promo.end_date ? new Date(promo.end_date) : null;
      const isExpired = endDate && endDate < today;
      const isMaxUsesReached = promo.max_uses !== null && promo.max_uses !== undefined && 
                               (promo.current_uses || 0) >= promo.max_uses;
      
      // Auto-deactivate if expired or max uses reached
      if (promo.status === 'Active' && (isExpired || isMaxUsesReached)) {
        await query(
          'UPDATE promostbl SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE promo_id = $2',
          ['Inactive', promo.promo_id]
        );
        promo.status = 'Inactive';
      }
      
      const isActive = promo.status === 'Active' && !isExpired && !isMaxUsesReached;

      res.json({
        success: true,
        data: {
          ...promo,
          packages: packages,
          package_ids: packages.map(p => p.package_id), // For easy filtering
          merchandise: merchandiseResult.rows,
          is_expired: isExpired,
          is_active: isActive,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/promos/package/:packageId
 * Get available promos for a package
 */
router.get(
  '/package/:packageId',
  [
    param('packageId').isInt().withMessage('Package ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { packageId } = req.params;

      // Get the package's branch_id, package_type, and downpayment_amount to filter promos and inform clients
      const packageResult = await query(
        'SELECT branch_id, package_type, downpayment_amount FROM packagestbl WHERE package_id = $1',
        [packageId]
      );
      const packageBranchId = packageResult.rows[0]?.branch_id;
      const packageType = packageResult.rows[0]?.package_type ?? null;
      const packageDownpayment = packageResult.rows[0]?.downpayment_amount != null
        ? parseFloat(packageResult.rows[0].downpayment_amount)
        : null;

      // Build query with branch filtering
      // Show system-wide promos (branch_id IS NULL) OR branch-specific promos matching package branch
      // Use CURRENT_DATE for accurate date comparison (inclusive of today)
      let sql = `
        SELECT 
          p.promo_id,
          p.promo_name,
          p.package_id,
          p.branch_id,
          p.promo_type,
          p.promo_code,
          p.discount_percentage,
          p.discount_amount,
          p.min_payment_amount,
          TO_CHAR(p.start_date, 'YYYY-MM-DD') as start_date,
          TO_CHAR(p.end_date, 'YYYY-MM-DD') as end_date,
          p.max_uses,
          p.current_uses,
          p.eligibility_type,
          p.status,
          p.description,
          pkg.package_name,
          b.branch_name
        FROM promostbl p
        LEFT JOIN promopackagestbl pp ON p.promo_id = pp.promo_id
        LEFT JOIN packagestbl pkg ON p.package_id = pkg.package_id
        LEFT JOIN branchestbl b ON p.branch_id = b.branch_id
        WHERE (pp.package_id = $1 OR p.package_id = $1)
          AND p.status = 'Active'
          AND p.start_date <= CURRENT_DATE
          AND p.end_date >= CURRENT_DATE
          AND (p.max_uses IS NULL OR p.current_uses < p.max_uses)
          AND (p.promo_code IS NULL OR p.promo_code = '')
      `;
      
      const params = [packageId];
      
      // Filter by branch: show system-wide (NULL) or matching branch
      if (packageBranchId) {
        sql += ` AND (p.branch_id IS NULL OR p.branch_id = $2)`;
        params.push(packageBranchId);
      } else {
        // If package has no branch, show only system-wide promos
        sql += ` AND p.branch_id IS NULL`;
      }
      
      sql += ` GROUP BY p.promo_id, p.promo_name, p.package_id, p.branch_id, p.promo_type, p.promo_code, p.discount_percentage, p.discount_amount, p.min_payment_amount, p.start_date, p.end_date, p.max_uses, p.current_uses, p.eligibility_type, p.status, p.description, pkg.package_name, b.branch_name ORDER BY p.created_at DESC`;
      
      const result = await query(sql, params);

      // Fetch merchandise for each promo
      const promosWithDetails = await Promise.all(
        result.rows.map(async (promo) => {
          const merchandiseResult = await query(
            `SELECT 
              pm.promomerchandise_id,
              pm.merchandise_id,
              pm.quantity,
              m.merchandise_name,
              m.size
             FROM promomerchandisetbl pm
             LEFT JOIN merchandisestbl m ON pm.merchandise_id = m.merchandise_id
             WHERE pm.promo_id = $1`,
            [promo.promo_id]
          );

          return {
            ...promo,
            merchandise: merchandiseResult.rows,
          };
        })
      );

      res.json({
        success: true,
        data: promosWithDetails,
        package_info: {
          package_type: packageType,
          downpayment_amount: packageDownpayment,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/promos/package/:packageId/student/:studentId
 * Get eligible promos for a student and package
 */
router.get(
  '/package/:packageId/student/:studentId',
  [
    param('packageId').isInt().withMessage('Package ID must be an integer'),
    param('studentId').isInt().withMessage('Student ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { packageId, studentId } = req.params;

      // Get package price, branch_id, package_type, and downpayment_amount for filtering and discount calc
      const packageResult = await query(
        'SELECT package_price, branch_id, package_type, downpayment_amount FROM packagestbl WHERE package_id = $1',
        [packageId]
      );
      const packagePrice = packageResult.rows[0]?.package_price || 0;
      const packageBranchId = packageResult.rows[0]?.branch_id;
      const packageType = packageResult.rows[0]?.package_type ?? null;
      const packageDownpayment = packageResult.rows[0]?.downpayment_amount != null
        ? parseFloat(packageResult.rows[0].downpayment_amount)
        : null;
      // For Installment packages, promo applies to down payment only; use it for min check and discount base
      const eligibilityBase = packageType === 'Installment' && packageDownpayment != null && packageDownpayment > 0
        ? packageDownpayment
        : packagePrice;

      // Check if student is new or existing
      const enrollmentCheck = await query(
        'SELECT COUNT(*) as count FROM classstudentstbl WHERE student_id = $1',
        [studentId]
      );
      const enrollmentCount = parseInt(enrollmentCheck.rows[0]?.count || 0);
      const isNewStudent = enrollmentCount === 0;
      const isExistingStudent = enrollmentCount > 0;

      // Check if student has referral
      const referralCheck = await query(
        'SELECT referral_id, status FROM referralstbl WHERE referred_student_id = $1',
        [studentId]
      );
      const hasReferral = referralCheck.rows.length > 0 && referralCheck.rows[0].status === 'Verified';

      // First, auto-deactivate expired or max-uses-reached promos
      // Use CURRENT_DATE for accurate date comparison
      await query(
        `UPDATE promostbl 
         SET status = 'Inactive', updated_at = CURRENT_TIMESTAMP
         WHERE status = 'Active' 
           AND (
             (end_date < CURRENT_DATE) 
             OR (max_uses IS NOT NULL AND current_uses >= max_uses)
           )`
      );

      // Build query with branch filtering
      // Show system-wide promos (branch_id IS NULL) OR branch-specific promos matching package branch
      let sql = `
        SELECT 
          p.promo_id,
          p.promo_name,
          p.package_id,
          p.branch_id,
          p.promo_type,
          p.promo_code,
          p.discount_percentage,
          p.discount_amount,
          p.min_payment_amount,
          TO_CHAR(p.start_date, 'YYYY-MM-DD') as start_date,
          TO_CHAR(p.end_date, 'YYYY-MM-DD') as end_date,
          p.max_uses,
          p.current_uses,
          p.eligibility_type,
          p.status,
          p.description,
          p.installment_apply_scope,
          p.installment_months_to_apply,
          pkg.package_name,
          pkg.package_price,
          b.branch_name
        FROM promostbl p
        LEFT JOIN promopackagestbl pp ON p.promo_id = pp.promo_id
        LEFT JOIN packagestbl pkg ON p.package_id = pkg.package_id
        LEFT JOIN branchestbl b ON p.branch_id = b.branch_id
        WHERE (pp.package_id = $1 OR p.package_id = $1)
          AND p.status = 'Active'
          AND p.start_date <= CURRENT_DATE
          AND p.end_date >= CURRENT_DATE
          AND (p.max_uses IS NULL OR p.current_uses < p.max_uses)
          AND (p.promo_code IS NULL OR p.promo_code = '')
      `;
      
      const params = [packageId];
      
      // Filter by branch: show system-wide (NULL) or matching branch
      if (packageBranchId) {
        sql += ` AND (p.branch_id IS NULL OR p.branch_id = $2)`;
        params.push(packageBranchId);
      } else {
        // If package has no branch, show only system-wide promos
        sql += ` AND p.branch_id IS NULL`;
      }
      
      sql += ` GROUP BY p.promo_id, p.promo_name, p.package_id, p.branch_id, p.promo_type, p.promo_code, p.discount_percentage, p.discount_amount, p.min_payment_amount, p.start_date, p.end_date, p.max_uses, p.current_uses, p.eligibility_type, p.status, p.description, pkg.package_name, pkg.package_price, b.branch_name ORDER BY p.created_at DESC`;
      
      const result = await query(sql, params);

      // Filter promos by eligibility and check if student already used it
      const eligiblePromos = [];
      for (const promo of result.rows) {
        // Check if student already used this promo
        const usageCheck = await query(
          'SELECT promousage_id FROM promousagetbl WHERE promo_id = $1 AND student_id = $2',
          [promo.promo_id, studentId]
        );
        if (usageCheck.rows.length > 0) {
          continue; // Student already used this promo
        }

        // Check eligibility type
        let isEligible = false;
        switch (promo.eligibility_type) {
          case 'all':
            isEligible = true;
            break;
          case 'new_students_only':
            isEligible = isNewStudent;
            break;
          case 'existing_students_only':
            isEligible = isExistingStudent;
            break;
          case 'referral_only':
            isEligible = hasReferral;
            break;
          default:
            isEligible = true;
        }

        if (!isEligible) {
          continue;
        }

        // Check min_payment_amount (use down payment for Installment packages)
        if (promo.min_payment_amount && eligibilityBase < promo.min_payment_amount) {
          continue;
        }

        // Check branch (if branch-specific)
        if (promo.branch_id) {
          // Get student's branch
          const studentResult = await query(
            'SELECT branch_id FROM userstbl WHERE user_id = $1',
            [studentId]
          );
          const studentBranchId = studentResult.rows[0]?.branch_id;
          if (studentBranchId !== promo.branch_id) {
            continue;
          }
        }

        eligiblePromos.push(promo);
      }

      // Fetch packages and merchandise for each eligible promo
      const promosWithDetails = await Promise.all(
        eligiblePromos.map(async (promo) => {
          // Fetch packages from junction table
          const packagesResult = await query(
            `SELECT 
              pp.promopackage_id,
              pp.package_id,
              pkg.package_name,
              pkg.level_tag,
              pkg.package_price
             FROM promopackagestbl pp
             LEFT JOIN packagestbl pkg ON pp.package_id = pkg.package_id
             WHERE pp.promo_id = $1`,
            [promo.promo_id]
          );
          
          // If no packages in junction table, fall back to old package_id for backward compatibility
          let packages = packagesResult.rows;
          if (packages.length === 0 && promo.package_id) {
            const legacyPackageResult = await query(
              `SELECT 
                package_id,
                package_name,
                level_tag,
                package_price
               FROM packagestbl
               WHERE package_id = $1`,
              [promo.package_id]
            );
            if (legacyPackageResult.rows.length > 0) {
              packages = legacyPackageResult.rows.map(pkg => ({
                promopackage_id: null,
                package_id: pkg.package_id,
                package_name: pkg.package_name,
                level_tag: pkg.level_tag,
                package_price: pkg.package_price,
              }));
            }
          }

          const merchandiseResult = await query(
            `SELECT 
              pm.promomerchandise_id,
              pm.merchandise_id,
              pm.quantity,
              m.merchandise_name,
              m.size
             FROM promomerchandisetbl pm
             LEFT JOIN merchandisestbl m ON pm.merchandise_id = m.merchandise_id
             WHERE pm.promo_id = $1`,
            [promo.promo_id]
          );

          // Calculate discount amount (use down payment base for Installment packages)
          let discountAmount = 0;
          if (promo.promo_type === 'percentage_discount' && promo.discount_percentage) {
            discountAmount = (eligibilityBase * promo.discount_percentage) / 100;
          } else if (promo.promo_type === 'fixed_discount' && promo.discount_amount) {
            const fixed = parseFloat(promo.discount_amount);
            discountAmount = eligibilityBase != null ? Math.min(fixed, eligibilityBase) : fixed;
          }

          return {
            ...promo,
            packages: packages,
            package_ids: packages.map(p => p.package_id), // For easy filtering
            merchandise: merchandiseResult.rows,
            calculated_discount: discountAmount,
            final_price: Math.max(0, eligibilityBase - discountAmount),
          };
        })
      );

      res.json({
        success: true,
        data: promosWithDetails,
        package_info: {
          package_type: packageType,
          downpayment_amount: packageDownpayment,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/promos
 * Create new promo
 * Access: Superadmin, Admin
 */
router.post(
  '/',
  [
    body('promo_name').notEmpty().withMessage('Promo name is required'),
    body('package_ids').isArray({ min: 1 }).withMessage('At least one package is required'),
    body('package_ids.*').isInt().withMessage('Each package ID must be an integer'),
    // Keep package_id for backward compatibility (optional)
    body('package_id').optional().isInt().withMessage('Package ID must be an integer'),
    body('branch_id')
      .optional({ nullable: true, checkFalsy: true })
      .custom((value) => {
        if (value === null || value === undefined || value === '') return true;
        return Number.isInteger(parseInt(value));
      })
      .withMessage('Branch ID must be an integer or null'),
    body('promo_type').isIn(['percentage_discount', 'fixed_discount', 'free_merchandise', 'combined']).withMessage('Invalid promo type'),
    body('discount_percentage').optional({ nullable: true }).isFloat({ min: 0, max: 100 }).withMessage('Discount percentage must be between 0 and 100'),
    body('discount_amount').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Discount amount must be positive'),
    body('min_payment_amount').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Min payment amount must be positive'),
    body('start_date')
      .custom((value) => {
        if (!value) return false;
        const date = new Date(value);
        return !isNaN(date.getTime());
      })
      .withMessage('Start date must be a valid date'),
    body('end_date')
      .custom((value) => {
        if (!value) return false;
        const date = new Date(value);
        return !isNaN(date.getTime());
      })
      .withMessage('End date must be a valid date'),
    body('max_uses').optional({ nullable: true }).isInt({ min: 1 }).withMessage('Max uses must be a positive integer'),
    body('eligibility_type').optional().isIn(['all', 'new_students_only', 'existing_students_only', 'referral_only']).withMessage('Invalid eligibility type'),
    body('status').optional().isIn(['Active', 'Inactive']).withMessage('Status must be Active or Inactive'),
    body('description')
      .optional({ nullable: true, checkFalsy: true })
      .custom((value) => {
        if (value === null || value === undefined || value === '') return true;
        return typeof value === 'string';
      })
      .withMessage('Description must be a string'),
    body('merchandise').optional().isArray().withMessage('Merchandise must be an array'),
    body('promo_code')
      .optional({ nullable: true, checkFalsy: true })
      .trim()
      .isLength({ min: 4, max: 20 })
      .withMessage('Promo code must be 4-20 characters')
      .matches(/^[A-Z0-9-]+$/)
      .withMessage('Promo code must contain only uppercase letters, numbers, and hyphens'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const {
        promo_name,
        package_ids, // New: array of package IDs
        package_id, // Legacy: single package ID (for backward compatibility)
        branch_id,
        promo_type,
        promo_code, // Optional promo code
        discount_percentage,
        discount_amount,
        min_payment_amount,
        start_date,
        end_date,
        max_uses,
        eligibility_type = 'all',
        status = 'Active',
        description,
        merchandise = [],
        installment_apply_scope, // For Installment packages: downpayment, monthly, or both
        installment_months_to_apply, // Number of months to apply promo for monthly scope
      } = req.body;

      // Determine which packages to use (prefer package_ids array, fall back to package_id)
      const finalPackageIds = package_ids && Array.isArray(package_ids) && package_ids.length > 0
        ? package_ids
        : package_id
        ? [package_id]
        : [];

      if (finalPackageIds.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'At least one package is required',
        });
      }

      // Validate all packages exist
      const packagePlaceholders = finalPackageIds.map((_, i) => `$${i + 1}`).join(', ');
      const packageCheck = await client.query(
        `SELECT package_id FROM packagestbl WHERE package_id IN (${packagePlaceholders})`,
        finalPackageIds
      );
      
      if (packageCheck.rows.length !== finalPackageIds.length) {
        const foundIds = packageCheck.rows.map(r => r.package_id);
        const missingIds = finalPackageIds.filter(id => !foundIds.includes(id));
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `Package(s) not found: ${missingIds.join(', ')}`,
        });
      }

      // Validate branch exists if provided
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

      // Validate and normalize promo_code if provided
      let normalizedPromoCode = null;
      if (promo_code) {
        normalizedPromoCode = promo_code.trim().toUpperCase();
        
        // Check if promo code already exists
        const existingCodeCheck = await client.query(
          'SELECT promo_id FROM promostbl WHERE UPPER(promo_code) = $1',
          [normalizedPromoCode]
        );
        if (existingCodeCheck.rows.length > 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: 'Promo code already exists',
          });
        }
      }

      // Validate dates
      if (new Date(start_date) > new Date(end_date)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'End date must be after or equal to start date',
        });
      }

      // Validate promo type requirements
      if (promo_type === 'percentage_discount' && (!discount_percentage || discount_percentage <= 0 || discount_percentage > 100)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Percentage discount requires a valid percentage between 0 and 100',
        });
      }

      if (promo_type === 'fixed_discount' && (!discount_amount || discount_amount <= 0)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Fixed discount requires a valid discount amount',
        });
      }

      if (promo_type === 'free_merchandise' && (!merchandise || merchandise.length === 0) && promo_type !== 'combined') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Free merchandise promo requires at least one merchandise item',
        });
      }

      if (promo_type === 'combined' && (!discount_percentage && !discount_amount) && (!merchandise || merchandise.length === 0)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Combined promo requires at least a discount or merchandise',
        });
      }

      // Validate installment scope fields if provided
      if (installment_apply_scope !== undefined && installment_apply_scope !== null) {
        // Check if any selected package is Installment type
        const packageTypesResult = await client.query(
          `SELECT DISTINCT package_type FROM packagestbl WHERE package_id IN (${finalPackageIds.map((_, i) => `$${i + 1}`).join(', ')})`,
          finalPackageIds
        );
        const hasInstallmentPackage = packageTypesResult.rows.some(p => p.package_type === 'Installment');
        
        if (hasInstallmentPackage) {
          // Validate scope value
          if (!['downpayment', 'monthly', 'both'].includes(installment_apply_scope)) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              message: 'Installment apply scope must be downpayment, monthly, or both',
            });
          }
          
          // If scope includes monthly, months_to_apply is required
          if ((installment_apply_scope === 'monthly' || installment_apply_scope === 'both') && 
              (!installment_months_to_apply || installment_months_to_apply < 1)) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              message: 'installment_months_to_apply is required and must be at least 1 when scope includes monthly',
            });
          }
          
          // If scope is downpayment only, months_to_apply should be null
          if (installment_apply_scope === 'downpayment' && installment_months_to_apply !== null && installment_months_to_apply !== undefined) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              message: 'installment_months_to_apply should be null when scope is downpayment only',
            });
          }
        } else {
          // No Installment packages selected, clear installment scope fields
          installment_apply_scope = null;
          installment_months_to_apply = null;
        }
      } else {
        // If scope not provided but months_to_apply is, clear months_to_apply
        if (installment_months_to_apply !== undefined && installment_months_to_apply !== null) {
          installment_months_to_apply = null;
        }
      }

      // Create promo (use first package_id for backward compatibility, or null if using junction table only)
      const firstPackageId = finalPackageIds[0] || null;
      const promoResult = await client.query(
        `INSERT INTO promostbl (
          promo_name, package_id, branch_id, promo_type, promo_code, discount_percentage, 
          discount_amount, min_payment_amount, start_date, end_date, max_uses, 
          eligibility_type, status, description, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING *`,
        [
          promo_name,
          firstPackageId, // Keep for backward compatibility
          branch_id || null,
          promo_type,
          normalizedPromoCode, // Promo code (null for auto-apply promos)
          discount_percentage || null,
          discount_amount || null,
          min_payment_amount || null,
          start_date,
          end_date,
          max_uses || null,
          eligibility_type,
          status,
          description || null,
          req.user.userId || null,
        ]
      );

      const newPromo = promoResult.rows[0];

      // Create package associations in junction table
      for (const pkgId of finalPackageIds) {
        await client.query(
          'INSERT INTO promopackagestbl (promo_id, package_id) VALUES ($1, $2) ON CONFLICT (promo_id, package_id) DO NOTHING',
          [newPromo.promo_id, pkgId]
        );
      }

      // Add merchandise if provided
      if (merchandise && merchandise.length > 0) {
        for (const item of merchandise) {
          const { merchandise_id, quantity = 1 } = item;

          // Validate merchandise exists
          const merchCheck = await client.query('SELECT merchandise_id FROM merchandisestbl WHERE merchandise_id = $1', [merchandise_id]);
          if (merchCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              message: `Merchandise with ID ${merchandise_id} not found`,
            });
          }

          await client.query(
            'INSERT INTO promomerchandisetbl (promo_id, merchandise_id, quantity) VALUES ($1, $2, $3)',
            [newPromo.promo_id, merchandise_id, quantity]
          );
        }
      }

      await client.query('COMMIT');

      // Fetch complete promo with details
      const packagesResult = await query(
        `SELECT 
          pp.promopackage_id,
          pp.package_id,
          pkg.package_name,
          pkg.level_tag,
          pkg.package_price
         FROM promopackagestbl pp
         LEFT JOIN packagestbl pkg ON pp.package_id = pkg.package_id
         WHERE pp.promo_id = $1`,
        [newPromo.promo_id]
      );
      
      const merchandiseResult = await query(
        `SELECT 
          pm.promomerchandise_id,
          pm.merchandise_id,
          pm.quantity,
          m.merchandise_name,
          m.size
         FROM promomerchandisetbl pm
         LEFT JOIN merchandisestbl m ON pm.merchandise_id = m.merchandise_id
         WHERE pm.promo_id = $1`,
        [newPromo.promo_id]
      );

      res.status(201).json({
        success: true,
        message: 'Promo created successfully',
        data: {
          ...newPromo,
          packages: packagesResult.rows,
          package_ids: packagesResult.rows.map(p => p.package_id),
          merchandise: merchandiseResult.rows,
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
 * PUT /api/v1/promos/:id
 * Update promo
 * Access: Superadmin, Admin
 */
router.put(
  '/:id',
  [
    param('id').isInt().withMessage('Promo ID must be an integer'),
    body('promo_name').optional().notEmpty().withMessage('Promo name cannot be empty'),
    body('package_ids').optional().isArray({ min: 1 }).withMessage('At least one package is required if provided'),
    body('package_ids.*').optional().isInt().withMessage('Each package ID must be an integer'),
    body('package_id').optional().isInt().withMessage('Package ID must be an integer'),
    body('branch_id')
      .optional({ nullable: true, checkFalsy: true })
      .custom((value) => {
        if (value === null || value === undefined || value === '') return true;
        return Number.isInteger(parseInt(value));
      })
      .withMessage('Branch ID must be an integer or null'),
    body('promo_type').optional().isIn(['percentage_discount', 'fixed_discount', 'free_merchandise', 'combined']).withMessage('Invalid promo type'),
    body('discount_percentage').optional({ nullable: true }).isFloat({ min: 0, max: 100 }).withMessage('Discount percentage must be between 0 and 100'),
    body('discount_amount').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Discount amount must be positive'),
    body('min_payment_amount').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Min payment amount must be positive'),
    body('start_date')
      .optional()
      .custom((value) => {
        if (!value) return true;
        const date = new Date(value);
        return !isNaN(date.getTime());
      })
      .withMessage('Start date must be a valid date'),
    body('end_date')
      .optional()
      .custom((value) => {
        if (!value) return true;
        const date = new Date(value);
        return !isNaN(date.getTime());
      })
      .withMessage('End date must be a valid date'),
    body('max_uses').optional({ nullable: true }).isInt({ min: 1 }).withMessage('Max uses must be a positive integer'),
    body('eligibility_type').optional().isIn(['all', 'new_students_only', 'existing_students_only', 'referral_only']).withMessage('Invalid eligibility type'),
    body('status').optional().isIn(['Active', 'Inactive', 'Expired']).withMessage('Status must be Active, Inactive, or Expired'),
    body('description')
      .optional({ nullable: true, checkFalsy: true })
      .custom((value) => {
        if (value === null || value === undefined || value === '') return true;
        return typeof value === 'string';
      })
      .withMessage('Description must be a string'),
    body('promo_code')
      .optional({ nullable: true, checkFalsy: true })
      .trim()
      .isLength({ min: 4, max: 20 })
      .withMessage('Promo code must be 4-20 characters')
      .matches(/^[A-Z0-9-]+$/)
      .withMessage('Promo code must contain only uppercase letters, numbers, and hyphens'),
    body('installment_apply_scope')
      .optional({ nullable: true })
      .isIn(['downpayment', 'monthly', 'both'])
      .withMessage('Installment apply scope must be downpayment, monthly, or both'),
    body('installment_months_to_apply')
      .optional({ nullable: true })
      .isInt({ min: 1 })
      .withMessage('Installment months to apply must be a positive integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const {
        promo_name,
        package_ids, // New: array of package IDs
        package_id, // Legacy: single package ID (for backward compatibility)
        branch_id,
        promo_type,
        promo_code, // Optional promo code
        discount_percentage,
        discount_amount,
        min_payment_amount,
        start_date,
        end_date,
        max_uses,
        eligibility_type,
        status,
        description,
        merchandise, // For updating merchandise
        installment_apply_scope,
        installment_months_to_apply,
      } = req.body;

      // Check if promo exists
      const existingPromo = await query('SELECT * FROM promostbl WHERE promo_id = $1', [id]);
      if (existingPromo.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Promo not found',
        });
      }

      // Handle package_ids update if provided
      let finalPackageIds = null;
      if (package_ids !== undefined) {
        if (!Array.isArray(package_ids) || package_ids.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'At least one package is required',
          });
        }
        finalPackageIds = package_ids;
      } else if (package_id !== undefined) {
        // Legacy: single package_id
        finalPackageIds = [package_id];
      }

      // Validate packages if provided
      if (finalPackageIds !== null) {
        const packagePlaceholders = finalPackageIds.map((_, i) => `$${i + 1}`).join(', ');
        const packageCheck = await query(
          `SELECT package_id FROM packagestbl WHERE package_id IN (${packagePlaceholders})`,
          finalPackageIds
        );
        
        if (packageCheck.rows.length !== finalPackageIds.length) {
          const foundIds = packageCheck.rows.map(r => r.package_id);
          const missingIds = finalPackageIds.filter(id => !foundIds.includes(id));
          return res.status(400).json({
            success: false,
            message: `Package(s) not found: ${missingIds.join(', ')}`,
          });
        }
      }

      // Validate branch if provided
      if (branch_id !== undefined && branch_id !== null) {
        const branchCheck = await query('SELECT branch_id FROM branchestbl WHERE branch_id = $1', [branch_id]);
        if (branchCheck.rows.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'Branch not found',
          });
        }
      }

      // Validate and normalize promo_code if provided
      let normalizedPromoCode = undefined;
      if (promo_code !== undefined) {
        if (promo_code === null || promo_code === '') {
          normalizedPromoCode = null; // Allow clearing promo code
        } else {
          normalizedPromoCode = promo_code.trim().toUpperCase();
          
          // Check if promo code already exists (excluding current promo)
          const existingCodeCheck = await query(
            'SELECT promo_id FROM promostbl WHERE UPPER(promo_code) = $1 AND promo_id != $2',
            [normalizedPromoCode, id]
          );
          if (existingCodeCheck.rows.length > 0) {
            return res.status(400).json({
              success: false,
              message: 'Promo code already exists',
            });
          }
        }
      }

      // Validate dates if both provided
      if (start_date && end_date && new Date(start_date) > new Date(end_date)) {
        return res.status(400).json({
          success: false,
          message: 'End date must be after or equal to start date',
        });
      }

      // Validate installment scope fields if provided
      if (installment_apply_scope !== undefined && installment_apply_scope !== null) {
        // Get package types for validation
        let packageTypesToCheck = [];
        if (finalPackageIds !== null) {
          const packageTypesResult = await query(
            `SELECT DISTINCT package_type FROM packagestbl WHERE package_id IN (${finalPackageIds.map((_, i) => `$${i + 1}`).join(', ')})`,
            finalPackageIds
          );
          packageTypesToCheck = packageTypesResult.rows.map(p => p.package_type);
        } else {
          // Use existing promo's packages
          const existingPackagesResult = await query(
            `SELECT DISTINCT pkg.package_type 
             FROM promopackagestbl pp
             JOIN packagestbl pkg ON pp.package_id = pkg.package_id
             WHERE pp.promo_id = $1`,
            [id]
          );
          packageTypesToCheck = existingPackagesResult.rows.map(p => p.package_type);
        }
        
        const hasInstallmentPackage = packageTypesToCheck.some(p => p === 'Installment');
        
        if (hasInstallmentPackage) {
          // Validate scope value
          if (!['downpayment', 'monthly', 'both'].includes(installment_apply_scope)) {
            return res.status(400).json({
              success: false,
              message: 'Installment apply scope must be downpayment, monthly, or both',
            });
          }
          
          // If scope includes monthly, months_to_apply is required
          if ((installment_apply_scope === 'monthly' || installment_apply_scope === 'both') && 
              (!installment_months_to_apply || installment_months_to_apply < 1)) {
            return res.status(400).json({
              success: false,
              message: 'installment_months_to_apply is required and must be at least 1 when scope includes monthly',
            });
          }
          
          // If scope is downpayment only, months_to_apply should be null
          if (installment_apply_scope === 'downpayment' && installment_months_to_apply !== null && installment_months_to_apply !== undefined) {
            return res.status(400).json({
              success: false,
              message: 'installment_months_to_apply should be null when scope is downpayment only',
            });
          }
        } else {
          // No Installment packages, clear installment scope fields
          installment_apply_scope = null;
          installment_months_to_apply = null;
        }
      } else if (installment_apply_scope === null) {
        // Explicitly clearing the scope
        installment_months_to_apply = null;
      } else if (installment_months_to_apply !== undefined && installment_months_to_apply !== null && installment_apply_scope === undefined) {
        // If months_to_apply is provided but scope is not, clear months_to_apply
        installment_months_to_apply = null;
      }

      // Build update query
      const updates = [];
      const params = [];
      let paramCount = 0;

      // Build fields object, only including fields that are being updated
      const fields = {};
      
      // Helper to safely add field (only adds if value is not undefined)
      const addField = (key, value) => {
        if (value !== undefined) {
          // Convert null to null, or keep the value as-is (but never undefined)
          fields[key] = value === null ? null : value;
        }
      };
      
      addField('promo_name', promo_name);
      addField('promo_code', normalizedPromoCode);
      
      // Handle package_id update - only if explicitly provided
      if (finalPackageIds !== null) {
        fields.package_id = finalPackageIds.length > 0 ? finalPackageIds[0] : null;
      } else {
        addField('package_id', package_id);
      }
      
      addField('branch_id', branch_id);
      addField('promo_type', promo_type);
      addField('discount_percentage', discount_percentage);
      addField('discount_amount', discount_amount);
      addField('min_payment_amount', min_payment_amount);
      addField('start_date', start_date);
      addField('end_date', end_date);
      addField('max_uses', max_uses);
      addField('eligibility_type', eligibility_type);
      addField('status', status);
      addField('description', description);
      addField('installment_apply_scope', installment_apply_scope);
      addField('installment_months_to_apply', installment_months_to_apply);
      
      fields.updated_at = 'CURRENT_TIMESTAMP';

      // Build update query, ensuring no undefined values are passed
      Object.entries(fields).forEach(([key, value]) => {
          if (value === 'CURRENT_TIMESTAMP') {
            updates.push(`${key} = CURRENT_TIMESTAMP`);
          } else {
          // Double-check: ensure we never pass undefined to PostgreSQL
          if (value === undefined) {
            console.warn(`Warning: undefined value for field ${key}, converting to null`);
            value = null;
          }
          paramCount++;
            updates.push(`${key} = $${paramCount}`);
            params.push(value);
        }
      });

      if (updates.length > 0) {
        paramCount++;
        params.push(id);
        
        // Final safeguard: ensure no undefined values in params
        const safeParams = params.map((param, index) => {
          if (param === undefined) {
            console.error(`Error: undefined parameter at index ${index} in UPDATE query`);
            return null;
          }
          return param;
        });
        
        const sql = `UPDATE promostbl SET ${updates.join(', ')} WHERE promo_id = $${paramCount} RETURNING *`;
        await query(sql, safeParams);
      }

      // Update package associations in junction table if provided
      if (finalPackageIds !== null) {
        // Delete existing associations
        await query('DELETE FROM promopackagestbl WHERE promo_id = $1', [id]);
        
        // Insert new associations
        for (const pkgId of finalPackageIds) {
          await query(
            'INSERT INTO promopackagestbl (promo_id, package_id) VALUES ($1, $2)',
            [id, pkgId]
          );
        }
      }

      // Fetch updated promo with details
      const promoResult = await query('SELECT * FROM promostbl WHERE promo_id = $1', [id]);
      
      // Fetch packages from junction table
      const packagesResult = await query(
        `SELECT 
          pp.promopackage_id,
          pp.package_id,
          pkg.package_name,
          pkg.level_tag,
          pkg.package_price
         FROM promopackagestbl pp
         LEFT JOIN packagestbl pkg ON pp.package_id = pkg.package_id
         WHERE pp.promo_id = $1`,
        [id]
      );
      
      // If no packages in junction table, fall back to old package_id for backward compatibility
      let packages = packagesResult.rows;
      if (packages.length === 0 && promoResult.rows[0].package_id) {
        const legacyPackageResult = await query(
          `SELECT 
            package_id,
            package_name,
            level_tag,
            package_price
           FROM packagestbl
           WHERE package_id = $1`,
          [promoResult.rows[0].package_id]
        );
        if (legacyPackageResult.rows.length > 0) {
          packages = legacyPackageResult.rows.map(pkg => ({
            promopackage_id: null,
            package_id: pkg.package_id,
            package_name: pkg.package_name,
            level_tag: pkg.level_tag,
            package_price: pkg.package_price,
          }));
        }
      }
      
      const merchandiseResult = await query(
        `SELECT 
          pm.promomerchandise_id,
          pm.merchandise_id,
          pm.quantity,
          m.merchandise_name,
          m.size
         FROM promomerchandisetbl pm
         LEFT JOIN merchandisestbl m ON pm.merchandise_id = m.merchandise_id
         WHERE pm.promo_id = $1`,
        [id]
      );

      res.json({
        success: true,
        message: 'Promo updated successfully',
        data: {
          ...promoResult.rows[0],
          packages: packages,
          package_ids: packages.map(p => p.package_id),
          merchandise: merchandiseResult.rows,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/v1/promos/:id
 * Delete promo
 * Access: Superadmin, Admin
 */
router.delete(
  '/:id',
  [
    param('id').isInt().withMessage('Promo ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { id } = req.params;

      const existingPromo = await client.query('SELECT * FROM promostbl WHERE promo_id = $1', [id]);
      if (existingPromo.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Promo not found',
        });
      }

      // Delete promo merchandise (CASCADE will handle this, but being explicit)
      await client.query('DELETE FROM promomerchandisetbl WHERE promo_id = $1', [id]);

      // Delete promo usage records
      await client.query('DELETE FROM promousagetbl WHERE promo_id = $1', [id]);

      // Delete promo
      await client.query('DELETE FROM promostbl WHERE promo_id = $1', [id]);

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Promo deleted successfully',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      // Check for foreign key constraint violations
      if (error.code === '23503') {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete promo. It is being used by one or more invoices.',
        });
      }
      next(error);
    } finally {
      client.release();
    }
  }
);

/**
 * POST /api/v1/promos/:id/merchandise
 * Add merchandise to promo
 * Access: Superadmin, Admin
 */
router.post(
  '/:id/merchandise',
  [
    param('id').isInt().withMessage('Promo ID must be an integer'),
    body('merchandise_id').isInt().withMessage('Merchandise ID is required'),
    body('quantity').optional().isInt({ min: 1 }).withMessage('Quantity must be a positive integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { merchandise_id, quantity = 1 } = req.body;

      // Check if promo exists
      const promoCheck = await query('SELECT promo_id FROM promostbl WHERE promo_id = $1', [id]);
      if (promoCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Promo not found',
        });
      }

      // Validate merchandise exists
      const merchCheck = await query('SELECT merchandise_id FROM merchandisestbl WHERE merchandise_id = $1', [merchandise_id]);
      if (merchCheck.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Merchandise not found',
        });
      }

      // Check if already added
      const existingCheck = await query(
        'SELECT promomerchandise_id FROM promomerchandisetbl WHERE promo_id = $1 AND merchandise_id = $2',
        [id, merchandise_id]
      );
      if (existingCheck.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Merchandise already added to this promo',
        });
      }

      const result = await query(
        'INSERT INTO promomerchandisetbl (promo_id, merchandise_id, quantity) VALUES ($1, $2, $3) RETURNING *',
        [id, merchandise_id, quantity]
      );

      res.status(201).json({
        success: true,
        message: 'Merchandise added to promo successfully',
        data: result.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/v1/promos/:id/merchandise/:merchandiseId
 * Remove merchandise from promo
 * Access: Superadmin, Admin
 */
router.delete(
  '/:id/merchandise/:merchandiseId',
  [
    param('id').isInt().withMessage('Promo ID must be an integer'),
    param('merchandiseId').isInt().withMessage('Merchandise ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id, merchandiseId } = req.params;

      // Verify merchandise belongs to promo
      const detailCheck = await query(
        'SELECT * FROM promomerchandisetbl WHERE promo_id = $1 AND merchandise_id = $2',
        [id, merchandiseId]
      );
      if (detailCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Merchandise not found in this promo',
        });
      }

      await query('DELETE FROM promomerchandisetbl WHERE promo_id = $1 AND merchandise_id = $2', [id, merchandiseId]);

      res.json({
        success: true,
        message: 'Merchandise removed from promo successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/promos/validate-code
 * Validate a promo code and return promo details if valid
 * Access: All authenticated users
 */
router.post(
  '/validate-code',
  [
    body('promo_code').notEmpty().trim().withMessage('Promo code is required'),
    body('package_id').optional().isInt().withMessage('Package ID must be an integer'),
    body('student_id').optional().isInt().withMessage('Student ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { promo_code, package_id, student_id } = req.body;
      const normalizedCode = promo_code.trim().toUpperCase();

      // Find promo by code
      const promoResult = await query(
        `SELECT 
          p.promo_id,
          p.promo_name,
          p.promo_type,
          p.promo_code,
          p.discount_percentage,
          p.discount_amount,
          p.min_payment_amount,
          TO_CHAR(p.start_date, 'YYYY-MM-DD') as start_date,
          TO_CHAR(p.end_date, 'YYYY-MM-DD') as end_date,
          p.max_uses,
          p.current_uses,
          p.eligibility_type,
          p.status,
          p.description,
          p.branch_id,
          p.installment_apply_scope,
          p.installment_months_to_apply
        FROM promostbl p
        WHERE UPPER(p.promo_code) = $1`,
        [normalizedCode]
      );

      if (promoResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Invalid promo code',
        });
      }

      const promo = promoResult.rows[0];

      // Check if promo is active
      if (promo.status !== 'Active') {
        return res.status(400).json({
          success: false,
          message: 'Promo code is not active',
        });
      }

      // Check date validity
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const startDate = promo.start_date ? new Date(promo.start_date) : null;
      const endDate = promo.end_date ? new Date(promo.end_date) : null;
      
      if (startDate) startDate.setHours(0, 0, 0, 0);
      if (endDate) endDate.setHours(23, 59, 59, 999);

      if (startDate && today < startDate) {
        return res.status(400).json({
          success: false,
          message: 'Promo code is not yet valid',
        });
      }

      if (endDate && today > endDate) {
        return res.status(400).json({
          success: false,
          message: 'Promo code has expired',
        });
      }

      // Check usage limits
      if (promo.max_uses !== null && promo.max_uses !== undefined) {
        if ((promo.current_uses || 0) >= promo.max_uses) {
          return res.status(400).json({
            success: false,
            message: 'Promo code has reached maximum uses',
          });
        }
      }

      // If package_id is provided, check if promo applies to this package
      if (package_id) {
        const packageCheck = await query(
          `SELECT 1 FROM promopackagestbl 
           WHERE promo_id = $1 AND package_id = $2`,
          [promo.promo_id, package_id]
        );
        
        if (packageCheck.rows.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'Promo code does not apply to this package',
          });
        }
      }

      // If student_id is provided, check eligibility and previous usage
      if (student_id) {
        // Check if student already used this promo
        const usageCheck = await query(
          'SELECT promousage_id FROM promousagetbl WHERE promo_id = $1 AND student_id = $2',
          [promo.promo_id, student_id]
        );
        if (usageCheck.rows.length > 0) {
          return res.status(400).json({
            success: false,
            message: 'You have already used this promo code',
          });
        }

        // Check student eligibility
        const enrollmentCheck = await query(
          'SELECT COUNT(*) as count FROM classstudentstbl WHERE student_id = $1',
          [student_id]
        );
        const enrollmentCount = parseInt(enrollmentCheck.rows[0]?.count || 0);
        const isNewStudent = enrollmentCount === 0;
        const isExistingStudent = enrollmentCount > 0;

        const referralCheck = await query(
          'SELECT referral_id, status FROM referralstbl WHERE referred_student_id = $1',
          [student_id]
        );
        const hasReferral = referralCheck.rows.length > 0 && referralCheck.rows[0].status === 'Verified';

        let isEligible = false;
        switch (promo.eligibility_type) {
          case 'all':
            isEligible = true;
            break;
          case 'new_students_only':
            isEligible = isNewStudent;
            break;
          case 'existing_students_only':
            isEligible = isExistingStudent;
            break;
          case 'referral_only':
            isEligible = hasReferral;
            break;
          default:
            isEligible = true;
        }

        if (!isEligible) {
          return res.status(400).json({
            success: false,
            message: 'You are not eligible for this promo code',
          });
        }
      }

      // Fetch packages for this promo
      const packagesResult = await query(
        `SELECT 
          pp.promopackage_id,
          pp.package_id,
          pkg.package_name,
          pkg.level_tag,
          pkg.package_price
         FROM promopackagestbl pp
         LEFT JOIN packagestbl pkg ON pp.package_id = pkg.package_id
         WHERE pp.promo_id = $1`,
        [promo.promo_id]
      );

      // Fetch merchandise for this promo
      const merchandiseResult = await query(
        `SELECT 
          pm.promomerchandise_id,
          pm.merchandise_id,
          pm.quantity,
          m.merchandise_name,
          m.size
         FROM promomerchandisetbl pm
         LEFT JOIN merchandisestbl m ON pm.merchandise_id = m.merchandise_id
         WHERE pm.promo_id = $1`,
        [promo.promo_id]
      );

      res.json({
        success: true,
        message: 'Promo code is valid',
        data: {
          ...promo,
          packages: packagesResult.rows,
          package_ids: packagesResult.rows.map(p => p.package_id),
          merchandise: merchandiseResult.rows,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;

