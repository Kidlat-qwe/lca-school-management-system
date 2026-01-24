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
 * GET /api/sms/students
 * Get list of students (optionally filtered by branch and search term)
 * Access: Superadmin, Admin
 */
router.get(
  '/',
  requireRole('Superadmin', 'Admin'),
  [
    queryValidator('search').optional().isString().withMessage('Search must be a string'),
    queryValidator('limit')
      .optional()
      .isInt({ min: 1, max: 1000 })
      .withMessage('Limit must be between 1 and 1000'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { search, limit = 1000 } = req.query;

      let sql = `
        SELECT 
          user_id,
          full_name,
          email,
          phone_number,
          branch_id
        FROM userstbl
        WHERE user_type = 'Student'`;
      const params = [];
      let paramCount = 0;

      // For non-superadmin users, restrict to their branch
      if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        paramCount += 1;
        sql += ` AND branch_id = $${paramCount}`;
        params.push(req.user.branchId);
      }

      if (search && search.trim() !== '') {
        paramCount += 1;
        sql += ` AND (LOWER(full_name) LIKE $${paramCount} OR LOWER(email) LIKE $${paramCount})`;
        params.push(`%${search.toLowerCase()}%`);
      }

      paramCount += 1;
      sql += ` ORDER BY full_name ASC NULLS LAST LIMIT $${paramCount}`;
      params.push(parseInt(limit, 10));

      const result = await query(sql, params);

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
 * POST /api/v1/students/enroll
 * Enroll a student in a class
 * Access: Superadmin, Admin
 */
router.post(
  '/enroll',
  [
    body('student_id').isInt().withMessage('Student ID is required'),
    body('class_id').isInt().withMessage('Class ID is required'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { student_id, class_id } = req.body;

      // Verify student exists and is a student
      const studentCheck = await client.query(
        'SELECT user_id, user_type, level_tag, branch_id FROM userstbl WHERE user_id = $1',
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

      // Verify class exists and get class details including phase, start date, level_tag, and branch_id
      const classCheck = await client.query(
        `SELECT c.class_id, c.max_students, c.start_date, c.phase_number, c.level_tag, c.branch_id,
                p.curriculum_id, cu.number_of_phase, cu.number_of_session_per_phase
         FROM classestbl c
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
      
      // Determine enrollment phase based on class status
      // Logic: If class hasn't started (start_date > today), enroll in Phase 1
      //        If class is ongoing (start_date <= today), enroll in current phase
      let enrollmentPhase = 1; // Default to Phase 1
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Reset time to start of day for comparison
      
      console.log('📅 Enrollment phase calculation:', {
        class_id: class_id,
        start_date: classData.start_date,
        class_phase_number: classData.phase_number,
        today: today.toISOString().split('T')[0],
        number_of_phase: classData.number_of_phase
      });
      
      if (classData.start_date) {
        // PostgreSQL returns dates as strings in 'YYYY-MM-DD' format
        const startDateStr = classData.start_date;
        const startDate = new Date(startDateStr);
        startDate.setHours(0, 0, 0, 0);
        
        console.log('📆 Date comparison:', {
          start_date_str: startDateStr,
          start_date_parsed: startDate.toISOString().split('T')[0],
          today_str: today.toISOString().split('T')[0],
          startDate_greater: startDate > today
        });
        
        if (startDate > today) {
          // Class hasn't started yet - enroll in Phase 1
          enrollmentPhase = 1;
          console.log('✅ Class hasn\'t started - enrolling in Phase 1');
        } else {
          // Class is ongoing - enroll in current phase
          // Use class.phase_number if available, otherwise default to 1
          enrollmentPhase = classData.phase_number || 1;
          
          // Validate phase number doesn't exceed curriculum phases
          if (classData.number_of_phase && enrollmentPhase > classData.number_of_phase) {
            enrollmentPhase = classData.number_of_phase;
          }
          console.log('✅ Class is ongoing - enrolling in Phase', enrollmentPhase);
        }
      } else if (classData.phase_number) {
        // If no start_date but phase_number exists, use it
        enrollmentPhase = classData.phase_number;
        console.log('✅ Using class phase_number:', enrollmentPhase);
      } else {
        console.log('✅ No start_date or phase_number - defaulting to Phase 1');
      }
      
      console.log('🎯 Final enrollment phase:', enrollmentPhase);

      // Check if class is full
      if (classData.max_students) {
        const enrollmentCount = await client.query(
          'SELECT COUNT(*) FROM classstudentstbl WHERE class_id = $1',
          [class_id]
        );
        const currentCount = parseInt(enrollmentCount.rows[0].count);
        if (currentCount >= classData.max_students) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: 'Class is full',
          });
        }
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

      // Enroll student with automatically determined phase
      console.log('💾 Inserting enrollment with phase_number:', enrollmentPhase);
      const result = await client.query(
        `INSERT INTO classstudentstbl (student_id, class_id, enrolled_by, phase_number)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [student_id, class_id, req.user.fullName || req.user.email, enrollmentPhase]
      );
      
      console.log('✅ Enrollment created:', {
        classstudent_id: result.rows[0].classstudent_id,
        phase_number: result.rows[0].phase_number
      });

      await client.query('COMMIT');

      res.status(201).json({
        success: true,
        message: `Student enrolled successfully in Phase ${enrollmentPhase}`,
        data: {
          ...result.rows[0],
          enrollment_phase: enrollmentPhase,
        },
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
 * DELETE /api/v1/students/unenroll/:enrollmentId
 * Unenroll a student from a class
 * Access: Superadmin, Admin
 */
router.delete(
  '/unenroll/:enrollmentId',
  [
    param('enrollmentId').isInt().withMessage('Enrollment ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { enrollmentId } = req.params;

      const existingEnrollment = await query(
        'SELECT * FROM classstudentstbl WHERE classstudent_id = $1',
        [enrollmentId]
      );
      if (existingEnrollment.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Enrollment not found',
        });
      }

      await query('DELETE FROM classstudentstbl WHERE classstudent_id = $1', [enrollmentId]);

      res.json({
        success: true,
        message: 'Student unenrolled successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/students/class/:classId
 * Get all students enrolled in a class
 * Access: All authenticated users
 */
router.get(
  '/class/:classId',
  [
    param('classId').isInt().withMessage('Class ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { classId } = req.params;

      // Get enrolled students
      const enrolledResult = await query(
        `SELECT 
          cs.classstudent_id,
          cs.enrolled_at,
          cs.enrolled_by,
          cs.phase_number,
          u.user_id,
          u.full_name,
          u.email,
          u.phone_number,
          u.date_of_birth,
          u.gender,
          u.level_tag,
          u.profile_picture_url,
          'enrolled' as student_type
         FROM classstudentstbl cs
         INNER JOIN userstbl u ON cs.student_id = u.user_id
         WHERE cs.class_id = $1`,
        [classId]
      );

      // Get pending students (have installment profiles for this class but not enrolled yet)
      // These are students who have enrolled but haven't paid Phase 1 yet
      // They should appear in the modal but not be counted as enrolled
      // IMPORTANT: This query returns ALL pending students regardless of downpayment status
      // - Students with downpayment NOT paid: appear as "Pending Enrollment (Downpayment Not Paid)"
      // - Students with downpayment PAID: appear as "Pending Enrollment (Downpayment Paid)"
      // Both should remain visible until Phase 1 (first installment invoice) is paid
      const pendingResult = await query(
        `SELECT DISTINCT
          NULL as classstudent_id,
          NULL as enrolled_at,
          CASE 
            WHEN ip.downpayment_paid = true THEN 'Pending Enrollment (Downpayment Paid)'
            ELSE 'Pending Enrollment (Downpayment Not Paid)'
          END as enrolled_by,
          1 as phase_number, -- Default to Phase 1 for pending students
          u.user_id,
          u.full_name,
          u.email,
          u.phone_number,
          u.date_of_birth,
          u.gender,
          u.level_tag,
          u.profile_picture_url,
          'pending' as student_type
         FROM installmentinvoiceprofilestbl ip
         INNER JOIN userstbl u ON ip.student_id = u.user_id
         LEFT JOIN classstudentstbl cs ON ip.student_id = cs.student_id AND cs.class_id = $1
         WHERE ip.class_id = $1
           AND cs.classstudent_id IS NULL -- Not enrolled yet (Phase 1 not paid)
           AND ip.is_active = true
           -- Note: No filter on downpayment_paid - we want all pending students regardless of downpayment status`,
        [classId]
      );

      // Combine enrolled and pending students
      const allStudents = [
        ...enrolledResult.rows,
        ...pendingResult.rows
      ];

      // Sort by enrolled_at (enrolled students first, then pending)
      allStudents.sort((a, b) => {
        if (a.enrolled_at && b.enrolled_at) {
          return new Date(b.enrolled_at) - new Date(a.enrolled_at);
        }
        if (a.enrolled_at) return -1;
        if (b.enrolled_at) return 1;
        return 0;
      });

      res.json({
        success: true,
        data: allStudents,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/students/:studentId/classes
 * Get all classes a student is enrolled in
 * Access: All authenticated users (or own profile for students)
 */
router.get(
  '/:studentId/classes',
  [
    param('studentId').isInt().withMessage('Student ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { studentId } = req.params;

      // Check access permission
      if (req.user.userType === 'Student' && req.user.userId !== parseInt(studentId)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only view your own enrollments.',
        });
      }

      // Get all enrollments for the student
      const enrollmentsResult = await query(
        `SELECT 
          cs.classstudent_id,
          cs.enrolled_at,
          cs.enrolled_by,
          cs.phase_number,
          c.class_id,
          c.level_tag,
          c.class_name,
          c.max_students,
          TO_CHAR(c.start_date, 'YYYY-MM-DD') as start_date,
          TO_CHAR(c.end_date, 'YYYY-MM-DD') as end_date,
          p.program_id,
          p.program_name,
          p.program_code,
          r.room_name
         FROM classstudentstbl cs
         INNER JOIN classestbl c ON cs.class_id = c.class_id
         LEFT JOIN programstbl p ON c.program_id = p.program_id
         LEFT JOIN roomstbl r ON c.room_id = r.room_id
         WHERE cs.student_id = $1
         ORDER BY cs.enrolled_at DESC`,
        [studentId]
      );

      // Group by class_id to get unique classes with aggregated phase information
      const classesMap = new Map();
      enrollmentsResult.rows.forEach(row => {
        const classId = row.class_id;
        if (!classesMap.has(classId)) {
          classesMap.set(classId, {
            class_id: row.class_id,
            level_tag: row.level_tag,
            class_name: row.class_name,
            max_students: row.max_students,
            start_date: row.start_date || null,
            end_date: row.end_date || null,
            program_id: row.program_id,
            program_name: row.program_name,
            program_code: row.program_code,
            room_name: row.room_name,
            enrollments: [],
            phases: [],
            earliest_enrollment: row.enrolled_at,
            enrolled_by: row.enrolled_by,
          });
        }
        
        const classData = classesMap.get(classId);
        classData.enrollments.push({
          classstudent_id: row.classstudent_id,
          enrolled_at: row.enrolled_at,
          enrolled_by: row.enrolled_by,
          phase_number: row.phase_number,
        });
        
        // Add phase if not already in the array
        if (!classData.phases.includes(row.phase_number)) {
          classData.phases.push(row.phase_number);
        }
        
        // Update earliest enrollment date if this one is earlier
        if (new Date(row.enrolled_at) < new Date(classData.earliest_enrollment)) {
          classData.earliest_enrollment = row.enrolled_at;
          classData.enrolled_by = row.enrolled_by;
        }
      });

      // Convert map to array and sort by earliest enrollment date
      const uniqueClasses = Array.from(classesMap.values()).sort((a, b) => {
        return new Date(b.earliest_enrollment) - new Date(a.earliest_enrollment);
      });

      res.json({
        success: true,
        data: uniqueClasses,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;

