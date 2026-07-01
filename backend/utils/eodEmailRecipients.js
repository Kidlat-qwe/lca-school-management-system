import admin from '../config/firebase.js';
import { normalizeNotificationRecipients } from './emailService.js';

const SUPERADMIN_USER_TYPE_SQL = `LOWER(REGEXP_REPLACE(TRIM(COALESCE(user_type, '')), '[[:space:]]+', '', 'g')) = 'superadmin'`;

/**
 * Resolve Superadmin notification emails for EOD digest.
 * Uses userstbl.email first; falls back to Firebase Auth email when DB email is empty
 * (common on production when Personnel email was never saved).
 */
export async function resolveEodStakeholderEmails(dbRows = [], envEmails = []) {
  const resolved = [];

  for (const row of dbRows) {
    const dbEmail = String(row?.email || '').trim();
    if (dbEmail) {
      resolved.push(dbEmail);
      continue;
    }

    const firebaseUid = String(row?.firebase_uid || '').trim();
    if (!firebaseUid) {
      console.warn(
        `[EOD email] Superadmin user_id=${row?.user_id ?? '?'} has no userstbl.email and no firebase_uid; skipped.`
      );
      continue;
    }

    try {
      const fbUser = await admin.auth().getUser(firebaseUid);
      const fbEmail = String(fbUser?.email || '').trim();
      if (fbEmail) {
        resolved.push(fbEmail);
        console.log(
          `[EOD email] Using Firebase email for Superadmin user_id=${row.user_id} (userstbl.email was empty).`
        );
      } else {
        console.warn(
          `[EOD email] Superadmin user_id=${row.user_id} has no email in userstbl or Firebase Auth.`
        );
      }
    } catch (err) {
      console.warn(
        `[EOD email] Firebase lookup failed for Superadmin user_id=${row?.user_id}:`,
        err?.message || err
      );
    }
  }

  return normalizeNotificationRecipients([...resolved, ...envEmails]);
}

export { SUPERADMIN_USER_TYPE_SQL };
