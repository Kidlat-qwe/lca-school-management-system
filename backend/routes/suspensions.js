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
 * Create a new suspension period with selected sessions and manual makeup schedules
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
    body('reason').isIn(VALID_REASONS).withMessage(`Reason must be one of: ${VALID_REASONS.join(', ')}`),
    body('description').optional().trim(),
    body('affected_class_ids').optional().isArray().withMessage('Affected class IDs must be an array'),
    body('affected_class_ids.*').optional().isInt().withMessage('Each class ID must be an integer'),
    body('selected_session_ids').isArray().withMessage('Selected session IDs must be an array'),
    body('selected_session_ids.*').isInt().withMessage('Each session ID must be an integer'),
    // Optional strategy: 'manual' (default), 'add-last-phase'
    body('makeup_strategy')
      .optional()
      .isIn(['manual', 'add-last-phase'])
      .withMessage('Invalid makeup strategy'),
    // For manual strategy we expect makeup_schedules; for automatic strategies it can be omitted.
    body('makeup_schedules')
      .optional({ nullable: true })
      .isArray()
      .withMessage('Makeup schedules must be an array when provided'),
    body('makeup_schedules.*.suspended_session_id')
      .optional()
      .isInt()
      .withMessage('Suspended session ID must be an integer'),
    body('makeup_schedules.*.makeup_date')
      .optional()
      .isISO8601()
      .withMessage('Makeup date must be a valid date'),
    body('makeup_schedules.*.makeup_start_time')
      .optional()
      .notEmpty()
      .withMessage('Makeup start time is required'),
    body('makeup_schedules.*.makeup_end_time')
      .optional()
      .notEmpty()
      .withMessage('Makeup end time is required'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    console.log('\n🚀 POST /api/sms/suspensions - Creating suspension with manual makeup schedules...');
    console.log('📦 Request body:', JSON.stringify(req.body, null, 2));
    
    const client = await getClient();
    try {
      await client.query('BEGIN');
      console.log('✅ Transaction started');

      const {
        suspension_name,
        branch_id,
        reason,
        description,
        affected_class_ids,
        selected_session_ids,
        makeup_schedules: rawMakeupSchedules,
        makeup_strategy,
      } = req.body;

      const makeupStrategy = makeup_strategy || 'manual'; // 'manual' | 'add-last-phase'
      let makeupSchedules = Array.isArray(rawMakeupSchedules) ? rawMakeupSchedules : [];
      
      console.log(`📝 Suspension details: name="${suspension_name}", reason=${reason}, selected sessions=${selected_session_ids.length}, strategy=${makeupStrategy}, incoming makeup schedules=${makeupSchedules.length}`);

      // For manual strategy, ensure there is a makeup schedule per selected session
      if (makeupStrategy === 'manual') {
        if (!Array.isArray(makeupSchedules) || makeupSchedules.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: 'Makeup schedules are required for manual strategy',
          });
        }
        if (selected_session_ids.length !== makeupSchedules.length) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: 'Each suspended session must have a corresponding makeup schedule',
          });
        }
      }

      // Validate all selected sessions exist, are scheduled, and have required fields
      const sessionsCheck = await client.query(
        `SELECT classsession_id, phase_number, class_id, scheduled_date, scheduled_start_time, scheduled_end_time, status
         FROM classsessionstbl 
         WHERE classsession_id = ANY($1::int[])`,
        [selected_session_ids]
      );

      if (sessionsCheck.rows.length !== selected_session_ids.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Some selected sessions do not exist',
        });
      }

      const notScheduled = sessionsCheck.rows.filter(s => s.status !== 'Scheduled');
      if (notScheduled.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'All selected sessions must have status Scheduled',
        });
      }

      // Validate all sessions are from the same phase
      const phases = [...new Set(sessionsCheck.rows.map(s => s.phase_number))];
      if (phases.length > 1) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'All selected sessions must be from the same phase',
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

      // Get start and end dates from selected sessions for suspension period record
      const sessionDates = sessionsCheck.rows.map(s => new Date(s.scheduled_date));
      const startDate = new Date(Math.min(...sessionDates));
      const endDate = new Date(Math.max(...sessionDates));

      // Create suspension period
      const suspensionResult = await client.query(
        `INSERT INTO suspensionperiodstbl (
          suspension_name, branch_id, start_date, end_date, reason, 
          description, status, affected_class_ids, auto_reschedule, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *`,
        [
          suspension_name.trim(),
          finalBranchId,
          startDate.toISOString().split('T')[0],
          endDate.toISOString().split('T')[0],
          reason,
          description?.trim() || null,
          'Active',
          affected_class_ids && affected_class_ids.length > 0 ? affected_class_ids : null,
          makeupStrategy !== 'manual', // auto_reschedule = true for automatic strategies
          createdByUserId,
        ]
      );

      const suspension = suspensionResult.rows[0];
      console.log(`✅ Suspension record created with ID: ${suspension.suspension_id}`);

      // Cancel selected sessions
      console.log(`🔄 Cancelling ${selected_session_ids.length} selected session(s)...`);
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
          selected_session_ids,
        ]
      );
      console.log(`✅ Selected sessions cancelled`);

      // Get class info for makeup sessions
      const classInfo = await client.query(
        `SELECT c.class_id, c.teacher_id, c.class_name, p.program_code
         FROM classestbl c
         LEFT JOIN programstbl p ON c.program_id = p.program_id
         WHERE c.class_id = $1`,
        [sessionsCheck.rows[0].class_id]
      );
      const classData = classInfo.rows[0];

      // --- Build makeup schedules for automatic strategy: add-last-phase ---
      if (makeupStrategy === 'add-last-phase') {
        console.log(`🧮 Generating automatic makeup schedules for strategy="add-last-phase"...`);

        // Get current class end_date
        const classMetaResult = await client.query(
          `SELECT end_date FROM classestbl WHERE class_id = $1`,
          [classData.class_id]
        );
        const currentEndDate = classMetaResult.rows[0]?.end_date
          ? new Date(classMetaResult.rows[0].end_date)
          : endDate;

        // Add makeup sessions to the last phase of the class (not a new phase)
        const maxPhaseResult = await client.query(
          `SELECT MAX(phase_number) as max_phase FROM classsessionstbl WHERE class_id = $1`,
          [classData.class_id]
        );
        const targetPhaseNumber = maxPhaseResult.rows[0]?.max_phase ?? phases[0];

        // Get max phase_session_number for the last phase
        const maxSessionResult = await client.query(
          `SELECT MAX(phase_session_number) as max_session
           FROM classsessionstbl
           WHERE class_id = $1 AND phase_number = $2`,
          [classData.class_id, targetPhaseNumber]
        );
        let nextSessionNumber = (maxSessionResult.rows[0]?.max_session || 0) + 1;

        // Sort sessions by original date for stable ordering
        const sortedSessions = [...sessionsCheck.rows].sort(
          (a, b) => new Date(a.scheduled_date) - new Date(b.scheduled_date)
        );

        makeupSchedules = [];
        let newClassEndDate = new Date(currentEndDate);

        for (const session of sortedSessions) {
          const originalDate = new Date(session.scheduled_date);
          const originalStart = session.scheduled_start_time;
          const originalEnd = session.scheduled_end_time;

          // Start with one week after the original date
          let makeupDate = new Date(originalDate);
          makeupDate.setDate(makeupDate.getDate() + 7);

          // Ensure makeup date is after the current class end date
          while (makeupDate <= currentEndDate) {
            makeupDate.setDate(makeupDate.getDate() + 7);
          }

          const yyyyMmDd = makeupDate.toISOString().split('T')[0];
          makeupSchedules.push({
            suspended_session_id: session.classsession_id,
            phase_number: targetPhaseNumber,
            phase_session_number: nextSessionNumber,
            makeup_date: yyyyMmDd,
            makeup_start_time: originalStart,
            makeup_end_time: originalEnd,
          });

          if (makeupDate > newClassEndDate) {
            newClassEndDate = makeupDate;
          }

          nextSessionNumber++;
        }

        // Update class end_date to last makeup date (classestbl has no updated_at column)
        if (newClassEndDate > currentEndDate) {
          await client.query(
            `UPDATE classestbl SET end_date = $1 WHERE class_id = $2`,
            [newClassEndDate.toISOString().split('T')[0], classData.class_id]
          );
          console.log(`📅 Class end_date extended to ${newClassEndDate.toISOString().split('T')[0]}`);
        }
      }

      // Get the maximum phase_session_number for this phase to continue numbering
      // For automatic strategies, phase/session numbers may already be in makeupSchedules;
      // for manual strategy we compute them here.
      if (makeupStrategy === 'manual') {
        const maxSessionResult = await client.query(
          `SELECT MAX(phase_session_number) as max_session
           FROM classsessionstbl
           WHERE class_id = $1 AND phase_number = $2`,
          [classData.class_id, phases[0]]
        );
        let nextSessionNumber = (maxSessionResult.rows[0]?.max_session || 0) + 1;

        makeupSchedules = makeupSchedules.map(schedule => ({
          ...schedule,
          phase_number: phases[0],
          phase_session_number: nextSessionNumber++,
        }));
      }

      // Create makeup sessions
      console.log(`💾 Creating ${makeupSchedules.length} makeup session(s)...`);
      for (const makeupSchedule of makeupSchedules) {
        const {
          suspended_session_id,
          phase_number,
          phase_session_number,
          makeup_date,
          makeup_start_time,
          makeup_end_time,
        } = makeupSchedule;

        // Generate class code for the makeup session (may be null if program_code missing)
        const classCode = generateClassCode(
          classData.program_code,
          makeup_date,
          makeup_start_time,
          classData.class_name
        ) || null;
        console.log(`   🔖 Creating makeup for session ${suspended_session_id}: ${makeup_date} ${makeup_start_time}-${makeup_end_time}`);

        await client.query(
          `INSERT INTO classsessionstbl (
            class_id, phasesessiondetail_id, phase_number, phase_session_number,
            scheduled_date, scheduled_start_time, scheduled_end_time,
            original_teacher_id, assigned_teacher_id, status, created_by, suspension_id, notes, class_code
          ) VALUES ($1, $2, $3, $4, $5, $6::time, $7::time, $8, $9, $10, $11, $12, $13, $14)`,
          [
            classData.class_id,
            null,
            phase_number,
            phase_session_number,
            makeup_date,
            makeup_start_time,
            makeup_end_time,
            classData.teacher_id ?? null,
            classData.teacher_id ?? null,
            'Rescheduled',
            createdByUserId ?? null,
            suspension.suspension_id,
            `Makeup session for suspended session ${suspended_session_id}: ${suspension_name} (${reason})`,
            classCode,
          ]
        );
      }
      console.log(`✅ ${makeupSchedules.length} makeup session(s) created successfully`);


      // Send notifications to enrolled students
      console.log(`📢 Creating notifications for enrolled students...`);
      try {
        let affectedClassIds = [];
        if (affected_class_ids && affected_class_ids.length > 0) {
          affectedClassIds = [...new Set(affected_class_ids)];
        } else {
          const uniqueClassIds = [...new Set(sessionsCheck.rows.map(s => s.class_id).filter(Boolean))];
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
          const startDateFormatted = startDate.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          });
          const endDateFormatted = endDate.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          });

          // Build announcement body
          let announcementBody = `Your class ${classNamesText} has ${selected_session_ids.length} session(s) suspended due to: ${suspension_name}`;
          announcementBody += `\n\nReason: ${reason}`;
          announcementBody += `\nPeriod: ${startDateFormatted} to ${endDateFormatted}`;
          announcementBody += `\n\nMakeup sessions have been scheduled. Please check your class schedule for details.`;
          if (description) {
            announcementBody += `\n\nAdditional Information:\n${description}`;
          }

          // Get branch for target audience
          const branchId = classNamesResult.rows[0]?.branch_id || null;

          // Calculate notification end date (30 days after suspension ends)
          const notificationEndDate = new Date(endDate);
          notificationEndDate.setDate(notificationEndDate.getDate() + 30);

          try {
            // Create announcement/notification
            await client.query(
              `INSERT INTO announcementstbl (
                title, body, recipient_groups, status, priority, branch_id, 
                start_date, end_date, created_by
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [
                `Class Suspension: ${suspension_name}`,
                announcementBody,
                ['Students'],
                'Active',
                'High',
                branchId,
                new Date().toISOString().split('T')[0],
                notificationEndDate.toISOString().split('T')[0],
                createdByUserId,
              ]
            );
            console.log(`✅ Suspension announcement created`);
          } catch (announcementError) {
            console.error('⚠️ Error creating suspension announcement:', announcementError);
          }
        }
      } catch (notificationError) {
        console.error('⚠️ Error in notification process:', notificationError);
      }

      await client.query('COMMIT');
      console.log('✅ Transaction committed successfully');

      res.json({
        success: true,
        message: 'Suspension created successfully with manual makeup schedules',
        data: {
          suspension: suspension,
          cancelled_sessions: selected_session_ids.length,
          makeup_sessions: makeupSchedules.length,
        },
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Error creating suspension period:', error);
      console.error('DB error details:', {
        code: error.code,
        detail: error.detail,
        constraint: error.constraint,
        table: error.table,
        column: error.column,
        message: error.message,
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

