import express from 'express';
import { body, param, query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole, requireBranchAccess } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query, getClient } from '../config/database.js';
import { sendAnnouncementCreatedEmails } from '../lib/announcementRecipientEmails/index.js';
import {
  normalizeAudienceIdList,
  sqlAnnouncementMatchesStudentAudience,
  sqlAnnouncementMatchesTeacherAudience,
  userTypeUsesAcademicAudience,
} from '../lib/announcementAudienceFilter/index.js';

const router = express.Router();

// All routes require authentication
router.use(verifyFirebaseToken);
router.use(requireBranchAccess);

// Valid recipient groups
const VALID_RECIPIENT_GROUPS = [
  'All',
  'Students',
  'Teachers',
  'Admin',
  'Finance',
  'Superadmin',
  'Superfinance',
  'Guardians',
];

/**
 * Board posts created from the Announcements page (`POST /announcements`).
 * System alerts (stock, payments, AR, daily summary, …) set navigation_key
 * and/or target_user_id. Start/end dates are optional. Skip known system titles.
 * GET /notifications is not filtered this way.
 */
const BOARD_ANNOUNCEMENT_ONLY_SQL = `
  AND (a.navigation_key IS NULL OR BTRIM(a.navigation_key) = '')
  AND a.target_user_id IS NULL
  AND NOT (
    LOWER(a.title) LIKE '%payment returned%'
    OR LOWER(a.title) LIKE '%payment rejected%'
    OR LOWER(a.title) LIKE '%payment resubmitted%'
    OR LOWER(a.title) LIKE '%merchandise request%'
    OR LOWER(a.title) LIKE '%stock request%'
    OR LOWER(a.title) LIKE '%stock added%'
    OR LOWER(a.title) LIKE '%cash deposit summary%'
    OR LOWER(a.title) LIKE '%end of shift%'
    OR LOWER(a.title) LIKE '%end of day%'
    OR LOWER(a.title) LIKE '%acknowledgement receipt%'
    OR LOWER(a.title) LIKE 'class suspension:%'
  )
`;

/**
 * Map user types to recipient groups
 * Converts singular user types (Student, Teacher) to plural recipient groups (Students, Teachers)
 */
const mapUserTypeToRecipientGroup = (userType, userBranchId) => {
  // Special case: Finance users with no branch_id are treated as "Finance" role
  if (userType === 'Finance' && !userBranchId) {
    return 'Finance';
  }
  
  // Map user types to recipient groups
  const mapping = {
    'Student': 'Students',
    'Teacher': 'Teachers',
    'Admin': 'Admin',
    'Finance': 'Finance',
    'Superadmin': 'Superadmin',
    'Superfinance': 'Superfinance',
  };
  
  return mapping[userType] || userType; // Fallback to original if no mapping found
};

/**
 * GET /api/sms/announcements
 * Announcements page catalog: posts created from Create Announcement only.
 * System alerts are excluded (they use GET /announcements/notifications).
 * Access: All authenticated users (filtered by role and branch)
 */
router.get(
  '/',
  [
    queryValidator('branch_id').optional().isInt().withMessage('Branch ID must be an integer'),
    queryValidator('status').optional().isString().withMessage('Status must be a string'),
    queryValidator('recipient_group').optional().isString().withMessage('Recipient group must be a string'),
    queryValidator('title').optional().isString().withMessage('Title must be a string'),
    queryValidator('created_on').optional().isISO8601().withMessage('Created on must be a valid date'),
    queryValidator('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    queryValidator('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { branch_id, status, recipient_group, title, created_on, page = 1, limit = 20 } = req.query;
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 20;
      const offset = (pageNum - 1) * limitNum;

      let sql = `
        SELECT 
          a.announcement_id,
          a.title,
          a.email_subject,
          a.body,
          a.recipient_groups,
          a.program_ids,
          a.class_ids,
          a.navigation_key,
          a.navigation_query,
          a.status,
          a.priority,
          a.branch_id,
          a.created_by,
          a.attachment_url,
          TO_CHAR((a.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' as created_at,
          TO_CHAR((a.updated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' as updated_at,
          TO_CHAR(a.start_date, 'YYYY-MM-DD') as start_date,
          TO_CHAR(a.end_date, 'YYYY-MM-DD') as end_date,
          u.full_name as created_by_name,
          b.branch_name
        FROM announcementstbl a
        LEFT JOIN userstbl u ON a.created_by = u.user_id
        LEFT JOIN branchestbl b ON a.branch_id = b.branch_id
        WHERE 1=1
        ${BOARD_ANNOUNCEMENT_ONLY_SQL}
      `;
      const params = [];
      let paramCount = 0;

      // Students/Teachers only see announcements for their programs/classes.
      const listUserId = req.user.userId || req.user.user_id;
      const listUserType = req.user.userType || req.user.user_type;
      if (userTypeUsesAcademicAudience(listUserType) && listUserId) {
        paramCount++;
        params.push(listUserId);
        if (listUserType === 'Student') {
          sql += ` AND ${sqlAnnouncementMatchesStudentAudience(paramCount)}`;
        } else {
          sql += ` AND ${sqlAnnouncementMatchesTeacherAudience(paramCount)}`;
        }
      }

      // Filter by branch (non-superadmin users are limited to their branch)
      if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        paramCount++;
        sql += ` AND (a.branch_id = $${paramCount} OR a.branch_id IS NULL)`;
        params.push(req.user.branchId);
      } else if (branch_id) {
        paramCount++;
        sql += ` AND (a.branch_id = $${paramCount} OR a.branch_id IS NULL)`;
        params.push(parseInt(branch_id));
      }

      // Filter by status
      if (status) {
        paramCount++;
        sql += ` AND a.status = $${paramCount}`;
        params.push(status);
      }

      // Filter by recipient group (using array contains)
      if (recipient_group) {
        paramCount++;
        sql += ` AND ($${paramCount} = ANY(a.recipient_groups) OR 'All' = ANY(a.recipient_groups))`;
        params.push(recipient_group);
      }

      // Filter by title (case-insensitive search)
      if (title) {
        paramCount++;
        sql += ` AND LOWER(a.title) LIKE LOWER($${paramCount})`;
        params.push(`%${title}%`);
      }

      // Filter by created date
      if (created_on) {
        paramCount++;
        sql += ` AND DATE(a.created_at) = $${paramCount}`;
        params.push(created_on);
      }

      // Order by created_at (newest first) so new announcements appear at top, then priority as tiebreaker
      sql += ` ORDER BY 
        a.created_at DESC,
        CASE a.priority 
          WHEN 'High' THEN 1 
          WHEN 'Medium' THEN 2 
          WHEN 'Low' THEN 3 
        END
        LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
      params.push(limitNum, offset);

      const result = await query(sql, params);

      // Get total count for pagination
      let countSql = `
        SELECT COUNT(*) as total
        FROM announcementstbl a
        WHERE 1=1
        ${BOARD_ANNOUNCEMENT_ONLY_SQL}
      `;
      const countParams = [];
      let countParamCount = 0;

      if (userTypeUsesAcademicAudience(listUserType) && listUserId) {
        countParamCount++;
        countParams.push(listUserId);
        if (listUserType === 'Student') {
          countSql += ` AND ${sqlAnnouncementMatchesStudentAudience(countParamCount)}`;
        } else {
          countSql += ` AND ${sqlAnnouncementMatchesTeacherAudience(countParamCount)}`;
        }
      }

      if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        countParamCount++;
        countSql += ` AND (a.branch_id = $${countParamCount} OR a.branch_id IS NULL)`;
        countParams.push(req.user.branchId);
      } else if (branch_id) {
        countParamCount++;
        countSql += ` AND (a.branch_id = $${countParamCount} OR a.branch_id IS NULL)`;
        countParams.push(parseInt(branch_id));
      }

      if (status) {
        countParamCount++;
        countSql += ` AND a.status = $${countParamCount}`;
        countParams.push(status);
      }

      if (recipient_group) {
        countParamCount++;
        countSql += ` AND ($${countParamCount} = ANY(a.recipient_groups) OR 'All' = ANY(a.recipient_groups))`;
        countParams.push(recipient_group);
      }

      if (title) {
        countParamCount++;
        countSql += ` AND LOWER(a.title) LIKE LOWER($${countParamCount})`;
        countParams.push(`%${title}%`);
      }

      if (created_on) {
        countParamCount++;
        countSql += ` AND DATE(a.created_at) = $${countParamCount}`;
        countParams.push(created_on);
      }

      const countResult = await query(countSql, countParams);
      const total = parseInt(countResult.rows[0].total);

      // Get filter options
      const branchesResult = await query(`
        SELECT DISTINCT b.branch_id, b.branch_name
        FROM announcementstbl a
        LEFT JOIN branchestbl b ON a.branch_id = b.branch_id
        WHERE b.branch_id IS NOT NULL
        ${BOARD_ANNOUNCEMENT_ONLY_SQL}
        ORDER BY b.branch_name
      `);

      res.json({
        success: true,
        data: result.rows,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
        filters: {
          branches: branchesResult.rows,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/sms/announcements/notifications
 * Get active announcements for current user with unread count
 * Access: All authenticated users
 * NOTE: This route must be defined BEFORE /:id to avoid route matching conflicts
 */
router.get(
  '/notifications',
  async (req, res, next) => {
    try {
      const userId = req.user.userId || req.user.user_id;
      const userType = req.user.userType || req.user.user_type;
      const userBranchId = req.user.branchId || req.user.branch_id;
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const suppressEndOfShiftNotifications = ['finance', 'superfinance'].includes(
        String(userType || '').trim().toLowerCase()
      );

      // Map user types to recipient groups (e.g., 'Student' -> 'Students', 'Teacher' -> 'Teachers')
      const recipientGroup = mapUserTypeToRecipientGroup(userType, userBranchId);

      // Build query to get active announcements for this user
      // Branch logic: Show announcements if:
      // 1. Announcement has no branch_id (applies to all branches)
      // 2. Announcement's branch_id matches user's branch_id
      // 3. User has no branch_id (Superadmin/Superfinance) - show all announcements
      // Targeted notification logic:
      // - If target_user_id is set, only that user can see it.
      // - If target_user_id is NULL, fallback to recipient group matching.
      // Note: Using COALESCE to handle case where announcement_readstbl might not exist yet
      let sql = `
        SELECT 
          a.announcement_id,
          a.title,
          a.email_subject,
          a.body,
          a.navigation_key,
          a.navigation_query,
          a.recipient_groups,
          a.program_ids,
          a.class_ids,
          a.status,
          a.priority,
          a.branch_id,
          a.created_by,
          a.attachment_url,
          TO_CHAR((a.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' as created_at,
          TO_CHAR(a.start_date, 'YYYY-MM-DD') as start_date,
          TO_CHAR(a.end_date, 'YYYY-MM-DD') as end_date,
          u.full_name as created_by_name,
          b.branch_name,
          COALESCE((SELECT true FROM announcement_readstbl ar 
                    WHERE ar.announcement_id = a.announcement_id 
                    AND ar.user_id = $1 LIMIT 1), false) as is_read
        FROM announcementstbl a
        LEFT JOIN userstbl u ON a.created_by = u.user_id
        LEFT JOIN branchestbl b ON a.branch_id = b.branch_id
        WHERE a.status = 'Active'
          AND a.created_by != $1
          AND (
            a.target_user_id = $1
            OR (
              a.target_user_id IS NULL
              AND ($2 = ANY(a.recipient_groups) OR 'All' = ANY(a.recipient_groups))
            )
          )
          AND (
            a.branch_id IS NULL 
            OR a.branch_id = $3 
            OR $3 IS NULL
          )
          AND (
            a.start_date IS NULL OR a.start_date::date <= $4::date
          )
          AND (
            a.end_date IS NULL OR a.end_date::date >= $4::date
          )
          AND NOT (
            $5::boolean = true
            AND (
              (
                LOWER(COALESCE(a.navigation_key, '')) = 'daily-summary-sales'
                AND COALESCE(a.navigation_query, '') ILIKE '%notificationTab=endOfShift%'
              )
              OR LOWER(COALESCE(a.title, '')) LIKE '%end of shift%'
              OR LOWER(COALESCE(a.title, '')) LIKE '%end of day%'
            )
          )
      `;

      if (userType === 'Student') {
        sql += ` AND (
          a.target_user_id = $1
          OR ${sqlAnnouncementMatchesStudentAudience(1)}
        )`;
      } else if (userType === 'Teacher') {
        sql += ` AND (
          a.target_user_id = $1
          OR ${sqlAnnouncementMatchesTeacherAudience(1)}
        )`;
      }

      sql += `
        ORDER BY 
          a.created_at DESC,
          CASE a.priority 
            WHEN 'High' THEN 1 
            WHEN 'Medium' THEN 2 
            WHEN 'Low' THEN 3 
          END
        LIMIT 20
      `;

      const params = [userId, recipientGroup, userBranchId, today, suppressEndOfShiftNotifications];
      
      const result = await query(sql, params);

      // Count unread announcements (is_read is boolean from SQL)
      const unreadCount = result.rows.filter(announcement => !announcement.is_read).length;

      res.json({
        success: true,
        data: result.rows,
        unreadCount: unreadCount,
        totalCount: result.rows.length,
      });
    } catch (error) {
      console.error('Error fetching notifications:', error);
      next(error);
    }
  }
);

/**
 * POST /api/sms/announcements/read-all
 * Mark all currently visible active notifications as read for the current user
 * Access: All authenticated users
 * NOTE: This route must be defined BEFORE /:id to avoid route matching conflicts
 */
router.post(
  '/read-all',
  async (req, res, next) => {
    try {
      const userId = req.user.userId || req.user.user_id;
      const userType = req.user.userType || req.user.user_type;
      const userBranchId = req.user.branchId || req.user.branch_id;
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const recipientGroup = mapUserTypeToRecipientGroup(userType, userBranchId);
      const suppressEndOfShiftNotifications = ['finance', 'superfinance'].includes(
        String(userType || '').trim().toLowerCase()
      );

      let readAllSql = `
         WITH visible_announcements AS (
           SELECT a.announcement_id
           FROM announcementstbl a
           WHERE a.status = 'Active'
             AND a.created_by != $1
             AND (
               a.target_user_id = $1
               OR (
                 a.target_user_id IS NULL
                 AND ($2 = ANY(a.recipient_groups) OR 'All' = ANY(a.recipient_groups))
               )
             )
             AND (
               a.branch_id IS NULL
               OR a.branch_id = $3
               OR $3 IS NULL
             )
             AND (
               a.start_date IS NULL OR a.start_date::date <= $4::date
             )
             AND (
               a.end_date IS NULL OR a.end_date::date >= $4::date
             )
             AND NOT (
               $5::boolean = true
               AND (
                 (
                   LOWER(COALESCE(a.navigation_key, '')) = 'daily-summary-sales'
                   AND COALESCE(a.navigation_query, '') ILIKE '%notificationTab=endOfShift%'
                 )
                 OR LOWER(COALESCE(a.title, '')) LIKE '%end of shift%'
                 OR LOWER(COALESCE(a.title, '')) LIKE '%end of day%'
               )
             )
      `;
      if (userType === 'Student') {
        readAllSql += ` AND (a.target_user_id = $1 OR ${sqlAnnouncementMatchesStudentAudience(1)})`;
      } else if (userType === 'Teacher') {
        readAllSql += ` AND (a.target_user_id = $1 OR ${sqlAnnouncementMatchesTeacherAudience(1)})`;
      }
      readAllSql += `
         )
         INSERT INTO announcement_readstbl (announcement_id, user_id)
         SELECT v.announcement_id, $1
         FROM visible_announcements v
         LEFT JOIN announcement_readstbl ar
           ON ar.announcement_id = v.announcement_id
          AND ar.user_id = $1
         WHERE ar.announcement_id IS NULL
         ON CONFLICT (announcement_id, user_id) DO NOTHING
         RETURNING announcement_id`;

      const result = await query(readAllSql, [
        userId,
        recipientGroup,
        userBranchId,
        today,
        suppressEndOfShiftNotifications,
      ]);

      res.json({
        success: true,
        message: 'All notifications marked as read',
        data: {
          marked_count: result.rows.length,
        },
      });
    } catch (error) {
      console.error('Error marking all announcements as read:', error);
      next(error);
    }
  }
);

/**
 * GET /api/sms/announcements/:id
 * Get a single announcement by ID
 * Access: All authenticated users
 */
router.get(
  '/:id',
  [
    param('id').isInt().withMessage('Announcement ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const result = await query(
        `
        SELECT 
          a.announcement_id,
          a.title,
          a.email_subject,
          a.body,
          a.recipient_groups,
          a.program_ids,
          a.class_ids,
          a.status,
          a.priority,
          a.branch_id,
          a.created_by,
          a.attachment_url,
          TO_CHAR((a.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' as created_at,
          TO_CHAR((a.updated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' as updated_at,
          TO_CHAR(a.start_date, 'YYYY-MM-DD') as start_date,
          TO_CHAR(a.end_date, 'YYYY-MM-DD') as end_date,
          u.full_name as created_by_name,
          b.branch_name
        FROM announcementstbl a
        LEFT JOIN userstbl u ON a.created_by = u.user_id
        LEFT JOIN branchestbl b ON a.branch_id = b.branch_id
        WHERE a.announcement_id = $1
        `,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Announcement not found',
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
 * POST /api/sms/announcements
 * Create a new announcement
 * Access: Superadmin, Admin, Teacher
 */
router.post(
  '/',
  [
    body('title').notEmpty().trim().withMessage('Title is required'),
    body('body').notEmpty().trim().withMessage('Description is required'),
    body('recipient_groups')
      .custom((value, { req }) => {
        const status = req.body?.status || 'Active';
        if (status === 'Draft') {
          if (value == null || value === '') return true;
          return Array.isArray(value);
        }
        return Array.isArray(value) && value.length >= 1;
      })
      .withMessage('At least one recipient group is required'),
    body('recipient_groups.*')
      .optional()
      .isIn(VALID_RECIPIENT_GROUPS)
      .withMessage(`Recipient group must be one of: ${VALID_RECIPIENT_GROUPS.join(', ')}`),
    body('status').optional().isIn(['Active', 'Inactive', 'Draft']).withMessage('Invalid status'),
    body('priority').optional().isIn(['High', 'Medium', 'Low']).withMessage('Invalid priority'),
    body('branch_id').optional().custom((value) => {
      if (value === null || value === undefined || value === '') return true;
      const num = parseInt(value);
      return !isNaN(num) && num > 0;
    }).withMessage('Branch ID must be a positive integer or null for all branches'),
    body('start_date').optional().custom((value) => {
      if (value === null || value === undefined || value === '') return true;
      return /^\d{4}-\d{2}-\d{2}/.test(value);
    }).withMessage('Start date must be a valid date in YYYY-MM-DD format'),
    body('end_date').optional().custom((value) => {
      if (value === null || value === undefined || value === '') return true;
      return /^\d{4}-\d{2}-\d{2}/.test(value);
    }).withMessage('End date must be a valid date in YYYY-MM-DD format'),
    body('attachment_url').custom((value) => {
      if (value === null || value === undefined || value === '') return true;
      return typeof value === 'string';
    }).withMessage('Attachment URL must be a string'),
    body('email_subject')
      .optional({ values: 'falsy' })
      .isString()
      .trim()
      .isLength({ max: 255 })
      .withMessage('Subject must be at most 255 characters'),
    body('send_email').optional().isBoolean().withMessage('send_email must be true or false'),
    body('program_ids').optional().isArray().withMessage('program_ids must be an array'),
    body('program_ids.*').optional().isInt({ min: 1 }).withMessage('Each program_id must be a positive integer'),
    body('class_ids').optional().isArray().withMessage('class_ids must be an array'),
    body('class_ids.*').optional().isInt({ min: 1 }).withMessage('Each class_id must be a positive integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Teacher'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const {
        title,
        email_subject,
        body,
        recipient_groups,
        status = 'Active',
        priority = 'Medium',
        branch_id,
        start_date,
        end_date,
        attachment_url,
        send_email = true,
        program_ids,
        class_ids,
      } = req.body;

      const programIds = normalizeAudienceIdList(program_ids);
      const classIds = normalizeAudienceIdList(class_ids);

      // Validate date range
      if (start_date && end_date && new Date(start_date) > new Date(end_date)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Start date cannot be after end date',
        });
      }

      // For non-superadmin users, enforce branch restriction
      let finalBranchId = branch_id ? parseInt(branch_id) : null;
      if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        finalBranchId = req.user.branchId;
      }

      // Get user ID
      const createdByUserId = req.user.userId || req.user.user_id;
      if (!createdByUserId) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'User ID not found. Please ensure you are properly authenticated.',
        });
      }

      const result = await client.query(
        `
        INSERT INTO announcementstbl (
          title, email_subject, body, recipient_groups, status, priority, branch_id,
          created_by, start_date, end_date, attachment_url, program_ids, class_ids
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *
        `,
        [
          title.trim(),
          email_subject && String(email_subject).trim() ? String(email_subject).trim() : null,
          body.trim(),
          recipient_groups || [],
          status,
          priority,
          finalBranchId,
          createdByUserId,
          start_date || null,
          end_date || null,
          attachment_url && String(attachment_url).trim() ? String(attachment_url).trim() : null,
          programIds,
          classIds,
        ]
      );

      await client.query('COMMIT');

      const createdAnnouncement = result.rows[0];
      let branchName = '';
      if (createdAnnouncement.branch_id) {
        const branchResult = await query(
          'SELECT branch_name FROM branchestbl WHERE branch_id = $1 LIMIT 1',
          [createdAnnouncement.branch_id]
        );
        branchName = branchResult.rows[0]?.branch_name || '';
      }

      if (send_email !== false && String(createdAnnouncement.status || '') === 'Active') {
        setImmediate(() => {
          sendAnnouncementCreatedEmails({
            announcement: createdAnnouncement,
            branchName,
          }).catch((emailErr) => {
            console.error('[announcements] Failed to send announcement emails:', emailErr);
          });
        });
      }

      res.status(201).json({
        success: true,
        message: 'Announcement created successfully',
        data: createdAnnouncement,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error creating announcement:', error);
      
      // Handle specific PostgreSQL errors
      if (error.code === '23503') {
        return res.status(400).json({
          success: false,
          message: 'Invalid user or branch reference',
          error: error.detail || error.message,
        });
      }
      
      if (error.code === '23505') {
        return res.status(400).json({
          success: false,
          message: 'Duplicate entry',
          error: error.detail || error.message,
        });
      }
      
      // Return a more helpful error message
      return res.status(500).json({
        success: false,
        message: 'Failed to create announcement',
        error: error.message || 'Unknown error occurred',
      });
    } finally {
      client.release();
    }
  }
);

/**
 * PUT /api/sms/announcements/:id
 * Update an existing announcement
 * Access: Superadmin, Admin, Teacher
 */
router.put(
  '/:id',
  [
    param('id').isInt().withMessage('Announcement ID must be an integer'),
    body('title').optional().notEmpty().trim().withMessage('Title cannot be empty'),
    body('body').optional().notEmpty().trim().withMessage('Description cannot be empty'),
    body('recipient_groups')
      .optional()
      .isArray({ min: 1 })
      .withMessage('At least one recipient group is required'),
    body('recipient_groups.*')
      .optional()
      .isIn(VALID_RECIPIENT_GROUPS)
      .withMessage(`Recipient group must be one of: ${VALID_RECIPIENT_GROUPS.join(', ')}`),
    body('status').optional().isIn(['Active', 'Inactive', 'Draft']).withMessage('Invalid status'),
    body('priority').optional().isIn(['High', 'Medium', 'Low']).withMessage('Invalid priority'),
    body('branch_id').optional().custom((value) => {
      if (value === null || value === undefined || value === '') return true;
      const num = parseInt(value);
      return !isNaN(num) && num > 0;
    }).withMessage('Branch ID must be a positive integer or null for all branches'),
    body('start_date').optional().custom((value) => {
      if (value === null || value === undefined || value === '') return true;
      return /^\d{4}-\d{2}-\d{2}/.test(value);
    }).withMessage('Start date must be a valid date in YYYY-MM-DD format'),
    body('end_date').optional().custom((value) => {
      if (value === null || value === undefined || value === '') return true;
      return /^\d{4}-\d{2}-\d{2}/.test(value);
    }).withMessage('End date must be a valid date in YYYY-MM-DD format'),
    body('attachment_url').custom((value) => {
      if (value === null || value === undefined || value === '') return true;
      return typeof value === 'string';
    }).withMessage('Attachment URL must be a string'),
    body('email_subject')
      .optional({ values: 'falsy' })
      .isString()
      .trim()
      .isLength({ max: 255 })
      .withMessage('Subject must be at most 255 characters'),
    body('program_ids').optional().isArray().withMessage('program_ids must be an array'),
    body('program_ids.*').optional().isInt({ min: 1 }).withMessage('Each program_id must be a positive integer'),
    body('class_ids').optional().isArray().withMessage('class_ids must be an array'),
    body('class_ids.*').optional().isInt({ min: 1 }).withMessage('Each class_id must be a positive integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Teacher'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { id } = req.params;
      const {
        title,
        email_subject,
        body,
        recipient_groups,
        status,
        priority,
        branch_id,
        start_date,
        end_date,
        attachment_url,
        program_ids,
        class_ids,
      } = req.body;

      // Check if announcement exists
      const existing = await client.query(
        'SELECT * FROM announcementstbl WHERE announcement_id = $1',
        [id]
      );

      if (existing.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Announcement not found',
        });
      }

      const announcement = existing.rows[0];
      const currentUserId = req.user.userId || req.user.user_id;
      
      // Check if user is the creator (Superadmin can edit any announcement)
      if (req.user.userType !== 'Superadmin') {
        if (Number(announcement.created_by) !== Number(currentUserId)) {
          await client.query('ROLLBACK');
          return res.status(403).json({
            success: false,
            message: 'Access denied. You can only edit your own announcements.',
          });
        }
        
        // Check branch access for non-superadmin users
        if (req.user.branchId) {
          if (announcement.branch_id !== req.user.branchId && announcement.branch_id !== null) {
            await client.query('ROLLBACK');
            return res.status(403).json({
              success: false,
              message: 'Access denied. You can only edit announcements for your branch.',
            });
          }
        }
      }

      // Validate date range
      const finalStartDate = start_date !== undefined ? (start_date || null) : existing.rows[0].start_date;
      const finalEndDate = end_date !== undefined ? (end_date || null) : existing.rows[0].end_date;
      
      if (finalStartDate && finalEndDate && new Date(finalStartDate) > new Date(finalEndDate)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Start date cannot be after end date',
        });
      }

      // Build update query dynamically
      const updates = [];
      const params = [];
      let paramCount = 0;

      if (title !== undefined) {
        paramCount++;
        updates.push(`title = $${paramCount}`);
        params.push(title.trim());
      }

      if (body !== undefined) {
        paramCount++;
        updates.push(`body = $${paramCount}`);
        params.push(body.trim());
      }

      if (email_subject !== undefined) {
        paramCount++;
        updates.push(`email_subject = $${paramCount}`);
        params.push(email_subject && String(email_subject).trim() ? String(email_subject).trim() : null);
      }

      if (recipient_groups !== undefined) {
        paramCount++;
        updates.push(`recipient_groups = $${paramCount}`);
        params.push(recipient_groups);
      }

      if (program_ids !== undefined) {
        paramCount++;
        updates.push(`program_ids = $${paramCount}`);
        params.push(normalizeAudienceIdList(program_ids));
      }

      if (class_ids !== undefined) {
        paramCount++;
        updates.push(`class_ids = $${paramCount}`);
        params.push(normalizeAudienceIdList(class_ids));
      }

      if (status !== undefined) {
        paramCount++;
        updates.push(`status = $${paramCount}`);
        params.push(status);
      }

      if (priority !== undefined) {
        paramCount++;
        updates.push(`priority = $${paramCount}`);
        params.push(priority);
      }

      if (branch_id !== undefined) {
        let finalBranchId = branch_id ? parseInt(branch_id) : null;
        if (req.user.userType !== 'Superadmin' && req.user.branchId) {
          finalBranchId = req.user.branchId;
        }
        paramCount++;
        updates.push(`branch_id = $${paramCount}`);
        params.push(finalBranchId);
      }

      if (start_date !== undefined) {
        paramCount++;
        updates.push(`start_date = $${paramCount}`);
        params.push(start_date || null);
      }

      if (end_date !== undefined) {
        paramCount++;
        updates.push(`end_date = $${paramCount}`);
        params.push(end_date || null);
      }

      if (attachment_url !== undefined) {
        paramCount++;
        updates.push(`attachment_url = $${paramCount}`);
        params.push(attachment_url && String(attachment_url).trim() ? String(attachment_url).trim() : null);
      }

      if (updates.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'No fields to update',
        });
      }

      // Add updated_at to the SET clause (doesn't need a parameter)
      updates.push(`updated_at = CURRENT_TIMESTAMP`);
      
      // Add the id parameter for the WHERE clause
      paramCount++;
      params.push(parseInt(id));

      const updateSql = `
        UPDATE announcementstbl
        SET ${updates.join(', ')}
        WHERE announcement_id = $${paramCount}
        RETURNING *
      `;

      const result = await client.query(updateSql, params);

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Announcement updated successfully',
        data: result.rows[0],
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error updating announcement:', error);
      
      // Handle specific PostgreSQL errors
      if (error.code === '23503') {
        return res.status(400).json({
          success: false,
          message: 'Invalid user or branch reference',
          error: error.detail || error.message,
        });
      }
      
      if (error.code === '23505') {
        return res.status(400).json({
          success: false,
          message: 'Duplicate entry',
          error: error.detail || error.message,
        });
      }
      
      // Return a more helpful error message
      return res.status(500).json({
        success: false,
        message: 'Failed to update announcement',
        error: error.message || 'Unknown error occurred',
      });
    } finally {
      client.release();
    }
  }
);

/**
 * DELETE /api/sms/announcements/:id
 * Delete an announcement
 * Access: Superadmin, Admin, Teacher
 */
router.delete(
  '/:id',
  [
    param('id').isInt().withMessage('Announcement ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Teacher'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { id } = req.params;

      // Check if announcement exists
      const existing = await client.query(
        'SELECT * FROM announcementstbl WHERE announcement_id = $1',
        [id]
      );

      if (existing.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Announcement not found',
        });
      }

      const announcement = existing.rows[0];
      const currentUserId = req.user.userId || req.user.user_id;
      
      // Check if user is the creator (Superadmin can delete any announcement)
      if (req.user.userType !== 'Superadmin') {
        if (Number(announcement.created_by) !== Number(currentUserId)) {
          await client.query('ROLLBACK');
          return res.status(403).json({
            success: false,
            message: 'Access denied. You can only delete your own announcements.',
          });
        }
        
        // Check branch access for non-superadmin users
        if (req.user.branchId) {
          if (announcement.branch_id !== req.user.branchId && announcement.branch_id !== null) {
            await client.query('ROLLBACK');
            return res.status(403).json({
              success: false,
              message: 'Access denied. You can only delete announcements for your branch.',
            });
          }
        }
      }

      await client.query(
        'DELETE FROM announcementstbl WHERE announcement_id = $1',
        [id]
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Announcement deleted successfully',
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
 * POST /api/sms/announcements/:id/read
 * Mark an announcement as read for the current user
 * Access: All authenticated users
 * NOTE: This route must be defined BEFORE /:id to avoid route matching conflicts
 */
router.post(
  '/:id/read',
  [
    param('id').isInt().withMessage('Announcement ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const userId = req.user.userId || req.user.user_id;

      // Check if announcement exists and is accessible to user
      const announcementCheck = await query(
        `SELECT a.* FROM announcementstbl a
         WHERE a.announcement_id = $1 AND a.status = 'Active'`,
        [id]
      );

      if (announcementCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Announcement not found or not active',
        });
      }

      // Check if already read
      const existingRead = await query(
        'SELECT * FROM announcement_readstbl WHERE announcement_id = $1 AND user_id = $2',
        [id, userId]
      );

      if (existingRead.rows.length > 0) {
        // Already read, just return success
        return res.json({
          success: true,
          message: 'Announcement already marked as read',
          data: existingRead.rows[0],
        });
      }

      // Mark as read
      const result = await query(
        'INSERT INTO announcement_readstbl (announcement_id, user_id) VALUES ($1, $2) RETURNING *',
        [id, userId]
      );

      res.json({
        success: true,
        message: 'Announcement marked as read',
        data: result.rows[0],
      });
    } catch (error) {
      console.error('Error marking announcement as read:', error);
      
      // Handle unique constraint violation (already read)
      if (error.code === '23505') {
        return res.json({
          success: true,
          message: 'Announcement already marked as read',
        });
      }
      
      next(error);
    }
  }
);

export default router;

