# Migration Script 012: Generate Sessions for Existing Classes

## Overview

This migration script generates class sessions for all existing classes that have:
- `start_date` set
- Room schedules configured (`roomschedtbl`)
- Curriculum with phases and sessions per phase (through `programstbl`)

## Purpose

After creating the `classsessionstbl` table, you need to populate it with session records for existing classes. This script:
- Finds all active classes
- Checks if they have the required data (start_date, schedules, curriculum)
- Generates session records using the same logic as new class creation
- Inserts sessions into the database (skips duplicates)

## Prerequisites

1. ✅ The `classsessionstbl` table must already exist in your database
2. ✅ Your `.env` file must have database connection settings:
   ```
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=your_database_name
   DB_USER=your_username
   DB_PASSWORD=your_password
   DB_SSL=false  # or true if using SSL
   ```

## How to Run

### Option 1: Using npm script (Recommended)

```bash
cd backend
npm run migrate:sessions
```

### Option 2: Directly with Node.js

```bash
cd backend
node migrations/012_generate_sessions_for_existing_classes.js
```

## What the Script Does

1. **Fetches all active classes** from `classestbl`
2. **For each class:**
   - Checks if it has `start_date`
   - Checks if it has schedules in `roomschedtbl`
   - Checks if its program has a curriculum with phases/sessions
   - Generates session records using `generateClassSessions()` utility
   - Inserts sessions into `classsessionstbl` (skips duplicates)
3. **Provides detailed logging:**
   - Shows progress for each class
   - Logs skipped classes with reasons
   - Reports errors if any occur
   - Shows summary at the end

## Expected Output

```
🚀 Starting migration: Generate Sessions for Existing Classes
======================================================================
📋 Found 5 active classes to process

📚 Processing Class ID: 1...
   📅 Found 3 schedule(s)
   📖 Found 24 phase session(s) in curriculum
   🔢 Generated 24 session(s)
   📊 0 session(s) already exist in database
   ✅ Completed: Created 24 session(s), Skipped 0 duplicate(s)

📚 Processing Class ID: 2...
   ⚠️  Skipped: Missing start_date

...

======================================================================
📊 Migration Summary:
======================================================================
✅ Classes Processed: 4
⚠️  Classes Skipped: 1
❌ Classes With Errors: 0
📅 Total Sessions Generated: 96
⏭️  Total Sessions Skipped (duplicates): 0
======================================================================
✅ Migration completed successfully!
```

## Important Notes

⚠️ **SAFE TO RUN MULTIPLE TIMES**

- The script uses `ON CONFLICT DO NOTHING` when inserting sessions
- This means it won't create duplicate sessions if you run it multiple times
- Already-generated sessions will be skipped

⚠️ **BACKUP FIRST**

Even though the script is safe, always backup your database before running migrations:

```bash
pg_dump -U your_username -d your_database_name > backup_before_012.sql
```

⚠️ **SKIPPED CLASSES**

Classes will be skipped if:
- Missing `start_date`
- Missing schedules (`roomschedtbl` entries)
- Missing curriculum (program has no curriculum linked)
- Missing phases/sessions configuration in curriculum

You can manually fix these and run the script again, or use the API endpoint:
```
POST /api/sms/classes/:id/generate-sessions
```

## Troubleshooting

### Error: "Cannot find module '../utils/sessionCalculation.js'"

**Solution:** Make sure you're running the script from the `backend` directory:
```bash
cd backend
node migrations/012_generate_sessions_for_existing_classes.js
```

### Error: "Connection refused" or database connection errors

**Solution:** Check your `.env` file has the correct database credentials:
```bash
DB_HOST=localhost
DB_PORT=5432
DB_NAME=your_database_name
DB_USER=your_username
DB_PASSWORD=your_password
```

### Error: "Table 'classsessionstbl' does not exist"

**Solution:** Make sure you've already created the `classsessionstbl` table. Run the CREATE TABLE statement you provided earlier.

### Some classes are skipped

This is normal! Classes are skipped if they don't have:
- `start_date` set
- Room schedules configured
- Curriculum with phases/sessions

Fix these issues and run the script again, or generate sessions manually using the API endpoint.

## Verification

After running the script, verify the sessions were created:

```sql
-- Check total sessions created
SELECT COUNT(*) as total_sessions FROM classsessionstbl;

-- Check sessions per class
SELECT 
  c.class_id,
  c.section_name,
  COUNT(cs.classsession_id) as session_count
FROM classestbl c
LEFT JOIN classsessionstbl cs ON c.class_id = cs.class_id
WHERE c.status = 'Active'
GROUP BY c.class_id, c.section_name
ORDER BY c.class_id;

-- Check session date range
SELECT 
  MIN(scheduled_date) as earliest_session,
  MAX(scheduled_date) as latest_session,
  COUNT(*) as total_sessions
FROM classsessionstbl;
```

## Next Steps

After running this migration:

1. ✅ Sessions are now stored in the database
2. ✅ You can update the frontend to fetch sessions from the API instead of calculating them
3. ✅ You can assign substitute teachers to specific sessions
4. ✅ Students can view their session schedules

## Related Files

- **Utility Function:** `backend/utils/sessionCalculation.js`
- **API Endpoint:** `backend/routes/classes.js` (POST `/api/sms/classes/:id/generate-sessions`)
- **Database Schema:** See `docs/Database.md` for `classsessionstbl` table structure

