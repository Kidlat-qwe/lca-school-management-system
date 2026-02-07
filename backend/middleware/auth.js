import admin from '../config/firebase.js';
import { query } from '../config/database.js';

/**
 * Middleware to verify Firebase ID token
 * Extracts the token from Authorization header and verifies it with Firebase
 *
 * 401 on deployed (Linode): ensure (1) Firebase Admin SDK JSON is on server (FIREBASE_ADMIN_SDK_PATH),
 * (2) same Firebase project as frontend (psms-b9ca7), (3) server clock is correct. Check server logs for the actual error.
 */
export const verifyFirebaseToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No token provided. Authorization header must be in format: Bearer <token>',
      });
    }

    const idToken = authHeader.split('Bearer ')[1];

    // Verify the token with Firebase
    const decodedToken = await admin.auth().verifyIdToken(idToken);

    // Attach user info to request
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified,
    };

    // Fetch user from database to get additional info
    const userResult = await query(
      'SELECT user_id, email, full_name, user_type, branch_id, firebase_uid, profile_picture_url FROM userstbl WHERE firebase_uid = $1',
      [decodedToken.uid]
    );

    if (userResult.rows.length > 0) {
      const dbUser = userResult.rows[0];
      req.user.userId = dbUser.user_id;
      req.user.user_id = dbUser.user_id;
      req.user.fullName = dbUser.full_name;
      req.user.full_name = dbUser.full_name;
      req.user.userType = dbUser.user_type;
      req.user.user_type = dbUser.user_type;
      req.user.branchId = dbUser.branch_id;
      req.user.branch_id = dbUser.branch_id;
      req.user.profile_picture_url = dbUser.profile_picture_url;
    }

    next();
  } catch (error) {
    const code = error.code || error.codePrefix;
    const msg = error.message || 'Unknown error';
    console.error('Token verification error:', code || msg, error);
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token',
      ...(process.env.NODE_ENV === 'development' && { error: msg, code: code || undefined }),
    });
  }
};

/**
 * Middleware to check if user has required role(s)
 * @param {string[]} allowedRoles - Array of allowed user types
 */
export const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    if (!req.user.userType) {
      return res.status(403).json({
        success: false,
        message: 'User type not found. Please complete your profile.',
      });
    }

    if (!allowedRoles.includes(req.user.userType)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role(s): ${allowedRoles.join(', ')}`,
      });
    }

    next();
  };
};

/**
 * Middleware to check if user belongs to a branch (for branch-scoped operations)
 */
export const requireBranchAccess = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required',
    });
  }

  // Superadmin can access all branches
  if (req.user.userType === 'Superadmin') {
    return next();
  }

  // Superfinance (Finance with no branch_id) can access all branches
  if (req.user.userType === 'Finance' && (req.user.branchId === null || req.user.branchId === undefined)) {
    return next();
  }

  // Other users must have a branch_id
  if (!req.user.branchId) {
    return res.status(403).json({
      success: false,
      message: 'Branch access required',
    });
  }

  next();
};

