# Merchandise Gender/Type Migration Guide

## Overview
This document outlines the migration from using `remarks` field to structured `gender` and `type` columns for merchandise management.

## Changes Made

### 1. Database Migration ✅
- **Location**: `backend/migrations/add_gender_type_to_merchandise.sql`
- **Actions**:
  - Added `gender` VARCHAR(20) column
  - Added `type` VARCHAR(30) column
  - Added CHECK constraints for valid values
  - Migrated existing `remarks` data to new columns
  - Dropped `remarks` column

### 2. Backend API Updates ✅
- **File**: `backend/routes/merchandise.js`
  - Replaced `remarks` validation with `gender` and `type` validation
  - Updated POST route to accept gender/type
  - Updated PUT route to accept gender/type
  - Added column existence checks

### 3. Backend Merchandise Requests (IN PROGRESS)
- **File**: `backend/routes/merchandiserequests.js`
  - Need to replace `remarks` with `gender` and `type`
  - Update matching logic in approval process
  - Update notifications

### 4. Frontend Updates (PENDING)
- **Files to update**:
  - `frontend/src/pages/admin/adminMerchandise.jsx`
  - `frontend/src/pages/superadmin/Merchandise.jsx`
  
- **Changes needed**:
  - Replace `remarks` input with:
    - `gender` dropdown (Men, Women, Boys, Girls, Unisex)
    - `type` dropdown (Top, Bottom, Complete Set)
  - Update request modal
  - Update display tables

### 5. Database Documentation (PENDING)
- **File**: `docs/Database.md`
  - Update merchandisetbl schema
  - Remove remarks field
  - Add gender and type fields

## Field Specifications

### Gender Field
- **Type**: VARCHAR(20)
- **Values**: 'Men', 'Women', 'Unisex', NULL
- **When to use**: For uniforms and gender-specific items
- **Optional**: Yes (NULL for non-gendered items like bags, books)
- **Updated**: 2026-01-15 - Removed 'Boys' and 'Girls' options

### Type Field
- **Type**: VARCHAR(30)
- **Values**: 'Top', 'Bottom', NULL
- **When to use**: For uniforms and multi-part items
- **Optional**: Yes (NULL for single-piece items)
- **Updated**: 2026-01-15 - Removed 'Complete Set' option

## Migration Steps

### Step 1: Run Database Migration
```bash
psql -h [host] -U [user] -d psms_db -f backend/migrations/add_gender_type_to_merchandise.sql
```

### Step 2: Verify Migrated Data
```sql
SELECT merchandise_name, gender, type, size, quantity 
FROM merchandisestbl 
WHERE gender IS NOT NULL OR type IS NOT NULL
ORDER BY merchandise_name;
```

### Step 3: Restart Backend Server
The backend will auto-create columns if they don't exist, but manual migration is preferred.

### Step 4: Test Frontend
- Create new merchandise with gender/type
- Update existing merchandise
- Create stock requests
- Approve stock requests

## Rollback Plan

If issues occur:
```sql
-- Add remarks column back
ALTER TABLE merchandisestbl ADD COLUMN remarks TEXT;

-- Populate from gender/type
UPDATE merchandisestbl
SET remarks = 
  CASE 
    WHEN gender IS NOT NULL AND type IS NOT NULL 
    THEN gender || ' - ' || type
    WHEN gender IS NOT NULL 
    THEN gender
    WHEN type IS NOT NULL 
    THEN type
    ELSE NULL
  END;

-- Drop new columns
ALTER TABLE merchandisestbl DROP COLUMN gender;
ALTER TABLE merchandisestbl DROP COLUMN type;
```

## Benefits

1. **Data Integrity**: Dropdown selections prevent typos
2. **Better Queries**: Easy to filter by gender or type
3. **Reporting**: Accurate stock reports by gender/type
4. **User Experience**: Clear selection vs free text
5. **Validation**: Backend enforces valid values

## Migration Complete! 🎉

All components have been successfully updated:
1. ✅ Backend merchandise route
2. ✅ Backend merchandise requests route
3. ✅ Frontend admin merchandise page
4. ✅ Frontend superadmin merchandise page
5. ✅ Database documentation

### What Was Changed

**Database:**
- `merchandisestbl`: Added `gender` (VARCHAR(20)) and `type` (VARCHAR(30)) columns with CHECK constraints
- `merchandiserequestlogtbl`: Added `gender` and `type` columns with CHECK constraints
- Both tables: Dropped `remarks` column

**Backend:**
- Updated validation to accept gender and type (restricted to valid values)
- Updated API response payload structure
- Updated matching logic for stock approval (matches on gender/type instead of remarks)

**Frontend:**
- Replaced free-text `remarks` field with structured dropdowns
- Gender/Type fields only visible for uniforms
- Updated all tables to display Gender and Type columns
- Updated request modals and review/view modals
- All form validation updated

### Testing Checklist

Before deploying to production:
- [ ] Test creating new merchandise with gender/type
- [ ] Test updating existing merchandise
- [ ] Test requesting stock with gender/type
- [ ] Test approving/rejecting stock requests
- [ ] Verify table displays show correct gender/type data
- [ ] Test filtering and searching by gender/type
- [ ] Verify non-uniform items work without gender/type
