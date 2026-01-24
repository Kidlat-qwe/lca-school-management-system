# Replit Setup Guide for Backend

This guide will help you deploy the backend API to Replit.

## Prerequisites

1. A Replit account
2. A PostgreSQL database (Neon, Supabase, Railway, or similar)
3. Firebase project with Admin SDK credentials

## Setup Steps

### 1. Import to Replit

1. Create a new Replit project
2. Import this backend folder as the root
3. Replit will automatically detect Node.js

### 2. Configure Environment Variables

1. Click on the "Secrets" tab (lock icon) in Replit
2. Add the following environment variables:

```
PORT=3000
NODE_ENV=production
HOST=0.0.0.0

DB_HOST=your-database-host
DB_PORT=5432
DB_NAME=psms_db
DB_USER=your-database-user
DB_PASSWORD=your-database-password
DB_SSL=true

FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_ADMIN_SDK_PATH=./config/your-firebase-adminsdk-file.json
FIREBASE_API_KEY=your-firebase-api-key

CORS_ORIGIN=https://your-frontend-repl.id.repl.co
REPLIT_FRONTEND_URL=https://your-frontend-repl.id.repl.co

SMTP_HOST=your-smtp-host
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-smtp-user
SMTP_PASSWORD=your-smtp-password
SMTP_FROM=your-smtp-from-email
```

### 3. Upload Firebase Admin SDK File

1. Upload your Firebase Admin SDK JSON file to the `config/` folder
2. Update `FIREBASE_ADMIN_SDK_PATH` in secrets to match the filename

### 4. Install Dependencies

Replit will automatically run `npm install` when you open the project.

### 5. Run the Server

1. Click the "Run" button in Replit
2. The server will start on the port specified in `PORT` environment variable
3. Your API will be available at: `https://your-repl-name.id.repl.co`

### 6. Health Check

Visit: `https://your-repl-name.id.repl.co/health`

You should see:
```json
{
  "success": true,
  "message": "Server is running",
  "timestamp": "..."
}
```

## API Endpoints

All API endpoints are prefixed with `/api/sms`:

- Health: `GET /health`
- Auth: `POST /api/sms/auth/*`
- Users: `GET|POST|PUT|DELETE /api/sms/users/*`
- And more...

## Troubleshooting

### Database Connection Issues

- Ensure `DB_SSL=true` for cloud databases
- Check that your database allows connections from Replit IPs
- Verify database credentials

### CORS Issues

- Make sure `CORS_ORIGIN` matches your frontend URL exactly
- Include `REPLIT_FRONTEND_URL` if deploying frontend separately

### Firebase Issues

- Verify Firebase Admin SDK file is uploaded correctly
- Check that `FIREBASE_ADMIN_SDK_PATH` points to the correct file
- Ensure Firebase project ID matches

## Notes

- The server binds to `0.0.0.0` to accept external connections
- Scheduled jobs (installment invoices) run automatically
- Logs are available in Replit's console

