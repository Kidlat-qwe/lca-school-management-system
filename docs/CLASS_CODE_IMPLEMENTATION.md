# Class Code Implementation (CORRECTED)

## Overview
This document describes the implementation of the auto-generated Class Code feature for the Physical School Management System. Each **session** gets its own unique class code based on its specific date and time.

## Class Code Format
```
{program_code}_{MMDDYY}_{HHMM}{AM/PM}_{ClassName}
```

### Examples
```
pk_121525_1000AM_Bees  (Session 1: Dec 15, 2025 at 10:00 AM)
pk_121625_0800AM_Bees  (Session 2: Dec 16, 2025 at 8:00 AM)
pk_122225_1000AM_Bees  (Session 3: Dec 22, 2025 at 10:00 AM)
```

**Key Point**: Each session has a DIFFERENT class code because each session has different date/time.

## Program Code Mapping
| Program Name     | Program Code |
|-----------------|--------------|
| Playgroup       | sc           |
| Nursery         | nc           |
| Kindergarten    | kg           |
| Pre-Kindergarten| pk           |

## Implementation Details

### 1. Database Changes
**File**: `backend/migrations/049_add_class_code_to_classestbl.sql`

- **REMOVED** `class_code` from `classestbl` (wrong location)
- **ADDED** `class_code` column to `classsessionstbl` (correct location) ✅
- Type: VARCHAR(100)
- Indexed for faster lookups
- Auto-generated during session creation

**Why `classsessionstbl` not `classestbl`?**
- ✅ Each session has its own date and time
- ✅ Class code includes date and time, so it's unique per session
- ✅ One class can have multiple sessions with different codes
- ✅ No data duplication

### 2. Backend Changes

#### A. Class Code Generator Utility
**File**: `backend/utils/classCodeGenerator.js`

Functions:
- `generateClassCode(programCode, startDate, startTime, className)` - Main generator
- `formatTimeForClassCode(timeString)` - Converts 24h to 12h format with AM/PM
- `formatDateForClassCode(dateString)` - Converts date to MMDDYY format
- `sanitizeClassName(className)` - Removes special characters from class name
- `extractStartTimeFromSchedule(daysOfWeek)` - Gets first start_time from schedule array

#### B. Class Session Creation
**File**: `backend/routes/classes.js`

Changes:
1. Import class code generator utilities
2. Generate class code **for each session** during session creation using:
   - `program.program_code` (from program table)
   - `session.scheduled_date` (specific session date)
   - `session.scheduled_start_time` (specific session time)
   - `class_name` (from class)
3. Insert class_code into each session record
4. Include `class_code` in session GET responses

#### C. API Response Updates
Modified endpoints to include `class_code` in sessions:
- `GET /api/sms/classes/:id/sessions` - Get all sessions with class codes

### 3. Frontend Changes
**File**: `frontend/src/pages/superadmin/Classes.jsx`

Changes:
1. **Class Details View** (line ~5013):
   - Changed table header from "PROGRAM NAME" to "CLASS CODE"
   
2. **Session Table Display** (line ~5095):
   - Changed from displaying `selectedClassForDetails.class_code`
   - To displaying `classSession?.class_code` (from the specific session)

## Usage

### Creating a Class with Session Class Codes
When creating a new class through the UI:

1. **Required Fields**:
   - Program (determines program_code)
   - Class Name (e.g., "Bees")
   - Start Date (e.g., "2025-12-15")
   - Schedule with different times for different days

2. **Generated Class Codes**:
   - **Automatically created for each session** during class creation
   - Each session gets its own code based on its specific date and time
   - Stored in `classsessionstbl.class_code`
   - Displayed in class details view

### Example Output
For a class "Bees" with schedule:
- Monday: 10:00 AM
- Tuesday: 8:00 AM

Sessions will have:
- Session 1 (Dec 15 Mon): `pk_121525_1000AM_Bees`
- Session 2 (Dec 16 Tue): `pk_121625_0800AM_Bees`
- Session 3 (Dec 22 Mon): `pk_122225_1000AM_Bees`
- Session 4 (Dec 23 Tue): `pk_122325_0800AM_Bees`

## Data Flow

```
Class Creation Request
  ↓
Generate Sessions (with dates & times)
  ↓
For Each Session:
  ├─ Extract: program_code, session_date, session_time, class_name
  ├─ Generate Class Code (e.g., "pk_121525_1000AM_Bees")
  └─ Store in classsessionstbl.class_code
  ↓
Return in API responses
  ↓
Display in Class Details UI (each row shows its own unique code)
```

## Validation Rules
1. **Program Code**: Must exist in program table
2. **Session Date**: Valid date format (YYYY-MM-DD) from session
3. **Session Time**: Valid time format (HH:MM:SS or HH:MM) from session
4. **Class Name**: Must not be empty, special characters removed

## Testing Checklist
- [ ] Run migration to add class_code column to classsessionstbl
- [ ] Create new class and verify each session has a unique class code
- [ ] View class details and verify each session displays its own class code
- [ ] Test with different schedules (multiple days with different times)
- [ ] Verify codes match the actual session date/time
- [ ] Test with different program types (Playgroup, Nursery, Kindergarten, Pre-Kindergarten)
- [ ] Test with different class names (with/without special characters)
- [ ] Verify existing sessions without codes show "-"

## Migration Notes
- Old approach (storing in `classestbl`) has been removed
- New approach (storing in `classsessionstbl`) is the correct implementation
- Each session now has its own unique class code reflecting its specific schedule


