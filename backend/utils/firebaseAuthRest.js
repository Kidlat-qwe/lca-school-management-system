/**
 * Firebase Auth REST API Utility
 * 
 * This utility handles Firebase user operations using the REST API instead of Admin SDK.
 * This avoids issues with Admin SDK for create/edit operations.
 * 
 * Note: Admin SDK is still used for DELETE operations as it's more reliable for that.
 */

// Firebase configuration from environment variables
// Get API key from .env file (same as frontend Firebase config)
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const FIREBASE_AUTH_DOMAIN = process.env.FIREBASE_AUTH_DOMAIN || 'psms-b9ca7.firebaseapp.com';
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'psms-b9ca7';

if (!FIREBASE_API_KEY) {
  console.warn('⚠️  FIREBASE_API_KEY not set in environment variables. Firebase Auth REST API operations will fail.');
  console.warn('   Add FIREBASE_API_KEY to your .env file (get it from Firebase Console > Project Settings > General > Web API Key)');
}

const FIREBASE_AUTH_BASE_URL = `https://identitytoolkit.googleapis.com/v1`;

/**
 * Create a new Firebase user using REST API
 * This creates the user without signing them in
 * 
 * @param {string} email - User email
 * @param {string} password - User password
 * @param {boolean} emailVerified - Whether email is verified (default: false)
 * @returns {Promise<Object>} User data with uid and email
 */
export const createFirebaseUser = async (email, password, emailVerified = false) => {
  if (!FIREBASE_API_KEY) {
    throw new Error('FIREBASE_API_KEY is not configured. Please set it in your .env file.');
  }
  
  try {
    const url = `${FIREBASE_AUTH_BASE_URL}/accounts:signUp?key=${FIREBASE_API_KEY}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: email,
        password: password,
        returnSecureToken: true,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      // Handle Firebase Auth errors
      if (data.error) {
        const errorCode = data.error.message;
        
        if (errorCode.includes('EMAIL_EXISTS')) {
          throw new Error('EMAIL_EXISTS');
        } else if (errorCode.includes('WEAK_PASSWORD')) {
          throw new Error('WEAK_PASSWORD');
        } else if (errorCode.includes('INVALID_EMAIL')) {
          throw new Error('INVALID_EMAIL');
        }
        
        throw new Error(data.error.message || 'Failed to create Firebase user');
      }
      throw new Error('Failed to create Firebase user');
    }

    // Return user data (we don't use the idToken for creating users)
    return {
      uid: data.localId,
      email: data.email,
      emailVerified: emailVerified,
    };
  } catch (error) {
    console.error('Error creating Firebase user via REST API:', error);
    throw error;
  }
};

/**
 * Update Firebase user email using REST API
 * Requires the user's ID token
 * 
 * @param {string} idToken - User's Firebase ID token
 * @param {string} newEmail - New email address
 * @returns {Promise<Object>} Updated user data
 */
export const updateFirebaseUserEmail = async (idToken, newEmail) => {
  if (!FIREBASE_API_KEY) {
    throw new Error('FIREBASE_API_KEY is not configured. Please set it in your .env file.');
  }
  
  try {
    const url = `${FIREBASE_AUTH_BASE_URL}/accounts:update?key=${FIREBASE_API_KEY}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        idToken: idToken,
        email: newEmail,
        returnSecureToken: true,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      if (data.error) {
        const errorCode = data.error.message;
        
        if (errorCode.includes('EMAIL_EXISTS')) {
          throw new Error('EMAIL_EXISTS');
        } else if (errorCode.includes('INVALID_ID_TOKEN')) {
          throw new Error('INVALID_ID_TOKEN');
        }
        
        throw new Error(data.error.message || 'Failed to update Firebase user email');
      }
      throw new Error('Failed to update Firebase user email');
    }

    return {
      uid: data.localId,
      email: data.email,
      idToken: data.idToken,
      refreshToken: data.refreshToken,
    };
  } catch (error) {
    console.error('Error updating Firebase user email via REST API:', error);
    throw error;
  }
};

/**
 * Update Firebase user password using REST API
 * Requires the user's ID token
 * 
 * @param {string} idToken - User's Firebase ID token
 * @param {string} newPassword - New password
 * @returns {Promise<Object>} Updated user data
 */
export const updateFirebaseUserPassword = async (idToken, newPassword) => {
  if (!FIREBASE_API_KEY) {
    throw new Error('FIREBASE_API_KEY is not configured. Please set it in your .env file.');
  }
  
  try {
    const url = `${FIREBASE_AUTH_BASE_URL}/accounts:update?key=${FIREBASE_API_KEY}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        idToken: idToken,
        password: newPassword,
        returnSecureToken: true,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      if (data.error) {
        const errorCode = data.error.message;
        
        if (errorCode.includes('WEAK_PASSWORD')) {
          throw new Error('WEAK_PASSWORD');
        } else if (errorCode.includes('INVALID_ID_TOKEN')) {
          throw new Error('INVALID_ID_TOKEN');
        }
        
        throw new Error(data.error.message || 'Failed to update Firebase user password');
      }
      throw new Error('Failed to update Firebase user password');
    }

    return {
      uid: data.localId,
      email: data.email,
      idToken: data.idToken,
      refreshToken: data.refreshToken,
    };
  } catch (error) {
    console.error('Error updating Firebase user password via REST API:', error);
    throw error;
  }
};

/**
 * Get user info by email (for checking if user exists)
 * Note: This requires Admin SDK or a different approach
 * For now, we'll handle existence checks at the database level
 */
export const getFirebaseUserByEmail = async (email) => {
  // This would typically require Admin SDK
  // For REST API, we can't directly get user by email without Admin SDK
  // So we'll rely on database checks and error handling
  throw new Error('getFirebaseUserByEmail requires Admin SDK - use database checks instead');
};

