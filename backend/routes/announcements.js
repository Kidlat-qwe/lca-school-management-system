import express from 'express';
import { body, param, query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole, requireBranchAccess } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query, getClient } from '../config/database.js';

const router = express.Router();

// All routes require authentication
router.use(verifyFirebaseToken);
router.use(requireBranchAccess);

// Valid recipient groups
const VALID_RECIPIENT_GROUPS = ['All', 'Students', 'Teachers', 'Admin', 'Finance'];

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
    'Superadmin': 'Admin', // Superadmin maps to Admin for recipient group matching
    'Superfinance': 'Finance', // Superfinance maps to Finance
  };
  
  return mapping[userType] || userType; // Fallback to original if no mapping found
};

/**
 * GET /api/sms/announcements
 * Get all announcements with optional filters
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
          a.body,
          a.recipient_groups,
          a.status,
          a.priority,
          a.branch_id,
          a.created_by,
          TO_CHAR(a.created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at,
          TO_CHAR(a.updated_at, 'YYYY-MM-DD HH24:MI:SS') as updated_at,
          TO_CHAR(a.start_date, 'YYYY-MM-DD') as start_date,
          TO_CHAR(a.end_date, 'YYYY-MM-DD') as end_date,
          u.full_name as created_by_name,
          b.branch_name
        FROM announcementstbl a
        LEFT JOIN userstbl u ON a.created_by = u.user_id
        LEFT JOIN branchestbl b ON a.branch_id = b.branch_id
        WHERE 1=1
      `;
      const params = [];
      let paramCount = 0;

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

      // Order by priority (High first), then by created_at (newest first)
      sql += ` ORDER BY 
        CASE a.priority 
          WHEN 'High' THEN 1 
          WHEN 'Medium' THEN 2 
          WHEN 'Low' THEN 3 
        END,
        a.created_at DESC
        LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
      params.push(limitNum, offset);

      const result = await query(sql, params);

      // Get total count for pagination
      let countSql = `
        SELECT COUNT(*) as total
        FROM announcementstbl a
        WHERE 1=1
      `;
      const countParams = [];
      let countParamCount = 0;

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

      // Map user types to recipient groups (e.g., 'Student' -> 'Students', 'Teacher' -> 'Teachers')
      const recipientGroup = mapUserTypeToRecipientGroup(userType, userBranchId);

      // Build query to get active announcements for this user
      // Branch logic: Show announcements if:
      // 1. Announcement has no branch_id (applies to all branches)
      // 2. Announcement's branch_id matches user's branch_id
      // 3. User has no branch_id (Superadmin/Superfinance) - show all announcements
      // Note: Using COALESCE to handle case where announcement_readstbl might not exist yet
      let sql = `
        SELECT 
          a.announcement_id,
          a.title,
          a.body,
          a.recipient_groups,
          a.status,
          a.priority,
          a.branch_id,
          a.created_by,
          TO_CHAR(a.created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at,
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
            $2 = ANY(a.recipient_groups) OR 'All' = ANY(a.recipient_groups)
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
        ORDER BY 
          CASE a.priority 
            WHEN 'High' THEN 1 
            WHEN 'Medium' THEN 2 
            WHEN 'Low' THEN 3 
          END,
          a.created_at DESC
        LIMIT 20
      `;

      const params = [userId, recipientGroup, userBranchId, today];
      
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
          a.body,
          a.recipient_groups,
          a.status,
          a.priority,
          a.branch_id,
          a.created_by,
          TO_CHAR(a.created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at,
          TO_CHAR(a.updated_at, 'YYYY-MM-DD HH24:MI:SS') as updated_at,
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
    body('body').notEmpty().trim().withMessage('Body is required'),
    body('recipient_groups')
      .isArray({ min: 1 })
      .withMessage('At least one recipient group is required'),
    body('recipient_groups.*')
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
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Teacher'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const {
        title,
        body,
        recipient_groups,
        status = 'Active',
        priority = 'Medium',
        branch_id,
        start_date,
        end_date,
      } = req.body;

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
          title, body, recipient_groups, status, priority, branch_id, 
          created_by, start_date, end_date
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
        `,
        [
          title.trim(),
          body.trim(),
          recipient_groups,
          status,
          priority,
          finalBranchId,
          createdByUserId,
          start_date || null,
          end_date || null,
        ]
      );

      await client.query('COMMIT');

      res.status(201).json({
        success: true,
        message: 'Announcement created successfully',
        data: result.rows[0],
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
    body('body').optional().notEmpty().trim().withMessage('Body cannot be empty'),
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
        body,
        recipient_groups,
        status,
        priority,
        branch_id,
        start_date,
        end_date,
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
        if (announcement.created_by !== currentUserId) {
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

      if (recipient_groups !== undefined) {
        paramCount++;
        updates.push(`recipient_groups = $${paramCount}`);
        params.push(recipient_groups);
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
        if (announcement.created_by !== currentUserId) {
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

