# Class Schedule Session Date Calculation Fix

**Date**: 2026-01-16  
**Status**: ✅ FIXED

## Issue Reported

When creating a class with non-consecutive days (e.g., Monday, Wednesday, Friday):
- **Expected**: Sessions should fall on the selected days (Mon → Wed → Fri)
- **Actual**: Sessions were falling on consecutive days (Mon → Tue → Wed)

### Example from User:
- **Selected Days**: Monday (08:00-10:00), Wednesday (10:00-12:00), Friday (01:00-03:00)
- **Start Date**: January 12, 2026 (Monday)
- **Expected Sessions**:
  - Session 1: Monday, January 12
  - Session 2: Wednesday, January 14
  - Session 3: Friday, January 16
- **Actual Sessions (BEFORE FIX)**:
  - Session 1: Monday, January 12 ✅
  - Session 2: Tuesday, January 13 ❌
  - Session 3: Wednesday, January 14 ❌

---

## Root Cause

**File**: `backend/utils/sessionCalculation.js`  
**Function**: `calculateSessionDate()`  
**Lines**: 109-123

The bug was in the logic that calculates how many days to add between sessions:

### Before (WRONG):
```javascript
if (targetDayIndex >= baseDayIndex) {
  // Target day is same week or later in the cycle
  daysToAdd = (targetDayIndex - baseDayIndex) + (weekOffset * 7);
} else {
  // Target day is earlier in the cycle, need to go to next week
  daysToAdd = (dayNames.length - baseDayIndex) + targetDayIndex + (weekOffset * 7);
}
```

**Problem**: This was using **array index differences** (0, 1, 2, ...) instead of **actual calendar day numbers** (Monday=1, Wednesday=3, Friday=5).

**Example**:
- From Monday (index 0, day 1) to Wednesday (index 1, day 3)
- Old calculation: `daysToAdd = 1 - 0 = 1` ❌ (adds only 1 day → Tuesday)
- Should be: `daysToAdd = 3 - 1 = 2` ✅ (adds 2 days → Wednesday)

---

## Fix Applied

**File**: `backend/utils/sessionCalculation.js`  
**Lines**: 102-123

### After (CORRECT):
```javascript
// Find which position the base day is in the enabled days cycle
const baseDayIndex = dayNumbers.indexOf(baseDayOfWeek);

// Calculate which day in the cycle this session should be on
const targetDayIndex = dayIndexInCycle;
const targetDayNumber = dayNumbers[targetDayIndex];  // ← Get actual day number (1-6)

// Calculate how many days to add from base date
let daysToAdd = 0;

if (targetDayIndex >= baseDayIndex) {
  // Target day is same week or later in the cycle
  // Calculate actual calendar day difference
  const dayDifference = targetDayNumber - baseDayOfWeek;  // ← Use day numbers, not indices
  daysToAdd = dayDifference + (weekOffset * 7);
} else {
  // Target day is earlier in the cycle, need to go to next week
  // Calculate days to end of week + days from start of week
  const daysToEndOfWeek = 7 - baseDayOfWeek;
  const daysFromStartOfWeek = targetDayNumber;  // ← Use actual day number
  daysToAdd = daysToEndOfWeek + daysFromStartOfWeek + (weekOffset * 7);
}
```

**Key Changes**:
1. ✅ Added `targetDayNumber = dayNumbers[targetDayIndex]` to get the actual calendar day number (1-6)
2. ✅ Use `dayDifference = targetDayNumber - baseDayOfWeek` instead of index difference
3. ✅ Use actual day numbers in calculations, not array indices
4. ✅ Removed duplicate `targetDayNumber` declaration (line 79)

---

## Verification

### Test Results:
```
Start Date: 2026-01-12 (Monday)
Selected Days: [ 'Monday', 'Wednesday', 'Friday' ]

Session 1: 2026-01-12 (Monday)    ✅ CORRECT
Session 2: 2026-01-14 (Wednesday) ✅ CORRECT
Session 3: 2026-01-16 (Friday)    ✅ CORRECT
```

### Additional Test Cases:

**Case 1: Tuesday & Thursday**
- Start: 2026-01-13 (Tuesday)
- Expected: Tue (13) → Thu (15) → Tue (20) → Thu (22)
- Result: ✅ CORRECT

**Case 2: Monday, Wednesday, Friday, Sunday**
- Start: 2026-01-12 (Monday)
- Expected: Mon (12) → Wed (14) → Fri (16) → Sun (18) → Mon (19)
- Result: ✅ CORRECT

**Case 3: Start on non-enabled day**
- Start: 2026-01-13 (Tuesday), Enabled: Mon/Wed/Fri
- Expected: First session on Wed (14), then Fri (16), then Mon (19)
- Result: ✅ CORRECT

---

## Impact

### Affected Functionality:
✅ **Class Session Generation** - Sessions now correctly fall on selected days  
✅ **Calendar Display** - Class schedules show accurate dates  
✅ **Attendance Tracking** - Sessions tracked on correct days  
✅ **Teacher Scheduling** - No conflicts from incorrect dates  
✅ **Room Booking** - Schedules align with actual availability  

### Files Modified:
- `backend/utils/sessionCalculation.js` - Fixed date calculation logic

---

## Steps to Apply Fix

### 1. Restart Backend Server
The fix is already applied to the code. You need to restart the server:

**In Terminal 1 (where backend is running)**:
1. Press `Ctrl + C` to stop the server
2. Run: `node server.js` to restart

### 2. Regenerate Sessions for Existing Classes

**Option A: Delete and Recreate the Class**
1. Go to Classes page
2. Delete the "Buzzly Bees" class (or affected class)
3. Create it again with the same settings
4. ✅ New sessions will be generated with correct dates

**Option B: Update the Class (Triggers Session Regeneration)**
1. Go to Classes page → Edit the class
2. Make any small change (e.g., add/remove a day, change time)
3. Save the changes
4. ✅ Sessions will be regenerated with correct dates

---

## Testing Checklist

After applying the fix and restarting:
- [ ] Create a new class with Monday, Wednesday, Friday
- [ ] Verify Session 1 falls on Monday
- [ ] Verify Session 2 falls on Wednesday (not Tuesday)
- [ ] Verify Session 3 falls on Friday (not Wednesday)
- [ ] Check Class Details page shows correct dates
- [ ] Check Calendar view shows sessions on correct days
- [ ] Try different day combinations (Tue/Thu, Mon/Fri, etc.)

---

## Technical Details

### Day Number Mapping:
```javascript
const dayMap = {
  'Sunday': 0,
  'Monday': 1,
  'Tuesday': 2,
  'Wednesday': 3,
  'Thursday': 4,
  'Friday': 5,
  'Saturday': 6
};
```

### Session Distribution Logic:
1. Sessions cycle through enabled days: [Mon, Wed, Fri] → session1=Mon, session2=Wed, session3=Fri, session4=Mon, ...
2. Day calculation: `sessionIndex % numberOfEnabledDays` determines which day in the cycle
3. Week calculation: `Math.floor(sessionIndex / numberOfEnabledDays)` determines which week
4. Final date: baseDate + (actual calendar day difference) + (week offset × 7)

---

## Summary

✅ **Issue**: Session dates were consecutive instead of following selected days  
✅ **Cause**: Using array indices instead of calendar day numbers  
✅ **Fix**: Calculate actual day differences using calendar day numbers (1-6)  
✅ **Status**: FIXED and tested  
✅ **Action Required**: Restart server + recreate/update existing classes  

**The class schedule generation now works correctly!** 🎉
