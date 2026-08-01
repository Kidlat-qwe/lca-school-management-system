import admin from 'firebase-admin';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Env is loaded by loadEnv.js ( .env then .env.${NODE_ENV} ) before this module runs
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Coolify / Docker often mangle FIREBASE_PRIVATE_KEY (quotes, literal \\n, double-escaped).
 * Also supports FIREBASE_PRIVATE_KEY_BASE64 (recommended on Coolify).
 */
const normalizeFirebasePrivateKey = (raw) => {
  if (raw == null) return null;
  let key = String(raw).trim();
  if (!key) return null;

  // Strip wrapping quotes Coolify sometimes keeps
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }

  // Literal backslash-n → real newlines (repeat for double-escaping)
  for (let i = 0; i < 3; i += 1) {
    if (key.includes('\\n')) key = key.replace(/\\n/g, '\n');
    else break;
  }

  // Normalize Windows newlines
  key = key.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  return key;
};

const resolveFirebasePrivateKey = () => {
  const b64 = String(process.env.FIREBASE_PRIVATE_KEY_BASE64 || '').trim();
  if (b64) {
    try {
      // Decode then normalize (handles whitespace / accidental quotes around the base64 blob)
      const decoded = Buffer.from(b64.replace(/\s+/g, ''), 'base64').toString('utf8');
      const normalized = normalizeFirebasePrivateKey(decoded);
      if (normalized && normalized.includes('BEGIN PRIVATE KEY')) {
        return normalized;
      }
      console.warn(
        '⚠️  FIREBASE_PRIVATE_KEY_BASE64 decoded but result is not a PEM private key. ' +
          'Encode only the private_key string from the service-account JSON, not the whole JSON file.'
      );
    } catch (_) {
      console.warn('⚠️  FIREBASE_PRIVATE_KEY_BASE64 is set but could not be decoded');
    }
  }
  return normalizeFirebasePrivateKey(process.env.FIREBASE_PRIVATE_KEY);
};

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  try {
    let credential;

    // Option 1: Use JSON file if path is provided via environment variable
    // To use this: Set FIREBASE_ADMIN_SDK_PATH in .env to the path of your Admin SDK JSON file
    // Example: FIREBASE_ADMIN_SDK_PATH=./config/psms-b9ca7-firebase-adminsdk-xxxxx.json
    const adminSdkPath = process.env.FIREBASE_ADMIN_SDK_PATH;
    
    if (adminSdkPath) {
      // Resolve path: try multiple locations
      let resolvedPath = null;
      const pathsToTry = [
        // 1. Relative to current working directory
        resolve(process.cwd(), adminSdkPath),
        // 2. Relative to backend directory (if running from root)
        resolve(process.cwd(), 'backend', adminSdkPath),
        // 3. Relative to this file's directory
        resolve(__dirname, adminSdkPath.replace(/^\.\//, '')),
        // 4. Absolute path (if provided)
        adminSdkPath.startsWith('/') || (process.platform === 'win32' && /^[A-Za-z]:/.test(adminSdkPath)) 
          ? adminSdkPath 
          : null,
      ].filter(Boolean);

      for (const pathToTry of pathsToTry) {
        if (existsSync(pathToTry)) {
          resolvedPath = pathToTry;
          break;
        }
      }
      
      if (resolvedPath) {
        // Use JSON file (preferred method when available)
        credential = admin.credential.cert(resolvedPath);
        console.log('✅ Firebase Admin initialized from JSON file:', resolvedPath);
      } else {
        console.warn('⚠️  FIREBASE_ADMIN_SDK_PATH is set but file not found:', adminSdkPath);
        console.warn('   Tried paths:');
        pathsToTry.forEach(path => console.warn('   -', path));
        console.warn('   Falling back to environment variables...');
        // Fall through to environment variables
      }
    }

    // Option 2: Use environment variables (fallback method)
    if (!credential) {
      const projectId = process.env.FIREBASE_PROJECT_ID;
      const privateKey = resolveFirebasePrivateKey();
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

      // Validate required fields
      if (!projectId || !privateKey || !clientEmail) {
        throw new Error(
          'Missing required Firebase environment variables. ' +
          'Either set FIREBASE_ADMIN_SDK_PATH to a valid JSON file path, ' +
          'or provide FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY ' +
          '(or FIREBASE_PRIVATE_KEY_BASE64 on Coolify).'
        );
      }

      if (!privateKey.includes('BEGIN PRIVATE KEY')) {
        throw new Error(
          'FIREBASE_PRIVATE_KEY does not look like a PEM key after normalization. ' +
          'On Coolify: use Normal view, enable Is Multiline for FIREBASE_PRIVATE_KEY, ' +
          'paste the key with real line breaks (no \\n), or use FIREBASE_PRIVATE_KEY_BASE64.'
        );
      }

      const serviceAccount = {
        projectId: projectId,
        privateKeyId: process.env.FIREBASE_PRIVATE_KEY_ID,
        privateKey: privateKey,
        clientEmail: clientEmail,
        clientId: process.env.FIREBASE_CLIENT_ID,
        authUri: process.env.FIREBASE_AUTH_URI || 'https://accounts.google.com/o/oauth2/auth',
        tokenUri: process.env.FIREBASE_TOKEN_URI || 'https://oauth2.googleapis.com/token',
        authProviderX509CertUrl: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL || 'https://www.googleapis.com/oauth2/v1/certs',
        clientX509CertUrl: process.env.FIREBASE_CLIENT_X509_CERT_URL,
      };

      credential = admin.credential.cert(serviceAccount);
      console.log('✅ Firebase Admin initialized from environment variables');
    }

    admin.initializeApp({
      credential,
      projectId: process.env.FIREBASE_PROJECT_ID || 'psms-b9ca7',
    });

    console.log('✅ Firebase Admin initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing Firebase Admin:', error);
    console.error('💡 To use Admin SDK JSON file:');
    console.error('   1. Download the Admin SDK JSON file from Firebase Console');
    console.error('   2. Place it in the backend/config/ directory');
    console.error('   3. Set FIREBASE_ADMIN_SDK_PATH in .env to the file path');
    console.error('   Example: FIREBASE_ADMIN_SDK_PATH=./config/psms-b9ca7-firebase-adminsdk-xxxxx.json');
    console.error('   OR ensure all Firebase environment variables are set in .env file');
    throw error;
  }
}

export default admin;

