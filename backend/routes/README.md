# Routes Module

This module contains all API route handlers, organized by resource type.

## Route Files

### auth.js
Authentication routes:
- `POST /api/v1/auth/verify` - Verify Firebase token
- `POST /api/v1/auth/sync-user` - Sync Firebase user with database

### users.js
User management routes:
- `GET /api/v1/users` - List users (with filters and pagination)
- `GET /api/v1/users/:id` - Get user by ID
- `PUT /api/v1/users/:id` - Update user
- `DELETE /api/v1/users/:id` - Delete user

### branches.js
Branch management routes:
- `GET /api/v1/branches` - List branches
- `GET /api/v1/branches/:id` - Get branch by ID
- `POST /api/v1/branches` - Create branch
- `PUT /api/v1/branches/:id` - Update branch
- `DELETE /api/v1/branches/:id` - Delete branch

### classes.js
Class management routes:
- `GET /api/v1/classes` - List classes
- `GET /api/v1/classes/:id` - Get class by ID
- `POST /api/v1/classes` - Create class
- `PUT /api/v1/classes/:id` - Update class
- `DELETE /api/v1/classes/:id` - Delete class

### students.js
Student enrollment routes:
- `POST /api/v1/students/enroll` - Enroll student in class
- `DELETE /api/v1/students/unenroll/:enrollmentId` - Unenroll student
- `GET /api/v1/students/class/:classId` - Get students in class
- `GET /api/v1/students/:studentId/classes` - Get student's classes

### programs.js
Program management routes:
- `GET /api/v1/programs` - List programs
- `GET /api/v1/programs/:id` - Get program by ID
- `POST /api/v1/programs` - Create program
- `PUT /api/v1/programs/:id` - Update program
- `DELETE /api/v1/programs/:id` - Delete program

### rooms.js
Room management routes:
- `GET /api/v1/rooms` - List rooms
- `POST /api/v1/rooms` - Create room
- `PUT /api/v1/rooms/:id` - Update room
- `DELETE /api/v1/rooms/:id` - Delete room

### curriculum.js
Curriculum management routes:
- `GET /api/v1/curriculum` - List curricula
- `POST /api/v1/curriculum` - Create curriculum
- `PUT /api/v1/curriculum/:id` - Update curriculum

## Route Pattern

All routes follow a consistent pattern:

1. **Authentication**: Most routes require `verifyFirebaseToken` middleware
2. **Authorization**: Routes use `requireRole()` for role-based access
3. **Validation**: Request validation using `express-validator`
4. **Error Handling**: Errors are caught and passed to global error handler
5. **Response Format**: Consistent JSON response format

## Adding New Routes

1. Create a new file in this directory
2. Import necessary dependencies (express, middleware, database)
3. Create router instance: `const router = express.Router()`
4. Apply middleware: `router.use(verifyFirebaseToken)`
5. Define routes with validation and authorization
6. Export router: `export default router`
7. Import and use in `src/server.js`

