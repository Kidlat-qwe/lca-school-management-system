import express from 'express';
import { query as queryValidator, body } from 'express-validator';
import { verifyFirebaseToken, requireRole } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query } from '../config/database.js';
import { insertSystemLog, getClientIp } from '../utils/systemLog.js';

const router = express.Router();

router.use(verifyFirebaseToken);

/**
 * POST /api/sms/system-logs/page-view
 * SPA navigation (any authenticated role). Not logged again by activityLogger (system-logs prefix skipped).
 */
router.post(
  '/page-view',
  [
    body('path').trim().notEmpty().isLength({ max: 2000 }).withMessage('path is required (max 2000 chars)'),
    body('title').optional({ nullable: true }).isString().isLength({ max: 500 }),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const uid = req.user?.userId ?? req.user?.user_id;
      if (!uid) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const path = String(req.body.path || '').trim().slice(0, 4000);
      const titleRaw = req.body.title;
      const title =
        titleRaw != null && String(titleRaw).trim()
          ? String(titleRaw).trim().slice(0, 500)
          : null;

      const name = req.user?.fullName || req.user?.full_name || req.user?.email || 'User';
      const role = req.user?.userType || req.user?.user_type || '?';
      const summary = `${name} (${role}) navigated to ${path}${title ? ` — ${title}` : ''}`;

      await insertSystemLog({
        userId: uid,
        userFullName: req.user?.fullName || req.user?.full_name || null,
        userType: req.user?.userType || req.user?.user_type || null,
        branchId: req.user?.branchId ?? req.user?.branch_id ?? null,
        httpMethod: 'GET',
        httpStatus: 200,
        requestPath: path,
        action: 'GET',
        entityType: 'navigation',
        summary,
        details: title ? { title, spa: true } : { spa: true },
        ipAddress: getClientIp(req),
      });

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  }
);

router.use(requireRole('Superadmin', 'Admin'));

/**
 * GET /api/sms/system-logs
 * List system activity logs. Superadmin: all branches. Admin: own branch only.
 */
router.get(
  '/',
  [
    queryValidator('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    queryValidator('limit').optional().isInt({ min: 1, max: 200 }).withMessage('limit must be 1–200'),
    queryValidator('action').optional().isString().withMessage('action must be a string'),
    queryValidator('entity_type').optional().isString().withMessage('entity_type must be a string'),
    queryValidator('user_id').optional().isInt().withMessage('user_id must be an integer'),
    queryValidator('from')
      .optional()
      .matches(/^\d{4}-\d{2}-\d{2}$/)
      .withMessage('from must be YYYY-MM-DD'),
    queryValidator('to')
      .optional()
      .matches(/^\d{4}-\d{2}-\d{2}$/)
      .withMessage('to must be YYYY-MM-DD'),
    queryValidator('search').optional().isString().withMessage('search must be a string'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const {
        page = 1,
        limit = 25,
        action,
        entity_type,
        user_id,
        from: fromDate,
        to: toDate,
        search,
      } = req.query;

      const pageNum = parseInt(page, 10) || 1;
      const limitNum = Math.min(parseInt(limit, 10) || 25, 200);
      const offset = (pageNum - 1) * limitNum;

      const baseFrom = `
        FROM system_logstbl sl
        LEFT JOIN branchestbl b ON sl.branch_id = b.branch_id
        WHERE 1=1
      `;
      let whereSql = '';
      const params = [];
      let n = 0;

      if (action) {
        n++;
        whereSql += ` AND sl.action = $${n}`;
        params.push(String(action).trim());
      }
      if (entity_type) {
        n++;
        whereSql += ` AND sl.entity_type ILIKE $${n}`;
        params.push(`%${String(entity_type).trim()}%`);
      }
      if (user_id) {
        n++;
        whereSql += ` AND sl.user_id = $${n}`;
        params.push(parseInt(user_id, 10));
      }
      if (fromDate) {
        n++;
        whereSql += ` AND sl.created_at >= $${n}::timestamptz`;
        params.push(`${String(fromDate).slice(0, 10)}T00:00:00.000Z`);
      }
      if (toDate) {
        n++;
        whereSql += ` AND sl.created_at < ($${n}::date + INTERVAL '1 day')::timestamptz`;
        params.push(String(toDate).slice(0, 10));
      }
      if (search && String(search).trim()) {
        n++;
        const like = `%${String(search).trim()}%`;
        whereSql += ` AND (
          sl.summary ILIKE $${n}
          OR sl.request_path ILIKE $${n}
          OR COALESCE(sl.user_full_name, '') ILIKE $${n}
        )`;
        params.push(like);
      }

      if (req.user.userType === 'Admin') {
        const bid = req.user.branchId ?? req.user.branch_id;
        if (bid == null || bid === '') {
          return res.status(403).json({
            success: false,
            message: 'Access denied. Branch is required for system logs.',
          });
        }
        n++;
        whereSql += ` AND sl.branch_id = $${n}`;
        params.push(bid);
      }

      const countSql = `SELECT COUNT(*)::int AS total ${baseFrom} ${whereSql}`;
      const countResult = await query(countSql, [...params]);
      const total = countResult.rows[0]?.total ?? 0;

      const listSql = `
        SELECT
          sl.system_log_id,
          TO_CHAR(sl.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
          sl.user_id,
          sl.user_full_name,
          sl.user_type,
          sl.branch_id,
          COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
          sl.http_method,
          sl.http_status,
          sl.request_path,
          sl.action,
          sl.entity_type,
          sl.summary,
          sl.details,
          sl.ip_address
        ${baseFrom}
        ${whereSql}
        ORDER BY sl.system_log_id DESC
        LIMIT $${n + 1} OFFSET $${n + 2}
      `;
      const listParams = [...params, limitNum, offset];
      const result = await query(listSql, listParams);

      res.json({
        success: true,
        data: result.rows,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum) || 1,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
