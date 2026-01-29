import express from 'express';
import { body, param, query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole, requireBranchAccess } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query, getClient } from '../config/database.js';
import { generateClassSessions } from '../utils/sessionCalculation.js';
import { generateClassCode, extractStartTimeFromSchedule } from '../utils/classCodeGenerator.js';
import { getNationalHolidaySetForYears } from '../utils/holidayService.js';

const router = express.Router();

const getDefaultHolidayYearsFromStartDate = (startDate) => {
  if (!startDate) return [];
  const y = Number(String(startDate).slice(0, 4));
  if (!Number.isInteger(y)) return [];
  return [y, y + 1, y + 2, y + 3];
};

/**
 * Check if a schedule conflicts with existing active class schedules in a room
 * @param {number} roomId - Room ID
 * @param {string} dayOfWeek - Day of week (e.g., 'Monday')
 * @param {string} startTime - Start time (HH:MM format)
 * @param {string} endTime - End time (HH:MM format)
 * @param {number} excludeClassId - Class ID to exclude from conflict check (for updates)
 * @returns {Promise<{hasConflict: boolean, conflictingClass: object|null, message: string|null}>}
 */
const checkScheduleConflict = async (roomId, dayOfWeek, startTime, endTime, excludeClassId = null) => {
  if (!roomId || !dayOfWeek || !startTime || !endTime) {
    return { hasConflict: false, conflictingClass: null, message: null };
  }

  try {
    // Find all active classes using this room on this day
    let conflictQuery = `
      SELECT 
        rs.class_id,
        rs.day_of_week,
        rs.start_time,
        rs.end_time,
        c.class_id,
        c.class_name,
        c.level_tag,
        p.program_name,
        c.status
      FROM roomschedtbl rs
      INNER JOIN classestbl c ON rs.class_id = c.class_id
      LEFT JOIN programstbl p ON c.program_id = p.program_id
      WHERE rs.room_id = $1
        AND rs.day_of_week = $2
        AND c.status = 'Active'
        AND rs.start_time IS NOT NULL
        AND rs.end_time IS NOT NULL
    `;

    const params = [roomId, dayOfWeek];
    
    if (excludeClassId) {
      conflictQuery += ' AND rs.class_id != $3';
      params.push(excludeClassId);
    }

    const conflictResult = await query(conflictQuery, params);

    // Check for time overlap
    // Two time ranges overlap if: start1 < end2 AND start2 < end1
    for (const existingSchedule of conflictResult.rows) {
      const existingStart = existingSchedule.start_time;
      const existingEnd = existingSchedule.end_time;
      const newStart = startTime;
      const newEnd = endTime;

      // Convert times to comparable format (assuming HH:MM or HH:MM:SS format)
      const timeToMinutes = (timeStr) => {
        if (!timeStr) return 0;
        const parts = timeStr.split(':');
        return parseInt(parts[0]) * 60 + parseInt(parts[1] || 0);
      };

      const existingStartMin = timeToMinutes(existingStart);
      const existingEndMin = timeToMinutes(existingEnd);
      const newStartMin = timeToMinutes(newStart);
      const newEndMin = timeToMinutes(newEnd);

      // Check for overlap: newStart < existingEnd AND existingStart < newEnd
      if (newStartMin < existingEndMin && existingStartMin < newEndMin) {
        const className = existingSchedule.class_name 
          ? `${existingSchedule.program_name || ''} - ${existingSchedule.class_name}`.trim()
          : existingSchedule.level_tag 
            ? `${existingSchedule.program_name || ''} - ${existingSchedule.level_tag}`.trim()
            : existingSchedule.program_name || `Class ${existingSchedule.class_id}`;

        return {
          hasConflict: true,
          conflictingClass: {
            class_id: existingSchedule.class_id,
            class_name: existingSchedule.class_name,
            level_tag: existingSchedule.level_tag,
            program_name: existingSchedule.program_name,
          },
          message: `Schedule conflicts with active class "${className}" (${existingStart} - ${existingEnd})`,
        };
      }
    }

    return { hasConflict: false, conflictingClass: null, message: null };
  } catch (error) {
    console.error('Error checking schedule conflict:', error);
    // On error, don't block - let it through but log the error
    return { hasConflict: false, conflictingClass: null, message: null };
  }
};

/**
 * Check if a teacher has schedule conflicts with existing class sessions
 * @param {number} teacherId - Teacher user ID
 * @param {Array} daysOfWeek - Array of day schedules: [{day: 'Monday', start_time: '09:00', end_time: '10:00'}, ...]
 * @param {number} excludeClassId - Class ID to exclude from conflict check (for updates)
 * @returns {Promise<{hasConflict: boolean, conflicts: Array<{day: string, conflictingSession: object, message: string}>}>}
 */
const checkTeacherScheduleConflict = async (teacherId, daysOfWeek, excludeClassId = null) => {
  if (!teacherId || !daysOfWeek || !Array.isArray(daysOfWeek) || daysOfWeek.length === 0) {
    return { hasConflict: false, conflicts: [] };
  }

  try {
    // Get day names that are enabled
    const enabledDays = daysOfWeek.filter(d => d.enabled && d.start_time && d.end_time);
    if (enabledDays.length === 0) {
      return { hasConflict: false, conflicts: [] };
    }

    // Map day names to PostgreSQL day names (Monday -> Monday, etc.)
    // We need to check sessions where the scheduled_date falls on the same day of week
    // PostgreSQL EXTRACT(DOW FROM date) returns 0-6 (Sunday=0, Monday=1, ..., Saturday=6)
    const dayNameToDOW = {
      'Sunday': 0,
      'Monday': 1,
      'Tuesday': 2,
      'Wednesday': 3,
      'Thursday': 4,
      'Friday': 5,
      'Saturday': 6
    };

    const conflicts = [];

    // Check each enabled day
    for (const daySchedule of enabledDays) {
      const dayName = daySchedule.day;
      const dayOfWeek = dayNameToDOW[dayName];
      
      if (dayOfWeek === undefined) continue;

      // Query for sessions where:
      // 1. original_teacher_id matches the teacher
      // 2. The scheduled_date falls on the same day of week
      // 3. The scheduled times overlap
      // 4. Status is 'Scheduled' or 'Completed' (active sessions)
      let conflictQuery = `
        SELECT 
          cs.classsession_id,
          cs.class_id,
          cs.scheduled_date,
          cs.scheduled_start_time,
          cs.scheduled_end_time,
          cs.original_teacher_id,
          cs.status,
          c.class_name,
          c.level_tag,
          p.program_name
        FROM classsessionstbl cs
        INNER JOIN classestbl c ON cs.class_id = c.class_id
        LEFT JOIN programstbl p ON c.program_id = p.program_id
        WHERE cs.original_teacher_id = $1
          AND EXTRACT(DOW FROM cs.scheduled_date) = $2
          AND cs.status IN ('Scheduled', 'Completed')
          AND cs.scheduled_start_time IS NOT NULL
          AND cs.scheduled_end_time IS NOT NULL
      `;

      const params = [teacherId, dayOfWeek];
      
      if (excludeClassId) {
        conflictQuery += ' AND cs.class_id != $3';
        params.push(excludeClassId);
      }

      const conflictResult = await query(conflictQuery, params);

      // Check for time overlap with each existing session
      const timeToMinutes = (timeStr) => {
        if (!timeStr) return 0;
        const parts = timeStr.split(':');
        return parseInt(parts[0]) * 60 + parseInt(parts[1] || 0);
      };

      const newStartMin = timeToMinutes(daySchedule.start_time);
      const newEndMin = timeToMinutes(daySchedule.end_time);

      for (const existingSession of conflictResult.rows) {
        const existingStartMin = timeToMinutes(existingSession.scheduled_start_time);
        const existingEndMin = timeToMinutes(existingSession.scheduled_end_time);

        // Check for overlap: newStart < existingEnd AND existingStart < newEnd
        if (newStartMin < existingEndMin && existingStartMin < newEndMin) {
          const className = existingSession.class_name 
            ? `${existingSession.program_name || ''} - ${existingSession.class_name}`.trim()
            : existingSession.level_tag 
              ? `${existingSession.program_name || ''} - ${existingSession.level_tag}`.trim()
              : existingSession.program_name || `Class ${existingSession.class_id}`;

          conflicts.push({
            day: dayName,
            conflictingSession: {
              classsession_id: existingSession.classsession_id,
              class_id: existingSession.class_id,
              class_name: existingSession.class_name,
              level_tag: existingSession.level_tag,
              program_name: existingSession.program_name,
              scheduled_date: existingSession.scheduled_date,
              scheduled_start_time: existingSession.scheduled_start_time,
              scheduled_end_time: existingSession.scheduled_end_time,
            },
            message: `Teacher has a conflicting session on ${dayName} (${existingSession.scheduled_start_time} - ${existingSession.scheduled_end_time}) for class "${className}"`,
          });
        }
      }
    }

    return {
      hasConflict: conflicts.length > 0,
      conflicts: conflicts,
    };
  } catch (error) {
    console.error('Error checking teacher schedule conflict:', error);
    // On error, don't block - let it through but log the error
    return { hasConflict: false, conflicts: [] };
  }
};

// All routes require authentication
router.use(verifyFirebaseToken);
router.use(requireBranchAccess);

/**
 * GET /api/v1/classes
 * Get all classes
 * Access: All authenticated users
 */
router.get(
  '/',
  [
    queryValidator('branch_id').optional().isInt().withMessage('Branch ID must be an integer'),
    queryValidator('program_id').optional().isInt().withMessage('Program ID must be an integer'),
    queryValidator('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    queryValidator('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      // Automatically update classes to 'Inactive' if end_date has passed
      await query(
        `UPDATE classestbl 
         SET status = 'Inactive' 
         WHERE status = 'Active' 
         AND end_date IS NOT NULL 
         AND end_date < CURRENT_DATE`
      );

      const { branch_id, program_id, page = 1, limit = 20 } = req.query;
      const offset = (page - 1) * limit;

      let sql = `SELECT c.class_id,
                        c.branch_id,
                        c.room_id,
                        c.program_id,
                        c.teacher_id,
                        c.level_tag,
                        c.class_name,
                        c.max_students,
                        c.status,
                        TO_CHAR(c.start_date, 'YYYY-MM-DD') as start_date,
                        TO_CHAR(c.end_date, 'YYYY-MM-DD') as end_date,
                        u.full_name as teacher_name,
                        b.branch_name,
                        p.program_name,
                        p.program_code,
                        p.curriculum_id,
                        r.room_name,
                        cu.number_of_phase,
                        cu.number_of_session_per_phase,
                        c.phase_number as class_phase_number,
                        COALESCE(enrollment_counts.enrolled_count, 0) as enrolled_students,
                        CASE WHEN mh.merge_history_id IS NOT NULL AND mh.is_undone = false THEN true ELSE false END as is_merged_class,
                        mh.merge_history_id
                 FROM classestbl c
                 LEFT JOIN userstbl u ON c.teacher_id = u.user_id
                 LEFT JOIN branchestbl b ON c.branch_id = b.branch_id
                 LEFT JOIN programstbl p ON c.program_id = p.program_id
                 LEFT JOIN curriculumstbl cu ON p.curriculum_id = cu.curriculum_id
                 LEFT JOIN roomstbl r ON c.room_id = r.room_id
                 LEFT JOIN (
                   SELECT class_id, COUNT(DISTINCT student_id) as enrolled_count
                   FROM classstudentstbl
                   WHERE COALESCE(enrollment_status, 'Active') = 'Active'
                   GROUP BY class_id
                 ) enrollment_counts ON c.class_id = enrollment_counts.class_id
                 LEFT JOIN (
                   SELECT merged_class_id, merge_history_id, is_undone
                   FROM class_merge_historytbl
                   WHERE is_undone = false
                 ) mh ON c.class_id = mh.merged_class_id
                 WHERE 1=1`;
      const params = [];
      let paramCount = 0;

      // Filter by branch (non-superadmin users are limited to their branch)
      if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        paramCount++;
        sql += ` AND c.branch_id = $${paramCount}`;
        params.push(req.user.branchId);
      } else if (branch_id) {
        paramCount++;
        sql += ` AND c.branch_id = $${paramCount}`;
        params.push(branch_id);
      }

      if (program_id) {
        paramCount++;
        sql += ` AND c.program_id = $${paramCount}`;
        params.push(program_id);
      }

      sql += ` ORDER BY c.class_id DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
      params.push(limit, offset);

      const result = await query(sql, params);

      // Fetch room schedules and teachers for each class
      const classesWithSchedules = await Promise.all(
        result.rows.map(async (classItem) => {
          let schedules = [];
          if (classItem.room_id) {
            // First try to get schedules by class_id
            const schedulesByClass = await query(
              'SELECT day_of_week, start_time, end_time FROM roomschedtbl WHERE class_id = $1 ORDER BY day_of_week',
              [classItem.class_id]
            );
            
            if (schedulesByClass.rows.length > 0) {
              schedules = schedulesByClass.rows;
            } else {
              // If no schedules found by class_id, try to get by room_id
              const schedulesByRoom = await query(
                'SELECT day_of_week, start_time, end_time FROM roomschedtbl WHERE room_id = $1 ORDER BY day_of_week',
                [classItem.room_id]
              );
              schedules = schedulesByRoom.rows;
            }
          }
          
          // Fetch all teachers for this class from junction table
          let allTeachers = [];
          try {
            const teachersResult = await query(
              `SELECT ct.teacher_id, u.full_name as teacher_name
               FROM classteacherstbl ct
               INNER JOIN userstbl u ON ct.teacher_id = u.user_id
               WHERE ct.class_id = $1
               ORDER BY ct.created_at`,
              [classItem.class_id]
            );
            allTeachers = teachersResult.rows;
          } catch (teacherError) {
            // If junction table doesn't exist yet, fall back to single teacher
            if (classItem.teacher_id && classItem.teacher_name) {
              allTeachers = [{ teacher_id: classItem.teacher_id, teacher_name: classItem.teacher_name }];
            }
          }

          return {
            ...classItem,
            days_of_week: schedules,
            teachers: allTeachers, // Array of all teachers
            teacher_names: allTeachers.map(t => t.teacher_name).join(', '), // Comma-separated for display
          };
        })
      );

      res.json({
        success: true,
        data: classesWithSchedules,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/classes/:id
 * Get class by ID
 */
router.get(
  '/:id',
  [
    param('id').isInt().withMessage('Class ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    const client = await getClient();
    try {
      // Auto-expire unpaid reservations that are past due date
      // This runs when fetching class details to ensure reservation counts are accurate
      try {
        await client.query('BEGIN');
        
        // Find reservations that need to be expired:
        // 1. Status is 'Reserved' (reservation fee not paid)
        // 2. Due date has passed
        // 3. Invoice is unpaid or doesn't exist
        const expiredReservations = await client.query(
          `SELECT r.reserved_id, r.student_id, r.class_id, r.status, r.invoice_id, r.phase_number
           FROM reservedstudentstbl r
           WHERE r.status = 'Reserved'
             AND r.due_date IS NOT NULL
             AND r.due_date < CURRENT_DATE
             AND r.expired_at IS NULL
             AND (
               -- Either reservation fee invoice is unpaid or doesn't exist
               (r.invoice_id IS NULL)
               OR
               (r.invoice_id IS NOT NULL AND EXISTS (
                 SELECT 1 FROM invoicestbl inv 
                 WHERE inv.invoice_id = r.invoice_id 
                 AND inv.status NOT IN ('Paid', 'Partially Paid')
               ))
             )`,
          []
        );

        const expiredIds = [];
        for (const reservation of expiredReservations.rows) {
          // Check if student is enrolled
          const enrollmentCheck = await client.query(
            `SELECT cs.classstudent_id 
             FROM classstudentstbl cs
             WHERE cs.student_id = $1 
               AND cs.class_id = $2
               ${reservation.phase_number ? `AND cs.phase_number = $3` : ''}`,
            reservation.phase_number 
              ? [reservation.student_id, reservation.class_id, reservation.phase_number]
              : [reservation.student_id, reservation.class_id]
          );

          // If student is enrolled, unenroll them (removes from class count)
          if (enrollmentCheck.rows.length > 0) {
            for (const enrollment of enrollmentCheck.rows) {
              await client.query(
                'DELETE FROM classstudentstbl WHERE classstudent_id = $1',
                [enrollment.classstudent_id]
              );
              console.log(`⚠️ Student ${reservation.student_id} unenrolled from class ${reservation.class_id} due to expired reservation ${reservation.reserved_id}`);
            }
          }

          expiredIds.push(reservation.reserved_id);
        }

        // Update all expired reservations
        if (expiredIds.length > 0) {
          await client.query(
            `UPDATE reservedstudentstbl 
             SET status = 'Expired', expired_at = CURRENT_TIMESTAMP
             WHERE reserved_id = ANY($1::int[])`,
            [expiredIds]
          );
          console.log(`✅ Auto-expired ${expiredIds.length} reservation(s) when fetching class details`);
        }
        
        await client.query('COMMIT');
      } catch (expireError) {
        await client.query('ROLLBACK');
        console.error('Error auto-expiring reservations:', expireError);
        // Continue with class fetching even if expiration check fails
      }

      const { id } = req.params;

      // Automatically update this class to 'Inactive' if end_date has passed
      await client.query(
        `UPDATE classestbl 
         SET status = 'Inactive' 
         WHERE class_id = $1 
         AND status = 'Active' 
         AND end_date IS NOT NULL 
         AND end_date < CURRENT_DATE`,
        [id]
      );

      const result = await client.query(
        `SELECT c.class_id,
                c.branch_id,
                c.room_id,
                c.program_id,
                c.teacher_id,
                c.level_tag,
                c.class_name,
                c.max_students,
                c.status,
                TO_CHAR(c.start_date, 'YYYY-MM-DD') as start_date,
                TO_CHAR(c.end_date, 'YYYY-MM-DD') as end_date,
                c.phase_number as class_phase_number,
                b.branch_name,
                p.program_name,
                p.program_code,
                p.curriculum_id,
                r.room_name,
                cu.number_of_phase,
                cu.number_of_session_per_phase,
                COALESCE(enrollment_counts.enrolled_count, 0) as enrolled_students,
                COALESCE(reservation_counts.reserved_count, 0) as reserved_students
         FROM classestbl c
         LEFT JOIN branchestbl b ON c.branch_id = b.branch_id
         LEFT JOIN programstbl p ON c.program_id = p.program_id
         LEFT JOIN curriculumstbl cu ON p.curriculum_id = cu.curriculum_id
         LEFT JOIN roomstbl r ON c.room_id = r.room_id
         LEFT JOIN (
           SELECT class_id, COUNT(DISTINCT student_id) as enrolled_count
           FROM classstudentstbl
           WHERE COALESCE(enrollment_status, 'Active') = 'Active'
           GROUP BY class_id
         ) enrollment_counts ON c.class_id = enrollment_counts.class_id
         LEFT JOIN (
           SELECT class_id, COUNT(DISTINCT student_id) as reserved_count
           FROM reservedstudentstbl
           WHERE status NOT IN ('Cancelled', 'Expired', 'Upgraded')
           GROUP BY class_id
         ) reservation_counts ON c.class_id = reservation_counts.class_id
         WHERE c.class_id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Class not found',
        });
      }

      const classData = result.rows[0];
      
      // Fetch room schedules
      let schedules = [];
      if (classData.room_id) {
        // First try to get schedules by class_id
        const schedulesByClass = await client.query(
          'SELECT day_of_week, start_time, end_time FROM roomschedtbl WHERE class_id = $1 ORDER BY day_of_week',
          [id]
        );
        
        if (schedulesByClass.rows.length > 0) {
          schedules = schedulesByClass.rows;
        } else {
          // If no schedules found by class_id, try to get by room_id
          const schedulesByRoom = await client.query(
            'SELECT day_of_week, start_time, end_time FROM roomschedtbl WHERE room_id = $1 ORDER BY day_of_week',
            [classData.room_id]
          );
          schedules = schedulesByRoom.rows;
        }
      }
      
      // Fetch all teachers for this class from junction table
      let allTeachers = [];
      try {
        const teachersResult = await client.query(
          `SELECT ct.teacher_id, u.full_name as teacher_name
           FROM classteacherstbl ct
           INNER JOIN userstbl u ON ct.teacher_id = u.user_id
           WHERE ct.class_id = $1
           ORDER BY ct.created_at`,
          [id]
        );
        allTeachers = teachersResult.rows;
      } catch (teacherError) {
        // If junction table doesn't exist yet, fall back to single teacher
        if (classData.teacher_id) {
          const singleTeacher = await client.query(
            'SELECT user_id as teacher_id, full_name as teacher_name FROM userstbl WHERE user_id = $1',
            [classData.teacher_id]
          );
          if (singleTeacher.rows.length > 0) {
            allTeachers = singleTeacher.rows;
          }
        }
      }

      // Check if this class has merge history (is a merged class)
      const mergeHistoryCheck = await client.query(
        `SELECT merge_history_id, is_undone 
         FROM class_merge_historytbl 
         WHERE merged_class_id = $1 AND is_undone = false 
         ORDER BY merged_at DESC 
         LIMIT 1`,
        [id]
      );

      const isMergedClass = mergeHistoryCheck.rows.length > 0;
      const mergeHistoryId = isMergedClass ? mergeHistoryCheck.rows[0].merge_history_id : null;

      res.json({
        success: true,
        data: {
          ...classData,
          days_of_week: schedules,
          teachers: allTeachers,
          teacher_ids: allTeachers.map(t => t.teacher_id),
          is_merged_class: isMergedClass,
          merge_history_id: mergeHistoryId,
        },
      });
    } catch (error) {
      next(error);
    } finally {
      if (client) {
        client.release();
      }
    }
  }
);

/**
 * POST /api/v1/classes
 * Create new class
 * Access: Superadmin, Admin
 */
router.post(
  '/',
  [
    body('branch_id').isInt().withMessage('Branch ID is required'),
    body('program_id').isInt().withMessage('Program ID is required'),
    body('level_tag').optional().isString().withMessage('Level tag must be a string'),
    body('class_name').optional().isString().withMessage('Class name must be a string'),
    body('max_students').optional().isInt({ min: 1 }).withMessage('Max students must be a positive integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      
      const { branch_id, room_id, program_id, teacher_id, teacher_ids, level_tag, class_name, max_students, start_date, end_date, days_of_week } = req.body;
      
      // Support both teacher_id (single) and teacher_ids (array) for backward compatibility
      const teacherIdsArray = teacher_ids && Array.isArray(teacher_ids) && teacher_ids.length > 0 
        ? teacher_ids.filter(id => id !== null && id !== undefined && !isNaN(parseInt(id))).map(id => parseInt(id))
        : (teacher_id ? [parseInt(teacher_id)] : []);
      
      // Use first teacher_id for the main classestbl.teacher_id field (backward compatibility)
      const primaryTeacherId = teacherIdsArray.length > 0 ? teacherIdsArray[0] : null;
      
      console.log('📥 Received class creation request:', {
        branch_id,
        room_id,
        program_id,
        days_of_week,
        days_of_week_type: typeof days_of_week,
        days_of_week_is_array: Array.isArray(days_of_week),
        days_of_week_length: days_of_week?.length
      });

      // Verify branch exists
      const branchCheck = await query('SELECT branch_id FROM branchestbl WHERE branch_id = $1', [branch_id]);
      if (branchCheck.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Branch not found',
        });
      }

      // Verify program exists
      const programResult = await client.query(
        `SELECT p.*, c.number_of_phase, c.number_of_session_per_phase, c.curriculum_id
         FROM programstbl p
         LEFT JOIN curriculumstbl c ON p.curriculum_id = c.curriculum_id
         WHERE p.program_id = $1`,
        [program_id]
      );
      
      if (programResult.rows.length === 0) {
        // Rollback transaction before returning error
        // Note: Don't release client here - let the finally block handle it
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Program not found',
        });
      }

      const program = programResult.rows[0];
      
      // Auto-create phases and sessions if curriculum exists and they don't exist yet
      if (program.curriculum_id && program.number_of_phase && program.number_of_session_per_phase) {
        try {
          // Check if phases/sessions already exist for this curriculum
          const existingPhases = await query(
            'SELECT COUNT(*) as count FROM phasesessionstbl WHERE curriculum_id = $1',
            [program.curriculum_id]
          );

          // Only create if they don't exist
          if (parseInt(existingPhases.rows[0].count) === 0) {
            for (let phase = 1; phase <= program.number_of_phase; phase++) {
              for (let session = 1; session <= program.number_of_session_per_phase; session++) {
                await query(
                  `INSERT INTO phasesessionstbl (curriculum_id, phase_number, phase_session_number, topic, goal, agenda)
                   VALUES ($1, $2, $3, $4, $5, $6)`,
                  [
                    program.curriculum_id,
                    phase,
                    session,
                    null,
                    null,
                    null
                  ]
                );
              }
            }
          }
        } catch (phaseError) {
          // Log error but don't fail class creation
          console.error('Error creating phases/sessions:', phaseError);
        }
      }

      // Verify room exists if provided
      if (room_id) {
        const roomCheck = await client.query('SELECT room_id FROM roomstbl WHERE room_id = $1', [room_id]);
        if (roomCheck.rows.length === 0) {
          // Rollback transaction before returning error
          // Note: Don't release client here - let the finally block handle it
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: 'Room not found',
          });
        }
      }

      // Verify all teachers exist if provided
      if (teacherIdsArray.length > 0) {
        for (const tid of teacherIdsArray) {
          const teacherCheck = await client.query('SELECT user_id, user_type FROM userstbl WHERE user_id = $1', [tid]);
          if (teacherCheck.rows.length === 0) {
            // Rollback transaction before returning error
            // Note: Don't release client here - let the finally block handle it
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              message: `Teacher with ID ${tid} not found`,
            });
          }
          if (teacherCheck.rows[0].user_type !== 'Teacher') {
            // Rollback transaction before returning error
            // Note: Don't release client here - let the finally block handle it
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              message: `User with ID ${tid} is not a teacher`,
            });
          }
        }
      }

      // Create a single class entry
        const result = await client.query(
          `INSERT INTO classestbl (
            branch_id, room_id, program_id, teacher_id, level_tag, class_name,
            max_students, start_date, end_date, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING *`,
          [
            branch_id,
            room_id || null,
            program_id,
            primaryTeacherId,
            level_tag || null,
            class_name || null,
            max_students || null,
            start_date || null,
            end_date || null,
            'Active'
          ]
        );
      
      const newClass = result.rows[0];
      
      // Create junction table entries for multiple teachers (if classteacherstbl exists)
      if (teacherIdsArray.length > 0) {
        try {
          // Check if classteacherstbl exists, if not create it
          await client.query(`
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
          
          // Insert all teacher associations
          for (const tid of teacherIdsArray) {
            try {
              await client.query(
                `INSERT INTO classteacherstbl (class_id, teacher_id) 
                 VALUES ($1, $2) 
                 ON CONFLICT (class_id, teacher_id) DO NOTHING`,
                [newClass.class_id, tid]
              );
            } catch (insertError) {
              console.error(`Error inserting teacher ${tid} for class ${newClass.class_id}:`, insertError);
            }
          }
        } catch (tableError) {
          // If table creation fails, log but don't fail class creation
          console.error('Error creating/using classteacherstbl:', tableError);
        }
      }
        
        // Create room schedules AFTER class is created (so we have a valid class_id)
        if (days_of_week && Array.isArray(days_of_week) && days_of_week.length > 0 && room_id) {
        const classId = newClass.class_id;
          console.log('📅 Creating room schedules for room_id:', room_id, 'with class_id:', classId, 'days_of_week:', JSON.stringify(days_of_week, null, 2));
          let schedulesCreated = 0;
          
          // Check for conflicts before creating schedules
          for (const daySchedule of days_of_week) {
            if (daySchedule.day && daySchedule.start_time && daySchedule.end_time) {
              const conflict = await checkScheduleConflict(
                room_id,
                daySchedule.day,
                daySchedule.start_time,
                daySchedule.end_time,
                null // No exclude class for new class
              );

              if (conflict.hasConflict) {
                // Rollback transaction before returning error
                // Note: Don't release client here - let the finally block handle it
                await client.query('ROLLBACK');
                return res.status(400).json({
                  success: false,
                  message: conflict.message || `Schedule conflict detected for ${daySchedule.day}`,
                  conflict: {
                    day: daySchedule.day,
                    conflicting_class: conflict.conflictingClass,
                  },
                });
              }
            }
          }

          // If no conflicts, proceed with creating schedules
          // Note: Multiple classes can have schedules for the same room and day_of_week
          // The primary key is (class_id, room_id, day_of_week), so we check for THIS specific class
          for (const daySchedule of days_of_week) {
            if (daySchedule.day) {
              try {
                // Check if schedule already exists for THIS SPECIFIC class (not just room and day)
                const existingSchedule = await client.query(
                  'SELECT * FROM roomschedtbl WHERE class_id = $1 AND room_id = $2 AND day_of_week = $3',
                  [classId, room_id, daySchedule.day]
                );

                let insertResult;
                if (existingSchedule.rows.length > 0) {
                  // Update existing schedule for this class
                  insertResult = await client.query(
                    `UPDATE roomschedtbl 
                     SET start_time = $1, end_time = $2
                     WHERE class_id = $3 AND room_id = $4 AND day_of_week = $5
                     RETURNING *`,
                    [
                      daySchedule.start_time || null,
                      daySchedule.end_time || null,
                      classId,
                      room_id,
                      daySchedule.day
                    ]
                  );
                } else {
                  // Insert new schedule for this class
                  // Conflict check already ensures no time overlap, so this is safe
                  insertResult = await client.query(
                    `INSERT INTO roomschedtbl (class_id, room_id, day_of_week, start_time, end_time)
                     VALUES ($1, $2, $3, $4, $5)
                     RETURNING *`,
                    [
                      classId,
                      room_id,
                      daySchedule.day,
                      daySchedule.start_time || null,
                      daySchedule.end_time || null
                    ]
                  );
                }
                schedulesCreated++;
                console.log('✅ Created/updated schedule for class', classId, 'on', daySchedule.day, ':', daySchedule.start_time, '-', daySchedule.end_time, 'Result:', insertResult.rows[0]);
              } catch (scheduleError) {
                console.error('❌ Error creating room schedule for', daySchedule.day, ':', scheduleError);
                console.error('❌ Error details:', scheduleError.message, scheduleError.stack);
                // If it's a unique constraint violation, it means another class already has this exact schedule
                // This shouldn't happen due to conflict check, but handle it gracefully
                if (scheduleError.code === '23505') { // PostgreSQL unique violation
                  // Rollback transaction before returning error
                  // Note: Don't release client here - let the finally block handle it
                  await client.query('ROLLBACK');
                  return res.status(400).json({
                    success: false,
                    message: `A schedule already exists for this class, room, and day (${daySchedule.day}). This may indicate a duplicate submission.`,
                  });
                }
                throw scheduleError; // Re-throw to be caught by outer catch
              }
            } else {
              console.warn('⚠️ Skipping schedule entry - missing day:', daySchedule);
            }
          }
          console.log(`📊 Total schedules created/updated: ${schedulesCreated} out of ${days_of_week.length}`);
        }

      // Generate class sessions if we have all required data
      if (start_date && days_of_week && Array.isArray(days_of_week) && days_of_week.length > 0 && 
          program.number_of_phase && program.number_of_session_per_phase && program.curriculum_id) {
        try {
          console.log('📅 Generating class sessions...');
          
          // Get phase sessions for this curriculum
          const phaseSessionsResult = await query(
            `SELECT phasesessiondetail_id, phase_number, phase_session_number 
             FROM phasesessionstbl 
             WHERE curriculum_id = $1 
             ORDER BY phase_number, phase_session_number`,
            [program.curriculum_id]
          );
          
          // Get schedules formatted for generation
          const formattedDaysOfWeek = days_of_week
            .filter(day => day && (day.day || day.day_of_week) && day.enabled !== false)
            .map(day => ({
              day_of_week: day.day || day.day_of_week,
              start_time: day.start_time,
              end_time: day.end_time,
              enabled: day.enabled !== false
            }));

          const holidayYears = getDefaultHolidayYearsFromStartDate(start_date);
          const { dateSet: holidayDateSet } = getNationalHolidaySetForYears(holidayYears);

          // Generate sessions using utility function
          const sessions = generateClassSessions(
            {
              class_id: newClass.class_id,
              teacher_id: primaryTeacherId,
              start_date: start_date
            },
            formattedDaysOfWeek,
            phaseSessionsResult.rows,
            program.number_of_phase,
            program.number_of_session_per_phase,
            req.user.userId || null,
            program.session_duration_hours || null,
            holidayDateSet
          );

          // Insert sessions into database with generated class codes
          let sessionsCreated = 0;
          for (const session of sessions) {
            try {
              // Generate class code for this specific session
              let sessionClassCode = null;
              if (program.program_code && session.scheduled_date && session.scheduled_start_time && class_name) {
                sessionClassCode = generateClassCode(
                  program.program_code,
                  session.scheduled_date,
                  session.scheduled_start_time,
                  class_name
                );
              }
              
              await client.query(
                `INSERT INTO classsessionstbl (
                  class_id, phasesessiondetail_id, phase_number, phase_session_number,
                  scheduled_date, scheduled_start_time, scheduled_end_time,
                  original_teacher_id, assigned_teacher_id, status, created_by, class_code
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                ON CONFLICT (class_id, phase_number, phase_session_number, scheduled_date) DO NOTHING`,
                [
                  session.class_id,
                  session.phasesessiondetail_id,
                  session.phase_number,
                  session.phase_session_number,
                  session.scheduled_date,
                  session.scheduled_start_time,
                  session.scheduled_end_time,
                  session.original_teacher_id,
                  session.assigned_teacher_id,
                  session.status,
                  session.created_by,
                  sessionClassCode
                ]
              );
              sessionsCreated++;
              if (sessionClassCode) {
                console.log(`✅ Session ${session.phase_number}-${session.phase_session_number}: ${sessionClassCode}`);
              }
            } catch (sessionError) {
              console.error('❌ Error creating session:', sessionError);
            }
          }
          
          console.log(`✅ Generated ${sessionsCreated} sessions out of ${sessions.length} for class ${newClass.class_id}`);
        } catch (sessionGenError) {
          // Log error but don't fail class creation
          console.error('❌ Error generating class sessions:', sessionGenError);
        }
      }

      await client.query('COMMIT');
      
      res.status(201).json({
        success: true,
        message: 'Class created successfully',
        data: newClass,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally {
      client.release();
    }
  }
);

/**
 * PUT /api/v1/classes/:id
 * Update class
 * Access: Superadmin, Admin
 */
router.put(
  '/:id',
  [
    param('id').isInt().withMessage('Class ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      
      const { id } = req.params;
      const { branch_id, room_id, program_id, teacher_id, teacher_ids, level_tag, class_name, max_students, start_date, end_date, days_of_week } = req.body;
      
      // Support both teacher_id (single) and teacher_ids (array) for backward compatibility
      const teacherIdsArray = teacher_ids && Array.isArray(teacher_ids) && teacher_ids.length > 0 
        ? teacher_ids.filter(id => id !== null && id !== undefined && !isNaN(parseInt(id))).map(id => parseInt(id))
        : (teacher_id !== undefined ? (teacher_id ? [parseInt(teacher_id)] : []) : undefined);
      
      // Use first teacher_id for the main classestbl.teacher_id field (backward compatibility)
      const primaryTeacherId = teacherIdsArray !== undefined 
        ? (teacherIdsArray.length > 0 ? teacherIdsArray[0] : null)
        : undefined;

      // Check if class exists
      const existingClassResult = await client.query('SELECT * FROM classestbl WHERE class_id = $1', [id]);
      if (existingClassResult.rows.length === 0) {
        // Rollback transaction before returning error
        // Note: Don't release client here - let the finally block handle it
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Class not found',
        });
      }

      const existingClass = existingClassResult.rows[0];
      const finalRoomId = room_id !== undefined ? room_id : existingClass.room_id;

      // Check for conflicts if updating schedules
      if (days_of_week && Array.isArray(days_of_week) && days_of_week.length > 0 && finalRoomId) {
        for (const daySchedule of days_of_week) {
          if (daySchedule.day && daySchedule.start_time && daySchedule.end_time) {
            const conflict = await checkScheduleConflict(
              finalRoomId,
              daySchedule.day,
              daySchedule.start_time,
              daySchedule.end_time,
              id // Exclude current class from conflict check
            );

            if (conflict.hasConflict) {
              // Rollback transaction before returning error
              // Note: Don't release client here - let the finally block handle it
              await client.query('ROLLBACK');
              return res.status(400).json({
                success: false,
                message: conflict.message || `Schedule conflict detected for ${daySchedule.day}`,
                conflict: {
                  day: daySchedule.day,
                  conflicting_class: conflict.conflictingClass,
                },
              });
            }
          }
        }
      }

      // Build update query
      const updates = [];
      const params = [];
      let paramCount = 0;

      const fields = { branch_id, room_id, program_id, level_tag, class_name, max_students, start_date, end_date };
      Object.entries(fields).forEach(([key, value]) => {
        if (value !== undefined) {
          paramCount++;
          updates.push(`${key} = $${paramCount}`);
          params.push(value);
        }
      });
      
      // Handle teacher_id update
      if (primaryTeacherId !== undefined) {
        paramCount++;
        updates.push(`teacher_id = $${paramCount}`);
        params.push(primaryTeacherId);
      }

      if (updates.length === 0 && !days_of_week) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'No fields to update',
        });
      }

      // Update class fields if any
      if (updates.length > 0) {
        paramCount++;
        params.push(id);
        const sql = `UPDATE classestbl SET ${updates.join(', ')} WHERE class_id = $${paramCount} RETURNING *`;
        const result = await client.query(sql, params);
      }

      // Update schedules if provided
      if (days_of_week && Array.isArray(days_of_week) && finalRoomId) {
        // Check for schedule conflicts BEFORE deleting existing schedules
        for (const daySchedule of days_of_week) {
          if (daySchedule.day && daySchedule.enabled && daySchedule.start_time && daySchedule.end_time) {
            const conflict = await checkScheduleConflict(
              finalRoomId,
              daySchedule.day,
              daySchedule.start_time,
              daySchedule.end_time,
              id // Exclude current class from conflict check
            );

            if (conflict.hasConflict) {
              // Rollback transaction before returning error
              // Note: Don't release client here - let the finally block handle it
              await client.query('ROLLBACK');
              return res.status(400).json({
                success: false,
                message: conflict.message || `Schedule conflict detected for ${daySchedule.day}`,
                conflict: {
                  day: daySchedule.day,
                  conflicting_class: conflict.conflictingClass,
                },
              });
            }
          }
        }

        // Delete existing schedules for this class only (not other classes)
        await client.query('DELETE FROM roomschedtbl WHERE class_id = $1', [id]);

        // Create new schedules
        for (const daySchedule of days_of_week) {
          if (daySchedule.day && daySchedule.enabled && daySchedule.start_time && daySchedule.end_time) {
            await client.query(
              `INSERT INTO roomschedtbl (class_id, room_id, day_of_week, start_time, end_time)
               VALUES ($1, $2, $3, $4, $5)`,
              [
                id,
                finalRoomId,
                daySchedule.day,
                daySchedule.start_time,
                daySchedule.end_time
              ]
            );
          }
        }
      }
      
      // Update teacher associations if teacher_ids array is provided
      if (teacherIdsArray !== undefined) {
        try {
          // Ensure classteacherstbl exists
          await client.query(`
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
          
          // Delete existing teacher associations for this class
          await client.query('DELETE FROM classteacherstbl WHERE class_id = $1', [id]);
          
          // Insert new teacher associations
          for (const tid of teacherIdsArray) {
            // Verify teacher exists and is a teacher
            const teacherCheck = await client.query('SELECT user_id, user_type FROM userstbl WHERE user_id = $1', [tid]);
            if (teacherCheck.rows.length > 0 && teacherCheck.rows[0].user_type === 'Teacher') {
              await client.query(
                `INSERT INTO classteacherstbl (class_id, teacher_id) 
                 VALUES ($1, $2) 
                 ON CONFLICT (class_id, teacher_id) DO NOTHING`,
                [id, tid]
              );
            }
          }
        } catch (teacherTableError) {
          console.error('Error updating teacher associations:', teacherTableError);
          // Don't fail the update if teacher table operations fail
        }
      }

      // Regenerate sessions if schedule, start_date, teacher, or program changed
      // This ensures classsessionstbl always reflects the current class configuration
      const shouldRegenerateSessions = 
        days_of_week !== undefined || 
        start_date !== undefined || 
        primaryTeacherId !== undefined || 
        program_id !== undefined;

      if (shouldRegenerateSessions) {
        try {
          // Get updated class data with program and curriculum info
          const updatedClassResult = await client.query(
            `SELECT c.*, 
                    p.curriculum_id, 
                    p.session_duration_hours,
                    cu.number_of_phase, 
                    cu.number_of_session_per_phase
             FROM classestbl c
             LEFT JOIN programstbl p ON c.program_id = p.program_id
             LEFT JOIN curriculumstbl cu ON p.curriculum_id = cu.curriculum_id
             WHERE c.class_id = $1`,
            [id]
          );

          if (updatedClassResult.rows.length > 0) {
            const classData = updatedClassResult.rows[0];
            
            // Only regenerate if we have all required data
            if (classData.start_date && 
                classData.number_of_phase && 
                classData.number_of_session_per_phase && 
                classData.curriculum_id) {
              
              // Get current schedules (use updated schedules if days_of_week was provided)
              let schedulesResult;
              if (days_of_week && Array.isArray(days_of_week) && days_of_week.length > 0) {
                // Use the newly updated schedules
                schedulesResult = await client.query(
                  'SELECT day_of_week, start_time, end_time FROM roomschedtbl WHERE class_id = $1 ORDER BY day_of_week',
                  [id]
                );
              } else {
                // Use existing schedules
                schedulesResult = await client.query(
                  'SELECT day_of_week, start_time, end_time FROM roomschedtbl WHERE class_id = $1 ORDER BY day_of_week',
                  [id]
                );
              }

              if (schedulesResult.rows.length > 0) {
                console.log('🔄 Regenerating sessions for updated class...');
                
                // Get phase sessions for this curriculum
                const phaseSessionsResult = await client.query(
                  `SELECT phasesessiondetail_id, phase_number, phase_session_number 
                   FROM phasesessionstbl 
                   WHERE curriculum_id = $1 
                   ORDER BY phase_number, phase_session_number`,
                  [classData.curriculum_id]
                );

                // Format days of week
                const formattedDaysOfWeek = schedulesResult.rows.map(day => ({
                  day_of_week: day.day_of_week,
                  start_time: day.start_time,
                  end_time: day.end_time,
                  enabled: true
                }));

                const holidayYears = getDefaultHolidayYearsFromStartDate(classData.start_date);
                const { dateSet: holidayDateSet } = getNationalHolidaySetForYears(holidayYears);

                // Generate sessions using utility function
                const sessions = generateClassSessions(
                  {
                    class_id: id,
                    teacher_id: classData.teacher_id || null,
                    start_date: classData.start_date
                  },
                  formattedDaysOfWeek,
                  phaseSessionsResult.rows,
                  classData.number_of_phase,
                  classData.number_of_session_per_phase,
                  req.user.userId || null,
                  classData.session_duration_hours || null,
                  holidayDateSet
                );

                // Update or insert sessions using UPSERT
                // This handles both updates (when date/time changes) and new sessions
                let sessionsUpdated = 0;
                let sessionsCreated = 0;
                
                for (const session of sessions) {
                  try {
                    // Check if session already exists
                    const existingCheck = await client.query(
                      `SELECT classsession_id FROM classsessionstbl 
                       WHERE class_id = $1 
                         AND phase_number = $2 
                         AND phase_session_number = $3 
                         AND scheduled_date = $4`,
                      [
                        session.class_id,
                        session.phase_number,
                        session.phase_session_number,
                        session.scheduled_date
                      ]
                    );

                    // Use UPSERT: Update if exists (matching phase/session/date), insert if new
                    await client.query(
                      `INSERT INTO classsessionstbl (
                        class_id, phasesessiondetail_id, phase_number, phase_session_number,
                        scheduled_date, scheduled_start_time, scheduled_end_time,
                        original_teacher_id, assigned_teacher_id, status, created_by
                      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                      ON CONFLICT (class_id, phase_number, phase_session_number, scheduled_date) 
                      DO UPDATE SET
                        phasesessiondetail_id = EXCLUDED.phasesessiondetail_id,
                        scheduled_start_time = EXCLUDED.scheduled_start_time,
                        scheduled_end_time = EXCLUDED.scheduled_end_time,
                        original_teacher_id = EXCLUDED.original_teacher_id,
                        assigned_teacher_id = COALESCE(classsessionstbl.assigned_teacher_id, EXCLUDED.assigned_teacher_id),
                        updated_at = CURRENT_TIMESTAMP`,
                      [
                        session.class_id,
                        session.phasesessiondetail_id,
                        session.phase_number,
                        session.phase_session_number,
                        session.scheduled_date,
                        session.scheduled_start_time,
                        session.scheduled_end_time,
                        session.original_teacher_id,
                        session.assigned_teacher_id,
                        session.status,
                        session.created_by
                      ]
                    );

                    // Track if it was an insert or update
                    if (existingCheck.rows.length > 0) {
                      sessionsUpdated++;
                    } else {
                      sessionsCreated++;
                    }
                  } catch (sessionError) {
                    console.error('❌ Error updating/creating session:', sessionError);
                  }
                }

                // Delete sessions that are no longer needed (sessions that don't exist in the new generation)
                // This handles cases where schedule changes result in fewer sessions
                const existingSessionsResult = await client.query(
                  `SELECT classsession_id, phase_number, phase_session_number, 
                          TO_CHAR(scheduled_date, 'YYYY-MM-DD') as scheduled_date
                   FROM classsessionstbl WHERE class_id = $1`,
                  [id]
                );

                const newSessionKeys = new Set(
                  sessions.map(s => `${s.phase_number}_${s.phase_session_number}_${s.scheduled_date}`)
                );

                const sessionsToDelete = existingSessionsResult.rows.filter(existing => {
                  const key = `${existing.phase_number}_${existing.phase_session_number}_${existing.scheduled_date}`;
                  return !newSessionKeys.has(key);
                });

                if (sessionsToDelete.length > 0) {
                  // Only delete sessions that are still in 'Scheduled' status (not completed/cancelled)
                  const sessionIdsToDelete = sessionsToDelete
                    .map(s => s.classsession_id)
                    .filter(id => id !== null && id !== undefined);

                  if (sessionIdsToDelete.length > 0) {
                    await client.query(
                      `DELETE FROM classsessionstbl 
                       WHERE classsession_id = ANY($1::int[]) 
                       AND status = 'Scheduled'`,
                      [sessionIdsToDelete]
                    );
                    console.log(`🗑️ Deleted ${sessionIdsToDelete.length} obsolete scheduled session(s)`);
                  }
                }

                console.log(`✅ Regenerated sessions: ${sessionsUpdated} updated, ${sessionsCreated} created`);
              } else {
                console.log('⚠️ No schedules found for class, skipping session regeneration');
              }
            } else {
              console.log('⚠️ Class missing required data for session regeneration (start_date, phases, curriculum)');
            }
          }
        } catch (sessionGenError) {
          // Log error but don't fail the update
          console.error('❌ Error regenerating sessions:', sessionGenError);
        }
      }

      await client.query('COMMIT');

      // Fetch updated class
      const updatedClassResult = await client.query('SELECT * FROM classestbl WHERE class_id = $1', [id]);

      res.json({
        success: true,
        message: 'Class updated successfully',
        data: updatedClassResult.rows[0],
      });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally {
      client.release();
    }
  }
);

/**
 * DELETE /api/v1/classes/:id
 * Delete class
 * Access: Superadmin, Admin
 */
router.delete(
  '/:id',
  [
    param('id').isInt().withMessage('Class ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { id } = req.params;

      const existingClass = await client.query('SELECT * FROM classestbl WHERE class_id = $1', [id]);
      if (existingClass.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Class not found',
        });
      }

      // Check for dependencies that prevent deletion
      const enrolledStudents = await client.query(
        "SELECT COUNT(DISTINCT student_id) as count FROM classstudentstbl WHERE class_id = $1 AND COALESCE(enrollment_status, 'Active') = 'Active'",
        [id]
      );
      const studentCount = parseInt(enrolledStudents.rows[0].count, 10);

      const reservations = await client.query(
        'SELECT COUNT(*) as count FROM reservedstudentstbl WHERE class_id = $1 AND status != $2',
        [id, 'Cancelled']
      );
      const reservationCount = parseInt(reservations.rows[0].count, 10);

      const installmentProfiles = await client.query(
        'SELECT COUNT(*) as count FROM installmentinvoiceprofilestbl WHERE class_id = $1 AND is_active = true',
        [id]
      );
      const profileCount = parseInt(installmentProfiles.rows[0].count, 10);

      // If there are active dependencies, provide a clear error message
      if (studentCount > 0 || reservationCount > 0 || profileCount > 0) {
        await client.query('ROLLBACK');
        const reasons = [];
        if (studentCount > 0) reasons.push(`${studentCount} enrolled student(s)`);
        if (reservationCount > 0) reasons.push(`${reservationCount} active reservation(s)`);
        if (profileCount > 0) reasons.push(`${profileCount} active installment profile(s)`);
        
        return res.status(400).json({
          success: false,
          message: `Cannot delete class. It has ${reasons.join(', ')}. Please remove or handle these dependencies first.`,
          dependencies: {
            enrolled_students: studentCount,
            active_reservations: reservationCount,
            active_installment_profiles: profileCount
          }
        });
      }

      // Delete dependent records in correct order (those with CASCADE will auto-delete)
      // 1. Delete room schedules (ON DELETE NO ACTION)
      await client.query('DELETE FROM roomschedtbl WHERE class_id = $1', [id]);

      // 2. Set class_id to NULL in installment invoice profiles (ON DELETE SET NULL, but we'll do it explicitly)
      await client.query(
        'UPDATE installmentinvoiceprofilestbl SET class_id = NULL WHERE class_id = $1',
        [id]
      );

      // 3. Delete cancelled reservations (keep active ones blocked above)
      await client.query(
        'DELETE FROM reservedstudentstbl WHERE class_id = $1 AND status = $2',
        [id, 'Cancelled']
      );

      // 4. Delete class sessions (ON DELETE CASCADE - will auto-delete, but we'll do it explicitly for clarity)
      await client.query('DELETE FROM classsessionstbl WHERE class_id = $1', [id]);

      // 5. Delete class teacher associations (ON DELETE CASCADE - will auto-delete, but we'll do it explicitly)
      await client.query('DELETE FROM classteacherstbl WHERE class_id = $1', [id]);

      // 6. Finally, delete the class itself
      await client.query('DELETE FROM classestbl WHERE class_id = $1', [id]);

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Class deleted successfully',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error deleting class:', error);
      next(error);
    } finally {
      client.release();
    }
  }
);

/**
 * GET /api/sms/classes/:id/phasesessions
 * Get phase sessions for a class (through program -> curriculum)
 * Access: All authenticated users
 */
router.get(
  '/:id/phasesessions',
  [
    param('id').isInt().withMessage('Class ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;

      // Automatically update this class to 'Inactive' if end_date has passed
      await query(
        `UPDATE classestbl 
         SET status = 'Inactive' 
         WHERE class_id = $1 
         AND status = 'Active' 
         AND end_date IS NOT NULL 
         AND end_date < CURRENT_DATE`,
        [id]
      );

      // Get class with program and curriculum info
      const classResult = await query(
        `SELECT c.class_id,
                c.branch_id,
                c.room_id,
                c.program_id,
                c.teacher_id,
                c.level_tag,
                c.class_name,
                c.max_students,
                c.status,
                TO_CHAR(c.start_date, 'YYYY-MM-DD') as start_date,
                TO_CHAR(c.end_date, 'YYYY-MM-DD') as end_date,
                p.curriculum_id, 
                p.program_name, 
                cu.curriculum_name, 
                cu.number_of_phase, 
                cu.number_of_session_per_phase
         FROM classestbl c
         LEFT JOIN programstbl p ON c.program_id = p.program_id
         LEFT JOIN curriculumstbl cu ON p.curriculum_id = cu.curriculum_id
         WHERE c.class_id = $1`,
        [id]
      );

      if (classResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Class not found',
        });
      }

      const classData = classResult.rows[0];

      // Get schedules for this class
      let schedules = [];
      if (classData.room_id) {
        // First try to get schedules by class_id
        const schedulesByClass = await query(
          'SELECT day_of_week, start_time, end_time FROM roomschedtbl WHERE class_id = $1 ORDER BY day_of_week',
          [id]
        );
        
        if (schedulesByClass.rows.length > 0) {
          schedules = schedulesByClass.rows;
        } else {
          // If no schedules found by class_id, try to get by room_id
          const schedulesByRoom = await query(
            'SELECT day_of_week, start_time, end_time FROM roomschedtbl WHERE room_id = $1 ORDER BY day_of_week',
            [classData.room_id]
          );
          schedules = schedulesByRoom.rows;
        }
      }

      const classDataWithSchedules = {
        ...classData,
        days_of_week: schedules,
      };

      // If no curriculum, return empty array
      if (!classData.curriculum_id) {
        return res.json({
          success: true,
          data: {
            class: classDataWithSchedules,
            phasesessions: [],
          },
        });
      }

      // Auto-generate sessions if they don't exist and we have all required data
      // This ensures classsessionstbl always has accurate data
      const existingSessionsCount = await query(
        'SELECT COUNT(*) as count FROM classsessionstbl WHERE class_id = $1',
        [id]
      );

      if (parseInt(existingSessionsCount.rows[0].count) === 0 && 
          classData.start_date && 
          schedules.length > 0 && 
          classData.number_of_phase && 
          classData.number_of_session_per_phase) {
        try {
          console.log('🔄 Auto-generating missing sessions for class...');
          
          // Get phase sessions for this curriculum
          const phaseSessionsResult = await query(
            `SELECT phasesessiondetail_id, phase_number, phase_session_number 
             FROM phasesessionstbl 
             WHERE curriculum_id = $1 
             ORDER BY phase_number, phase_session_number`,
            [classData.curriculum_id]
          );

          // Format days of week
          const formattedDaysOfWeek = schedules.map(day => ({
            day_of_week: day.day_of_week,
            start_time: day.start_time,
            end_time: day.end_time,
            enabled: true
          }));

          const holidayYears = getDefaultHolidayYearsFromStartDate(classData.start_date);
          const { dateSet: holidayDateSet } = getNationalHolidaySetForYears(holidayYears);

          // Generate sessions using utility function
          const sessions = generateClassSessions(
            {
              class_id: id,
              teacher_id: classData.teacher_id || null,
              start_date: classData.start_date
            },
            formattedDaysOfWeek,
            phaseSessionsResult.rows,
            classData.number_of_phase,
            classData.number_of_session_per_phase,
            null, // System-generated
            classData.session_duration_hours || null,
            holidayDateSet
          );

          // Insert sessions into database
          let sessionsCreated = 0;
          for (const session of sessions) {
            try {
              await query(
                `INSERT INTO classsessionstbl (
                  class_id, phasesessiondetail_id, phase_number, phase_session_number,
                  scheduled_date, scheduled_start_time, scheduled_end_time,
                  original_teacher_id, assigned_teacher_id, status, created_by
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                ON CONFLICT (class_id, phase_number, phase_session_number, scheduled_date) DO NOTHING`,
                [
                  session.class_id,
                  session.phasesessiondetail_id,
                  session.phase_number,
                  session.phase_session_number,
                  session.scheduled_date,
                  session.scheduled_start_time,
                  session.scheduled_end_time,
                  session.original_teacher_id,
                  session.assigned_teacher_id,
                  session.status,
                  session.created_by
                ]
              );
              sessionsCreated++;
            } catch (sessionError) {
              console.error('❌ Error creating session:', sessionError);
            }
          }
          
          console.log(`✅ Auto-generated ${sessionsCreated} sessions for class ${id}`);
        } catch (autoGenError) {
          // Log error but don't fail the request
          console.error('❌ Error auto-generating sessions:', autoGenError);
        }
      }

      // Get all phase sessions for this curriculum
      const phasesessionsResult = await query(
        `SELECT * FROM phasesessionstbl 
         WHERE curriculum_id = $1 
         ORDER BY phase_number, phase_session_number`,
        [classData.curriculum_id]
      );

      // Get enrollment counts per phase for this class
      const enrollmentCountsResult = await query(
        `SELECT phase_number, COUNT(*) as enrolled_count
         FROM classstudentstbl
         WHERE class_id = $1
           AND phase_number IS NOT NULL
           AND COALESCE(enrollment_status, 'Active') = 'Active'
         GROUP BY phase_number`,
        [id]
      );

      // Create a map of phase_number -> enrollment_count
      const enrollmentCountsByPhase = {};
      enrollmentCountsResult.rows.forEach(row => {
        enrollmentCountsByPhase[row.phase_number] = parseInt(row.enrolled_count);
      });

      // Get actual class sessions to identify rescheduled sessions
      const actualClassSessionsResult = await query(
        `SELECT classsession_id, phase_number, phase_session_number, status, suspension_id
         FROM classsessionstbl
         WHERE class_id = $1
         ORDER BY phase_number, phase_session_number`,
        [id]
      );

      // Build a map of rescheduled sessions to their original cancelled sessions
      // Key: suspension_id, Value: array of cancelled session phase_numbers
      const rescheduledToCancelledMap = {};
      
      // Find all rescheduled sessions and their suspension_ids
      const rescheduledSessions = actualClassSessionsResult.rows.filter(s => s.status === 'Rescheduled' && s.suspension_id);
      if (rescheduledSessions.length > 0) {
        const suspensionIds = [...new Set(rescheduledSessions.map(s => s.suspension_id).filter(Boolean))];
        
        // Get cancelled sessions with the same suspension_ids
        const cancelledSessionsResult = await query(
          `SELECT phase_number, suspension_id
           FROM classsessionstbl
           WHERE class_id = $1 
             AND status = 'Cancelled'
             AND suspension_id = ANY($2::int[])`,
          [id, suspensionIds]
        );
        
        // Group cancelled sessions by suspension_id
        cancelledSessionsResult.rows.forEach(cancelled => {
          if (!rescheduledToCancelledMap[cancelled.suspension_id]) {
            rescheduledToCancelledMap[cancelled.suspension_id] = new Set();
          }
          if (cancelled.phase_number) {
            rescheduledToCancelledMap[cancelled.suspension_id].add(cancelled.phase_number);
          }
        });
      }

      // Create a map of phase_session to actual class session for quick lookup
      const classSessionMap = {};
      actualClassSessionsResult.rows.forEach(cs => {
        const key = `${cs.phase_number}-${cs.phase_session_number}`;
        if (!classSessionMap[key]) {
          classSessionMap[key] = [];
        }
        classSessionMap[key].push(cs);
      });

      // Create a set of curriculum session keys for quick lookup
      const curriculumSessionKeys = new Set(
        phasesessionsResult.rows.map(s => `${s.phase_number}-${s.phase_session_number}`)
      );

      // Add enrollment count to each phase session from curriculum
      const phasesessionsWithEnrollment = phasesessionsResult.rows.map(session => {
        const sessionKey = `${session.phase_number}-${session.phase_session_number}`;
        const matchingClassSessions = classSessionMap[sessionKey] || [];
        
        // Check if any matching class session is rescheduled
        const rescheduledSession = matchingClassSessions.find(cs => cs.status === 'Rescheduled' && cs.suspension_id);
        
        let enrolledCount = enrollmentCountsByPhase[session.phase_number] || 0;
        
        // For rescheduled sessions, use enrolled students from the original cancelled session's phase
        if (rescheduledSession && rescheduledSession.suspension_id && rescheduledToCancelledMap[rescheduledSession.suspension_id]) {
          // Get cancelled session phase numbers for this suspension
          const cancelledPhases = rescheduledToCancelledMap[rescheduledSession.suspension_id];
          
          // Sum up enrolled students from all cancelled sessions' phases
          let totalEnrolled = 0;
          cancelledPhases.forEach(phaseNum => {
            // Convert phaseNum to number if it's stored as string in Set
            const phaseKey = typeof phaseNum === 'string' ? parseInt(phaseNum) : phaseNum;
            totalEnrolled += enrollmentCountsByPhase[phaseKey] || 0;
          });
          
          // Use the total from cancelled sessions, or fallback to rescheduled session's phase
          enrolledCount = totalEnrolled > 0 ? totalEnrolled : enrolledCount;
        }
        
        return {
          ...session,
          enrolled_students: enrolledCount
        };
      });

      // Add extra rescheduled sessions that aren't in the curriculum template (make-up sessions)
      const extraRescheduledSessions = actualClassSessionsResult.rows
        .filter(cs => {
          const sessionKey = `${cs.phase_number}-${cs.phase_session_number}`;
          return cs.status === 'Rescheduled' && 
                 cs.suspension_id && 
                 !curriculumSessionKeys.has(sessionKey);
        })
        .map(cs => {
          let enrolledCount = enrollmentCountsByPhase[cs.phase_number] || 0;
          
          // For rescheduled sessions, use enrolled students from the original cancelled session's phase
          if (cs.suspension_id && rescheduledToCancelledMap[cs.suspension_id]) {
            const cancelledPhases = rescheduledToCancelledMap[cs.suspension_id];
            
            // Sum up enrolled students from all cancelled sessions' phases
            let totalEnrolled = 0;
            cancelledPhases.forEach(phaseNum => {
              // Convert phaseNum to number if it's stored as string in Set
              const phaseKey = typeof phaseNum === 'string' ? parseInt(phaseNum) : phaseNum;
              totalEnrolled += enrollmentCountsByPhase[phaseKey] || 0;
            });
            
            // Use the total from cancelled sessions
            enrolledCount = totalEnrolled > 0 ? totalEnrolled : enrolledCount;
          }
          
          // Create a phase session entry for this make-up session
          return {
            phasesessiondetail_id: `makeup-${cs.classsession_id}`, // Mark as make-up session
            phase_number: cs.phase_number,
            phase_session_number: cs.phase_session_number,
            topic: null,
            goal: null,
            agenda: null,
            enrolled_students: enrolledCount
          };
        });

      // Combine curriculum sessions with extra rescheduled sessions
      const allPhasesessions = [...phasesessionsWithEnrollment, ...extraRescheduledSessions]
        .sort((a, b) => {
          if (a.phase_number !== b.phase_number) {
            return a.phase_number - b.phase_number;
          }
          return a.phase_session_number - b.phase_session_number;
        });

      res.json({
        success: true,
        data: {
          class: classDataWithSchedules,
          phasesessions: allPhasesessions,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/classes/:id/sessions
 * Get all sessions for a class
 * Access: All authenticated users
 */
router.get(
  '/:id/sessions',
  [
    param('id').isInt().withMessage('Class ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;

      // Get class sessions
      const sessionsResult = await query(
        `SELECT 
          cs.classsession_id,
          cs.class_id,
          cs.phasesessiondetail_id,
          cs.phase_number,
          cs.phase_session_number,
          cs.class_code,
          TO_CHAR(cs.scheduled_date, 'YYYY-MM-DD') as scheduled_date,
          cs.scheduled_start_time,
          cs.scheduled_end_time,
          cs.original_teacher_id,
          cs.assigned_teacher_id,
          cs.substitute_teacher_id,
          cs.substitute_reason,
          cs.status,
          TO_CHAR(cs.actual_date, 'YYYY-MM-DD') as actual_date,
          cs.actual_start_time,
          cs.actual_end_time,
          cs.notes,
          u1.full_name as original_teacher_name,
          u2.full_name as assigned_teacher_name,
          u3.full_name as substitute_teacher_name,
          ps.topic,
          ps.goal,
          ps.agenda
         FROM classsessionstbl cs
         LEFT JOIN userstbl u1 ON cs.original_teacher_id = u1.user_id
         LEFT JOIN userstbl u2 ON cs.assigned_teacher_id = u2.user_id
         LEFT JOIN userstbl u3 ON cs.substitute_teacher_id = u3.user_id
         LEFT JOIN phasesessionstbl ps ON cs.phasesessiondetail_id = ps.phasesessiondetail_id
         WHERE cs.class_id = $1
         ORDER BY cs.scheduled_date, cs.scheduled_start_time`,
        [id]
      );

      res.json({
        success: true,
        data: sessionsResult.rows,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/v1/classes/:id/sessions/:sessionId
 * Update a class session (assign substitute teacher, reschedule, etc.)
 * Access: Superadmin, Admin
 */
router.put(
  '/:id/sessions/:sessionId',
  [
    param('id').isInt().withMessage('Class ID must be an integer'),
    param('sessionId').isInt().withMessage('Session ID must be an integer'),
    body('assigned_teacher_id').optional().isInt().withMessage('Assigned teacher ID must be an integer'),
    body('substitute_teacher_id').optional().isInt().withMessage('Substitute teacher ID must be an integer'),
    body('substitute_reason').optional().trim(),
    body('status').optional().isIn(['Scheduled', 'Completed', 'Cancelled', 'Rescheduled', 'In Progress']).withMessage('Invalid status'),
    body('actual_date').optional().isISO8601().withMessage('Actual date must be a valid date'),
    body('actual_start_time').optional().matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9](:00)?$/).withMessage('Actual start time must be in HH:MM format'),
    body('actual_end_time').optional().matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9](:00)?$/).withMessage('Actual end time must be in HH:MM format'),
    body('notes').optional().trim(),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id: class_id, sessionId } = req.params;
      const { 
        assigned_teacher_id, 
        substitute_teacher_id, 
        substitute_reason,
        status,
        actual_date,
        actual_start_time,
        actual_end_time,
        notes
      } = req.body;

      // Verify session exists and belongs to this class
      const sessionCheck = await query(
        'SELECT * FROM classsessionstbl WHERE classsession_id = $1 AND class_id = $2',
        [sessionId, class_id]
      );

      if (sessionCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Session not found or does not belong to this class',
        });
      }

      // If assigning substitute teacher, verify teacher exists and is a teacher
      if (substitute_teacher_id) {
        const teacherCheck = await query(
          'SELECT user_id, user_type FROM userstbl WHERE user_id = $1',
          [substitute_teacher_id]
        );
        if (teacherCheck.rows.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'Substitute teacher not found',
          });
        }
        if (teacherCheck.rows[0].user_type !== 'Teacher') {
          return res.status(400).json({
            success: false,
            message: 'Selected user is not a teacher',
          });
        }
      }

      // Build update query dynamically
      const updates = [];
      const params = [];
      let paramCount = 0;

      if (assigned_teacher_id !== undefined) {
        paramCount++;
        updates.push(`assigned_teacher_id = $${paramCount}`);
        params.push(assigned_teacher_id);
      }

      if (substitute_teacher_id !== undefined) {
        paramCount++;
        updates.push(`substitute_teacher_id = $${paramCount}`);
        params.push(substitute_teacher_id);
        
        // If assigning substitute, automatically set assigned_teacher_id to substitute
        if (assigned_teacher_id === undefined) {
          paramCount++;
          updates.push(`assigned_teacher_id = $${paramCount}`);
          params.push(substitute_teacher_id);
        }
      }

      if (substitute_reason !== undefined) {
        paramCount++;
        updates.push(`substitute_reason = $${paramCount}`);
        params.push(substitute_reason || null);
      }

      if (status !== undefined) {
        paramCount++;
        updates.push(`status = $${paramCount}`);
        params.push(status);
      }

      if (actual_date !== undefined) {
        paramCount++;
        updates.push(`actual_date = $${paramCount}`);
        params.push(actual_date || null);
      }

      if (actual_start_time !== undefined) {
        paramCount++;
        updates.push(`actual_start_time = $${paramCount}`);
        params.push(actual_start_time || null);
      }

      if (actual_end_time !== undefined) {
        paramCount++;
        updates.push(`actual_end_time = $${paramCount}`);
        params.push(actual_end_time || null);
      }

      if (notes !== undefined) {
        paramCount++;
        updates.push(`notes = $${paramCount}`);
        params.push(notes || null);
      }

      if (updates.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No fields to update',
        });
      }

      // Add updated_at and WHERE clause
      paramCount++;
      updates.push(`updated_at = CURRENT_TIMESTAMP`);
      paramCount++;
      params.push(sessionId);

      const updateQuery = `UPDATE classsessionstbl 
                           SET ${updates.join(', ')} 
                           WHERE classsession_id = $${paramCount} 
                           RETURNING *`;

      await query(updateQuery, params);

      // Get updated session with teacher names
      const updatedSessionResult = await query(
        `SELECT 
          cs.*,
          TO_CHAR(cs.scheduled_date, 'YYYY-MM-DD') as scheduled_date,
          TO_CHAR(cs.actual_date, 'YYYY-MM-DD') as actual_date,
          u1.full_name as original_teacher_name,
          u2.full_name as assigned_teacher_name,
          u3.full_name as substitute_teacher_name
         FROM classsessionstbl cs
         LEFT JOIN userstbl u1 ON cs.original_teacher_id = u1.user_id
         LEFT JOIN userstbl u2 ON cs.assigned_teacher_id = u2.user_id
         LEFT JOIN userstbl u3 ON cs.substitute_teacher_id = u3.user_id
         WHERE cs.classsession_id = $1`,
        [sessionId]
      );

      res.json({
        success: true,
        message: 'Session updated successfully',
        data: updatedSessionResult.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/classes/:id/generate-sessions
 * Generate sessions for an existing class (for classes created before session generation)
 * Access: Superadmin, Admin
 */
router.post(
  '/:id/generate-sessions',
  [
    param('id').isInt().withMessage('Class ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id: class_id } = req.params;

      // Get class with program and curriculum info
      const classResult = await query(
        `SELECT c.*, 
                p.curriculum_id, 
                p.session_duration_hours,
                cu.number_of_phase, 
                cu.number_of_session_per_phase
         FROM classestbl c
         LEFT JOIN programstbl p ON c.program_id = p.program_id
         LEFT JOIN curriculumstbl cu ON p.curriculum_id = cu.curriculum_id
         WHERE c.class_id = $1`,
        [class_id]
      );

      if (classResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Class not found',
        });
      }

      const classData = classResult.rows[0];

      if (!classData.start_date || !classData.number_of_phase || !classData.number_of_session_per_phase) {
        return res.status(400).json({
          success: false,
          message: 'Class is missing required data for session generation (start_date, phases, sessions per phase)',
        });
      }

      // Get schedules for this class
      const schedulesResult = await query(
        'SELECT day_of_week, start_time, end_time FROM roomschedtbl WHERE class_id = $1 ORDER BY day_of_week',
        [class_id]
      );

      if (schedulesResult.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No schedules found for this class. Please add schedules first.',
        });
      }

      // Get phase sessions for this curriculum
      const phaseSessionsResult = await query(
        `SELECT phasesessiondetail_id, phase_number, phase_session_number 
         FROM phasesessionstbl 
         WHERE curriculum_id = $1 
         ORDER BY phase_number, phase_session_number`,
        [classData.curriculum_id]
      );

      // Format days of week
      const formattedDaysOfWeek = schedulesResult.rows.map(day => ({
        day_of_week: day.day_of_week,
        start_time: day.start_time,
        end_time: day.end_time,
        enabled: true
      }));

      const holidayYears = getDefaultHolidayYearsFromStartDate(classData.start_date);
      const { dateSet: holidayDateSet } = getNationalHolidaySetForYears(holidayYears);

      // Generate sessions
      const sessions = generateClassSessions(
        {
          class_id: class_id,
          teacher_id: classData.teacher_id || null,
          start_date: classData.start_date
        },
        formattedDaysOfWeek,
        phaseSessionsResult.rows,
        classData.number_of_phase,
        classData.number_of_session_per_phase,
        req.user.userId || null,
        classData.session_duration_hours || null,
        holidayDateSet
      );

      // Insert sessions (skip duplicates)
      let sessionsCreated = 0;
      for (const session of sessions) {
        try {
          await query(
            `INSERT INTO classsessionstbl (
              class_id, phasesessiondetail_id, phase_number, phase_session_number,
              scheduled_date, scheduled_start_time, scheduled_end_time,
              original_teacher_id, assigned_teacher_id, status, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (class_id, phase_number, phase_session_number, scheduled_date) DO NOTHING`,
            [
              session.class_id,
              session.phasesessiondetail_id,
              session.phase_number,
              session.phase_session_number,
              session.scheduled_date,
              session.scheduled_start_time,
              session.scheduled_end_time,
              session.original_teacher_id,
              session.assigned_teacher_id,
              session.status,
              session.created_by
            ]
          );
          sessionsCreated++;
        } catch (sessionError) {
          console.error('Error creating session:', sessionError);
        }
      }

      res.json({
        success: true,
        message: `Generated ${sessionsCreated} sessions for class`,
        data: {
          total_sessions: sessions.length,
          sessions_created: sessionsCreated,
          sessions_skipped: sessions.length - sessionsCreated
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/classes/:id/sessions
 * Get all sessions for a class
 * Access: All authenticated users
 */
router.get(
  '/:id/sessions',
  [
    param('id').isInt().withMessage('Class ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;

      // Get class sessions
      const sessionsResult = await query(
        `SELECT 
          cs.classsession_id,
          cs.class_id,
          cs.phasesessiondetail_id,
          cs.phase_number,
          cs.phase_session_number,
          cs.class_code,
          TO_CHAR(cs.scheduled_date, 'YYYY-MM-DD') as scheduled_date,
          cs.scheduled_start_time,
          cs.scheduled_end_time,
          cs.original_teacher_id,
          cs.assigned_teacher_id,
          cs.substitute_teacher_id,
          cs.substitute_reason,
          cs.status,
          TO_CHAR(cs.actual_date, 'YYYY-MM-DD') as actual_date,
          cs.actual_start_time,
          cs.actual_end_time,
          cs.notes,
          u1.full_name as original_teacher_name,
          u2.full_name as assigned_teacher_name,
          u3.full_name as substitute_teacher_name,
          ps.topic,
          ps.goal,
          ps.agenda
         FROM classsessionstbl cs
         LEFT JOIN userstbl u1 ON cs.original_teacher_id = u1.user_id
         LEFT JOIN userstbl u2 ON cs.assigned_teacher_id = u2.user_id
         LEFT JOIN userstbl u3 ON cs.substitute_teacher_id = u3.user_id
         LEFT JOIN phasesessionstbl ps ON cs.phasesessiondetail_id = ps.phasesessiondetail_id
         WHERE cs.class_id = $1
         ORDER BY cs.scheduled_date, cs.scheduled_start_time`,
        [id]
      );

      res.json({
        success: true,
        data: sessionsResult.rows,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/v1/classes/:id/sessions/:sessionId
 * Update a class session (assign substitute teacher, reschedule, etc.)
 * Access: Superadmin, Admin
 */
router.put(
  '/:id/sessions/:sessionId',
  [
    param('id').isInt().withMessage('Class ID must be an integer'),
    param('sessionId').isInt().withMessage('Session ID must be an integer'),
    body('assigned_teacher_id').optional().isInt().withMessage('Assigned teacher ID must be an integer'),
    body('substitute_teacher_id').optional().isInt().withMessage('Substitute teacher ID must be an integer'),
    body('substitute_reason').optional().trim(),
    body('status').optional().isIn(['Scheduled', 'Completed', 'Cancelled', 'Rescheduled', 'In Progress']).withMessage('Invalid status'),
    body('actual_date').optional().isISO8601().withMessage('Actual date must be a valid date'),
    body('actual_start_time').optional().matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9](:00)?$/).withMessage('Actual start time must be in HH:MM format'),
    body('actual_end_time').optional().matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9](:00)?$/).withMessage('Actual end time must be in HH:MM format'),
    body('notes').optional().trim(),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id: class_id, sessionId } = req.params;
      const { 
        assigned_teacher_id, 
        substitute_teacher_id, 
        substitute_reason,
        status,
        actual_date,
        actual_start_time,
        actual_end_time,
        notes
      } = req.body;

      // Verify session exists and belongs to this class
      const sessionCheck = await query(
        'SELECT * FROM classsessionstbl WHERE classsession_id = $1 AND class_id = $2',
        [sessionId, class_id]
      );

      if (sessionCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Session not found or does not belong to this class',
        });
      }

      // If assigning substitute teacher, verify teacher exists and is a teacher
      if (substitute_teacher_id) {
        const teacherCheck = await query(
          'SELECT user_id, user_type FROM userstbl WHERE user_id = $1',
          [substitute_teacher_id]
        );
        if (teacherCheck.rows.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'Substitute teacher not found',
          });
        }
        if (teacherCheck.rows[0].user_type !== 'Teacher') {
          return res.status(400).json({
            success: false,
            message: 'Selected user is not a teacher',
          });
        }
      }

      // Build update query dynamically
      const updates = [];
      const params = [];
      let paramCount = 0;

      if (assigned_teacher_id !== undefined) {
        paramCount++;
        updates.push(`assigned_teacher_id = $${paramCount}`);
        params.push(assigned_teacher_id);
      }

      if (substitute_teacher_id !== undefined) {
        paramCount++;
        updates.push(`substitute_teacher_id = $${paramCount}`);
        params.push(substitute_teacher_id);
        
        // If assigning substitute, automatically set assigned_teacher_id to substitute
        if (assigned_teacher_id === undefined) {
          paramCount++;
          updates.push(`assigned_teacher_id = $${paramCount}`);
          params.push(substitute_teacher_id);
        }
      }

      if (substitute_reason !== undefined) {
        paramCount++;
        updates.push(`substitute_reason = $${paramCount}`);
        params.push(substitute_reason || null);
      }

      if (status !== undefined) {
        paramCount++;
        updates.push(`status = $${paramCount}`);
        params.push(status);
      }

      if (actual_date !== undefined) {
        paramCount++;
        updates.push(`actual_date = $${paramCount}`);
        params.push(actual_date || null);
      }

      if (actual_start_time !== undefined) {
        paramCount++;
        updates.push(`actual_start_time = $${paramCount}`);
        params.push(actual_start_time || null);
      }

      if (actual_end_time !== undefined) {
        paramCount++;
        updates.push(`actual_end_time = $${paramCount}`);
        params.push(actual_end_time || null);
      }

      if (notes !== undefined) {
        paramCount++;
        updates.push(`notes = $${paramCount}`);
        params.push(notes || null);
      }

      if (updates.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No fields to update',
        });
      }

      // Add updated_at and WHERE clause
      paramCount++;
      updates.push(`updated_at = CURRENT_TIMESTAMP`);
      paramCount++;
      params.push(sessionId);

      const updateQuery = `UPDATE classsessionstbl 
                           SET ${updates.join(', ')} 
                           WHERE classsession_id = $${paramCount} 
                           RETURNING *`;

      await query(updateQuery, params);

      // Get updated session with teacher names
      const updatedSessionResult = await query(
        `SELECT 
          cs.*,
          TO_CHAR(cs.scheduled_date, 'YYYY-MM-DD') as scheduled_date,
          TO_CHAR(cs.actual_date, 'YYYY-MM-DD') as actual_date,
          u1.full_name as original_teacher_name,
          u2.full_name as assigned_teacher_name,
          u3.full_name as substitute_teacher_name
         FROM classsessionstbl cs
         LEFT JOIN userstbl u1 ON cs.original_teacher_id = u1.user_id
         LEFT JOIN userstbl u2 ON cs.assigned_teacher_id = u2.user_id
         LEFT JOIN userstbl u3 ON cs.substitute_teacher_id = u3.user_id
         WHERE cs.classsession_id = $1`,
        [sessionId]
      );

      res.json({
        success: true,
        message: 'Session updated successfully',
        data: updatedSessionResult.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/classes/:id/generate-sessions
 * Generate sessions for an existing class (for classes created before session generation)
 * Access: Superadmin, Admin
 */
router.post(
  '/:id/generate-sessions',
  [
    param('id').isInt().withMessage('Class ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id: class_id } = req.params;

      // Get class with program and curriculum info
      const classResult = await query(
        `SELECT c.*, 
                p.curriculum_id, 
                p.session_duration_hours,
                cu.number_of_phase, 
                cu.number_of_session_per_phase
         FROM classestbl c
         LEFT JOIN programstbl p ON c.program_id = p.program_id
         LEFT JOIN curriculumstbl cu ON p.curriculum_id = cu.curriculum_id
         WHERE c.class_id = $1`,
        [class_id]
      );

      if (classResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Class not found',
        });
      }

      const classData = classResult.rows[0];

      if (!classData.start_date || !classData.number_of_phase || !classData.number_of_session_per_phase) {
        return res.status(400).json({
          success: false,
          message: 'Class is missing required data for session generation (start_date, phases, sessions per phase)',
        });
      }

      // Get schedules for this class
      const schedulesResult = await query(
        'SELECT day_of_week, start_time, end_time FROM roomschedtbl WHERE class_id = $1 ORDER BY day_of_week',
        [class_id]
      );

      if (schedulesResult.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No schedules found for this class. Please add schedules first.',
        });
      }

      // Get phase sessions for this curriculum
      const phaseSessionsResult = await query(
        `SELECT phasesessiondetail_id, phase_number, phase_session_number 
         FROM phasesessionstbl 
         WHERE curriculum_id = $1 
         ORDER BY phase_number, phase_session_number`,
        [classData.curriculum_id]
      );

      // Format days of week
      const formattedDaysOfWeek = schedulesResult.rows.map(day => ({
        day_of_week: day.day_of_week,
        start_time: day.start_time,
        end_time: day.end_time,
        enabled: true
      }));

      const holidayYears = getDefaultHolidayYearsFromStartDate(classData.start_date);
      const { dateSet: holidayDateSet } = getNationalHolidaySetForYears(holidayYears);

      // Generate sessions
      const sessions = generateClassSessions(
        {
          class_id: class_id,
          teacher_id: classData.teacher_id || null,
          start_date: classData.start_date
        },
        formattedDaysOfWeek,
        phaseSessionsResult.rows,
        classData.number_of_phase,
        classData.number_of_session_per_phase,
        req.user.userId || null,
        classData.session_duration_hours || null,
        holidayDateSet
      );

      // Insert sessions (skip duplicates)
      let sessionsCreated = 0;
      for (const session of sessions) {
        try {
          await query(
            `INSERT INTO classsessionstbl (
              class_id, phasesessiondetail_id, phase_number, phase_session_number,
              scheduled_date, scheduled_start_time, scheduled_end_time,
              original_teacher_id, assigned_teacher_id, status, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (class_id, phase_number, phase_session_number, scheduled_date) DO NOTHING`,
            [
              session.class_id,
              session.phasesessiondetail_id,
              session.phase_number,
              session.phase_session_number,
              session.scheduled_date,
              session.scheduled_start_time,
              session.scheduled_end_time,
              session.original_teacher_id,
              session.assigned_teacher_id,
              session.status,
              session.created_by
            ]
          );
          sessionsCreated++;
        } catch (sessionError) {
          console.error('Error creating session:', sessionError);
        }
      }

      res.json({
        success: true,
        message: `Generated ${sessionsCreated} sessions for class`,
        data: {
          total_sessions: sessions.length,
          sessions_created: sessionsCreated,
          sessions_skipped: sessions.length - sessionsCreated
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/classes/:id/enroll
 * Enroll a student in a class and generate invoice
 * Access: Superadmin, Admin
 */
router.post(
  '/:id/enroll',
  [
    param('id').isInt().withMessage('Class ID must be an integer'),
    body('student_id').isInt().withMessage('Student ID is required'),
    body('package_id').optional().isInt().withMessage('Package ID must be an integer'),
    body('selected_pricing_lists').optional().isArray().withMessage('Selected pricing lists must be an array'),
    body('selected_merchandise').optional().isArray().withMessage('Selected merchandise must be an array'),
    body('selected_merchandise.*.merchandise_id').optional().isInt().withMessage('Merchandise ID must be an integer'),
    body('selected_merchandise.*.size')
      .optional({ nullable: true, checkFalsy: true })
      .custom((value) => {
        if (value === null || value === undefined || value === '') return true;
        return typeof value === 'string';
      })
      .withMessage('Size must be a string'),
    body('installment_settings').optional().isObject().withMessage('Installment settings must be an object'),
    body('installment_settings.invoice_issue_date').optional().isISO8601().withMessage('Invoice issue date must be a valid date'),
    body('installment_settings.billing_month').optional().isString().withMessage('Billing month must be a string'),
    body('installment_settings.invoice_due_date').optional().isISO8601().withMessage('Invoice due date must be a valid date'),
    body('installment_settings.invoice_generation_date').optional().isISO8601().withMessage('Invoice generation date must be a valid date'),
    body('installment_settings.frequency_months').optional().isInt({ min: 1 }).withMessage('Frequency months must be a positive integer'),
    body('phase_number')
      .optional({ nullable: true, checkFalsy: true })
      .custom((value) => {
        if (value === null || value === undefined || value === '') return true;
        return Number.isInteger(value) && value >= 1;
      })
      .withMessage('Phase number must be null or a positive integer'),
    body('promo_id').optional().isInt().withMessage('Promo ID must be an integer'),
    body('promo_code').optional().trim(),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { id: class_id } = req.params;
      const { student_id, package_id, selected_pricing_lists = [], selected_merchandise = [], installment_settings, phase_number, per_phase_amount, reservation_invoice_settings, promo_id, promo_code } = req.body;

      // Verify class exists and get branch_id, phase, start date, and level_tag
      const classCheck = await client.query(
        `SELECT c.class_id, c.branch_id, c.max_students, c.start_date, c.phase_number, c.level_tag,
                b.branch_name, p.program_name, p.curriculum_id, cu.number_of_phase, cu.number_of_session_per_phase
         FROM classestbl c
         LEFT JOIN branchestbl b ON c.branch_id = b.branch_id
         LEFT JOIN programstbl p ON c.program_id = p.program_id
         LEFT JOIN curriculumstbl cu ON p.curriculum_id = cu.curriculum_id
         WHERE c.class_id = $1`,
        [class_id]
      );
      if (classCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Class not found',
        });
      }

      const classData = classCheck.rows[0];
      const branch_id = classData.branch_id;

      // Verify student exists and is a student (before branch validation)
      const studentCheck = await client.query(
        'SELECT user_id, full_name, user_type, level_tag, branch_id FROM userstbl WHERE user_id = $1',
        [student_id]
      );
      if (studentCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Student not found',
        });
      }
      if (studentCheck.rows[0].user_type !== 'Student') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'User is not a student',
        });
      }

      const studentData = studentCheck.rows[0];
      
      // Validate that student's branch matches class's branch
      const studentBranchId = studentData.branch_id;
      const classBranchId = classData.branch_id;
      
      if (studentBranchId && classBranchId && studentBranchId !== classBranchId) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Student cannot be enrolled in a class from a different branch. Student belongs to a different branch than the class.',
        });
      }

      // Check if student is already enrolled
      const existingEnrollment = await client.query(
        'SELECT classstudent_id FROM classstudentstbl WHERE student_id = $1 AND class_id = $2',
        [student_id, class_id]
      );
      if (existingEnrollment.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          message: 'Student is already enrolled in this class',
        });
      }

      // Update student's level_tag to match class's level_tag if they differ
      const classLevelTag = classData.level_tag;
      const studentLevelTag = studentData.level_tag;
      
      if (classLevelTag && classLevelTag !== studentLevelTag) {
        console.log(`🔄 Updating student level_tag from "${studentLevelTag}" to "${classLevelTag}"`);
        await client.query(
          'UPDATE userstbl SET level_tag = $1 WHERE user_id = $2',
          [classLevelTag, student_id]
        );
        console.log(`✅ Student level_tag updated successfully`);
      }

      // Determine enrollment phase
      // Priority: 1. User-provided phase_number (if valid), 2. Auto-determination based on class status
      let enrollmentPhase = 1; // Default to Phase 1
      
      // If phase_number is provided, validate it
      if (phase_number !== undefined && phase_number !== null) {
        const providedPhase = parseInt(phase_number);
        
        // Validate phase number is within valid range
        if (classData.number_of_phase) {
          if (providedPhase < 1 || providedPhase > classData.number_of_phase) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              message: `Invalid phase number. Must be between 1 and ${classData.number_of_phase} (curriculum has ${classData.number_of_phase} phase(s)).`,
            });
          }
        } else {
          // If no curriculum, still validate it's at least 1
          if (providedPhase < 1) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              message: 'Phase number must be at least 1.',
            });
          }
        }
        
        // Use provided phase number
        enrollmentPhase = providedPhase;
      } else {
        // Auto-determine phase based on class status
        // Logic: If class hasn't started (start_date > today), enroll in Phase 1
        //        If class is ongoing (start_date <= today), enroll in current phase
        const enrollmentToday = new Date();
        enrollmentToday.setHours(0, 0, 0, 0); // Reset time to start of day for comparison
        
        if (classData.start_date) {
          // PostgreSQL returns dates as strings in 'YYYY-MM-DD' format
          const startDateStr = classData.start_date;
          const startDate = new Date(startDateStr);
          startDate.setHours(0, 0, 0, 0);
          
          if (startDate > enrollmentToday) {
            // Class hasn't started yet - enroll in Phase 1
            enrollmentPhase = 1;
          } else {
            // Class is ongoing - enroll in current phase
            // Use class.phase_number if available, otherwise default to 1
            enrollmentPhase = classData.phase_number || 1;
            
            // Validate phase number doesn't exceed curriculum phases
            if (classData.number_of_phase && enrollmentPhase > classData.number_of_phase) {
              enrollmentPhase = classData.number_of_phase;
            }
          }
        } else if (classData.phase_number) {
          // If no start_date but phase_number exists, use it
          enrollmentPhase = classData.phase_number;
        }
      }

      // Initialize variables for tracking payment types
      let hasFullpaymentPricing = false;
      let isFullpaymentEnrollment = false;
      
      // Prepare invoice items first (we'll determine enrollment type after processing package/pricing)
      const invoiceItems = [];
      let totalAmount = 0;
      let packageName = null;
      // Initialize packageMerchandiseMap to avoid undefined errors
      let packageMerchandiseMap = new Map();
      let installmentPricingList = null; // Store installment pricing list for later use
      // Track pricing list level tags
      let hasInstallmentPricing = false;
      let installmentPricingPrice = null;
      // Optional phase range for Phase packages (used later in invoice remarks)
      let phaseStartForRemarks = null;
      let phaseEndForRemarks = null;
      // Initialize packageData to null - will be set if package_id is provided
      let packageData = null;

      // Ensure is_included column exists
      try {
        await client.query(`
          DO $$ 
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = 'packagedetailstbl' AND column_name = 'is_included'
            ) THEN
              ALTER TABLE packagedetailstbl ADD COLUMN is_included BOOLEAN DEFAULT true;
            END IF;
          END $$;
        `);
      } catch (err) {
        console.log('is_included column check:', err.message);
      }

      if (package_id) {
        // Get package details with is_included flag and merchandise quantity
        const packageResult = await client.query(
          `SELECT p.*, pd.pricinglist_id, pd.merchandise_id, pd.is_included,
                  pl.name as pricing_name, pl.level_tag as pricing_level_tag, pl.price as pricing_price,
                  m.merchandise_name, m.size, m.price as merchandise_price, m.quantity as merchandise_quantity
           FROM packagestbl p
           LEFT JOIN packagedetailstbl pd ON p.package_id = pd.package_id
           LEFT JOIN pricingliststbl pl ON pd.pricinglist_id = pl.pricinglist_id
           LEFT JOIN merchandisestbl m ON pd.merchandise_id = m.merchandise_id
           WHERE p.package_id = $1`,
          [package_id]
        );

        if (packageResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({
            success: false,
            message: 'Package not found',
          });
        }

        packageData = packageResult.rows[0];
        packageName = packageData.package_name || null;
        
        // Validate Promo package availability (date range and student limit)
        if (packageData.package_type === 'Promo') {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          
          const startDate = packageData.promo_start_date ? new Date(packageData.promo_start_date) : null;
          const endDate = packageData.promo_end_date ? new Date(packageData.promo_end_date) : null;
          
          if (!startDate || !endDate) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              message: 'Promo package is missing start or end date',
            });
          }
          
          startDate.setHours(0, 0, 0, 0);
          endDate.setHours(23, 59, 59, 999);
          
          // Check if promo is currently valid
          if (today < startDate) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              message: `This promo package is not yet available. It will be available from ${packageData.promo_start_date}.`,
            });
          }
          
          if (today > endDate) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              message: `This promo package has expired. It was available until ${packageData.promo_end_date}.`,
            });
          }
          
          // Check student limit if set
          if (packageData.promo_max_students_avail !== null && packageData.promo_max_students_avail !== undefined) {
            try {
              // Count distinct students who have used this promo package
              const usageCountResult = await client.query(
                `SELECT COUNT(DISTINCT inv_student.student_id) as student_count
                 FROM invoicestbl inv
                 INNER JOIN invoicestudentstbl inv_student ON inv.invoice_id = inv_student.invoice_id
                 WHERE inv.package_id = $1`,
                [package_id]
              );
              const studentsUsed = parseInt(usageCountResult.rows[0]?.student_count || 0);
              
              if (studentsUsed >= packageData.promo_max_students_avail) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                  success: false,
                  message: `This promo package has reached its maximum student limit (${packageData.promo_max_students_avail} students). No more slots available.`,
                });
              }
            } catch (err) {
              // If package_id column doesn't exist yet, we can't check usage
              // But we should still allow enrollment (graceful degradation)
              console.warn('Could not check promo package usage (package_id column may not exist yet):', err.message);
            }
          }
        }
        
        // Check if this is a Reserved package - if so, create reservation instead of enrollment
        if (packageData.package_type === 'Reserved') {
          // Determine phase_number for reservation
          // If phase_number is provided in request, use it (per-phase reservation)
          // If null/undefined, it means entire class reservation
          const reservationPhaseNumber = phase_number || null;

          // Check if student already has a reservation for this class/phase combination
          let existingReservation;
          if (reservationPhaseNumber === null) {
            // Entire class reservation - check if any reservation exists (including per-phase)
            existingReservation = await client.query(
              `SELECT reserved_id FROM reservedstudentstbl 
               WHERE student_id = $1 AND class_id = $2 AND status NOT IN ('Cancelled', 'Expired')`,
              [student_id, class_id]
            );
          } else {
            // Per-phase reservation - check if reservation exists for this specific phase
            existingReservation = await client.query(
              `SELECT reserved_id FROM reservedstudentstbl 
               WHERE student_id = $1 AND class_id = $2 AND phase_number = $3 AND status NOT IN ('Cancelled', 'Expired')`,
              [student_id, class_id, reservationPhaseNumber]
            );
          }

          if (existingReservation.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
              success: false,
              message: reservationPhaseNumber 
                ? `Student already has an active reservation for Phase ${reservationPhaseNumber} in this class`
                : 'Student already has an active reservation for this class',
            });
          }

          // Check if student is already enrolled (should not be enrolled if using reservation)
          const existingEnrollment = await client.query(
            `SELECT classstudent_id FROM classstudentstbl 
             WHERE student_id = $1 AND class_id = $2`,
            [student_id, class_id]
          );

          if (existingEnrollment.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
              success: false,
              message: 'Student is already enrolled in this class. Cannot create reservation for enrolled student.',
            });
          }

          // Check class capacity: count both enrolled students AND reserved students
          // Reservations reserve a spot but don't enroll the student
          if (classData.max_students) {
            const enrolledCount = await client.query(
              "SELECT COUNT(DISTINCT student_id) as count FROM classstudentstbl WHERE class_id = $1 AND COALESCE(enrollment_status, 'Active') = 'Active'",
              [class_id]
            );
            const reservedCount = await client.query(
              `SELECT COUNT(DISTINCT student_id) as count FROM reservedstudentstbl 
               WHERE class_id = $1 AND status NOT IN ('Cancelled', 'Expired')`,
              [class_id]
            );
            const currentEnrolled = parseInt(enrolledCount.rows[0].count) || 0;
            const currentReserved = parseInt(reservedCount.rows[0].count) || 0;
            const totalOccupied = currentEnrolled + currentReserved;
            
            if (totalOccupied >= classData.max_students) {
              await client.query('ROLLBACK');
              return res.status(400).json({
                success: false,
                message: `Class is full. Currently ${currentEnrolled} enrolled and ${currentReserved} reserved (${totalOccupied}/${classData.max_students} slots taken).`,
              });
            }
          }

          // Get reservation fee (use package price if available)
          const reservationFee = packageData.package_price || null;

          // Generate reservation fee invoice
          // Use reservation_invoice_settings if provided, otherwise use defaults
          let issueDate, dueDate;
          if (reservation_invoice_settings && reservation_invoice_settings.issue_date && reservation_invoice_settings.due_date) {
            issueDate = new Date(reservation_invoice_settings.issue_date);
            dueDate = new Date(reservation_invoice_settings.due_date);
            
            // Validate dates
            if (isNaN(issueDate.getTime()) || isNaN(dueDate.getTime())) {
              await client.query('ROLLBACK');
              return res.status(400).json({
                success: false,
                message: 'Invalid reservation invoice dates',
              });
            }
            
            // Validate that due date is after issue date
            if (dueDate <= issueDate) {
              await client.query('ROLLBACK');
              return res.status(400).json({
                success: false,
                message: 'Due date must be after the issue date',
              });
            }
          } else {
            // Default: issue date = today, due date = 1 week (7 days) from today
            issueDate = new Date();
            dueDate = new Date(issueDate);
            dueDate.setDate(dueDate.getDate() + 7);
          }

          // Ensure package_id column exists
          try {
            await client.query(`
              DO $$ 
              BEGIN
                IF NOT EXISTS (
                  SELECT 1 FROM information_schema.columns 
                  WHERE table_name = 'invoicestbl' AND column_name = 'package_id'
                ) THEN
                  ALTER TABLE invoicestbl ADD COLUMN package_id INTEGER;
                END IF;
              END $$;
            `);
          } catch (err) {
            console.log('package_id column check:', err.message);
          }

          const invoiceResult = await client.query(
            `INSERT INTO invoicestbl (invoice_description, branch_id, amount, status, issue_date, due_date, created_by, package_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [
              `Reservation Fee - ${packageName || 'Class Reservation'}`,
              branch_id,
              reservationFee || 0,
              'Pending',
              issueDate.toISOString().split('T')[0],
              dueDate.toISOString().split('T')[0],
              req.user.userId || null,
              package_id || null, // Link invoice to package
            ]
          );

          const reservationInvoice = invoiceResult.rows[0];

          // Link invoice to student
          await client.query(
            `INSERT INTO invoicestudentstbl (invoice_id, student_id)
             VALUES ($1, $2)`,
            [reservationInvoice.invoice_id, student_id]
          );

          // Add invoice item if reservation fee exists
          if (reservationFee && reservationFee > 0) {
            await client.query(
              `INSERT INTO invoiceitemstbl (invoice_id, description, amount)
               VALUES ($1, $2, $3)`,
              [reservationInvoice.invoice_id, `Reservation Fee - ${packageName || 'Class Reservation'}`, reservationFee]
            );
          }

          // Create reservation
          const reservationResult = await client.query(
            `INSERT INTO reservedstudentstbl 
             (student_id, class_id, package_id, branch_id, reservation_fee, status, reserved_by, invoice_id, phase_number)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING *`,
            [
              student_id,
              class_id,
              package_id,
              branch_id,
              reservationFee,
              'Reserved',
              req.user.fullName || req.user.email,
              reservationInvoice.invoice_id,
              reservationPhaseNumber,
            ]
          );

          await client.query('COMMIT');

          return res.status(201).json({
            success: true,
            message: 'Reservation created successfully. Reservation fee invoice generated.',
            data: {
              reservation: reservationResult.rows[0],
              invoice: reservationInvoice,
            },
          });
        }
        
        // If this is a Phase package, capture its phase range for invoice remarks
        if (packageData.package_type === 'Phase') {
          const pkgPhaseStart = packageData.phase_start || 1;
          const pkgPhaseEnd = packageData.phase_end || pkgPhaseStart;
          phaseStartForRemarks = pkgPhaseStart;
          phaseEndForRemarks = pkgPhaseEnd;
        }
        
        // Build a map of package merchandise with is_included flag
        packageMerchandiseMap = new Map();
        for (const pkgDetail of packageResult.rows) {
          if (pkgDetail.merchandise_id) {
            packageMerchandiseMap.set(pkgDetail.merchandise_id, {
              is_included: pkgDetail.is_included !== false, // Default to true if not set
              merchandise_name: pkgDetail.merchandise_name,
              size: pkgDetail.size,
              price: pkgDetail.merchandise_price,
              quantity: pkgDetail.merchandise_quantity
            });
          }
        }

        // IMPORTANT: Invoice logic for package enrollment
        // - Invoice document: Shows ONLY the package price (not individual pricing list items)
        // - Installment invoice profile: Shows the "New Enrollee Installment" pricing list price
        //   that matches the package's level_tag (e.g., Pre-Kindergarten)
        
        // Find the "New Enrollee Installment" pricing list that matches the package's level_tag
        // This will be used for the installment invoice profile amount
        const packageLevelTag = packageData.level_tag || null;
        installmentPricingList = packageResult.rows.find(
          pkgDetail => pkgDetail.pricinglist_id && 
          pkgDetail.pricing_name && 
          pkgDetail.pricing_name.toLowerCase().includes('new enrollee installment') &&
          // Ensure the pricing list's level_tag matches the package's level_tag for accuracy
          // This ensures we get the correct installment price for the specific level (Pre-Kindergarten, etc.)
          (!packageLevelTag || !pkgDetail.pricing_level_tag || 
           pkgDetail.pricing_level_tag.toLowerCase() === packageLevelTag.toLowerCase())
        );

        // Check if package has "New Enrollee Fullpayment" pricing list
        const fullpaymentPricingList = packageResult.rows.find(
          pkgDetail => pkgDetail.pricinglist_id && 
          pkgDetail.pricing_name && 
          pkgDetail.pricing_name.toLowerCase().includes('new enrollee fullpayment') &&
          (!packageLevelTag || !pkgDetail.pricing_level_tag || 
           pkgDetail.pricing_level_tag.toLowerCase() === packageLevelTag.toLowerCase())
        );
        
        // If package has fullpayment pricing, mark it
        if (fullpaymentPricingList) {
          hasFullpaymentPricing = true;
          // Update isFullpaymentEnrollment now that we know it's a fullpayment package
          isFullpaymentEnrollment = true;
        }

        // Invoice document: Use package price only
        // Individual pricing list prices (Enrollment Fee, Reservation Fee, etc.) are NOT shown on invoice
        // For Installment packages: package_price is the monthly installment amount, not a total
        // So we don't add it to invoice items (downpayment invoice will be created separately)
        // For other package types: package_price represents the total cost
        if (packageData.package_type !== 'Installment') {
          let packageAmount = 0;
          if (packageData.package_price && !isNaN(parseFloat(packageData.package_price))) {
            packageAmount = parseFloat(packageData.package_price);
          }

          // Add only the package as an invoice item (not individual pricing lists)
          invoiceItems.push({
            description: `Package: ${packageName || 'Package'}`,
            amount: packageAmount,
          });
          totalAmount = packageAmount; // Invoice total = package price
        }
        // For Installment packages, invoice items and totalAmount remain 0
        // Downpayment invoice will be created separately with downpayment_amount
      } else {
        // Add per-phase amount if provided (for per-phase enrollment)
        if (per_phase_amount && !isNaN(parseFloat(per_phase_amount))) {
          const phaseAmount = parseFloat(per_phase_amount);
          invoiceItems.push({
            description: 'Per-Phase Enrollment Amount',
            amount: phaseAmount,
          });
          totalAmount += phaseAmount;
        }
        
        // Get selected pricing lists
        if (selected_pricing_lists && selected_pricing_lists.length > 0) {
          const pricingListsResult = await client.query(
            `SELECT pricinglist_id, name, level_tag, price 
             FROM pricingliststbl 
             WHERE pricinglist_id = ANY($1::int[])`,
            [selected_pricing_lists]
          );

          pricingListsResult.rows.forEach((pricing) => {
            if (pricing.price && !isNaN(parseFloat(pricing.price))) {
              const price = parseFloat(pricing.price);
              invoiceItems.push({
                description: `Pricing: ${pricing.name || 'Pricing'}${pricing.level_tag ? ` (${pricing.level_tag})` : ''}`,
                amount: price,
              });
              totalAmount += price;
              
              // Check for installment or fullpayment pricing lists
              if (pricing.level_tag && pricing.level_tag.toLowerCase().includes('new enrollee installment')) {
                hasInstallmentPricing = true;
                installmentPricingPrice = price;
              }
              if (pricing.level_tag && pricing.level_tag.toLowerCase().includes('new enrollee fullpayment')) {
                hasFullpaymentPricing = true;
                // Update isFullpaymentEnrollment for non-package enrollments
                if (!package_id) {
                  isFullpaymentEnrollment = true;
                }
              }
            }
          });
        }
      }

      // After handling reservation packages, enforce capacity for actual enrollments
      // Reservation requests exit earlier, so capacity check would block legitimate enrollments if placed before.
      // For actual enrollments (not reservations), check capacity including reserved students
      // Reserved students count toward max_students but are not enrolled yet
      if (classData.max_students) {
        const enrolledCount = await client.query(
          "SELECT COUNT(DISTINCT student_id) as count FROM classstudentstbl WHERE class_id = $1 AND COALESCE(enrollment_status, 'Active') = 'Active'",
          [class_id]
        );
        const reservedCount = await client.query(
          `SELECT COUNT(DISTINCT student_id) as count FROM reservedstudentstbl 
           WHERE class_id = $1 AND status NOT IN ('Cancelled', 'Expired')`,
          [class_id]
        );
        const currentEnrolled = parseInt(enrolledCount.rows[0].count) || 0;
        const currentReserved = parseInt(reservedCount.rows[0].count) || 0;
        const totalOccupied = currentEnrolled + currentReserved;
        
        if (totalOccupied >= classData.max_students) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: `Class is full. Currently ${currentEnrolled} enrolled and ${currentReserved} reserved (${totalOccupied}/${classData.max_students} slots taken).`,
          });
        }
      }

      // Now determine if this is a fullpayment enrollment
      // (package with fullpayment OR selected fullpayment pricing)
      if (!isFullpaymentEnrollment) {
        isFullpaymentEnrollment = (package_id && hasFullpaymentPricing) || (!package_id && hasFullpaymentPricing);
      }

      // Now perform enrollment based on type
      // NOTE: Enrollment is NOT created here. Students will be enrolled only after payment is made.
      // - For installment: Enrolled in Phase 1 when first invoice is paid
      // - For full payment: Enrolled in all phases when invoice is fully paid
      // Enrollment will happen automatically in payments.js when payment is recorded
      let enrollmentResult = { rows: [] };
      let allEnrollmentRecords = [];
      
      console.log(`📝 Invoice created. Student will be enrolled after payment is made.`);

      // Validate inventory availability BEFORE processing enrollment
      // This is important for multiple student enrollments with per-student merchandise selections
      const inventoryValidationErrors = [];
      const merchandiseToDeduct = new Map(); // Track merchandise by ID and size: Map<merchandise_id, Map<size, count>>
      
      // Collect all merchandise that needs to be deducted
      // Handle per-student merchandise selections if provided, otherwise use group selections
      if (selected_merchandise && selected_merchandise.length > 0) {
        for (const selectedMerch of selected_merchandise) {
          const merchId = typeof selectedMerch === 'object' ? selectedMerch.merchandise_id : selectedMerch;
          const merchSize = typeof selectedMerch === 'object' ? (selectedMerch.size || null) : null;
          const merchName = typeof selectedMerch === 'object' ? (selectedMerch.merchandise_name || null) : null;
          const merchCategory = typeof selectedMerch === 'object' ? (selectedMerch.category || null) : null;
          
          let actualMerchId = merchId || null;
          if (merchId) {
            // For items with sizes, we need to find the actual merchandise_id by size
            if (merchSize && merchName) {
              // For uniforms with category (Top/Bottom), find by name, size, and category
              if (merchName === 'LCA Uniform' && merchCategory && (merchCategory === 'Top' || merchCategory === 'Bottom')) {
                // Find merchandise by name, size, and category (Top/Bottom)
                // Note: We check the type field to determine Top/Bottom
                // Since we're sending the correct merchandise_id from frontend, we can trust it
                const merchBySizeResult = await client.query(
                  `SELECT merchandise_id, merchandise_name, size, price, quantity, branch_id, gender, type
                   FROM merchandisestbl 
                   WHERE merchandise_name = $1 AND size = $2 AND branch_id = $3
                   ORDER BY merchandise_id ASC`,
                  [merchName, merchSize, branch_id]
                );
                // Filter by category - check type for Top/Bottom indication
                if (merchBySizeResult.rows.length > 0) {
                  // If we have category info, try to match it
                  // The category is determined by the type field in the database
                  // For now, we'll use the first match, but ideally we should have a category field
                  // Since we're sending the correct merchandise_id from frontend, we can trust it
                  const matchingItem = merchBySizeResult.rows.find(item => item.merchandise_id === merchId) || merchBySizeResult.rows[0];
                  actualMerchId = matchingItem.merchandise_id;
                }
              } else {
                // Find merchandise by name and size (for non-uniforms or uniforms without category)
                const merchBySizeResult = await client.query(
                  `SELECT merchandise_id, merchandise_name, size, price, quantity, branch_id
                   FROM merchandisestbl 
                   WHERE merchandise_name = $1 AND size = $2 AND branch_id = $3
                   ORDER BY merchandise_id ASC
                   LIMIT 1`,
                  [merchName, merchSize, branch_id]
                );
                if (merchBySizeResult.rows.length > 0) {
                  actualMerchId = merchBySizeResult.rows[0].merchandise_id;
                }
              }
            }
            
            // Track by merchandise_id, size, and category combination
            // This ensures Top and Bottom uniforms are tracked separately
            const key = `${actualMerchId}_${merchSize || 'no_size'}_${merchCategory || 'no_category'}`;
            const existing = merchandiseToDeduct.get(key);
            merchandiseToDeduct.set(key, {
              merchandise_id: actualMerchId,
              size: merchSize,
              merchandise_name: merchName,
              category: merchCategory,
              count: existing ? existing.count + 1 : 1
            });
          }
        }
      }
      
      // Validate inventory for all merchandise
      console.log(`[Inventory Validation] Validating ${merchandiseToDeduct.size} merchandise items for branch ${branch_id}`);
      
      for (const [key, merchInfo] of merchandiseToDeduct.entries()) {
        const merchId = merchInfo.merchandise_id;
        const merchSize = merchInfo.size;
        const merchCategory = merchInfo.category;
        const quantityNeeded = merchInfo.count;
        const merchName = merchInfo.merchandise_name;
        
        console.log(`[Inventory Validation] Checking merchandise: ID=${merchId}, Name=${merchName}, Size=${merchSize}, Category=${merchCategory}, Needed=${quantityNeeded}`);
        
        // Find by merchandise_id (which should be correct from frontend)
        // For uniforms with Top/Bottom, each has a different merchandise_id
        // Also validate that merchandise belongs to the correct branch
        const merchCheck = await client.query(
          `SELECT merchandise_id, merchandise_name, size, price, quantity, branch_id
           FROM merchandisestbl 
           WHERE merchandise_id = $1`,
          [merchId]
        );
        
        if (merchCheck.rows.length === 0) {
          console.log(`[Inventory Validation] Merchandise ID ${merchId} not found in database`);
          // Try to find by name and size if ID doesn't exist
          let fallbackFound = false;
          if (merchName && merchSize) {
            const fallbackCheck = await client.query(
              `SELECT merchandise_id, merchandise_name, size, price, quantity, branch_id
               FROM merchandisestbl 
               WHERE merchandise_name = $1 AND size = $2 AND branch_id = $3
               LIMIT 1`,
              [merchName, merchSize, branch_id]
            );
            if (fallbackCheck.rows.length > 0) {
              fallbackFound = true;
              inventoryValidationErrors.push(
                `Merchandise ID ${merchId} not found, but found matching item: ${merchName} (${merchSize}) with ID ${fallbackCheck.rows[0].merchandise_id}. Please use the correct merchandise ID.`
              );
            }
          }
          
          if (!fallbackFound) {
            inventoryValidationErrors.push(
              `Merchandise ID ${merchId}${merchName ? ` (${merchName})` : ''}${merchSize ? ` (Size: ${merchSize})` : ''}${merchCategory ? ` (${merchCategory})` : ''} not found in database`
            );
          }
          continue;
        }
        
        const merch = merchCheck.rows[0];
        console.log(`[Inventory Validation] Found merchandise: ID=${merch.merchandise_id}, Name=${merch.merchandise_name}, Size=${merch.size}, Branch=${merch.branch_id}, Quantity=${merch.quantity}`);
        
        // Verify merchandise belongs to the correct branch
        if (merch.branch_id && branch_id && merch.branch_id !== branch_id) {
          console.log(`[Inventory Validation] Branch mismatch: Expected ${branch_id}, Found ${merch.branch_id}`);
          inventoryValidationErrors.push(
            `Merchandise ID ${merchId} (${merch.merchandise_name || 'Merchandise'}${merch.size ? ` - ${merch.size}` : ''}) belongs to a different branch. Expected branch: ${branch_id}, Found: ${merch.branch_id}`
          );
          continue;
        }
        
        // Verify size matches if specified
        if (merchSize && merch.size !== merchSize) {
          console.log(`[Inventory Validation] Size mismatch: Expected ${merchSize}, Found ${merch.size}`);
          inventoryValidationErrors.push(
            `Merchandise ID ${merchId} size mismatch. Expected: ${merchSize}, Found: ${merch.size || 'N/A'}`
          );
          continue;
        }
        
        const availableQuantity = merch.quantity !== null && merch.quantity !== undefined ? parseInt(merch.quantity) : null;
        console.log(`[Inventory Validation] Available quantity: ${availableQuantity}, Needed: ${quantityNeeded}`);
        
        // If quantity tracking is enabled, validate availability
        if (availableQuantity !== null && availableQuantity < quantityNeeded) {
          const categoryText = merchCategory ? ` - ${merchCategory}` : '';
          console.log(`[Inventory Validation] Insufficient inventory: Available ${availableQuantity} < Needed ${quantityNeeded}`);
          inventoryValidationErrors.push(
            `Insufficient inventory for ${merch.merchandise_name || 'Merchandise'}${merch.size ? ` (${merch.size})` : ''}${categoryText}. ` +
            `Available: ${availableQuantity}, Needed: ${quantityNeeded}`
          );
        } else {
          console.log(`[Inventory Validation] ✓ Inventory check passed for merchandise ID ${merchId}`);
        }
      }
      
      console.log(`[Inventory Validation] Validation complete. Errors found: ${inventoryValidationErrors.length}`);
      
      // If inventory validation fails, rollback and return error
      if (inventoryValidationErrors.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Inventory validation failed',
          errors: inventoryValidationErrors,
        });
      }

      // Process selected merchandise (supports both package and custom selection)
      if (selected_merchandise && selected_merchandise.length > 0) {
        for (const selectedMerch of selected_merchandise) {
          const merchId = typeof selectedMerch === 'object' ? selectedMerch.merchandise_id : selectedMerch;
          const selectedSize = typeof selectedMerch === 'object' ? selectedMerch.size : null;
          const selectedName = typeof selectedMerch === 'object' ? selectedMerch.merchandise_name : null;

          let merch = null;
          
          // First try to find by ID
          if (merchId) {
            const merchByIdResult = await client.query(
              `SELECT merchandise_id, merchandise_name, size, price, quantity, branch_id
               FROM merchandisestbl 
               WHERE merchandise_id = $1`,
              [merchId]
            );
            merch = merchByIdResult.rows[0] || null;
            
            // If size is specified and the found item doesn't match the size, search by name and size
            if (merch && selectedSize && merch.size !== selectedSize) {
              const merchBySizeResult = await client.query(
                `SELECT merchandise_id, merchandise_name, size, price, quantity, branch_id
                 FROM merchandisestbl 
                 WHERE merchandise_name = $1 AND size = $2 AND branch_id = $3
                 ORDER BY merchandise_id ASC
                 LIMIT 1`,
                [selectedName || merch.merchandise_name, selectedSize, branch_id]
              );
              if (merchBySizeResult.rows.length > 0) {
                merch = merchBySizeResult.rows[0];
              }
            }
          }

          // If not found by ID, try by name and size
          if (!merch && selectedName && selectedSize) {
            const merchBySizeResult = await client.query(
              `SELECT merchandise_id, merchandise_name, size, price, quantity, branch_id
               FROM merchandisestbl 
               WHERE merchandise_name = $1 AND size = $2 AND branch_id = $3
               ORDER BY merchandise_id ASC
               LIMIT 1`,
              [selectedName, selectedSize, branch_id]
            );
            merch = merchBySizeResult.rows[0] || null;
          }

          // If still not found and no size specified, try by name only
          if (!merch && selectedName && !selectedSize) {
            const merchByNameResult = await client.query(
              `SELECT merchandise_id, merchandise_name, size, price, quantity, branch_id
               FROM merchandisestbl 
               WHERE merchandise_name = $1 AND branch_id = $2
               ORDER BY merchandise_id ASC
               LIMIT 1`,
              [selectedName, branch_id]
            );
            merch = merchByNameResult.rows[0] || null;
          }

          if (!merch) {
            continue;
          }
          
          // When enrolling with a package we never charge merchandise separately—the package price already covers it
          if (!package_id) {
            if (merch.price && !isNaN(parseFloat(merch.price))) {
              const price = parseFloat(merch.price);
              const selectedCategory = typeof selectedMerch === 'object' ? (selectedMerch.category || null) : null;
              const categoryText = selectedCategory ? ` - ${selectedCategory}` : '';
              invoiceItems.push({
                description: `Merchandise: ${merch.merchandise_name || 'Merchandise'}${categoryText}${merch.size ? ` (${merch.size})` : ''}`,
                amount: price,
              });
              totalAmount += price;
            }
          }
          
          // Deduct quantity (already validated above)
          // Each merchandise_id represents a unique item (Top and Bottom have different IDs)
          // So deducting by merchandise_id will correctly deduct from the right item
          if (merch.quantity !== null && merch.quantity !== undefined) {
            const newQuantity = Math.max(0, (merch.quantity || 0) - 1);
            await client.query(
              `UPDATE merchandisestbl 
               SET quantity = $1 
               WHERE merchandise_id = $2`,
              [newQuantity, merch.merchandise_id]
            );
          }
        }
      }
      

      // Ensure totalAmount is a valid number
      if (isNaN(totalAmount)) {
        totalAmount = 0;
      }

      // Create invoice
      const today = new Date();
      const issueDateStr = today.toISOString().split('T')[0];
      
      // Determine due_date based on installment settings
      // If installment settings are enabled and valid, use the installment due_date
      // If installment settings are NOT enabled (full payment), set due_date to NULL
      let dueDateStr = null;
      
      // Check if "New Enrollee Fullpayment" is selected - no due date for full payment
      if (hasFullpaymentPricing) {
        dueDateStr = null; // Full payment - no due date
      } else {
        // Check if installment settings are enabled and valid
        // Support both package enrollment and "without-package" with installment pricing list
        // For Installment packages: totalAmount may be 0 (since package_price is monthly amount, not total)
        // So we check package_type instead of totalAmount for Installment packages
        const isInstallmentEnabled = installment_settings && 
          (package_id || hasInstallmentPricing) && 
          (package_id && packageData && packageData.package_type === 'Installment' 
            ? true  // For Installment packages, always require installment settings
            : totalAmount > 0) &&  // For other packages, require totalAmount > 0
          installment_settings.invoice_issue_date &&
          installment_settings.billing_month &&
          installment_settings.invoice_due_date &&
          installment_settings.invoice_generation_date &&
          installment_settings.frequency_months;
        
        if (isInstallmentEnabled) {
          // Use the installment due_date for the invoice
          dueDateStr = installment_settings.invoice_due_date;
        } else {
          // Full payment - no due date
          dueDateStr = null;
        }
      }

      // Build invoice description based on enrollment type
      let invoiceDescription = null;
      if (packageName) {
        // Package enrollment - use package name
        invoiceDescription = packageName;
      } else if (per_phase_amount) {
        // Per-phase enrollment
        invoiceDescription = `Per-Phase - ${classData.program_name || 'Enrollment'}`;
      } else if (hasInstallmentPricing) {
        // Without-package with installment pricing
        invoiceDescription = `Installment - ${classData.program_name || 'Enrollment'}`;
      } else if (hasFullpaymentPricing) {
        // Without-package with fullpayment pricing
        invoiceDescription = `Fullpayment - ${classData.program_name || 'Enrollment'}`;
      } else if (selected_pricing_lists && selected_pricing_lists.length > 0) {
        // Without-package with other pricing lists
        invoiceDescription = `Enrollment - ${classData.program_name || 'Enrollment'}`;
      }

      // Create invoice with appropriate description and package_id
      // Ensure package_id column exists
      try {
        await client.query(`
          DO $$ 
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = 'invoicestbl' AND column_name = 'package_id'
            ) THEN
              ALTER TABLE invoicestbl ADD COLUMN package_id INTEGER;
            END IF;
          END $$;
        `);
      } catch (err) {
        console.log('package_id column check:', err.message);
      }

      // Check if package requires downpayment
      // Note: For Installment packages, package_price is the monthly installment amount, not total
      let downpaymentInvoice = null;
      let downpaymentAmount = 0;
      let skipMainInvoice = false; // Flag to skip main invoice creation for Installment packages with downpayment
      
      // For Installment packages, downpayment is REQUIRED
      // package_price is the monthly installment amount, not a total
      if (package_id && packageData && packageData.package_type === 'Installment') {
        if (!packageData.downpayment_amount) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: 'Downpayment amount is required for Installment packages',
          });
        }
        
        downpaymentAmount = parseFloat(packageData.downpayment_amount) || 0;
        
        if (downpaymentAmount > 0) {
          // Create downpayment invoice
          const downpaymentInvoiceResult = await client.query(
            `INSERT INTO invoicestbl (invoice_description, branch_id, amount, status, issue_date, due_date, created_by, package_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [
              `Downpayment - ${invoiceDescription || packageName || 'Enrollment'}`,
              branch_id,
              downpaymentAmount,
              'Unpaid',
              issueDateStr,
              dueDateStr || issueDateStr,
              req.user.userId || null,
              package_id || null,
            ]
          );
          downpaymentInvoice = downpaymentInvoiceResult.rows[0];
          
          // Link student to downpayment invoice
          await client.query(
            'INSERT INTO invoicestudentstbl (invoice_id, student_id) VALUES ($1, $2)',
            [downpaymentInvoice.invoice_id, student_id]
          );
          
          // Create invoice item for downpayment
          await client.query(
            `INSERT INTO invoiceitemstbl (invoice_id, description, amount)
             VALUES ($1, $2, $3)`,
            [
              downpaymentInvoice.invoice_id,
              `Downpayment for ${packageName || 'Enrollment'}`,
              downpaymentAmount,
            ]
          );
          
          // For Installment packages with downpayment, skip main invoice creation
          // since package_price is the monthly installment amount, not a total to invoice
          skipMainInvoice = true;
        }
      }

      let newInvoice = null;
      if (!skipMainInvoice) {
        // Create main invoice (for non-Installment packages or Installment without downpayment)
        const invoiceResult = await client.query(
          `INSERT INTO invoicestbl (invoice_description, branch_id, amount, status, issue_date, due_date, created_by, package_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [
            invoiceDescription, // Description based on enrollment type
            branch_id,
            totalAmount || 0,
            'Pending',
            issueDateStr,
            dueDateStr, // null for full payment, or installment due_date if installment is enabled
            req.user.userId || null,
            package_id || null, // Link invoice to package for promo tracking
          ]
        );
        newInvoice = invoiceResult.rows[0];
      }

      // Handle promo if provided (main invoice) OR on downpayment only (Installment packages)
      let promoDiscount = 0;
      let promoApplied = null;
      let downpaymentPromoDiscount = 0;
      let downpaymentPromoApplied = null;

      if (promo_id && !skipMainInvoice) {
        try {
          // Fetch promo details with packages from junction table
          const promoResult = await client.query(
            `SELECT p.*, pkg.package_price
             FROM promostbl p
             LEFT JOIN packagestbl pkg ON p.package_id = pkg.package_id
             WHERE p.promo_id = $1 AND p.status = 'Active'`,
            [promo_id]
          );

          if (promoResult.rows.length > 0) {
            const promo = promoResult.rows[0];
            
            // Validate promo code if promo requires one
            if (promo.promo_code) {
              if (!promo_code || promo_code.trim().toUpperCase() !== promo.promo_code.toUpperCase()) {
                console.warn(`Promo ${promo_id} requires promo code but invalid or missing code provided`);
                // Don't apply promo if code doesn't match
                throw new Error('Invalid or missing promo code');
              }
            }
            
            // Fetch packages from junction table
            const promoPackagesResult = await client.query(
              'SELECT package_id FROM promopackagestbl WHERE promo_id = $1',
              [promo_id]
            );
            const promoPackageIds = promoPackagesResult.rows.map(r => r.package_id);
            
            // If no packages in junction table, fall back to old package_id for backward compatibility
            if (promoPackageIds.length === 0 && promo.package_id) {
              promoPackageIds.push(promo.package_id);
            }
            
            promo.package_ids = promoPackageIds;
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const startDate = promo.start_date ? new Date(promo.start_date) : null;
            const endDate = promo.end_date ? new Date(promo.end_date) : null;
            
            // Validate promo is active and within date range
            const isDateValid = (!startDate || startDate <= today) && (!endDate || endDate >= today);
            const isUsageValid = !promo.max_uses || (promo.current_uses || 0) < promo.max_uses;
            
            // Check if student already used this promo
            const usageCheck = await client.query(
              'SELECT promousage_id FROM promousagetbl WHERE promo_id = $1 AND student_id = $2',
              [promo_id, student_id]
            );
            const hasAlreadyUsed = usageCheck.rows.length > 0;
            
            // Check student eligibility
            let isEligible = false;
            if (!hasAlreadyUsed) {
              // Check if student is new or existing
              const enrollmentCheck = await client.query(
                'SELECT COUNT(*) as count FROM classstudentstbl WHERE student_id = $1',
                [student_id]
              );
              const enrollmentCount = parseInt(enrollmentCheck.rows[0]?.count || 0);
              const isNewStudent = enrollmentCount === 0;
              const isExistingStudent = enrollmentCount > 0;
              
              // Check if student has referral
              const referralCheck = await client.query(
                'SELECT referral_id, status FROM referralstbl WHERE referred_student_id = $1',
                [student_id]
              );
              const hasReferral = referralCheck.rows.length > 0 && referralCheck.rows[0].status === 'Verified';
              
              // Check eligibility type
              switch (promo.eligibility_type) {
                case 'all':
                  isEligible = true;
                  break;
                case 'new_students_only':
                  isEligible = isNewStudent;
                  break;
                case 'existing_students_only':
                  isEligible = isExistingStudent;
                  break;
                case 'referral_only':
                  isEligible = hasReferral;
                  break;
                default:
                  isEligible = true;
              }
            }
            
            // Check minimum payment amount
            const packagePrice = parseFloat(promo.package_price || totalAmount);
            const meetsMinPayment = !promo.min_payment_amount || packagePrice >= parseFloat(promo.min_payment_amount);
            
            // Check if package_id is in promo's package_ids array
            const packageMatches = promo.package_ids && promo.package_ids.includes(package_id);
            
            if (isDateValid && isUsageValid && packageMatches && !hasAlreadyUsed && isEligible && meetsMinPayment) {
              // Calculate discount
              if (promo.promo_type === 'percentage_discount' && promo.discount_percentage) {
                promoDiscount = (parseFloat(promo.package_price || totalAmount) * parseFloat(promo.discount_percentage)) / 100;
              } else if (promo.promo_type === 'fixed_discount' && promo.discount_amount) {
                promoDiscount = parseFloat(promo.discount_amount);
              } else if (promo.promo_type === 'combined') {
                // For combined, prioritize percentage discount if both are provided
                // User should typically use either percentage OR fixed, not both
                if (promo.discount_percentage && parseFloat(promo.discount_percentage) > 0) {
                  promoDiscount = (parseFloat(promo.package_price || totalAmount) * parseFloat(promo.discount_percentage)) / 100;
                } else if (promo.discount_amount && parseFloat(promo.discount_amount) > 0) {
                  promoDiscount = parseFloat(promo.discount_amount);
                }
              }

              // Apply discount to total amount
              totalAmount = Math.max(0, totalAmount - promoDiscount);

              // Add discount as invoice item (negative amount)
              if (promoDiscount > 0) {
                let discountDescription = `Promo: ${promo.promo_name} (`;
                if (promo.promo_type === 'percentage_discount' && promo.discount_percentage) {
                  discountDescription += `${promo.discount_percentage}%`;
                } else if (promo.promo_type === 'fixed_discount' && promo.discount_amount) {
                  discountDescription += `PHP ${parseFloat(promo.discount_amount).toFixed(2)}`;
                } else if (promo.promo_type === 'combined') {
                  if (promo.discount_percentage && parseFloat(promo.discount_percentage) > 0) {
                    discountDescription += `${promo.discount_percentage}%`;
                  } else if (promo.discount_amount && parseFloat(promo.discount_amount) > 0) {
                    discountDescription += `PHP ${parseFloat(promo.discount_amount).toFixed(2)}`;
                  }
                }
                discountDescription += ')';
                
                invoiceItems.push({
                  description: discountDescription,
                  amount: -promoDiscount,
                });
              }

              // Add free merchandise from promo
              const promoMerchResult = await client.query(
                `SELECT pm.*, m.merchandise_name, m.price
                 FROM promomerchandisetbl pm
                 LEFT JOIN merchandisestbl m ON pm.merchandise_id = m.merchandise_id
                 WHERE pm.promo_id = $1`,
                [promo_id]
              );

              for (const promoMerch of promoMerchResult.rows) {
                for (let i = 0; i < (promoMerch.quantity || 1); i++) {
                  invoiceItems.push({
                    description: `Free: ${promoMerch.merchandise_name} (Promo: ${promo.promo_name})`,
                    amount: 0,
                  });
                }
              }

              promoApplied = promo;
            } else {
              // Log why promo was not applied (for debugging)
              const reasons = [];
              if (!isDateValid) reasons.push('promo is not within valid date range');
              if (!isUsageValid) reasons.push('promo has reached maximum uses');
              const packageMatches = promo.package_ids && promo.package_ids.includes(package_id);
              if (!packageMatches) reasons.push('promo does not match selected package');
              if (hasAlreadyUsed) reasons.push('student has already used this promo');
              if (!isEligible) {
                const eligibilityReason = promo.eligibility_type === 'new_students_only' 
                  ? 'student is not a new student'
                  : promo.eligibility_type === 'existing_students_only'
                  ? 'student is not an existing student'
                  : promo.eligibility_type === 'referral_only'
                  ? 'student does not have a verified referral'
                  : 'student does not meet eligibility requirements';
                reasons.push(eligibilityReason);
              }
              if (!meetsMinPayment) reasons.push(`package price (PHP ${packagePrice.toFixed(2)}) is less than minimum payment (PHP ${parseFloat(promo.min_payment_amount).toFixed(2)})`);
              
              console.warn(`Promo ${promo_id} could not be applied: ${reasons.join(', ')}`);
            }
          } else {
            console.warn(`Promo ${promo_id} not found or not active`);
          }
        } catch (promoError) {
          console.error('Error applying promo:', promoError);
          // Don't fail enrollment if promo fails, just log it
        }
      }

      // Apply promo to downpayment only when package is Installment (promo applies to downpayment only)
      if (promo_id && skipMainInvoice && downpaymentInvoice && packageData && packageData.package_type === 'Installment' && downpaymentAmount > 0) {
        try {
          const promoResult = await client.query(
            `SELECT p.*, pkg.package_price, pkg.downpayment_amount
             FROM promostbl p
             LEFT JOIN packagestbl pkg ON p.package_id = pkg.package_id
             WHERE p.promo_id = $1 AND p.status = 'Active'`,
            [promo_id]
          );
          
          // Get promo scope fields
          const promoScopeResult = await client.query(
            `SELECT installment_apply_scope, installment_months_to_apply 
             FROM promostbl WHERE promo_id = $1`,
            [promo_id]
          );
          const promoScope = promoScopeResult.rows[0] || {};
          const installmentApplyScope = promoScope.installment_apply_scope || 'downpayment'; // Default to downpayment for backward compatibility
          const installmentMonthsToApply = promoScope.installment_months_to_apply || null;

          if (promoResult.rows.length > 0) {
            const promo = promoResult.rows[0];

            if (promo.promo_code) {
              if (!promo_code || promo_code.trim().toUpperCase() !== promo.promo_code.toUpperCase()) {
                throw new Error('Invalid or missing promo code');
              }
            }

            const promoPackagesResult = await client.query(
              'SELECT package_id FROM promopackagestbl WHERE promo_id = $1',
              [promo_id]
            );
            let promoPackageIds = promoPackagesResult.rows.map(r => r.package_id);
            if (promoPackageIds.length === 0 && promo.package_id) {
              promoPackageIds.push(promo.package_id);
            }

            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const startDate = promo.start_date ? new Date(promo.start_date) : null;
            const endDate = promo.end_date ? new Date(promo.end_date) : null;
            const isDateValid = (!startDate || startDate <= today) && (!endDate || endDate >= today);
            const isUsageValid = !promo.max_uses || (promo.current_uses || 0) < promo.max_uses;

            const usageCheck = await client.query(
              'SELECT promousage_id FROM promousagetbl WHERE promo_id = $1 AND student_id = $2',
              [promo_id, student_id]
            );
            const hasAlreadyUsed = usageCheck.rows.length > 0;

            let isEligible = false;
            if (!hasAlreadyUsed) {
              const enrollmentCheck = await client.query(
                'SELECT COUNT(*) as count FROM classstudentstbl WHERE student_id = $1',
                [student_id]
              );
              const enrollmentCount = parseInt(enrollmentCheck.rows[0]?.count || 0);
              const isNewStudent = enrollmentCount === 0;
              const isExistingStudent = enrollmentCount > 0;
              const referralCheck = await client.query(
                'SELECT referral_id, status FROM referralstbl WHERE referred_student_id = $1',
                [student_id]
              );
              const hasReferral = referralCheck.rows.length > 0 && referralCheck.rows[0].status === 'Verified';

              switch (promo.eligibility_type) {
                case 'all':
                  isEligible = true;
                  break;
                case 'new_students_only':
                  isEligible = isNewStudent;
                  break;
                case 'existing_students_only':
                  isEligible = isExistingStudent;
                  break;
                case 'referral_only':
                  isEligible = hasReferral;
                  break;
                default:
                  isEligible = true;
              }
            }

            // Check if student already used this promo for this package (per package usage tracking)
            const packageUsageCheck = await client.query(
              'SELECT promousage_id FROM promousagetbl WHERE promo_id = $1 AND student_id = $2 AND package_id = $3',
              [promo_id, student_id, package_id]
            );
            const hasAlreadyUsedForPackage = packageUsageCheck.rows.length > 0;

            // For Installment: min_payment and discount base = downpayment amount (if scope includes downpayment)
            // If scope is monthly only, skip min_payment check for downpayment
            const meetsMinPayment = !promo.min_payment_amount || 
              (installmentApplyScope === 'downpayment' || installmentApplyScope === 'both' 
                ? downpaymentAmount >= parseFloat(promo.min_payment_amount)
                : true); // For monthly-only scope, min_payment will be checked against monthly amount later
            const packageMatches = promoPackageIds && promoPackageIds.includes(package_id);

            // Only apply downpayment discount if scope includes downpayment
            const shouldApplyDownpaymentDiscount = (installmentApplyScope === 'downpayment' || installmentApplyScope === 'both');

            if (isDateValid && isUsageValid && packageMatches && !hasAlreadyUsedForPackage && isEligible && meetsMinPayment && shouldApplyDownpaymentDiscount) {
              if (promo.promo_type === 'percentage_discount' && promo.discount_percentage) {
                downpaymentPromoDiscount = (downpaymentAmount * parseFloat(promo.discount_percentage)) / 100;
              } else if (promo.promo_type === 'fixed_discount' && promo.discount_amount) {
                const fixed = parseFloat(promo.discount_amount);
                downpaymentPromoDiscount = Math.min(fixed, downpaymentAmount);
              } else if (promo.promo_type === 'combined') {
                if (promo.discount_percentage && parseFloat(promo.discount_percentage) > 0) {
                  downpaymentPromoDiscount = (downpaymentAmount * parseFloat(promo.discount_percentage)) / 100;
                } else if (promo.discount_amount && parseFloat(promo.discount_amount) > 0) {
                  const fixed = parseFloat(promo.discount_amount);
                  downpaymentPromoDiscount = Math.min(fixed, downpaymentAmount);
                }
              }

              const discountedDownpayment = Math.max(0, downpaymentAmount - downpaymentPromoDiscount);

              await client.query(
                `UPDATE invoicestbl SET amount = $1, promo_id = $2 WHERE invoice_id = $3`,
                [discountedDownpayment, promo_id, downpaymentInvoice.invoice_id]
              );

              if (downpaymentPromoDiscount > 0) {
                let discountDescription = `Promo: ${promo.promo_name} (`;
                if (promo.promo_type === 'percentage_discount' && promo.discount_percentage) {
                  discountDescription += `${promo.discount_percentage}%`;
                } else if (promo.promo_type === 'fixed_discount' && promo.discount_amount) {
                  discountDescription += `PHP ${parseFloat(promo.discount_amount).toFixed(2)}`;
                } else if (promo.promo_type === 'combined') {
                  if (promo.discount_percentage && parseFloat(promo.discount_percentage) > 0) {
                    discountDescription += `${promo.discount_percentage}%`;
                  } else if (promo.discount_amount && parseFloat(promo.discount_amount) > 0) {
                    discountDescription += `PHP ${parseFloat(promo.discount_amount).toFixed(2)}`;
                  }
                }
                discountDescription += ' — applied to down payment)';

                await client.query(
                  `INSERT INTO invoiceitemstbl (invoice_id, description, amount, discount_amount)
                   VALUES ($1, $2, $3, $4)`,
                  [downpaymentInvoice.invoice_id, discountDescription, 0, downpaymentPromoDiscount]
                );
              }

              const promoMerchResult = await client.query(
                `SELECT pm.*, m.merchandise_name, m.price
                 FROM promomerchandisetbl pm
                 LEFT JOIN merchandisestbl m ON pm.merchandise_id = m.merchandise_id
                 WHERE pm.promo_id = $1`,
                [promo_id]
              );
              for (const promoMerch of promoMerchResult.rows) {
                for (let i = 0; i < (promoMerch.quantity || 1); i++) {
                  await client.query(
                    `INSERT INTO invoiceitemstbl (invoice_id, description, amount)
                     VALUES ($1, $2, $3)`,
                    [downpaymentInvoice.invoice_id, `Free: ${promoMerch.merchandise_name} (Promo: ${promo.promo_name})`, 0]
                  );
                }
              }

              downpaymentPromoApplied = promo;

              // Record promo usage with package_id and scope tracking
              await client.query(
                `INSERT INTO promousagetbl (promo_id, student_id, invoice_id, discount_applied, package_id, apply_scope, months_to_apply)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [promo_id, student_id, downpaymentInvoice.invoice_id, downpaymentPromoDiscount, package_id, installmentApplyScope, installmentMonthsToApply]
              );
              await client.query(
                `UPDATE promostbl
                 SET current_uses = COALESCE(current_uses, 0) + 1,
                     status = CASE
                       WHEN max_uses IS NOT NULL AND (COALESCE(current_uses, 0) + 1) >= max_uses THEN 'Inactive'
                       ELSE status
                     END,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE promo_id = $1`,
                [promo_id]
              );

              const promoExpiredCheck = await client.query(
                `SELECT end_date FROM promostbl WHERE promo_id = $1`,
                [promo_id]
              );
              if (promoExpiredCheck.rows.length > 0) {
                const endDate = promoExpiredCheck.rows[0].end_date;
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                if (endDate && new Date(endDate) < today) {
                  await client.query(
                    `UPDATE promostbl SET status = 'Inactive', updated_at = CURRENT_TIMESTAMP WHERE promo_id = $1`,
                    [promo_id]
                  );
                }
              }
            }
          }
        } catch (downpaymentPromoError) {
          console.error('Error applying promo to downpayment:', downpaymentPromoError);
        }
      }

      // Handle main invoice operations (promo, items, remarks) - only if main invoice was created
      if (!skipMainInvoice && newInvoice) {
        // Update invoice amount if promo was applied
        if (promoApplied && promoDiscount > 0) {
          await client.query(
            `UPDATE invoicestbl SET amount = $1, promo_id = $2 WHERE invoice_id = $3`,
            [totalAmount, promo_id, newInvoice.invoice_id]
          );
        } else if (promo_id) {
          // Link promo to invoice even if discount is 0 (for free merchandise only promos)
          await client.query(
            `UPDATE invoicestbl SET promo_id = $1 WHERE invoice_id = $2`,
            [promo_id, newInvoice.invoice_id]
          );
        }

        // Create invoice items (only if there are items)
        if (invoiceItems.length > 0) {
          for (const item of invoiceItems) {
            // Handle discount items (negative amounts) by storing in discount_amount field
            if (item.amount < 0) {
              await client.query(
                `INSERT INTO invoiceitemstbl (invoice_id, description, amount, discount_amount)
                 VALUES ($1, $2, $3, $4)`,
                [newInvoice.invoice_id, item.description || 'Discount', 0, Math.abs(item.amount)]
              );
            } else {
              await client.query(
                `INSERT INTO invoiceitemstbl (invoice_id, description, amount)
                 VALUES ($1, $2, $3)`,
                [newInvoice.invoice_id, item.description || 'Item', item.amount || 0]
              );
            }
          }
        } else {
          // If no items, create a default item for the enrollment
          await client.query(
            `INSERT INTO invoiceitemstbl (invoice_id, description, amount)
             VALUES ($1, $2, $3)`,
            [newInvoice.invoice_id, `Enrollment in ${classData.program_name}`, totalAmount || 0]
          );
        }

        // Record promo usage if promo was applied (for fullpayment packages)
        if (promoApplied) {
          try {
            // Insert usage record with package_id
            await client.query(
              `INSERT INTO promousagetbl (promo_id, student_id, invoice_id, discount_applied, package_id)
               VALUES ($1, $2, $3, $4, $5)`,
              [promo_id, student_id, newInvoice.invoice_id, promoDiscount, package_id || null]
            );

            // Increment current_uses and check if max uses reached
            const updateResult = await client.query(
              `UPDATE promostbl 
               SET current_uses = COALESCE(current_uses, 0) + 1,
                   status = CASE 
                     WHEN max_uses IS NOT NULL AND (COALESCE(current_uses, 0) + 1) >= max_uses THEN 'Inactive'
                     ELSE status
                   END,
                   updated_at = CURRENT_TIMESTAMP
               WHERE promo_id = $1
               RETURNING current_uses, max_uses, status`,
              [promo_id]
            );
            
            // Also check if promo is expired and update status
            const promoCheck = await client.query(
              `SELECT end_date FROM promostbl WHERE promo_id = $1`,
              [promo_id]
            );
            if (promoCheck.rows.length > 0) {
              const endDate = promoCheck.rows[0].end_date;
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              if (endDate && new Date(endDate) < today) {
                await client.query(
                  `UPDATE promostbl SET status = 'Inactive', updated_at = CURRENT_TIMESTAMP WHERE promo_id = $1`,
                  [promo_id]
                );
              }
            }
          } catch (usageError) {
            console.error('Error recording promo usage:', usageError);
            // Don't fail enrollment if usage recording fails
          }
        }
        
        // Store class_id (and optional phase range) in invoice remarks field for enrollment tracking
        // For Phase packages, we include PHASE_START and PHASE_END so payments.js can enroll only those phases
        let invoiceRemarks = `CLASS_ID:${class_id}`;
        if (phaseStartForRemarks !== null && phaseEndForRemarks !== null) {
          invoiceRemarks += `;PHASE_START:${phaseStartForRemarks};PHASE_END:${phaseEndForRemarks}`;
        }
        await client.query(
          `UPDATE invoicestbl SET remarks = $1 WHERE invoice_id = $2`,
          [invoiceRemarks, newInvoice.invoice_id]
        );

        // Link student to invoice
        await client.query(
          'INSERT INTO invoicestudentstbl (invoice_id, student_id) VALUES ($1, $2)',
          [newInvoice.invoice_id, student_id]
        );
      } else if (skipMainInvoice && downpaymentInvoice) {
        // For Installment packages with downpayment, store class_id in downpayment invoice remarks
        let invoiceRemarks = `CLASS_ID:${class_id}`;
        if (phaseStartForRemarks !== null && phaseEndForRemarks !== null) {
          invoiceRemarks += `;PHASE_START:${phaseStartForRemarks};PHASE_END:${phaseEndForRemarks}`;
        }
        await client.query(
          `UPDATE invoicestbl SET remarks = $1 WHERE invoice_id = $2`,
          [invoiceRemarks, downpaymentInvoice.invoice_id]
        );
      }

      // Create installment invoice profile if installment settings are provided
      let installmentProfile = null;
      // Installment invoice profile amount logic:
      // 1. For Installment package enrollment: Use package_price directly (package_price is the monthly installment amount)
      // 2. For without-package enrollment: Use the selected installment pricing list price
      // 3. Fallback: Use invoice total amount
      // NOTE: For Installment packages, package_price represents the monthly/per-period installment amount
      
      // Get total phases from curriculum
      const totalPhases = classData.number_of_phase || null;
      
      let installmentProfileAmount;
      if (package_id && packageData && packageData.package_type === 'Installment' && packageData.package_price) {
        // For Installment packages, package_price IS the installment amount (monthly/per-period)
        installmentProfileAmount = parseFloat(packageData.package_price);
      } else {
        // Use existing logic for without-package enrollments
        installmentProfileAmount = (package_id && installmentPricingList && installmentPricingList.pricing_price && !isNaN(parseFloat(installmentPricingList.pricing_price)))
          ? parseFloat(installmentPricingList.pricing_price)
          : (hasInstallmentPricing && installmentPricingPrice && !isNaN(parseFloat(installmentPricingPrice)))
          ? parseFloat(installmentPricingPrice)
          : totalAmount;
      }
      
      if (installment_settings && 
          (package_id || hasInstallmentPricing) && 
          installmentProfileAmount > 0 &&
          installment_settings.invoice_issue_date &&
          installment_settings.billing_month &&
          installment_settings.invoice_due_date &&
          installment_settings.invoice_generation_date &&
          installment_settings.frequency_months) {
        try {
          // Parse billing month (format: YYYY-MM)
          if (!installment_settings.billing_month.includes('-')) {
            throw new Error('Invalid billing month format. Expected YYYY-MM');
          }
          
          const billingMonthParts = installment_settings.billing_month.split('-');
          if (billingMonthParts.length !== 2) {
            throw new Error('Invalid billing month format. Expected YYYY-MM');
          }
          
          const firstBillingMonth = new Date(parseInt(billingMonthParts[0]), parseInt(billingMonthParts[1]) - 1, 1);
          
          // Validate dates
          if (isNaN(firstBillingMonth.getTime())) {
            throw new Error('Invalid billing month date');
          }
          
          // Calculate day of month from invoice_due_date
          const dueDate = new Date(installment_settings.invoice_due_date);
          if (isNaN(dueDate.getTime())) {
            throw new Error('Invalid invoice due date');
          }
          const dayOfMonth = dueDate.getDate();

          // Calculate next invoice due date (first billing month + frequency)
          const nextInvoiceDueDate = new Date(firstBillingMonth);
          nextInvoiceDueDate.setMonth(nextInvoiceDueDate.getMonth() + (installment_settings.frequency_months || 1));

          // Validate generation date
          const generationDate = new Date(installment_settings.invoice_generation_date);
          if (isNaN(generationDate.getTime())) {
            throw new Error('Invalid invoice generation date');
          }

          // Determine if downpayment is required
          const hasDownpayment = downpaymentInvoice !== null && downpaymentAmount > 0;
          const downpaymentPaid = false; // Initially false, will be set to true when downpayment is paid

          // Ensure downpayment columns exist
          try {
            await client.query(`
              DO $$ 
              BEGIN
                IF NOT EXISTS (
                  SELECT 1 FROM information_schema.columns 
                  WHERE table_name = 'installmentinvoiceprofilestbl' AND column_name = 'downpayment_paid'
                ) THEN
                  ALTER TABLE installmentinvoiceprofilestbl ADD COLUMN downpayment_paid BOOLEAN DEFAULT false;
                END IF;
                IF NOT EXISTS (
                  SELECT 1 FROM information_schema.columns 
                  WHERE table_name = 'installmentinvoiceprofilestbl' AND column_name = 'downpayment_invoice_id'
                ) THEN
                  ALTER TABLE installmentinvoiceprofilestbl ADD COLUMN downpayment_invoice_id INTEGER;
                END IF;
              END $$;
            `);
          } catch (err) {
            console.log('Downpayment column check:', err.message);
          }

          // Get promo scope info if promo was applied (for installment packages)
          let promoIdForProfile = null;
          let promoApplyScopeForProfile = null;
          let promoMonthsToApplyForProfile = null;
          
          if (promo_id && packageData && packageData.package_type === 'Installment') {
            const promoScopeCheck = await client.query(
              `SELECT installment_apply_scope, installment_months_to_apply 
               FROM promostbl WHERE promo_id = $1`,
              [promo_id]
            );
            if (promoScopeCheck.rows.length > 0) {
              const promoScope = promoScopeCheck.rows[0];
              promoIdForProfile = promo_id;
              promoApplyScopeForProfile = promoScope.installment_apply_scope || null;
              promoMonthsToApplyForProfile = promoScope.installment_months_to_apply || null;
            }
          }

          const profileResult = await client.query(
            `INSERT INTO installmentinvoiceprofilestbl 
             (student_id, branch_id, package_id, amount, frequency, description, 
              day_of_month, is_active, bill_invoice_due_date, next_invoice_due_date, 
              first_billing_month, first_generation_date, created_by, class_id, total_phases, generated_count,
              downpayment_paid, downpayment_invoice_id, promo_id, promo_apply_scope, promo_months_to_apply, promo_months_applied)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
             RETURNING *`,
            [
              student_id,
              branch_id,
              package_id || null, // Can be null for "without-package" option
              installmentProfileAmount, // Calculated amount (may include downpayment adjustment)
              `${installment_settings.frequency_months} month(s)`,
              `Installment plan for ${studentCheck.rows[0].full_name} - ${classData.program_name}`,
              dayOfMonth,
              true,
              installment_settings.invoice_due_date,
              nextInvoiceDueDate.toISOString().split('T')[0],
              firstBillingMonth.toISOString().split('T')[0],
              installment_settings.invoice_generation_date,
              req.user.fullName || req.user.email || null,
              class_id, // Store class_id for phase tracking
              totalPhases, // Store total phases from curriculum
              0, // Start with 0 generated invoices
              downpaymentPaid, // Initially false, will be set to true when downpayment is paid
              downpaymentInvoice ? downpaymentInvoice.invoice_id : null, // Link to downpayment invoice
              promoIdForProfile, // Store promo_id for monthly discount application
              promoApplyScopeForProfile, // Store promo scope
              promoMonthsToApplyForProfile, // Store months to apply
              0, // Start with 0 months applied
            ]
          );
          installmentProfile = profileResult.rows[0];

          // Link the downpayment invoice to the installment profile (if exists)
          if (downpaymentInvoice) {
            await client.query(
              `UPDATE invoicestbl 
               SET installmentinvoiceprofiles_id = $1 
               WHERE invoice_id = $2`,
              [installmentProfile.installmentinvoiceprofiles_id, downpaymentInvoice.invoice_id]
            );
          }

          // Link the main invoice to the installment profile (only if main invoice exists)
          // For Installment packages with downpayment, there is no main invoice
          if (!skipMainInvoice && newInvoice) {
            await client.query(
              `UPDATE invoicestbl 
               SET installmentinvoiceprofiles_id = $1 
               WHERE invoice_id = $2`,
              [installmentProfile.installmentinvoiceprofiles_id, newInvoice.invoice_id]
            );
          }

          // Only create the first installment invoice record if downpayment is NOT required
          // If downpayment is required, wait for downpayment payment before creating first installment record
          if (!hasDownpayment) {
            // Create the first installment invoice record (legacy behavior - no downpayment)
            const studentName = studentCheck.rows[0].full_name;
            const frequency = `${installment_settings.frequency_months} month(s)`;
            const scheduledDate = installment_settings.invoice_due_date || installment_settings.invoice_generation_date;
            
            // Calculate next invoice month (first billing month + frequency)
            const nextInvoiceMonth = new Date(nextInvoiceDueDate);
            
            // Calculate next generation date: should be the same as the first generation date
            // This follows the settings from Classes.jsx where invoice generation date is configured
            // Example: If first generation is Dec 1, 2025, next generation should also be Dec 1, 2025
            const nextGenerationDate = new Date(generationDate);
            // Keep the same date (first generation date) - don't add frequency
            
            await client.query(
              `INSERT INTO installmentinvoicestbl 
               (installmentinvoiceprofiles_id, scheduled_date, status, student_name, 
                total_amount_including_tax, total_amount_excluding_tax, frequency, 
                next_generation_date, next_invoice_month)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [
                installmentProfile.installmentinvoiceprofiles_id,
                scheduledDate,
                'Pending',
                studentName,
                installmentProfileAmount, // Use calculated amount for installment invoice display
                installmentProfileAmount, // Assuming no tax for now, or can be calculated separately
                frequency,
                nextGenerationDate.toISOString().split('T')[0], // First day of next billing month
                nextInvoiceMonth.toISOString().split('T')[0],
              ]
            );
          }
          // If hasDownpayment is true, the first installment invoice record will be created
          // automatically when the downpayment is paid (handled in payments.js)
        } catch (profileError) {
          console.error('Error creating installment profile:', profileError);
          // Don't fail the enrollment if profile creation fails, just log it
          // The invoice is already created, so we continue
        }
      }

      await client.query('COMMIT');

      // Determine which invoice to return (downpayment invoice for Installment packages, main invoice otherwise)
      const invoiceToReturn = skipMainInvoice && downpaymentInvoice ? downpaymentInvoice : newInvoice;
      
      if (!invoiceToReturn) {
        await client.query('ROLLBACK');
        return res.status(500).json({
          success: false,
          message: 'Failed to create invoice',
        });
      }

      // Fetch complete invoice with details
      const itemsResult = await query(
        'SELECT * FROM invoiceitemstbl WHERE invoice_id = $1',
        [invoiceToReturn.invoice_id]
      );

      const studentsResult = await query(
        'SELECT inv_student.*, u.full_name, u.email FROM invoicestudentstbl inv_student JOIN userstbl u ON inv_student.student_id = u.user_id WHERE inv_student.invoice_id = $1',
        [invoiceToReturn.invoice_id]
      );

      // Determine appropriate message
      let message = 'Invoice generated. Student will be enrolled after payment is made.';
      if (skipMainInvoice && downpaymentInvoice) {
        message = 'Downpayment invoice generated. Monthly installment invoices will start after downpayment is paid.';
      } else if (isFullpaymentEnrollment) {
        message = 'Invoice generated. Student will be enrolled in all phases after payment is made.';
      } else if (installmentProfile) {
        message = 'Invoice generated. Student will be enrolled in Phase 1 after first payment is made.';
      }

      res.status(201).json({
        success: true,
        message: message,
        data: {
          enrollment: null, // Enrollment happens after payment
          enrollments: [], // Enrollment happens after payment
          invoice: {
            ...invoiceToReturn,
            items: itemsResult.rows,
            students: studentsResult.rows,
          },
          ...(installmentProfile ? { installment_profile: installmentProfile } : {}),
        },
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error in enrollment endpoint:', error);
      console.error('Error details:', {
        message: error.message,
        code: error.code,
        detail: error.detail,
        constraint: error.constraint,
        stack: error.stack
      });
      next(error);
    } finally {
      client.release();
    }
  }
);

/**
 * POST /api/sms/classes/:id/merge
 * Merge multiple classes into one
 * Rules:
 * - All classes must have the same phase_number
 * - All classes must have the same level_tag
 * - User provides manual schedule configuration (days_of_week)
 * - All students from all classes are moved to the new merged class
 * - Original classes are deleted
 * Access: Superadmin, Admin
 */
router.post(
  '/:id/merge',
  [
    param('id').isInt().withMessage('Class ID must be an integer'),
    body('merge_with_class_id').optional().isInt().withMessage('Merge with class ID must be an integer'),
    body('merge_with_class_ids').optional().isArray().withMessage('Merge with class IDs must be an array'),
    body('merge_with_class_ids.*').optional().isInt().withMessage('Each merge with class ID must be an integer'),
    body('days_of_week').optional().isArray().withMessage('Days of week must be an array'),
    body('days_of_week.*.day_of_week').optional().isString().withMessage('Day of week must be a string'),
    body('days_of_week.*.start_time').optional().isString().withMessage('Start time must be a string'),
    body('days_of_week.*.end_time').optional().isString().withMessage('End time must be a string'),
    body('keep_schedule_from').optional().isIn(['source', 'target']).withMessage('keep_schedule_from must be "source" or "target"'),
    body('class_name').optional().isString().withMessage('Class name must be a string'),
    body('teacher_id').optional().isInt().withMessage('Teacher ID must be an integer'),
    body('room_id').optional().isInt().withMessage('Room ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { id: sourceClassId } = req.params;
      const { merge_with_class_id, merge_with_class_ids, days_of_week, keep_schedule_from, class_name, teacher_id, teacher_ids, room_id } = req.body;
      
      // Support both single class ID (backward compatibility) and array of class IDs
      let targetClassIds = [];
      if (merge_with_class_ids && Array.isArray(merge_with_class_ids) && merge_with_class_ids.length > 0) {
        targetClassIds = merge_with_class_ids.map(id => parseInt(id)).filter(id => !isNaN(id));
      } else if (merge_with_class_id) {
        targetClassIds = [parseInt(merge_with_class_id)];
      }
      
      if (targetClassIds.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'At least one class ID to merge with is required (merge_with_class_id or merge_with_class_ids)',
        });
      }
      
      // Support both teacher_id (single) and teacher_ids (array) for backward compatibility
      const teacherIdsArray = teacher_ids && Array.isArray(teacher_ids) && teacher_ids.length > 0 
        ? teacher_ids.filter(id => id !== null && id !== undefined && !isNaN(parseInt(id))).map(id => parseInt(id))
        : (teacher_id ? [parseInt(teacher_id)] : []);
      
      // Use first teacher_id for the main classestbl.teacher_id field (backward compatibility)
      const primaryTeacherId = teacherIdsArray.length > 0 ? teacherIdsArray[0] : null;

      // Validate both classes exist and get their details
      const sourceClassResult = await client.query(
        `SELECT c.*, 
                p.program_name, p.curriculum_id,
                cu.number_of_phase, cu.number_of_session_per_phase
         FROM classestbl c
         LEFT JOIN programstbl p ON c.program_id = p.program_id
         LEFT JOIN curriculumstbl cu ON p.curriculum_id = cu.curriculum_id
         WHERE c.class_id = $1 AND c.status = 'Active'`,
        [sourceClassId]
      );

      if (sourceClassResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Source class not found or is not active',
        });
      }

      const sourceClass = sourceClassResult.rows[0];

      // Validate and fetch all target classes
      const targetClassesResult = await client.query(
        `SELECT c.*, 
                p.program_name, p.curriculum_id,
                cu.number_of_phase, cu.number_of_session_per_phase
         FROM classestbl c
         LEFT JOIN programstbl p ON c.program_id = p.program_id
         LEFT JOIN curriculumstbl cu ON p.curriculum_id = cu.curriculum_id
         WHERE c.class_id = ANY($1::int[]) AND c.status = 'Active'`,
        [targetClassIds]
      );

      if (targetClassesResult.rows.length !== targetClassIds.length) {
        await client.query('ROLLBACK');
        const foundIds = targetClassesResult.rows.map(r => r.class_id);
        const missingIds = targetClassIds.filter(id => !foundIds.includes(id));
        return res.status(404).json({
          success: false,
          message: `One or more target classes not found or are not active. Missing class IDs: ${missingIds.join(', ')}`,
        });
      }

      const targetClasses = targetClassesResult.rows;
      const allClasses = [sourceClass, ...targetClasses];

      // Validate merge rules: all classes must have same phase_number and level_tag
      const sourcePhase = sourceClass.phase_number;
      const sourceLevelTag = sourceClass.level_tag;
      const sourceBranchId = sourceClass.branch_id;
      const sourceProgramId = sourceClass.program_id;

      for (const targetClass of targetClasses) {
        // Validate phase_number
      const targetPhase = targetClass.phase_number;
      const phasesMatch = (sourcePhase === null && targetPhase === null) || 
                         (sourcePhase !== null && targetPhase !== null && sourcePhase === targetPhase);
      
      if (!phasesMatch) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
            message: `Cannot merge classes with different phase numbers. Source: Phase ${sourcePhase || 'N/A'}, Class ${targetClass.class_id}: Phase ${targetPhase || 'N/A'}`,
        });
      }

        // Validate level_tag
        if (sourceLevelTag !== targetClass.level_tag) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
            message: `Cannot merge classes with different level tags. Source: ${sourceLevelTag || 'N/A'}, Class ${targetClass.class_id}: ${targetClass.level_tag || 'N/A'}`,
        });
      }

        // Validate same branch
        if (sourceBranchId !== targetClass.branch_id) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
            message: `Cannot merge classes from different branches. Class ${targetClass.class_id} is from a different branch.`,
        });
      }

        // Validate same program
        if (sourceProgramId !== targetClass.program_id) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
            message: `Cannot merge classes with different programs. Class ${targetClass.class_id} has a different program.`,
        });
        }
      }

      // Get all enrolled students from all classes
      // IMPORTANT: Students can have MULTIPLE enrollment records (one per phase)
      // We need to preserve ALL phase enrollments, only consolidating duplicates with same (student_id, phase_number)
      const allClassIds = [sourceClassId, ...targetClassIds];
      const allStudentsResult = await client.query(
        `SELECT cs.*, u.full_name as student_name
         FROM classstudentstbl cs
         LEFT JOIN userstbl u ON cs.student_id = u.user_id
         WHERE cs.class_id = ANY($1::int[])
         ORDER BY cs.student_id, cs.phase_number NULLS LAST, cs.enrolled_at ASC`,
        [allClassIds]
      );
      const allStudents = allStudentsResult.rows;

      // Consolidate ONLY if a student has the SAME phase_number in multiple classes being merged
      // Key: (student_id, phase_number) -> { enrollment record, other enrollment IDs to delete }
      const enrollmentMap = new Map(); // (student_id, phase_number) -> { enrollment, toDelete }
      const enrollmentIdsToDelete = [];
      
      for (const enrollment of allStudents) {
        // Create unique key: student_id + phase_number (null phase_number is treated as distinct)
        const phaseKey = enrollment.phase_number !== null && enrollment.phase_number !== undefined 
          ? enrollment.phase_number 
          : 'null';
        const mapKey = `${enrollment.student_id}_${phaseKey}`;
        
        if (!enrollmentMap.has(mapKey)) {
          // First enrollment for this (student, phase) combination - keep it
          enrollmentMap.set(mapKey, {
            enrollment: enrollment,
            toDelete: []
          });
        } else {
          // Student already has enrollment for this phase in another class being merged
          // Keep the EARLIEST enrollment (preserve original enrollment date) and mark others for deletion
          const existing = enrollmentMap.get(mapKey);
          const existingDate = new Date(existing.enrollment.enrolled_at || 0);
          const currentDate = new Date(enrollment.enrolled_at || 0);
          
          if (currentDate < existingDate) {
            // Current enrollment is earlier - replace existing
            existing.toDelete.push(existing.enrollment.classstudent_id);
            existing.enrollment = enrollment;
          } else {
            // Existing enrollment is earlier - keep it, mark current for deletion
            existing.toDelete.push(enrollment.classstudent_id);
          }
        }
      }

      // Collect all enrollment IDs to delete
      for (const [mapKey, data] of enrollmentMap.entries()) {
        if (data.toDelete.length > 0) {
          enrollmentIdsToDelete.push(...data.toDelete);
        }
      }

      // Log consolidation info if there are duplicates
      if (enrollmentIdsToDelete.length > 0) {
        const duplicateEnrollments = allStudents.filter(s => enrollmentIdsToDelete.includes(s.classstudent_id));
        const uniqueStudents = [...new Set(duplicateEnrollments.map(e => e.student_id))];
        const studentNamesResult = await client.query(
          `SELECT user_id, full_name FROM userstbl WHERE user_id = ANY($1::int[])`,
          [uniqueStudents]
        );
        const duplicateNames = studentNamesResult.rows.map(r => r.full_name).join(', ');
        console.log(`ℹ️ Will consolidate ${enrollmentIdsToDelete.length} duplicate phase enrollment(s) for ${uniqueStudents.length} student(s): ${duplicateNames}`);
      }

      // Get all enrollments to move (preserving all phases per student)
      const enrollmentsToMove = Array.from(enrollmentMap.values()).map(data => data.enrollment);
      
      console.log(`📋 Moving ${enrollmentsToMove.length} enrollment record(s) to merged class (preserving all phases)`);

      // Determine schedule: use manual schedule if provided, otherwise fallback to keep_schedule_from logic
      let schedules = [];
      let scheduleRoomId = sourceClass.room_id || null; // Default to source room, or null if not set
      
      if (days_of_week && Array.isArray(days_of_week) && days_of_week.length > 0) {
        // Use manually configured schedule
        schedules = days_of_week
          .filter(day => day.day_of_week && day.start_time && day.end_time)
          .map(day => ({
            day_of_week: day.day_of_week,
            start_time: day.start_time,
            end_time: day.end_time,
          }));
        // Use room_id from request if provided, otherwise use source class room
        if (room_id) {
          // Validate room exists and is in the same branch
          const roomCheck = await client.query(
            'SELECT room_id, branch_id FROM roomstbl WHERE room_id = $1',
            [room_id]
          );
          if (roomCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              message: 'Room not found',
            });
          }
          if (roomCheck.rows[0].branch_id !== sourceClass.branch_id) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              message: 'Room must be from the same branch as the classes being merged',
            });
          }
          scheduleRoomId = room_id;
        } else {
          scheduleRoomId = sourceClass.room_id || null;
        }
      } else if (keep_schedule_from) {
        // Fallback to old logic for backward compatibility
        const scheduleClass = keep_schedule_from === 'source' ? sourceClass : targetClasses[0];
        const scheduleClassId = keep_schedule_from === 'source' ? sourceClassId : targetClassIds[0];
        scheduleRoomId = scheduleClass.room_id || null;
        
      const scheduleResult = await client.query(
        'SELECT * FROM roomschedtbl WHERE class_id = $1 ORDER BY day_of_week',
        [scheduleClassId]
      );
        schedules = scheduleResult.rows;
      } else {
        // Default to source class schedule
        const scheduleResult = await client.query(
          'SELECT * FROM roomschedtbl WHERE class_id = $1 ORDER BY day_of_week',
          [sourceClassId]
        );
        schedules = scheduleResult.rows;
        scheduleRoomId = sourceClass.room_id || null;
      }
      
      // Ensure scheduleRoomId is null (not undefined) for database insertion
      scheduleRoomId = scheduleRoomId || null;

      // Validate schedule conflicts BEFORE creating merged class
      // Exclude all classes being merged (source + targets) since their schedules will be removed
      if (scheduleRoomId && schedules.length > 0) {
        const allClassIdsToExclude = [sourceClassId, ...targetClassIds];
        const scheduleConflicts = [];
        
        for (const schedule of schedules) {
          if (schedule.day_of_week && schedule.start_time && schedule.end_time) {
            const conflict = await checkScheduleConflict(
              scheduleRoomId,
              schedule.day_of_week,
              schedule.start_time,
              schedule.end_time,
              null // We'll manually exclude classes in the query
            );
            
            // Check if the conflict is with one of the classes being merged
            // If so, it's not a real conflict since those classes will be deleted
            if (conflict.hasConflict && conflict.conflictingClass) {
              const conflictingClassId = conflict.conflictingClass.class_id;
              const isClassBeingMerged = allClassIdsToExclude.includes(conflictingClassId);
              
              if (!isClassBeingMerged) {
                // This is a real conflict with another class that's not being merged
                scheduleConflicts.push({
                  day: schedule.day_of_week,
                  start_time: schedule.start_time,
                  end_time: schedule.end_time,
                  conflicting_class: conflict.conflictingClass,
                  message: conflict.message,
                });
              }
            }
          }
        }
        
        if (scheduleConflicts.length > 0) {
          await client.query('ROLLBACK');
          const conflictMessages = scheduleConflicts.map(c => 
            `${c.day} ${c.start_time}-${c.end_time}: ${c.message}`
          ).join('\n');
          
          return res.status(400).json({
            success: false,
            message: `Schedule conflicts detected. The selected schedule overlaps with existing classes:\n${conflictMessages}`,
            conflicts: scheduleConflicts,
          });
        }
      }

      // Calculate merged class properties from all classes
      const mergedMaxStudents = Math.max(
        ...allClasses.map(c => c.max_students || 0)
      ) || null;

      // Use earliest start_date
      const startDates = allClasses.map(c => c.start_date).filter(Boolean);
      const mergedStartDate = startDates.length > 0
        ? startDates.reduce((earliest, date) => 
            new Date(date) < new Date(earliest) ? date : earliest
          )
        : null;

      // Use latest end_date
      const endDates = allClasses.map(c => c.end_date).filter(Boolean);
      const mergedEndDate = endDates.length > 0
        ? endDates.reduce((latest, date) => 
            new Date(date) > new Date(latest) ? date : latest
          )
        : null;

      // Use provided class_name and teacher_id from request, or fallback to defaults
      const allTeacherIds = allClasses.map(c => c.teacher_id).filter(Boolean);
      let mergedTeacherId = primaryTeacherId || allTeacherIds[0] || null;
      
      // If teacher_ids array is provided, validate all teachers
      // Otherwise, validate single teacher if provided
      if (teacherIdsArray.length > 0) {
        for (const tid of teacherIdsArray) {
          const teacherCheck = await client.query(
            'SELECT user_id, user_type FROM userstbl WHERE user_id = $1',
            [tid]
          );
          if (teacherCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              message: `Teacher with ID ${tid} not found`,
            });
          }
          if (teacherCheck.rows[0].user_type !== 'Teacher') {
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              message: `User with ID ${tid} is not a teacher`,
            });
          }
        }
      } else if (mergedTeacherId) {
        const teacherCheck = await client.query(
          'SELECT user_id, user_type FROM userstbl WHERE user_id = $1',
          [mergedTeacherId]
        );
        if (teacherCheck.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: 'Teacher not found',
          });
        }
        if (teacherCheck.rows[0].user_type !== 'Teacher') {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: 'Selected user is not a teacher',
          });
        }
      }

      // Use provided class_name or combine if not provided
      let mergedClassName = class_name?.trim() || null;
      if (!mergedClassName) {
        const classNames = allClasses.map(c => c.class_name || c.level_tag).filter(Boolean);
        if (classNames.length > 0) {
          mergedClassName = classNames.join(' & ').substring(0, 100);
        }
      } else {
        // Limit to 100 characters
        mergedClassName = mergedClassName.substring(0, 100);
      }

      // Validate room_id exists if provided (can be null)
      if (scheduleRoomId !== null && scheduleRoomId !== undefined) {
        const roomValidation = await client.query(
          'SELECT room_id, branch_id FROM roomstbl WHERE room_id = $1',
          [scheduleRoomId]
        );
        if (roomValidation.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: `Room with ID ${scheduleRoomId} does not exist`,
          });
        }
        if (roomValidation.rows[0].branch_id !== sourceClass.branch_id) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: `Room with ID ${scheduleRoomId} belongs to a different branch`,
          });
        }
      }

      // Validate teacher_id exists if provided (can be null)
      if (mergedTeacherId !== null && mergedTeacherId !== undefined) {
        const teacherValidation = await client.query(
          'SELECT user_id, user_type FROM userstbl WHERE user_id = $1',
          [mergedTeacherId]
        );
        if (teacherValidation.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: `Teacher with ID ${mergedTeacherId} does not exist`,
          });
        }
        if (teacherValidation.rows[0].user_type !== 'Teacher') {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: `User with ID ${mergedTeacherId} is not a teacher`,
          });
        }
      }

      // Create merged class
      const mergedClassResult = await client.query(
        `INSERT INTO classestbl (
          branch_id, room_id, program_id, teacher_id, level_tag, class_name,
          max_students, start_date, end_date, phase_number, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *`,
        [
          sourceClass.branch_id,
          scheduleRoomId || null,
          sourceClass.program_id,
          mergedTeacherId || null,
          sourceClass.level_tag,
          mergedClassName,
          mergedMaxStudents,
          mergedStartDate,
          mergedEndDate,
          sourceClass.phase_number, // Same phase_number as all classes
          'Active'
        ]
      );

      const mergedClass = mergedClassResult.rows[0];
      
      if (!mergedClass || !mergedClass.class_id) {
        await client.query('ROLLBACK');
        return res.status(500).json({
          success: false,
          message: 'Failed to create merged class',
        });
      }
      
      // Create teacher associations for merged class if teacher_ids array is provided
      // Otherwise, combine teachers from both source and target classes
      let finalTeacherIds = teacherIdsArray;
      if (finalTeacherIds.length === 0) {
        // Combine teachers from both classes
        finalTeacherIds = [];
        try {
          // Get teachers from source class
          const sourceTeachersResult = await client.query(
            'SELECT teacher_id FROM classteacherstbl WHERE class_id = $1',
            [sourceClassId]
          );
          sourceTeachersResult.rows.forEach(row => {
            if (!finalTeacherIds.includes(row.teacher_id)) {
              finalTeacherIds.push(row.teacher_id);
            }
          });
          
          // Get teachers from all target classes
          for (const targetClassId of targetClassIds) {
          const targetTeachersResult = await client.query(
            'SELECT teacher_id FROM classteacherstbl WHERE class_id = $1',
            [targetClassId]
          );
          targetTeachersResult.rows.forEach(row => {
            if (!finalTeacherIds.includes(row.teacher_id)) {
              finalTeacherIds.push(row.teacher_id);
            }
          });
          }
          
          // Fallback to single teacher_id if junction table doesn't have entries
          if (finalTeacherIds.length === 0) {
            for (const classData of allClasses) {
              if (classData.teacher_id && !finalTeacherIds.includes(classData.teacher_id)) {
                finalTeacherIds.push(classData.teacher_id);
            }
            }
          }
        } catch (teacherError) {
          // If junction table doesn't exist, use single teacher_id from all classes
          for (const classData of allClasses) {
            if (classData.teacher_id && !finalTeacherIds.includes(classData.teacher_id)) {
              finalTeacherIds.push(classData.teacher_id);
            }
          }
        }
      }
      
      // Create junction table entries for merged class
      if (finalTeacherIds.length > 0) {
        try {
          // Ensure classteacherstbl exists
          await client.query(`
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
          
          // Insert all teacher associations
          for (const tid of finalTeacherIds) {
            await client.query(
              `INSERT INTO classteacherstbl (class_id, teacher_id) 
               VALUES ($1, $2) 
               ON CONFLICT (class_id, teacher_id) DO NOTHING`,
              [mergedClass.class_id, tid]
            );
          }
        } catch (teacherTableError) {
          console.error('Error creating teacher associations for merged class:', teacherTableError);
          // Don't fail the merge if teacher table operations fail
        }
      }

      // Move ALL enrollment records to merged class (preserving phase_number for each)
      // This preserves:
      // - Students enrolled in multiple phases (e.g., Phase 1, 2, 3 for installment students)
      // - Students enrolled in all phases (e.g., full payment students)
      // - Original enrollment dates and metadata
      for (const enrollment of enrollmentsToMove) {
        // Update enrollment to point to merged class, preserving phase_number
        await client.query(
          `UPDATE classstudentstbl 
           SET class_id = $1 
           WHERE classstudent_id = $2`,
          [mergedClass.class_id, enrollment.classstudent_id]
        );
        
        console.log(`  ✓ Moved enrollment: Student ${enrollment.student_name || enrollment.student_id}, Phase ${enrollment.phase_number || 'N/A'}, enrolled: ${enrollment.enrolled_at || 'N/A'}`);
      }

      // Delete duplicate enrollments (only same student + same phase combinations)
      if (enrollmentIdsToDelete.length > 0) {
        await client.query(
          'DELETE FROM classstudentstbl WHERE classstudent_id = ANY($1::int[])',
          [enrollmentIdsToDelete]
        );
        console.log(`✅ Deleted ${enrollmentIdsToDelete.length} duplicate phase enrollment(s) after consolidation`);
      }

      // Create room schedules for merged class using the configured schedule
      for (const schedule of schedules) {
        // Create new schedule for merged class
        await client.query(
          `INSERT INTO roomschedtbl (class_id, room_id, day_of_week, start_time, end_time)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (class_id, room_id, day_of_week) 
           DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time`,
          [
            mergedClass.class_id,
            scheduleRoomId,
            schedule.day_of_week,
            schedule.start_time,
            schedule.end_time
          ]
        );
      }

      // ============================================
      // CAPTURE SNAPSHOT FOR UNDO FUNCTIONALITY
      // ============================================
      // Capture complete snapshots of original classes BEFORE any updates/deletions
      // This allows us to restore them if merge is undone
      console.log('📸 Capturing snapshot of original classes for undo functionality...');
      
      // 1. Capture original classes data
      const originalClassesResult = await client.query(
        `SELECT * FROM classestbl WHERE class_id = ANY($1::int[])`,
        [allClassIds]
      );
      const originalClasses = originalClassesResult.rows.map(row => ({
        class_id: row.class_id,
        branch_id: row.branch_id,
        room_id: row.room_id,
        program_id: row.program_id,
        teacher_id: row.teacher_id,
        level_tag: row.level_tag,
        class_name: row.class_name,
        max_students: row.max_students,
        start_date: row.start_date ? row.start_date.toISOString().split('T')[0] : null,
        end_date: row.end_date ? row.end_date.toISOString().split('T')[0] : null,
        phase_number: row.phase_number,
        session_number: row.session_number,
        status: row.status
      }));

      // 2. Capture original enrollments (from allStudents query - before any updates)
      const originalEnrollmentsSnapshot = allStudents.map(enrollment => ({
        classstudent_id: enrollment.classstudent_id,
        student_id: enrollment.student_id,
        class_id: enrollment.class_id, // Original class_id from before merge
        phase_number: enrollment.phase_number,
        enrolled_at: enrollment.enrolled_at ? enrollment.enrolled_at.toISOString() : null,
        enrolled_by: enrollment.enrolled_by
      }));

      // 3. Capture original room schedules
      const originalSchedulesResult = await client.query(
        `SELECT * FROM roomschedtbl WHERE class_id = ANY($1::int[])`,
        [allClassIds]
      );
      const originalSchedules = originalSchedulesResult.rows.map(row => ({
        class_id: row.class_id,
        room_id: row.room_id,
        day_of_week: row.day_of_week,
        start_time: row.start_time ? row.start_time : null,
        end_time: row.end_time ? row.end_time : null
      }));

      // 4. Capture original reservations (BEFORE updating them)
      const reservationsResult = await client.query(
        'SELECT * FROM reservedstudentstbl WHERE class_id = ANY($1::int[])',
        [allClassIds]
      );
      const originalReservations = reservationsResult.rows.map(row => ({
        reserved_id: row.reserved_id,
        student_id: row.student_id,
        class_id: row.class_id, // Original class_id before update
        package_id: row.package_id,
        branch_id: row.branch_id,
        reservation_fee: row.reservation_fee ? parseFloat(row.reservation_fee) : null,
        status: row.status,
        reserved_at: row.reserved_at ? row.reserved_at.toISOString() : null,
        reserved_by: row.reserved_by,
        reservation_fee_paid_at: row.reservation_fee_paid_at ? row.reservation_fee_paid_at.toISOString() : null,
        upgraded_at: row.upgraded_at ? row.upgraded_at.toISOString() : null,
        upgraded_by: row.upgraded_by,
        notes: row.notes,
        invoice_id: row.invoice_id,
        phase_number: row.phase_number
      }));

      // 5. Capture original teacher associations
      const originalTeacherAssociations = [];
      for (const classId of allClassIds) {
        const teacherAssocResult = await client.query(
          'SELECT * FROM classteacherstbl WHERE class_id = $1',
          [classId]
        );
        for (const assoc of teacherAssocResult.rows) {
          originalTeacherAssociations.push({
            classteacher_id: assoc.classteacher_id,
            class_id: assoc.class_id,
            teacher_id: assoc.teacher_id,
            created_at: assoc.created_at ? assoc.created_at.toISOString() : null
          });
        }
      }

      // 6. Capture original class sessions (BEFORE deleting classes or updating references)
      console.log('📸 Capturing class sessions from original classes...');
      const originalClassSessions = [];
      for (const classId of allClassIds) {
        const sessionsResult = await client.query(
          'SELECT * FROM classsessionstbl WHERE class_id = $1',
          [classId]
        );
        for (const session of sessionsResult.rows) {
          originalClassSessions.push({
            classsession_id: session.classsession_id,
            class_id: session.class_id, // Original class_id before merge
            phase_number: session.phase_number,
            phase_session_number: session.phase_session_number,
            scheduled_date: session.scheduled_date ? session.scheduled_date.toISOString().split('T')[0] : null,
            scheduled_start_time: session.scheduled_start_time ? session.scheduled_start_time : null,
            scheduled_end_time: session.scheduled_end_time ? session.scheduled_end_time : null,
            status: session.status,
            original_teacher_id: session.original_teacher_id,
            assigned_teacher_id: session.assigned_teacher_id,
            substitute_teacher_id: session.substitute_teacher_id,
            substitute_reason: session.substitute_reason,
            actual_date: session.actual_date ? session.actual_date.toISOString().split('T')[0] : null,
            actual_start_time: session.actual_start_time ? session.actual_start_time : null,
            actual_end_time: session.actual_end_time ? session.actual_end_time : null,
            notes: session.notes,
            phasesessiondetail_id: session.phasesessiondetail_id,
            created_at: session.created_at ? session.created_at.toISOString() : null,
            updated_at: session.updated_at ? session.updated_at.toISOString() : null
          });
        }
      }
      console.log(`  ✓ Captured ${originalClassSessions.length} class session(s) from original classes`);

      // Build merge data snapshot
      const mergeDataSnapshot = {
        original_classes: originalClasses,
        original_enrollments: originalEnrollmentsSnapshot,
        original_schedules: originalSchedules,
        original_reservations: originalReservations,
        original_teacher_associations: originalTeacherAssociations,
        original_class_sessions: originalClassSessions // Add class sessions to snapshot
      };

      console.log(`✅ Captured snapshot: ${originalClasses.length} classes, ${originalEnrollmentsSnapshot.length} enrollments, ${originalSchedules.length} schedules, ${originalReservations.length} reservations, ${originalTeacherAssociations.length} teacher associations, ${originalClassSessions.length} class sessions`);

      // Update reservations to point to merged class before deleting original classes
      // This prevents foreign key constraint violations
      if (reservationsResult.rows.length > 0) {
        console.log(`ℹ️ Found ${reservationsResult.rows.length} reservation(s) to update for merged class`);
        
        // Update all reservations to point to merged class
        await client.query(
          `UPDATE reservedstudentstbl 
           SET class_id = $1 
           WHERE class_id = ANY($2::int[])`,
          [mergedClass.class_id, allClassIds]
        );
        console.log(`✅ Updated ${reservationsResult.rows.length} reservation(s) to merged class`);
      }

      // Delete room schedules from old classes (clean up)
      await client.query(
        'DELETE FROM roomschedtbl WHERE class_id = ANY($1::int[])',
        [allClassIds]
      );

      // Delete original classes (reservations have been updated, so this should work now)
      await client.query(
        'DELETE FROM classestbl WHERE class_id = ANY($1::int[])',
        [allClassIds]
      );

      // Store merge history snapshot AFTER successful merge (but still in transaction)
      const mergedByUserId = req.user?.userId || req.user?.user_id || null;
      await client.query(
        `INSERT INTO class_merge_historytbl (merged_class_id, merged_by, merge_data)
         VALUES ($1, $2, $3::jsonb)`,
        [mergedClass.class_id, mergedByUserId, JSON.stringify(mergeDataSnapshot)]
      );
      console.log(`✅ Saved merge history for class ${mergedClass.class_id}`);

      await client.query('COMMIT');

      // Get merged class with full details including schedules
      const mergedClassFullResult = await query(
        `SELECT c.*, 
                p.program_name,
                u.full_name as teacher_name,
                r.room_name,
                COALESCE(enrollment_counts.enrolled_count, 0) as enrolled_students
         FROM classestbl c
         LEFT JOIN programstbl p ON c.program_id = p.program_id
         LEFT JOIN userstbl u ON c.teacher_id = u.user_id
         LEFT JOIN roomstbl r ON c.room_id = r.room_id
         LEFT JOIN (
           SELECT class_id, COUNT(DISTINCT student_id) as enrolled_count
           FROM classstudentstbl
           WHERE COALESCE(enrollment_status, 'Active') = 'Active'
           GROUP BY class_id
         ) enrollment_counts ON c.class_id = enrollment_counts.class_id
         WHERE c.class_id = $1`,
        [mergedClass.class_id]
      );

      // Get schedules for merged class
      const mergedScheduleResult = await query(
        'SELECT * FROM roomschedtbl WHERE class_id = $1 ORDER BY day_of_week',
        [mergedClass.class_id]
      );

      const mergedClassData = mergedClassFullResult.rows[0];
      mergedClassData.days_of_week = mergedScheduleResult.rows;

        // Get accurate counts after merge
        const finalCountsResult = await query(
          `SELECT 
            COUNT(*) as total_enrollments,
            COUNT(DISTINCT student_id) as unique_students,
            COUNT(DISTINCT phase_number) as phases_with_students
           FROM classstudentstbl 
           WHERE class_id = $1`,
          [mergedClass.class_id]
        );
        const finalCounts = finalCountsResult.rows[0];

        res.status(201).json({
          success: true,
          message: 'Classes merged successfully',
          data: {
            merged_class: mergedClassData,
            enrollment_stats: {
              total_enrollment_records: parseInt(finalCounts.total_enrollments, 10),
              unique_students: parseInt(finalCounts.unique_students, 10),
              phases_with_students: parseInt(finalCounts.phases_with_students, 10),
              enrollments_moved: enrollmentsToMove.length,
              duplicates_removed: enrollmentIdsToDelete.length
            },
            source_class_id: sourceClassId,
            target_class_ids: targetClassIds,
            classes_merged: allClassIds.length,
          },
        });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error merging classes:', error);
      
      // Provide more detailed error information for foreign key violations
      if (error.code === '23503') {
        // Foreign key violation - provide more context
        const detail = error.detail || error.message || 'Unknown foreign key reference';
        return res.status(400).json({
          success: false,
          message: `Referenced record does not exist: ${detail}`,
          error: process.env.NODE_ENV === 'development' ? {
            code: error.code,
            detail: error.detail,
            hint: error.hint,
            message: error.message,
            constraint: error.constraint,
            table: error.table
          } : undefined
        });
      }
      
      next(error);
    } finally {
      client.release();
    }
  }
);

/**
 * POST /api/sms/classes/:id/undo-merge
 * Undo a class merge operation by restoring original classes from snapshot
 * Access: Superadmin, Admin
 */
router.post(
  '/:id/undo-merge',
  [
    param('id').isInt().withMessage('Class ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { id: mergedClassId } = req.params;
      const undoneByUserId = req.user?.userId || req.user?.user_id || null;

      // 1. Validate merged class exists and is active
      const mergedClassResult = await client.query(
        `SELECT * FROM classestbl WHERE class_id = $1 AND status = 'Active'`,
        [mergedClassId]
      );

      if (mergedClassResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Merged class not found or is not active',
        });
      }

      // 2. Find latest merge history record for this class (where is_undone = false)
      const mergeHistoryResult = await client.query(
        `SELECT * FROM class_merge_historytbl 
         WHERE merged_class_id = $1 AND is_undone = false 
         ORDER BY merged_at DESC 
         LIMIT 1`,
        [mergedClassId]
      );

      if (mergeHistoryResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'No merge history found for this class or merge has already been undone',
        });
      }

      const mergeHistory = mergeHistoryResult.rows[0];
      const mergeData = mergeHistory.merge_data;

      // 3. Pre-validate schedule conflicts BEFORE making any changes
      // This prevents partial restoration and ensures data integrity
      console.log(`🔍 Pre-validating schedule conflicts before undo...`);
      
      const scheduleConflicts = [];
      
      for (const schedule of mergeData.original_schedules || []) {
        // Check if room still exists
        if (schedule.room_id) {
          const roomCheck = await client.query(
            'SELECT room_id FROM roomstbl WHERE room_id = $1',
            [schedule.room_id]
          );
          
          if (roomCheck.rows.length === 0) {
            const originalClass = mergeData.original_classes?.find(c => c.class_id === schedule.class_id);
            scheduleConflicts.push({
              type: 'missing_room',
              room_id: schedule.room_id,
              day_of_week: schedule.day_of_week,
              start_time: schedule.start_time,
              end_time: schedule.end_time,
              original_class: originalClass ? {
                class_id: originalClass.class_id,
                class_name: originalClass.class_name,
                level_tag: originalClass.level_tag,
              } : null,
              message: `Room ${schedule.room_id} no longer exists. Cannot restore schedule for ${schedule.day_of_week} ${schedule.start_time}-${schedule.end_time}.`,
            });
            continue;
          }
        }

        // Check for conflicts with existing active classes
        if (schedule.room_id && schedule.day_of_week && schedule.start_time && schedule.end_time) {
          // Pre-validate: Check if this schedule would conflict with any existing class
          // We don't exclude any class yet since we haven't created the restored classes
          const conflict = await checkScheduleConflict(
            schedule.room_id,
            schedule.day_of_week,
            schedule.start_time,
            schedule.end_time,
            null // No exclude - we're checking against ALL existing classes
          );

          if (conflict.hasConflict) {
            const originalClass = mergeData.original_classes?.find(c => c.class_id === schedule.class_id);
            scheduleConflicts.push({
              type: 'room_conflict',
              room_id: schedule.room_id,
              day_of_week: schedule.day_of_week,
              start_time: schedule.start_time,
              end_time: schedule.end_time,
              conflicting_class: conflict.conflictingClass,
              original_class: originalClass ? {
                class_id: originalClass.class_id,
                class_name: originalClass.class_name,
                level_tag: originalClass.level_tag,
                program_name: originalClass.program_name,
              } : null,
              message: conflict.message || `Schedule conflicts with existing class on ${schedule.day_of_week} ${schedule.start_time}-${schedule.end_time}`,
            });
          }
        }
      }

      // If conflicts found, block undo and return detailed error
      if (scheduleConflicts.length > 0) {
        await client.query('ROLLBACK');
        
        // Get unique conflicting class IDs for summary
        const conflictingClassIds = scheduleConflicts
          .filter(c => c.type === 'room_conflict' && c.conflicting_class?.class_id)
          .map(c => c.conflicting_class.class_id);
        const uniqueConflictingClassIds = [...new Set(conflictingClassIds)];

        console.error(`❌ Cannot undo merge: ${scheduleConflicts.length} schedule conflict(s) detected`);
        
        return res.status(400).json({
          success: false,
          message: 'Cannot undo merge: Schedule conflicts detected with existing classes',
          conflicts: scheduleConflicts,
          details: {
            total_conflicts: scheduleConflicts.length,
            room_conflicts: scheduleConflicts.filter(c => c.type === 'room_conflict').length,
            missing_room_conflicts: scheduleConflicts.filter(c => c.type === 'missing_room').length,
            conflicting_class_ids: uniqueConflictingClassIds,
            action_required: 'Please resolve these conflicts before undoing the merge. You may need to change the schedule of the conflicting classes or delete them, then try again.',
          },
        });
      }

      console.log(`✅ Pre-validation passed: No schedule conflicts detected`);

      // 4. Check for new enrollments/reservations added after merge
      const newEnrollmentsResult = await client.query(
        `SELECT COUNT(*) as count FROM classstudentstbl 
         WHERE class_id = $1 AND enrolled_at > $2`,
        [mergedClassId, mergeHistory.merged_at]
      );
      const newEnrollmentsCount = parseInt(newEnrollmentsResult.rows[0].count, 10);

      const newReservationsResult = await client.query(
        `SELECT COUNT(*) as count FROM reservedstudentstbl 
         WHERE class_id = $1 AND reserved_at > $2`,
        [mergedClassId, mergeHistory.merged_at]
      );
      const newReservationsCount = parseInt(newReservationsResult.rows[0].count, 10);

      // 5. Restore original classes
      console.log(`🔄 Restoring ${mergeData.original_classes.length} original class(es)...`);
      
      const restoredClassIds = new Map(); // Map old class_id to new class_id
      
      for (const originalClass of mergeData.original_classes) {
        // Validate foreign keys before inserting
        if (originalClass.branch_id) {
          const branchCheck = await client.query(
            'SELECT branch_id FROM branchestbl WHERE branch_id = $1',
            [originalClass.branch_id]
          );
          if (branchCheck.rows.length === 0) {
            console.warn(`⚠️ Branch ${originalClass.branch_id} no longer exists, skipping class restoration`);
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              message: `Referenced record does not exist. Branch ID ${originalClass.branch_id} no longer exists.`,
            });
          }
        }

        if (originalClass.room_id) {
          const roomCheck = await client.query(
            'SELECT room_id FROM roomstbl WHERE room_id = $1',
            [originalClass.room_id]
          );
          if (roomCheck.rows.length === 0) {
            console.warn(`⚠️ Room ${originalClass.room_id} no longer exists, skipping class restoration`);
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              message: `Referenced record does not exist. Room ID ${originalClass.room_id} no longer exists.`,
            });
          }
        }

        if (originalClass.program_id) {
          const programCheck = await client.query(
            'SELECT program_id FROM programstbl WHERE program_id = $1',
            [originalClass.program_id]
          );
          if (programCheck.rows.length === 0) {
            console.warn(`⚠️ Program ${originalClass.program_id} no longer exists, skipping class restoration`);
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              message: `Referenced record does not exist. Program ID ${originalClass.program_id} no longer exists.`,
            });
          }
        }

        if (originalClass.teacher_id) {
          const teacherCheck = await client.query(
            'SELECT user_id FROM userstbl WHERE user_id = $1 AND user_type = $2',
            [originalClass.teacher_id, 'Teacher']
          );
          if (teacherCheck.rows.length === 0) {
            console.warn(`⚠️ Teacher ${originalClass.teacher_id} no longer exists, skipping class restoration`);
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              message: `Referenced record does not exist. Teacher ID ${originalClass.teacher_id} no longer exists.`,
            });
          }
        }

        // Insert original class (will get new class_id due to serial)
        try {
          const restoreClassResult = await client.query(
            `INSERT INTO classestbl (
              branch_id, room_id, program_id, teacher_id, level_tag, class_name,
              max_students, start_date, end_date, phase_number, session_number, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING class_id`,
            [
              originalClass.branch_id,
              originalClass.room_id,
              originalClass.program_id,
              originalClass.teacher_id,
              originalClass.level_tag,
              originalClass.class_name,
              originalClass.max_students,
              originalClass.start_date,
              originalClass.end_date,
              originalClass.phase_number,
              originalClass.session_number,
              originalClass.status || 'Active'
            ]
          );
          
          const newClassId = restoreClassResult.rows[0].class_id;
          restoredClassIds.set(originalClass.class_id, newClassId);
          console.log(`  ✓ Restored class: ${originalClass.class_name || originalClass.level_tag} (old ID: ${originalClass.class_id} -> new ID: ${newClassId})`);
        } catch (insertError) {
          // Catch foreign key constraint errors
          if (insertError.code === '23503') { // Foreign key violation
            const errorDetail = insertError.detail || insertError.message;
            console.error(`❌ Foreign key constraint violation when restoring class:`, errorDetail);
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              message: 'Referenced record does not exist.',
              error: errorDetail,
            });
          }
          throw insertError; // Re-throw if it's not a foreign key error
        }
      }

      // 6. Move enrollments from merged class to restored classes (instead of inserting duplicates)
      // First, get all enrollments currently in the merged class
      console.log(`🔄 Moving enrollments from merged class to restored classes...`);
      
      const allMergedEnrollmentsResult = await client.query(
        `SELECT classstudent_id, student_id, phase_number, enrolled_at, enrolled_by 
         FROM classstudentstbl 
         WHERE class_id = $1`,
        [mergedClassId]
      );
      
      const allMergedEnrollments = allMergedEnrollmentsResult.rows;
      console.log(`  Found ${allMergedEnrollments.length} enrollment(s) in merged class`);
      
      // Create a map: student_id + phase_number -> original class_id (from snapshot)
      const originalEnrollmentMap = new Map();
      for (const enrollment of mergeData.original_enrollments) {
        const key = `${enrollment.student_id}_${enrollment.phase_number}`;
        // Store the original class_id for this student+phase combination
        if (!originalEnrollmentMap.has(key)) {
          originalEnrollmentMap.set(key, enrollment.class_id);
        }
      }
      
      // Move each enrollment to the appropriate restored class
      let movedToRestored = 0;
      let movedToFirst = 0;
      let skipped = 0;
      
      for (const enrollment of allMergedEnrollments) {
        const key = `${enrollment.student_id}_${enrollment.phase_number}`;
        const originalClassId = originalEnrollmentMap.get(key);
        
        let targetClassId = null;
        
        if (originalClassId) {
          // This enrollment came from an original class - move it to the restored class
          targetClassId = restoredClassIds.get(originalClassId);
          if (targetClassId) {
            movedToRestored++;
          }
        }
        
        // If we couldn't find the original class (new enrollment added after merge),
        // move it to the first restored class
        if (!targetClassId && restoredClassIds.size > 0) {
          targetClassId = Array.from(restoredClassIds.values())[0];
          movedToFirst++;
        }
        
        if (targetClassId) {
          // Check if student still exists
          const studentCheck = await client.query(
            'SELECT user_id FROM userstbl WHERE user_id = $1',
            [enrollment.student_id]
          );

          if (studentCheck.rows.length === 0) {
            console.warn(`⚠️ Student ${enrollment.student_id} no longer exists, skipping enrollment`);
            skipped++;
            continue;
          }

          // Move enrollment to restored class
          await client.query(
            `UPDATE classstudentstbl 
             SET class_id = $1 
             WHERE classstudent_id = $2`,
            [targetClassId, enrollment.classstudent_id]
          );
        } else {
          console.warn(`⚠️ Could not determine target class for enrollment ${enrollment.classstudent_id}`);
          skipped++;
        }
      }
      
      console.log(`  ✓ Moved ${movedToRestored} original enrollment(s) to restored classes`);
      console.log(`  ✓ Moved ${movedToFirst} new enrollment(s) to first restored class`);
      if (skipped > 0) {
        console.log(`  ⚠️ Skipped ${skipped} enrollment(s) due to missing data`);
      }

      // 7. Restore original room schedules (with defensive conflict check)
      console.log(`🔄 Restoring ${mergeData.original_schedules.length} schedule(s)...`);
      
      for (const schedule of mergeData.original_schedules) {
        const newClassId = restoredClassIds.get(schedule.class_id);
        if (!newClassId) {
          console.warn(`⚠️ Could not find restored class ID for schedule class_id ${schedule.class_id}`);
          continue;
        }

        // Check if room still exists (defensive check - should have been caught in pre-validation)
        if (schedule.room_id) {
          const roomCheck = await client.query(
            'SELECT room_id FROM roomstbl WHERE room_id = $1',
            [schedule.room_id]
          );

          if (roomCheck.rows.length === 0) {
            console.warn(`⚠️ Room ${schedule.room_id} no longer exists, skipping schedule (should have been caught in pre-validation)`);
            continue;
          }
        }

        // Defensive conflict check (should not find conflicts if pre-validation worked)
        if (schedule.room_id && schedule.day_of_week && schedule.start_time && schedule.end_time) {
          const conflict = await checkScheduleConflict(
            schedule.room_id,
            schedule.day_of_week,
            schedule.start_time,
            schedule.end_time,
            newClassId // Exclude the restored class itself
          );

          if (conflict.hasConflict) {
            // This shouldn't happen if pre-validation worked, but log it and skip
            console.error(`⚠️ Unexpected conflict detected during restoration: ${conflict.message}`);
            console.error(`⚠️ Skipping schedule for class ${newClassId}: ${schedule.day_of_week} ${schedule.start_time}-${schedule.end_time}`);
            continue;
          }
        }

        // Safe to insert schedule
        await client.query(
          `INSERT INTO roomschedtbl (class_id, room_id, day_of_week, start_time, end_time)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (class_id, room_id, day_of_week) 
           DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time`,
          [
            newClassId,
            schedule.room_id,
            schedule.day_of_week,
            schedule.start_time,
            schedule.end_time
          ]
        );
      }

      // 8. Restore original reservations
      console.log(`🔄 Restoring ${mergeData.original_reservations.length} reservation(s)...`);
      
      for (const reservation of mergeData.original_reservations) {
        const newClassId = restoredClassIds.get(reservation.class_id);
        if (!newClassId) {
          console.warn(`⚠️ Could not find restored class ID for reservation class_id ${reservation.class_id}`);
          continue;
        }

        // Check if student still exists
        const studentCheck = await client.query(
          'SELECT user_id FROM userstbl WHERE user_id = $1',
          [reservation.student_id]
        );

        if (studentCheck.rows.length === 0) {
          console.warn(`⚠️ Student ${reservation.student_id} no longer exists, skipping reservation`);
          continue;
        }

        // Find reservation that currently points to merged class and matches student/phase
        // During merge, reservations were updated to point to merged class, so we need to find them
        // by student_id, class_id (merged class), and phase_number
        const findReservationResult = await client.query(
          `SELECT reserved_id FROM reservedstudentstbl 
           WHERE student_id = $1 AND class_id = $2 AND phase_number = $3
           LIMIT 1`,
          [reservation.student_id, mergedClassId, reservation.phase_number]
        );

        if (findReservationResult.rows.length > 0) {
          // Update reservation to point to restored class
          await client.query(
            `UPDATE reservedstudentstbl 
             SET class_id = $1 
             WHERE reserved_id = $2`,
            [newClassId, findReservationResult.rows[0].reserved_id]
          );
          console.log(`  ✓ Restored reservation for student ${reservation.student_id} to class ${newClassId}`);
        } else {
          console.warn(`⚠️ Could not find reservation for student ${reservation.student_id}, phase ${reservation.phase_number} in merged class ${mergedClassId}`);
        }
      }

      // 9. Restore original teacher associations
      console.log(`🔄 Restoring ${mergeData.original_teacher_associations.length} teacher association(s)...`);
      
      for (const assoc of mergeData.original_teacher_associations) {
        const newClassId = restoredClassIds.get(assoc.class_id);
        if (!newClassId) {
          console.warn(`⚠️ Could not find restored class ID for teacher association class_id ${assoc.class_id}`);
          continue;
        }

        // Check if teacher still exists
        const teacherCheck = await client.query(
          'SELECT user_id FROM userstbl WHERE user_id = $1',
          [assoc.teacher_id]
        );

        if (teacherCheck.rows.length === 0) {
          console.warn(`⚠️ Teacher ${assoc.teacher_id} no longer exists, skipping association`);
          continue;
        }

        await client.query(
          `INSERT INTO classteacherstbl (class_id, teacher_id, created_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (class_id, teacher_id) DO NOTHING`,
          [
            newClassId,
            assoc.teacher_id,
            assoc.created_at ? new Date(assoc.created_at) : new Date()
          ]
        );
      }

      // 9.5. Restore original class sessions
      console.log(`🔄 Restoring ${mergeData.original_class_sessions?.length || 0} class session(s)...`);
      
      if (mergeData.original_class_sessions && mergeData.original_class_sessions.length > 0) {
        for (const session of mergeData.original_class_sessions) {
          const newClassId = restoredClassIds.get(session.class_id);
          if (!newClassId) {
            console.warn(`⚠️ Could not find restored class ID for session class_id ${session.class_id}`);
            continue;
          }

          // Validate required fields for class sessions
          if (!session.scheduled_date || !session.scheduled_start_time || !session.scheduled_end_time) {
            console.warn(`⚠️ Skipping session ${session.classsession_id || ''} due to missing required fields (date/start/end).`);
            continue;
          }

          // Check if assigned teacher still exists (if any)
          if (session.assigned_teacher_id) {
            const teacherCheck = await client.query(
              'SELECT user_id FROM userstbl WHERE user_id = $1',
              [session.assigned_teacher_id]
            );

            if (teacherCheck.rows.length === 0) {
              console.warn(`⚠️ Assigned teacher ${session.assigned_teacher_id} no longer exists for session, setting to NULL`);
              session.assigned_teacher_id = null;
            }
          }

          // Insert session with new class_id
          await client.query(
            `INSERT INTO classsessionstbl (
              class_id, phase_number, phase_session_number, scheduled_date, 
              scheduled_start_time, scheduled_end_time, status, 
              original_teacher_id, assigned_teacher_id, substitute_teacher_id, substitute_reason,
              actual_date, actual_start_time, actual_end_time, notes, 
              phasesessiondetail_id, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
            ON CONFLICT (class_id, phase_number, phase_session_number, scheduled_date) 
            DO UPDATE SET 
              scheduled_start_time = EXCLUDED.scheduled_start_time,
              scheduled_end_time = EXCLUDED.scheduled_end_time,
              status = EXCLUDED.status,
              original_teacher_id = EXCLUDED.original_teacher_id,
              assigned_teacher_id = EXCLUDED.assigned_teacher_id,
              substitute_teacher_id = EXCLUDED.substitute_teacher_id,
              substitute_reason = EXCLUDED.substitute_reason,
              actual_date = EXCLUDED.actual_date,
              actual_start_time = EXCLUDED.actual_start_time,
              actual_end_time = EXCLUDED.actual_end_time,
              notes = EXCLUDED.notes,
              phasesessiondetail_id = EXCLUDED.phasesessiondetail_id,
              updated_at = EXCLUDED.updated_at`,
            [
              newClassId,
              session.phase_number,
              session.phase_session_number,
              session.scheduled_date ? new Date(session.scheduled_date) : null,
              session.scheduled_start_time,
              session.scheduled_end_time,
              session.status || 'Scheduled',
              session.original_teacher_id,
              session.assigned_teacher_id,
              session.substitute_teacher_id,
              session.substitute_reason,
              session.actual_date ? new Date(session.actual_date) : null,
              session.actual_start_time,
              session.actual_end_time,
              session.notes,
              session.phasesessiondetail_id,
              session.created_at ? new Date(session.created_at) : new Date(),
              session.updated_at ? new Date(session.updated_at) : new Date()
            ]
          );
        }
        console.log(`  ✓ Restored ${mergeData.original_class_sessions.length} class session(s) to restored classes`);
      } else {
        console.log(`  ℹ️ No class sessions to restore (merge was done before session tracking or sessions were not captured)`);
      }

      // 10. Move new reservations to first restored class (if any)
      if (newReservationsCount > 0 && restoredClassIds.size > 0) {
        const firstRestoredClassId = Array.from(restoredClassIds.values())[0];
        console.log(`ℹ️ Moving ${newReservationsCount} new reservation(s) to first restored class (ID: ${firstRestoredClassId})`);
        
        await client.query(
          `UPDATE reservedstudentstbl 
           SET class_id = $1 
           WHERE class_id = $2 AND reserved_at > $3`,
          [firstRestoredClassId, mergedClassId, mergeHistory.merged_at]
        );
      }

      // 10.5. CRITICAL: Move ALL remaining reservations from merged class to first restored class
      // This handles edge cases where reservations couldn't be matched in step 8
      // (e.g., phase_number is null or doesn't match, or reservations weren't in snapshot)
      // We MUST move all remaining reservations before deleting the merged class to avoid FK violations
      if (restoredClassIds.size > 0) {
        const firstRestoredClassId = Array.from(restoredClassIds.values())[0];
        
        // Check how many reservations still point to merged class
        const remainingReservationsResult = await client.query(
          `SELECT COUNT(*) as count FROM reservedstudentstbl WHERE class_id = $1`,
          [mergedClassId]
        );
        const remainingReservationsCount = parseInt(remainingReservationsResult.rows[0].count, 10);
        
        if (remainingReservationsCount > 0) {
          console.log(`⚠️ Found ${remainingReservationsCount} remaining reservation(s) still pointing to merged class. Moving to first restored class (ID: ${firstRestoredClassId})...`);
          
          // Move ALL remaining reservations to first restored class
          const moveResult = await client.query(
            `UPDATE reservedstudentstbl 
             SET class_id = $1 
             WHERE class_id = $2
             RETURNING reserved_id`,
            [firstRestoredClassId, mergedClassId]
          );
          
          console.log(`  ✓ Moved ${moveResult.rows.length} remaining reservation(s) to first restored class`);
        } else {
          console.log(`  ✓ No remaining reservations found (all reservations have been moved)`);
        }
      }

      // 11. Delete merged class schedules
      await client.query(
        'DELETE FROM roomschedtbl WHERE class_id = $1',
        [mergedClassId]
      );

      // 11.5. Handle other dependent records before deleting merged class
      // Move class sessions from merged class to first restored class (preserve session data)
      // Sessions created during the merged class period should be preserved
      if (restoredClassIds.size > 0) {
        const firstRestoredClassId = Array.from(restoredClassIds.values())[0];
        
        const mergedClassSessionsResult = await client.query(
          'SELECT COUNT(*) as count FROM classsessionstbl WHERE class_id = $1',
          [mergedClassId]
        );
        const mergedSessionsCount = parseInt(mergedClassSessionsResult.rows[0].count, 10);
        
        if (mergedSessionsCount > 0) {
          console.log(`ℹ️ Found ${mergedSessionsCount} class session(s) in merged class. Moving to first restored class (ID: ${firstRestoredClassId})...`);
          
          // Move all sessions from merged class to first restored class
          // This preserves attendance records, status, and other session data
          const moveSessionsResult = await client.query(
            `UPDATE classsessionstbl 
             SET class_id = $1 
             WHERE class_id = $2
             RETURNING classsession_id`,
            [firstRestoredClassId, mergedClassId]
          );
          
          console.log(`  ✓ Moved ${moveSessionsResult.rows.length} class session(s) to first restored class`);
        } else {
          console.log(`  ✓ No class sessions found in merged class`);
        }
      } else {
        // If no classes were restored (shouldn't happen), delete the sessions
        const deletedSessionsResult = await client.query(
          'DELETE FROM classsessionstbl WHERE class_id = $1 RETURNING classsession_id',
          [mergedClassId]
        );
        if (deletedSessionsResult.rows.length > 0) {
          console.log(`  ⚠️ Deleted ${deletedSessionsResult.rows.length} class session(s) from merged class (no restored classes to move to)`);
        }
      }

      // Set installment invoice profiles to NULL (cannot determine which restored class they should belong to)
      const updatedProfilesResult = await client.query(
        'UPDATE installmentinvoiceprofilestbl SET class_id = NULL WHERE class_id = $1 RETURNING installmentinvoiceprofiles_id',
        [mergedClassId]
      );
      if (updatedProfilesResult.rows.length > 0) {
        console.log(`  ✓ Set class_id to NULL for ${updatedProfilesResult.rows.length} installment profile(s) from merged class`);
      }

      // 12. Delete merged class
      await client.query(
        'DELETE FROM classestbl WHERE class_id = $1',
        [mergedClassId]
      );

      // 13. Mark merge history as undone
      await client.query(
        `UPDATE class_merge_historytbl 
         SET is_undone = true, undone_at = CURRENT_TIMESTAMP, undone_by = $1
         WHERE merge_history_id = $2`,
        [undoneByUserId, mergeHistory.merge_history_id]
      );

      await client.query('COMMIT');

      console.log(`✅ Successfully undid merge for class ${mergedClassId}`);

      res.status(200).json({
        success: true,
        message: 'Merge undone successfully',
        data: {
          restored_classes: Array.from(restoredClassIds.values()),
          original_class_ids: mergeData.original_classes.map(c => c.class_id),
          new_enrollments_moved: newEnrollmentsCount,
          new_reservations_moved: newReservationsCount,
        },
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error undoing merge:', error);
      next(error);
    } finally {
      client.release();
    }
  }
);

/**
 * GET /api/sms/classes/:id/merge-history
 * Get merge history for a class
 * Access: All authenticated users
 */
router.get(
  '/:id/merge-history',
  [
    param('id').isInt().withMessage('Class ID must be an integer'),
    handleValidationErrors,
  ],
  verifyFirebaseToken,
  async (req, res, next) => {
    try {
      const { id: classId } = req.params;

      // Get merge history records for this class
      const mergeHistoryResult = await query(
        `SELECT 
          mh.merge_history_id,
          mh.merged_class_id,
          mh.merged_at,
          mh.merged_by,
          mh.merge_data,
          mh.is_undone,
          mh.undone_at,
          mh.undone_by,
          u1.full_name as merged_by_name,
          u2.full_name as undone_by_name
         FROM class_merge_historytbl mh
         LEFT JOIN userstbl u1 ON mh.merged_by = u1.user_id
         LEFT JOIN userstbl u2 ON mh.undone_by = u2.user_id
         WHERE mh.merged_class_id = $1
         ORDER BY mh.merged_at DESC`,
        [classId]
      );

      // Parse and format merge history data
      const mergeHistory = mergeHistoryResult.rows.map(row => {
        const mergeData = row.merge_data;
        
        // Calculate summary statistics
        const originalClassCount = mergeData.original_classes?.length || 0;
        const originalEnrollmentCount = mergeData.original_enrollments?.length || 0;
        const originalScheduleCount = mergeData.original_schedules?.length || 0;
        const originalReservationCount = mergeData.original_reservations?.length || 0;
        const originalTeacherAssocCount = mergeData.original_teacher_associations?.length || 0;

        // Get unique student count from enrollments
        const uniqueStudents = new Set(
          (mergeData.original_enrollments || []).map(e => e.student_id)
        ).size;

        return {
          merge_history_id: row.merge_history_id,
          merged_class_id: row.merged_class_id,
          merged_at: row.merged_at ? row.merged_at.toISOString() : null,
          merged_by: row.merged_by,
          merged_by_name: row.merged_by_name,
          is_undone: row.is_undone,
          undone_at: row.undone_at ? row.undone_at.toISOString() : null,
          undone_by: row.undone_by,
          undone_by_name: row.undone_by_name,
          summary: {
            original_class_count: originalClassCount,
            original_enrollment_count: originalEnrollmentCount,
            unique_students: uniqueStudents,
            original_schedule_count: originalScheduleCount,
            original_reservation_count: originalReservationCount,
            original_teacher_association_count: originalTeacherAssocCount,
          },
          original_classes: mergeData.original_classes || [],
          original_enrollments: mergeData.original_enrollments || [],
          original_schedules: mergeData.original_schedules || [],
          original_reservations: mergeData.original_reservations || [],
          original_teacher_associations: mergeData.original_teacher_associations || [],
        };
      });

      res.json({
        success: true,
        data: mergeHistory,
      });
    } catch (error) {
      console.error('Error fetching merge history:', error);
      next(error);
    }
  }
);

/**
 * POST /api/v1/classes/check-teacher-conflicts
 * Check if teachers have schedule conflicts with existing class sessions
 * Body: { teacher_ids: [1, 2, ...], days_of_week: [{day: 'Monday', start_time: '09:00', end_time: '10:00', enabled: true}, ...], exclude_class_id?: number }
 * Access: Superadmin, Admin
 */
router.post(
  '/check-teacher-conflicts',
  [
    body('teacher_ids').isArray().withMessage('teacher_ids must be an array').notEmpty().withMessage('teacher_ids must not be empty'),
    body('teacher_ids.*').isInt().withMessage('Each teacher_id must be an integer'),
    body('days_of_week')
      .isArray().withMessage('days_of_week must be an array')
      .notEmpty().withMessage('days_of_week must not be empty')
      .custom((daysOfWeek) => {
        if (!Array.isArray(daysOfWeek)) return false;
        if (daysOfWeek.length === 0) {
          throw new Error('days_of_week must contain at least one day');
        }
        for (const day of daysOfWeek) {
          if (!day || typeof day !== 'object') {
            throw new Error('Each day must be an object');
          }
          if (!day.day || typeof day.day !== 'string' || day.day.trim().length === 0) {
            throw new Error('Each day must have a non-empty day name');
          }
          // Only validate start_time and end_time if the day is enabled
          if (day.enabled === true || day.enabled === undefined) {
            if (!day.start_time || typeof day.start_time !== 'string' || day.start_time.trim().length === 0) {
              throw new Error(`start_time is required for ${day.day} when enabled`);
            }
            if (!day.end_time || typeof day.end_time !== 'string' || day.end_time.trim().length === 0) {
              throw new Error(`end_time is required for ${day.day} when enabled`);
            }
          }
          // Validate enabled is boolean if provided
          if (day.enabled !== undefined && typeof day.enabled !== 'boolean') {
            throw new Error(`enabled must be a boolean for ${day.day}`);
          }
        }
        return true;
      }),
    body('exclude_class_id')
      .optional({ nullable: true, checkFalsy: true })
      .custom((value) => {
        if (value === null || value === undefined) return true;
        return Number.isInteger(Number(value));
      })
      .withMessage('exclude_class_id must be an integer or null'),
    handleValidationErrors,
    requireRole('Superadmin', 'Admin'),
  ],
  async (req, res, next) => {
    try {
      const { teacher_ids, days_of_week, exclude_class_id } = req.body;

      if (!teacher_ids || !Array.isArray(teacher_ids) || teacher_ids.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'teacher_ids is required and must be a non-empty array',
        });
      }

      if (!days_of_week || !Array.isArray(days_of_week)) {
        return res.status(400).json({
          success: false,
          message: 'days_of_week is required and must be an array',
        });
      }

      // Format days_of_week for the conflict check function
      const formattedDaysOfWeek = days_of_week.map(day => ({
        day: day.day,
        start_time: day.start_time,
        end_time: day.end_time,
        enabled: day.enabled !== false, // Default to true if not specified
      }));

      const allConflicts = [];

      // Check conflicts for each teacher
      for (const teacherId of teacher_ids) {
        const conflictResult = await checkTeacherScheduleConflict(
          teacherId,
          formattedDaysOfWeek,
          exclude_class_id || null
        );

        if (conflictResult.hasConflict && conflictResult.conflicts.length > 0) {
          // Get teacher name for better error messages
          const teacherResult = await query(
            'SELECT user_id, full_name FROM userstbl WHERE user_id = $1',
            [teacherId]
          );
          const teacherName = teacherResult.rows[0]?.full_name || `Teacher ${teacherId}`;

          allConflicts.push({
            teacher_id: teacherId,
            teacher_name: teacherName,
            conflicts: conflictResult.conflicts,
          });
        }
      }

      if (allConflicts.length > 0) {
        return res.status(200).json({
          success: true,
          has_conflicts: true,
          conflicts: allConflicts,
          message: `${allConflicts.length} teacher(s) have schedule conflicts`,
        });
      }

      return res.status(200).json({
        success: true,
        has_conflicts: false,
        conflicts: [],
        message: 'No schedule conflicts detected',
      });
    } catch (error) {
      console.error('Error checking teacher conflicts:', error);
      next(error);
    }
  }
);

export default router;

