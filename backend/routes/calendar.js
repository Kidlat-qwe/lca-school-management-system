import express from 'express';
import { query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole, requireBranchAccess } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query } from '../config/database.js';

const router = express.Router();

const DAY_NAME_TO_INDEX = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

const formatDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const toDateAtMidnight = (value, endOfDay = false) => {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  if (endOfDay) {
    date.setHours(23, 59, 59, 999);
  }
  return date;
};

router.use(verifyFirebaseToken);
router.use(requireBranchAccess);

// Student schedule endpoint
router.get(
  '/student/schedules',
  [
    queryValidator('start_date')
      .notEmpty()
      .withMessage('start_date is required')
      .isISO8601()
      .withMessage('start_date must be a valid date'),
    queryValidator('end_date')
      .optional()
      .isISO8601()
      .withMessage('end_date must be a valid date'),
    queryValidator('room_id').optional().isInt().withMessage('room_id must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Student'),
  async (req, res, next) => {
    try {
      const studentId = req.user.userId || req.user.user_id;
      if (!studentId) {
        return res.status(400).json({
          success: false,
          message: 'Student ID not found',
        });
      }

      const { start_date, end_date, room_id } = req.query;

      const rangeStart = toDateAtMidnight(start_date);
      if (!rangeStart) {
        return res.status(400).json({
          success: false,
          message: 'Invalid start_date. Please provide date in YYYY-MM-DD format.',
        });
      }

      let rangeEnd;
      if (end_date) {
        rangeEnd = toDateAtMidnight(end_date, true);
        if (!rangeEnd) {
          return res.status(400).json({
            success: false,
            message: 'Invalid end_date. Please provide date in YYYY-MM-DD format.',
          });
        }
      } else {
        rangeEnd = new Date(rangeStart);
        rangeEnd.setDate(rangeEnd.getDate() + 30);
        rangeEnd.setHours(23, 59, 59, 999);
      }

      if (rangeEnd < rangeStart) {
        return res.status(400).json({
          success: false,
          message: 'end_date must be greater than or equal to start_date.',
        });
      }

      // Build query parameters
      const params = [];
      let paramIndex = 1;

      // Get schedules for classes the student is enrolled in
      let schedulesQuery = `
        WITH latest_enrollment AS (
          SELECT DISTINCT ON (cs.student_id, cs.class_id)
            cs.student_id,
            cs.class_id,
            cs.phase_number,
            cs.enrolled_at,
            cs.classstudent_id
          FROM classstudentstbl cs
          WHERE cs.student_id = $${paramIndex}
          ORDER BY cs.student_id, cs.class_id, cs.enrolled_at DESC, cs.classstudent_id DESC
        )
        SELECT
          c.class_id,
          c.class_name,
          c.level_tag,
          c.branch_id,
          c.room_id AS class_room_id,
          COALESCE(rs.room_id, c.room_id) AS schedule_room_id,
          TO_CHAR(c.start_date, 'YYYY-MM-DD') AS class_start_date,
          TO_CHAR(c.end_date, 'YYYY-MM-DD') AS class_end_date,
          p.program_name,
          p.program_code,
          b.branch_name,
          rm.room_name,
          rs.day_of_week,
          rs.start_time,
          rs.end_time,
          c.teacher_id AS primary_teacher_id,
          primary_teacher.full_name AS primary_teacher_name,
          le.phase_number AS enrollment_phase
        FROM latest_enrollment le
        INNER JOIN classestbl c ON le.class_id = c.class_id
        INNER JOIN roomschedtbl rs ON rs.class_id = c.class_id
        LEFT JOIN roomstbl rm ON COALESCE(rs.room_id, c.room_id) = rm.room_id
        LEFT JOIN branchestbl b ON c.branch_id = b.branch_id
        LEFT JOIN programstbl p ON c.program_id = p.program_id
        LEFT JOIN userstbl primary_teacher ON c.teacher_id = primary_teacher.user_id
        WHERE rs.day_of_week IS NOT NULL
          AND c.status = 'Active'
          AND (
            (c.start_date IS NULL OR c.start_date <= $${paramIndex + 1})
            AND (c.end_date IS NULL OR c.end_date >= $${paramIndex + 2})
          )
      `;

      params.push(studentId);
      params.push(formatDate(rangeEnd));
      params.push(formatDate(rangeStart));
      paramIndex += 3;

      // Filter by room if provided
      if (room_id && room_id !== '' && room_id !== 'null') {
        schedulesQuery += ` AND COALESCE(rs.room_id, c.room_id) = $${paramIndex}`;
        params.push(parseInt(room_id));
        paramIndex++;
      }

      schedulesQuery += ` ORDER BY b.branch_name, rm.room_name, rs.day_of_week, rs.start_time`;

      const schedulesResult = await query(schedulesQuery, params);
      const scheduleRows = schedulesResult.rows;

      // Get teacher associations for classes
      const classIds = [...new Set(scheduleRows.map((row) => row.class_id))];
      const teacherMap = new Map();

      if (classIds.length > 0) {
        const teacherResult = await query(
          `
            SELECT
              ct.class_id,
              ct.teacher_id,
              u.full_name AS teacher_name
            FROM classteacherstbl ct
            INNER JOIN userstbl u ON ct.teacher_id = u.user_id
            WHERE ct.class_id = ANY($1::int[])
          `,
          [classIds]
        );

        teacherResult.rows.forEach((teacher) => {
          if (!teacher.teacher_id) return;
          if (!teacherMap.has(teacher.class_id)) {
            teacherMap.set(teacher.class_id, []);
          }
          const existing = teacherMap.get(teacher.class_id);
          if (!existing.find((t) => t.teacher_id === teacher.teacher_id)) {
            existing.push({
              teacher_id: teacher.teacher_id,
              teacher_name: teacher.teacher_name,
            });
          }
        });
      }

      scheduleRows.forEach((row) => {
        if (!teacherMap.has(row.class_id) || teacherMap.get(row.class_id).length === 0) {
          if (row.primary_teacher_id && row.primary_teacher_name) {
            teacherMap.set(row.class_id, [
              {
                teacher_id: row.primary_teacher_id,
                teacher_name: row.primary_teacher_name,
              },
            ]);
          } else if (!teacherMap.has(row.class_id)) {
            teacherMap.set(row.class_id, []);
          }
        }
      });

      // Get filter options (rooms available to this student)
      const roomOptions = new Map();
      scheduleRows.forEach((row) => {
        if (!roomOptions.has(row.schedule_room_id || row.class_room_id || 0)) {
          roomOptions.set(
            row.schedule_room_id || row.class_room_id || 0,
            row.room_name || 'Unassigned Room'
          );
        }
      });

      const events = [];

      scheduleRows.forEach((row) => {
        const scheduleDayIndex = DAY_NAME_TO_INDEX[row.day_of_week];
        if (scheduleDayIndex === undefined || !row.start_time) {
          return;
        }

        const classStartDate = row.class_start_date ? toDateAtMidnight(row.class_start_date) : null;
        const classEndDate = row.class_end_date ? toDateAtMidnight(row.class_end_date, true) : null;

        const windowStart = classStartDate && classStartDate > rangeStart ? classStartDate : rangeStart;
        const windowEnd = classEndDate && classEndDate < rangeEnd ? classEndDate : rangeEnd;

        if (windowEnd < windowStart) {
          return;
        }

        const firstOccurrence = new Date(windowStart);
        const startDayIndex = firstOccurrence.getDay();
        const daysUntilTarget = (scheduleDayIndex - startDayIndex + 7) % 7;
        firstOccurrence.setDate(firstOccurrence.getDate() + daysUntilTarget);

        if (firstOccurrence > windowEnd) {
          return;
        }

        for (
          let currentDate = new Date(firstOccurrence);
          currentDate <= windowEnd;
          currentDate.setDate(currentDate.getDate() + 7)
        ) {
          const dateStr = formatDate(currentDate);

          events.push({
            event_id: `${row.class_id}-${dateStr}-${row.start_time}-${row.day_of_week}`,
            class_id: row.class_id,
            title: row.program_code || row.program_name || `Class ${row.class_id}`,
            program_name: row.program_name,
            program_code: row.program_code,
            class_name: row.class_name,
            level_tag: row.level_tag,
            date: dateStr,
            day_of_week: row.day_of_week,
            start_time: row.start_time,
            end_time: row.end_time,
            start_datetime: `${dateStr}T${row.start_time}`,
            end_datetime: row.end_time ? `${dateStr}T${row.end_time}` : null,
            branch_id: row.branch_id,
            branch_name: row.branch_name,
            room_id: row.schedule_room_id,
            room_name: row.room_name,
            teachers: teacherMap.get(row.class_id) || [],
            enrollment_phase: row.enrollment_phase,
          });
        }
      });

      events.sort((a, b) => {
        if (a.start_datetime > b.start_datetime) return 1;
        if (a.start_datetime < b.start_datetime) return -1;
        return a.title.localeCompare(b.title);
      });

      res.json({
        success: true,
        data: events,
        filters: {
          rooms: Array.from(roomOptions.entries()).map(([roomId, roomName]) => ({
            room_id: roomId === 0 ? null : roomId,
            room_name: roomName,
          })),
        },
        meta: {
          total_events: events.length,
          range: {
            start_date: formatDate(rangeStart),
            end_date: formatDate(rangeEnd),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/schedules',
  [
    queryValidator('start_date')
      .notEmpty()
      .withMessage('start_date is required')
      .isISO8601()
      .withMessage('start_date must be a valid date'),
    queryValidator('end_date')
      .optional()
      .isISO8601()
      .withMessage('end_date must be a valid date'),
    queryValidator('teacher_id').optional().isInt().withMessage('teacher_id must be an integer'),
    queryValidator('branch_id').optional().isInt().withMessage('branch_id must be an integer'),
    queryValidator('room_id').optional().isInt().withMessage('room_id must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Teacher'),
  async (req, res, next) => {
    try {
      const { start_date, end_date, teacher_id, branch_id, room_id } = req.query;

      const rangeStart = toDateAtMidnight(start_date);
      if (!rangeStart) {
        return res.status(400).json({
          success: false,
          message: 'Invalid start_date. Please provide date in YYYY-MM-DD format.',
        });
      }

      let rangeEnd;
      if (end_date) {
        rangeEnd = toDateAtMidnight(end_date, true);
        if (!rangeEnd) {
          return res.status(400).json({
            success: false,
            message: 'Invalid end_date. Please provide date in YYYY-MM-DD format.',
          });
        }
      } else {
        rangeEnd = new Date(rangeStart);
        rangeEnd.setDate(rangeEnd.getDate() + 30);
        rangeEnd.setHours(23, 59, 59, 999);
      }

      if (rangeEnd < rangeStart) {
        return res.status(400).json({
          success: false,
          message: 'end_date must be greater than or equal to start_date.',
        });
      }

      const params = [];
      let paramIndex = 1;

      let schedulesQuery = `
        SELECT
          c.class_id,
          c.class_name,
          c.level_tag,
          c.branch_id,
          c.room_id AS class_room_id,
          COALESCE(rs.room_id, c.room_id) AS schedule_room_id,
          TO_CHAR(c.start_date, 'YYYY-MM-DD') AS class_start_date,
          TO_CHAR(c.end_date, 'YYYY-MM-DD') AS class_end_date,
          p.program_name,
          p.program_code,
          b.branch_name,
          rm.room_name,
          rs.day_of_week,
          rs.start_time,
          rs.end_time,
          c.teacher_id AS primary_teacher_id,
          primary_teacher.full_name AS primary_teacher_name
        FROM roomschedtbl rs
        INNER JOIN classestbl c ON rs.class_id = c.class_id
        LEFT JOIN roomstbl rm ON COALESCE(rs.room_id, c.room_id) = rm.room_id
        LEFT JOIN branchestbl b ON c.branch_id = b.branch_id
        LEFT JOIN programstbl p ON c.program_id = p.program_id
        LEFT JOIN userstbl primary_teacher ON c.teacher_id = primary_teacher.user_id
        WHERE rs.day_of_week IS NOT NULL
          AND c.status = 'Active'
      `;

      if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        schedulesQuery += ` AND c.branch_id = $${paramIndex}`;
        params.push(req.user.branchId);
        paramIndex++;
      }

      if (branch_id && branch_id !== '' && branch_id !== 'null') {
        schedulesQuery += ` AND c.branch_id = $${paramIndex}`;
        params.push(parseInt(branch_id));
        paramIndex++;
      }

      if (room_id && room_id !== '' && room_id !== 'null') {
        schedulesQuery += ` AND COALESCE(rs.room_id, c.room_id) = $${paramIndex}`;
        params.push(parseInt(room_id));
        paramIndex++;
      }

      if (teacher_id && teacher_id !== '' && teacher_id !== 'null') {
        const teacherParamIndex = paramIndex;
        params.push(parseInt(teacher_id));
        paramIndex++;
        schedulesQuery += `
          AND (
            c.teacher_id = $${teacherParamIndex}
            OR EXISTS (
              SELECT 1
              FROM classteacherstbl ct
              WHERE ct.class_id = c.class_id
                AND ct.teacher_id = $${teacherParamIndex}
            )
          )
        `;
      }

      const endParamIndex = paramIndex;
      params.push(formatDate(rangeEnd));
      paramIndex++;

      const startParamIndex = paramIndex;
      params.push(formatDate(rangeStart));
      paramIndex++;

      schedulesQuery += `
        AND (
          (c.start_date IS NULL OR c.start_date <= $${endParamIndex})
          AND (c.end_date IS NULL OR c.end_date >= $${startParamIndex})
        )
        ORDER BY b.branch_name, rm.room_name, rs.day_of_week, rs.start_time
      `;

      const schedulesResult = await query(schedulesQuery, params);
      const scheduleRows = schedulesResult.rows;

      // Get all branches (always unfiltered)
      let allBranchesQuery = `
        SELECT DISTINCT
          c.branch_id,
          b.branch_name
        FROM classestbl c
        LEFT JOIN branchestbl b ON c.branch_id = b.branch_id
        WHERE c.status = 'Active'
          AND (
            (c.start_date IS NULL OR c.start_date <= $1)
            AND (c.end_date IS NULL OR c.end_date >= $2)
          )
      `;
      
      const allBranchesParams = [formatDate(rangeEnd), formatDate(rangeStart)];
      let allBranchesParamIndex = 3;
      if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        allBranchesQuery += ` AND c.branch_id = $${allBranchesParamIndex}`;
        allBranchesParams.push(req.user.branchId);
        allBranchesParamIndex++;
      }
      
      const allBranchesResult = await query(allBranchesQuery, allBranchesParams);
      const allBranchesRows = allBranchesResult.rows;

      // Get rooms and teachers (filtered by branch if provided)
      let allFilterOptionsQuery = `
        SELECT DISTINCT
          c.class_id,
          c.branch_id,
          b.branch_name,
          COALESCE(rs.room_id, c.room_id) AS schedule_room_id,
          c.room_id AS class_room_id,
          rm.room_name,
          c.teacher_id AS primary_teacher_id,
          primary_teacher.full_name AS primary_teacher_name
        FROM classestbl c
        LEFT JOIN roomschedtbl rs ON rs.class_id = c.class_id
        LEFT JOIN roomstbl rm ON COALESCE(rs.room_id, c.room_id) = rm.room_id
        LEFT JOIN branchestbl b ON c.branch_id = b.branch_id
        LEFT JOIN userstbl primary_teacher ON c.teacher_id = primary_teacher.user_id
        WHERE c.status = 'Active'
          AND (
            (c.start_date IS NULL OR c.start_date <= $1)
            AND (c.end_date IS NULL OR c.end_date >= $2)
          )
      `;
      
      const allFilterOptionsParams = [formatDate(rangeEnd), formatDate(rangeStart)];
      let allFilterParamIndex = 3;
      if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        allFilterOptionsQuery += ` AND c.branch_id = $${allFilterParamIndex}`;
        allFilterOptionsParams.push(req.user.branchId);
        allFilterParamIndex++;
      }
      // Filter by branch if provided (for cascading filters - only affects rooms and teachers)
      if (branch_id && branch_id !== '' && branch_id !== 'null') {
        allFilterOptionsQuery += ` AND c.branch_id = $${allFilterParamIndex}`;
        allFilterOptionsParams.push(parseInt(branch_id));
        allFilterParamIndex++;
      }
      
      const allFilterOptionsResult = await query(allFilterOptionsQuery, allFilterOptionsParams);
      const allFilterRows = allFilterOptionsResult.rows;

      if (scheduleRows.length === 0) {
        // Still return filter options even if no schedules
        const emptyClassIds = [...new Set(allFilterRows.map((row) => row.class_id))];
        const emptyTeacherMap = new Map();
        
        if (emptyClassIds.length > 0) {
          const emptyTeacherResult = await query(
            `
              SELECT
                ct.class_id,
                ct.teacher_id,
                u.full_name AS teacher_name
              FROM classteacherstbl ct
              INNER JOIN userstbl u ON ct.teacher_id = u.user_id
              WHERE ct.class_id = ANY($1::int[])
            `,
            [emptyClassIds]
          );

          emptyTeacherResult.rows.forEach((teacher) => {
            if (!teacher.teacher_id) return;
            if (!emptyTeacherMap.has(teacher.class_id)) {
              emptyTeacherMap.set(teacher.class_id, []);
            }
            const existing = emptyTeacherMap.get(teacher.class_id);
            if (!existing.find((t) => t.teacher_id === teacher.teacher_id)) {
              existing.push({
                teacher_id: teacher.teacher_id,
                teacher_name: teacher.teacher_name,
              });
            }
          });
        }

        allFilterRows.forEach((row) => {
          if (!emptyTeacherMap.has(row.class_id) || emptyTeacherMap.get(row.class_id).length === 0) {
            if (row.primary_teacher_id && row.primary_teacher_name) {
              emptyTeacherMap.set(row.class_id, [
                {
                  teacher_id: row.primary_teacher_id,
                  teacher_name: row.primary_teacher_name,
                },
              ]);
            } else if (!emptyTeacherMap.has(row.class_id)) {
              emptyTeacherMap.set(row.class_id, []);
            }
          }
        });

        const emptyBranchOptions = new Map();
        const emptyRoomOptions = new Map();
        const emptyTeacherOptions = new Map();

        // Always use all branches (unfiltered)
        allBranchesRows.forEach((row) => {
          if (row.branch_id && row.branch_name && !emptyBranchOptions.has(row.branch_id)) {
            emptyBranchOptions.set(row.branch_id, row.branch_name);
          }
        });

        // Rooms and teachers are filtered by branch if provided
        allFilterRows.forEach((row) => {

          if (!emptyRoomOptions.has(row.schedule_room_id || row.class_room_id || 0)) {
            emptyRoomOptions.set(
              row.schedule_room_id || row.class_room_id || 0,
              row.room_name || 'Unassigned Room'
            );
          }

          (emptyTeacherMap.get(row.class_id) || []).forEach((teacher) => {
            if (teacher.teacher_id && !emptyTeacherOptions.has(teacher.teacher_id)) {
              emptyTeacherOptions.set(teacher.teacher_id, teacher.teacher_name);
            }
          });
        });

        return res.json({
          success: true,
          data: [],
          filters: {
            teachers: Array.from(emptyTeacherOptions.entries()).map(([teacherId, teacherName]) => ({
              teacher_id: teacherId,
              teacher_name: teacherName,
            })),
            branches: Array.from(emptyBranchOptions.entries()).map(([branchId, branchName]) => ({
              branch_id: branchId,
              branch_name: branchName,
            })),
            rooms: Array.from(emptyRoomOptions.entries()).map(([roomId, roomName]) => ({
              room_id: roomId === 0 ? null : roomId,
              room_name: roomName,
            })),
          },
          meta: {
            total_events: 0,
            range: {
              start_date: formatDate(rangeStart),
              end_date: formatDate(rangeEnd),
            },
          },
        });
      }

      const classIds = [...new Set(scheduleRows.map((row) => row.class_id))];
      const teacherMap = new Map();

      if (classIds.length > 0) {
        const teacherResult = await query(
          `
            SELECT
              ct.class_id,
              ct.teacher_id,
              u.full_name AS teacher_name
            FROM classteacherstbl ct
            INNER JOIN userstbl u ON ct.teacher_id = u.user_id
            WHERE ct.class_id = ANY($1::int[])
          `,
          [classIds]
        );

        teacherResult.rows.forEach((teacher) => {
          if (!teacher.teacher_id) return;
          if (!teacherMap.has(teacher.class_id)) {
            teacherMap.set(teacher.class_id, []);
          }
          const existing = teacherMap.get(teacher.class_id);
          if (!existing.find((t) => t.teacher_id === teacher.teacher_id)) {
            existing.push({
              teacher_id: teacher.teacher_id,
              teacher_name: teacher.teacher_name,
            });
          }
        });
      }

      scheduleRows.forEach((row) => {
        if (!teacherMap.has(row.class_id) || teacherMap.get(row.class_id).length === 0) {
          if (row.primary_teacher_id && row.primary_teacher_name) {
            teacherMap.set(row.class_id, [
              {
                teacher_id: row.primary_teacher_id,
                teacher_name: row.primary_teacher_name,
              },
            ]);
          } else if (!teacherMap.has(row.class_id)) {
            teacherMap.set(row.class_id, []);
          }
        }
      });

      // Build filter options from all available data (unfiltered)
      const allFilterClassIds = [...new Set(allFilterRows.map((row) => row.class_id))];
      const allFilterTeacherMap = new Map();

      if (allFilterClassIds.length > 0) {
        const allFilterTeacherResult = await query(
          `
            SELECT
              ct.class_id,
              ct.teacher_id,
              u.full_name AS teacher_name
            FROM classteacherstbl ct
            INNER JOIN userstbl u ON ct.teacher_id = u.user_id
            WHERE ct.class_id = ANY($1::int[])
          `,
          [allFilterClassIds]
        );

        allFilterTeacherResult.rows.forEach((teacher) => {
          if (!teacher.teacher_id) return;
          if (!allFilterTeacherMap.has(teacher.class_id)) {
            allFilterTeacherMap.set(teacher.class_id, []);
          }
          const existing = allFilterTeacherMap.get(teacher.class_id);
          if (!existing.find((t) => t.teacher_id === teacher.teacher_id)) {
            existing.push({
              teacher_id: teacher.teacher_id,
              teacher_name: teacher.teacher_name,
            });
          }
        });
      }

      allFilterRows.forEach((row) => {
        if (!allFilterTeacherMap.has(row.class_id) || allFilterTeacherMap.get(row.class_id).length === 0) {
          if (row.primary_teacher_id && row.primary_teacher_name) {
            allFilterTeacherMap.set(row.class_id, [
              {
                teacher_id: row.primary_teacher_id,
                teacher_name: row.primary_teacher_name,
              },
            ]);
          } else if (!allFilterTeacherMap.has(row.class_id)) {
            allFilterTeacherMap.set(row.class_id, []);
          }
        }
      });

      const branchOptions = new Map();
      const roomOptions = new Map();
      const teacherOptions = new Map();

      // Always use all branches (unfiltered)
      allBranchesRows.forEach((row) => {
        if (row.branch_id && row.branch_name && !branchOptions.has(row.branch_id)) {
          branchOptions.set(row.branch_id, row.branch_name);
        }
      });

      // Rooms and teachers are filtered by branch if provided
      allFilterRows.forEach((row) => {

        if (!roomOptions.has(row.schedule_room_id || row.class_room_id || 0)) {
          roomOptions.set(
            row.schedule_room_id || row.class_room_id || 0,
            row.room_name || 'Unassigned Room'
          );
        }

        (allFilterTeacherMap.get(row.class_id) || []).forEach((teacher) => {
          if (teacher.teacher_id && !teacherOptions.has(teacher.teacher_id)) {
            teacherOptions.set(teacher.teacher_id, teacher.teacher_name);
          }
        });
      });

      const events = [];

      // Fetch all class sessions for the date range to get class_code
      const sessionMap = new Map();
      if (classIds.length > 0) {
        const sessionsResult = await query(
          `SELECT 
            class_id,
            class_code,
            TO_CHAR(scheduled_date, 'YYYY-MM-DD') as scheduled_date,
            scheduled_start_time
          FROM classsessionstbl
          WHERE class_id = ANY($1::int[])
            AND scheduled_date >= $2
            AND scheduled_date <= $3`,
          [classIds, formatDate(rangeStart), formatDate(rangeEnd)]
        );

        sessionsResult.rows.forEach((session) => {
          const key = `${session.class_id}-${session.scheduled_date}-${session.scheduled_start_time}`;
          sessionMap.set(key, session.class_code);
        });
      }

      scheduleRows.forEach((row) => {
        const scheduleDayIndex = DAY_NAME_TO_INDEX[row.day_of_week];
        if (scheduleDayIndex === undefined || !row.start_time) {
          return;
        }

        const classStartDate = row.class_start_date ? toDateAtMidnight(row.class_start_date) : null;
        const classEndDate = row.class_end_date ? toDateAtMidnight(row.class_end_date, true) : null;

        const windowStart = classStartDate && classStartDate > rangeStart ? classStartDate : rangeStart;
        const windowEnd = classEndDate && classEndDate < rangeEnd ? classEndDate : rangeEnd;

        if (windowEnd < windowStart) {
          return;
        }

        const firstOccurrence = new Date(windowStart);
        const startDayIndex = firstOccurrence.getDay();
        const daysUntilTarget = (scheduleDayIndex - startDayIndex + 7) % 7;
        firstOccurrence.setDate(firstOccurrence.getDate() + daysUntilTarget);

        if (firstOccurrence > windowEnd) {
          return;
        }

        for (
          let currentDate = new Date(firstOccurrence);
          currentDate <= windowEnd;
          currentDate.setDate(currentDate.getDate() + 7)
        ) {
          const dateStr = formatDate(currentDate);
          const sessionKey = `${row.class_id}-${dateStr}-${row.start_time}`;
          const classCode = sessionMap.get(sessionKey);

          events.push({
            event_id: `${row.class_id}-${dateStr}-${row.start_time}-${row.day_of_week}`,
            class_id: row.class_id,
            title: row.program_code || row.program_name || `Class ${row.class_id}`,
            program_name: row.program_name,
            program_code: row.program_code,
            class_name: row.class_name,
            level_tag: row.level_tag,
            class_code: classCode || null,
            date: dateStr,
            day_of_week: row.day_of_week,
            start_time: row.start_time,
            end_time: row.end_time,
            start_datetime: `${dateStr}T${row.start_time}`,
            end_datetime: row.end_time ? `${dateStr}T${row.end_time}` : null,
            branch_id: row.branch_id,
            branch_name: row.branch_name,
            room_id: row.schedule_room_id,
            room_name: row.room_name,
            teachers: teacherMap.get(row.class_id) || [],
          });
        }
      });

      events.sort((a, b) => {
        if (a.start_datetime > b.start_datetime) return 1;
        if (a.start_datetime < b.start_datetime) return -1;
        return a.title.localeCompare(b.title);
      });

      res.json({
        success: true,
        data: events,
        filters: {
          teachers: Array.from(teacherOptions.entries()).map(([teacherId, teacherName]) => ({
            teacher_id: teacherId,
            teacher_name: teacherName,
          })),
          branches: Array.from(branchOptions.entries()).map(([branchId, branchName]) => ({
            branch_id: branchId,
            branch_name: branchName,
          })),
          rooms: Array.from(roomOptions.entries()).map(([roomId, roomName]) => ({
            room_id: roomId === 0 ? null : roomId,
            room_name: roomName,
          })),
        },
        meta: {
          total_events: events.length,
          range: {
            start_date: formatDate(rangeStart),
            end_date: formatDate(rangeEnd),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;

