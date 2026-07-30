/**
 * Class lifecycle: finalize ended classes, soft-archive, restore, permanent purge.
 *
 * @module utils/classLifecycleService
 */

import { setClassStatus } from '../classStatusService.js';
import { todayYmdManila, addDaysToYmd } from '../dateUtils.js';

export const CLASS_ARCHIVE_RETENTION_DAYS = 30;

const ACTIVE_ENROLLMENT_FOR_COUNT = `('new', 're_enrolled', 'upsell', 'rejoin')`;
const COMPLETABLE_ENROLLMENT = `('new', 're_enrolled', 'upsell', 'rejoin', 'completed')`;

const MANILA_TODAY_SQL = `(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date`;

/**
 * Accept either the exported `query(text, params)` helper or a pg client/pool
 * with `.query()`. Downstream helpers (setClassStatus) require `.query`.
 *
 * @param {import('pg').Pool | import('pg').PoolClient | Function} db
 * @returns {{ query: Function }}
 */
const resolveDb = (db) => {
  if (typeof db === 'function') {
    return { query: (text, params) => db(text, params) };
  }
  if (db && typeof db.query === 'function') {
    return db;
  }
  throw new Error('classLifecycleService requires a database client/pool with query() or the query() helper');
};

/**
 * Mark the latest active enrollment phase per student as completed for a class.
 * Earlier phase rows keep their historical status (new / re_enrolled / …).
 *
 * @param {import('pg').Pool | import('pg').PoolClient | Function} db
 * @param {number} classId
 * @returns {Promise<number>} rows updated to completed
 */
export async function completeActiveEnrollmentsForEndedClass(db, classId) {
  const cid = Number(classId);
  if (!cid) return 0;
  const runner = resolveDb(db);

  const result = await runner.query(
    `
    WITH ranked AS (
      SELECT
        cs.classstudent_id,
        ROW_NUMBER() OVER (
          PARTITION BY cs.student_id
          ORDER BY COALESCE(cs.phase_number, 0) DESC, cs.classstudent_id DESC
        ) AS rn
      FROM classstudentstbl cs
      WHERE cs.class_id = $1
        AND cs.removed_at IS NULL
        AND cs.program_enrollment_status IN ${COMPLETABLE_ENROLLMENT}
    )
    UPDATE classstudentstbl cs
    SET program_enrollment_status = 'completed'
    FROM ranked r
    WHERE cs.classstudent_id = r.classstudent_id
      AND r.rn = 1
      AND cs.program_enrollment_status IS DISTINCT FROM 'completed'
    RETURNING cs.classstudent_id
    `,
    [cid]
  );
  return result.rowCount || 0;
}

/**
 * Finalize one or all ended (non-archived) classes:
 * Inactive + complete latest active enrollments + deactivate installment profiles.
 *
 * @param {import('pg').Pool | import('pg').PoolClient | Function} db
 * @param {{ classId?: number|null }} [options]
 * @returns {Promise<{ finalized: number, enrollmentsCompleted: number, details: object[] }>}
 */
export async function finalizeEndedClasses(db, options = {}) {
  const runner = resolveDb(db);
  const classIdFilter = options.classId != null ? Number(options.classId) : null;

  const params = [];
  let where = `
    WHERE c.archived_at IS NULL
      AND c.end_date IS NOT NULL
      AND c.end_date < ${MANILA_TODAY_SQL}
      AND (
        c.status = 'Active'
        OR EXISTS (
          SELECT 1
          FROM classstudentstbl cs
          WHERE cs.class_id = c.class_id
            AND cs.removed_at IS NULL
            AND cs.program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin')
        )
      )
  `;
  if (Number.isFinite(classIdFilter) && classIdFilter > 0) {
    params.push(classIdFilter);
    where += ` AND c.class_id = $1`;
  }

  const candidates = await runner.query(
    `SELECT c.class_id, c.status, TO_CHAR(c.end_date, 'YYYY-MM-DD') AS end_date
     FROM classestbl c
     ${where}
     ORDER BY c.class_id`,
    params
  );

  const details = [];
  let enrollmentsCompleted = 0;

  for (const row of candidates.rows) {
    const classId = row.class_id;
    let statusChanged = false;
    if (String(row.status) === 'Active') {
      await setClassStatus(runner, classId, 'Inactive');
      statusChanged = true;
    } else {
      // Already Inactive — still pause any leftover active profiles
      await runner.query(
        `UPDATE installmentinvoiceprofilestbl
         SET is_active = false
         WHERE class_id = $1 AND is_active = true`,
        [classId]
      );
    }

    const completed = await completeActiveEnrollmentsForEndedClass(runner, classId);
    enrollmentsCompleted += completed;
    details.push({
      class_id: classId,
      end_date: row.end_date,
      status_set_inactive: statusChanged,
      enrollments_completed: completed,
    });
  }

  return {
    finalized: details.length,
    enrollmentsCompleted,
    details,
  };
}

/**
 * Soft-archive a class (hide from main list).
 *
 * @param {import('pg').PoolClient} client
 * @param {{ classId: number, userId: number|null, branchId?: number|null, requireBranch?: boolean }} params
 */
export async function archiveClass(client, { classId, userId, branchId = null, requireBranch = false }) {
  const cid = Number(classId);
  if (!cid) {
    const err = new Error('Class ID is required');
    err.statusCode = 400;
    throw err;
  }

  const existing = await client.query(
    `SELECT class_id, branch_id, status, class_name,
            TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
            TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date,
            archived_at
     FROM classestbl
     WHERE class_id = $1`,
    [cid]
  );
  if (!existing.rows.length) {
    const err = new Error('Class not found');
    err.statusCode = 404;
    throw err;
  }

  const row = existing.rows[0];
  if (requireBranch && branchId != null && Number(row.branch_id) !== Number(branchId)) {
    const err = new Error('You can only archive classes from your branch.');
    err.statusCode = 403;
    throw err;
  }
  if (row.archived_at) {
    const err = new Error('Class is already archived.');
    err.statusCode = 400;
    throw err;
  }

  const today = todayYmdManila();
  const endDate = row.end_date || null;
  const isEnded = Boolean(endDate && endDate < today);

  if (!isEnded) {
    const deps = await client.query(
      `
      SELECT
        (
          SELECT COUNT(DISTINCT student_id)::int
          FROM classstudentstbl
          WHERE class_id = $1
            AND removed_at IS NULL
            AND program_enrollment_status IN ${ACTIVE_ENROLLMENT_FOR_COUNT}
        ) AS active_students,
        (
          SELECT COUNT(*)::int
          FROM reservedstudentstbl
          WHERE class_id = $1
            AND status NOT IN ('Cancelled', 'Expired', 'Upgraded')
        ) AS active_reservations,
        (
          SELECT COUNT(*)::int
          FROM installmentinvoiceprofilestbl
          WHERE class_id = $1 AND is_active = true
        ) AS active_profiles
      `,
      [cid]
    );
    const d = deps.rows[0] || {};
    const activeStudents = parseInt(d.active_students, 10) || 0;
    const activeReservations = parseInt(d.active_reservations, 10) || 0;
    const activeProfiles = parseInt(d.active_profiles, 10) || 0;
    if (activeStudents > 0 || activeReservations > 0 || activeProfiles > 0) {
      const reasons = [];
      if (activeStudents > 0) reasons.push(`${activeStudents} active enrolled student(s)`);
      if (activeReservations > 0) reasons.push(`${activeReservations} active reservation(s)`);
      if (activeProfiles > 0) reasons.push(`${activeProfiles} active installment profile(s)`);
      const err = new Error(
        `Cannot archive class before it ends. It has ${reasons.join(', ')}. Wait until the class end date passes, or remove those dependencies first.`
      );
      err.statusCode = 400;
      err.dependencies = {
        active_students: activeStudents,
        active_reservations: activeReservations,
        active_installment_profiles: activeProfiles,
      };
      throw err;
    }
  } else {
    await finalizeEndedClasses(client, { classId: cid });
  }

  const purgeAfter = addDaysToYmd(today, CLASS_ARCHIVE_RETENTION_DAYS);
  const updated = await client.query(
    `UPDATE classestbl
     SET archived_at = CURRENT_TIMESTAMP,
         archived_by = $1,
         archive_purge_after = $2::date,
         status = CASE WHEN status = 'Active' THEN 'Inactive' ELSE status END
     WHERE class_id = $3
     RETURNING class_id, class_name, branch_id, status,
               TO_CHAR(archived_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD HH24:MI') AS archived_at_manila,
               TO_CHAR(archive_purge_after, 'YYYY-MM-DD') AS archive_purge_after`,
    [userId || null, purgeAfter, cid]
  );

  return updated.rows[0];
}

/**
 * Restore an archived class to the main list.
 */
export async function restoreArchivedClass(
  client,
  { classId, branchId = null, requireBranch = false }
) {
  const cid = Number(classId);
  const existing = await client.query(
    `SELECT class_id, branch_id, archived_at,
            TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date
     FROM classestbl WHERE class_id = $1`,
    [cid]
  );
  if (!existing.rows.length) {
    const err = new Error('Class not found');
    err.statusCode = 404;
    throw err;
  }
  const row = existing.rows[0];
  if (requireBranch && branchId != null && Number(row.branch_id) !== Number(branchId)) {
    const err = new Error('You can only restore classes from your branch.');
    err.statusCode = 403;
    throw err;
  }
  if (!row.archived_at) {
    const err = new Error('Class is not archived.');
    err.statusCode = 400;
    throw err;
  }

  const updated = await client.query(
    `UPDATE classestbl
     SET archived_at = NULL,
         archived_by = NULL,
         archive_purge_after = NULL
     WHERE class_id = $1
     RETURNING class_id, class_name, status,
               TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date`,
    [cid]
  );

  // Keep Inactive if end date already passed
  const today = todayYmdManila();
  if (updated.rows[0]?.end_date && updated.rows[0].end_date < today) {
    if (String(updated.rows[0].status) === 'Active') {
      await setClassStatus(client, cid, 'Inactive');
    }
    await finalizeEndedClasses(client, { classId: cid });
  }

  const refreshed = await client.query(
    `SELECT class_id, class_name, status,
            TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date
     FROM classestbl WHERE class_id = $1`,
    [cid]
  );
  return refreshed.rows[0];
}

/**
 * Permanently delete a class and dependency rows (FK-safe).
 */
export async function permanentlyDeleteClass(
  client,
  { classId, branchId = null, requireBranch = false, requireArchived = true }
) {
  const cid = Number(classId);
  const existing = await client.query(
    `SELECT class_id, branch_id, archived_at, class_name FROM classestbl WHERE class_id = $1`,
    [cid]
  );
  if (!existing.rows.length) {
    const err = new Error('Class not found');
    err.statusCode = 404;
    throw err;
  }
  const row = existing.rows[0];
  if (requireBranch && branchId != null && Number(row.branch_id) !== Number(branchId)) {
    const err = new Error('You can only permanently delete classes from your branch.');
    err.statusCode = 403;
    throw err;
  }
  if (requireArchived && !row.archived_at) {
    const err = new Error('Only archived classes can be permanently deleted. Archive the class first.');
    err.statusCode = 400;
    throw err;
  }

  // 1. Reservations
  await client.query(`DELETE FROM reservedstudentstbl WHERE class_id = $1`, [cid]);

  // 2. Null installment profile class link
  await client.query(
    `UPDATE installmentinvoiceprofilestbl SET class_id = NULL WHERE class_id = $1`,
    [cid]
  );

  // 3. Enrollments (ON DELETE NO ACTION on class_id)
  await client.query(`DELETE FROM classstudentstbl WHERE class_id = $1`, [cid]);

  // 4. Room schedules
  await client.query(`DELETE FROM roomschedtbl WHERE class_id = $1`, [cid]);

  // 5. Sessions
  await client.query(`DELETE FROM classsessionstbl WHERE class_id = $1`, [cid]);

  // 6. Teachers junction
  await client.query(`DELETE FROM classteacherstbl WHERE class_id = $1`, [cid]);

  // 7. Class row
  await client.query(`DELETE FROM classestbl WHERE class_id = $1`, [cid]);

  return { class_id: cid, class_name: row.class_name };
}

/**
 * List archived classes for Settings UI.
 */
export async function listArchivedClasses(db, { branchId = null } = {}) {
  const runner = resolveDb(db);
  const params = [];
  let branchSql = '';
  if (branchId != null) {
    params.push(Number(branchId));
    branchSql = `AND c.branch_id = $1`;
  }

  const result = await runner.query(
    `
    SELECT
      c.class_id,
      c.branch_id,
      c.class_name,
      c.level_tag,
      c.status,
      TO_CHAR(c.start_date, 'YYYY-MM-DD') AS start_date,
      TO_CHAR(c.end_date, 'YYYY-MM-DD') AS end_date,
      TO_CHAR(c.archived_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD HH24:MI') AS archived_at,
      TO_CHAR(c.archive_purge_after, 'YYYY-MM-DD') AS archive_purge_after,
      c.archived_by,
      u.full_name AS archived_by_name,
      COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
      p.program_name,
      p.program_code,
      GREATEST(
        0,
        (c.archive_purge_after - ${MANILA_TODAY_SQL})
      )::int AS days_remaining
    FROM classestbl c
    LEFT JOIN userstbl u ON u.user_id = c.archived_by
    LEFT JOIN branchestbl b ON b.branch_id = c.branch_id
    LEFT JOIN programstbl p ON p.program_id = c.program_id
    WHERE c.archived_at IS NOT NULL
      ${branchSql}
    ORDER BY c.archived_at DESC NULLS LAST, c.class_id DESC
    `,
    params
  );
  return result.rows;
}

/**
 * Permanently delete archived classes whose purge date has passed.
 * @param {() => Promise<import('pg').PoolClient>} getClientFn
 */
export async function purgeExpiredArchivedClasses(getClientFn) {
  const listClient = await getClientFn();
  let dueRows = [];
  try {
    const due = await listClient.query(
      `
      SELECT class_id
      FROM classestbl
      WHERE archived_at IS NOT NULL
        AND archive_purge_after IS NOT NULL
        AND archive_purge_after <= ${MANILA_TODAY_SQL}
      ORDER BY class_id
      `
    );
    dueRows = due.rows;
  } finally {
    listClient.release();
  }

  const purged = [];
  for (const row of dueRows) {
    const client = await getClientFn();
    try {
      await client.query('BEGIN');
      const result = await permanentlyDeleteClass(client, {
        classId: row.class_id,
        requireArchived: true,
      });
      await client.query('COMMIT');
      purged.push(result);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  return { purged_count: purged.length, purged };
}
