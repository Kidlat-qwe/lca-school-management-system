# Physical School Management System - Superadmin User Manual

## Table of Contents

1. [Introduction](#introduction)
2. [Getting Started](#getting-started)
3. [Superadmin Role Overview](#superadmin-role-overview)
4. [Dashboard](#dashboard)
5. [Pages and Features](#pages-and-features)
   - [Branch Management](#branch-management)
   - [Calendar](#calendar)
   - [Announcements](#announcements)
   - [Personnel Management](#personnel-management)
   - [Students](#students)
   - [Guardians](#guardians)
   - [Curriculum](#curriculum)
   - [Program](#program)
   - [Classes](#classes)
   - [Room Management](#room-management)
   - [Package Management](#package-management)
   - [Pricing List](#pricing-list)
   - [Merchandise](#merchandise)
   - [Promo](#promo)
   - [Invoice Management](#invoice-management)
   - [Installment Invoice](#installment-invoice)
   - [Payment Logs](#payment-logs)
   - [Settings](#settings)
6. [Common Workflows](#common-workflows)
7. [Best Practices](#best-practices)
8. [Troubleshooting](#troubleshooting)

---

## Introduction

This manual is specifically designed for **Superadmin** users of the Physical School Management System. As a Superadmin, you have full system access across all branches with complete control over system configurations, user management, and all operations.

### Key Characteristics of Superadmin Role

- **Access Level**: All branches (system-wide access)
- **Permissions**: Full system control and configuration
- **Capabilities**: 
  - Create and manage branches
  - Create Superadmin and Admin users
  - Access all branches' data
  - Create system-wide configurations
  - Manage all users across all branches
- **Scope**: Complete system administration and oversight

---

## Getting Started

### Accessing the System

1. Navigate to your school's system URL
2. Enter your email and password
3. Click "Login"
4. You'll be redirected to the Superadmin Dashboard

### First Time Setup

1. Ensure your account is created by another Superadmin
2. Review your dashboard
3. Familiarize yourself with Branch Management (first thing to set up)
4. Review all navigation menu options

---

## Superadmin Role Overview

### What You Can Do

- Create and manage branches
- Create and manage all user types (Superadmin, Admin, Finance, Teacher, Student)
- Manage all classes across all branches
- Access all financial data system-wide
- Create and manage packages, pricing, merchandise, and promos
- Create system-wide announcements
- Manage curriculum and programs
- View and manage all invoices and payments
- Access all branches' data and operations

### What You Have That Admin Doesn't

- **Branch Management**: Can create and manage branches
- **User Creation**: Can create Superadmin and Admin users (Admin cannot)
- **System-Wide Access**: Can see all branches, not limited to one
- **System-Wide Promos**: Can create promos for all branches
- **Complete Oversight**: Full system visibility and control

---

## Dashboard

**Path**: Dashboard (main page after login)

### Overview

The Superadmin Dashboard provides a comprehensive system-wide overview with key metrics from all branches and recent activities.

### What You'll See

#### System-Wide Statistics

- **Total Students**: Number of students across all branches
- **Total Teachers**: Number of teachers across all branches
- **Total Classes**: Number of classes across all branches
- **Total Revenue**: Financial metrics from all branches

#### Branch Performance

- Individual branch statistics
- Branch comparison metrics
- Revenue by branch
- Student counts by branch
- Class counts by branch

#### Recent Activities

- Latest system activities across all branches
- Recent enrollments
- Recent payments
- System updates
- User activities

#### Quick Access

- Quick links to key pages
- Recent items
- Important notifications

### How to Use the Dashboard

1. **Monitor System**: Check overall system health and metrics
2. **Compare Branches**: Review branch performance
3. **Track Activities**: Monitor recent system activities
4. **Quick Navigation**: Use quick links to access common pages
5. **Daily Overview**: Use dashboard as starting point each day

---

## Pages and Features

### Branch Management

**Path**: Branch

#### Purpose

Create and manage all school branches. This is a Superadmin-only feature - Admin cannot create branches.

#### Features

**Viewing Branches**

- See all branches in the system
- View branch details
- Check branch status (Active/Inactive)
- See branch statistics

**Branch Table Columns**

- Branch Name
- Address
- Phone Number
- Email
- Status (Active/Inactive)
- Actions

**Creating Branches**

1. Click "Add Branch" button
2. Fill in the form:
   - **Branch Name**: Name of the branch (required)
   - **Email**: Branch email address (required)
   - **Phone Number**: Contact phone (optional)
   - **Status**: Active or Inactive (optional, defaults to Active)
   - **Address**: Physical address (required)
   - **City**: City name (required)
   - **State/Province/Region**: State or province (required)
   - **Postal Code**: ZIP/postal code (required)
   - **Country**: Country name (required)
   - **Locale**: Language/locale setting (optional)
   - **Business Registration Number**: Legal registration number (optional)
   - **Tax ID**: Tax identification number (optional)
   - **Establishment Date**: When branch was established (optional)
   - **Currency**: Currency code (e.g., USD, PHP) (optional, defaults to PHP)
3. Click "Save"
4. Branch is created and available for use

**Editing Branches**

1. Click "Edit" (three dots menu) on a branch
2. Modify branch details
3. Update status if needed
4. Click "Update"

**Deleting Branches**

1. Click "Delete" (three dots menu) on a branch
2. Confirm deletion
3. Branch is removed (ensure no critical data exists)

**Viewing Branch Details**

1. Click on branch name
2. See comprehensive information:
   - Branch information
   - Associated users
   - Classes
   - Programs
   - Statistics

#### Important Notes

- Only Superadmin can create branches
- Branches must be created before assigning users to them
- Cannot delete branches with active data
- Branch status affects availability

---

### Calendar

**Path**: Calendar

#### Purpose

View and manage class schedules across all branches in a calendar format.

#### Features

**Monthly View**
- See all class sessions for all branches
- Color-coded by class or branch
- Navigate between months using arrows
- Filter by branch, program, class, teacher, or room

**Filtering Options**
- Filter by Branch
- Filter by Program
- Filter by Class
- Filter by Teacher
- Filter by Room
- Clear filters to see all

**Session Information**
- Click on any session to see details:
  - Class name and code
  - Branch name
  - Date and time
  - Room location
  - Teacher assigned
  - Number of students
  - Session status

**Class Sessions View**
- Click on a class in the calendar
- View all sessions for that class
- See phase and session numbers
- Check attendance status
- View curriculum topics

#### How to Use

1. **Navigate**: Use month navigation arrows
2. **Filter**: Use filter dropdowns to narrow down
3. **View Details**: Click on sessions for details
4. **Branch Overview**: Compare schedules across branches

---

### Announcements

**Path**: Announcements

#### Purpose

Create, view, and manage announcements system-wide or per branch. Send messages to all users or specific groups.

#### Features

**Viewing Announcements**

- See all announcements (all branches or filtered)
- Filter by status (Active, Inactive, Draft)
- Filter by priority (High, Medium, Low)
- Filter by recipient group
- Search by title or content

**Creating Announcements**

1. Click "+ Create Announcement" button
2. Fill in the form:
   - **Title**: Brief, descriptive title (required)
   - **Message Body**: Full announcement content (required)
   - **Recipient Groups**: Select who should see this (required, at least one):
     - All
     - Students
     - Teachers
     - Admin
     - Finance
   - **Status**: Active, Inactive, or Draft (required)
   - **Priority**: High, Medium, or Low (required)
   - **Branch Selection**: 
     - Specific Branch (select from dropdown) (required)
     - Select "All Branches" option for system-wide
   - **Start Date**: When announcement becomes visible (required)
   - **End Date**: When announcement expires (required)
3. Click "Create Announcement" to save it

**Managing Announcements**
- **Edit**: Click "Edit" to modify
- **Delete**: Click "Delete" to remove
- **View Details**: Click on announcement
- **Track Reads**: See how many users have read

**System-Wide vs Branch-Specific**

- **System-Wide**: Select "All Branches" - visible to all users
- **Branch-Specific**: Select specific branch - visible only to that branch

#### Best Practices

- Use clear, concise titles
- Set appropriate priority levels
- Use system-wide announcements for important system updates
- Use branch-specific for branch-level communications

---

### Personnel Management

**Path**: Manage Users → Personnel

#### Purpose

Manage **non-student** user accounts across all branches (Admin, Teacher, Finance), plus creation of **Superadmin/Superfinance** accounts.

#### Features

**Viewing Personnel**

- See all non-student users across all branches
- Filter by Branch
- Filter by Role
- Search by name
- View user details

**Table Columns**
- Full Name
- Email
- Role
- Branch (or “All branches” for Superadmin/Superfinance)
- Level Tag (if any)
- Status
- Actions

**Creating New Users**

1. Click "Add Personnel" button
2. Select a branch (required for branch-bound roles), then click **Continue**
3. Fill in the form:
   - **Full Name** (required)
   - **Email** (required)
   - **Password** (required when creating, min 6 characters)
   - **Role**: Admin, Teacher, or Finance
   - **Branch**: comes from the previous step
4. Click "Create User"

**Creating Super Accounts (All Branches)**

From the branch selection step, click **Create super account** to create:
- **Superadmin** (all branches)
- **Superfinance** (Finance role with no branch; all branches for finance operations)

**Editing Users**

1. Click "Edit" (three dots menu) on a user
2. Modify user details
3. Update password (optional)
4. Change branch assignment (if applicable)
5. Click "Update User"

**Deleting Users**

1. Click "Delete" (three dots menu) on a user
2. Confirm deletion
3. User is permanently removed from system

**Search and Filter**

- **Search Bar**: Type a name to search
- **Filter by Branch**: Select branch from dropdown
- **Filter by Role**: Select role from dropdown
- **Reset**: Choose "All Branches" / "All Roles" and clear the search box

#### Important Notes

- Only Superadmin can create Superadmin and Admin users
- Students are managed in `Manage Users → Student`, not in `Personnel`.
- Email addresses must be unique
- Passwords must be at least 6 characters
- Superfinance users should not have a branch assigned
- Deleting a user is permanent and may affect related records

---

### Students

**Path**: Manage Users → Student

#### Purpose

Create and manage **Student** accounts across all branches. Student creation also captures the student’s **guardian information**.

#### Features

**Viewing Students**
- See students across all branches
- Search by student name
- Filter by branch (optional)

**Creating a Student**

1. Click "Add Student"
2. Select the student’s **Branch**, then continue
3. Fill in **Student Information** (required unless marked optional):
   - **Full Name**
   - **Email**
   - **Password** (required when creating)
   - **Phone Number** (optional)
   - **Level Tag**: Playgroup, Nursery, Pre-Kindergarten, Kindergarten, Grade School
4. Fill in **Guardian Information** (required):
   - **Guardian Name / Guardian Email / Relationship**
   - **Guardian Phone Number / Guardian Gender**
   - **Address / City / Postal Code / State-Province-Region / Country**
5. Click "Create Student"

**Editing a Student**
- Three-dots menu → **Edit**
- Email is locked (cannot be changed)
- Password is optional (leave blank to keep current)
- Guardian details can be updated

**Deleting a Student**
- Three-dots menu → **Delete** → confirm

---

### Guardians

**Path**: Manage Users → Student Guardians

#### Purpose

Manage parent and guardian records across all branches. Link guardians to students for contact and emergency purposes.

#### Features

**Viewing Guardians**

- See all guardians across all branches
- Filter by branch
- Search by guardian name or student name
- View linked students for each guardian

**Table Information**
- Guardian Name
- Relationship
- Phone Number
- Email
- Branch
- Linked Students
- Actions

**Creating Guardians**

1. Click "Add Guardian" button
2. Fill in the form:
   - **Guardian Name**: Full name (required)
   - **Relationship**: Select from dropdown (Parent, Grandparent, Guardian, etc.)
   - **Phone Number**: Contact number (required)
   - **Email**: Email address
   - **Address**: Full address
   - **Branch**: Select branch (required)
   - **Emergency Contact**: Check if emergency contact
   - **Link to Students**: Select one or more students from the branch
3. Click "Save"

**Editing Guardians**

1. Click "Edit" on a guardian
2. Modify details
3. Add or remove linked students
4. Click "Update"

**Deleting Guardians**

1. Click "Delete" on a guardian
2. Confirm deletion
3. Guardian record is removed (students remain)

**Viewing Linked Students**

- Click on guardian row to see linked students
- View student names and enrollment information
- See which classes students are enrolled in

#### Best Practices

- Link all primary guardians to students
- Keep contact information up to date
- Mark emergency contacts appropriately
- Update when students change guardians

---

### Curriculum

**Path**: Curriculum

#### Purpose

View and manage curriculum definitions across all branches. Curriculum defines the learning structure with phases and sessions.

#### Features

**Viewing Curriculum**

- See all curriculum definitions for all programs
- Filter by branch or program
- View curriculum details
- See phase and session structure

**Creating Curriculum**

1. Click "Add Curriculum" button
2. Fill in basic information:
   - **Curriculum Name**: Name of curriculum (required)
   - **Description**: Detailed description
   - **Program**: Select program (required)
3. Add Phase and Session Details:
   - **Phase Number**: Which phase (1, 2, 3, etc.)
   - **Session Number**: Session within phase (1, 2, 3, etc.)
   - **Topic**: Session topic/title
   - **Learning Goals**: What students will learn
   - **Agenda**: Detailed agenda for the session
4. Click "Save"

**Editing Curriculum**

1. Click "Edit" on a curriculum
2. Modify curriculum details
3. Add, edit, or remove phases and sessions
4. Click "Update"

**Deleting Curriculum**

1. Click "Delete" on a curriculum
2. Confirm deletion
3. Curriculum is removed (ensure no classes are using it)

#### Important Notes

- Curriculum is linked to programs
- Changes may affect existing classes using this curriculum
- Phase and session structure should match program requirements

---

### Program

**Path**: Program

#### Purpose

View and manage educational programs across all branches. Programs define the educational offerings.

#### Features

**Viewing Programs**

- See all programs across all branches
- Filter by branch
- View program statistics
- Search by program name

**Program Information Displayed**
- Program Name
- Branch
- Level Tag
- Description
- Total Phases
- Sessions per Phase
- Session Duration
- Number of Active Classes
- Number of Enrolled Students

**Creating Programs**

1. Click "Add Program" button
2. Fill in the form:
   - **Program Name**: Name of program (required)
   - **Program Description**: Detailed description
   - **Level Tag**: Select level (Nursery, Pre-Kindergarten, etc.) (required)
   - **Branch**: Select branch (required)
   - **Total Phases**: Number of phases in program (required)
   - **Sessions per Phase**: Number of sessions in each phase (required)
   - **Session Duration**: Duration in hours (required)
   - **Promo Eligible**: Check if program is eligible for promos
3. Click "Save"

**Editing Programs**

1. Click "Edit" on a program
2. Modify program details
3. Note: Some fields may be locked if classes exist
4. Click "Update"

**Deleting Programs**

1. Click "Delete" on a program
2. Confirm deletion
3. Program is removed (ensure no classes are using it)

#### Important Notes

- Programs must have curriculum defined
- Total phases should match curriculum structure
- Cannot delete programs with active classes

---

### Classes

**Path**: Classes

#### Purpose

Create and manage classes across all branches. Handle student enrollment, reservations, attendance, and class management system-wide.

#### Features

**Viewing Classes**

- See all classes across all branches
- Filter by Branch
- Filter by Program
- Search by class name
- View class details

**Creating Classes**

1. Click "Create Class" button
2. **Step 1: Select Branch**
   - Select branch from dropdown (required)
   - Click "Next"
3. **Step 2: Class Details**
   - **Class Name/Section**: Name of the class
   - **Program**: Select program from selected branch (required)
   - **Room**: Select room from selected branch (required)
   - **Max Students**: Maximum capacity (required)
   - **Start Date**: When class begins (required)
   - **End Date**: When class ends (auto-calculated, can adjust)
   - **Teacher(s)**: Select one or more teachers (required)
4. **Step 3: Schedule Configuration**
   - Configure days of the week
   - Set start and end times for each day
5. Click "Create Class"
6. System automatically generates all class sessions

**Class Management**

All features from Admin Classes page, plus:
- Can create classes for any branch
- Can view classes across all branches
- Can manage classes system-wide

**Student Enrollment**

- Same enrollment process as Admin
- Can enroll students in any branch's classes
- Can view enrollment across all branches
- **For Installment Packages**: Package selection shows:
  - **Down payment**: Initial downpayment amount
  - **Monthly**: Monthly installment amount

**Class Details**

- View class information
- Manage sessions
- View students
- Track attendance
- Manage reservations

#### Important Notes

- Can create classes for any branch
- Can manage all branches' classes
- Same enrollment and management features as Admin, but system-wide

---

### Room Management

**Path**: Room

#### Purpose

Manage rooms (classrooms) across all branches. Assign rooms to classes and track room availability.

#### Features

**Viewing Rooms**

- See all rooms across all branches
- Filter by branch
- View room capacity
- Check room status
- See room schedule

**Creating Rooms**

1. Click "Add Room" button
2. Fill in the form:
   - **Room Name**: Name of room (required)
   - **Branch**: Select branch (required)
   - **Capacity**: Maximum number of students (required)
   - **Status**: Active or Inactive (required)
3. Click "Save"

**Editing Rooms**

1. Click "Edit" on a room
2. Modify room details
3. Click "Update"

**Deleting Rooms**

1. Click "Delete" on a room
2. Confirm deletion
3. Room is removed

#### Best Practices

- Use clear, descriptive room names
- Set accurate capacity limits
- Keep rooms marked as Active when in use

---

### Package Management

**Path**: Manage Package → Package

#### Purpose

Create and manage enrollment packages across all branches. Packages define pricing and what's included in enrollment.

#### Features

**Viewing Packages**

- See all packages across all branches
- Filter by Branch
- Filter by Level Tag
- Search by package name

**Creating Packages**

1. Click "Add Package" button
2. Fill in the form:
   - **Package Name**: Name of package (required)
   - **Level Tag**: Select level (required)
   - **Branch**: Select branch (required)
   - **Package Type**: Select type (Fullpayment, Installment, Reserved, Phase, Promo)
   - **Package Price**: 
     - For Fullpayment: Total package price
     - For Installment: Monthly installment amount (required)
   - **Downpayment Amount**: Required for Installment packages
   - **Phase Start/End**: For Phase packages
   - **Status**: Active or Inactive
3. Add Package Details (pricing lists, merchandise)
4. Click "Save"

**Package Management**

- Same features as Admin Package page
- Can create packages for any branch
- Can view packages across all branches

#### Important Notes

- Can manage packages system-wide
- For Installment packages, Package Price is monthly amount
- Downpayment Amount is required for Installment packages

---

### Pricing List

**Path**: Manage Package → Pricing List

#### Purpose

Create and manage pricing lists across all branches. Pricing lists define standard fees and charges.

#### Features

**Viewing Pricing Lists**

- See all pricing lists across all branches
- Filter by Branch
- Filter by Level Tag
- Search by name

**Creating Pricing Lists**

1. Click "Add Pricing List" button
2. Fill in the form:
   - **Name**: Name of pricing list (required)
   - **Level Tag**: Select level (required)
   - **Branch**: Select branch (required)
   - **Reservation Fee**: Amount for reservation
   - **Additional Fees**: Other fees
   - **Status**: Active or Inactive
3. Click "Save"

**Editing and Deleting**

- Edit pricing lists
- Delete pricing lists
- Manage across all branches

---

### Merchandise

**Path**: Manage Package → Merchandise

#### Purpose

Manage merchandise items across all branches. Merchandise can be included in packages or sold separately.

#### Features

**Viewing Merchandise**

- See all merchandise across all branches
- Filter by Branch
- Filter by Category
- Search by item name

**Creating Merchandise**

1. Click "Add Merchandise" button
2. Fill in the form:
   - **Item Name**: Name of item (required)
   - **Description**: Detailed description
   - **Price**: Item price (required)
   - **Stock Quantity**: Available quantity (required)
   - **Branch**: Select branch (required)
   - **Category**: Select category
   - **Image**: Upload item image
   - **Status**: Available or Out of Stock
3. Click "Save"

**Merchandise Management**

- Edit merchandise
- Update stock
- Delete merchandise
- Manage across all branches

---

### Promo

**Path**: Manage Package → Promo

#### Purpose

Create and manage promotional offers across all branches or system-wide. Promos can be applied during student enrollment.

#### Features

**Viewing Promos**

- See all promos (branch-specific and system-wide)
- Filter by status
- Search by promo name or code

**Creating Promos**

1. Click "Add Promo" button
2. Fill in the form:
   - **Promo Name**: Name of promotion (required)
   - **Promo Code**: Unique code (required)
   - **Promo Type**: Select from:
     - Percentage Discount (e.g., 10% off)
     - Fixed Amount Discount (e.g., $50 off)
     - Free Merchandise
     - Combined (discount + merchandise)
     - Referral Bonus
   - **Discount Value**: Amount or percentage (required for discount types)
   - **Start Date**: When promo becomes active (required)
   - **End Date**: When promo expires (required)
   - **Status**: Active or Inactive
   - **Applicable Branches**: 
     - Select specific branches
     - Or select "All Branches" for system-wide promo
   - **Applicable Packages**: Select packages that can use this promo
   - **Student Eligibility**: Select eligibility type:
     - All Students: Available to all students
     - New Enrollees Only: Only for new students
     - Returning Students Only: Only for returning students
     - Specific Students: Select individual students
   - **Usage Limits**: Maximum times promo can be used (optional)
   - **For Installment Packages** (when Installment package is selected):
     - **Apply Promo To**: Select where promo applies:
       - Downpayment: Promo applies only to downpayment invoice
       - Monthly: Promo applies to monthly installment invoices
       - Both: Promo applies to both downpayment and monthly invoices
     - **Number of Monthly Invoices to Apply Promo**: If "Monthly" or "Both" is selected, specify how many monthly invoices should receive the promo (e.g., 3 months)
3. Click "Save"

**System-Wide vs Branch-Specific Promos**

- **System-Wide**: Select "All Branches" - usable across all branches
- **Branch-Specific**: Select specific branches - only usable in those branches

**Promo Types Explained**

- **Percentage Discount**: Reduces price by percentage (e.g., 10% = 10% off)
- **Fixed Amount Discount**: Reduces price by fixed amount (e.g., $50 off)
- **Free Merchandise**: Provides free merchandise items (select merchandise items to include)
- **Combined**: Provides both discount and free merchandise
- **Referral Bonus**: Special discount for referrals

**Installment Package Promo Scope**

When creating a promo for Installment packages, you can specify where the promo applies:

- **Downpayment Only**: Promo discount/benefits apply only to the initial downpayment invoice
- **Monthly Only**: Promo applies to monthly installment invoices only (not downpayment)
  - Specify how many monthly invoices should receive the promo (e.g., first 3 months)
- **Both**: Promo applies to both downpayment and monthly invoices
  - For monthly invoices, specify how many months should receive the promo

**Promo Usage Tracking**

- Promo usage is tracked **once per student per promo per package**
- This means a student can use the same promo code for different packages
- But cannot use the same promo code twice for the same package

**Promo Management**

- Edit promos
- Deactivate promos
- Track promo usage
- Manage system-wide and branch-specific promos

#### Important Notes

- Superadmin can create system-wide promos (Admin cannot)
- Promo codes must be unique
- System-wide promos are available to all branches
- Installment promos can target downpayment, monthly, or both

---

### Invoice Management

**Path**: Manage Invoice → Invoice

#### Purpose

Create, view, and manage invoices across all branches. Handle all billing and invoicing operations system-wide.

#### Features

**Viewing Invoices**

- See all invoices across all branches
- Filter by Branch
- Filter by Status
- Search by invoice number or student name

**Creating Invoices**

1. Click "Add Invoice" button
2. Fill in the form:
   - **Student(s)**: Select one or more students (required)
   - **Branch**: Select branch (required)
   - **Invoice Description**: Brief description
   - **Issue Date**: Date invoice is created
   - **Due Date**: When payment is due (required)
   - **Status**: Draft, Pending, or Unpaid
   - **Add Invoice Items**: Add items with descriptions and amounts
   - **Remarks**: Additional notes
3. Click "Create Invoice"

**Invoice Management**

- View invoice details
- Edit invoices
- Download invoice PDFs
- Cancel invoices
- Track payments
- System-wide access to all invoices

#### Important Notes

- Can create and manage invoices for any branch
- Can view all invoices across all branches
- Same invoice features as Admin, but system-wide

---

### Installment Invoice

**Path**: Manage Invoice → Installment Invoice

#### Purpose

View and monitor installment invoice profiles and logs across all branches. Track installment payment plans and phase progress.

#### Features

**Viewing Installment Invoice Logs**

- See all installment invoice records across all branches
- Filter by Branch
- Filter by Status
- Search by student name or program

**Installment Invoice Management**

- View installment details
- Monitor phase progress
- Track payment schedules
- System-wide access

**Phase Progress Display**

- Shows paid phases vs total phases
- Progress bars
- Completion status

#### Important Notes

- Can view installment invoices across all branches
- Phase progress based on paid invoices

---

### Payment Logs

**Path**: Manage Invoice → Payment Logs

#### Purpose

Record and track all payments across all branches. Manage financial transactions system-wide.

#### Features

**Viewing Payment Logs**

- See all payment records across all branches
- Filter by Branch
- Filter by Date Range
- Filter by Payment Method
- Search by student name or invoice number

**Recording Payments**

1. Click "Record Payment" button
2. Fill in payment form:
   - Select Invoice
   - Payment Method
   - Payment Type (Full, Partial, Deposit)
   - Payable Amount
   - Reference Number
   - Issue Date
   - Remarks
3. Click "Record Payment"

**Payment Management**

- View payment details
- Edit payments
- Delete payments
- Export payment data
- System-wide access

#### Important Notes

- Can record payments for any branch
- Can view all payments across all branches
- Payment recording triggers automatic system actions

---

### Settings

**Path**: Settings

#### Purpose

Configure system-wide or branch-specific settings, including installment delinquency management. These settings control how the system handles overdue installment payments.

#### Features

**Viewing Settings**

- See current effective settings
- Choose scope: **Global** (system-wide) or **Branch** (branch-specific)
- For branch scope: Select branch from dropdown
- View which settings are branch-specific vs global defaults

**Installment Delinquency Settings**

Configure how the system handles overdue installment payments:

1. **Penalty Rate (%)**: 
   - Percentage penalty applied to overdue installment invoices
   - Range: 0-100%
   - Example: 10% means 10% penalty on overdue amount
   - Applied after grace period expires

2. **Grace Period (Days)**:
   - Number of days after due date before penalty is applied
   - Range: 0-365 days
   - Example: 7 days means penalty applies 7 days after due date
   - Set to 0 to apply penalty immediately on overdue

3. **Final Drop-off Days**:
   - Number of days overdue before student is automatically removed from enrollment
   - Range: 0-365 days
   - Example: 30 days means student removed 30 days after due date
   - Set to 0 to disable automatic removal

**Updating Settings**

1. Navigate to Settings page
2. **Select Scope**:
   - **Global**: Set system-wide defaults (applies to all branches unless overridden)
   - **Branch**: Set branch-specific settings (select branch from dropdown)
3. Review current effective settings
4. Modify values as needed:
   - Enter penalty rate as percentage (e.g., "10" for 10%)
   - Enter grace period in days (e.g., "7" for 7 days)
   - Enter final drop-off days (e.g., "30" for 30 days)
5. Click "Save Settings"
6. Settings are applied immediately

**How Settings Work**

- **Global Settings**: Apply to all branches as defaults
- **Branch Settings**: Override global defaults for specific branches
- System automatically applies penalties based on effective settings
- Penalties are added to overdue invoices automatically
- Students are automatically removed after final drop-off period expires
- Settings affect all installment invoices in the applicable scope

**Understanding Effective Settings**

- Settings show scope indicator: "Global" or "Branch"
- Branch settings override global defaults
- Effective settings are what the system actually uses
- Can set different values per branch if needed

#### Important Notes

- Global settings apply to all branches unless branch-specific settings exist
- Branch settings override global defaults
- Changes take effect immediately for new overdue invoices
- Existing overdue invoices may need manual processing
- Penalty rate is applied as percentage of overdue amount
- Grace period gives students time before penalty applies
- Final drop-off automatically removes students after specified days
- Can configure different policies per branch if needed

---

## Common Workflows

### Workflow 1: Setting Up a New Branch

1. **Create Branch**
   - Go to Branch → Add Branch
   - Fill in all branch details
   - Save branch

2. **Create Branch Admin**
   - Go to Manage Users → Personnel
   - Click "Add Personnel"
   - Create Admin user
   - Assign to the new branch

3. **Set Up Infrastructure**
   - Create rooms (Room → Add Room)
   - Create programs (Program → Add Program)
   - Create pricing lists (Pricing List → Add)
   - Create packages (Package → Add Package)

4. **Create Initial Users**
   - Create Finance user for branch
   - Create Teachers
   - Add Students as needed

5. **Verify Setup**
   - Check all configurations
   - Test access with Admin account
   - Begin operations

---

### Workflow 2: Enrolling a Student (System-Wide)

1. **Verify Student Account** (if not exists)
   - Go to Manage Users → Student
   - Click "Add Student"
   - Select branch, then fill student + guardian information (required)

2. **Select Branch and Class**
   - Go to Classes
   - Filter by branch
   - Select class

3. **Enroll Student**
   - Click "Enroll Student"
   - Follow enrollment process
   - System creates invoice

4. **Record Payment**
   - Go to Payment Logs
   - Record payment
   - System enrolls student

---

### Workflow 3: Daily System Monitoring

1. **Check Dashboard**
   - Review system-wide statistics
   - Check branch performance
   - Review recent activities

2. **Monitor Operations**
   - Check classes across branches
   - Review invoices and payments
   - Monitor enrollments

3. **Handle Issues**
   - Address system-wide issues
   - Support branch admins
   - Resolve technical problems

---

## Best Practices

### System Management

1. **Regular Monitoring**: Check dashboard and key metrics daily
2. **Branch Oversight**: Monitor all branches regularly
3. **User Management**: Keep user accounts organized
4. **Data Integrity**: Ensure accurate data across branches
5. **Security**: Protect Superadmin access

### User Creation

1. **Create Branches First**: Always create branches before assigning users
2. **Assign Appropriate Roles**: Give users correct role and branch
3. **Set Strong Passwords**: Use secure passwords for new users
4. **Document Users**: Keep track of all users created

### Configuration

1. **System-Wide Settings**: Use system-wide promos and announcements when appropriate
2. **Branch-Specific Settings**: Use branch-specific when needed
3. **Consistency**: Maintain consistency across branches where possible

---

## Troubleshooting

### Common Issues

**Problem**: Cannot create branch
- **Solution**: Verify you're logged in as Superadmin, not Admin

**Problem**: Cannot create Admin users
- **Solution**: Only Superadmin can create Admin users - verify your role

**Problem**: Cannot see other branches' data
- **Solution**: Verify you're logged in as Superadmin (Admin can only see their branch)

**Problem**: System-wide promo not working
- **Solution**: Verify promo is set to "All Branches" and is Active

**Problem**: User creation issues
- **Solution**: 
  - Verify email is unique
  - Check branch assignment (required for most roles)
  - Ensure password meets requirements

### Getting Help

- Review system logs for errors
- Check user permissions
- Verify branch assignments
- Contact technical support if needed

---

## Document Information

**Version**: 1.2
**Last Updated**: January 29, 2026
**Role**: Superadmin
**System**: Physical School Management System
**Organization**: Little Champions Academy Inc.

---

*This manual covers all features available to Superadmin users. You have full system access and can manage all aspects of the system across all branches.*
