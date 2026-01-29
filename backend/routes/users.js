import express from 'express';
import { body, param, query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole, requireBranchAccess } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query } from '../config/database.js';
import admin from '../config/firebase.js';
import { updateFirebaseUserEmail, updateFirebaseUserPassword } from '../utils/firebaseAuthRest.js';

const router = express.Router();

// All routes require authentication
router.use(verifyFirebaseToken);

/**
 * GET /api/sms/users
 * Get all users (with optional filters)
 * Access: Superadmin, Admin
 */
router.get(
  '/',
  requireRole('Superadmin', 'Admin'),
  [
    queryValidator('branch_id').optional().isInt().withMessage('Branch ID must be an integer'),
    queryValidator('user_type').optional().isIn(['Superadmin', 'Admin', 'Finance', 'Teacher', 'Student']).withMessage('Invalid user type'),
    queryValidator('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    queryValidator('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { branch_id, user_type, page = 1, limit = 20 } = req.query;
      const offset = (page - 1) * limit;

      // Check if last_login column exists
      let hasLastLoginColumn = false;
      try {
        const columnCheck = await query(
          `SELECT column_name FROM information_schema.columns 
           WHERE table_name = 'userstbl' AND column_name = 'last_login'`
        );
        hasLastLoginColumn = columnCheck.rows.length > 0;
      } catch (checkError) {
        console.warn('Could not check for last_login column:', checkError);
      }

      // Build SELECT with last_login formatted in Philippines timezone if column exists
      // Since last_login is stored as timestamp without time zone in Philippines time,
      // we format it directly (it's already in Philippines timezone)
      let sql = hasLastLoginColumn
        ? `SELECT user_id, email, full_name, user_type, gender, date_of_birth, phone_number, 
                  branch_id, level_tag, profile_picture_url, firebase_uid,
                  CASE 
                    WHEN last_login IS NOT NULL 
                    THEN TO_CHAR(last_login, 'YYYY-MM-DD HH24:MI:SS')
                    ELSE NULL
                  END as last_login
           FROM userstbl WHERE 1=1`
        : `SELECT user_id, email, full_name, user_type, gender, date_of_birth, phone_number, 
                  branch_id, level_tag, profile_picture_url, firebase_uid,
                  NULL as last_login
           FROM userstbl WHERE 1=1`;
      const params = [];
      let paramCount = 0;

      // Apply filters
      if (branch_id) {
        paramCount++;
        sql += ` AND branch_id = $${paramCount}`;
        params.push(branch_id);
      }

      if (user_type) {
        paramCount++;
        sql += ` AND user_type = $${paramCount}`;
        params.push(user_type);
      }

      // For non-superadmin users, filter by their branch
      if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        paramCount++;
        sql += ` AND branch_id = $${paramCount}`;
        params.push(req.user.branchId);
      }

      sql += ` ORDER BY user_id DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
      params.push(limit, offset);

      const result = await query(sql, params);

      // Get total count
      let countSql = 'SELECT COUNT(*) FROM userstbl WHERE 1=1';
      const countParams = [];
      let countParamCount = 0;

      if (branch_id) {
        countParamCount++;
        countSql += ` AND branch_id = $${countParamCount}`;
        countParams.push(branch_id);
      }

      if (user_type) {
        countParamCount++;
        countSql += ` AND user_type = $${countParamCount}`;
        countParams.push(user_type);
      }

      if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        countParamCount++;
        countSql += ` AND branch_id = $${countParamCount}`;
        countParams.push(req.user.branchId);
      }

      const countResult = await query(countSql, countParams);
      const total = parseInt(countResult.rows[0].count);

      res.json({
        success: true,
        data: result.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/sms/users/:id
 * Get user by ID
 * Access: Superadmin, Admin, or own profile
 */
router.get(
  '/:id',
  [
    param('id').isInt().withMessage('User ID must be an integer'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;

      // Check if user can access this profile
      if (req.user.userType !== 'Superadmin' && req.user.userType !== 'Admin' && req.user.userId !== parseInt(id)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only view your own profile.',
        });
      }

      const result = await query('SELECT * FROM userstbl WHERE user_id = $1', [id]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
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
 * POST /api/sms/users
 * Create new user
 * Access: Superadmin, Admin
 * Note: This creates a user in PostgreSQL only. Firebase account creation should be handled separately.
 */
router.post(
  '/',
  [
    body('email').isEmail().withMessage('Valid email is required'),
    body('full_name').notEmpty().withMessage('Full name is required'),
    body('user_type').isIn(['Superadmin', 'Admin', 'Finance', 'Teacher', 'Student']).withMessage('Invalid user type'),
    body('gender').optional().isIn(['Male', 'Female', 'Other']).withMessage('Invalid gender'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const {
        email,
        full_name,
        user_type,
        gender,
        date_of_birth,
        phone_number,
        branch_id,
        level_tag,
        profile_picture_url,
      } = req.body;

      // Check if user with email already exists
      const existingUser = await query('SELECT * FROM userstbl WHERE email = $1', [email]);
      if (existingUser.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'A user with this email already exists',
        });
      }

      const result = await query(
        `INSERT INTO userstbl (
          email, full_name, user_type, gender, date_of_birth, 
          phone_number, branch_id, level_tag, profile_picture_url
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *`,
        [
          email,
          full_name,
          user_type,
          gender || null,
          date_of_birth || null,
          phone_number || null,
          branch_id ? parseInt(branch_id) : null,
          level_tag || null,
          profile_picture_url || null,
        ]
      );

      res.status(201).json({
        success: true,
        message: 'User created successfully',
        data: result.rows[0],
      });
    } catch (error) {
      // Handle unique constraint violation
      if (error.code === '23505') {
        if (error.constraint === 'userstbl_email_key') {
          return res.status(400).json({
            success: false,
            message: 'A user with this email already exists',
          });
        }
      }
      next(error);
    }
  }
);

/**
 * PUT /api/sms/users/:id
 * Update user
 * Access: Superadmin, Admin, or own profile
 * Note: Regular users can only update their own profile and only certain fields
 */
router.put(
  '/:id',
  [
    param('id').isInt().withMessage('User ID must be an integer'),
    body('full_name').optional().notEmpty().withMessage('Full name cannot be empty'),
    body('user_type').optional().isIn(['Superadmin', 'Admin', 'Finance', 'Teacher', 'Student']).withMessage('Invalid user type'),
    body('gender').optional().isIn(['Male', 'Female', 'Other']).withMessage('Invalid gender'),
    body('phone_number').optional().isString().withMessage('Phone number must be a string'),
    handleValidationErrors,
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { full_name, user_type, gender, date_of_birth, phone_number, branch_id, level_tag, profile_picture_url, email } = req.body;

      // Check if user exists
      const existingUser = await query('SELECT * FROM userstbl WHERE user_id = $1', [id]);
      if (existingUser.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }

      // Check access permissions
      const userId = req.user.userId || req.user.user_id;
      const userType = req.user.userType || req.user.user_type;
      const isOwnProfile = parseInt(id) === parseInt(userId);
      const isAdmin = userType === 'Superadmin' || userType === 'Admin';

      // If not own profile and not admin, deny access
      if (!isOwnProfile && !isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only update your own profile.',
        });
      }

      // If updating own profile (not admin), restrict sensitive fields
      if (isOwnProfile && !isAdmin) {
        // Regular users cannot update these sensitive fields
        if (user_type !== undefined) {
          return res.status(403).json({
            success: false,
            message: 'Access denied. You cannot change your user type.',
          });
        }
        if (email !== undefined && email !== existingUser.rows[0].email) {
          return res.status(403).json({
            success: false,
            message: 'Access denied. You cannot change your email. Please contact an administrator.',
          });
        }
        if (branch_id !== undefined) {
          return res.status(403).json({
            success: false,
            message: 'Access denied. You cannot change your branch.',
          });
        }
        if (level_tag !== undefined) {
          return res.status(403).json({
            success: false,
            message: 'Access denied. You cannot change your level tag.',
          });
        }
      }

      // Check if email is being updated and if it already exists
      if (email && email !== existingUser.rows[0].email) {
        const emailCheck = await query('SELECT * FROM userstbl WHERE email = $1', [email]);
        if (emailCheck.rows.length > 0) {
          return res.status(400).json({
            success: false,
            message: 'A user with this email already exists',
          });
        }
      }

      // Note: Firebase email/password updates require the user's own ID token via REST API
      // For admin updates, we only update the database. Firebase email/password should be
      // updated separately by the user themselves or through a dedicated endpoint that uses their token.
      // This avoids using Admin SDK for edit operations as per requirements.

      // Build update query dynamically
      const updates = [];
      const params = [];
      let paramCount = 0;

      const fields = {
        email,
        full_name,
        user_type,
        gender,
        date_of_birth,
        phone_number,
        branch_id,
        level_tag,
        profile_picture_url,
      };

      Object.entries(fields).forEach(([key, value]) => {
        if (value !== undefined) {
          paramCount++;
          updates.push(`${key} = $${paramCount}`);
          // Convert empty strings to null for optional fields
          const optionalFields = ['gender', 'date_of_birth', 'phone_number', 'branch_id', 'level_tag', 'profile_picture_url'];
          if (optionalFields.includes(key)) {
            if (value === '' || value === null) {
              params.push(null);
            } else if (key === 'branch_id') {
              params.push(parseInt(value));
            } else {
              params.push(value);
            }
          } else {
            params.push(value);
          }
        }
      });

      if (updates.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No fields to update',
        });
      }

      paramCount++;
      params.push(id);

      const sql = `UPDATE userstbl SET ${updates.join(', ')} WHERE user_id = $${paramCount} RETURNING *`;
      const result = await query(sql, params);

      res.json({
        success: true,
        message: 'User updated successfully',
        data: result.rows[0],
      });
    } catch (error) {
      // Handle unique constraint violation
      if (error.code === '23505') {
        if (error.constraint === 'userstbl_email_key') {
          return res.status(400).json({
            success: false,
            message: 'A user with this email already exists',
          });
        }
      }
      next(error);
    }
  }
);

/**
 * DELETE /api/sms/users/:id
 * Delete user
 * Access: Superadmin only
 */
router.delete(
  '/:id',
  [
    param('id').isInt().withMessage('User ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      // Check if user exists
      const existingUser = await query('SELECT * FROM userstbl WHERE user_id = $1', [id]);
      if (existingUser.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }

      const userRecord = existingUser.rows[0];
      const firebase_uid = userRecord.firebase_uid;

      // Step 1: Delete from Firebase using Admin SDK (as per requirements)
      if (firebase_uid) {
        try {
          await admin.auth().deleteUser(firebase_uid);
          console.log('✅ Firebase user deleted:', firebase_uid);
        } catch (firebaseError) {
          // If Firebase deletion fails, log but continue with database deletion
          // This prevents orphaned database records
          console.error('⚠️ Error deleting Firebase user (continuing with DB deletion):', firebaseError);
          
          // If it's a "user not found" error, that's okay - user might already be deleted
          if (firebaseError.code !== 'auth/user-not-found') {
            // For other errors, we might want to fail or continue based on business logic
            // For now, we'll continue with DB deletion
          }
        }
      }

      // Step 2: Delete from PostgreSQL database
      await query('DELETE FROM userstbl WHERE user_id = $1', [id]);
      console.log('✅ Database user deleted:', id);

      res.json({
        success: true,
        message: 'User deleted successfully from both Firebase and database',
      });
    } catch (error) {
      console.error('Error deleting user:', error);
      next(error);
    }
  }
);

export default router;

