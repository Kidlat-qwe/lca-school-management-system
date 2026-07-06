/**
 * Gate billing-related email/SMS and installment generation for class-linked billing.
 * Skips notifications and generation when the class is inactive or the student is dropped.
 *
 * @module utils/billingNotificationEligibility
 */

import { ACTIVE_ENROLLMENT_STATUSES, PROGRAM_ENROLLMENT_STATUS } from './enrollmentStatus.js';

const runQuery = (db, text, params) => {
  if (typeof db === 'function') {
    return db(text, params);
  }
  if (typeof db?.query === 'function') {
    return db.query(text, params);
  }
  throw new Error('billingNotificationEligibility requires a database client or pool with query()');
};

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {number|null|undefined} classId
 * @returns {Promise<boolean>}
 */
export async function isClassActiveForBilling(db, classId) {
  const cid = Number(classId);
  if (!cid) return true;

  const res = await runQuery(
    db,
    `SELECT status FROM classestbl WHERE class_id = $1 LIMIT 1`,
    [cid]
  );
  if (res.rows.length === 0) return true;
  return String(res.rows[0].status || 'Active').trim() !== 'Inactive';
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {number|null|undefined} classId
 * @returns {Promise<{ allowed: boolean, reason?: string, classId?: number|null }>}
 */
export async function evaluateClassInstallmentBillingEligibility(db, classId) {
  const cid = Number(classId);
  if (!cid) {
    return { allowed: true, reason: 'not_class_linked', classId: null };
  }

  if (!(await isClassActiveForBilling(db, cid))) {
    return { allowed: false, reason: 'class_inactive', classId: cid };
  }

  return { allowed: true, reason: 'class_active', classId: cid };
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {number} studentId
 * @param {number} classId
 * @returns {Promise<boolean>}
 */
export async function hasActiveClassEnrollment(db, studentId, classId) {
  const sid = Number(studentId);
  const cid = Number(classId);
  if (!sid || !cid) return false;

  const res = await runQuery(
    db,
    `SELECT 1
     FROM classstudentstbl
     WHERE student_id = $1
       AND class_id = $2
       AND program_enrollment_status = ANY($3::text[])
       AND removed_at IS NULL
     LIMIT 1`,
    [sid, cid, ACTIVE_ENROLLMENT_STATUSES]
  );
  return res.rows.length > 0;
}

/**
 * Resolve class_id for a student invoice (installment profile, remarks, or student profile).
 *
 * @returns {Promise<number|null>}
 */
export async function resolveClassIdForBillingNotification(db, { invoiceId, studentId }) {
  const iid = Number(invoiceId);
  const sid = Number(studentId);
  if (!iid) return null;

  const fromInvoiceProfile = await runQuery(
    db,
    `SELECT ip.class_id
     FROM invoicestbl i
     JOIN installmentinvoiceprofilestbl ip
       ON ip.installmentinvoiceprofiles_id = i.installmentinvoiceprofiles_id
     WHERE i.invoice_id = $1
       AND ip.class_id IS NOT NULL
       AND ($2::int IS NULL OR ip.student_id = $2)
     ORDER BY ip.is_active DESC, ip.installmentinvoiceprofiles_id DESC
     LIMIT 1`,
    [iid, Number.isFinite(sid) ? sid : null]
  );
  if (fromInvoiceProfile.rows[0]?.class_id != null) {
    return Number(fromInvoiceProfile.rows[0].class_id);
  }

  if (Number.isFinite(sid)) {
    const fromStudentProfile = await runQuery(
      db,
      `SELECT ip.class_id
       FROM invoicestudentstbl ist
       JOIN installmentinvoiceprofilestbl ip
         ON ip.student_id = ist.student_id
        AND ip.class_id IS NOT NULL
       WHERE ist.invoice_id = $1
         AND ist.student_id = $2
       ORDER BY ip.is_active DESC, ip.installmentinvoiceprofiles_id DESC
       LIMIT 1`,
      [iid, sid]
    );
    if (fromStudentProfile.rows[0]?.class_id != null) {
      return Number(fromStudentProfile.rows[0].class_id);
    }
  }

  const remarksRes = await runQuery(
    db,
    `SELECT remarks FROM invoicestbl WHERE invoice_id = $1 LIMIT 1`,
    [iid]
  );
  const remarks = remarksRes.rows[0]?.remarks || '';
  const classMatch = String(remarks).match(/CLASS_ID:(\d+)/i);
  if (classMatch) {
    return Number(classMatch[1]);
  }

  return null;
}

/**
 * Returns true when monthly/overdue billing email or SMS may be sent.
 * Non-class invoices (no class_id resolved) are always allowed.
 *
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {{ invoiceId: number|string, studentId: number|string }} params
 * @returns {Promise<{ allowed: boolean, reason?: string, classId?: number|null }>}
 */
export async function evaluateBillingNotificationEligibility(db, { invoiceId, studentId }) {
  const sid = Number(studentId);
  if (!sid) {
    return { allowed: true, reason: 'missing_student_id' };
  }

  const classId = await resolveClassIdForBillingNotification(db, { invoiceId, studentId: sid });
  if (!classId) {
    return { allowed: true, reason: 'not_class_linked', classId: null };
  }

  if (!(await isClassActiveForBilling(db, classId))) {
    return {
      allowed: false,
      reason: 'class_inactive',
      classId,
    };
  }

  if (await hasActiveClassEnrollment(db, sid, classId)) {
    return { allowed: true, reason: 'active_enrollment', classId };
  }

  const droppedRes = await runQuery(
    db,
    `SELECT 1
     FROM classstudentstbl
     WHERE student_id = $1
       AND class_id = $2
       AND program_enrollment_status = $3
     LIMIT 1`,
    [sid, classId, PROGRAM_ENROLLMENT_STATUS.DROPPED]
  );

  if (droppedRes.rows.length > 0) {
    return {
      allowed: false,
      reason: 'dropped_not_rejoined',
      classId,
    };
  }

  return { allowed: true, reason: 'no_active_but_not_dropped', classId };
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {{ invoiceId: number|string, studentId: number|string }} params
 * @returns {Promise<boolean>}
 */
export async function shouldSendBillingNotification(db, params) {
  const result = await evaluateBillingNotificationEligibility(db, params);
  return result.allowed;
}

/**
 * Deactivate installment profiles when a student is dropped from a class.
 *
 * @param {import('pg').PoolClient} client
 * @param {{ studentId: number, classId: number }} params
 */
export async function deactivateInstallmentProfileForClassDrop(client, { studentId, classId }) {
  const sid = Number(studentId);
  const cid = Number(classId);
  if (!sid || !cid) return 0;

  const res = await client.query(
    `UPDATE installmentinvoiceprofilestbl
     SET is_active = false
     WHERE student_id = $1
       AND class_id = $2
       AND is_active = true`,
    [sid, cid]
  );
  return res.rowCount || 0;
}

/**
 * Pause all installment profiles for an inactive class (records preserved).
 *
 * @param {import('pg').PoolClient} client
 * @param {number} classId
 * @returns {Promise<number>}
 */
export async function deactivateInstallmentProfilesForInactiveClass(client, classId) {
  const cid = Number(classId);
  if (!cid) return 0;

  const res = await client.query(
    `UPDATE installmentinvoiceprofilestbl
     SET is_active = false
     WHERE class_id = $1
       AND is_active = true`,
    [cid]
  );
  return res.rowCount || 0;
}

/**
 * Resume installment profiles when a class is reactivated (enrolled students only).
 *
 * @param {import('pg').PoolClient} client
 * @param {number} classId
 * @returns {Promise<number>}
 */
export async function reactivateInstallmentProfilesForActiveClass(client, classId) {
  const cid = Number(classId);
  if (!cid) return 0;

  const res = await client.query(
    `UPDATE installmentinvoiceprofilestbl ip
     SET is_active = true
     WHERE ip.class_id = $1
       AND ip.is_active = false
       AND EXISTS (
         SELECT 1
         FROM classstudentstbl cs
         WHERE cs.student_id = ip.student_id
           AND cs.class_id = ip.class_id
           AND cs.program_enrollment_status = ANY($2::text[])
           AND cs.removed_at IS NULL
       )`,
    [cid, ACTIVE_ENROLLMENT_STATUSES]
  );
  return res.rowCount || 0;
}

/**
 * Keep installment profile is_active aligned with class status (e.g. end_date auto-inactive).
 *
 * @param {import('pg').Pool | import('pg').PoolClient} db
 */
export async function syncInstallmentProfilesWithClassStatus(db) {
  await runQuery(
    db,
    `UPDATE installmentinvoiceprofilestbl ip
     SET is_active = false
     WHERE ip.is_active = true
       AND ip.class_id IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM classestbl c
         WHERE c.class_id = ip.class_id
           AND COALESCE(c.status, 'Active') = 'Inactive'
       )`
  );

  await runQuery(
    db,
    `UPDATE installmentinvoiceprofilestbl ip
     SET is_active = true
     WHERE ip.is_active = false
       AND ip.class_id IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM classestbl c
         WHERE c.class_id = ip.class_id
           AND COALESCE(c.status, 'Active') = 'Active'
       )
       AND EXISTS (
         SELECT 1
         FROM classstudentstbl cs
         WHERE cs.student_id = ip.student_id
           AND cs.class_id = ip.class_id
           AND cs.program_enrollment_status = ANY($1::text[])
           AND cs.removed_at IS NULL
       )`,
    [ACTIVE_ENROLLMENT_STATUSES]
  );
}
