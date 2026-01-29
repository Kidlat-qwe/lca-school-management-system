import express from 'express';
import { body, query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole, requireBranchAccess } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { getClient } from '../config/database.js';
import {
  SETTINGS_DEFINITIONS,
  SETTINGS_KEYS,
  getEffectiveSettings,
  validateAndNormalizeSettingInput,
} from '../utils/settingsService.js';

const router = express.Router();

router.use(verifyFirebaseToken);
router.use(requireRole('Superadmin', 'Admin'));
router.use(requireBranchAccess);

/**
 * GET /api/sms/settings/effective?branch_id=&category=
 * Returns effective settings for a branch (branch override -> global -> default).
 */
router.get(
  '/effective',
  [
    queryValidator('branch_id').optional().isInt().withMessage('branch_id must be an integer'),
    queryValidator('category').optional().isString().withMessage('category must be a string'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    const client = await getClient();
    try {
      const { branch_id, category } = req.query;

      const isAdmin = req.user.userType === 'Admin';

      // Admin is always scoped to their branch
      const effectiveBranchId = isAdmin ? (req.user.branchId || null) : branch_id ? parseInt(branch_id, 10) : null;

      const keys = category
        ? SETTINGS_KEYS.filter((k) => SETTINGS_DEFINITIONS[k]?.category === category)
        : SETTINGS_KEYS;

      const settings = await getEffectiveSettings(client, keys, effectiveBranchId);

      res.json({
        success: true,
        data: {
          branch_id: effectiveBranchId,
          category: category || null,
          settings,
        },
      });
    } catch (error) {
      next(error);
    } finally {
      client.release();
    }
  }
);

/**
 * PUT /api/sms/settings/batch
 * Body: { scope: 'branch'|'global', branch_id?, settings: { key: value } }
 *
 * Admin: only branch scope, only their branch.
 * Superadmin: can update global defaults or per-branch overrides.
 */
router.put(
  '/batch',
  [
    body('scope').isIn(['branch', 'global']).withMessage('scope must be branch or global'),
    body('branch_id').optional().isInt().withMessage('branch_id must be an integer'),
    body('settings').isObject().withMessage('settings must be an object'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    const client = await getClient();
    try {
      const { scope, branch_id, settings } = req.body;
      const isAdmin = req.user.userType === 'Admin';

      if (isAdmin && scope !== 'branch') {
        return res.status(403).json({
          success: false,
          message: 'Access denied. Admin can only update branch settings.',
        });
      }

      const targetBranchId = scope === 'global'
        ? null
        : isAdmin
          ? (req.user.branchId || null)
          : branch_id
            ? parseInt(branch_id, 10)
            : null;

      if (scope === 'branch' && (targetBranchId === null || targetBranchId === undefined)) {
        return res.status(400).json({
          success: false,
          message: 'branch_id is required for branch-scoped updates',
        });
      }

      const updates = [];
      for (const [key, value] of Object.entries(settings || {})) {
        const normalized = validateAndNormalizeSettingInput(key, value);
        if (!normalized.ok) {
          return res.status(400).json({
            success: false,
            message: normalized.error,
          });
        }
        updates.push(normalized);
      }

      if (updates.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No settings provided to update',
        });
      }

      await client.query('BEGIN');

      const updatedBy = req.user.userId || req.user.user_id || null;

      for (const u of updates) {
        if (targetBranchId === null) {
          // Global default upsert (matches partial unique index WHERE branch_id IS NULL)
          await client.query(
            `INSERT INTO system_settingstbl
              (setting_key, setting_value, setting_type, category, description, branch_id, updated_by, updated_at)
             VALUES ($1, $2, $3, $4, $5, NULL, $6, CURRENT_TIMESTAMP)
             ON CONFLICT (setting_key) WHERE branch_id IS NULL
             DO UPDATE SET
               setting_value = EXCLUDED.setting_value,
               setting_type = EXCLUDED.setting_type,
               category = EXCLUDED.category,
               description = EXCLUDED.description,
               updated_by = EXCLUDED.updated_by,
               updated_at = CURRENT_TIMESTAMP`,
            [u.key, u.storedValue, u.type, u.category, u.description, updatedBy]
          );
        } else {
          // Branch override upsert
          await client.query(
            `INSERT INTO system_settingstbl
              (setting_key, setting_value, setting_type, category, description, branch_id, updated_by, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
             ON CONFLICT (setting_key, branch_id)
             DO UPDATE SET
               setting_value = EXCLUDED.setting_value,
               setting_type = EXCLUDED.setting_type,
               category = EXCLUDED.category,
               description = EXCLUDED.description,
               updated_by = EXCLUDED.updated_by,
               updated_at = CURRENT_TIMESTAMP`,
            [u.key, u.storedValue, u.type, u.category, u.description, targetBranchId, updatedBy]
          );
        }
      }

      await client.query('COMMIT');

      // Return updated effective settings for this scope
      const keys = updates.map((u) => u.key);
      const effective = await getEffectiveSettings(client, keys, targetBranchId);

      res.json({
        success: true,
        message: 'Settings updated successfully',
        data: {
          scope: targetBranchId === null ? 'global' : 'branch',
          branch_id: targetBranchId,
          settings: effective,
        },
      });
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore
      }
      next(error);
    } finally {
      client.release();
    }
  }
);

export default router;

