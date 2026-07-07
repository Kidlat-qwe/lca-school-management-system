/**
 * Teacher management — list teachers with assigned classes and class turnover.
 */
import express from 'express';
import { body, param, query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query, getClient } from '../config/database.js';
import { checkTeacherScheduleConflict } from '../utils/scheduleConflict.js';

const router = express.Router();

router.use(verifyFirebaseToken);

let historyTableReady = false;

async function ensureHistoryTable(db = { query }) {
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
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_teacher_class_history_teacher
      ON public.teacher_class_historytbl(teacher_id)
  `);
  historyTableReady = true;
}

/**
 * Ensure open history rows exist for current classteacherstbl / classestbl.teacher_id assignments.
 */
async function backfillOpenHistoryForTeacher(teacherId, db = { query }) {
  await ensureHistoryTable(db);
  const current = await db.query(
    `SELECT DISTINCT
       c.class_id,
       COALESCE(ct.created_at, c.start_date::timestamp, CURRENT_TIMESTAMP) AS assigned_at
     FROM classestbl c
     LEFT JOIN classteacherstbl ct
       ON ct.class_id = c.class_id AND ct.teacher_id = $1
     WHERE ct.teacher_id = $1 OR c.teacher_id = $1`,
    [teacherId]
  );

  for (const row of current.rows) {
    const open = await db.query(
      `SELECT history_id FROM teacher_class_historytbl
       WHERE teacher_id = $1 AND class_id = $2 AND ended_at IS NULL
       LIMIT 1`,
      [teacherId, row.class_id]
    );
    if (open.rows.length === 0) {
      await db.query(
        `INSERT INTO teacher_class_historytbl (teacher_id, class_id, assigned_at)
         VALUES ($1, $2, $3)`,
        [teacherId, row.class_id, row.assigned_at]
      );
    }
  }
}

/** Manila wall-clock timestamp (avoids UTC day-shift in history dates). */
const MANILA_NOW_SQL = `(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')`;

async function closeHistoryForTurnover(db, { fromTeacherId, toTeacherId, classId }) {
  await ensureHistoryTable(db);

  const open = await db.query(
    `SELECT history_id, assigned_at FROM teacher_class_historytbl
     WHERE teacher_id = $1 AND class_id = $2 AND ended_at IS NULL
     ORDER BY assigned_at DESC
     LIMIT 1`,
    [fromTeacherId, classId]
  );

  if (open.rows.length > 0) {
    // ended_at must not be before assigned_at (timezone-safe Manila clock)
    await db.query(
      `UPDATE teacher_class_historytbl
       SET ended_at = GREATEST(assigned_at, ${MANILA_NOW_SQL}),
           end_reason = 'turnover',
           turned_over_to_teacher_id = $1
       WHERE history_id = $2`,
      [toTeacherId, open.rows[0].history_id]
    );
  } else {
    const ct = await db.query(
      `SELECT created_at FROM classteacherstbl
       WHERE class_id = $1 AND teacher_id = $2
       LIMIT 1`,
      [classId, fromTeacherId]
    );
    const assignedAt = ct.rows[0]?.created_at || null;
    await db.query(
      `INSERT INTO teacher_class_historytbl (
         teacher_id, class_id, assigned_at, ended_at, end_reason, turned_over_to_teacher_id
       ) VALUES (
         $1, $2,
         COALESCE($3::timestamp, ${MANILA_NOW_SQL}),
         GREATEST(COALESCE($3::timestamp, ${MANILA_NOW_SQL}), ${MANILA_NOW_SQL}),
         'turnover',
         $4
       )`,
      [fromTeacherId, classId, assignedAt, toTeacherId]
    );
  }

  // Open assignment for destination teacher
  const destOpen = await db.query(
    `SELECT history_id FROM teacher_class_historytbl
     WHERE teacher_id = $1 AND class_id = $2 AND ended_at IS NULL
     LIMIT 1`,
    [toTeacherId, classId]
  );
  if (destOpen.rows.length === 0) {
    await db.query(
      `INSERT INTO teacher_class_historytbl (teacher_id, class_id, assigned_at)
       VALUES ($1, $2, ${MANILA_NOW_SQL})`,
      [toTeacherId, classId]
    );
  }
}

async function loadTeacherOr404(teacherId) {
  const res = await query(
    `SELECT user_id, full_name, email, phone_number, branch_id, user_type
     FROM userstbl
     WHERE user_id = $1 AND user_type = 'Teacher'`,
    [teacherId]
  );
  return res.rows[0] || null;
}

async function loadAssignedClasses(teacherId, { activeOnly = true } = {}) {
  const statusFilter = activeOnly ? `AND COALESCE(c.status, 'Active') = 'Active'` : '';
  const res = await query(
    `SELECT DISTINCT
       c.class_id,
       c.class_name,
       c.level_tag,
       c.status,
       c.branch_id,
       c.program_id,
       TO_CHAR(c.start_date, 'YYYY-MM-DD') AS start_date,
       TO_CHAR(c.end_date, 'YYYY-MM-DD') AS end_date,
       p.program_name,
       r.room_name,
       b.branch_name,
       b.branch_nickname
     FROM classestbl c
     LEFT JOIN programstbl p ON p.program_id = c.program_id
     LEFT JOIN roomstbl r ON r.room_id = c.room_id
     LEFT JOIN branchestbl b ON b.branch_id = c.branch_id
     LEFT JOIN classteacherstbl ct ON ct.class_id = c.class_id AND ct.teacher_id = $1
     WHERE (ct.teacher_id = $1 OR c.teacher_id = $1)
       ${statusFilter}
     ORDER BY c.class_name`,
    [teacherId]
  );
  return res.rows;
}

async function loadClassScheduleDays(classId) {
  const res = await query(
    `SELECT day_of_week, start_time, end_time
     FROM roomschedtbl
     WHERE class_id = $1
       AND start_time IS NOT NULL
       AND end_time IS NOT NULL
     ORDER BY day_of_week`,
    [classId]
  );
  return res.rows.map((row) => ({
    day: row.day_of_week,
    start_time: row.start_time,
    end_time: row.end_time,
    enabled: true,
  }));
}

async function loadCandidateDestinationTeachers(req, sourceTeacher) {
  const params = [];
  let where = `WHERE user_type = 'Teacher' AND user_id <> $1`;
  params.push(sourceTeacher.user_id);

  if (req.user.userType === 'Admin') {
    where += ` AND branch_id = $2`;
    params.push(req.user.branchId);
  } else if (sourceTeacher.branch_id != null) {
    where += ` AND branch_id = $2`;
    params.push(sourceTeacher.branch_id);
  }

  const res = await query(
    `SELECT user_id, full_name, email, branch_id
     FROM userstbl
     ${where}
     ORDER BY full_name ASC`,
    params
  );
  return res.rows;
}

/**
 * Per-class turnover fit for destination teacher.
 * @returns {Promise<{ class_id, class_name, status: 'ok'|'conflict'|'already_assigned', conflicts?: array }>}
 */
async function evaluateClassForTurnover(cls, toTeacherId) {
  const base = {
    class_id: cls.class_id,
    class_name: cls.class_name,
    start_date: cls.start_date,
    end_date: cls.end_date,
    program_name: cls.program_name,
    room_name: cls.room_name,
  };

  const alreadyOnClass = await query(
    `SELECT 1 FROM classteacherstbl WHERE class_id = $1 AND teacher_id = $2
     UNION ALL
     SELECT 1 FROM classestbl WHERE class_id = $1 AND teacher_id = $2
     LIMIT 1`,
    [cls.class_id, toTeacherId]
  );
  if (alreadyOnClass.rows.length > 0) {
    return { ...base, status: 'already_assigned', conflicts: [] };
  }

  const daysOfWeek = await loadClassScheduleDays(cls.class_id);
  if (daysOfWeek.length === 0) {
    return { ...base, status: 'ok', conflicts: [] };
  }

  const conflict = await checkTeacherScheduleConflict(
    toTeacherId,
    daysOfWeek,
    cls.class_id,
    { classStartDate: cls.start_date, classEndDate: cls.end_date }
  );
  if (conflict.hasConflict) {
    return { ...base, status: 'conflict', conflicts: conflict.conflicts || [] };
  }
  return { ...base, status: 'ok', conflicts: [] };
}

async function resolveTurnoverTeachers(req, fromTeacherId, toTeacherId) {
  if (fromTeacherId === toTeacherId) {
    return {
      error: {
        status: 400,
        body: {
          success: false,
          message: 'Source and destination teacher must be different.',
        },
      },
    };
  }

  const fromTeacher = await loadTeacherOr404(fromTeacherId);
  const toTeacher = await loadTeacherOr404(toTeacherId);
  if (!fromTeacher) {
    return {
      error: { status: 404, body: { success: false, message: 'Source teacher not found' } },
    };
  }
  if (!toTeacher) {
    return {
      error: {
        status: 404,
        body: { success: false, message: 'Destination teacher not found' },
      },
    };
  }

  if (req.user.userType === 'Admin') {
    const branchId = req.user.branchId;
    if (!branchId || fromTeacher.branch_id !== branchId || toTeacher.branch_id !== branchId) {
      return {
        error: {
          status: 403,
          body: {
            success: false,
            message: 'You can only turn over classes between teachers in your branch.',
          },
        },
      };
    }
  }

  return { fromTeacher, toTeacher };
}

async function resolveDestinationTeacherOrError(req, fromTeacher, toTeacherId) {
  if (!Number.isFinite(toTeacherId)) {
    return {
      error: {
        status: 400,
        body: { success: false, message: 'Invalid destination teacher.' },
      },
    };
  }
  if (Number(fromTeacher.user_id) === Number(toTeacherId)) {
    return {
      error: {
        status: 400,
        body: {
          success: false,
          message: 'Source and destination teacher must be different.',
        },
      },
    };
  }

  const toTeacher = await loadTeacherOr404(toTeacherId);
  if (!toTeacher) {
    return {
      error: {
        status: 404,
        body: { success: false, message: `Destination teacher not found: ${toTeacherId}` },
      },
    };
  }

  if (req.user.userType === 'Admin') {
    const branchId = req.user.branchId;
    if (!branchId || fromTeacher.branch_id !== branchId || toTeacher.branch_id !== branchId) {
      return {
        error: {
          status: 403,
          body: {
            success: false,
            message: 'You can only turn over classes between teachers in your branch.',
          },
        },
      };
    }
  }

  return { toTeacher };
}

/**
 * GET /teachers
 * List teachers with assigned classes.
 */
router.get(
  '/',
  requireRole('Superadmin', 'Admin'),
  [
    queryValidator('branch_id').optional().isInt().withMessage('branch_id must be an integer'),
    queryValidator('program_id').optional().isInt().withMessage('program_id must be an integer'),
    queryValidator('search').optional().isString(),
    queryValidator('page').optional().isInt({ min: 1 }),
    queryValidator('limit').optional().isInt({ min: 1, max: 100 }),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const offset = (page - 1) * limit;
      const search = String(req.query.search || '').trim();
      const programId =
        req.query.program_id != null && String(req.query.program_id).trim() !== ''
          ? Number(req.query.program_id)
          : null;

      let branchId =
        req.query.branch_id != null && String(req.query.branch_id).trim() !== ''
          ? Number(req.query.branch_id)
          : null;

      if (req.user.userType === 'Admin') {
        branchId = req.user.branchId;
        if (!branchId) {
          return res.status(403).json({
            success: false,
            message: 'Branch Admin must be assigned to a branch.',
          });
        }
      }

      const params = [];
      let where = `WHERE u.user_type = 'Teacher'`;
      if (branchId) {
        params.push(branchId);
        where += ` AND u.branch_id = $${params.length}`;
      }
      if (search) {
        params.push(`%${search}%`);
        where += ` AND (u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`;
      }
      if (programId) {
        params.push(programId);
        where += ` AND EXISTS (
          SELECT 1
          FROM classestbl c
          LEFT JOIN classteacherstbl ct
            ON ct.class_id = c.class_id AND ct.teacher_id = u.user_id
          WHERE (ct.teacher_id = u.user_id OR c.teacher_id = u.user_id)
            AND c.program_id = $${params.length}
            AND COALESCE(c.status, 'Active') = 'Active'
        )`;
      }

      const countRes = await query(
        `SELECT COUNT(*)::int AS total FROM userstbl u ${where}`,
        params
      );
      const total = countRes.rows[0]?.total || 0;

      params.push(limit);
      params.push(offset);
      const teachersRes = await query(
        `SELECT u.user_id, u.full_name, u.email, u.phone_number, u.branch_id,
                b.branch_name, b.branch_nickname
         FROM userstbl u
         LEFT JOIN branchestbl b ON b.branch_id = u.branch_id
         ${where}
         ORDER BY u.full_name ASC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );

      const data = [];
      for (const teacher of teachersRes.rows) {
        let classes = await loadAssignedClasses(teacher.user_id);
        if (programId) {
          classes = classes.filter((c) => Number(c.program_id) === programId);
        }
        data.push({
          ...teacher,
          branch_label: teacher.branch_nickname || teacher.branch_name || null,
          classes,
          class_count: classes.length,
        });
      }

      res.json({
        success: true,
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /teachers/:id/classes
 * Classes assigned to one teacher.
 */
router.get(
  '/:id/classes',
  requireRole('Superadmin', 'Admin'),
  [param('id').isInt().withMessage('Teacher ID must be an integer'), handleValidationErrors],
  async (req, res, next) => {
    try {
      const teacher = await loadTeacherOr404(req.params.id);
      if (!teacher) {
        return res.status(404).json({ success: false, message: 'Teacher not found' });
      }
      if (
        req.user.userType === 'Admin' &&
        req.user.branchId &&
        teacher.branch_id !== req.user.branchId
      ) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
      const classes = await loadAssignedClasses(teacher.user_id, { activeOnly: false });
      res.json({ success: true, data: { teacher, classes } });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /teachers/:id/class-history
 * View-only assignment history for a teacher (current + past, including turnovers).
 */
router.get(
  '/:id/class-history',
  requireRole('Superadmin', 'Admin'),
  [param('id').isInt().withMessage('Teacher ID must be an integer'), handleValidationErrors],
  async (req, res, next) => {
    try {
      const teacher = await loadTeacherOr404(req.params.id);
      if (!teacher) {
        return res.status(404).json({ success: false, message: 'Teacher not found' });
      }
      if (
        req.user.userType === 'Admin' &&
        req.user.branchId &&
        teacher.branch_id !== req.user.branchId
      ) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      await backfillOpenHistoryForTeacher(teacher.user_id);

      // Repair turnover rows where UTC storage made ended_at appear before assigned_at
      await query(
        `UPDATE teacher_class_historytbl
         SET ended_at = GREATEST(assigned_at, ${MANILA_NOW_SQL})
         WHERE teacher_id = $1
           AND end_reason = 'turnover'
           AND ended_at IS NOT NULL
           AND ended_at::date < assigned_at::date`,
        [teacher.user_id]
      );

      const historyRes = await query(
        `SELECT
           h.history_id,
           h.teacher_id,
           h.class_id,
           TO_CHAR(h.assigned_at, 'YYYY-MM-DD') AS assigned_ymd,
           TO_CHAR(h.assigned_at, 'YYYY-MM-DD HH24:MI') AS assigned_at_display,
           TO_CHAR(h.ended_at, 'YYYY-MM-DD') AS ended_ymd,
           TO_CHAR(h.ended_at, 'YYYY-MM-DD HH24:MI') AS ended_at_display,
           h.end_reason,
           h.turned_over_to_teacher_id,
           to_u.full_name AS turned_over_to_name,
           c.class_name,
           c.level_tag,
           c.status AS class_status,
           TO_CHAR(c.start_date, 'YYYY-MM-DD') AS class_start_date,
           TO_CHAR(c.end_date, 'YYYY-MM-DD') AS class_end_date,
           p.program_name,
           r.room_name,
           b.branch_name,
           b.branch_nickname
         FROM teacher_class_historytbl h
         INNER JOIN classestbl c ON c.class_id = h.class_id
         LEFT JOIN programstbl p ON p.program_id = c.program_id
         LEFT JOIN roomstbl r ON r.room_id = c.room_id
         LEFT JOIN branchestbl b ON b.branch_id = c.branch_id
         LEFT JOIN userstbl to_u ON to_u.user_id = h.turned_over_to_teacher_id
         WHERE h.teacher_id = $1
         ORDER BY h.assigned_at DESC, h.history_id DESC`,
        [teacher.user_id]
      );

      const todayYmd = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

      const rows = historyRes.rows.map((row) => {
        const isTurnover = row.end_reason === 'turnover';
        const isOpen = row.ended_ymd == null;
        const classEnded =
          row.class_end_date != null && String(row.class_end_date) < todayYmd;

        let period_start = row.assigned_ymd;
        let period_end = null;
        let period_label = 'Active';

        if (isTurnover) {
          // Never show turnover before assignment (timezone repair)
          period_end =
            row.ended_ymd && period_start && row.ended_ymd < period_start
              ? period_start
              : row.ended_ymd;
          period_label = 'Turned over';
        } else if (!isOpen) {
          period_end = row.ended_ymd || row.class_end_date;
          period_label =
            row.end_reason === 'class_completed' ? 'Class completed' : 'Ended';
        } else if (classEnded) {
          period_end = row.class_end_date;
          period_label = 'Class completed';
        } else {
          period_end = row.class_end_date;
          period_label = 'Active';
        }

        return {
          history_id: row.history_id,
          class_id: row.class_id,
          class_name: row.class_name,
          level_tag: row.level_tag,
          program_name: row.program_name,
          room_name: row.room_name,
          branch_label: row.branch_nickname || row.branch_name || null,
          class_status: row.class_status,
          class_start_date: row.class_start_date,
          class_end_date: row.class_end_date,
          assigned_at: row.assigned_ymd,
          assigned_at_display: row.assigned_at_display,
          ended_at: period_end,
          ended_at_display: row.ended_at_display,
          end_reason: row.end_reason,
          is_turnover: isTurnover,
          is_active: isOpen && !classEnded,
          turned_over_to_teacher_id: row.turned_over_to_teacher_id,
          turned_over_to_name: row.turned_over_to_name,
          period_start,
          period_end,
          period_label,
        };
      });

      res.json({
        success: true,
        data: {
          teacher: {
            user_id: teacher.user_id,
            full_name: teacher.full_name,
            email: teacher.email,
          },
          history: rows,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /teachers/:id/turnover/preview
 * Dry-run schedule fit for each class when a destination teacher is selected.
 * Body: { to_teacher_id: number, class_ids?: number[] }
 */
router.post(
  '/:id/turnover/options',
  requireRole('Superadmin', 'Admin'),
  [
    param('id').isInt().withMessage('Teacher ID must be an integer'),
    body('class_ids').optional().isArray().withMessage('class_ids must be an array'),
    body('class_ids.*').optional().isInt().withMessage('Each class_id must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const fromTeacherId = Number(req.params.id);
      const fromTeacher = await loadTeacherOr404(fromTeacherId);
      if (!fromTeacher) {
        return res.status(404).json({ success: false, message: 'Source teacher not found' });
      }
      if (
        req.user.userType === 'Admin' &&
        req.user.branchId &&
        fromTeacher.branch_id !== req.user.branchId
      ) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      const assigned = await loadAssignedClasses(fromTeacherId);
      const assignedIds = new Set(assigned.map((c) => Number(c.class_id)));
      const requestedIds = Array.isArray(req.body.class_ids)
        ? req.body.class_ids.map((id) => Number(id)).filter((id) => Number.isFinite(id))
        : assigned.map((c) => Number(c.class_id));
      const classIds = [...new Set(requestedIds)];
      const classesToCheck = assigned.filter((c) => classIds.includes(Number(c.class_id)));
      const notAssigned = classIds.filter((id) => !assignedIds.has(id));

      const candidateTeachers = await loadCandidateDestinationTeachers(req, fromTeacher);
      const classOptions = [];
      for (const cls of classesToCheck) {
        const available_teachers = [];
        const conflict_teachers = [];

        for (const teacher of candidateTeachers) {
          const evalRow = await evaluateClassForTurnover(cls, Number(teacher.user_id));
          if (evalRow.status === 'ok' || evalRow.status === 'already_assigned') {
            available_teachers.push({
              user_id: teacher.user_id,
              full_name: teacher.full_name,
              email: teacher.email,
              status: evalRow.status,
            });
          } else {
            conflict_teachers.push({
              user_id: teacher.user_id,
              full_name: teacher.full_name,
              conflicts: evalRow.conflicts || [],
            });
          }
        }

        classOptions.push({
          class_id: cls.class_id,
          class_name: cls.class_name,
          available_teachers,
          conflict_teachers,
        });
      }

      return res.json({
        success: true,
        data: {
          from_teacher: {
            user_id: fromTeacher.user_id,
            full_name: fromTeacher.full_name,
          },
          class_options: classOptions,
          not_assigned: notAssigned,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/turnover/preview',
  requireRole('Superadmin', 'Admin'),
  [
    param('id').isInt().withMessage('Teacher ID must be an integer'),
    body('to_teacher_id')
      .optional()
      .isInt()
      .withMessage('to_teacher_id must be an integer'),
    body('class_ids').optional().isArray().withMessage('class_ids must be an array'),
    body('class_ids.*').optional().isInt().withMessage('Each class_id must be an integer'),
    body('class_assignments')
      .optional()
      .isArray()
      .withMessage('class_assignments must be an array'),
    body('class_assignments.*.class_id')
      .optional()
      .isInt()
      .withMessage('Each class assignment class_id must be an integer'),
    body('class_assignments.*.to_teacher_id')
      .optional()
      .isInt()
      .withMessage('Each class assignment to_teacher_id must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const fromTeacherId = Number(req.params.id);
      const sourceTeacher = await loadTeacherOr404(fromTeacherId);
      if (!sourceTeacher) {
        return res.status(404).json({ success: false, message: 'Source teacher not found' });
      }
      if (
        req.user.userType === 'Admin' &&
        req.user.branchId &&
        sourceTeacher.branch_id !== req.user.branchId
      ) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      const assigned = await loadAssignedClasses(fromTeacherId);
      const assignedIds = new Set(assigned.map((c) => Number(c.class_id)));
      let classIds = Array.isArray(req.body.class_ids)
        ? req.body.class_ids.map((id) => Number(id)).filter((id) => Number.isFinite(id))
        : assigned.map((c) => Number(c.class_id));
      classIds = [...new Set(classIds)];

      const classesToCheck = assigned.filter((c) => classIds.includes(Number(c.class_id)));
      const notAssigned = classIds.filter((id) => !assignedIds.has(id));

      const rawAssignments = Array.isArray(req.body.class_assignments)
        ? req.body.class_assignments
            .map((row) => ({
              class_id: Number(row?.class_id),
              to_teacher_id: Number(row?.to_teacher_id),
            }))
            .filter((row) => Number.isFinite(row.class_id) && Number.isFinite(row.to_teacher_id))
        : [];

      const assignmentsByClass = new Map();
      if (rawAssignments.length > 0) {
        for (const row of rawAssignments) assignmentsByClass.set(row.class_id, row.to_teacher_id);
      } else {
        const fallbackToTeacherId = Number(req.body.to_teacher_id);
        if (!Number.isFinite(fallbackToTeacherId)) {
          return res.status(400).json({
            success: false,
            message:
              'Provide either to_teacher_id for all classes or class_assignments for per-class turnover.',
          });
        }
        for (const classId of classIds) assignmentsByClass.set(classId, fallbackToTeacherId);
      }

      const destinationTeacherIds = [...new Set([...assignmentsByClass.values()])];
      const teacherNameById = new Map();
      for (const destinationId of destinationTeacherIds) {
        const resolvedDest = await resolveDestinationTeacherOrError(req, sourceTeacher, destinationId);
        if (resolvedDest.error) {
          return res.status(resolvedDest.error.status).json(resolvedDest.error.body);
        }
        teacherNameById.set(destinationId, resolvedDest.toTeacher.full_name);
      }

      const classes = [];
      for (const cls of classesToCheck) {
        const destinationId = assignmentsByClass.get(Number(cls.class_id));
        if (!Number.isFinite(destinationId)) {
          classes.push({
            class_id: cls.class_id,
            class_name: cls.class_name,
            status: 'conflict',
            conflicts: [{ message: 'No destination teacher selected for this class.' }],
            to_teacher_id: null,
            to_teacher_name: null,
          });
          continue;
        }
        const evaluated = await evaluateClassForTurnover(cls, destinationId);
        classes.push({
          ...evaluated,
          to_teacher_id: destinationId,
          to_teacher_name: teacherNameById.get(destinationId) || null,
        });
      }

      const transferable = classes.filter((c) => c.status === 'ok' || c.status === 'already_assigned');
      const blocked = classes.filter((c) => c.status === 'conflict');

      res.json({
        success: true,
        data: {
          from_teacher: {
            user_id: sourceTeacher.user_id,
            full_name: sourceTeacher.full_name,
          },
          destination_teachers: destinationTeacherIds.map((id) => ({
            user_id: id,
            full_name: teacherNameById.get(id) || null,
          })),
          classes,
          transferable_count: transferable.length,
          blocked_count: blocked.length,
          not_assigned: notAssigned,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /teachers/:id/turnover
 * Transfer selected classes from this teacher to another teacher (schedule must fit).
 *
 * Body: { to_teacher_id: number, class_ids?: number[] }
 * If class_ids omitted, all active assigned classes are transferred.
 */
router.post(
  '/:id/turnover',
  requireRole('Superadmin', 'Admin'),
  [
    param('id').isInt().withMessage('Teacher ID must be an integer'),
    body('to_teacher_id')
      .optional()
      .isInt()
      .withMessage('to_teacher_id must be an integer'),
    body('class_ids').optional().isArray().withMessage('class_ids must be an array'),
    body('class_ids.*').optional().isInt().withMessage('Each class_id must be an integer'),
    body('class_assignments')
      .optional()
      .isArray()
      .withMessage('class_assignments must be an array'),
    body('class_assignments.*.class_id')
      .optional()
      .isInt()
      .withMessage('Each class assignment class_id must be an integer'),
    body('class_assignments.*.to_teacher_id')
      .optional()
      .isInt()
      .withMessage('Each class assignment to_teacher_id must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    const client = await getClient();
    try {
      const fromTeacherId = Number(req.params.id);
      const fromTeacher = await loadTeacherOr404(fromTeacherId);
      if (!fromTeacher) {
        return res.status(404).json({ success: false, message: 'Source teacher not found' });
      }
      if (
        req.user.userType === 'Admin' &&
        req.user.branchId &&
        fromTeacher.branch_id !== req.user.branchId
      ) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      const assigned = await loadAssignedClasses(fromTeacherId);
      const assignedIds = new Set(assigned.map((c) => Number(c.class_id)));
      let classIds = Array.isArray(req.body.class_ids)
        ? req.body.class_ids.map((id) => Number(id)).filter((id) => Number.isFinite(id))
        : assigned.map((c) => Number(c.class_id));

      classIds = [...new Set(classIds)];
      if (classIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No classes selected for turnover.',
        });
      }

      const notAssigned = classIds.filter((id) => !assignedIds.has(id));
      if (notAssigned.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Class(es) not assigned to ${fromTeacher.full_name}: ${notAssigned.join(', ')}`,
        });
      }

      const classesToTransfer = assigned.filter((c) => classIds.includes(Number(c.class_id)));
      const rawAssignments = Array.isArray(req.body.class_assignments)
        ? req.body.class_assignments
            .map((row) => ({
              class_id: Number(row?.class_id),
              to_teacher_id: Number(row?.to_teacher_id),
            }))
            .filter((row) => Number.isFinite(row.class_id) && Number.isFinite(row.to_teacher_id))
        : [];

      const assignmentsByClass = new Map();
      if (rawAssignments.length > 0) {
        for (const row of rawAssignments) assignmentsByClass.set(row.class_id, row.to_teacher_id);
      } else {
        const fallbackToTeacherId = Number(req.body.to_teacher_id);
        if (!Number.isFinite(fallbackToTeacherId)) {
          return res.status(400).json({
            success: false,
            message:
              'Provide either to_teacher_id for all classes or class_assignments for per-class turnover.',
          });
        }
        for (const classId of classIds) assignmentsByClass.set(classId, fallbackToTeacherId);
      }

      const destinationTeacherIds = [...new Set([...assignmentsByClass.values()])];
      const teacherNameById = new Map();
      for (const destinationId of destinationTeacherIds) {
        const resolvedDest = await resolveDestinationTeacherOrError(req, fromTeacher, destinationId);
        if (resolvedDest.error) {
          return res.status(resolvedDest.error.status).json(resolvedDest.error.body);
        }
        teacherNameById.set(destinationId, resolvedDest.toTeacher.full_name);
      }

      const evaluations = [];
      for (const cls of classesToTransfer) {
        const destinationId = assignmentsByClass.get(Number(cls.class_id));
        if (!Number.isFinite(destinationId)) {
          evaluations.push({
            class_id: cls.class_id,
            class_name: cls.class_name,
            status: 'conflict',
            conflicts: [{ message: 'No destination teacher selected for this class.' }],
            to_teacher_id: null,
            to_teacher_name: null,
          });
          continue;
        }
        const evaluated = await evaluateClassForTurnover(cls, destinationId);
        evaluations.push({
          ...evaluated,
          to_teacher_id: destinationId,
          to_teacher_name: teacherNameById.get(destinationId) || null,
        });
      }

      const conflictBlocks = evaluations.filter((e) => e.status === 'conflict');
      if (conflictBlocks.length > 0) {
        return res.status(400).json({
          success: false,
          message: `${toTeacher.full_name} has schedule conflicts with one or more classes. Turnover blocked.`,
          conflicts: conflictBlocks,
        });
      }

      await client.query('BEGIN');

      const transferred = [];
      for (const cls of classesToTransfer) {
        const destinationId = assignmentsByClass.get(Number(cls.class_id));
        if (!Number.isFinite(destinationId)) continue;

        await closeHistoryForTurnover(client, {
          fromTeacherId,
          toTeacherId: destinationId,
          classId: cls.class_id,
        });

        await client.query(
          `DELETE FROM classteacherstbl
           WHERE class_id = $1 AND teacher_id = $2`,
          [cls.class_id, fromTeacherId]
        );

        await client.query(
          `INSERT INTO classteacherstbl (class_id, teacher_id)
           VALUES ($1, $2)
           ON CONFLICT (class_id, teacher_id) DO NOTHING`,
          [cls.class_id, destinationId]
        );

        await client.query(
          `UPDATE classestbl
           SET teacher_id = $1
           WHERE class_id = $2 AND teacher_id = $3`,
          [destinationId, cls.class_id, fromTeacherId]
        );

        transferred.push({
          class_id: cls.class_id,
          class_name: cls.class_name,
          to_teacher_id: destinationId,
          to_teacher_name: teacherNameById.get(destinationId) || null,
        });
      }

      await client.query('COMMIT');

      res.json({
        success: true,
        message: `Turned over ${transferred.length} class(es) from ${fromTeacher.full_name}.`,
        data: {
          from_teacher: {
            user_id: fromTeacher.user_id,
            full_name: fromTeacher.full_name,
          },
          destination_teachers: destinationTeacherIds.map((id) => ({
            user_id: id,
            full_name: teacherNameById.get(id) || null,
          })),
          transferred,
        },
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      next(err);
    } finally {
      client.release();
    }
  }
);

export default router;
