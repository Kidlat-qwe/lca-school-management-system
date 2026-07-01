import { query } from '../config/database.js';

/**
 * Client IP from Express request (forwarded or direct).
 */
export function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) {
    return xff.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || null;
}

/**
 * Action labels: GET, POST, UPDATE (PUT/PATCH), DELETE — aligned with HTTP verbs.
 */
export function methodToAction(method) {
  const m = String(method || '').toUpperCase();
  if (m === 'GET') return 'GET';
  if (m === 'POST') return 'POST';
  if (m === 'PUT' || m === 'PATCH') return 'UPDATE';
  if (m === 'DELETE') return 'DELETE';
  return m || 'UNKNOWN';
}

/**
 * Derive entity group from API path (first segment after .../sms/), e.g. classes, payments.
 */
export function inferEntityTypeFromPath(pathname) {
  if (!pathname || typeof pathname !== 'string') return null;
  const clean = pathname.split('?')[0];
  const parts = clean.split('/').filter(Boolean);
  const idx = parts.indexOf('sms');
  const segment = idx >= 0 && parts[idx + 1] ? parts[idx + 1] : null;
  return segment ? segment.replace(/-/g, '_') : null;
}

/**
 * Insert one system log row. Swallows errors so logging never breaks the request path.
 */
export async function insertSystemLog({
  userId = null,
  userFullName = null,
  userType = null,
  branchId = null,
  httpMethod,
  httpStatus = null,
  requestPath,
  action,
  entityType = null,
  summary,
  details = null,
  ipAddress = null,
}) {
  try {
    const pathStr = String(requestPath || '').slice(0, 4000);
    const sum = String(summary || '').slice(0, 8000);
    await query(
      `INSERT INTO system_logstbl (
         user_id, user_full_name, user_type, branch_id,
         http_method, http_status, request_path, action, entity_type, summary, details, ip_address
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)`,
      [
        userId,
        userFullName,
        userType,
        branchId,
        httpMethod,
        httpStatus,
        pathStr,
        action,
        entityType,
        sum,
        details && typeof details === 'object' ? JSON.stringify(details) : null,
        ipAddress ? String(ipAddress).slice(0, 64) : null,
      ]
    );
  } catch (e) {
    console.error('[systemLog] insert failed:', e.message);
  }
}
