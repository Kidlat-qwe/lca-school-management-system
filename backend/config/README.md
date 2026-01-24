# Configuration Module

This module contains configuration files for database and Firebase connections.

## Files

### database.js

PostgreSQL database connection configuration using connection pooling.

**Exports:**
- `query(text, params)` - Execute a query with parameters
- `getClient()` - Get a client from the pool for transactions
- `default` - The connection pool instance

**Usage:**
```javascript
import { query, getClient } from './config/database.js';

// Simple query
const result = await query('SELECT * FROM users WHERE id = $1', [userId]);

// Transaction
const client = await getClient();
try {
  await client.query('BEGIN');
  // ... multiple queries ...
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

### firebase.js

Firebase Admin SDK initialization for server-side authentication.

**Exports:**
- `default` - Firebase Admin instance

**Usage:**
```javascript
import admin from './config/firebase.js';

// Verify ID token
const decodedToken = await admin.auth().verifyIdToken(idToken);
```

**Configuration Methods:**

The Firebase Admin SDK can be configured in two ways (in order of preference):

1. **Using Admin SDK JSON File (Recommended)**:
   - Download the Admin SDK JSON file from Firebase Console
   - Place it in the `backend/config/` directory
   - Set `FIREBASE_ADMIN_SDK_PATH` in `.env` to the file path
   - Example: `FIREBASE_ADMIN_SDK_PATH=./config/psms-b9ca7-firebase-adminsdk-xxxxx.json`

2. **Using Environment Variables (Fallback)**:
   - Set individual Firebase credentials in `.env`:
     - `FIREBASE_PROJECT_ID`
     - `FIREBASE_PRIVATE_KEY`
     - `FIREBASE_CLIENT_EMAIL`
     - `FIREBASE_CLIENT_ID`
     - etc.

## Environment Variables

Both modules require environment variables to be set in `.env`:

- Database: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL`
- Firebase: 
  - `FIREBASE_PROJECT_ID` (required)
  - `FIREBASE_ADMIN_SDK_PATH` (optional, if using JSON file method)
  - OR individual Firebase credentials (if using environment variables method)

