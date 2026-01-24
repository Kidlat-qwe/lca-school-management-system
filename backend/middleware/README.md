# Middleware Module

This module contains Express middleware functions for authentication, authorization, validation, and error handling.

## Files

### auth.js

Firebase authentication and role-based access control middleware.

**Exports:**
- `verifyFirebaseToken` - Middleware to verify Firebase ID token
- `requireRole(...allowedRoles)` - Middleware factory to check user roles
- `requireBranchAccess` - Middleware to check branch access permissions

**Usage:**
```javascript
import { verifyFirebaseToken, requireRole } from './middleware/auth.js';

// Protect route with authentication
router.get('/protected', verifyFirebaseToken, handler);

// Require specific role
router.post('/admin-only', verifyFirebaseToken, requireRole('Superadmin', 'Admin'), handler);
```

### errorHandler.js

Global error handling middleware.

**Exports:**
- `errorHandler` - Global error handler (must be last middleware)
- `notFoundHandler` - 404 handler for undefined routes

**Usage:**
```javascript
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

app.use(notFoundHandler);
app.use(errorHandler);
```

### validation.js

Request validation helpers using express-validator.

**Exports:**
- `handleValidationErrors` - Middleware to handle validation errors

**Usage:**
```javascript
import { body } from 'express-validator';
import { handleValidationErrors } from './middleware/validation.js';

router.post('/users',
  [
    body('email').isEmail(),
    body('name').notEmpty(),
    handleValidationErrors,
  ],
  handler
);
```

