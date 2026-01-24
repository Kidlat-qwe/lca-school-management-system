import express from 'express';
import { body, param, query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole, requireBranchAccess } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query } from '../config/database.js';

const router = express.Router();

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

router.use(verifyFirebaseToken);
router.use(requireBranchAccess);

/**
 * GET /api/v1/rooms
 * Get all rooms
 */
router.get(
  '/',
  [
    queryValidator('branch_id').optional().isInt().withMessage('Branch ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { branch_id } = req.query;
      let sql = 'SELECT * FROM roomstbl WHERE 1=1';
      const params = [];

      if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        sql += ' AND branch_id = $1';
        params.push(req.user.branchId);
      } else if (branch_id) {
        sql += ' AND branch_id = $1';
        params.push(branch_id);
      }

      sql += ' ORDER BY room_id DESC';

      const result = await query(sql, params);
      res.json({ success: true, data: result.rows });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/rooms
 * Create new room
 */
router.post(
  '/',
  [
    body('room_name').notEmpty().withMessage('Room name is required'),
    body('branch_id').isInt().withMessage('Branch ID is required'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { room_name, branch_id } = req.body;

      const branchCheck = await query('SELECT branch_id FROM branchestbl WHERE branch_id = $1', [branch_id]);
      if (branchCheck.rows.length === 0) {
        return res.status(400).json({ success: false, message: 'Branch not found' });
      }

      const result = await query(
        'INSERT INTO roomstbl (room_name, branch_id) VALUES ($1, $2) RETURNING *',
        [room_name, branch_id]
      );

      res.status(201).json({
        success: true,
        message: 'Room created successfully',
        data: result.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/v1/rooms/:id
 * Update room
 */
router.put(
  '/:id',
  [
    param('id').isInt().withMessage('Room ID must be an integer'),
    body('room_name').optional().notEmpty().withMessage('Room name cannot be empty'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { room_name, branch_id } = req.body;

      const existingRoom = await query('SELECT * FROM roomstbl WHERE room_id = $1', [id]);
      if (existingRoom.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Room not found' });
      }

      const updates = [];
      const params = [];
      let paramCount = 0;

      if (room_name !== undefined) {
        paramCount++;
        updates.push(`room_name = $${paramCount}`);
        params.push(room_name);
      }
      if (branch_id !== undefined) {
        paramCount++;
        updates.push(`branch_id = $${paramCount}`);
        params.push(branch_id);
      }

      if (updates.length === 0) {
        return res.status(400).json({ success: false, message: 'No fields to update' });
      }

      paramCount++;
      params.push(id);

      const sql = `UPDATE roomstbl SET ${updates.join(', ')} WHERE room_id = $${paramCount} RETURNING *`;
      const result = await query(sql, params);

      res.json({
        success: true,
        message: 'Room updated successfully',
        data: result.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/v1/rooms/:id
 * Delete room
 */
router.delete(
  '/:id',
  [param('id').isInt().withMessage('Room ID must be an integer'), handleValidationErrors],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const existingRoom = await query('SELECT * FROM roomstbl WHERE room_id = $1', [id]);
      if (existingRoom.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Room not found' });
      }

      await query('DELETE FROM roomstbl WHERE room_id = $1', [id]);
      res.json({ success: true, message: 'Room deleted successfully' });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/rooms/:id/schedules
 * Get all schedules for a room
 */
router.get(
  '/:id/schedules',
  [
    param('id').isInt().withMessage('Room ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;

      // Get schedules with class information
      // Check if day_of_week column exists first
      let result;
      try {
        result = await query(
          `SELECT 
            rs.class_id,
            rs.room_id,
            rs.day_of_week,
            rs.start_time,
            rs.end_time,
            c.level_tag,
            c.class_name,
            c.program_id,
            p.program_name,
            COALESCE(
              (SELECT string_agg(u.full_name, ', ' ORDER BY ct.created_at)
               FROM classteacherstbl ct
               INNER JOIN userstbl u ON ct.teacher_id = u.user_id
               WHERE ct.class_id = c.class_id),
              u_single.full_name,
              NULL
            ) as teacher_names
          FROM roomschedtbl rs
          LEFT JOIN classestbl c ON rs.class_id = c.class_id
          LEFT JOIN programstbl p ON c.program_id = p.program_id
          LEFT JOIN userstbl u_single ON c.teacher_id = u_single.user_id
          WHERE rs.room_id = $1
          ORDER BY 
            CASE rs.day_of_week
              WHEN 'Monday' THEN 1
              WHEN 'Tuesday' THEN 2
              WHEN 'Wednesday' THEN 3
              WHEN 'Thursday' THEN 4
              WHEN 'Friday' THEN 5
              WHEN 'Saturday' THEN 6
              WHEN 'Sunday' THEN 7
              ELSE 8
            END,
            rs.start_time ASC`,
          [id]
        );
      } catch (dbError) {
        // If column doesn't exist, return empty array with helpful message
        if (dbError.message && dbError.message.includes('day_of_week')) {
          console.error('⚠️ Database migration not run. Please run: backend/migrations/002_add_day_of_week_to_roomschedtbl.sql');
          return res.json({
            success: true,
            data: [],
            message: 'Database migration required. Please run the migration file to enable schedule features.',
          });
        }
        throw dbError;
      }

      res.json({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/rooms/:id/schedules
 * Add a schedule to a room
 */
router.post(
  '/:id/schedules',
  [
    param('id').isInt().withMessage('Room ID must be an integer'),
    body('class_id').optional().isInt().withMessage('Class ID must be an integer if provided'),
    body('day_of_week').notEmpty().withMessage('Day of week is required'),
    body('start_time').notEmpty().withMessage('Start time is required'),
    body('end_time').notEmpty().withMessage('End time is required'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { class_id, day_of_week, start_time, end_time } = req.body;

      // Verify room exists
      const roomCheck = await query('SELECT room_id FROM roomstbl WHERE room_id = $1', [id]);
      if (roomCheck.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Room not found' });
      }

      // Verify class exists if provided
      if (class_id) {
        const classCheck = await query('SELECT class_id FROM classestbl WHERE class_id = $1', [class_id]);
        if (classCheck.rows.length === 0) {
          return res.status(400).json({ success: false, message: 'Class not found' });
        }
      }

      // Check if schedule already exists for this day and room
      // If class_id is provided, check for that specific class; otherwise check for any schedule on that day
      let existingSchedule;
      if (class_id) {
        existingSchedule = await query(
          'SELECT * FROM roomschedtbl WHERE class_id = $1 AND room_id = $2 AND day_of_week = $3',
          [class_id, id, day_of_week]
        );
      } else {
        existingSchedule = await query(
          'SELECT * FROM roomschedtbl WHERE room_id = $1 AND day_of_week = $2 AND class_id IS NULL',
          [id, day_of_week]
        );
      }
      
      if (existingSchedule.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: `A schedule for this room and day (${day_of_week}) already exists`,
        });
      }

      // Check for conflicts with active classes
      const conflict = await checkScheduleConflict(
        id,
        day_of_week,
        start_time,
        end_time,
        class_id || null // Exclude the provided class_id if updating its own schedule
      );

      if (conflict.hasConflict) {
        return res.status(400).json({
          success: false,
          message: conflict.message || `Schedule conflict detected for ${day_of_week}`,
          conflict: {
            day: day_of_week,
            conflicting_class: conflict.conflictingClass,
          },
        });
      }

      let result;
      try {
        result = await query(
          `INSERT INTO roomschedtbl (class_id, room_id, day_of_week, start_time, end_time)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [class_id || null, id, day_of_week, start_time, end_time]
        );
      } catch (dbError) {
        // If column doesn't exist, provide helpful error message
        if (dbError.message && dbError.message.includes('day_of_week')) {
          return res.status(500).json({
            success: false,
            message: 'Database migration required. Please run: backend/migrations/002_add_day_of_week_to_roomschedtbl.sql',
            error: 'day_of_week column does not exist',
          });
        }
        throw dbError;
      }

      res.status(201).json({
        success: true,
        message: 'Schedule added successfully',
        data: result.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/v1/rooms/:id/schedules/:dayOfWeek
 * Update a schedule for a room
 */
router.put(
  '/:id/schedules/:dayOfWeek',
  [
    param('id').isInt().withMessage('Room ID must be an integer'),
    param('dayOfWeek').notEmpty().withMessage('Day of week is required'),
    body('start_time').optional().notEmpty().withMessage('Start time cannot be empty'),
    body('end_time').optional().notEmpty().withMessage('End time cannot be empty'),
    body('class_id').optional().isInt().withMessage('Class ID must be an integer if provided'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id, dayOfWeek } = req.params;
      const { start_time, end_time, class_id } = req.body;

      // Check if schedule exists
      const existingSchedule = await query(
        'SELECT * FROM roomschedtbl WHERE room_id = $1 AND day_of_week = $2',
        [id, dayOfWeek]
      );
      if (existingSchedule.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Schedule not found',
        });
      }

      // Check for conflicts with active classes if updating time
      if (start_time && end_time) {
        const excludeClassId = class_id !== undefined ? class_id : existingSchedule.rows[0].class_id;
        const conflict = await checkScheduleConflict(
          id,
          dayOfWeek,
          start_time,
          end_time,
          excludeClassId // Exclude the current class from conflict check
        );

        if (conflict.hasConflict) {
          return res.status(400).json({
            success: false,
            message: conflict.message || `Schedule conflict detected for ${dayOfWeek}`,
            conflict: {
              day: dayOfWeek,
              conflicting_class: conflict.conflictingClass,
            },
          });
        }
      }

      const updates = [];
      const params = [];
      let paramCount = 0;

      if (start_time !== undefined) {
        paramCount++;
        updates.push(`start_time = $${paramCount}`);
        params.push(start_time);
      }
      if (end_time !== undefined) {
        paramCount++;
        updates.push(`end_time = $${paramCount}`);
        params.push(end_time);
      }
      if (class_id !== undefined) {
        paramCount++;
        updates.push(`class_id = $${paramCount}`);
        params.push(class_id);
      }

      if (updates.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No fields to update',
        });
      }

      paramCount++;
      params.push(id);
      paramCount++;
      params.push(dayOfWeek);

      const sql = `UPDATE roomschedtbl SET ${updates.join(', ')} WHERE room_id = $${paramCount - 1} AND day_of_week = $${paramCount} RETURNING *`;
      const result = await query(sql, params);

      res.json({
        success: true,
        message: 'Schedule updated successfully',
        data: result.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/v1/rooms/:id/schedules/:dayOfWeek
 * Delete a schedule from a room
 */
router.delete(
  '/:id/schedules/:dayOfWeek',
  [
    param('id').isInt().withMessage('Room ID must be an integer'),
    param('dayOfWeek').notEmpty().withMessage('Day of week is required'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id, dayOfWeek } = req.params;

      // Check if schedule exists
      const existingSchedule = await query(
        'SELECT * FROM roomschedtbl WHERE room_id = $1 AND day_of_week = $2',
        [id, dayOfWeek]
      );
      if (existingSchedule.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Schedule not found',
        });
      }

      await query('DELETE FROM roomschedtbl WHERE room_id = $1 AND day_of_week = $2', [id, dayOfWeek]);

      res.json({
        success: true,
        message: 'Schedule deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;

