# Quick Start Guide

## Prerequisites Checklist

- [ ] Node.js v18+ installed
- [ ] PostgreSQL installed and running
- [ ] Firebase project created
- [ ] Firebase Admin SDK service account key downloaded

## Step-by-Step Setup

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Database Setup

Create a PostgreSQL database:

```bash
createdb physical_school_db
```

Or using psql:

```sql
CREATE DATABASE physical_school_db;
```

Run the database schema:

```bash
psql -U postgres -d physical_school_db -f ../docs/DATABASE.md
```

### 3. Environment Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and configure:

**Database:**
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=physical_school_db
DB_USER=postgres
DB_PASSWORD=your_password
```

**Firebase:**
1. Go to Firebase Console > Project Settings > Service Accounts
2. Click "Generate new private key"
3. Copy the values to `.env`:
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_PRIVATE_KEY` (keep the `\n` characters)
   - `FIREBASE_CLIENT_EMAIL`
   - etc.

**Server:**
```env
PORT=3000
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173
```

### 4. Start the Server

Development mode (with auto-reload):

```bash
npm run dev
```

Production mode:

```bash
npm start
```

### 5. Verify Installation

Check the health endpoint:

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "success": true,
  "message": "Server is running",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Testing Authentication

### 1. Get Firebase ID Token

From your frontend or using Firebase SDK:

```javascript
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';

const auth = getAuth();
const userCredential = await signInWithEmailAndPassword(auth, 'email@example.com', 'password');
const idToken = await userCredential.user.getIdToken();
```

### 2. Test API Endpoint

```bash
curl -X POST http://localhost:3000/api/v1/auth/verify \
  -H "Authorization: Bearer YOUR_FIREBASE_ID_TOKEN" \
  -H "Content-Type: application/json"
```

## Common Issues

### Database Connection Failed

- Check PostgreSQL is running: `pg_isready`
- Verify credentials in `.env`
- Check database exists: `psql -l | grep physical_school_db`

### Firebase Initialization Error

- Verify all Firebase environment variables are set
- Check private key format (should include `\n` for newlines)
- Ensure service account has proper permissions

### Port Already in Use

Change `PORT` in `.env` or kill the process:

```bash
# Find process
lsof -i :3000

# Kill process
kill -9 <PID>
```

## Next Steps

1. Create your first user via `/api/v1/auth/sync-user`
2. Create a branch via `/api/v1/branches`
3. Set up programs and classes
4. Start enrolling students

For detailed API documentation, see [README.md](./README.md).

