import { query } from '../config/database.js';

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
