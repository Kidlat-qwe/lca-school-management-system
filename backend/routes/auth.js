import express from 'express';
import { body } from 'express-validator';
import { verifyFirebaseToken } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query } from '../config/database.js';
import admin from '../config/firebase.js';
import { createFirebaseUser } from '../utils/firebaseAuthRest.js';

const router = express.Router();

/**
 * POST /api/v1/auth/verify
 * Verify Firebase token and return user info
 */
router.post(
  '/verify',
  verifyFirebaseToken,
  async (req, res, next) => {
    try {
      res.json({
        success: true,
        message: 'Token verified successfully',
        user: req.user,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/auth/sync-user
 * Sync Firebase user with database
 */
router.post(
  '/sync-user',
  [
    body('firebase_uid').notEmpty().withMessage('Firebase UID is required'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('full_name').notEmpty().withMessage('Full name is required'),
    body('user_type').isIn(['Superadmin', 'Admin', 'Finance', 'Teacher', 'Student']).withMessage('Invalid user type'),
    handleValidationErrors,
  ],
  verifyFirebaseToken,
  async (req, res, next) => {
    try {
      const { firebase_uid, email, full_name, user_type, branch_id, gender, date_of_birth, phone_number, level_tag } = req.body;

      // Verify that the Firebase UID from the token matches the one in the request
      if (req.user.uid !== firebase_uid) {
        return res.status(403).json({
          success: false,
          message: 'Firebase UID mismatch. Token UID does not match request UID.',
        });
      }

      console.log('Syncing user to PostgreSQL:', { firebase_uid, email, user_type });

      // Check if user already exists
      const existingUser = await query(
        'SELECT user_id FROM userstbl WHERE firebase_uid = $1 OR email = $2',
        [firebase_uid, email]
      );

      if (existingUser.rows.length > 0) {
        // Update existing user
        console.log('Updating existing user in PostgreSQL...');
        const result = await query(
          `UPDATE userstbl 
           SET email = $1, full_name = $2, user_type = $3, branch_id = $4, 
               gender = $5, date_of_birth = $6, phone_number = $7, level_tag = $8
           WHERE firebase_uid = $9
           RETURNING *`,
          [email, full_name, user_type, branch_id || null, gender || null, date_of_birth || null, phone_number || null, level_tag || null, firebase_uid]
        );

        console.log('✅ User updated in PostgreSQL:', result.rows[0].user_id);

        return res.json({
          success: true,
          message: 'User updated successfully',
          user: result.rows[0],
        });
      } else {
        // Create new user in PostgreSQL
        console.log('Creating new user in PostgreSQL...');
        const result = await query(
          `INSERT INTO userstbl (firebase_uid, email, full_name, user_type, branch_id, gender, date_of_birth, phone_number, level_tag)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *`,
          [firebase_uid, email, full_name, user_type, branch_id || null, gender || null, date_of_birth || null, phone_number || null, level_tag || null]
        );

        console.log('✅ User created in PostgreSQL:', result.rows[0].user_id);

        return res.status(201).json({
          success: true,
          message: 'User created successfully in both Firebase and PostgreSQL',
          user: result.rows[0],
        });
      }
    } catch (error) {
      console.error('Error syncing user to PostgreSQL:', error);
      next(error);
    }
  }
);

/**
 * POST /api/v1/auth/create-user
 * Create a new user using Firebase Admin SDK (doesn't sign them in)
 * Access: Superadmin, Admin
 */
router.post(
  '/create-user',
  [
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('full_name').notEmpty().withMessage('Full name is required'),
    body('user_type').isIn(['Superadmin', 'Admin', 'Finance', 'Teacher', 'Student']).withMessage('Invalid user type'),
    handleValidationErrors,
  ],
  verifyFirebaseToken,
  async (req, res, next) => {
    try {
      // Only Superadmin and Admin can create users
      if (req.user.userType !== 'Superadmin' && req.user.userType !== 'Admin') {
        return res.status(403).json({
          success: false,
          message: 'Access denied. Only Superadmin and Admin can create users.',
        });
      }

      const { email, password, full_name, user_type, branch_id, gender, date_of_birth, phone_number, level_tag } = req.body;

      console.log('Creating user via Firebase Auth REST API:', { email, user_type });

      // Step 1: Create user in Firebase using REST API (doesn't sign them in)
      let firebaseUser;
      try {
        firebaseUser = await createFirebaseUser(email, password, false);
        console.log('✅ User created in Firebase via REST API:', firebaseUser.uid);
      } catch (firebaseError) {
        if (firebaseError.message === 'EMAIL_EXISTS') {
          return res.status(400).json({
            success: false,
            message: 'This email is already registered. Please use a different email.',
          });
        } else if (firebaseError.message === 'WEAK_PASSWORD') {
          return res.status(400).json({
            success: false,
            message: 'Password is too weak. Please use a stronger password.',
          });
        } else if (firebaseError.message === 'INVALID_EMAIL') {
          return res.status(400).json({
            success: false,
            message: 'Invalid email address.',
          });
        }
        console.error('Firebase REST API error:', firebaseError);
        throw firebaseError;
      }

      // Step 2: Create user in PostgreSQL
      try {
        const result = await query(
          `INSERT INTO userstbl (firebase_uid, email, full_name, user_type, branch_id, gender, date_of_birth, phone_number, level_tag)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *`,
          [firebaseUser.uid, email, full_name, user_type, branch_id || null, gender || null, date_of_birth || null, phone_number || null, level_tag || null]
        );

        console.log('✅ User created in PostgreSQL:', result.rows[0].user_id);

        return res.status(201).json({
          success: true,
          message: 'User created successfully',
          user: result.rows[0],
        });
      } catch (dbError) {
        console.error('❌ Database error creating user in PostgreSQL:', {
          message: dbError.message,
          code: dbError.code,
          detail: dbError.detail,
          constraint: dbError.constraint,
          table: dbError.table,
          column: dbError.column,
          stack: dbError.stack
        });
        
        // If PostgreSQL insert fails, delete the Firebase user to maintain consistency
        // Use Admin SDK for deletion (as per requirements)
        try {
          await admin.auth().deleteUser(firebaseUser.uid);
          console.log('🗑️ Rolled back Firebase user creation due to database error');
        } catch (deleteError) {
          console.error('Error deleting Firebase user during rollback:', deleteError);
        }
        throw dbError;
      }
    } catch (error) {
      console.error('Error creating user:', error);
      next(error);
    }
  }
);

export default router;

