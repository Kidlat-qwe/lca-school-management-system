import express from 'express';
import { body, param, query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole, requireBranchAccess } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query, getClient } from '../config/database.js';
import { generateClassCode } from '../utils/classCodeGenerator.js';
import { sendSuspensionEmail } from '../utils/emailService.js';

const router = express.Router();

// All routes require authentication
router.use(verifyFirebaseToken);
router.use(requireBranchAccess);

// Valid suspension reasons
const VALID_REASONS = ['Typhoon', 'Earthquake', 'Flood', 'Holiday', 'Government Mandate', 'Other'];

/**
 * GET /api/sms/suspensions
 * Get all suspension periods with optional filters
 * Access: Superadmin, Admin
 */
router.get(
  '/',
  [
    queryValidator('branch_id').optional().isInt().withMessage('Branch ID must be an integer'),
    queryValidator('status').optional().isString().withMessage('Status must be a string'),
    queryValidator('class_id').optional().isInt().withMessage('Class ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { branch_id, status, class_id } = req.query;

      let sql = `
        SELECT 
          s.suspension_id,
          s.suspension_name,
          s.branch_id,
          s.start_date,
          s.end_date,
          s.reason,
          s.description,
          s.status,
          s.affected_class_ids,
          s.auto_reschedule,
          s.created_by,
          s.created_at,
          s.updated_at,
          b.branch_name,
          u.full_name as created_by_name,
          (
            SELECT COUNT(*)
            FROM classsessionstbl cs
            WHERE cs.suspension_id = s.suspension_id
          ) as affected_sessions_count
        FROM suspensionperiodstbl s
        LEFT JOIN branchestbl b ON s.branch_id = b.branch_id
        LEFT JOIN userstbl u ON s.created_by = u.user_id
        WHERE 1=1
      `;
      const params = [];
      let paramCount = 0;

      // Filter by branch for non-superadmin users
      if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        paramCount++;
        sql += ` AND (s.branch_id = $${paramCount} OR s.branch_id IS NULL)`;
        params.push(req.user.branchId);
      } else if (branch_id) {
        paramCount++;
        sql += ` AND (s.branch_id = $${paramCount} OR s.branch_id IS NULL)`;
        params.push(parseInt(branch_id));
      }

      // Filter by status
      if (status) {
        paramCount++;
        sql += ` AND s.status = $${paramCount}`;
        params.push(status);
      }

      // Filter by class_id (if suspension affects this class)
      if (class_id) {
        paramCount++;
        sql += ` AND (s.affected_class_ids IS NULL OR $${paramCount} = ANY(s.affected_class_ids))`;
        params.push(parseInt(class_id));
      }

      sql += ` ORDER BY s.start_date DESC, s.created_at DESC`;

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
 * GET /api/sms/suspensions/:id
 * Get a single suspension period by ID
 * Access: Superadmin, Admin
 */
router.get(
  '/:id',
  [
    param('id').isInt().withMessage('Suspension ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const result = await query(
        `
        SELECT 
          s.suspension_id,
          s.suspension_name,
          s.branch_id,
          s.start_date,
          s.end_date,
          s.reason,
          s.description,
          s.status,
          s.affected_class_ids,
          s.auto_reschedule,
          s.created_by,
          s.created_at,
          s.updated_at,
          b.branch_name,
          u.full_name as created_by_name
        FROM suspensionperiodstbl s
        LEFT JOIN branchestbl b ON s.branch_id = b.branch_id
        LEFT JOIN userstbl u ON s.created_by = u.user_id
        WHERE s.suspension_id = $1
        `,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Suspension period not found',
        });
      }

      res.json({
        success: true,
        data: result.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/sms/suspensions
 * Create a new suspension period and cancel affected sessions
 * Access: Superadmin, Admin
 */
router.post(
  '/',
  [
    body('suspension_name').notEmpty().trim().withMessage('Suspension name is required'),
    body('branch_id').optional().custom((value) => {
      if (value === null || value === undefined || value === '') return true;
      const num = parseInt(value);
      return !isNaN(num) && num > 0;
    }).withMessage('Branch ID must be a positive integer or null for all branches'),
    body('start_date').isISO8601().withMessage('Start date must be a valid date'),
    body('end_date').isISO8601().withMessage('End date must be a valid date'),
    body('reason').isIn(VALID_REASONS).withMessage(`Reason must be one of: ${VALID_REASONS.join(', ')}`),
    body('description').optional().trim(),
    body('affected_class_ids').optional().isArray().withMessage('Affected class IDs must be an array'),
    body('affected_class_ids.*').optional().isInt().withMessage('Each class ID must be an integer'),
    body('auto_reschedule').optional().isBoolean().withMessage('Auto reschedule must be a boolean'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    console.log('\n🚀 POST /api/sms/suspensions - Creating suspension...');
    console.log('📦 Request body:', JSON.stringify(req.body, null, 2));
    
    const client = await getClient();
    try {
      await client.query('BEGIN');
      console.log('✅ Transaction started');

      const {
        suspension_name,
        branch_id,
        start_date,
        end_date,
        reason,
        description,
        affected_class_ids,
        auto_reschedule = true,
      } = req.body;
      
      console.log(`📝 Suspension details: name="${suspension_name}", dates=${start_date} to ${end_date}, auto_reschedule=${auto_reschedule}`);

      // Validate date range
      if (new Date(start_date) > new Date(end_date)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Start date cannot be after end date',
        });
      }

      // For non-superadmin, enforce branch restriction
      let finalBranchId = branch_id ? parseInt(branch_id) : null;
      if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        finalBranchId = req.user.branchId;
      }

      const createdByUserId = req.user.userId || req.user.user_id;
      if (!createdByUserId) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'User ID not found. Please ensure you are properly authenticated.',
        });
      }

      // Create suspension period
      const suspensionResult = await client.query(
        `
        INSERT INTO suspensionperiodstbl (
          suspension_name, branch_id, start_date, end_date, reason, 
          description, status, affected_class_ids, auto_reschedule, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
        `,
        [
          suspension_name.trim(),
          finalBranchId,
          start_date,
          end_date,
          reason,
          description?.trim() || null,
          'Active',
          affected_class_ids && affected_class_ids.length > 0 ? affected_class_ids : null,
          auto_reschedule,
          createdByUserId,
        ]
      );

      const suspension = suspensionResult.rows[0];
      console.log(`✅ Suspension record created with ID: ${suspension.suspension_id}`);

      // Find and cancel affected sessions
      console.log(`🔍 Searching for affected sessions...`);
      let sessionSql = `
        SELECT cs.classsession_id, cs.class_id, cs.scheduled_date, cs.phase_number, c.end_date
        FROM classsessionstbl cs
        JOIN classestbl c ON cs.class_id = c.class_id
        WHERE cs.scheduled_date >= $1 
          AND cs.scheduled_date <= $2
          AND cs.status = 'Scheduled'
      `;
      const sessionParams = [start_date, end_date];
      let paramCount = 2;

      // Filter by branch
      if (finalBranchId) {
        paramCount++;
        sessionSql += ` AND c.branch_id = $${paramCount}`;
        sessionParams.push(finalBranchId);
      }

      // Filter by specific classes
      if (affected_class_ids && affected_class_ids.length > 0) {
        paramCount++;
        sessionSql += ` AND c.class_id = ANY($${paramCount}::int[])`;
        sessionParams.push(affected_class_ids);
      }

      const affectedSessionsResult = await client.query(sessionSql, sessionParams);
      const affectedSessions = affectedSessionsResult.rows;
      console.log(`📊 Found ${affectedSessions.length} affected session(s)`);

      // Handle session cancellation and rescheduling
      if (affectedSessions.length > 0) {
        console.log(`🔄 Processing ${affectedSessions.length} affected session(s)...`);
        const sessionIds = affectedSessions.map(s => s.classsession_id).filter(id => id != null);
        
        // Always mark affected sessions as Cancelled (visible, grayed out)
        if (sessionIds.length > 0) {
          await client.query(
            `UPDATE classsessionstbl
             SET status = 'Cancelled',
                 suspension_id = $1,
                 notes = COALESCE(notes || E'\n', '') || $2,
                 updated_at = CURRENT_TIMESTAMP
             WHERE classsession_id = ANY($3::int[])`,
            [
              suspension.suspension_id,
              `Cancelled due to: ${suspension_name} (${reason})`,
              sessionIds,
            ]
          );
        }

        // If auto_reschedule is enabled, add make-up sessions at the end (no shifting)
        if (auto_reschedule) {
          console.log('🔄 Starting auto-reschedule process...');
          // Group sessions by class_id
          const classSessions = {};
          affectedSessions.forEach(session => {
            if (!classSessions[session.class_id]) {
              classSessions[session.class_id] = {
                sessions: [],
                end_date: session.end_date,
              };
            }
            classSessions[session.class_id].sessions.push(session);
          });

          console.log(`📊 Processing ${Object.keys(classSessions).length} class(es) for rescheduling`);

          for (const [classId, data] of Object.entries(classSessions)) {
            const classIdInt = parseInt(classId);
            const cancelledSessionsCount = data.sessions.length;

            console.log(`\n🔍 Processing class ${classIdInt} with ${cancelledSessionsCount} cancelled session(s)`);

            if (isNaN(classIdInt) || cancelledSessionsCount === 0) {
              console.log(`⏭️ Skipping class ${classIdInt} (invalid ID or no cancelled sessions)`);
              continue;
            }

            // Fetch class info
            console.log(`📝 Fetching class info for class ${classIdInt}...`);
            const classInfoResult = await client.query(
              `SELECT c.teacher_id, c.end_date, c.class_name, p.program_code 
               FROM classestbl c
               LEFT JOIN programstbl p ON c.program_id = p.program_id
               WHERE c.class_id = $1`,
              [classIdInt]
            );
            const classInfo = classInfoResult.rows[0] || {};
            console.log(`✅ Class info fetched: teacher=${classInfo.teacher_id}, end_date=${classInfo.end_date}, class_name=${classInfo.class_name}, program_code=${classInfo.program_code}`);

            // Fetch schedule (days of week and times)
            console.log(`📅 Fetching schedule for class ${classIdInt}...`);
            const scheduleResult = await client.query(
              `SELECT day_of_week, start_time, end_time 
               FROM roomschedtbl 
               WHERE class_id = $1 
               ORDER BY day_of_week`,
              [classIdInt]
            );
            const scheduleRows = scheduleResult.rows || [];
            console.log(`✅ Schedule fetched: ${scheduleRows.length} day(s) - ${scheduleRows.map(r => r.day_of_week).join(', ')}`);

            // Day mappings
            const dayNameToNumber = {
              Sunday: 0,
              Monday: 1,
              Tuesday: 2,
              Wednesday: 3,
              Thursday: 4,
              Friday: 5,
              Saturday: 6,
            };
            const dayNumberToName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

            const classDayNumbers = scheduleRows
              .map(row => dayNameToNumber[row.day_of_week])
              .filter(num => num !== undefined);

            if (classDayNumbers.length === 0) {
              console.warn(`Class ${classIdInt} has no schedule days; skipping make-up creation.`);
              continue;
            }

            // Fetch all existing sessions for ordering
            const existingSessionsResult = await client.query(
              `SELECT classsession_id, scheduled_date, scheduled_start_time, scheduled_end_time, status, phase_number, phase_session_number
               FROM classsessionstbl
               WHERE class_id = $1
               ORDER BY scheduled_date ASC, phase_number ASC, phase_session_number ASC`,
              [classIdInt]
            );
            const existingSessions = existingSessionsResult.rows || [];
            if (existingSessions.length === 0) continue;

            const maxPhaseNumber = Math.max(...existingSessions.map(s => s.phase_number).filter(n => n != null));
            const maxPhaseSessions = existingSessions
              .filter(s => s.phase_number === maxPhaseNumber)
              .map(s => s.phase_session_number);
            const maxPhaseSessionNumber = maxPhaseSessions.length > 0 ? Math.max(...maxPhaseSessions) : 0;

            // Use noon time to avoid timezone shifts
            // Convert scheduled_date to proper YYYY-MM-DD format first
            // IMPORTANT: Filter out ONLY cancelled sessions to find the ACTUAL last active session
            // Include: Scheduled, Completed, In Progress, AND Rescheduled (since rescheduled sessions are active)
            let activeAndScheduledSessions = existingSessions.filter(s => 
              s.status === 'Scheduled' || 
              s.status === 'Completed' || 
              s.status === 'In Progress' ||
              s.status === 'Rescheduled'
            );
            
            if (activeAndScheduledSessions.length === 0) {
              console.warn(`⚠️ No active sessions found for class ${classIdInt}, using all sessions`);
              // Fallback to all sessions if no active ones
              activeAndScheduledSessions = existingSessions;
            }
            
            // Debug: Log all active sessions
            console.log(`   📋 Active sessions (${activeAndScheduledSessions.length}):`);
            activeAndScheduledSessions.forEach((s, idx) => {
              const dateStr = s.scheduled_date instanceof Date 
                ? s.scheduled_date.toISOString().split('T')[0]
                : (typeof s.scheduled_date === 'string' ? s.scheduled_date.split('T')[0] : String(s.scheduled_date));
              console.log(`      ${idx + 1}. Phase ${s.phase_number} Session ${s.phase_session_number}: ${dateStr} (${s.status})`);
            });
            
            // Find the session with the MAXIMUM date (most recent)
            // Convert all dates to comparable format and find the max
            let maxDate = null;
            let lastActiveSession = null;
            
            for (const session of activeAndScheduledSessions) {
              let sessionDate;
              if (session.scheduled_date instanceof Date) {
                sessionDate = session.scheduled_date;
              } else if (typeof session.scheduled_date === 'string') {
                sessionDate = new Date(session.scheduled_date);
              } else {
                sessionDate = new Date(session.scheduled_date);
              }
              
              if (isNaN(sessionDate.getTime())) {
                console.warn(`   ⚠️ Invalid date for session ${session.classsession_id}: ${session.scheduled_date}`);
                continue;
              }
              
              if (!maxDate || sessionDate > maxDate) {
                maxDate = sessionDate;
                lastActiveSession = session;
              }
            }
            
            if (!lastActiveSession || !maxDate) {
              console.error(`❌ Could not find valid last active session for class ${classIdInt}`);
              continue;
            }
            // Use the maxDate we found (already a Date object)
            const lastSessionDateStr = maxDate.toISOString().split('T')[0];
            
            console.log(`   ✅ Last active session: Phase ${lastActiveSession.phase_number}, Session ${lastActiveSession.phase_session_number}, Date: ${lastSessionDateStr} (total active: ${activeAndScheduledSessions.length}, total all: ${existingSessions.length})`);
            
            // Create date at noon to avoid timezone issues
            let lastDate = new Date(maxDate);
            lastDate.setHours(12, 0, 0, 0);
            
            // Validate the date
            if (isNaN(lastDate.getTime())) {
              console.error(`❌ Invalid date created from: ${maxDate}`);
              continue;
            }
            let nextSessionNumber = maxPhaseSessionNumber + 1;
            let makeupDates = [];

            // Helper: get next class day after a given date
            const getNextClassDay = (fromDate) => {
              const nextDate = new Date(fromDate);
              while (true) {
                nextDate.setDate(nextDate.getDate() + 1);
                if (classDayNumbers.includes(nextDate.getDay())) {
                  return new Date(nextDate);
                }
              }
            };

            // Build make-up dates equal to cancelled sessions
            console.log(`📆 Calculating ${cancelledSessionsCount} make-up date(s) starting from ${lastDate.toISOString().split('T')[0]}...`);
            console.log(`   Class days: ${classDayNumbers.join(', ')} (${classDayNumbers.map(n => dayNumberToName[n]).join(', ')})`);
            for (let i = 0; i < cancelledSessionsCount; i++) {
              const beforeDate = lastDate.toISOString().split('T')[0];
              lastDate = getNextClassDay(lastDate);
              const afterDate = lastDate.toISOString().split('T')[0];
              makeupDates.push(new Date(lastDate));
              console.log(`  ➡️ Make-up date ${i + 1}: ${beforeDate} → ${afterDate} (${dayNumberToName[lastDate.getDay()]})`);
            }

            console.log(`💾 Inserting ${makeupDates.length} make-up session(s)...`);
            // Insert make-up sessions at the end of the last phase
            for (const makeupDate of makeupDates) {
              const dayName = dayNumberToName[makeupDate.getDay()];
              const daySchedule = scheduleRows.find(r => r.day_of_week === dayName) || {};

              const newDateStr = makeupDate.toISOString().split('T')[0];
              console.log(`   📝 Inserting make-up session: Phase ${maxPhaseNumber}, Session ${nextSessionNumber}, Date: ${newDateStr} (${dayName})`);
              const startTime = daySchedule.start_time || existingSessions[existingSessions.length - 1].scheduled_start_time;
              const endTime = daySchedule.end_time || existingSessions[existingSessions.length - 1].scheduled_end_time;

              // Generate class code for the makeup session
              const classCode = generateClassCode(
                classInfo.program_code,
                newDateStr,
                startTime,
                classInfo.class_name
              );
              console.log(`   🔖 Generated class code: ${classCode}`);

              await client.query(
                `INSERT INTO classsessionstbl (
                  class_id, phasesessiondetail_id, phase_number, phase_session_number,
                  scheduled_date, scheduled_start_time, scheduled_end_time,
                  original_teacher_id, assigned_teacher_id, status, created_by, suspension_id, notes, class_code
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
                [
                  classIdInt,
                  null, // No specific phase session detail; treat as make-up
                  maxPhaseNumber,
                  nextSessionNumber,
                  newDateStr,
                  startTime,
                  endTime,
                  classInfo.teacher_id || null,
                  classInfo.teacher_id || null,
                  'Rescheduled',
                  createdByUserId,
                  suspension.suspension_id,
                  `Make-up session due to suspension: ${suspension_name} (${reason})`,
                  classCode,
                ]
              );

              nextSessionNumber++;
              lastDate = makeupDate;
            }

            console.log(`✅ ${makeupDates.length} make-up session(s) inserted successfully`);

            // Update end_date to the last make-up date
            if (makeupDates.length > 0) {
              const finalDateStr = makeupDates[makeupDates.length - 1].toISOString().split('T')[0];
              console.log(`📅 Updating class end_date to ${finalDateStr}...`);
              await client.query(
                `UPDATE classestbl SET end_date = $1 WHERE class_id = $2`,
                [finalDateStr, classIdInt]
              );
              console.log(`✅ Class end_date updated successfully`);
            }
          }
          console.log(`\n✨ Auto-reschedule process completed for all classes`);
        }
      }

      // Send notifications to enrolled students
      console.log(`📢 Creating notifications for enrolled students...`);
      try {
        // Get all unique affected class IDs
        let affectedClassIds = [];
        if (affected_class_ids && affected_class_ids.length > 0) {
          affectedClassIds = [...new Set(affected_class_ids)];
        } else if (affectedSessions.length > 0) {
          // Extract unique class IDs from affected sessions
          const uniqueClassIds = [...new Set(affectedSessions.map(s => s.class_id).filter(Boolean))];
          affectedClassIds = uniqueClassIds;
        }

        if (affectedClassIds.length > 0) {
          console.log(`📋 Found ${affectedClassIds.length} affected class(es): ${affectedClassIds.join(', ')}`);

          // Get class names for the announcement
          const classNamesResult = await client.query(
            `SELECT class_id, class_name, branch_id 
             FROM classestbl 
             WHERE class_id = ANY($1::int[])`,
            [affectedClassIds]
          );
          const classNames = classNamesResult.rows.map(c => c.class_name).filter(Boolean);
          const classNamesText = classNames.length > 0 
            ? (classNames.length === 1 ? classNames[0] : `${classNames.length} classes`)
            : 'your class';

          // Format dates for display
          const startDateFormatted = new Date(start_date).toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          });
          const endDateFormatted = new Date(end_date).toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          });

          // Build announcement body
          let announcementBody = `Your class ${classNamesText} has been suspended due to: ${suspension_name}`;
          announcementBody += `\n\nReason: ${reason}`;
          announcementBody += `\nPeriod: ${startDateFormatted} to ${endDateFormatted}`;
          if (description) {
            announcementBody += `\n\nAdditional Information:\n${description}`;
          }
          if (auto_reschedule) {
            announcementBody += `\n\nNote: Affected sessions will be automatically rescheduled.`;
          }

          // Create announcement for each affected class's branch
          // Group classes by branch_id to create branch-specific announcements
          const branchClassMap = {};
          classNamesResult.rows.forEach(classRow => {
            const branchId = classRow.branch_id || finalBranchId;
            if (!branchClassMap[branchId]) {
              branchClassMap[branchId] = [];
            }
            branchClassMap[branchId].push(classRow.class_id);
          });

          // Create announcements per branch
          for (const [branchId, classIds] of Object.entries(branchClassMap)) {
            // Get phase numbers from affected sessions for these classes
            const affectedPhasesForClasses = affectedSessions
              .filter(s => classIds.includes(s.class_id) && s.phase_number != null)
              .map(s => parseInt(s.phase_number)) // Ensure integer
              .filter(phase => !isNaN(phase)); // Filter out invalid numbers
            
            const uniqueAffectedPhases = [...new Set(affectedPhasesForClasses)].sort((a, b) => a - b);
            
            if (uniqueAffectedPhases.length > 0) {
              console.log(`📊 Affected phases for classes ${classIds.join(', ')}: ${uniqueAffectedPhases.join(', ')}`);
            } else {
              console.log(`⚠️ No phase numbers found in affected sessions for classes ${classIds.join(', ')}, notifying all enrolled students`);
            }

            // Get enrolled students for these classes, filtered by affected phases
            let enrolledStudentsQuery = `
              SELECT DISTINCT cs.student_id 
              FROM classstudentstbl cs
              WHERE cs.class_id = ANY($1::int[])
            `;
            const queryParams = [classIds];

            // Only filter by phase if we have specific affected phases
            // If no phases are found in affected sessions, notify all enrolled students as fallback
            if (uniqueAffectedPhases.length > 0) {
              queryParams.push(uniqueAffectedPhases);
              enrolledStudentsQuery += ` AND cs.phase_number = ANY($2::int[])`;
              console.log(`🔍 Filtering students by phases: ${uniqueAffectedPhases.join(', ')}`);
            } else {
              console.log(`🔍 No phase filter applied - notifying all enrolled students in these classes`);
            }

            const enrolledStudentsResult = await client.query(
              enrolledStudentsQuery,
              queryParams
            );

            const enrolledStudentIds = enrolledStudentsResult.rows.map(r => r.student_id).filter(Boolean);
            const phaseInfo = uniqueAffectedPhases.length > 0 
              ? `in affected phases (${uniqueAffectedPhases.join(', ')})` 
              : 'in all phases (fallback)';
            console.log(`👥 Found ${enrolledStudentIds.length} enrolled student(s) ${phaseInfo} for branch ${branchId || 'all'}`);

            if (enrolledStudentIds.length > 0) {
              // Create announcement notification
              // Note: user_type is 'Student' (singular), not 'Students' (plural)
              // Set end_date to 30 days after suspension ends so notification remains visible
              const notificationEndDate = new Date(end_date);
              notificationEndDate.setDate(notificationEndDate.getDate() + 30);
              
              // Use the class's branch_id to ensure students in that branch see the notification
              // If branchId is null, set to null so all students see it (though this shouldn't happen for class-specific suspensions)
              const announcementBranchId = branchId ? parseInt(branchId) : null;
              
              // Set start_date to today (or NULL) so notification is visible immediately
              // Notifications should appear as soon as suspension is created, not wait until suspension starts
              const notificationStartDate = null; // NULL means visible immediately
              
              console.log(`📢 Creating suspension announcement:`, {
                title: `Class Suspension: ${suspension_name}`,
                recipient_groups: ['Students'],
                branch_id: announcementBranchId,
                start_date: notificationStartDate, // NULL = visible immediately
                end_date: notificationEndDate.toISOString().split('T')[0],
                enrolled_students_count: enrolledStudentIds.length
              });
              
              const announcementResult = await client.query(
                `INSERT INTO announcementstbl (
                  title, body, recipient_groups, status, priority, branch_id, created_by, start_date, end_date
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING announcement_id`,
                [
                  `Class Suspension: ${suspension_name}`,
                  announcementBody,
                  ['Students'], // Recipient group - use 'Students' (plural) to match recipient_groups format
                  'Active',
                  'High', // High priority for suspensions
                  announcementBranchId,
                  createdByUserId,
                  notificationStartDate, // NULL = visible immediately in notifications
                  notificationEndDate.toISOString().split('T')[0], // End date: 30 days after suspension ends
                ]
              );

              console.log(`✅ Notification created (announcement_id: ${announcementResult.rows[0].announcement_id}) for ${enrolledStudentIds.length} student(s) in branch ${announcementBranchId || 'all'}`);

              // Send email notifications to enrolled students
              try {
                console.log(`📧 Preparing to send suspension emails to enrolled students...`);
                
                // Get student details with email addresses (only enrolled in affected phases)
                let studentsQuery = `
                  SELECT DISTINCT 
                    u.user_id,
                    u.full_name,
                    u.email,
                    c.class_name
                  FROM classstudentstbl cs
                  INNER JOIN userstbl u ON cs.student_id = u.user_id
                  INNER JOIN classestbl c ON cs.class_id = c.class_id
                  WHERE cs.class_id = ANY($1::int[])
                    AND u.email IS NOT NULL
                    AND u.email != ''
                `;
                const studentsQueryParams = [classIds];

                // Filter by phase if we have specific affected phases
                if (uniqueAffectedPhases.length > 0) {
                  studentsQueryParams.push(uniqueAffectedPhases);
                  studentsQuery += ` AND cs.phase_number = ANY($2::int[])`;
                }

                const studentsResult = await client.query(studentsQuery, studentsQueryParams);
                const studentsToEmail = studentsResult.rows;

                if (studentsToEmail.length > 0) {
                  console.log(`📧 Sending suspension emails to ${studentsToEmail.length} enrolled student(s)...`);

                  // Format dates for email
                  const startDateFormatted = new Date(start_date).toLocaleDateString('en-US', { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  });
                  const endDateFormatted = new Date(end_date).toLocaleDateString('en-US', { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  });

                  // Send emails asynchronously (don't block)
                  const emailPromises = studentsToEmail.map(async (student) => {
                    try {
                      await sendSuspensionEmail({
                        to: student.email,
                        studentName: student.full_name,
                        className: student.class_name,
                        suspensionName: suspension_name,
                        reason: reason,
                        startDate: startDateFormatted,
                        endDate: endDateFormatted,
                        description: description || null,
                        autoReschedule: auto_reschedule,
                      });
                      return { success: true, email: student.email, studentName: student.full_name };
                    } catch (emailError) {
                      console.error(`❌ Failed to send email to ${student.email} (${student.full_name}):`, emailError.message);
                      return { success: false, email: student.email, studentName: student.full_name, error: emailError.message };
                    }
                  });

                  // Wait for all emails to be sent (or fail)
                  const emailResults = await Promise.allSettled(emailPromises);
                  
                  const successful = emailResults.filter(r => r.status === 'fulfilled' && r.value.success).length;
                  const failed = emailResults.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)).length;

                  console.log(`📧 Email sending completed: ${successful} successful, ${failed} failed`);

                  if (failed > 0) {
                    const failedEmails = emailResults
                      .filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success))
                      .map(r => r.status === 'fulfilled' ? r.value.email : 'unknown');
                    console.log(`⚠️ Failed to send emails to: ${failedEmails.join(', ')}`);
                  }
                } else {
                  console.log(`ℹ️ No students with valid email addresses found for email notifications`);
                }
              } catch (emailError) {
                // Log error but don't fail the suspension creation
                console.error('⚠️ Error sending suspension emails:', emailError);
                console.error('Suspension was created successfully, but email sending failed');
              }
            } else {
              console.log(`⚠️ No enrolled students found for classes ${classIds.join(', ')}, skipping notification`);
            }
          }
        } else {
          console.log(`ℹ️ No affected classes found, skipping notification creation`);
        }
      } catch (notificationError) {
        // Log error but don't fail the suspension creation
        console.error('⚠️ Error creating notifications:', notificationError);
        console.error('Suspension was created successfully, but notifications failed');
      }

      console.log(`🎉 Committing transaction...`);
      await client.query('COMMIT');
      console.log(`✅ Suspension created successfully!`);

      res.status(201).json({
        success: true,
        message: 'Suspension period created successfully',
        data: {
          suspension: suspension,
          affected_sessions_count: affectedSessions.length,
          auto_rescheduled: auto_reschedule,
        },
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error creating suspension period:', error);
      console.error('Error details:', {
        message: error.message,
        code: error.code,
        detail: error.detail,
        stack: error.stack
      });
      next(error);
    } finally {
      client.release();
    }
  }
);

/**
 * PUT /api/sms/suspensions/:id
 * Update suspension period status (mainly for cancelling)
 * Access: Superadmin, Admin
 */
router.put(
  '/:id',
  [
    param('id').isInt().withMessage('Suspension ID must be an integer'),
    body('status').isIn(['Active', 'Cancelled']).withMessage('Status must be Active or Cancelled'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { id } = req.params;
      const { status } = req.body;

      // Check if suspension exists
      const existing = await client.query(
        'SELECT * FROM suspensionperiodstbl WHERE suspension_id = $1',
        [id]
      );

      if (existing.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Suspension period not found',
        });
      }

      const suspension = existing.rows[0];

      // Check branch access for non-superadmin users
      if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        if (suspension.branch_id && suspension.branch_id !== req.user.branchId) {
          await client.query('ROLLBACK');
          return res.status(403).json({
            success: false,
            message: 'Access denied. You can only modify suspensions for your branch.',
          });
        }
      }

      // Update suspension status
      const result = await client.query(
        `
        UPDATE suspensionperiodstbl
        SET status = $1, updated_at = CURRENT_TIMESTAMP
        WHERE suspension_id = $2
        RETURNING *
        `,
        [status, id]
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Suspension period updated successfully',
        data: result.rows[0],
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
 * DELETE /api/sms/suspensions/:id
 * Delete a suspension period (and revert affected sessions if needed)
 * Access: Superadmin, Admin
 */
router.delete(
  '/:id',
  [
    param('id').isInt().withMessage('Suspension ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { id } = req.params;

      // Check if suspension exists
      const existing = await client.query(
        'SELECT * FROM suspensionperiodstbl WHERE suspension_id = $1',
        [id]
      );

      if (existing.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Suspension period not found',
        });
      }

      const suspension = existing.rows[0];

      // Check branch access for non-superadmin users
      if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        if (suspension.branch_id && suspension.branch_id !== req.user.branchId) {
          await client.query('ROLLBACK');
          return res.status(403).json({
            success: false,
            message: 'Access denied. You can only delete suspensions for your branch.',
          });
        }
      }

      // Optionally revert affected sessions (set back to Scheduled)
      // Note: This doesn't revert the extended end dates
      await client.query(
        `
        UPDATE classsessionstbl
        SET status = 'Scheduled',
            suspension_id = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE suspension_id = $1 AND status = 'Cancelled'
        `,
        [id]
      );

      // Delete suspension
      await client.query(
        'DELETE FROM suspensionperiodstbl WHERE suspension_id = $1',
        [id]
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Suspension period deleted successfully',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally {
      client.release();
    }
  }
);

export default router;

