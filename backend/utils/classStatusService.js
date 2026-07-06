/**
 * Class active/inactive status — releases teacher assignments when a class is deactivated.
 *
 * @module utils/classStatusService
 */

import {
  deactivateInstallmentProfilesForInactiveClass,
  reactivateInstallmentProfilesForActiveClass,
} from './billingNotificationEligibility.js';
const MANILA_NOW_SQL = `(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')`;

let historyTableReady = false;

async function ensureHistoryTable(db) {
  if (historyTableReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.teacher_class_historytbl (
      history_id SERIAL PRIMARY KEY,
      teacher_id INTEGER NOT NULL REFERENCES public.userstbl(user_id) ON DELETE CASCADE,
      class_id INTEGER NOT NULL REFERENCES public.classestbl(class_id) ON DELETE CASCADE,
      assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ended_at TIMESTAMP,
      end_reason VARCHAR(50),
      turned_over_to_teacher_id INTEGER REFERENCES public.userstbl(user_id) ON DELETE SET NULL,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  historyTableReady = true;
}

async function closeTeacherClassHistory(db, { teacherId, classId }) {
  await ensureHistoryTable(db);

  const open = await db.query(
    `SELECT history_id, assigned_at FROM teacher_class_historytbl
     WHERE teacher_id = $1 AND class_id = $2 AND ended_at IS NULL
     ORDER BY assigned_at DESC
     LIMIT 1`,
    [teacherId, classId]
  );

  if (open.rows.length > 0) {
    await db.query(
      `UPDATE teacher_class_historytbl
       SET ended_at = GREATEST(assigned_at, ${MANILA_NOW_SQL}),
           end_reason = 'class_inactive',
           turned_over_to_teacher_id = NULL
       WHERE history_id = $1`,
      [open.rows[0].history_id]
    );
    return;
  }

  const ct = await db.query(
    `SELECT created_at FROM classteacherstbl
     WHERE class_id = $1 AND teacher_id = $2
     LIMIT 1`,
    [classId, teacherId]
  );
  const assignedAt = ct.rows[0]?.created_at || null;

  await db.query(
    `INSERT INTO teacher_class_historytbl (
       teacher_id, class_id, assigned_at, ended_at, end_reason
     ) VALUES (
       $1, $2,
       COALESCE($3::timestamp, ${MANILA_NOW_SQL}),
       GREATEST(COALESCE($3::timestamp, ${MANILA_NOW_SQL}), ${MANILA_NOW_SQL}),
       'class_inactive'
     )`,
    [teacherId, classId, assignedAt]
  );
}

async function loadTeacherIdsForClass(db, classId, primaryTeacherId) {
  const ids = new Set();
  if (primaryTeacherId != null) {
    ids.add(Number(primaryTeacherId));
  }

  try {
    const junction = await db.query(
      `SELECT teacher_id FROM classteacherstbl WHERE class_id = $1`,
      [classId]
    );
    junction.rows.forEach((row) => {
      if (row.teacher_id != null) ids.add(Number(row.teacher_id));
    });
  } catch {
    // classteacherstbl may not exist on very old databases
  }

  return Array.from(ids);
}

async function releaseTeachersFromClass(db, classId, primaryTeacherId) {
  const teacherIds = await loadTeacherIdsForClass(db, classId, primaryTeacherId);

  for (const teacherId of teacherIds) {
    await closeTeacherClassHistory(db, { teacherId, classId });
  }

  try {
    await db.query(`DELETE FROM classteacherstbl WHERE class_id = $1`, [classId]);
  } catch {
    // ignore if junction table missing
  }

  await db.query(`UPDATE classestbl SET teacher_id = NULL WHERE class_id = $1`, [classId]);
}

async function ensureClassteachersTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS classteacherstbl (
      classteacher_id SERIAL PRIMARY KEY,
      class_id INTEGER NOT NULL,
      teacher_id INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(class_id, teacher_id),
      CONSTRAINT fk_class FOREIGN KEY (class_id) REFERENCES classestbl(class_id) ON DELETE CASCADE,
      CONSTRAINT fk_teacher FOREIGN KEY (teacher_id) REFERENCES userstbl(user_id) ON DELETE CASCADE
    )
  `);
}

/**
 * Teachers released when this class was last marked inactive (same deactivation batch).
 */
async function loadTeachersFromLastClassInactive(db, classId) {
  await ensureHistoryTable(db);

  const res = await db.query(
    `WITH last_deactivation AS (
       SELECT MAX(ended_at) AS ended_at
       FROM teacher_class_historytbl
       WHERE class_id = $1 AND end_reason = 'class_inactive'
     )
     SELECT h.teacher_id, h.assigned_at
     FROM teacher_class_historytbl h
     CROSS JOIN last_deactivation ld
     WHERE h.class_id = $1
       AND h.end_reason = 'class_inactive'
       AND h.ended_at = ld.ended_at
       AND ld.ended_at IS NOT NULL
     ORDER BY h.assigned_at ASC, h.teacher_id ASC`,
    [classId]
  );
  return res.rows;
}

/** True when the teacher is assigned to a different active class. */
async function isTeacherOnAnotherActiveClass(db, teacherId, excludeClassId) {
  const tid = Number(teacherId);
  const cid = Number(excludeClassId);
  if (!tid) return false;

  const res = await db.query(
    `SELECT 1
     FROM (
       SELECT ct.class_id
       FROM classteacherstbl ct
       WHERE ct.teacher_id = $1 AND ct.class_id != $2
       UNION
       SELECT c.class_id
       FROM classestbl c
       WHERE c.teacher_id = $1 AND c.class_id != $2
     ) assigned
     INNER JOIN classestbl c ON c.class_id = assigned.class_id
     WHERE COALESCE(c.status, 'Active') = 'Active'
     LIMIT 1`,
    [tid, cid]
  );
  return res.rows.length > 0;
}

/**
 * On reactivation: restore teachers from the last inactive release if they are not on another active class.
 *
 * @returns {Promise<{ restored: number[], skipped: number[] }>}
 */
async function restoreTeachersForReactivatedClass(db, classId) {
  const candidates = await loadTeachersFromLastClassInactive(db, classId);
  if (candidates.length === 0) {
    return { restored: [], skipped: [], candidates: 0 };
  }

  await ensureClassteachersTable(db);

  const restored = [];
  const skipped = [];

  for (const row of candidates) {
    const teacherId = Number(row.teacher_id);
    if (!teacherId) continue;

    if (await isTeacherOnAnotherActiveClass(db, teacherId, classId)) {
      skipped.push(teacherId);
      continue;
    }

    await db.query(
      `INSERT INTO classteacherstbl (class_id, teacher_id)
       VALUES ($1, $2)
       ON CONFLICT (class_id, teacher_id) DO NOTHING`,
      [classId, teacherId]
    );

    const open = await db.query(
      `SELECT history_id FROM teacher_class_historytbl
       WHERE teacher_id = $1 AND class_id = $2 AND ended_at IS NULL
       LIMIT 1`,
      [teacherId, classId]
    );
    if (open.rows.length === 0) {
      await db.query(
        `INSERT INTO teacher_class_historytbl (teacher_id, class_id, assigned_at)
         VALUES ($1, $2, ${MANILA_NOW_SQL})`,
        [teacherId, classId]
      );
    }

    restored.push(teacherId);
  }

  if (restored.length > 0) {
    await db.query(`UPDATE classestbl SET teacher_id = $1 WHERE class_id = $2`, [
      restored[0],
      classId,
    ]);
  }

  return { restored, skipped, candidates: candidates.length };
}

/**
 * @param {import('pg').PoolClient} client
 * @param {number|string} classId
 * @param {'Active'|'Inactive'} status
 * @returns {Promise<{ classRow: object, teachersReleased: number, installmentProfilesUpdated: number, teachersRestored: number, teachersSkipped: number, needsTeacherAssignment: boolean }>}
 * needsTeacherAssignment — class stays Inactive until a teacher is assigned (assign-teacher modal).
 */
export async function setClassStatus(client, classId, status) {
  const normalized = String(status || '').trim();
  if (!['Active', 'Inactive'].includes(normalized)) {
    const err = new Error('Status must be Active or Inactive');
    err.statusCode = 400;
    throw err;
  }

  const existing = await client.query(`SELECT * FROM classestbl WHERE class_id = $1`, [classId]);
  if (existing.rows.length === 0) {
    const err = new Error('Class not found');
    err.statusCode = 404;
    throw err;
  }

  const classRow = existing.rows[0];
  let teachersReleased = 0;
  let installmentProfilesUpdated = 0;
  let teachersRestored = 0;
  let teachersSkipped = 0;

  if (normalized === 'Inactive') {
    const teacherIds = await loadTeacherIdsForClass(client, classId, classRow.teacher_id);
    teachersReleased = teacherIds.length;
    await releaseTeachersFromClass(client, classId, classRow.teacher_id);
    installmentProfilesUpdated = await deactivateInstallmentProfilesForInactiveClass(
      client,
      classId
    );
  } else {
    const restoreResult = await restoreTeachersForReactivatedClass(client, classId);
    teachersRestored = restoreResult.restored.length;
    teachersSkipped = restoreResult.skipped.length;

    const afterRestore = await client.query(`SELECT * FROM classestbl WHERE class_id = $1`, [
      classId,
    ]);
    const rowAfterRestore = afterRestore.rows[0] || classRow;
    const teacherIds = await loadTeacherIdsForClass(
      client,
      classId,
      rowAfterRestore.teacher_id
    );

    if (teacherIds.length === 0) {
      return {
        classRow,
        teachersReleased: 0,
        installmentProfilesUpdated: 0,
        teachersRestored,
        teachersSkipped,
        needsTeacherAssignment: true,
      };
    }

    installmentProfilesUpdated = await reactivateInstallmentProfilesForActiveClass(
      client,
      classId
    );
  }

  const updated = await client.query(
    `UPDATE classestbl SET status = $1 WHERE class_id = $2 RETURNING *`,
    [normalized, classId]
  );

  let resultRow = updated.rows[0];

  if (normalized === 'Active' && teachersRestored > 0) {
    const refreshed = await client.query(`SELECT * FROM classestbl WHERE class_id = $1`, [classId]);
    if (refreshed.rows[0]) {
      resultRow = refreshed.rows[0];
    }
  }

  return {
    classRow: resultRow,
    teachersReleased,
    installmentProfilesUpdated,
    teachersRestored,
    teachersSkipped,
    needsTeacherAssignment: false,
  };
}
