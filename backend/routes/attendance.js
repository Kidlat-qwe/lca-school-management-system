import express from 'express';
import { body, param, query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole, requireBranchAccess } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query, getClient } from '../config/database.js';
import { getPhaseAttendanceSummary } from '../utils/phaseAttendanceSummaryService.js';

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
      // Include "completed" so students who finished the phase still appear in attendance
      // (matches class session enrollment counts that include completed rows).
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
           AND cs_enroll.program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin', 'completed')
           AND cs_enroll.removed_at IS NULL
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
 * Access: Admin, Teacher
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
  requireRole('Admin', 'Teacher'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { sessionId } = req.params;
      const { attendance } = req.body;
      const markedBy = req.user.userId;

      // Verify session exists and get scheduled date + phase for enrollment validation
      const sessionCheck = await client.query(
        `SELECT classsession_id, class_id, phase_number, scheduled_date, status 
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
        `SELECT DISTINCT cs.student_id
         FROM classstudentstbl cs
         WHERE cs.class_id = $1
           AND cs.phase_number = $2
           AND cs.student_id = ANY($3::int[])
           AND cs.program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin', 'completed')
           AND cs.removed_at IS NULL`,
        [session.class_id, session.phase_number, studentIds]
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
 * GET /api/v1/attendance/student/:studentId
 * Attendance history for one student across eligible class sessions
 * (same enrollment + phase rules as GET /attendance/session/:sessionId).
 * Optional query: class_id — limit to one enrolled class.
 * Access: All authenticated users (students: own record only).
 */
router.get(
  '/student/:studentId',
  [
    param('studentId').isInt().withMessage('Student ID must be an integer'),
    queryValidator('class_id').optional().isInt().withMessage('class_id must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { studentId } = req.params;
      const studentIdInt = parseInt(studentId, 10);
      const classIdFilter = req.query.class_id != null ? parseInt(req.query.class_id, 10) : null;

      if (req.user.userType === 'Student' && req.user.userId !== studentIdInt) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only view your own attendance.',
        });
      }

      const studentCheck = await query(
        'SELECT user_id, branch_id FROM userstbl WHERE user_id = $1',
        [studentIdInt]
      );
      if (studentCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Student not found',
        });
      }

      const studentBranchId =
        studentCheck.rows[0].branch_id != null ? Number(studentCheck.rows[0].branch_id) : null;
      const isSuperadmin = req.user.userType === 'Superadmin';
      const userBranchId =
        req.user.branchId != null ? Number(req.user.branchId) : null;

      if (!isSuperadmin && userBranchId != null && studentBranchId != null) {
        if (studentBranchId !== userBranchId) {
          return res.status(403).json({
            success: false,
            message: 'Access denied for this student branch.',
          });
        }
      }

      const params = [studentIdInt];
      let classFilterSql = '';
      if (classIdFilter != null && Number.isFinite(classIdFilter)) {
        params.push(classIdFilter);
        classFilterSql = ` AND cs.class_id = $${params.length}`;
      }

      let branchFilterSql = '';
      if (!isSuperadmin && userBranchId != null) {
        params.push(userBranchId);
        branchFilterSql = ` AND c.branch_id = $${params.length}`;
      }

      const rowsResult = await query(
        `SELECT
          a.attendance_id,
          a.status,
          a.notes,
          TO_CHAR(a.marked_at, 'YYYY-MM-DD HH24:MI:SS') AS marked_at,
          marker.full_name AS marked_by_name,
          cs.classsession_id,
          cs.class_id,
          cs.phase_number,
          cs.phase_session_number,
          TO_CHAR(cs.scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
          cs.scheduled_start_time,
          cs.scheduled_end_time,
          cs.status AS session_status,
          cs.class_code,
          ps.topic,
          ps.goal,
          ps.agenda,
          c.class_name,
          c.level_tag,
          p.program_name
         FROM classsessionstbl cs
         INNER JOIN classstudentstbl cs_enroll
           ON cs_enroll.class_id = cs.class_id
          AND cs_enroll.phase_number = cs.phase_number
          AND cs_enroll.student_id = $1
          AND cs_enroll.program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin', 'completed')
          AND cs_enroll.removed_at IS NULL
         INNER JOIN classestbl c ON cs.class_id = c.class_id
         LEFT JOIN programstbl p ON c.program_id = p.program_id
         LEFT JOIN phasesessionstbl ps ON cs.phasesessiondetail_id = ps.phasesessiondetail_id
         LEFT JOIN attendancetbl a
           ON a.classsession_id = cs.classsession_id
          AND a.student_id = $1
         LEFT JOIN userstbl marker ON a.marked_by = marker.user_id
         WHERE 1=1
         ${classFilterSql}
         ${branchFilterSql}
         ORDER BY cs.scheduled_date DESC,
                  cs.scheduled_start_time DESC NULLS LAST,
                  cs.phase_number DESC,
                  cs.phase_session_number DESC`,
        params
      );

      const records = rowsResult.rows.map((row) => ({
        attendance_id: row.attendance_id != null ? Number(row.attendance_id) : null,
        status: row.status || null,
        notes: row.notes || null,
        marked_at: row.marked_at || null,
        marked_by_name: row.marked_by_name || null,
        session: {
          classsession_id: Number(row.classsession_id),
          class_id: Number(row.class_id),
          phase_number: row.phase_number != null ? Number(row.phase_number) : null,
          phase_session_number:
            row.phase_session_number != null ? Number(row.phase_session_number) : null,
          scheduled_date: row.scheduled_date || null,
          scheduled_start_time: row.scheduled_start_time || null,
          scheduled_end_time: row.scheduled_end_time || null,
          session_status: row.session_status || null,
          class_code: row.class_code || null,
          topic: row.topic || null,
          goal: row.goal || null,
          agenda: row.agenda || null,
          class_name: row.class_name || null,
          level_tag: row.level_tag || null,
          program_name: row.program_name || null,
        },
      }));

      const statusCounts = {
        Present: 0,
        Absent: 0,
        Late: 0,
        Excused: 0,
        'Leave Early': 0,
      };
      let marked = 0;
      records.forEach((r) => {
        if (r.status) {
          marked += 1;
          if (Object.prototype.hasOwnProperty.call(statusCounts, r.status)) {
            statusCounts[r.status] += 1;
          }
        }
      });

      res.json({
        success: true,
        data: {
          student_id: studentIdInt,
          summary: {
            total_sessions: records.length,
            marked,
            not_marked: Math.max(0, records.length - marked),
            ...statusCounts,
          },
          records,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/attendance/class/:classId/phase/:phaseNumber/summary
 * Attendance matrix for students enrolled in a class phase.
 * Access: All authenticated users with branch access.
 */
router.get(
  '/class/:classId/phase/:phaseNumber/summary',
  [
    param('classId').isInt().withMessage('Class ID must be an integer'),
    param('phaseNumber').isInt().withMessage('Phase number must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { classId, phaseNumber } = req.params;
      const isSuperadmin = req.user.userType === 'Superadmin';
      const userBranchId =
        req.user.branchId != null ? Number(req.user.branchId) : null;

      const result = await getPhaseAttendanceSummary(classId, phaseNumber, {
        isSuperadmin,
        userBranchId,
      });

      if (result.notFound) {
        return res.status(404).json({
          success: false,
          message: 'Class not found',
        });
      }

      if (result.forbidden) {
        return res.status(403).json({
          success: false,
          message: 'Access denied for this class branch.',
        });
      }

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/v1/attendance/:attendanceId
 * Update a specific attendance record
 * Access: Admin, Teacher
 */
router.put(
  '/:attendanceId',
  [
    param('attendanceId').isInt().withMessage('Attendance ID must be an integer'),
    body('status').isIn(['Present', 'Absent', 'Late', 'Excused']).withMessage('Status must be Present, Absent, Late, or Excused'),
    body('notes').optional().trim(),
    handleValidationErrors,
  ],
  requireRole('Admin', 'Teacher'),
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

