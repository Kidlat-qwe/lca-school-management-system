import { query } from '../config/database.js';

/**
 * paymenttbl.created_at / updated_at are timestamp without time zone on Neon (UTC wall clock).
 * Convert to Asia/Manila for Payment Logs API strings consumed by the frontend.
 *
 * @param {string} columnSql SQL expression, e.g. `p.updated_at` or `COALESCE(p.updated_at, p.created_at)`
 * @param {string} alias Result column alias
 */
export function paymentLogTimestampManilaSelectSql(columnSql, alias) {
  return `TO_CHAR((${columnSql} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD HH24:MI:SS') AS ${alias}`;
}

/** Once true, column exists for process lifetime. Before migration, we re-check each call (cheap query). */
let updatedAtColumnKnownTrue = false;

/**
 * Whether paymenttbl.updated_at exists (migration 119).
 * Caches only positive detection so applying the migration is picked up without restart.
 */
export async function paymenttblHasUpdatedAtColumn() {
  if (updatedAtColumnKnownTrue) return true;
  try {
    const r = await query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'paymenttbl'
         AND column_name = 'updated_at'
       LIMIT 1`
    );
    if (r.rows.length > 0) {
      updatedAtColumnKnownTrue = true;
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** SQL fragment for payment log updated_at (uses created_at until migration 119). */
export function paymentUpdatedAtSelectSql(hasUpdatedAtColumn) {
  if (hasUpdatedAtColumn) {
    return paymentLogTimestampManilaSelectSql('COALESCE(p.updated_at, p.created_at)', 'updated_at');
  }
  return paymentLogTimestampManilaSelectSql('p.created_at', 'updated_at');
}

/** Payment Logs "Created At" — when the payment row was first encoded (Manila wall clock). */
export function paymentCreatedAtSelectSql(columnSql = 'p.created_at', alias = 'created_at') {
  return paymentLogTimestampManilaSelectSql(columnSql, alias);
}

let cachedPaymentUpdatedAtSelectSql = null;

/**
 * Resolve updated_at SELECT for payment list queries.
 * Re-checks information_schema until migration 119 is applied, then caches.
 */
export async function resolvePaymentUpdatedAtSelectSql() {
  const hasCol = await paymenttblHasUpdatedAtColumn();
  const sql = paymentUpdatedAtSelectSql(hasCol);
  if (hasCol) {
    cachedPaymentUpdatedAtSelectSql = sql;
    return sql;
  }
  return sql;
}

/** Once true, column exists for process lifetime. Before migration, we re-check each call (cheap query). */
let actionOwnerColumnKnownTrue = false;

/**
 * Whether paymenttbl.action_owner_user_id exists (migration 095).
 * Caches only positive detection so applying the migration is picked up without restart.
 */
export async function paymenttblHasActionOwnerUserIdColumn() {
  if (actionOwnerColumnKnownTrue) return true;
  try {
    const r = await query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'paymenttbl'
         AND column_name = 'action_owner_user_id'
       LIMIT 1`
    );
    if (r.rows.length > 0) {
      actionOwnerColumnKnownTrue = true;
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}
