# Database Migrations

This directory contains SQL migration files for database schema changes.

## Migration Files

### 002_add_day_of_week_to_roomschedtbl.sql
- **Purpose**: Adds `day_of_week` column to `roomschedtbl` table to support day-based room scheduling
- **Changes**:
  - Adds `day_of_week` column (VARCHAR(20))
  - Updates primary key to include `day_of_week`: `(room_id, day_of_week)`
  - Makes `class_id` nullable to allow schedules without classes
  - Creates indexes for better query performance

### 003_add_package_id_to_classestbl.sql
- **Purpose**: Adds `package_id` foreign key to `classestbl` to link classes with packages
- **Changes**:
  - Adds `package_id` column (INTEGER)
  - Adds foreign key constraint to `packagestbl`
  - Creates index for better query performance

### 004_remove_package_id_from_classestbl.sql
- **Purpose**: Removes `package_id` column from `classestbl` table
- **Changes**:
  - Drops foreign key constraint `classestbl_package_id_fkey`
  - Drops index `idx_class_package_id`
  - Removes `package_id` column

### 005_add_teacher_and_lesson_fields_to_classestbl.sql
- **Purpose**: Adds teacher assignment and lesson tracking fields to `classestbl` table
- **Changes**:
  - Adds `teacher_id` column (INTEGER, FK to `userstbl`)
  - Adds `phase_number` column (INTEGER)
  - Adds `session_number` column (INTEGER)
  - Adds `status` column (VARCHAR(50), default 'Active')
  - Adds foreign key constraint for `teacher_id`
  - Creates index for better query performance on `teacher_id`

### 006_rename_title_to_topic_in_phasesessionstbl.sql
- **Purpose**: Renames `title` column to `topic` in `phasesessionstbl` table
- **Changes**:
  - Renames `title` column to `topic` in `phasesessionstbl`

### 007_remove_phase_session_from_classestbl.sql
- **Purpose**: Removes phase and session tracking from `classestbl` (if applicable)
- **Changes**: (Refer to migration file for details)

### 008_move_package_price_to_packagestbl.sql
- **Purpose**: Moves package pricing information to `packagestbl` table
- **Changes**: (Refer to migration file for details)

### 009_add_phase_number_to_classstudentstbl.sql
- **Purpose**: Adds `phase_number` column to `classstudentstbl` to track which phase a student is enrolled in
- **Changes**:
  - Adds `phase_number` column (INTEGER) to `classstudentstbl`
  - Creates index on `phase_number` for better query performance
  - Creates composite index on `(class_id, phase_number)` for common queries
  - Adds column comment explaining the automatic phase determination logic

## How to Run Migrations

### Using psql (PostgreSQL command line):

```bash
# Connect to your database
psql -U your_username -d your_database_name

# Run the migration
\i backend/migrations/002_add_day_of_week_to_roomschedtbl.sql
```

### Using pgAdmin:

1. Open pgAdmin and connect to your database
2. Right-click on your database → **Query Tool**
3. Open the migration file: `backend/migrations/002_add_day_of_week_to_roomschedtbl.sql`
4. Execute the script (F5 or click Execute)

### Using Node.js/JavaScript (for SQL migrations):

```javascript
const fs = require('fs');
const { Pool } = require('pg');

const pool = new Pool({
  // your database connection config
});

async function runMigration() {
  const migrationSQL = fs.readFileSync(
    'backend/migrations/002_add_day_of_week_to_roomschedtbl.sql',
    'utf8'
  );
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(migrationSQL);
    await client.query('COMMIT');
    console.log('Migration completed successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

runMigration();
```

### Running JavaScript Migration Scripts (e.g., 012_generate_sessions_for_existing_classes.js):

```bash
# Using npm script (recommended)
npm run migrate:sessions

# Or directly with Node.js
node backend/migrations/012_generate_sessions_for_existing_classes.js
```

## Important Notes

⚠️ **ALWAYS BACKUP YOUR DATABASE BEFORE RUNNING MIGRATIONS**

1. **Backup First**: Create a backup of your database before running any migration
   ```bash
   pg_dump -U your_username -d your_database_name > backup_before_migration.sql
   ```

2. **Test in Development**: Always test migrations in a development/staging environment first

3. **Verify After Migration**: Run the verification queries at the end of the migration file to ensure the changes were applied correctly

4. **Rollback Plan**: If something goes wrong, restore from your backup:
   ```bash
   psql -U your_username -d your_database_name < backup_before_migration.sql
   ```

## Migration Order

Migrations should be run in numerical order:
- `001_*.sql` (if exists)
- `002_*.sql`
- `003_*.sql` (future migrations)

## Troubleshooting

### Error: "constraint does not exist"
- This is normal if the constraint was already dropped or never existed
- The migration uses `IF EXISTS` and `IF NOT EXISTS` to handle this gracefully

### Error: "column already exists"
- The migration uses `IF NOT EXISTS` to prevent this error
- If you see this error, the column may have been added manually

### Error: "duplicate key value violates unique constraint"
- This can happen if you have existing data without `day_of_week` values
- You may need to update existing records first:
  ```sql
  -- Update existing records (example - adjust as needed)
  UPDATE roomschedtbl SET day_of_week = 'Monday' WHERE day_of_week IS NULL;
  ```

## Verification

After running the migration, verify the changes:

```sql
-- Check if column exists
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'roomschedtbl' AND column_name = 'day_of_week';

-- Check primary key constraint
SELECT constraint_name, constraint_type 
FROM information_schema.table_constraints 
WHERE table_name = 'roomschedtbl' AND constraint_type = 'PRIMARY KEY';

-- Check indexes
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'roomschedtbl' AND indexname LIKE '%day%';
```

