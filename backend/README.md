# Physical School Management System - Backend API

## Overview

This is the backend API server for the Physical School Management System. It provides RESTful endpoints for managing schools, branches, users, classes, students, programs, and related entities.

## Technology Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: PostgreSQL
- **Authentication**: Firebase Admin SDK
- **Security**: Helmet, CORS
- **Validation**: express-validator

## Project Structure

```
backend/
├── src/
│   ├── config/
│   │   ├── database.js      # PostgreSQL connection configuration
│   │   └── firebase.js      # Firebase Admin SDK initialization
│   ├── middleware/
│   │   ├── auth.js          # Firebase token verification & RBAC
│   │   ├── errorHandler.js  # Global error handling
│   │   └── validation.js    # Request validation helpers
│   ├── routes/
│   │   ├── auth.js          # Authentication routes
│   │   ├── users.js         # User management routes
│   │   ├── branches.js      # Branch management routes
│   │   ├── classes.js       # Class management routes
│   │   ├── students.js      # Student enrollment routes
│   │   ├── programs.js      # Program management routes
│   │   ├── rooms.js         # Room management routes
│   │   └── curriculum.js    # Curriculum management routes
│   └── server.js            # Main server file
├── .env.example             # Environment variables template
├── .gitignore
├── package.json
└── README.md
```

## Setup Instructions

### Prerequisites

- Node.js (v18 or higher)
- PostgreSQL (v12 or higher)
- Firebase project with Admin SDK credentials

### Installation

1. **Clone the repository and navigate to backend directory**

```bash
cd backend
```

2. **Install dependencies**

```bash
npm install
```

3. **Set up environment variables**

Copy `.env.example` to `.env` and fill in your configuration:

```bash
cp .env.example .env
```

Edit `.env` with your actual values:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=physical_school_db
DB_USER=postgres
DB_PASSWORD=your_password
DB_SSL=false

# Firebase Configuration
FIREBASE_PROJECT_ID=your_firebase_project_id
FIREBASE_PRIVATE_KEY_ID=your_private_key_id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour private key here\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=your_client_email
FIREBASE_CLIENT_ID=your_client_id
FIREBASE_AUTH_URI=https://accounts.google.com/o/oauth2/auth
FIREBASE_TOKEN_URI=https://oauth2.googleapis.com/token
FIREBASE_AUTH_PROVIDER_X509_CERT_URL=https://www.googleapis.com/oauth2/v1/certs
FIREBASE_CLIENT_X509_CERT_URL=your_cert_url

# CORS Configuration
CORS_ORIGIN=http://localhost:5173
```

4. **Set up the database**

Run the SQL script from `docs/DATABASE.md` to create all necessary tables:

```bash
psql -U postgres -d physical_school_db -f ../docs/DATABASE.md
```

Or manually execute the SQL statements in your PostgreSQL client.

5. **Set up Firebase**

- Create a Firebase project at https://console.firebase.google.com
- Go to Project Settings > Service Accounts
- Generate a new private key
- Copy the credentials to your `.env` file

## NODE_ENV and database (development vs production)

**Single `.env` file:** Put both database configs in `backend/.env` using suffixed keys:

- **Development:** `DB_HOST_DEVELOPMENT`, `DB_NAME_DEVELOPMENT`, `DB_PORT_DEVELOPMENT`, `DB_USER_DEVELOPMENT`, `DB_PASSWORD_DEVELOPMENT`, `DB_SSL_DEVELOPMENT`
- **Production:** `DB_HOST_PRODUCTION`, `DB_NAME_PRODUCTION`, etc.

Set **`NODE_ENV=development`** or **`NODE_ENV=production`** in `.env` (or when starting). The app uses the matching set (e.g. when NODE_ENV=production it uses `DB_*_PRODUCTION`). No separate .env.development/.env.production needed.

### Development Mode (development DB)

```bash
npm run dev
```

Runs with `NODE_ENV=development`, loads `.env.development`, uses development database. Nodemon auto-reloads on file changes.

### Production Mode (production DB)

```bash
npm run start:prod
```

Runs with `NODE_ENV=production`, loads `.env.production`, uses production database. Use this on Linode or when you want prod DB.

### Start (uses NODE_ENV from `.env`)

```bash
npm start
```

Uses `NODE_ENV` from `backend/.env` (or defaults to development). Set `NODE_ENV=development` or `NODE_ENV=production` in `.env` to choose which config/DB to use.

### Deployment on Linode (use production database)

On the server, the app must run with **NODE_ENV=production** so it loads `.env.production` and uses the production database (not development).

**Option 1 – start script (Linux/Linode):**

```bash
npm run start:prod
```

**Option 2 – set in backend `.env` on the server:**

In `backend/.env` on Linode, set:

```env
NODE_ENV=production
```

Then start with `npm start`. Ensure `backend/.env.production` exists on the server with production DB credentials (or that `.env` has them when NODE_ENV=production).

## API Endpoints

### Base URL

All API endpoints are prefixed with `/api/v1`

### Authentication

All endpoints (except `/health` and `/api/v1/auth/*`) require authentication via Firebase ID token in the Authorization header:

```
Authorization: Bearer <firebase_id_token>
```

### Available Endpoints

#### Authentication
- `POST /api/v1/auth/verify` - Verify Firebase token
- `POST /api/v1/auth/sync-user` - Sync Firebase user with database

#### Users
- `GET /api/v1/users` - Get all users (with pagination and filters)
- `GET /api/v1/users/:id` - Get user by ID
- `PUT /api/v1/users/:id` - Update user
- `DELETE /api/v1/users/:id` - Delete user

#### Branches
- `GET /api/v1/branches` - Get all branches
- `GET /api/v1/branches/:id` - Get branch by ID
- `POST /api/v1/branches` - Create new branch
- `PUT /api/v1/branches/:id` - Update branch
- `DELETE /api/v1/branches/:id` - Delete branch

#### Classes
- `GET /api/v1/classes` - Get all classes
- `GET /api/v1/classes/:id` - Get class by ID
- `POST /api/v1/classes` - Create new class
- `PUT /api/v1/classes/:id` - Update class
- `DELETE /api/v1/classes/:id` - Delete class

#### Students
- `POST /api/v1/students/enroll` - Enroll student in class
- `DELETE /api/v1/students/unenroll/:enrollmentId` - Unenroll student
- `GET /api/v1/students/class/:classId` - Get all students in a class
- `GET /api/v1/students/:studentId/classes` - Get all classes for a student

#### Programs
- `GET /api/v1/programs` - Get all programs
- `GET /api/v1/programs/:id` - Get program by ID
- `POST /api/v1/programs` - Create new program
- `PUT /api/v1/programs/:id` - Update program
- `DELETE /api/v1/programs/:id` - Delete program

#### Rooms
- `GET /api/v1/rooms` - Get all rooms
- `POST /api/v1/rooms` - Create new room
- `PUT /api/v1/rooms/:id` - Update room
- `DELETE /api/v1/rooms/:id` - Delete room

#### Curriculum
- `GET /api/v1/curriculum` - Get all curricula
- `POST /api/v1/curriculum` - Create new curriculum
- `PUT /api/v1/curriculum/:id` - Update curriculum

## User Roles & Permissions

The system supports the following user roles:

- **Superadmin**: Full access to all resources across all branches
- **Admin**: Full access within their assigned branch
- **Finance**: Access to billing and financial data
- **Teacher**: Access to classes and students they teach
- **Student**: Access to their own profile and enrolled classes

Role-based access control (RBAC) is enforced at the middleware level.

## Error Handling

The API uses a consistent error response format:

```json
{
  "success": false,
  "message": "Error message",
  "error": "Detailed error (development only)"
}
```

Common HTTP status codes:
- `200` - Success
- `201` - Created
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (missing/invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `409` - Conflict (duplicate entry)
- `500` - Internal Server Error

## Database Connection

The database connection is managed using a connection pool. The pool configuration can be adjusted in `src/config/database.js`.

## Security Features

- **Helmet**: Sets various HTTP headers for security
- **CORS**: Configurable cross-origin resource sharing
- **Firebase Authentication**: Token-based authentication
- **Input Validation**: Request validation using express-validator
- **SQL Injection Protection**: Parameterized queries
- **Error Handling**: Secure error messages (detailed errors only in development)

## Development

### Code Style

- Use ES6+ JavaScript features
- Follow async/await pattern for asynchronous operations
- Use meaningful variable and function names
- Add comments for complex logic

### Adding New Routes

1. Create a new route file in `src/routes/`
2. Import and use it in `src/server.js`
3. Follow the existing pattern for authentication and validation
4. Update this README with the new endpoints

## Troubleshooting

### Database Connection Issues

- Verify PostgreSQL is running
- Check database credentials in `.env`
- Ensure the database exists
- Check network connectivity

### Firebase Authentication Issues

- Verify Firebase credentials in `.env`
- Ensure private key is properly formatted (with `\n` for newlines)
- Check Firebase project settings

### Port Already in Use

Change the `PORT` in `.env` or kill the process using the port:

```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Linux/Mac
lsof -ti:3000 | xargs kill
```

## License

ISC

