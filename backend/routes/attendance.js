import express from 'express';
import { body, param, query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole, requireBranchAccess } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query, getClient } from '../config/database.js';

const router = express.Router();

// All routes require authentication
router.use(verifyFirebaseToken);
router.use(requireBranchAccess);

/**
 * GET /api/v1/attendance/session/:sessionId
 * Get attendance records for a specific class session
 * Access: All authenticated users
 */
router.get(
  '/session/:sessionId',
  [
    param('sessionId').isInt().withMessage('Session ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { sessionId } = req.params;

      // Verify session exists and get phase_number
      const sessionCheck = await query(
        `SELECT cs.classsession_id,
                cs.class_id,
                cs.phase_number,
                TO_CHAR(cs.scheduled_date, 'YYYY-MM-DD') as scheduled_date,
                cs.scheduled_start_time,
                cs.scheduled_end_time,
                cs.status, ps.topic, ps.goal, ps.agenda, c.class_name, c.level_tag, p.program_name
         FROM classsessionstbl cs
         LEFT JOIN phasesessionstbl ps ON cs.phasesessiondetail_id = ps.phasesessiondetail_id
         LEFT JOIN classestbl c ON cs.class_id = c.class_id
         LEFT JOIN programstbl p ON c.program_id = p.program_id
         WHERE cs.classsession_id = $1`,
        [sessionId]
      );

      if (sessionCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Class session not found',
        });
      }

      const session = sessionCheck.rows[0];

      // Get enrolled students for this class AND this specific phase
      // Only show students who are enrolled in the session's phase_number
      // Note: A student can have multiple rows in classstudentstbl (e.g. per phase),
      // so we filter by phase_number to only get students enrolled in this phase
      const studentsResult = await query(
        `SELECT 
          u.user_id as student_id,
          u.full_name,
          u.profile_picture_url,
          cs_enroll.phase_number,
          cs_enroll.enrolled_at
         FROM classstudentstbl cs_enroll
         INNER JOIN userstbl u ON cs_enroll.student_id = u.user_id
         WHERE cs_enroll.class_id = $1
           AND cs_enroll.phase_number = $2
         ORDER BY cs_enroll.enrolled_at DESC`,
        [session.class_id, session.phase_number]
      );

      // Get attendance records for this session
      const attendanceResult = await query(
        `SELECT 
          a.attendance_id,
          a.student_id,
          a.status,
          a.notes,
          a.marked_by,
          TO_CHAR(a.marked_at, 'YYYY-MM-DD HH24:MI:SS') as marked_at,
          u.full_name as marked_by_name
         FROM attendancetbl a
         LEFT JOIN userstbl u ON a.marked_by = u.user_id
         WHERE a.classsession_id = $1`,
        [sessionId]
      );

      // Create a map of attendance records by student_id
      const attendanceMap = new Map();
      attendanceResult.rows.forEach(record => {
        attendanceMap.set(record.student_id, record);
      });

      // Combine students with their attendance records
      const studentsWithAttendance = studentsResult.rows.map(student => ({
        student_id: student.student_id,
        full_name: student.full_name,
        profile_picture_url: student.profile_picture_url,
        phase_number: student.phase_number,
        enrolled_at: student.enrolled_at,
        attendance: attendanceMap.get(student.student_id) || null,
      }));

      res.json({
        success: true,
        data: {
          session: {
            classsession_id: session.classsession_id,
            class_id: session.class_id,
            scheduled_date: session.scheduled_date,
            scheduled_start_time: session.scheduled_start_time,
            scheduled_end_time: session.scheduled_end_time,
            status: session.status,
            topic: session.topic,
            goal: session.goal,
            agenda: session.agenda,
            class_name: session.class_name,
            level_tag: session.level_tag,
            program_name: session.program_name,
          },
          students: studentsWithAttendance,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/attendance/session/:sessionId
 * Create or update attendance records for a class session
 * Access: Superadmin, Admin, Teacher
 */
router.post(
  '/session/:sessionId',
  [
    param('sessionId').isInt().withMessage('Session ID must be an integer'),
    body('attendance').isArray().withMessage('Attendance must be an array'),
    body('attendance.*.student_id').isInt().withMessage('Student ID must be an integer'),
    body('attendance.*.status').isIn(['Present', 'Absent', 'Late', 'Excused', 'Leave Early']).withMessage('Status must be Present, Absent, Late, Excused, or Leave Early'),
    body('attendance.*.notes').optional().trim(),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Teacher'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { sessionId } = req.params;
      const { attendance } = req.body;
      const markedBy = req.user.userId;

      // Verify session exists and get scheduled date
      const sessionCheck = await client.query(
        `SELECT classsession_id, class_id, scheduled_date, status 
         FROM classsessionstbl 
         WHERE classsession_id = $1`,
        [sessionId]
      );

      if (sessionCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Class session not found',
        });
      }

      const session = sessionCheck.rows[0];

      // Check if attendance window is open (allow past sessions, block future sessions)
      const sessionDate = new Date(session.scheduled_date);
      const today = new Date();
      
      // Set both dates to start of day for comparison
      sessionDate.setHours(0, 0, 0, 0);
      today.setHours(0, 0, 0, 0);
      
      const isFutureSession = today < sessionDate;
      
      // Don't allow marking attendance if the session has already been marked as Completed
      if (session.status === 'Completed') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Attendance for this session has already been completed and cannot be modified.',
        });
      }
      
      // Block only future sessions - allow past and current sessions
      if (isFutureSession) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Cannot mark attendance for a future session. Please wait until the session date.',
        });
      }

      // Verify all students are enrolled in this class
      const studentIds = attendance.map(a => a.student_id);
      const enrolledCheck = await client.query(
        `SELECT DISTINCT student_id FROM classstudentstbl WHERE class_id = $1 AND student_id = ANY($2::int[])`,
        [session.class_id, studentIds]
      );

      const enrolledStudentIds = new Set(enrolledCheck.rows.map(r => r.student_id));
      const invalidStudents = studentIds.filter(id => !enrolledStudentIds.has(id));

      if (invalidStudents.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `Some students are not enrolled in this class: ${invalidStudents.join(', ')}`,
        });
      }

      // Process each attendance record
      const results = [];
      for (const record of attendance) {
        const { student_id, status, notes } = record;

        // Check if attendance record already exists
        const existingCheck = await client.query(
          'SELECT attendance_id FROM attendancetbl WHERE classsession_id = $1 AND student_id = $2',
          [sessionId, student_id]
        );

        if (existingCheck.rows.length > 0) {
          // Update existing record
          const updateResult = await client.query(
            `UPDATE attendancetbl 
            SET status = $1, notes = $2, marked_by = $3, marked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE classsession_id = $4 AND student_id = $5
            RETURNING attendance_id, student_id, status, notes, marked_at`,
            [status, notes || null, markedBy, sessionId, student_id]
          );
          results.push(updateResult.rows[0]);
        } else {
          // Insert new record
          const insertResult = await client.query(
            `INSERT INTO attendancetbl (classsession_id, student_id, status, notes, marked_by, marked_at)
             VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
             RETURNING attendance_id, student_id, status, notes, marked_at`,
            [sessionId, student_id, status, notes || null, markedBy]
          );
          results.push(insertResult.rows[0]);
        }
      }

      // After recording attendance, mark the session as Completed
      await client.query(
        `UPDATE classsessionstbl
         SET status = 'Completed', updated_at = CURRENT_TIMESTAMP
         WHERE classsession_id = $1`,
        [sessionId]
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Attendance saved successfully',
        data: results,
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
 * PUT /api/v1/attendance/:attendanceId
 * Update a specific attendance record
 * Access: Superadmin, Admin, Teacher
 */
router.put(
  '/:attendanceId',
  [
    param('attendanceId').isInt().withMessage('Attendance ID must be an integer'),
    body('status').isIn(['Present', 'Absent', 'Late', 'Excused']).withMessage('Status must be Present, Absent, Late, or Excused'),
    body('notes').optional().trim(),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Teacher'),
  async (req, res, next) => {
    try {
      const { attendanceId } = req.params;
      const { status, notes } = req.body;
      const markedBy = req.user.userId;

      // Verify attendance record exists
      const existingCheck = await query(
        'SELECT attendance_id FROM attendancetbl WHERE attendance_id = $1',
        [attendanceId]
      );

      if (existingCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Attendance record not found',
        });
      }

      // Update attendance record
      const updateResult = await query(
        `UPDATE attendancetbl 
         SET status = $1, notes = $2, marked_by = $3, marked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE attendance_id = $4
         RETURNING attendance_id, student_id, status, notes, marked_at`,
        [status, notes || null, markedBy, attendanceId]
      );

      res.json({
        success: true,
        message: 'Attendance updated successfully',
        data: updateResult.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;

