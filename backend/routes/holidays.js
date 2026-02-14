import express from 'express';
import { body, param, query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query } from '../config/database.js';

const router = express.Router();

router.use(verifyFirebaseToken);

const rangeValidators = [
  queryValidator('start_date')
    .notEmpty()
    .withMessage('start_date is required')
    .isISO8601()
    .withMessage('start_date must be a valid date (YYYY-MM-DD)'),
  queryValidator('end_date')
    .notEmpty()
    .withMessage('end_date is required')
    .isISO8601()
    .withMessage('end_date must be a valid date (YYYY-MM-DD)'),
  handleValidationErrors,
];

/**
 * GET /api/sms/holidays?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&branch_id= (optional)
 * Returns holidays from the Holidays page (custom_holidaystbl). No hardcoded national holidays.
 * Superadmin: sees all. Admin: sees only global (branch_id null) + their branch's custom holidays.
 */
router.get(
  '/',
  rangeValidators,
  async (req, res, next) => {
    try {
      const { start_date, end_date, branch_id: queryBranchId } = req.query;
      const isSuperadmin = req.user.userType === 'Superadmin';
      const userBranchId = req.user.branchId ?? req.user.branch_id;

      let customSql = `
        SELECT holiday_id, name, holiday_date::text as date, branch_id, description, created_at
        FROM custom_holidaystbl
        WHERE holiday_date >= $1 AND holiday_date <= $2
      `;
      const customParams = [start_date, end_date];

      if (!isSuperadmin && userBranchId != null) {
        customSql += ' AND (branch_id IS NULL OR branch_id = $3)';
        customParams.push(userBranchId);
      } else if (queryBranchId !== undefined && queryBranchId !== '' && isSuperadmin) {
        if (queryBranchId === 'null' || queryBranchId === '') {
          customSql += ' AND branch_id IS NULL';
        } else {
          customSql += ' AND branch_id = $3';
          customParams.push(queryBranchId);
        }
      }

      customSql += ' ORDER BY holiday_date, name';

      const customResult = await query(customSql, customParams);
      const data = customResult.rows.map((row) => ({
        holiday_id: row.holiday_id,
        date: row.date,
        name: row.name,
        source: 'custom',
        branch_id: row.branch_id,
        description: row.description || null,
      }));

      res.json({
        success: true,
        data,
        meta: {
          start_date,
          end_date,
          total: data.length,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/sms/holidays/national?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
 * Returns holidays from the Holidays page (same as GET /holidays). Kept for backward compatibility.
 */
router.get(
  '/national',
  rangeValidators,
  async (req, res, next) => {
    try {
      const { start_date, end_date } = req.query;
      const isSuperadmin = req.user.userType === 'Superadmin';
      const userBranchId = req.user.branchId ?? req.user.branch_id;

      let sql = `
        SELECT holiday_date::text as date, name
        FROM custom_holidaystbl
        WHERE holiday_date >= $1 AND holiday_date <= $2
      `;
      const params = [start_date, end_date];
      if (!isSuperadmin && userBranchId != null) {
        sql += ' AND (branch_id IS NULL OR branch_id = $3)';
        params.push(userBranchId);
      }
      sql += ' ORDER BY holiday_date';
      const result = await query(sql, params);
      const holidays = result.rows.map((r) => ({ date: r.date, name: r.name }));

      res.json({
        success: true,
        data: holidays,
        meta: { start_date, end_date, total: holidays.length },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/sms/holidays - Create custom holiday (Superadmin, Admin)
 */
router.post(
  '/',
  requireRole('Superadmin', 'Admin'),
  [
    body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 255 }).withMessage('Name too long'),
    body('holiday_date')
      .notEmpty()
      .withMessage('Holiday date is required')
      .isISO8601()
      .withMessage('holiday_date must be YYYY-MM-DD'),
    body('branch_id').optional({ nullable: true }).isInt().withMessage('branch_id must be an integer'),
    body('description').optional().trim().isLength({ max: 2000 }).withMessage('Description too long'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { name, holiday_date, branch_id: bodyBranchId, description } = req.body;
      const isSuperadmin = req.user.userType === 'Superadmin';
      const userBranchId = req.user.branchId ?? req.user.branch_id;

      let branch_id = bodyBranchId === '' || bodyBranchId === undefined ? null : bodyBranchId;
      if (!isSuperadmin) {
        branch_id = userBranchId ?? null;
      }

      const insertResult = await query(
        `INSERT INTO custom_holidaystbl (name, holiday_date, branch_id, description, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING holiday_id, name, holiday_date::text as date, branch_id, description, created_at`,
        [name.trim(), holiday_date, branch_id, description?.trim() || null, req.user.userId ?? req.user.user_id]
      );

      const row = insertResult.rows[0];
      res.status(201).json({
        success: true,
        message: 'Custom holiday created',
        data: {
          holiday_id: row.holiday_id,
          date: row.date,
          name: row.name,
          source: 'custom',
          branch_id: row.branch_id,
          description: row.description,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/sms/holidays/custom/:id - Get one custom holiday (for edit)
 */
router.get(
  '/custom/:id',
  requireRole('Superadmin', 'Admin'),
  [param('id').isInt().withMessage('Invalid holiday ID'), handleValidationErrors],
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const isSuperadmin = req.user.userType === 'Superadmin';
      const userBranchId = req.user.branchId ?? req.user.branch_id;

      const result = await query(
        'SELECT holiday_id, name, holiday_date::text as date, branch_id, description, created_at FROM custom_holidaystbl WHERE holiday_id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Custom holiday not found' });
      }

      const row = result.rows[0];
      if (!isSuperadmin && (row.branch_id != null && row.branch_id !== userBranchId)) {
        return res.status(403).json({ success: false, message: 'Access denied to this holiday' });
      }

      res.json({
        success: true,
        data: {
          holiday_id: row.holiday_id,
          date: row.date,
          name: row.name,
          branch_id: row.branch_id,
          description: row.description,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/sms/holidays/custom/:id - Update custom holiday
 */
router.put(
  '/custom/:id',
  requireRole('Superadmin', 'Admin'),
  [
    param('id').isInt().withMessage('Invalid holiday ID'),
    body('name').optional().trim().isLength({ min: 1, max: 255 }).withMessage('Name must be 1–255 characters'),
    body('holiday_date').optional().isISO8601().withMessage('holiday_date must be YYYY-MM-DD'),
    body('branch_id').optional({ nullable: true }).isInt().withMessage('branch_id must be an integer'),
    body('description').optional().trim().isLength({ max: 2000 }).withMessage('Description too long'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { name, holiday_date, branch_id: bodyBranchId, description } = req.body;
      const isSuperadmin = req.user.userType === 'Superadmin';
      const userBranchId = req.user.branchId ?? req.user.branch_id;

      const existing = await query(
        'SELECT holiday_id, branch_id FROM custom_holidaystbl WHERE holiday_id = $1',
        [id]
      );

      if (existing.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Custom holiday not found' });
      }

      if (!isSuperadmin && (existing.rows[0].branch_id != null && existing.rows[0].branch_id !== userBranchId)) {
        return res.status(403).json({ success: false, message: 'Access denied to this holiday' });
      }

      let branch_id = bodyBranchId === '' || bodyBranchId === undefined ? undefined : bodyBranchId;
      if (!isSuperadmin && branch_id !== undefined) {
        branch_id = userBranchId ?? null;
      }

      const updates = [];
      const params = [];
      let p = 1;
      if (name !== undefined) {
        updates.push(`name = $${p++}`);
        params.push(name.trim());
      }
      if (holiday_date !== undefined) {
        updates.push(`holiday_date = $${p++}`);
        params.push(holiday_date);
      }
      if (branch_id !== undefined) {
        updates.push(`branch_id = $${p++}`);
        params.push(branch_id);
      }
      if (description !== undefined) {
        updates.push(`description = $${p++}`);
        params.push(description.trim() || null);
      }

      if (updates.length === 0) {
        const row = await query(
          'SELECT holiday_id, name, holiday_date::text as date, branch_id, description FROM custom_holidaystbl WHERE holiday_id = $1',
          [id]
        );
        return res.json({
          success: true,
          message: 'No changes',
          data: {
            holiday_id: row.rows[0].holiday_id,
            date: row.rows[0].date,
            name: row.rows[0].name,
            source: 'custom',
            branch_id: row.rows[0].branch_id,
            description: row.rows[0].description,
          },
        });
      }

      params.push(id);
      const updateSql = `UPDATE custom_holidaystbl SET ${updates.join(', ')} WHERE holiday_id = $${p} RETURNING holiday_id, name, holiday_date::text as date, branch_id, description`;
      const updateResult = await query(updateSql, params);
      const row = updateResult.rows[0];

      res.json({
        success: true,
        message: 'Custom holiday updated',
        data: {
          holiday_id: row.holiday_id,
          date: row.date,
          name: row.name,
          source: 'custom',
          branch_id: row.branch_id,
          description: row.description,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/sms/holidays/custom/:id - Delete custom holiday
 */
router.delete(
  '/custom/:id',
  requireRole('Superadmin', 'Admin'),
  [param('id').isInt().withMessage('Invalid holiday ID'), handleValidationErrors],
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const isSuperadmin = req.user.userType === 'Superadmin';
      const userBranchId = req.user.branchId ?? req.user.branch_id;

      const existing = await query(
        'SELECT holiday_id, branch_id FROM custom_holidaystbl WHERE holiday_id = $1',
        [id]
      );

      if (existing.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Custom holiday not found' });
      }

      if (!isSuperadmin && (existing.rows[0].branch_id != null && existing.rows[0].branch_id !== userBranchId)) {
        return res.status(403).json({ success: false, message: 'Access denied to this holiday' });
      }

      await query('DELETE FROM custom_holidaystbl WHERE holiday_id = $1', [id]);

      res.json({
        success: true,
        message: 'Custom holiday deleted',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
