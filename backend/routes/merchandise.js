import express from 'express';
import { body, param, query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole, requireBranchAccess } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query } from '../config/database.js';
import { PACKAGE_UNIFORM_TYPE_NAMES } from '../lib/merchandiseReleaseLog.js';
import { isUniformLikeCategory } from '../services/inventory/inventoryFieldMapping.js';

const router = express.Router();

/** Keep aligned with frontend isUniformMerchandiseName / UNIFORM_TOP_BOTTOM_TYPE_NAMES. */
function isUniformMerchandiseName(merchandiseName) {
  const name = String(merchandiseName || '').trim();
  if (!name) return false;
  if (PACKAGE_UNIFORM_TYPE_NAMES.includes(name)) return true;
  if (isUniformLikeCategory(name)) return true;
  return name.toLowerCase().includes('uniform');
}

const ALLOWED_UNIFORM_PIECE_TYPES = [
  'Polo',
  'Short',
  'Blouse',
  'Skirt',
  'Shirt',
  'Pants',
  'Top',
  'Bottom',
  'Logo 1',
  'Logo 2',
];

/**
 * Uniforms are always separate upper/lower SKUs; size, gender, and piece are required.
 * RHET-aligned: Male/Female/Unisex · XS…5XL · Polo/Short/…/Logo 1/Logo 2 (LCA Shirt)
 * Legacy Men/Women and Top/Bottom still accepted and normalized on write.
 * @returns {string|null} error message or null if ok
 */
function validateUniformPieceFields(merchandiseName, size, gender, type) {
  if (!isUniformMerchandiseName(merchandiseName)) return null;
  const sizeText = String(size || '').trim();
  if (!sizeText || ['n/a', 'na'].includes(sizeText.toLowerCase())) {
    return 'Size is required for uniforms (cannot be blank or N/A)';
  }
  const g = String(gender || '').trim();
  if (!g || !['Male', 'Female', 'Unisex', 'Men', 'Women'].includes(g)) {
    return 'Gender is required for uniforms (Male, Female, or Unisex)';
  }
  const t = String(type || '').trim();
  if (!t || !ALLOWED_UNIFORM_PIECE_TYPES.includes(t)) {
    return 'Piece is required for uniforms (Polo/Short/Blouse/Skirt, Shirt/Pants for PE, Logo 1/Logo 2 for Shirt)';
  }
  return null;
}

const GENDER_TO_CANONICAL = {
  Men: 'Male',
  Male: 'Male',
  Women: 'Female',
  Female: 'Female',
  Unisex: 'Unisex',
};

const SIZE_TO_CANONICAL = {
  'Extra Small': 'XS',
  Small: 'S',
  Medium: 'M',
  Large: 'L',
  'Extra Large': 'XL',
  XS: 'XS',
  S: 'S',
  M: 'M',
  L: 'L',
  XL: 'XL',
  '2XL': '2XL',
  '3XL': '3XL',
  '4XL': '4XL',
  '5XL': '5XL',
  Teen: 'Teen',
};

const CATEGORY_TO_CANONICAL = {
  'LCA Uniform': 'School Uniform',
  'School Uniform': 'School Uniform',
  'LCA PE Uniform': 'PE Uniform',
  'PE Uniform': 'PE Uniform',
  'LCA Bag': 'Backpack',
  Bag: 'Backpack',
  Backpack: 'Backpack',
  'LCA T-Shirt': 'LCA T-Shirt',
  'LCA Tshirt': 'LCA T-Shirt',
  Shirt: 'Shirt',
  'LCA Shirt': 'Shirt',
};

function normalizeMerchandisePayload(body = {}) {
  const name = String(body.merchandise_name || '').trim();
  const genderRaw = body.gender != null && body.gender !== '' ? String(body.gender).trim() : null;
  const sizeRaw = body.size != null && body.size !== '' ? String(body.size).trim() : null;
  const typeRaw = body.type != null && body.type !== '' ? String(body.type).trim() : null;

  let type = typeRaw;
  if (type === 'Top') type = 'Polo';
  if (type === 'Bottom') type = 'Short';

  return {
    merchandise_name: CATEGORY_TO_CANONICAL[name] || name,
    gender: genderRaw ? GENDER_TO_CANONICAL[genderRaw] || genderRaw : null,
    size: sizeRaw ? SIZE_TO_CANONICAL[sizeRaw] || sizeRaw : null,
    type: type || null,
  };
}

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
    body('gender')
      .optional({ nullable: true, checkFalsy: true })
      .isIn(['Male', 'Female', 'Unisex', 'Men', 'Women', null, ''])
      .withMessage('Gender must be one of: Male, Female, Unisex'),
    body('type')
      .optional({ nullable: true, checkFalsy: true })
      .isIn([...ALLOWED_UNIFORM_PIECE_TYPES, null, ''])
      .withMessage(
        'Type must be one of: Polo, Short, Blouse, Skirt, Shirt, Pants, Logo 1, Logo 2 (or legacy Top, Bottom)'
      ),
    body('image_url').optional({ nullable: true, checkFalsy: true }).isURL().withMessage('Image URL must be a valid URL'),
    body('remarks').optional({ nullable: true, checkFalsy: true }).isString().withMessage('Remarks must be a string'),
    body('item_name').optional({ nullable: true, checkFalsy: true }).isString().withMessage('Item name must be a string'),
    body('sku').optional({ nullable: true, checkFalsy: true }).isString().withMessage('SKU must be a string'),
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
            IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = 'merchandisestbl' AND column_name = 'remarks'
            ) THEN
              ALTER TABLE merchandisestbl ADD COLUMN remarks TEXT;
            END IF;
            IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = 'merchandisestbl' AND column_name = 'item_name'
            ) THEN
              ALTER TABLE merchandisestbl ADD COLUMN item_name VARCHAR(255);
            END IF;
            IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = 'merchandisestbl' AND column_name = 'sku'
            ) THEN
              ALTER TABLE merchandisestbl ADD COLUMN sku VARCHAR(64);
            END IF;
          END $$;
        `);
      } catch (err) {
        console.log('Column check:', err.message);
      }

      const normalized = normalizeMerchandisePayload(req.body);
      const merchandise_name = normalized.merchandise_name;
      const size = normalized.size;
      const gender = normalized.gender;
      const type = normalized.type;
      const { quantity, price, branch_id, image_url, remarks } = req.body;
      const item_name = String(req.body.item_name || '').trim() || null;
      const sku = String(req.body.sku || '').trim() || null;

      // Learning Kit is allowed as a local type/category (RHET categoryName).
      // Does not create RHET warehouse kits — stock is credited on fulfill.

      const uniformError = validateUniformPieceFields(merchandise_name, size, gender, type);
      if (uniformError) {
        return res.status(400).json({
          success: false,
          message: uniformError,
        });
      }

      // Non-uniform / Learning Kit: concrete item identity required when creating stock qty
      const hasQuantity =
        quantity !== null && quantity !== undefined && quantity !== '';
      if (!isUniformMerchandiseName(merchandise_name) && hasQuantity) {
        if (!item_name) {
          return res.status(400).json({
            success: false,
            message:
              'Item name is required for non-uniform merchandise (e.g. Workbooks, Backpack, Learning Kit).',
          });
        }
        if (!sku) {
          return res.status(400).json({
            success: false,
            message:
              'SKU is required for non-uniform merchandise so Stocks can show distinct item rows.',
          });
        }
      }

      // Uniforms are unique per branch + name + size + gender + piece
      if (isUniformMerchandiseName(merchandise_name) && branch_id) {
        const duplicateCheck = await query(
          `SELECT merchandise_id, merchandise_name, size, gender, type, quantity
           FROM merchandisestbl
           WHERE branch_id = $1
             AND merchandise_name = $2
             AND COALESCE(TRIM(size), '') = COALESCE(TRIM($3::text), '')
             AND COALESCE(TRIM(gender), '') = COALESCE(TRIM($4::text), '')
             AND COALESCE(TRIM(type), '') = COALESCE(TRIM($5::text), '')
           LIMIT 1`,
          [
            parseInt(branch_id, 10),
            merchandise_name,
            size || '',
            gender || '',
            type || '',
          ]
        );
        if (duplicateCheck.rows.length > 0) {
          const row = duplicateCheck.rows[0];
          return res.status(409).json({
            success: false,
            message: `Stock already exists for ${row.gender || gender} · ${row.type || type} · ${row.size || size}. Edit the existing stock to adjust quantity instead of creating a duplicate.`,
            data: { existing_merchandise_id: row.merchandise_id },
          });
        }
      }

      // Non-uniform: unique per branch + category + item_name
      if (!isUniformMerchandiseName(merchandise_name) && branch_id && item_name) {
        const duplicateCheck = await query(
          `SELECT merchandise_id, merchandise_name, item_name, quantity
           FROM merchandisestbl
           WHERE branch_id = $1
             AND merchandise_name = $2
             AND LOWER(TRIM(COALESCE(item_name, ''))) = LOWER(TRIM($3::text))
           LIMIT 1`,
          [parseInt(branch_id, 10), merchandise_name, item_name]
        );
        if (duplicateCheck.rows.length > 0) {
          const row = duplicateCheck.rows[0];
          return res.status(409).json({
            success: false,
            message: `Stock already exists for ${merchandise_name} / ${row.item_name || item_name}. Edit the existing stock to adjust quantity instead of creating a duplicate.`,
            data: { existing_merchandise_id: row.merchandise_id },
          });
        }
      }

      const result = await query(
        `INSERT INTO merchandisestbl (merchandise_name, size, quantity, price, branch_id, gender, type, image_url, remarks, item_name, sku)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          merchandise_name,
          size || null,
          quantity || null,
          price || null,
          branch_id ? parseInt(branch_id) : null,
          gender || null,
          type || null,
          image_url || null,
          remarks || null,
          isUniformMerchandiseName(merchandise_name) ? null : item_name,
          isUniformMerchandiseName(merchandise_name) ? null : sku,
        ]
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
    body('gender')
      .optional({ nullable: true, checkFalsy: true })
      .isIn(['Male', 'Female', 'Unisex', 'Men', 'Women', null, ''])
      .withMessage('Gender must be one of: Male, Female, Unisex'),
    body('type')
      .optional({ nullable: true, checkFalsy: true })
      .isIn([...ALLOWED_UNIFORM_PIECE_TYPES, null, ''])
      .withMessage(
        'Type must be one of: Polo, Short, Blouse, Skirt, Shirt, Pants, Logo 1, Logo 2 (or legacy Top, Bottom)'
      ),
    body('image_url').optional({ nullable: true, checkFalsy: true }).isURL().withMessage('Image URL must be a valid URL'),
    body('remarks').optional({ nullable: true, checkFalsy: true }).isString().withMessage('Remarks must be a string'),
    body('item_name').optional({ nullable: true, checkFalsy: true }).isString().withMessage('Item name must be a string'),
    body('sku').optional({ nullable: true, checkFalsy: true }).isString().withMessage('SKU must be a string'),
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
            IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = 'merchandisestbl' AND column_name = 'remarks'
            ) THEN
              ALTER TABLE merchandisestbl ADD COLUMN remarks TEXT;
            END IF;
            IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = 'merchandisestbl' AND column_name = 'item_name'
            ) THEN
              ALTER TABLE merchandisestbl ADD COLUMN item_name VARCHAR(255);
            END IF;
            IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = 'merchandisestbl' AND column_name = 'sku'
            ) THEN
              ALTER TABLE merchandisestbl ADD COLUMN sku VARCHAR(64);
            END IF;
          END $$;
        `);
      } catch (err) {
        console.log('Column check:', err.message);
      }

      const { id } = req.params;
      const { quantity, price, branch_id, image_url, remarks } = req.body;
      const item_name =
        req.body.item_name !== undefined
          ? String(req.body.item_name || '').trim() || null
          : undefined;
      const sku =
        req.body.sku !== undefined ? String(req.body.sku || '').trim() || null : undefined;
      const normalized = normalizeMerchandisePayload({
        merchandise_name:
          req.body.merchandise_name !== undefined
            ? req.body.merchandise_name
            : undefined,
        gender: req.body.gender !== undefined ? req.body.gender : undefined,
        size: req.body.size !== undefined ? req.body.size : undefined,
        type: req.body.type !== undefined ? req.body.type : undefined,
      });
      // Only overwrite fields that were actually sent
      const merchandise_name =
        req.body.merchandise_name !== undefined ? normalized.merchandise_name : undefined;
      const size = req.body.size !== undefined ? normalized.size : undefined;
      const gender = req.body.gender !== undefined ? normalized.gender : undefined;
      const type = req.body.type !== undefined ? normalized.type : undefined;

      // Learning Kit local type updates allowed (same as create — local only).

      // Build update query dynamically
      const existingMerchandise = await query('SELECT * FROM merchandisestbl WHERE merchandise_id = $1', [id]);
      if (existingMerchandise.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Merchandise not found',
        });
      }

      const existing = existingMerchandise.rows[0];
      const touchesStockPieceFields =
        merchandise_name !== undefined ||
        size !== undefined ||
        gender !== undefined ||
        type !== undefined;
      if (touchesStockPieceFields) {
        const mergedName =
          merchandise_name !== undefined ? merchandise_name : existing.merchandise_name;
        const mergedSize = size !== undefined ? size : existing.size;
        const mergedGender = gender !== undefined ? gender : existing.gender;
        const mergedType = type !== undefined ? type : existing.type;
        const uniformError = validateUniformPieceFields(
          mergedName,
          mergedSize,
          mergedGender,
          mergedType
        );
        if (uniformError) {
          return res.status(400).json({
            success: false,
            message: uniformError,
          });
        }

        if (isUniformMerchandiseName(mergedName)) {
          const branchForDup =
            branch_id !== undefined && branch_id !== null && branch_id !== ''
              ? parseInt(branch_id, 10)
              : existing.branch_id;
          if (branchForDup) {
            const duplicateCheck = await query(
              `SELECT merchandise_id, size, gender, type
               FROM merchandisestbl
               WHERE branch_id = $1
                 AND merchandise_name = $2
                 AND COALESCE(TRIM(size), '') = COALESCE(TRIM($3::text), '')
                 AND COALESCE(TRIM(gender), '') = COALESCE(TRIM($4::text), '')
                 AND COALESCE(TRIM(type), '') = COALESCE(TRIM($5::text), '')
                 AND merchandise_id <> $6
               LIMIT 1`,
              [
                branchForDup,
                mergedName,
                mergedSize || null,
                mergedGender || null,
                mergedType || null,
                parseInt(id, 10),
              ]
            );
            if (duplicateCheck.rows.length > 0) {
              const row = duplicateCheck.rows[0];
              return res.status(409).json({
                success: false,
                message: `Stock already exists for ${row.gender || mergedGender} · ${row.type || mergedType} · ${row.size || mergedSize}. Edit that stock row to adjust quantity instead.`,
                data: { existing_merchandise_id: row.merchandise_id },
              });
            }
          }
        }
      }

      const mergedNameForItem =
        merchandise_name !== undefined ? merchandise_name : existing.merchandise_name;
      const mergedItemName =
        item_name !== undefined ? item_name : existing.item_name || null;
      const mergedSku = sku !== undefined ? sku : existing.sku || null;
      if (
        !isUniformMerchandiseName(mergedNameForItem) &&
        (item_name !== undefined || quantity !== undefined || sku !== undefined)
      ) {
        if (!mergedItemName) {
          return res.status(400).json({
            success: false,
            message:
              'Item name is required for non-uniform merchandise (e.g. Workbooks, Backpack, Learning Kit).',
          });
        }
        if (!mergedSku) {
          return res.status(400).json({
            success: false,
            message:
              'SKU is required for non-uniform merchandise so Stocks can show distinct item rows.',
          });
        }
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
        image_url: image_url !== undefined ? (image_url || null) : undefined,
        remarks: remarks !== undefined ? (remarks || null) : undefined,
        item_name:
          item_name !== undefined
            ? isUniformMerchandiseName(mergedNameForItem)
              ? null
              : item_name
            : undefined,
        sku:
          sku !== undefined
            ? isUniformMerchandiseName(mergedNameForItem)
              ? null
              : sku
            : undefined,
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

