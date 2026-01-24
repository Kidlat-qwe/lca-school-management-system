# Promo System Design Document

## Overview
The promo system allows clients to apply promotional discounts or benefits when availing packages. Promos are separate entities that can be applied to existing packages, providing flexibility for marketing campaigns.

## Key Requirements

### 1. Promo Types
- **Percentage Discount**: e.g., "20% off"
- **Fixed Amount Discount**: e.g., "$500 off"
- **Free Merchandise**: Add free items (e.g., free uniform, free bag)
- **Combined**: Can combine discount + merchandise

### 2. Promo Duration & Availability
- **Date Range**: Start date and end date
- **Usage Limit**: Maximum number of students who can avail (null = unlimited)

### 3. Promo Scope
- **Branch-Specific**: Only available for specific branch(es)
- **All Branches**: Available system-wide (branch_id = null)

### 4. Student Eligibility Conditions
- **All Students**: No restriction
- **New Students Only**: Students who have never been enrolled before
- **Existing Students Only**: Students who have at least one previous enrollment
- **Referral Only**: Students who were referred by another student/parent

### 5. Payment Amount Condition
- **Minimum Payment**: Promo can only be availed if total payment >= specified amount
- Example: "Winter Promo" requires payment >= $20,000

### 6. Package Association
- Promo applies to a specific package (one-to-many: one package can have multiple promos, but typically only one active promo at a time per package)

## Database Schema Design

### Table 1: `promostbl` (Main Promo Table)
```sql
CREATE TABLE IF NOT EXISTS public.promostbl
(
    promo_id serial NOT NULL,
    promo_name character varying(255) NOT NULL,
    package_id integer NOT NULL, -- Which package this promo applies to
    branch_id integer, -- NULL = all branches, specific ID = branch-specific
    promo_type character varying(50) NOT NULL, -- 'percentage_discount', 'fixed_discount', 'free_merchandise', 'combined'
    discount_percentage numeric(5, 2), -- For percentage discount (0-100)
    discount_amount numeric(10, 2), -- For fixed amount discount
    min_payment_amount numeric(10, 2), -- Minimum payment to avail promo (NULL = no minimum)
    start_date date NOT NULL,
    end_date date NOT NULL,
    max_uses integer, -- Maximum number of students who can avail (NULL = unlimited)
    current_uses integer DEFAULT 0, -- Track how many have used it
    eligibility_type character varying(50) DEFAULT 'all', -- 'all', 'new_students_only', 'existing_students_only', 'referral_only'
    status character varying(50) DEFAULT 'Active', -- 'Active', 'Inactive', 'Expired'
    description text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    created_by integer,
    CONSTRAINT promostbl_pkey PRIMARY KEY (promo_id),
    CONSTRAINT promostbl_package_id_fkey FOREIGN KEY (package_id) REFERENCES packagestbl(package_id),
    CONSTRAINT promostbl_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branchestbl(branch_id),
    CONSTRAINT promostbl_created_by_fkey FOREIGN KEY (created_by) REFERENCES userstbl(user_id)
);
```

### Table 2: `promomerchandisetbl` (Free Merchandise for Promos)
```sql
CREATE TABLE IF NOT EXISTS public.promomerchandisetbl
(
    promomerchandise_id serial NOT NULL,
    promo_id integer NOT NULL,
    merchandise_id integer NOT NULL,
    quantity integer DEFAULT 1, -- How many of this item to give for free
    CONSTRAINT promomerchandisetbl_pkey PRIMARY KEY (promomerchandise_id),
    CONSTRAINT promomerchandisetbl_promo_id_fkey FOREIGN KEY (promo_id) REFERENCES promostbl(promo_id) ON DELETE CASCADE,
    CONSTRAINT promomerchandisetbl_merchandise_id_fkey FOREIGN KEY (merchandise_id) REFERENCES merchandisestbl(merchandise_id)
);
```

### Table 3: `promousagetbl` (Track Promo Usage)
```sql
CREATE TABLE IF NOT EXISTS public.promousagetbl
(
    promousage_id serial NOT NULL,
    promo_id integer NOT NULL,
    student_id integer NOT NULL,
    invoice_id integer NOT NULL, -- Link to invoice where promo was applied
    used_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    discount_applied numeric(10, 2), -- Actual discount amount applied
    CONSTRAINT promousagetbl_pkey PRIMARY KEY (promousage_id),
    CONSTRAINT promousagetbl_promo_id_fkey FOREIGN KEY (promo_id) REFERENCES promostbl(promo_id),
    CONSTRAINT promousagetbl_student_id_fkey FOREIGN KEY (student_id) REFERENCES userstbl(user_id),
    CONSTRAINT promousagetbl_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoicestbl(invoice_id),
    CONSTRAINT promousagetbl_unique_student_promo UNIQUE (promo_id, student_id) -- One student can only use a promo once
);
```

### Table 4: `referralstbl` (Student Referral Tracking)
```sql
CREATE TABLE IF NOT EXISTS public.referralstbl
(
    referral_id serial NOT NULL,
    referrer_student_id integer NOT NULL, -- Student who made the referral
    referred_student_id integer NOT NULL, -- Student who was referred
    referral_code character varying(50), -- Optional referral code
    referred_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    status character varying(50) DEFAULT 'Pending', -- 'Pending', 'Verified', 'Used'
    CONSTRAINT referralstbl_pkey PRIMARY KEY (referral_id),
    CONSTRAINT referralstbl_referrer_student_id_fkey FOREIGN KEY (referrer_student_id) REFERENCES userstbl(user_id),
    CONSTRAINT referralstbl_referred_student_id_fkey FOREIGN KEY (referred_student_id) REFERENCES userstbl(user_id),
    CONSTRAINT referralstbl_unique_referred UNIQUE (referred_student_id) -- One student can only be referred once
);
```

### Table 5: Add `promo_id` to `invoicestbl`
```sql
ALTER TABLE invoicestbl
ADD COLUMN IF NOT EXISTS promo_id integer;

ALTER TABLE invoicestbl
ADD CONSTRAINT invoicestbl_promo_id_fkey 
FOREIGN KEY (promo_id) 
REFERENCES promostbl(promo_id) 
ON UPDATE NO ACTION 
ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_promo_id 
ON invoicestbl(promo_id);
```

## Business Logic Flow

### 1. Promo Creation
- Admin creates promo with all conditions
- System validates:
  - End date >= start date
  - If percentage discount: 0 < discount_percentage <= 100
  - If fixed discount: discount_amount > 0
  - If free merchandise: at least one merchandise item selected
  - Package exists and is active

### 2. Promo Availability Check (When Student Selects Package)
When a student selects a package during enrollment, the system should:
1. Find all active promos for that package
2. Filter by:
   - Current date is between start_date and end_date
   - Branch matches (if branch-specific) or branch_id is NULL
   - current_uses < max_uses (or max_uses is NULL)
   - Status = 'Active'
3. For each eligible promo, check student eligibility:
   - **New Students Only**: Check if student has any enrollment in `classstudentstbl`
   - **Existing Students Only**: Check if student has at least one enrollment in `classstudentstbl`
   - **Referral Only**: Check if student exists in `referralstbl` with status = 'Verified'
   - **All**: No check needed
4. Check payment amount condition:
   - If min_payment_amount is set, ensure package price (or total payment) >= min_payment_amount
5. Return list of available promos to frontend

### 3. Promo Application (During Invoice Creation)
When applying a promo during enrollment:
1. Validate promo is still available (re-check all conditions)
2. Calculate discount:
   - **Percentage**: `discount = (package_price * discount_percentage) / 100`
   - **Fixed**: `discount = discount_amount`
3. Apply discount to invoice:
   - Add discount item to `invoiceitemstbl` with negative amount or use `discount_amount` field
   - Update invoice total
4. Add free merchandise to invoice items (if applicable)
5. Link promo to invoice: `invoice.promo_id = promo_id`
6. Record usage:
   - Insert into `promousagetbl`
   - Increment `promostbl.current_uses`
7. Mark referral as "Used" if applicable

### 4. Promo Validation Rules
- **One promo per invoice**: A student can only apply one promo per enrollment/invoice
- **One-time use per student**: A student can only use a specific promo once (enforced by unique constraint)
- **Automatic expiration**: System should mark promos as 'Expired' when end_date passes

## API Endpoints Needed

### Promo Management
- `GET /api/v1/promos` - List all promos (with filters)
- `GET /api/v1/promos/:id` - Get promo details
- `POST /api/v1/promos` - Create promo
- `PUT /api/v1/promos/:id` - Update promo
- `DELETE /api/v1/promos/:id` - Delete promo
- `GET /api/v1/promos/package/:packageId` - Get available promos for a package
- `GET /api/v1/promos/package/:packageId/student/:studentId` - Get eligible promos for a student and package

### Referral Management
- `POST /api/v1/referrals` - Create referral
- `GET /api/v1/referrals/student/:studentId` - Get referrals for a student
- `PUT /api/v1/referrals/:id/verify` - Verify a referral

## Frontend Changes Needed

### 1. Promo Management Page (`/superadmin/promo`)
**Location**: New dedicated page `frontend/src/pages/superadmin/Promo.jsx`

**Navigation**: Add to Sidebar menu (standalone menu item, positioned after "Package" for logical grouping)

**Features**:
- List all promos with filters (by package, branch, status, date range)
- Create/Edit/Delete promos
- Configure promo conditions:
  - Link to package
  - Set discount type and amount
  - Add free merchandise items
  - Set eligibility rules
  - Configure duration and usage limits
- View promo usage statistics (how many students used it)
- View active/expired promos
- Quick actions: Activate/Deactivate, Duplicate promo

**UI Structure** (similar to Package.jsx):
- Table view with search and filters
- Create/Edit modal with multi-step form
- Promo details view showing:
  - Applied to which packages
  - Usage count vs max uses
  - Eligible students count
  - Active date range

### 2. Enrollment Flow Updates (in Classes.jsx)
**When Package is Selected**:
- After student selects a package, check for available promos
- Display promo cards/badges showing:
  - Promo name
  - Discount amount/percentage
  - Free merchandise included
  - Eligibility status (if student qualifies)
- Allow user to select a promo (optional - can proceed without promo)
- Show final price with promo discount applied
- Display promo details in invoice preview

**UI Flow**:
```
Package Selection → [Show Available Promos] → Student Selection → Review (with promo) → Submit
```

### 3. Referral System
**Location**: Can be integrated into:
- Student registration form (add referral code field)
- Personnel/Student management page (view referral status)
- Or separate "Referrals" page if needed

**Features**:
- Add referral code input during student registration
- Track referrals in student profile
- Display referral status
- Admin can verify referrals
- View referral statistics

## Implementation Considerations

### 1. Student Status Determination
- **New Student**: No records in `classstudentstbl` for this student
- **Existing Student**: At least one record in `classstudentstbl` for this student
- Query: `SELECT COUNT(*) FROM classstudentstbl WHERE student_id = ?`

### 2. Promo Expiration
- Create a scheduled job to mark expired promos
- Or check expiration on-the-fly during availability checks

### 3. Concurrent Usage Tracking
- Use database transactions when incrementing `current_uses`
- Use row-level locking to prevent race conditions

### 4. Promo Priority
- If multiple promos are available, show all to user
- User selects which one to apply
- Consider adding priority field if needed in future

### 5. Discount Calculation
- Percentage discount is calculated on package price
- Fixed discount is applied directly
- Both can be combined with free merchandise

## Migration Strategy

1. Create new tables (`promostbl`, `promomerchandisetbl`, `promousagetbl`, `referralstbl`)
2. Add `promo_id` to `invoicestbl`
3. Update enrollment flow to check and apply promos
4. Create promo management UI
5. Add referral tracking system

## Questions to Clarify

1. **Can a student use multiple promos?** (Assumption: One promo per enrollment/invoice)
2. **Can a promo be reused by the same student?** (Assumption: No, one-time use per student)
3. **What happens if promo expires during enrollment?** (Should validate at invoice creation time)
4. **Can promos stack?** (Assumption: No, one promo per invoice)
5. **How to handle referral verification?** (Manual verification by admin, or automatic?)

