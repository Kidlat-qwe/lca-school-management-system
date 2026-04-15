import {
  insertSystemLog,
  methodToAction,
  inferEntityTypeFromPath,
  getClientIp,
} from '../utils/systemLog.js';

const SKIP_PREFIXES = [
  '/api/sms/system-logs', // avoid noise: listing logs + client page-view POST (handled inside route)
];

function shouldSkipPath(pathname) {
  const p = pathname.split('?')[0];
  return SKIP_PREFIXES.some((prefix) => p.startsWith(prefix));
}

/**
 * Logs authenticated API requests after the response is sent.
 * Action column: GET, POST, UPDATE (PUT/PATCH), DELETE via methodToAction.
 * Skips HEAD/OPTIONS. Skips /api/sms/system-logs/* to avoid feedback noise.
 * Mount with: app.use('/api/sms', activityLogger)
 * Must run before route handlers; req.user is set later by per-route auth — available on res.finish.
 */
export function activityLogger(req, res, next) {
  res.on('finish', () => {
    try {
      const method = req.method;
      if (method === 'HEAD' || method === 'OPTIONS') return;

      const originalUrl = req.originalUrl || req.url || '';
      if (shouldSkipPath(originalUrl)) return;

      const uid = req.user?.userId ?? req.user?.user_id;
      if (!uid) return;

      const fullPath = originalUrl.split('?')[0];
      const action = methodToAction(method);
      const entityType = inferEntityTypeFromPath(fullPath);
      const name = req.user?.fullName || req.user?.full_name || req.user?.email || 'User';
      const summary = `${name} (${req.user?.userType || '?'}) ${method} ${fullPath} → ${res.statusCode}`;

      insertSystemLog({
        userId: uid,
        userFullName: req.user?.fullName || req.user?.full_name || null,
        userType: req.user?.userType || req.user?.user_type || null,
        branchId: req.user?.branchId ?? req.user?.branch_id ?? null,
        httpMethod: method,
        httpStatus: res.statusCode,
        requestPath: fullPath,
        action,
        entityType,
        summary,
        details: { statusCode: res.statusCode },
        ipAddress: getClientIp(req),
      });
    } catch (e) {
      console.error('[activityLogger] finish handler error:', e.message);
    }
  });

  next();
}
