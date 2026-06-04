# Physical School Management System - Admin User Manual

## Table of Contents

1. [Introduction](#introduction)
2. [What's New in v1.3](#whats-new-in-v13)
3. [Getting Started](#getting-started)
4. [Admin Role Overview](#admin-role-overview)
5. [Dashboard](#dashboard)
6. [Common UI Patterns](#common-ui-patterns)
7. [Pages and Features](#pages-and-features)
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
   - [Acknowledgement Receipts](#acknowledgement-receipts)
   - [Daily Summary Sales](#daily-summary-sales)
   - [Settings](#settings)
8. [Common Workflows](#common-workflows)
9. [Troubleshooting](#troubleshooting)

---

## Introduction

This manual is specifically designed for **Admin** users of the Physical School Management System. As an Admin, you have full access to manage all operations within your assigned branch, but you cannot access data from other branches.

> **For live demonstrations:** use the step-by-step [Branch Admin Demo Guide](./admin/BRANCH_ADMIN_DEMO_GUIDE.md) and [Quick Reference](./admin/BRANCH_ADMIN_DEMO_QUICK_REFERENCE.md).

### Key Characteristics of Admin Role

- **Access Level**: Single branch (your assigned branch only)
- **Permissions**: Full management capabilities within your branch
- **Limitations**: Cannot create new branches, cannot create Superadmin or Admin users, cannot see other branches' data
- **Scope**: All features available to Superadmin, but restricted to your branch

---

## What's New in v1.3

This release introduces several workflow and UX changes you'll see across the system.

### New pages

- **Acknowledgement Receipts** — review every up-front payment recorded for your branch (reservation/downpayment receipts) with branch, status, reference and attachment. Date range and Month picker filtering are built in.
- **Daily Summary Sales** — view your branch's submissions in two tabs: **End of Shift** and **Cash Deposit Summary**. Includes a "Returned" view for items Finance returned for correction, plus full From/To and Month-picker filtering.

### Payment Logs (Finance verification flow)

- A new **"Rejected"** tab shows payments that Finance/Superfinance permanently rejected. Click **View details** to see the full reject reason, who rejected it and when, then click **Go to invoice** to record a new payment for the same invoice.
- Rejected payments are excluded from the Total Amount, the Financial Dashboard and the Daily Summary. The student stays enrolled — only the money is reversed.
- The "Rejected" tab keeps only the **most recent** rejection for an invoice. Once you record a new payment and the invoice's status leaves "Rejected", the entry disappears from the tab automatically.

### Record Payment modal — discount field

- An optional **Discount Amount** field has been added. It deducts from the customer's payable amount but does not reduce revenue settlement on the invoice — a fully-discounted payment now correctly closes the invoice as "Paid" instead of "Partial".

### Date filtering, search and sortable columns

- **Three date-filter modes** on Payment Logs: **Month picker** (defaults to "This Month"), **Payment date** (From/To) and **Date created** (From/To). Choosing one mode replaces the others.
- The **Acknowledgement Receipts** and **Invoice** pages share the same Month/From/To pattern; AR and the Dashboards default to the **current Manila month**.
- **Search bars** on every list now use server-side filtering with debounce: results update as you stop typing, no more clicking "Next" to find your row.
- **Sortable headers** (with up/down arrows) on Issue Date, Payment Date, Branch, Status and Issued By columns.

### Invoice page

- Removed the "Month" column from the actions area; AR PDF download is still available.
- **"Total Invoice:"** label is now used everywhere (no more "Invoice: 5").
- Status filter is promoted into the toolbar for one-click filtering by Paid / Unpaid / Partial / etc.

### Cash Deposit (Branch Admin)

- The **From** date in the "Deposit Cash" modal is locked to the day after your previous submission's end date — this keeps deposit periods continuous and prevents double-counting.
- The **To** date is now **editable** (capped at today) so you can choose the exact range you're depositing.
- Holding **₱100,000+** in undeposited cash now shows an **urgent login alert** for the branch admin every time you log in until the deposit is recorded. The threshold is configurable in Settings.
- The "Cash Payment Records" table on the Cash Deposit Summary Details modal now correctly shows the original snapshot rows (a fix to a regression where the table appeared empty).

### Other UX improvements

- Reservation upgrade modal accepts a **promotion code** (same input behavior as enrollment).
- Acknowledgement Receipt header is reformatted as **"Acknowledgement Receipt#"**.
- Settings page received a **Template Settings** tab for notification/email/EOD/cash-deposit/payment/reminder templates.
- Merchandise → Uniforms now supports the **2XL** size.
- Financial Dashboard, Enrollment Dashboard and Daily Summary Sales pages default the date filter to **"This Month"**.

---

## Getting Started

### Accessing the System

1. Navigate to your school's system URL
2. Enter your email and password
3. Click "Login"
4. You'll be redirected to the Admin Dashboard

### First Time Setup

1. Ensure your account is created by a Superadmin
2. Verify you're assigned to the correct branch
3. Review your branch information in the Dashboard
4. Familiarize yourself with the navigation menu

---

## Admin Role Overview

### What You Can Do

- Manage branch users (Teachers/Finance via `Manage Users → Personnel`, Students via `Manage Users → Student`)
- Create and manage classes
- Manage curriculum and programs for your branch
- Handle financial operations (invoices, payments)
- Manage packages, pricing, merchandise, and promos
- View and manage guardians
- Create announcements
- Manage rooms

### What You Cannot Do

- Create new branches
- Create Superadmin or Admin users
- View or modify data from other branches
- Create system-wide promos (only branch-specific)
- Access Superadmin-only features

---

## Dashboard

**Path**: Dashboard (main page after login)

### Overview

The Admin Dashboard provides a comprehensive overview of your branch's operations. It displays key metrics and recent activities.

### What You'll See

#### Statistics Section

- **Total Students**: Number of students enrolled in your branch
- **Total Teachers**: Number of teachers in your branch
- **Active Classes**: Number of classes currently running
- **Total Revenue**: Financial metrics for your branch (if applicable)

#### Branch Information

- Your branch name
- Branch location
- Quick access to branch details

#### Recent Activities

- Latest enrollments
- Recent payments
- System updates
- Recent class activities

#### Upcoming Classes

- Today's classes
- Tomorrow's classes
- This week's schedule

### How to Use the Dashboard

1. **View Statistics**: Check the numbers at the top for a quick overview
2. **Monitor Activities**: Scroll through recent activities to stay updated
3. **Quick Navigation**: Click on any statistic to navigate to related pages
4. **Check Schedule**: Review upcoming classes section for today's schedule

### Month picker default

The Financial Dashboard and Enrollment Dashboard default to **"This Month"** (Manila timezone) on first load. Change the **Month** picker to view another period, or refresh to recompute totals for the selected month.

---

## Common UI Patterns

These behaviors are consistent across every list/table in the system. Read this section once and skip the "How to use the table" notes in each page below.

### Search bars (debounced + server-side)

- Every search bar (invoice number, student name, payment reference, etc.) waits ~300 ms after you stop typing before sending the query to the server.
- The page does **not** refresh on each keystroke. Results appear in place once the query returns.
- Pagination resets to page 1 automatically — you no longer need to click "Next" to find a search match.

### Sortable column headers

- Columns like **Issue Date, Payment Date, Branch, Status, Issued By** show small ▲ / ▼ arrows next to the label.
- Click once to sort ascending, click again for descending. Click a different column to reset.
- Sorting works on the visible page only when paginated, and across the full result set when filtering server-side.

### Date filter modes (Payment Logs, AR, Invoice, Daily Summary Sales)

These pages expose three mutually exclusive filter inputs:

1. **From / To** — explicit date range (e.g. record-created date or issue date for AR/Invoice).
2. **Payment date From / To** — for Payment Logs only; filters by the payment's actual issue date.
3. **Month picker** — single `YYYY-MM` selection. Defaults to the current Manila month on AR, Daily Summary Sales and Dashboards.

Selecting a Month clears From/To; entering From or To clears the Month. Use **Clear filters / Clear dates** to remove all three.

### Cash Holding alert (Branch Admin login)

If your branch is holding ≥ the **Cash Holding Alert Threshold** (configured by Superadmin in Settings; default ₱100,000), an **urgent modal** opens on every login until the deposit is submitted. Click **Go to Cash Deposit** to jump straight to the Deposit Cash modal in Payment Logs.

---

## Pages and Features

### Calendar

**Path**: Calendar

#### Purpose

View and manage class schedules for your branch in a calendar format.

#### Features

**Monthly View**
- See all class sessions for the month
- Color-coded by class or status
- Navigate between months using arrows

**Filtering Options**
- Filter by Program
- Filter by Class
- Filter by Teacher
- Filter by Room
- Clear filters to see all

**Session Information**
- Click on any session to see details:
  - Class name and code
  - Date and time
  - Room location
  - Teacher assigned
  - Number of students
  - Session status (Scheduled, Completed, Cancelled, etc.)

**Class Sessions View**
- Click on a class in the calendar
- View all sessions for that class
- See phase and session numbers
- Check attendance status
- View curriculum topics

#### How to Use

1. **Navigate**: Use month navigation arrows to move between months
2. **Filter**: Use filter dropdowns to narrow down displayed classes
3. **View Details**: Click on any session to see full details
4. **View Class**: Click on class name to see all sessions for that class

---

### Announcements

**Path**: Announcements

#### Purpose

Create, view, and manage announcements for your branch. Send messages to students, teachers, parents, or all users.

#### Features

**Viewing Announcements**
- See all announcements (active and inactive)
- Filter by status (Active, Inactive, Draft)
- Filter by priority (High, Medium, Low)
- Filter by recipient group
- Search by title or content

**Creating Announcements**

1. Click "+ Create Announcement" button
2. Fill in the form:
   - **Title**: Brief, descriptive title (required)
   - **Message Body**: Full announcement content (required)
   - **Priority**: High, Medium, or Low (required)
   - **Recipient Groups**: Select who should see this:
     - All
     - Students
     - Teachers
     - Parents
     - Admin
     - Finance
   - **Branch**: Automatically set to your branch (cannot change)
   - **Start Date**: When announcement becomes visible
   - **End Date**: When announcement expires
   - **Status**: Active, Inactive, or Draft
3. Click "Publish" to make it active

**Managing Announcements**
- **Edit**: Click "Edit" to modify an announcement
- **Delete**: Click "Delete" to remove an announcement
- **View Details**: Click on announcement to see full details
- **Track Reads**: See how many users have read the announcement

#### Best Practices

- Use clear, concise titles
- Set appropriate priority levels
- Set realistic end dates
- Use "Draft" status to save work in progress
- Review before publishing

---

### Personnel Management

**Path**: Manage Users → Personnel

#### Purpose

Manage your branch staff accounts (non-students). This page is for **Teacher** and **Finance** users in your branch.

#### Features

**Viewing Personnel**
- See all non-student users in your branch
- Filter by Role (Teacher, Finance)
- Search by name
- View user details in table format

**Table Columns**
- Full Name
- Email
- Role
- Level Tag (if any)
- Status
- Actions (Edit, Delete)

**Creating New Users**

1. Click "Add Personnel" button
2. Fill in the form:
   - **Full Name**: User's full name (required)
   - **Email**: Unique email address (required)
   - **Password**: Initial password (required, min 6 characters)
   - **Role**: Teacher or Finance
   - **Phone**: Optional
   - **Branch**: Automatically set to your branch (cannot change)
3. Click "Create User"

#### Important Notes

- Students are managed in `Manage Users → Student`, not in `Personnel`.
- Admin users cannot create other Admin/Superadmin accounts.
- Email addresses must be unique.
- Passwords must be at least 6 characters.
- You can only manage users from your branch.
- Deleting a user is permanent and may affect related records.

**Editing Users**

1. Click "Edit" (three dots menu) on a user
2. Modify user details
3. Update password (optional)
4. Click "Update User"

**Deleting Users**

1. Click "Delete" (three dots menu) on a user
2. Confirm deletion
3. User is permanently removed from system

**Search and Filter**

- **Search Bar**: Type a name to search
- **Filter by Role**: Select from dropdown
- **Reset**: Choose "All Roles" and clear the search box

---

### Students

**Path**: Manage Users → Student

#### Purpose

Create and manage **Student** accounts for your branch. Student creation also collects the student’s **guardian information**.

#### Features

**Viewing Students**
- See all students in your branch
- Search by student name
- View basic info (email, level tag, phone)

**Creating a Student**

1. Click "Add Student"
2. Fill in **Student Information**:
   - **Full Name** (required)
   - **Email** (required)
   - **Password** (required when creating)
   - **Phone Number** (optional)
   - **Branch**: fixed to your branch
   - **Level Tag** (required): Playgroup, Nursery, Pre-Kindergarten, Kindergarten, Grade School
3. Fill in **Guardian Information** (required):
   - **Guardian Name**
   - **Guardian Email**
   - **Relationship**
   - **Guardian Phone Number**
   - **Guardian Gender**
   - **Address / City / Postal Code / State-Province-Region / Country**
4. Click "Create Student"

**Editing a Student**
- Click the three-dots menu → **Edit**
- Email is locked (cannot be changed)
- Password is optional (leave blank to keep current)
- Update guardian details as needed

**Deleting a Student**
- Click the three-dots menu → **Delete**
- Confirm deletion

---

### Guardians

**Path**: Manage Users → Student Guardians

#### Purpose

Manage parent and guardian records for students in your branch. Link guardians to students for contact and emergency purposes.

#### Features

**Viewing Guardians**
- See all guardians in your branch
- Search by guardian name or student name
- View linked students for each guardian
- Filter by relationship type

**Table Information**
- Guardian Name
- Relationship (Parent, Grandparent, etc.)
- Phone Number
- Email
- Linked Students
- Actions (Edit, Delete)

**Creating Guardians**

1. Click "Add Guardian" button
2. Fill in the form:
   - **Guardian Name**: Full name (required)
   - **Relationship**: Select from dropdown (Parent, Grandparent, Guardian, etc.)
   - **Phone Number**: Contact number (required)
   - **Email**: Email address
   - **Address**: Full address
   - **Emergency Contact**: Check if this is an emergency contact
   - **Link to Students**: Select one or more students from your branch
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

View and manage curriculum definitions for programs in your branch. Curriculum defines the learning structure with phases and sessions.

#### Features

**Viewing Curriculum**
- See all curriculum definitions for your branch's programs
- View curriculum details
- See phase and session structure
- Filter by program

**Curriculum Structure**
- **Curriculum Name**: Name of the curriculum
- **Program**: Associated program
- **Description**: Curriculum description
- **Phases**: Number of phases
- **Sessions per Phase**: Sessions in each phase

**Creating Curriculum**

1. Click "Add Curriculum" button
2. Fill in basic information:
   - **Curriculum Name**: Name of curriculum (required)
   - **Description**: Detailed description
   - **Program**: Select program from your branch
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

**Viewing Curriculum Details**

- Click on curriculum name to see full details
- View all phases and sessions
- See learning goals and agendas
- Check which programs use this curriculum

#### Important Notes

- Curriculum is linked to programs
- Changes may affect existing classes using this curriculum
- Phase and session structure should match program requirements
- Ensure all phases have complete session information

---

### Program

**Path**: Program

#### Purpose

View and manage educational programs for your branch. Programs define the educational offerings (e.g., Nursery, Pre-Kindergarten, Kindergarten).

#### Features

**Viewing Programs**
- See all programs for your branch
- View program statistics (enrolled students, active classes)
- Filter by level tag
- Search by program name

**Program Information Displayed**
- Program Name
- Level Tag (Nursery, Pre-K, etc.)
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
   - **Level Tag**: Select level (Nursery, Pre-Kindergarten, Kindergarten, etc.)
   - **Branch**: Automatically set to your branch
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

**Viewing Program Statistics**

- Click on program name to see details
- View enrolled student count
- See active classes count
- Check program curriculum
- View associated packages

#### Important Notes

- Programs must have curriculum defined
- Total phases should match curriculum structure
- Sessions per phase should match curriculum
- Cannot delete programs with active classes
- Level tags help categorize programs

---

### Classes

**Path**: Classes

#### Purpose

Create and manage classes for your branch. This is one of the most important pages for daily operations. Handle student enrollment, reservations, attendance, and class management.

#### Features

**Viewing Classes**

- See all classes in your branch
- Filter by Program
- Search by class name
- View class details:
  - Class name and code
  - Program
  - Teacher(s)
  - Room
  - Student count (X/Y max)
  - Status
  - Schedule

**Class List Table Columns**
- Class Code
- Class Name
- Program Name
- Teacher(s)
- Room
- Student Count (e.g., "5/10" means 5 enrolled out of 10 max)
- Schedule
- Actions (three dots menu)

**Creating Classes**

1. Click "Create Class" button
2. **Step 1: Select Branch**
   - Your branch is pre-selected (cannot change)
   - Click "Next"
3. **Step 2: Class Details**
   - **Class Name/Section**: Name of the class (e.g., "Buzzy Bees")
   - **Program**: Select program from your branch (required)
   - **Room**: Select room from your branch (required)
   - **Max Students**: Maximum capacity (required)
   - **Start Date**: When class begins (required)
   - **End Date**: When class ends (auto-calculated, can adjust)
   - **Teacher(s)**: Select one or more teachers (required)
4. **Step 3: Schedule Configuration**
   - Configure days of the week:
     - Check days when class meets
     - Set start time for each day
     - Set end time for each day
     - Example: Monday 9:00 AM - 10:00 AM, Wednesday 9:00 AM - 10:00 AM
5. Click "Create Class"
6. System automatically generates all class sessions based on program structure

**Class Code**
- Automatically generated (e.g., "PK-2026-001")
- Format: [Level Tag]-[Year]-[Sequence Number]
- Cannot be manually changed

**Viewing Class Details**

1. Click on a class name or "View" button
2. See comprehensive class information:
   - **Overview**: Class name, code, program, teacher, room, schedule
   - **Sessions**: All class sessions organized by phase
   - **Students**: Enrolled and reserved students
   - **Attendance**: Attendance records

**Class Sessions View**

- **Phase Organization**: Sessions grouped by phase
- **Session Information**: Each session shows:
  - Session number
  - Date and time
  - Status (Scheduled, Completed, Cancelled, Rescheduled, In Progress)
  - Attendance status
  - Curriculum topic
- **Expand/Collapse**: Click phase number to expand/collapse sessions
- **Session Actions**: Click three dots on session for options:
  - Mark Attendance
  - View Details
  - Substitute Teacher
  - Reschedule
  - Cancel

**Student Management**

**Enrolling Students**

1. Click "Enroll Student" button on a class
2. **Step 1: Enrollment Option**
   - Select "Package" or "Per Phase" enrollment
   - Click "Next"
3. **Step 2: Package Selection** (if Package selected)
   - Select a package from available packages
   - View package details and inclusions
   - Apply promo code if applicable
   - Click "Next"
4. **Step 3: Student Selection**
   - Search and select student(s)
   - View available slots (X/Y max)
   - Click "Next"
5. **Step 4: Review**
   - Review enrollment details
   - Check package/phase information
   - Verify amounts
   - Click "Enroll"
6. System creates invoice(s) and enrollment record

**Enrollment Types**

- **Full Payment**: Student pays entire amount upfront
- **Installment**: Student pays in monthly installments
  - Requires downpayment (if package type is Installment)
  - Monthly invoices auto-generated
  - Student enrolled in Phase 1 after first installment paid
- **Per Phase**: Student pays for individual phases
  - Select phase number
  - Set amount for that phase
  - Can enroll in multiple phases

**Viewing Enrolled Students**

1. Click "View Students" button on a class
2. **Step 1: Phase Selection**
   - Select a phase or "All Phases"
   - Click "Next"
3. **Step 2: Student List**
   - See all enrolled students
   - View student information:
     - Name
     - Email
     - Phase enrolled
     - Enrollment date
     - Enrollment status
   - Students with "Pending (Downpayment Paid)" badge:
     - Have paid downpayment
     - Not yet enrolled in Phase 1
     - Will be enrolled when first installment is paid
   - Enrollment count shows only fully enrolled students (e.g., "1/5" means 1 enrolled, 4 pending)

**Reserving Student Spots**

1. Click "Reserve Student" button on a class
2. Select student
3. Select reservation package (if applicable)
4. Set reservation fee due date
5. Click "Reserve"
6. System creates reservation fee invoice
7. Student spot is reserved until upgrade or expiration

**Viewing Reserved Students**

1. Click "View Reserved" button on a class
2. See all reserved students:
   - Student name
   - Reservation date
   - Reservation fee status
   - Due date
   - Options to upgrade to enrollment
3. **Upgrade Reservation**:
   - Click "Upgrade to Enrollment"
   - Follow enrollment process
   - Reservation fee paid amount is considered
   - Student moves from reserved to enrolled

**Attendance Management**

1. Click on a session
2. Click "Mark Attendance" (or three dots menu → Mark Attendance)
3. **Attendance Modal Opens**:
   - See all students enrolled in that phase
   - Mark each student:
     - **Present**: Student attended
     - **Absent**: Student did not attend
     - **Late**: Student arrived late
     - **Excused**: Absence is excused
   - Add notes for the session (optional)
   - Add agenda (optional)
4. Click "Save Attendance"
5. Attendance is recorded and locked (cannot edit after saving)

**Attendance Features**
- **Quick Mark All Present**: Button to mark all students present
- **Session Notes**: Add notes about the session
- **Session Agenda**: Document what was covered
- **Attendance History**: View past attendance records
- **Attendance Lock**: Once saved, attendance cannot be edited (prevents tampering)

**Class Management Actions**

**Edit Class**
- Click "Edit" (three dots menu)
- Modify class details
- Cannot change program after class creation
- Cannot change phase/session structure

**Merge Classes**
- Click "Merge Classes" (if available)
- Select classes to merge
- Classes must have same phase structure
- All students moved to merged class
- Original classes deleted

**Delete Class**
- Click "Delete" (three dots menu)
- Confirm deletion
- Class and all sessions removed
- Student enrollments may be affected

**View Session Details**
- Click on any session
- See session information:
  - Date and time
  - Room
  - Teacher
  - Students enrolled
  - Attendance status
  - Curriculum topic
  - Notes and agenda

**Substitute Teacher**
- Click three dots on a session
- Click "Substitute Teacher"
- Select replacement teacher
- Session teacher is updated
- Original teacher is notified

**Reschedule Session**
- Click three dots on a session
- Click "Reschedule"
- Select new date and time
- Update session schedule
- Students are notified

**Cancel Session**
- Click three dots on a session
- Click "Cancel"
- Session is marked as cancelled
- Students are notified

#### Important Notes

- Classes are automatically generated sessions based on program structure
- Student enrollment count includes only fully enrolled students
- Pending students (downpayment paid) appear in list but don't count toward capacity
- Attendance once saved cannot be edited
- Class code is auto-generated and unique
- Cannot change program after class is created

---

### Room Management

**Path**: Room

#### Purpose

Manage rooms (classrooms) for your branch. Assign rooms to classes and track room availability.

#### Features

**Viewing Rooms**
- See all rooms in your branch
- View room capacity
- Check room status (Active/Inactive)
- See room schedule

**Room Information**
- Room Name
- Branch (your branch)
- Capacity (maximum students)
- Status (Active/Inactive)
- Schedule information

**Creating Rooms**

1. Click "Add Room" button
2. Fill in the form:
   - **Room Name**: Name of room (e.g., "Room 101") (required)
   - **Branch**: Automatically set to your branch
   - **Capacity**: Maximum number of students (required)
   - **Status**: Active or Inactive (required)
3. Click "Save"

**Editing Rooms**

1. Click "Edit" on a room
2. Modify room details:
   - Room name
   - Capacity
   - Status
3. Click "Update"
4. Note: Cannot change room if it has scheduled classes

**Deleting Rooms**

1. Click "Delete" on a room
2. Confirm deletion
3. Room is removed (ensure no classes are using it)

**Viewing Room Schedule**

- Click on room name to see schedule
- View classes assigned to room
- See time slots
- Check availability
- Identify scheduling conflicts

#### Best Practices

- Use clear, descriptive room names
- Set accurate capacity limits
- Keep rooms marked as Active when in use
- Mark as Inactive when room is unavailable
- Check schedule before deleting rooms

---

### Package Management

**Path**: Manage Package → Package

#### Purpose

Create and manage enrollment packages for your branch. Packages define pricing and what's included in enrollment.

#### Features

**Viewing Packages**
- See all packages for your branch
- Filter by Level Tag
- Search by package name
- View package status (Active/Inactive)

**Package Table Columns**
- Package Name
- Level Tag
- Package Type
- Package Price
- Downpayment (for Installment packages)
- Status
- Actions

**Creating Packages**

1. Click "Add Package" button
2. Fill in the form:
   - **Package Name**: Name of package (required)
   - **Level Tag**: Select level (Nursery, Pre-K, etc.) (required)
   - **Branch**: Automatically set to your branch
   - **Package Type**: Select from:
     - **Fullpayment**: One-time full payment
     - **Installment**: Monthly installment payments
     - **Reserved**: Reservation package
     - **Phase**: Phase-based package
     - **Promo**: Promotional package
   - **Package Price**: 
     - For Fullpayment: Total package price
     - For Installment: Monthly installment amount (required)
   - **Downpayment Amount**: Required for Installment packages
   - **Phase Start**: For Phase packages (optional)
   - **Phase End**: For Phase packages (optional)
   - **Status**: Active or Inactive (required)
3. **Add Package Details** (optional):
   - Add Pricing Lists
   - Add Merchandise items
4. Click "Save"

**Package Types Explained**

- **Fullpayment**: Student pays entire amount at once
- **Installment**: Student pays monthly installments
  - Package Price = Monthly installment amount
  - Downpayment Amount = Initial downpayment required
  - Monthly invoices auto-generated
- **Reserved**: For reservation fees only
- **Phase**: Covers specific phases (e.g., Phase 1-3)
- **Promo**: Promotional package with discounts

**Editing Packages**

1. Click "Edit" (three dots menu) on a package
2. Modify package details
3. Update package inclusions (pricing lists, merchandise)
4. Click "Update"

**Viewing Package Details**

1. Click on package name or "View Details"
2. See comprehensive information:
   - Package information
   - Included Pricing Lists
   - Included Merchandise
   - Package pricing
   - Status

**Deleting Packages**

1. Click "Delete" (three dots menu) on a package
2. Confirm deletion
3. Package is removed (ensure no enrollments use it)

**Package Details Management**

- **Add Pricing List**: Link pricing lists to package
- **Add Merchandise**: Include merchandise items in package
- **Remove Items**: Remove pricing lists or merchandise from package

#### Important Notes

- For Installment packages, Package Price is the monthly amount, not total
- Downpayment Amount is required for Installment packages
- Cannot delete packages that are in use
- Package details (pricing lists, merchandise) are optional
- Status must be Active for packages to be available during enrollment

---

### Pricing List

**Path**: Manage Package → Pricing List

#### Purpose

Create and manage pricing lists for your branch. Pricing lists define standard fees and charges that can be included in packages.

#### Features

**Viewing Pricing Lists**
- See all pricing lists for your branch
- Filter by Level Tag
- Search by name
- View pricing details

**Pricing List Information**
- Name
- Level Tag
- Reservation Fee
- Additional Fees
- Status

**Creating Pricing Lists**

1. Click "Add Pricing List" button
2. Fill in the form:
   - **Name**: Name of pricing list (required)
   - **Level Tag**: Select level (required)
   - **Branch**: Automatically set to your branch
   - **Reservation Fee**: Amount for reservation (optional)
   - **Additional Fees**: Other fees (optional)
   - **Status**: Active or Inactive
3. Click "Save"

**Editing Pricing Lists**

1. Click "Edit" on a pricing list
2. Modify pricing details
3. Click "Update"

**Deleting Pricing Lists**

1. Click "Delete" on a pricing list
2. Confirm deletion
3. Pricing list is removed

#### Best Practices

- Use clear naming conventions
- Keep pricing lists organized by level
- Update pricing regularly
- Mark inactive pricing lists instead of deleting if they're linked to packages

---

### Merchandise

**Path**: Manage Package → Merchandise

#### Purpose

Manage merchandise items (uniforms, supplies, etc.) for your branch. Merchandise can be included in packages or sold separately.

#### Features

**Viewing Merchandise**
- See all merchandise items for your branch
- Filter by Category
- Search by item name
- View stock levels
- See prices

**Merchandise Table Columns**
- Item Name
- Category
- Price
- Stock Quantity
- Status (Available/Out of Stock)
- Image
- Actions

**Creating Merchandise**

1. Click "Add Merchandise" button
2. Fill in the form:
   - **Item Name**: Name of item (required)
   - **Description**: Detailed description
   - **Price**: Item price (required)
   - **Stock Quantity**: Available quantity (required)
   - **Branch**: Automatically set to your branch
   - **Category**: Select category (Uniform, Supplies, etc.)
   - **Image**: Upload item image (optional)
   - **Status**: Available or Out of Stock (required)
3. Click "Save"

**Editing Merchandise**

1. Click "Edit" (three dots menu) on an item
2. Modify item details
3. Update stock quantity
4. Change status
5. Click "Update"

**Updating Stock**
- Edit merchandise item
- Update Stock Quantity field
- Save changes
- Status automatically updates based on stock (0 = Out of Stock)

**Deleting Merchandise**

1. Click "Delete" (three dots menu) on an item
2. Confirm deletion
3. Item is removed

**Viewing Merchandise Details**
- Click on item name
- See full item information
- View image
- Check stock history

#### Best Practices

- Upload clear product images
- Keep stock quantities accurate
- Update stock regularly
- Use appropriate categories
- Mark items as Out of Stock when inventory is zero

#### Uniform sizes

For items with category "Uniform", available sizes are **XS, S, M, L, XL, 2XL**. Stock is tracked per size.

---

### Promo

**Path**: Manage Package → Promo

#### Purpose

Create and manage promotional offers and discounts for your branch. Promos can be applied during student enrollment.

#### Features

**Viewing Promos**
- See all promos (branch-specific and system-wide)
- Filter by status (Active/Inactive)
- Search by promo name or code
- View promo details

**Promo Information**
- Promo Name
- Promo Code
- Promo Type
- Discount Value
- Start Date / End Date
- Status
- Usage Count

**Creating Promos**

1. Click "Add Promo" button
2. Fill in the form:
   - **Promo Name**: Name of promotion (required)
   - **Promo Code**: Unique code (e.g., "SUMMER2024") (required)
   - **Promo Type**: Select from:
     - Percentage Discount (e.g., 10% off)
     - Fixed Amount Discount (e.g., $50 off)
     - Free Merchandise
     - Combined (discount + merchandise)
     - Referral Bonus
   - **Discount Value**: Amount or percentage (required for discount types)
   - **Start Date**: When promo becomes active (required)
   - **End Date**: When promo expires (required)
   - **Status**: Active or Inactive (required)
   - **Applicable Branches**: Select branches (your branch or all)
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

**Editing Promos**

1. Click "Edit" on a promo
2. Modify promo details
3. Update dates or status
4. Click "Update"

**Deactivating Promos**

- Edit promo
- Change status to Inactive
- Promo becomes unavailable but remains in system

**Tracking Promo Usage**

- View "Usage Count" in promo list
- See how many times promo has been used
- Monitor promo effectiveness

#### Important Notes

- Promo codes must be unique
- Promos must be Active to be used
- Date range must be valid (start date before end date)
- Can create branch-specific or system-wide promos (if you have permission)
- Usage limits help control promo distribution

---

### Invoice Management

**Path**: Manage Invoice → Invoice

#### Purpose

Create, view, and manage invoices for students in your branch. Handle all billing and invoicing operations.

#### Features

**Viewing Invoices**
- See all invoices for your branch
- Filter by Status (Pending, Paid, Partially Paid, Unpaid, Overdue, Cancelled, **Rejected**)
- Search by invoice number or student name (debounced, server-side — see Common UI Patterns)
- Sort by Issue Date, Status, Branch using the sortable column headers
- Use **From/To** date range or the **Month picker** to scope the list (date filtering is server-side, so totals always match what's shown)
- The summary card on top reads **"Total Invoice: N"** and **"Total Amount: ₱…"** for the current filtered view
- View invoice details
- Download invoice PDFs

**Invoice Status — Rejected**

When Finance/Superfinance rejects a payment, the linked invoice flips to **Rejected** status immediately. You can record a new payment from the action menu — the rejected payment stays in the audit trail (visible in Payment Logs → Rejected tab) but no longer counts as revenue.

**Invoice Table Columns**
- Invoice Number (INV-XXXX)
- Student Name(s)
- Branch
- Status (with color coding:
  - **Paid**: Green background
  - **Pending**: Yellow background
  - **Unpaid**: Red background
  - **Overdue**: Red background
  - **Partially Paid**: Yellow background)
- Amount
- Due Date
- Actions

**Creating Invoices**

1. Click "Add Invoice" button
2. Fill in the form:
   - **Student(s)**: Select one or more students (required)
   - **Branch**: Automatically set to your branch
   - **Invoice Description**: Brief description
   - **Issue Date**: Date invoice is created (defaults to today)
   - **Due Date**: When payment is due (required)
   - **Status**: Draft, Pending, or Unpaid (default: Draft)
   - **Add Invoice Items**:
     - Click "Add Item"
     - Description (required)
     - Amount (required)
     - Tax Item (optional)
     - Tax Percentage (optional)
     - Discount Amount (optional)
     - Penalty Amount (optional)
     - Click "Add" to add item
   - **Remarks**: Additional notes
3. Click "Create Invoice"
4. System generates invoice number (INV-XXXX)
5. Invoice is created and linked to selected students

**Invoice Items**

- Can add multiple items to one invoice
- Each item can have:
  - Description
  - Amount
  - Tax (percentage)
  - Discount
  - Penalty
- Total amount is calculated automatically
- Items can be edited or removed before invoice is finalized

**Viewing Invoice Details**

1. Click on invoice number or "View" (three dots menu)
2. See comprehensive invoice information:
   - Invoice number and description
   - Student information
   - Issue date and due date
   - Status
   - Items breakdown with amounts
   - Tax calculations
   - Discounts and penalties
   - Total amount
   - Payment history
   - Remarks

**Editing Invoices**

- Click "Edit" (three dots menu) on an invoice
- Can only edit invoices with status: Draft, Pending, or Unpaid
- Modify invoice details
- Add, edit, or remove items
- Update dates
- Change status
- Click "Update"

**Downloading Invoice PDF**

1. Click "View" on an invoice
2. Click "Download PDF" button
3. PDF is generated and downloaded
4. PDF includes:
   - School branding
   - Invoice number and details
   - Student information
   - Items breakdown
   - Payment information
   - Total amounts

**Cancelling Invoices**

1. Click "Cancel" (three dots menu) on an invoice
2. Confirm cancellation
3. Invoice status changes to Cancelled
4. Can only cancel unpaid invoices

**Invoice Status**

- **Draft**: Not finalized, can be edited
- **Pending**: Awaiting payment
- **Unpaid**: Payment not received (past due or not yet due)
- **Paid**: Fully paid
- **Partially Paid**: Some payment received
- **Overdue**: Past due date and not paid
- **Cancelled**: Invoice voided

**Invoice and Student Enrollment**

- Invoices can be linked to enrollment
- When invoice is paid, student enrollment is activated
- Installment invoices track phase progress
- Reservation invoices track reservation status

#### Important Notes

- Invoice numbers are auto-generated (INV-XXXX)
- Cannot edit paid invoices
- Can only cancel unpaid invoices
- Invoice status colors: Paid (green), Pending (yellow), Unpaid (red), Overdue (red)
- PDF download requires internet connection
- Invoice items can include taxes, discounts, and penalties

---

### Installment Invoice

**Path**: Manage Invoice → Installment Invoice

#### Purpose

View and monitor installment invoice profiles and logs. Track installment payment plans and phase progress for students.

#### Features

**Viewing Installment Invoice Logs**

- See all installment invoice records
- View phase progress (X/Y phases completed)
- Filter by status
- Search by student name or program
- View installment details

**Installment Invoice Table Columns**
- Student Name
- Program Name
- Amount (Excluding Tax)
- Amount (Including Tax)
- Frequency (e.g., "1 month(s)")
- Next Generation Date
- Next Month
- Phase Progress (e.g., "2/2" with progress bar)
- Status (Pending, Generated, etc.)
- Actions

**Phase Progress Display**

- Shows "X/Y" format (e.g., "1/2", "2/2")
- X = Number of phases actually paid (paid_phases)
- Y = Total number of phases
- Progress bar shows completion percentage
- Green progress bar when completed
- Blue progress bar when in progress
- "Completed" label when all phases are paid

**Understanding Phase Progress**

- **Phase Progress is based on ACTUAL PAID invoices**, not generated invoices
- For Installment packages with downpayment:
  - Downpayment paid = 0 phases completed (student not enrolled yet)
  - First installment (Phase 1) paid = 1 phase completed (student enrolled in Phase 1)
  - Second installment (Phase 2) paid = 2 phases completed (student enrolled in Phase 2)
  - And so on...
- Progress only updates when invoices are actually paid

**Installment Invoice Records**

- Each record represents a scheduled installment invoice
- Shows when next invoice will be generated
- Displays payment status
- Links to actual invoices in Invoice page

**Viewing Installment Details**

1. Click on installment invoice record
2. See detailed information:
   - Student information
   - Program and class
   - Installment amount
   - Frequency
   - Payment schedule
   - Generated invoices
   - Payment history

**Manual Invoice Generation** (if available)

- Generate invoice manually if needed
- Fill in generation dates
- Create invoice from installment record
- Use only when automatic generation fails

**Filtering and Searching**

- **Filter by Status**: Pending, Generated, etc.
- **Search**: By student name or program name
- **Sort**: By date, student name, etc.

#### Important Notes

- Installment invoices are automatically generated by the system
- Phase progress reflects ACTUAL PAID invoices, not generated invoices
- Downpayment payments don't count toward phase progress
- Only installment invoice payments count toward phases
- Progress bar and "Completed" status update when invoices are paid

---

### Payment Logs

**Path**: Manage Invoice → Payment Logs

#### Purpose

Record and track all payments. This is where Finance staff (and you) record payments received from students/parents.

#### Features

**Viewing Payment Logs**
- See all payment records for your branch
- Filter by Date Range
- Filter by Payment Method
- Search by student name or invoice number
- View payment details
- Export payment data

**Payment Table Columns**
- Payment ID
- Invoice Number
- Student Name
- Payment Method
- Payment Type
- Amount
- Payment Date
- Status
- Reference Number
- Actions

**Recording Payments**

The Record Payment modal is opened from the **Invoice** page (action menu → Pay). It now also accepts an optional discount.

1. Open the invoice's action menu and click **Pay**
2. Fill in the form:
   - **Student**: Automatically filled from invoice
   - **Payment Method**: Select from:
     - Cash
     - Bank Transfer
     - GCash
     - PayMaya
     - Check
     - Credit Card
     - Other
   - **Payment Type**: Full, Partial, or Deposit
   - **Payable Amount**: Cash actually collected from the customer (required)
   - **Discount Amount** (optional): A discount applied at payment time. Counts toward invoice settlement but **not** revenue — so a discounted payment can still close an invoice as "Paid" instead of "Partial".
   - **Reference Number**: Receipt/transaction number (optional but recommended)
   - **Issue Date**: Payment date (defaults to today)
   - **Remarks**: Additional notes
3. Click "Record Payment"
4. System updates invoice status automatically using `payable_amount + discount_amount` as the settlement total

> Tip: Discounts apply only to the current payment line. They do not retroactively change other payments on the same invoice.

**Payment Recording Effects**

When a payment is recorded, the system automatically:
- Updates invoice status (Paid, Partially Paid, Unpaid)
- Enrolls student in class (if enrollment invoice is fully paid)
- Progresses installment phases (if installment invoice is paid)
- Upgrades reservations to enrollments (if reservation fee is paid)
- Creates first installment invoice (if downpayment is paid for Installment package)

**Viewing Payment Details**

1. Click on payment record
2. See comprehensive information:
   - Payment information
   - Linked invoice details
   - Student information
   - Payment method and reference
   - Payment date
   - Amount paid
   - Status

**Editing Payments**

1. Click "Edit" (three dots menu) on a payment
2. Modify payment details
3. Update amount, date, or reference number
4. Click "Update"
5. System recalculates invoice status

**Deleting Payments**

1. Click "Delete" (three dots menu) on a payment
2. Confirm deletion
3. Payment is removed
4. System updates invoice status (may become Unpaid)
5. Student enrollment may be affected (if enrollment was triggered by payment)

**Payment Methods**

- **Cash**: Physical cash payment
- **Bank Transfer**: Bank deposit or transfer
- **GCash**: Mobile money payment
- **PayMaya**: Mobile money payment
- **Check**: Check payment
- **Credit Card**: Card payment
- **Other**: Any other method

**Payment Types**

- **Full**: Full payment of invoice amount
- **Partial**: Partial payment (less than invoice amount)
- **Deposit**: Deposit payment (typically for reservations)

**Filtering Payments**

- **By Date Range**: Select start and end dates
- **By Payment Method**: Filter by cash, bank transfer, etc.
- **By Student**: Search by student name
- **By Invoice**: Search by invoice number

**Exporting Payment Data**

- Export to Excel/CSV
- Includes all filtered data
- Useful for accounting and reporting

#### Important Payment Workflows

**Recording Full Payment**
1. Locate invoice in Invoice page
2. Note invoice number and amount
3. Go to Payment Logs
4. Click "Record Payment"
5. Select invoice
6. Enter payment details
7. Click "Record"
8. Invoice status changes to "Paid"
9. Student enrollment activated (if applicable)

**Recording Partial Payment**
1. Follow steps above
2. Enter amount less than invoice total
3. Invoice status changes to "Partially Paid"
4. Can record additional payments later

**Recording Downpayment Payment** (for Installment packages)
1. Student pays downpayment invoice
2. Record payment in Payment Logs
3. System automatically:
   - Marks downpayment as paid
   - Creates first installment invoice record
   - Generates first monthly invoice
   - Student appears as "Pending (Downpayment Paid)" in class modal
4. Student is NOT enrolled yet (enrolled when first installment is paid)

**Recording Installment Payment**
1. Student pays monthly installment invoice
2. Record payment in Payment Logs
3. System automatically:
   - Updates invoice status to Paid
   - Progresses student to next phase (if applicable)
   - Enrolls student in Phase 1 (if this is first installment payment)
   - Generates next month's invoice (if applicable)

#### Important Notes

- Always include reference numbers for tracking
- Verify amounts before recording
- Record payments immediately after receipt
- Partial payments can be recorded multiple times
- Deleting a payment may affect student enrollment
- Payment recording triggers automatic system actions (enrollment, phase progression, etc.)

#### Rejected payments tab

Finance/Superfinance can permanently **reject** a payment (different from "return for correction"). Rejected payments appear in a dedicated **Rejected** tab on the Payment Logs page.

- **What you see**: branch, student, original amount, payment method, who rejected it, rejection date and the **reject reason**.
- **Click View details** for the full record. The modal includes a **Go to invoice** button that jumps to the invoice page so you can record a new payment.
- **De-duplicated by invoice**: only the most recent rejection is shown. If you record a new payment and the invoice leaves "Rejected" status, the entry disappears from the tab.
- **Counts and money**: rejected payments are excluded from Total Amount, the Financial Dashboard, and the Daily Summary. Student enrollment is **unchanged** — only the money is reversed.

#### Cash Deposit Summary (Branch Admin)

In Payment Logs, the **Deposit Cash** quick action opens a modal that prepares a cash deposit submission:

- **From (payment date)** — locked to the day after your previous deposit's end date (or earliest cash payment if there's no prior deposit). Prevents overlap and double-counting.
- **To (payment date)** — editable; defaults to today, capped at today, and cannot be earlier than From.
- **Cash payment table** — lists every cash payment in the chosen window that hasn't already been deposited. The summary recomputes automatically when you change To.
- **Reference Number** + **Deposit Proof Image** — required before submission.
- If your branch is currently holding ≥ the configured Cash Holding Alert Threshold, the modal shows a prominent notice. Submit the deposit to clear it.

After submission, Finance/Superfinance verifies it on the Daily Summary Sales page; if returned, the row appears in your Daily Summary Sales **"Returned"** tab to resubmit.

---

### Acknowledgement Receipts

**Path**: Manage Invoice → Acknowledgement Receipts

#### Purpose

Track every up-front payment for your branch — typically reservation fees and downpayments captured before an invoice is fully linked to enrollment.

#### Key features

- Filter by **Status** (Submitted / Pending / Verified / Applied / Rejected / Cancelled), **From / To** date range or the **Month picker** (defaults to the current Manila month).
- Search by AR number, student name, prospect name, or reference number.
- Sortable headers on Issue Date, Status, Branch, Issued By.
- **AR number** column displays the new format **"Acknowledgement Receipt# AR-XXXX"**.
- Click an AR row to view full details, the linked invoice (if any), proof attachment and reject reason (if any).

#### Common actions

- **View details** — opens the AR modal with all fields and the attachment viewer.
- **Download PDF** — generates a printable receipt.
- **Track verification** — Verified/Applied means Finance has accepted it; Rejected/Cancelled means it was reversed and not counted.

---

### Daily Summary Sales

**Path**: Daily Summary Sales

#### Purpose

See your branch's **End of Shift (EOD)** and **Cash Deposit Summary** submissions in one place, including ones Finance returned for correction.

#### Tabs

- **End of Shift** — daily summary submissions (one row per business date).
- **Cash Deposit Summary** — periodic cash deposit submissions (one row per deposit window).

Each tab also offers a **Returned** sub-view for items Finance/Superfinance sent back to you for correction.

#### Filters

- **Status** (Submitted / Verified / Returned)
- **From / To** date range (single calendar day for EOD; period overlap for Cash Deposit)
- **Month picker** — defaults to the current Manila month so the page opens on "This Month"

Selecting a Month clears From/To, and vice versa. **Clear filters** removes all of them.

#### Working with Returned items

1. Open the **Returned** view inside the relevant tab.
2. Click **Resubmit** on the row.
3. For **EOD** — review the recalculated payment list, optionally click **Recalculate** if newer payments were added, then submit.
4. For **Cash Deposit** — update the reference number / proof attachment if Finance flagged them, then submit.

The "Cash Payment Records" table on the Cash Deposit Summary Details modal will always show the original audit snapshot if the live recalc returns no rows (e.g. if a payment was deleted after submission).

---

### Settings

**Path**: Settings

#### Purpose

Configure system-wide settings for your branch, including installment delinquency management. These settings control how the system handles overdue installment payments.

#### Features

**Viewing Settings**

- See current effective settings for your branch
- Settings may inherit from global defaults or be branch-specific
- View which settings are branch-specific vs global

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
2. Review current effective settings
3. Modify values as needed:
   - Enter penalty rate as percentage (e.g., "10" for 10%)
   - Enter grace period in days (e.g., "7" for 7 days)
   - Enter final drop-off days (e.g., "30" for 30 days)
4. Click "Save Settings"
5. Settings are applied immediately to your branch

#### Other settings you may see

- **Cash Holding Alert Threshold (₱)** — controls when the login-time alert fires for branch admins holding too much undeposited cash. Default ₱100,000. Set to 0 to disable.
- **Template Settings tab** — Superadmin-managed templates for system notifications, EOD digest, cash deposit alerts, payment confirmations and reminders. Branch admins typically only view these.

**How Settings Work**

- Settings are branch-specific (apply only to your branch)
- System automatically applies penalties based on these settings
- Penalties are added to overdue invoices automatically
- Students are automatically removed after final drop-off period expires
- Settings affect all installment invoices in your branch

**Understanding Effective Settings**

- Settings may show "Global" or "Branch" scope
- "Global" means using system-wide default
- "Branch" means using your branch-specific setting
- Branch settings override global defaults

#### Important Notes

- Settings apply to all installment invoices in your branch
- Changes take effect immediately for new overdue invoices
- Existing overdue invoices may need manual processing
- Penalty rate is applied as percentage of overdue amount
- Grace period gives students time before penalty applies
- Final drop-off automatically removes students after specified days

---

## Common Workflows

### Workflow 1: Enrolling a New Student (Full Payment)

**Steps:**

1. **Create Student Account** (if not exists)
   - Go to Manage Users → Student
   - Click "Add Student"
   - Fill student + guardian information (required)
   - Set Level Tag

2. **Create Class** (if not exists)
   - Go to Classes → Create Class
   - Set up class details and schedule

3. **Enroll Student**
   - Go to Classes
   - Click "Enroll Student" on desired class
   - Select "Package" enrollment
   - Choose package
   - Select student
   - Review and confirm
   - System creates invoice

4. **Record Payment**
   - Student/parent pays at office
   - Go to Payment Logs
   - Record payment
   - System enrolls student automatically

5. **Verify Enrollment**
   - Go to Classes → View Students
   - Confirm student appears in enrolled list
   - Student can now access class

---

### Workflow 2: Enrolling a Student with Installment Plan

**Steps:**

1. **Create Student and Class** (if needed)
   - Same as Workflow 1, steps 1-2

2. **Enroll Student with Installment Package**
   - Go to Classes
   - Click "Enroll Student"
   - Select "Package" enrollment
   - Choose Installment package
   - Select student
   - Review (note downpayment amount)
   - Confirm enrollment
   - System creates downpayment invoice

3. **Record Downpayment Payment**
   - Student pays downpayment
   - Record payment in Payment Logs
   - System creates first installment invoice
   - Student appears as "Pending (Downpayment Paid)" in class modal

4. **Record First Installment Payment**
   - Student pays first monthly invoice
   - Record payment in Payment Logs
   - System enrolls student in Phase 1
   - Student now fully enrolled

5. **Monthly Payments**
   - System auto-generates monthly invoices
   - Record each payment as received
   - System progresses student through phases
   - Continue until all phases paid

---

### Workflow 3: Student Reservation and Upgrade

**Steps:**

1. **Reserve Student Spot**
   - Go to Classes
   - Click "Reserve Student"
   - Select student
   - Set reservation fee due date
   - Confirm reservation
   - System creates reservation invoice

2. **Record Reservation Payment**
   - Student pays reservation fee
   - Record payment in Payment Logs
   - Reservation status changes to "Fee Paid"

3. **Upgrade to Enrollment**
   - Go to Classes
   - Click "View Reserved" on class
   - Find student
   - Click "Upgrade to Enrollment"
   - Select package or per-phase
   - Complete enrollment process
   - Reservation fee paid is considered

4. **Record Enrollment Payment**
   - Student pays enrollment fee
   - Record payment
   - Student is fully enrolled

---

### Workflow 4: Creating and Managing a Class

**Steps:**

1. **Prerequisites**
   - Ensure Program exists (Program page)
   - Ensure Room exists (Room page)
   - Ensure Teacher exists (Personnel page)

2. **Create Class**
   - Go to Classes → Create Class
   - Select your branch (pre-selected)
   - Fill class details (name, program, room, teacher, capacity, dates)
   - Configure schedule (days and times)
   - Click "Create"
   - System generates all sessions

3. **Enroll Students**
   - Use "Enroll Student" button
   - Follow enrollment workflow

4. **Manage Class**
   - View class details
   - Monitor student enrollment
   - Track attendance (teachers mark attendance)
   - Manage sessions as needed

---

### Workflow 5: Daily Operations Checklist

**Morning Tasks:**
1. Check Dashboard for today's activities
2. Review Calendar for today's classes
3. Check Announcements for new messages
4. Review pending invoices

**During Day:**
1. Record payments as received
2. Process new enrollments
3. Answer student/parent inquiries
4. Update class information as needed

**End of Day:**
1. Review all payments recorded
2. Verify invoice statuses
3. Check for any issues
4. Prepare for next day

---

## Troubleshooting

### Common Issues

**Problem**: Cannot see certain features
- **Solution**: Verify you're logged in as Admin (not Student or Teacher)
- Check that you're assigned to a branch
- Some features may require Superadmin access

**Problem**: Cannot create Admin users
- **Solution**: This is expected - only Superadmin can create Admin users
- Contact Superadmin if you need additional Admin users

**Problem**: Cannot see other branches' data
- **Solution**: This is expected - Admin can only see their own branch
- This is a security feature, not a bug

**Problem**: Student not appearing after enrollment
- **Solution**: 
  - Check if invoice is paid (students enroll after payment)
  - For Installment packages: Check if downpayment is paid
  - Refresh the page
  - Check enrollment status in class details

**Problem**: Cannot edit paid invoice
- **Solution**: This is expected - paid invoices cannot be edited
- Create a new invoice or credit note if adjustment is needed

**Problem**: Payment not updating invoice status
- **Solution**:
  - Verify payment amount matches invoice
  - Check if payment was recorded correctly
  - Refresh the page
  - Check payment logs for errors

**Problem**: Class sessions not generating
- **Solution**:
  - Verify program has curriculum defined
  - Check that program has phases and sessions configured
  - Ensure class dates are valid
  - Contact Superadmin if issue persists

### Getting Help

- Contact your Superadmin for system-level issues
- Check system announcements for updates
- Review this manual for feature explanations
- Contact IT support for technical issues

---

## Document Information

**Version**: 1.3
**Last Updated**: May 11, 2026
**Role**: Admin
**System**: Physical School Management System
**Organization**: Little Champions Academy Inc.

### Change log

- **v1.3 (May 11, 2026)** — Added Acknowledgement Receipts and Daily Summary Sales pages. Documented the payment Rejected tab, discount field on Record Payment, three date-filter modes, debounced server-side search, sortable columns, "Total Invoice:" labelling, branch Cash Holding alert, editable "To" date on the Cash Deposit modal, default "This Month" on dashboards, Template Settings tab and Uniform 2XL size.
- **v1.2 (January 29, 2026)** — Earlier baseline.

---

*This manual covers all features available to Admin users. For role-specific questions, contact your Superadmin.*
