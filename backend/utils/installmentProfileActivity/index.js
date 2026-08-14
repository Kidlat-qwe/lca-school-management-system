/**
 * Installment profile Active/Inactive vs enrollment drops.
 *
 * Rule: if a student dropped on a class and did not rejoin that same class
 * (no later active enrollment after the highest dropped phase), the installment
 * profile for that class must be Inactive. The re-enrollment matrix also
 * follows `is_active`. Student History Status additionally overlays unpaid
 * past-due / under-grace as Inactive via `installmentPlanLifecycleStatus`.
 *
 * @module utils/installmentProfileActivity
 */

import { ACTIVE_ENROLLMENT_STATUSES } from '../enrollmentStatus.js';

const runQuery = (db, text, params) => {
  if (typeof db === 'function') {
    return db(text, params);
  }
  if (typeof db?.query === 'function') {
    return db.query(text, params);
  }
  throw new Error('installmentProfileActivity requires a database client or pool with query()');
};

/**
 * True when the class has a dropped enrollment and no later active enrollment
 * on a higher phase (rejoin / continue after the drop).
 *
 * Earlier phases may still be `new` / `re_enrolled`; those do not count as a rejoin.
 *
 * @param {import('pg').Pool | import('pg').PoolClient | Function} db
 * @param {number} studentId
 * @param {number} classId
 * @returns {Promise<boolean>}
 */
export async function classHasUnrejoinedDrop(db, studentId, classId) {
  const sid = Number(studentId);
  const cid = Number(classId);
  if (!sid || !cid) return false;

  const res = await runQuery(
    db,
    `SELECT EXISTS (
       SELECT 1
       FROM classstudentstbl d
       WHERE d.student_id = $1
         AND d.class_id = $2
         AND d.program_enrollment_status = 'dropped'
     ) AS has_drop,
     EXISTS (
       SELECT 1
       FROM classstudentstbl a
       WHERE a.student_id = $1
         AND a.class_id = $2
         AND a.program_enrollment_status = ANY($3::text[])
         AND a.removed_at IS NULL
         AND COALESCE(a.phase_number, 0) > (
           SELECT COALESCE(MAX(d2.phase_number), 0)
           FROM classstudentstbl d2
           WHERE d2.student_id = $1
             AND d2.class_id = $2
             AND d2.program_enrollment_status = 'dropped'
         )
     ) AS has_rejoin_after_drop`,
    [sid, cid, ACTIVE_ENROLLMENT_STATUSES]
  );

  const row = res.rows[0] || {};
  return Boolean(row.has_drop) && !Boolean(row.has_rejoin_after_drop);
}

/**
 * Deactivate installment profiles for a student+class when dropped without rejoin.
 *
 * @returns {Promise<number>} rows updated
 */
export async function deactivateInstallmentProfileIfUnrejoinedDrop(
  db,
  { studentId, classId }
) {
  const sid = Number(studentId);
  const cid = Number(classId);
  if (!sid || !cid) return 0;

  const shouldDeactivate = await classHasUnrejoinedDrop(db, sid, cid);
  if (!shouldDeactivate) return 0;

  const res = await runQuery(
    db,
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
 * Deactivate every installment profile for a student that has an unrejoined drop on its class.
 *
 * @returns {Promise<number>} rows updated
 */
export async function syncStudentInstallmentProfilesForUnrejoinedDrops(db, studentId) {
  const sid = Number(studentId);
  if (!sid) return 0;

  const classes = await runQuery(
    db,
    `SELECT DISTINCT class_id
     FROM classstudentstbl
     WHERE student_id = $1
       AND class_id IS NOT NULL`,
    [sid]
  );

  let total = 0;
  for (const row of classes.rows || []) {
    total += await deactivateInstallmentProfileIfUnrejoinedDrop(db, {
      studentId: sid,
      classId: row.class_id,
    });
  }
  return total;
}

/**
 * Param index–safe unrejoined-drop predicate for UPDATE ... WHERE on alias `ip`.
 *
 * @param {number} activeStatusesParamIndex — e.g. `2` when statuses are `$2`
 */
export function unrejoinedDropPredicateSql(activeStatusesParamIndex) {
  const p = `$${activeStatusesParamIndex}`;
  return `
  EXISTS (
    SELECT 1
    FROM classstudentstbl d
    WHERE d.student_id = ip.student_id
      AND d.class_id = ip.class_id
      AND d.program_enrollment_status = 'dropped'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM classstudentstbl a
    WHERE a.student_id = ip.student_id
      AND a.class_id = ip.class_id
      AND a.program_enrollment_status = ANY(${p}::text[])
      AND a.removed_at IS NULL
      AND COALESCE(a.phase_number, 0) > (
        SELECT COALESCE(MAX(d2.phase_number), 0)
        FROM classstudentstbl d2
        WHERE d2.student_id = ip.student_id
          AND d2.class_id = ip.class_id
          AND d2.program_enrollment_status = 'dropped'
      )
  )`;
}

export { ACTIVE_ENROLLMENT_STATUSES };
