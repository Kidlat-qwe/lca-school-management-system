# Physical School Management System - User Manual

## Table of Contents

1. [Introduction](#introduction)
2. [Getting Started](#getting-started)
3. [User Roles Overview](#user-roles-overview)
4. [Superadmin Guide](#superadmin-guide)
5. [Admin Guide](#admin-guide)
6. [Finance Guide](#finance-guide)
7. [Teacher Guide](#teacher-guide)
8. [Student Guide](#student-guide)
9. [Common Features](#common-features)
10. [Workflows](#workflows)
11. [Troubleshooting](#troubleshooting)

---

## Introduction

The Physical School Management System is a comprehensive platform designed to manage all aspects of school operations across multiple branches. The system supports different user roles with specific permissions and features tailored to their responsibilities.

### Key Features

- **Multi-branch Management**: Manage multiple school branches from a single system
- **Role-based Access Control**: Different interfaces for different user types
- **Real-time Updates**: Instant notifications and updates
- **Financial Management**: Invoice generation, payment tracking, and installment plans
- **Class Management**: Schedule classes, track attendance, and manage curriculum
- **Student Progress Tracking**: Monitor student enrollment and academic progress

---

## Getting Started

### Accessing the System

1. **URL**: Navigate to your school's system URL (e.g., `https://lca-management-system.replit.app`)
2. **Login Page**: You'll see the login screen with the Little Champions Academy logo
3. **Credentials**: Use your email and password provided by your administrator

### First Time Login

1. Enter your email address
2. Enter your password
3. Click "Login"
4. You'll be redirected to your role-specific dashboard

### Password Requirements

- Minimum 6 characters
- Must be provided by system administrator
- Contact IT support if you've forgotten your password

---

## User Roles Overview

The system has six distinct user roles:

| Role | Access Level | Primary Functions |
|------|--------------|-------------------|
| **Superadmin** | All branches | Full system control, branch management, system-wide configurations |
| **Admin** | Single branch | Branch operations, personnel management, class management |
| **Superfinance** | All branches | Financial oversight across all branches |
| **Finance** | Single branch | Financial operations for their assigned branch |
| **Teacher** | Assigned classes | Class management, attendance, student grading |
| **Student** | Personal data | View classes, invoices, payments, announcements |

---

## Superadmin Guide

**Access Level**: Full system access across all branches

### Dashboard

The Superadmin dashboard displays:
- **Total Statistics**: Students, teachers, classes across all branches
- **Revenue Overview**: Financial metrics from all branches
- **Branch Performance**: Individual branch statistics
- **Recent Activities**: Latest system activities

### Navigation Menu

#### Branch Management
**Path**: Branch → Branch List

**Functions**:
- **View All Branches**: See list of all school branches
- **Add New Branch**: 
  - Click "Add Branch"
  - Fill in:
    - Branch Name
    - Branch Address
    - Branch Email
    - Phone Number
    - City, Postal Code
    - Country, State/Province
    - Business Registration Number
    - Tax ID
    - Establishment Date
    - Currency and Locale
  - Click "Save"
- **Edit Branch**: 
  - Click "Edit" on any branch
  - Modify details
  - Click "Update"
- **Manage Branch Status**: 
  - Set branch as Active/Inactive
  - View branch details

#### Personnel Management
**Path**: Personnel Management → Personnel

**Functions**:
- **View All Personnel**: All users across all branches
- **Add New User**:
  - Click "Add Personnel"
  - Select User Type: Superadmin, Admin, Finance, Teacher, Student
  - Fill in:
    - Full Name
    - Email
    - Password
    - Gender
    - Date of Birth
    - Phone Number
    - Branch Assignment (for non-Superadmin users)
    - Level Tag (for Students)
  - Click "Create User"
- **Edit User**: Modify user details
- **Delete User**: Remove user from system
- **Filter Users**: By branch, user type, or search

**User Types You Can Create**:
- **Superadmin**: Full system access
- **Admin**: Branch administrators
- **Finance**: Branch-level or system-wide financial staff
- **Teacher**: Teaching staff
- **Student**: Students

#### Curriculum Management
**Path**: Curriculum Management → Curriculum

**Functions**:
- **View Curricula**: All curriculum definitions
- **Add Curriculum**:
  - Curriculum Name
  - Description
  - Program Assignment
  - Phase and Session Details:
    - Phase Number
    - Session Number
    - Topic
    - Learning Goals
    - Agenda
  - Click "Save"
- **Edit Curriculum**: Modify curriculum details
- **Delete Curriculum**: Remove curriculum

#### Program Management
**Path**: Curriculum Management → Program

**Functions**:
- **View Programs**: All educational programs
- **Add Program**:
  - Program Name
  - Program Description
  - Level Tag (Nursery, Pre-Kindergarten, etc.)
  - Branch Assignment
  - Total Phases
  - Sessions per Phase
  - Session Duration (in minutes)
  - Promo eligibility
  - Click "Save"
- **Edit Program**: Modify program details
- **Delete Program**: Remove program
- **View Program Statistics**: Enrolled students, active classes

#### Class Management
**Path**: Class Management → Classes

**Functions**:
- **View All Classes**: Across all branches
- **Create Class**:
  - Class Name/Section Name
  - Select Program
  - Select Branch
  - Select Room
  - Class Code (auto-generated)
  - Capacity
  - Start Date and End Date
  - Teacher Assignment
  - Schedule:
    - Day of Week
    - Start Time
    - End Time
  - Click "Create"
- **Reserve Student Spots**:
  - Select student
  - Pay reservation fee
  - Set due date
  - Option to upgrade to full enrollment
- **Enroll Students**:
  - Full payment enrollment
  - Installment enrollment
  - Phase-based enrollment
- **Manage Class Sessions**:
  - View all sessions
  - Mark attendance
  - Track session completion
- **Merge Classes**: Combine classes when needed
- **View Class Details**:
  - Student list
  - Attendance records
  - Schedule
  - Phase progress

#### Room Management
**Path**: Class Management → Room

**Functions**:
- **View Rooms**: All rooms across branches
- **Add Room**:
  - Room Name
  - Branch Assignment
  - Capacity
  - Status (Active/Inactive)
  - Click "Save"
- **Schedule Room**: Assign classes to rooms with day/time
- **Edit Room**: Modify room details
- **View Room Schedule**: See room availability

#### Package Management
**Path**: Financial Management → Package

**Functions**:
- **View Packages**: All enrollment packages
- **Create Package**:
  - Package Name
  - Level Tag
  - Branch Assignment
  - Package Type:
    - **Full Payment**: One-time payment
    - **Installment**: Monthly payments
  - Package Price
  - Phase Range (for phase-based packages):
    - Phase Start
    - Phase End
  - Status
  - Click "Save"
- **Edit Package**: Modify package details
- **Delete Package**: Remove package
- **Link Promos**: Assign promotional offers to packages

#### Pricing List Management
**Path**: Financial Management → Pricing List

**Functions**:
- **View Pricing Lists**: All pricing configurations
- **Create Pricing List**:
  - Name
  - Level Tag
  - Branch Assignment
  - Reservation Fee
  - Additional Fees
  - Click "Save"
- **Edit Pricing List**: Modify pricing
- **Delete Pricing List**: Remove pricing configuration

#### Promo Management
**Path**: Financial Management → Promo

**Functions**:
- **View Promos**: All promotional offers
- **Create Promo**:
  - Promo Name
  - Promo Code (unique identifier)
  - Promo Type:
    - Percentage Discount
    - Fixed Amount Discount
    - Referral Bonus
  - Discount Value
  - Start Date and End Date
  - Status (Active/Inactive)
  - Applicable Branches
  - Applicable Packages
  - Usage Limits
  - Click "Save"
- **Edit Promo**: Modify promo details
- **Deactivate Promo**: Turn off promo
- **Track Promo Usage**: See how many times promo was used

#### Merchandise Management
**Path**: Merchandise → Merchandise

**Functions**:
- **View Merchandise**: All items for sale
- **Add Merchandise**:
  - Item Name
  - Description
  - Price
  - Stock Quantity
  - Branch Assignment
  - Category
  - Image Upload (merchandise image)
  - Status (Available/Out of Stock)
  - Click "Save"
- **Edit Merchandise**: Modify item details
- **Update Stock**: Adjust inventory levels
- **Delete Merchandise**: Remove item

#### Invoice Management
**Path**: Financial Management → Invoice

**Functions**:
- **View All Invoices**: System-wide invoice list
- **Filter Invoices**:
  - By Branch
  - By Status (Pending, Paid, Partially Paid, Cancelled)
  - By Date Range
  - By Student
- **Create Invoice**:
  - Select Student(s)
  - Invoice Description
  - Branch Assignment
  - Issue Date
  - Due Date
  - Add Invoice Items:
    - Description
    - Amount
    - Tax (if applicable)
    - Discount
    - Penalty
  - Status
  - Remarks
  - Click "Create"
- **View Invoice Details**:
  - Invoice number (INV-XXXX)
  - Student information
  - Items breakdown
  - Total amount
  - Payment history
  - Linked reservations
- **Download Invoice PDF**: Print or email invoice
- **Edit Invoice**: Modify pending invoices
- **Cancel Invoice**: Cancel unpaid invoices
- **Track Payments**: See payment status and history

#### Installment Invoice Management
**Path**: Financial Management → Installment Invoice

**Functions**:
- **View Installment Profiles**: All installment plans
- **Create Installment Profile**:
  - Select Student
  - Select Package
  - Start Date
  - Contract Length (in months)
  - Monthly Amount
  - Due Day (day of month)
  - Phase-based tracking (optional):
    - Start Phase
    - End Phase
  - Auto-generate monthly invoices
  - Click "Create"
- **View Profile Details**:
  - Contract information
  - Generated invoices
  - Payment schedule
  - Phase progress
- **Edit Profile**: Modify installment terms
- **Pause/Resume Profile**: Control invoice generation
- **Cancel Profile**: Stop installment plan

**Automated Features**:
- System automatically generates invoices on due date
- Tracks payment completion
- Updates enrollment phases based on payments
- Sends email notifications

#### Payment Logs
**Path**: Financial Management → Payment Logs

**Functions**:
- **View All Payments**: Complete payment history
- **Record Payment**:
  - Select Invoice
  - Select Student
  - Payment Method (Cash, Bank Transfer, GCash, etc.)
  - Payment Type (Full, Partial, Deposit)
  - Amount
  - Reference Number
  - Payment Date
  - Remarks
  - Click "Record"
- **Upload Invoice PDF**: Attach payment receipt
- **Send Email**: Email invoice to parent/guardian
- **Filter Payments**:
  - By Branch
  - By Date Range
  - By Payment Method
  - By Student
- **View Payment Details**:
  - Payment information
  - Linked invoice
  - Student details
  - Payment status
- **Generate Reports**: Export payment data
- **Delete Payment**: Remove payment record (requires confirmation)

**Automated Actions on Payment**:
- Auto-updates invoice status
- Enrolls student when fully paid
- Progresses installment phases
- Upgrades reservations to enrollments
- Sends email notification (if configured)

#### Guardian Management
**Path**: Student Management → Guardians

**Functions**:
- **View Guardians**: All parent/guardian records
- **Add Guardian**:
  - Guardian Name
  - Relationship (Parent, Grandparent, etc.)
  - Phone Number
  - Email
  - Address
  - Emergency Contact
  - Link to Students
  - Click "Save"
- **Edit Guardian**: Modify guardian details
- **Delete Guardian**: Remove guardian record
- **View Linked Students**: See which students are linked to guardian

#### Calendar & Schedule
**Path**: Calendar → Calendar Schedule

**Functions**:
- **Monthly View**: See all class schedules
- **Filter by**:
  - Branch
  - Class
  - Teacher
  - Room
- **View Class Sessions**:
  - Class name
  - Time and date
  - Room location
  - Teacher assigned
  - Student count
- **Session Details**: Click any session to see:
  - Student list
  - Attendance status
  - Phase/session number
  - Curriculum content
- **Suspension Periods**: Manage class suspensions
  - Add suspension (typhoon, holiday, etc.)
  - Auto-reschedule affected sessions
  - View affected classes

#### Announcements
**Path**: Communication → Announcements

**Functions**:
- **View Announcements**: All system announcements
- **Create Announcement**:
  - Title
  - Message Body
  - Priority (High, Medium, Low)
  - Recipient Groups:
    - All
    - Students
    - Teachers
    - Parents
    - Admin
    - Finance
  - Branch Selection (specific or all)
  - Start Date and End Date
  - Status (Active, Inactive, Draft)
  - Click "Publish"
- **Edit Announcement**: Modify announcement
- **Delete Announcement**: Remove announcement
- **Track Reads**: See who has read the announcement
- **Filter**: By status, priority, recipient group

#### Key Workflows

**Workflow 1: Setting Up a New Branch**
1. Navigate to Branch → Add Branch
2. Fill in all branch details
3. Create branch admin user (Personnel → Add Personnel)
4. Assign rooms to the branch (Room → Add Room)
5. Create programs for the branch (Program → Add Program)
6. Set up pricing lists (Pricing List → Add)

**Workflow 2: Creating a New Class**
1. Ensure program exists (Program Management)
2. Ensure room exists (Room Management)
3. Navigate to Classes → Create Class
4. Fill class details and schedule
5. Assign teacher
6. Add students (reserve or enroll)

**Workflow 3: Student Enrollment (Full Payment)**
1. Student reserves spot (Classes → Reserve Student)
2. Create reservation fee invoice (Invoice → Create)
3. Student pays reservation fee (Payment Logs → Record Payment)
4. Upgrade reservation to enrollment (Classes → View Reserved Students)
5. Create enrollment invoice with package price
6. Student pays enrollment fee
7. System auto-enrolls student in class

**Workflow 4: Student Enrollment (Installment)**
1. Follow steps 1-4 from Workflow 3
2. Create installment profile (Installment Invoice → Create)
3. System auto-generates monthly invoices
4. Student pays monthly
5. System auto-progresses through phases

---

## Admin Guide

**Access Level**: Single branch management

### Dashboard

The Admin dashboard shows:
- **Branch Statistics**: Students, teachers, classes in your branch
- **Revenue**: Financial metrics for your branch
- **Recent Activities**: Latest actions in your branch
- **Upcoming Classes**: Today's and upcoming schedules

### Navigation Menu

Admin has access to the same features as Superadmin, but limited to their assigned branch only:

- **Dashboard**: Branch overview
- **Calendar**: Branch class schedules
- **Personnel**: Branch staff management (can create Teachers, Students, Finance for their branch)
- **Guardians**: Branch guardian records
- **Curriculum**: View and manage curriculum for branch programs
- **Program**: Branch programs
- **Classes**: Branch classes
- **Announcements**: Branch announcements
- **Package**: Branch packages
- **Pricing List**: Branch pricing
- **Merchandise**: Branch merchandise
- **Promo**: View and manage promos
- **Room**: Branch rooms
- **Invoice**: Branch invoices
- **Installment Invoice**: Branch installment plans
- **Payment Logs**: Branch payment records

### Key Differences from Superadmin

- Cannot create new branches
- Cannot create Superadmin or Admin users
- Cannot see other branches' data
- All actions limited to assigned branch
- Cannot create system-wide promos (only branch-specific)

### Daily Operations

**Morning Tasks**:
1. Check Dashboard for today's classes
2. Review Calendar for any schedule changes
3. Check Announcements for new messages
4. Review pending invoices

**Weekly Tasks**:
1. Review payment logs
2. Check enrollment numbers
3. Update class attendance
4. Review teacher performance

**Monthly Tasks**:
1. Generate financial reports
2. Review student progress
3. Plan next month's classes
4. Update pricing if needed

---

## Finance Guide

**Access Level**: Financial operations

There are two types of Finance users:

### Finance (Branch-Level)
- Assigned to a specific branch
- Manages finances for that branch only

### Superfinance (System-Level)
- Not assigned to any branch
- Manages finances across all branches

### Dashboard

Finance dashboard displays:
- **Revenue Overview**: Income statistics
- **Pending Invoices**: Unpaid invoices
- **Recent Payments**: Latest payment transactions
- **Payment Trends**: Monthly payment charts

### Navigation Menu

#### Invoice Management
**Path**: Invoice

**Functions**:
- View all invoices (branch or system-wide)
- Filter invoices by status, date, student
- View invoice details
- Download invoice PDFs
- Track payment status

**Note**: Finance users can view but typically cannot create invoices (created by Admin/Superadmin)

#### Installment Invoice
**Path**: Installment Invoice

**Functions**:
- View installment profiles
- Monitor payment schedules
- Track contract progress
- View overdue payments

#### Payment Logs
**Path**: Payment Logs

**Primary Functions**:
- **Record Payments**:
  - Select invoice
  - Enter payment details
  - Choose payment method
  - Add reference number
  - Record amount
  - Upload receipt (optional)
  - Send email notification
- **View Payment History**:
  - Filter by date
  - Filter by payment method
  - Search by student name
  - Export to Excel
- **Track Outstanding Payments**:
  - View unpaid invoices
  - See overdue payments
  - Calculate total receivables
- **Generate Financial Reports**:
  - Daily revenue
  - Monthly revenue
  - Payment method breakdown
  - Branch comparison (Superfinance only)

### Payment Recording Workflow

**Step 1: Locate Invoice**
1. Navigate to Invoice
2. Find unpaid invoice
3. Note invoice number and amount

**Step 2: Record Payment**
1. Go to Payment Logs
2. Click "Record Payment"
3. Select the invoice
4. Enter payment details:
   - Payment Method
   - Payment Type (Full/Partial)
   - Amount
   - Reference Number
   - Date
   - Remarks
5. Click "Record Payment"

**Step 3: Verify**
1. System updates invoice status
2. If full payment: Status changes to "Paid"
3. If partial payment: Status changes to "Partially Paid"
4. Student enrollment updated (if applicable)

**Step 4: Email Notification**
1. Option to send invoice PDF via email
2. Invoice includes:
   - Invoice number
   - Payment details
   - School branding
   - Parent/guardian information

### Financial Reports

**Daily Reports**:
- Total revenue
- Number of payments
- Payment methods used
- Outstanding amounts

**Monthly Reports**:
- Monthly revenue
- New enrollments
- Installment collections
- Overdue accounts

**Annual Reports**:
- Yearly revenue
- Growth trends
- Branch performance (Superfinance)

### Best Practices

1. **Record Payments Immediately**: Enter payments as soon as received
2. **Include Reference Numbers**: Always include receipt/transaction numbers
3. **Verify Amounts**: Double-check payment amounts before recording
4. **Send Receipts**: Email invoices to parents promptly
5. **Daily Reconciliation**: Match payments with bank deposits
6. **Weekly Reports**: Review payment logs weekly
7. **Follow Up**: Contact parents with overdue payments

---

## Teacher Guide

**Access Level**: Assigned classes only

### Dashboard

Teacher dashboard shows:
- **My Classes**: List of assigned classes
- **Today's Schedule**: Classes for today
- **Student Count**: Total students across all classes
- **Attendance Summary**: Recent attendance stats
- **Upcoming Sessions**: Next week's schedule

### Navigation Menu

#### Dashboard
Overview of teaching responsibilities and schedule

#### Calendar
**Path**: Calendar

**Functions**:
- View your class schedules
- See daily, weekly, monthly views
- Check room assignments
- View session details
- Check student attendance

#### Announcements
**Path**: Announcements

**Functions**:
- View school announcements
- Read priority messages
- View expiration dates
- Mark announcements as read

#### Classes
**Path**: Classes

**Primary Teaching Functions**:
- **View My Classes**: All assigned classes
- **View Class Details**:
  - Class name and code
  - Schedule
  - Room location
  - Student list
  - Curriculum
  - Attendance records
- **Manage Attendance**:
  - Mark students present/absent
  - Add attendance notes
  - View attendance history
  - Track absence patterns
- **View Student List**:
  - Student names
  - Contact information
  - Enrollment status
  - Phase progress
- **Session Management**:
  - View session topics
  - Check curriculum goals
  - Mark sessions as completed
  - Add session notes

#### Student List
**Path**: Student List

**Functions**:
- View all students in your classes
- Search for specific students
- Filter by class
- View student details:
  - Full name
  - Email
  - Phone number
  - Guardian information
  - Classes enrolled
  - Attendance rate
  - Phase progress

#### Program
**Path**: Program

**Functions**:
- View program details
- Check program curriculum
- See learning objectives
- View phase structure
- Review session content

#### Curriculum
**Path**: Curriculum

**Functions**:
- View curriculum for your classes
- Check phase details:
  - Phase number
  - Session count
  - Topics
  - Learning goals
  - Agenda
- Review session content
- Plan lessons based on curriculum

### Daily Teaching Workflow

**Before Class**:
1. Check Dashboard for today's classes
2. Review Calendar for schedule
3. Check room assignment
4. Review curriculum for today's session
5. Prepare materials

**During Class**:
1. Take attendance (mark present/absent)
2. Follow curriculum agenda
3. Note any student issues or achievements

**After Class**:
1. Mark session as completed
2. Add any notes about session
3. Update student attendance if needed
4. Prepare for next class

### Attendance Management

**How to Mark Attendance**:
1. Navigate to Classes
2. Click on your class
3. Find today's session
4. Click "Mark Attendance"
5. Mark each student:
   - Present
   - Absent
   - Late
   - Excused
6. Add notes if needed
7. Click "Save Attendance"

**Attendance Reports**:
- View attendance history
- See patterns (frequent absences)
- Generate attendance reports
- Export to Excel

### Communication

**With Administrators**:
- Check Announcements daily
- Report issues through announcements
- Request support when needed

**With Students/Parents**:
- Through school announcements
- Via contact information in Student List
- Through school email system

### Best Practices

1. **Take Attendance Promptly**: Mark attendance at start of class
2. **Follow Curriculum**: Stick to planned curriculum topics
3. **Document Issues**: Note any student behavioral or learning issues
4. **Review Schedule**: Check schedule changes daily
5. **Prepare Ahead**: Review next session's curriculum in advance
6. **Keep Records**: Maintain accurate attendance and session records

---

## Student Guide

**Access Level**: Personal information only

### Dashboard

Student dashboard displays:
- **My Classes**: Enrolled classes with schedules
- **Upcoming Sessions**: Next classes
- **Announcements**: School messages
- **Pending Payments**: Outstanding invoices
- **Attendance**: Your attendance rate

### Navigation Menu

#### Dashboard
Personal overview and quick access to key information

#### Calendar
**Path**: Calendar

**Functions**:
- View your class schedule
- See all enrolled classes
- Check class times and rooms
- View upcoming sessions
- See teacher assignments

#### Announcements
**Path**: Announcements

**Functions**:
- Read school announcements
- View priority messages
- Check announcement details
- Mark as read
- Filter by priority or date

#### Classes
**Path**: Classes

**Functions**:
- **View My Classes**: All enrolled classes
- **Class Details**:
  - Class name and code
  - Teacher name
  - Schedule (days and times)
  - Room location
  - Session count
  - Current phase
  - Program details
- **Session Progress**:
  - Completed sessions
  - Remaining sessions
  - Current phase
  - Phase progress percentage
- **Attendance Record**:
  - Your attendance rate
  - Present/absent history
  - Dates attended

#### Packages
**Path**: Packages

**Functions**:
- **View Available Packages**:
  - Package name
  - Level tag
  - Package price
  - Description
  - Payment type (Full/Installment)
  - Phase coverage
- **Package Details**:
  - What's included
  - Duration
  - Payment terms
  - Available promos
- **Check Eligibility**: See which packages you can enroll in

#### Invoice
**Path**: Invoice

**Functions**:
- **View My Invoices**: All invoices assigned to you
- **Invoice Details**:
  - Invoice number (INV-XXXX)
  - Description
  - Issue date
  - Due date
  - Amount
  - Status (Pending, Paid, Partially Paid)
  - Items breakdown
  - Payment history
- **Download Invoice**: Get PDF copy
- **Payment Information**: See how much is due
- **Payment History**: View previous payments
- **Overdue Notice**: See if payment is late

#### Payment Logs
**Path**: Payment Logs

**Functions**:
- View all your payments
- See payment history:
  - Payment date
  - Amount paid
  - Payment method
  - Reference number
  - Invoice paid
- Filter by date
- View payment receipts
- Download payment history

### Understanding Your Invoice

**Invoice Information**:
- **Invoice Number**: Unique identifier (INV-XXXX)
- **Issue Date**: When invoice was created
- **Due Date**: When payment is due
- **Amount**: Total to pay
- **Status**:
  - **Pending**: Not paid yet
  - **Paid**: Fully paid
  - **Partially Paid**: Some payment made
  - **Overdue**: Past due date
  - **Cancelled**: Invoice cancelled

**Invoice Items**:
- Description of what you're paying for
- Amount for each item
- Any discounts applied
- Any penalties (if late)
- Tax (if applicable)
- **Total**: Final amount to pay

**Payment Information**:
- Shows payments already made
- Shows remaining balance
- Shows amount due

### Payment Process

**If You Received an Invoice**:
1. Check your email or Dashboard
2. View invoice details
3. Note the due date
4. Note the amount
5. Contact finance office to make payment
6. Provide invoice number when paying
7. Keep payment receipt

**Payment Methods** (check with your school):
- Cash (pay at school office)
- Bank Transfer
- Online Payment (GCash, PayMaya, etc.)
- Check

**After Payment**:
1. School finance will record your payment
2. Invoice status will update to "Paid"
3. You'll receive payment receipt via email
4. Check Payment Logs to verify

### Enrollment Process

**Reservation**:
1. Admin reserves your spot in class
2. You receive reservation fee invoice
3. Pay reservation fee before due date
4. Reservation confirmed

**Full Enrollment**:
1. After reservation, enrollment invoice created
2. Review invoice details
3. Pay full amount or first installment
4. Upon payment, you're fully enrolled in class
5. You can access class schedule and materials

**Installment Plan**:
1. Choose installment package
2. Pay initial deposit
3. Receive monthly invoices
4. Pay each month by due date
5. Progress through phases as you pay

### Checking Your Progress

**Class Progress**:
1. Go to Classes
2. Select your class
3. View:
   - Current phase
   - Sessions completed
   - Sessions remaining
   - Attendance rate

**Attendance**:
- Green checkmark: Present
- Red X: Absent
- Yellow: Late
- Blue: Excused

### Important Reminders

1. **Check Dashboard Daily**: Look for new announcements and updates
2. **Pay on Time**: Avoid penalties by paying before due date
3. **Keep Records**: Download and save all invoices and receipts
4. **Update Contact Info**: Tell admin if email or phone changes
5. **Check Calendar**: Know your schedule and don't miss classes
6. **Read Announcements**: Important information posted here

---

## Common Features

### Profile Management

**Viewing Your Profile**:
1. Click profile icon in top right corner
2. View your information:
   - Full name
   - Email
   - Phone number
   - User type
   - Branch (if applicable)

**Updating Profile Picture**:
1. Click profile icon
2. Click "Upload Picture"
3. Select image (PNG, JPG)
4. Crop as needed
5. Click "Save"

**Changing Password**:
Contact your system administrator to reset password

### Notifications

**Notification Bell**:
- Located in top right corner
- Red badge shows unread count
- Click to view notifications

**Notification Types**:
- New announcements
- Payment reminders
- Class updates
- System messages

**Managing Notifications**:
- Click notification to read
- Mark as read automatically
- Notifications auto-expire after end date

### Using the Calendar

**Calendar Views**:
- **Month View**: See entire month
- **Week View**: See weekly schedule
- **Day View**: See daily schedule

**Color Coding**:
- Classes shown in different colors
- Your classes highlighted
- Completed sessions grayed out

**Filtering**:
- By branch (Superadmin/Superfinance)
- By teacher
- By class
- By room

**Session Details**:
Click any session to see:
- Class name
- Time and location
- Teacher
- Student list
- Attendance status
- Curriculum topic

### Searching and Filtering

**Search Bar**:
- Available on most list pages
- Search by name, email, code
- Real-time search results

**Filters**:
- Branch filter (if multi-branch access)
- Status filter
- Date range filter
- Type filter
- Use "Clear Filters" to reset

**Sorting**:
- Click column headers to sort
- Ascending/descending order
- Sort by name, date, amount, etc.

### Exporting Data

**Available on**:
- Payment Logs
- Invoice lists
- Student lists
- Class lists

**How to Export**:
1. Apply desired filters
2. Click "Export" button
3. Choose format (Excel, PDF)
4. File downloads automatically

### Responsive Design

**Desktop View**:
- Full sidebar navigation
- Wide tables and forms
- Multiple columns

**Tablet View**:
- Collapsible sidebar
- Responsive tables
- Touch-friendly buttons

**Mobile View**:
- Hamburger menu
- Vertical scrolling tables
- Optimized forms
- Touch gestures enabled

**Tips for Mobile**:
- Use landscape mode for tables
- Tables scroll horizontally
- Tap once to select
- Long press for options

---

## Workflows

### Workflow 1: New Student Enrollment (Full Payment)

**Actors**: Admin/Superadmin, Finance, Student

**Steps**:

1. **Admin: Reserve Student Spot**
   - Navigate to Classes
   - Find desired class
   - Click "Reserve Student"
   - Select student
   - Set due date for reservation fee
   - Create reservation fee invoice
   - Note invoice number

2. **Finance: Record Reservation Payment**
   - Student pays at office
   - Navigate to Payment Logs
   - Click "Record Payment"
   - Select reservation invoice
   - Enter payment details
   - Click "Record"
   - Reservation status changes to "Fee Paid"

3. **Admin: Upgrade to Full Enrollment**
   - Navigate to Classes
   - View reserved students
   - Click "Upgrade to Enrollment"
   - Select package
   - Set invoice due date
   - Create enrollment invoice

4. **Finance: Record Enrollment Payment**
   - Student pays enrollment fee
   - Record payment in system
   - System automatically enrolls student
   - Student can access class

5. **Student: Verify Enrollment**
   - Check Dashboard
   - View enrolled classes
   - Check class schedule
   - Attend first session

**Timeline**: 1-7 days depending on payment speed

### Workflow 2: New Student Enrollment (Installment)

**Actors**: Admin/Superadmin, Finance, Student

**Steps**:

1. **Admin: Reserve and Upgrade (Steps 1-3 from Workflow 1)**
   - Reserve student
   - Collect reservation fee
   - Upgrade to enrollment

2. **Admin: Create Installment Profile**
   - Navigate to Installment Invoice
   - Click "Create Profile"
   - Select student
   - Select installment package
   - Set:
     - Start date
     - Contract length (months)
     - Monthly amount
     - Due day (e.g., 5th of each month)
   - Click "Create"

3. **System: Auto-Generate Monthly Invoices**
   - System creates invoice on due date each month
   - Invoice includes:
     - Month coverage
     - Amount due
     - Due date
     - Phase progress

4. **Finance: Record Monthly Payments**
   - Student pays each month
   - Record payment in Payment Logs
   - System updates:
     - Invoice status to "Paid"
     - Student's phase progress
     - Enrollment status

5. **System: Progress Through Phases**
   - As student pays, unlocks next phase
   - Student can attend classes for paid phases
   - Continues until contract complete

**Timeline**: Duration of contract (e.g., 10 months)

### Workflow 3: Creating and Managing a Class

**Actors**: Superadmin/Admin, Teacher

**Steps**:

1. **Prerequisites Check**:
   - Ensure program exists
   - Ensure room is available
   - Teacher is hired in system

2. **Create Class**:
   - Navigate to Classes
   - Click "Create Class"
   - Fill in:
     - Class name
     - Program
     - Branch
     - Room
     - Capacity
     - Start and end dates
     - Teacher
     - Schedule (days and times)
   - Click "Create"

3. **System Generates Sessions**:
   - Automatically creates all sessions
   - Based on program's phase/session structure
   - Matches class schedule
   - Assigns to room

4. **Enroll Students**:
   - Reserve students (with reservation fee)
   - Or directly enroll (with full payment)
   - Students added to class roster

5. **Teacher: Manage Class**:
   - View class in Classes menu
   - Check schedule in Calendar
   - Review student list
   - Review curriculum

6. **Daily Operations**:
   - Teacher marks attendance each session
   - System tracks session completion
   - Admin monitors class progress

7. **End of Class**:
   - All sessions completed
   - Final attendance recorded
   - Students graduate to next level

**Timeline**: Full class duration (e.g., 10 months)

### Workflow 4: Processing Monthly Payments

**Actors**: Finance, Student

**Daily Tasks**:

1. **Check Pending Invoices**:
   - Navigate to Invoice
   - Filter: Status = "Pending"
   - Sort by due date
   - Note invoices due today

2. **Process Payments**:
   - Students pay at office
   - Or submit online payment proof
   - Record each payment:
     - Navigate to Payment Logs
     - Click "Record Payment"
     - Select invoice
     - Enter details
     - Upload receipt (if any)
     - Send email confirmation

3. **Follow Up on Overdue**:
   - Filter invoices by "Overdue"
   - List overdue accounts
   - Contact parents/guardians
   - Schedule payment arrangements

4. **End of Day Reconciliation**:
   - Export payment logs for the day
   - Match with bank deposits
   - Verify all payments recorded
   - Report discrepancies

**Weekly Tasks**:

1. **Generate Reports**:
   - Weekly revenue report
   - Collection rate
   - Overdue accounts summary
   - Payment method breakdown

2. **Review Installment Profiles**:
   - Check profiles due for invoice generation
   - Verify auto-generated invoices
   - Contact students with payment issues

**Monthly Tasks**:

1. **Monthly Closing**:
   - Generate monthly revenue report
   - Review all accounts
   - Close accounting period
   - Archive records

2. **Plan Next Month**:
   - Review upcoming due dates
   - Plan collection strategies
   - Update pricing if needed

### Workflow 5: Managing Announcements

**Actors**: Superadmin/Admin

**Steps**:

1. **Create Announcement**:
   - Navigate to Announcements
   - Click "Create Announcement"
   - Fill in:
     - Title
     - Message body
     - Priority (High/Medium/Low)
     - Recipient groups (select multiple):
       - All
       - Students
       - Teachers
       - Parents
       - Admin
       - Finance
     - Branch (all or specific)
     - Start date
     - End date
     - Status (Active/Draft)
   - Click "Publish"

2. **Recipients Receive Notification**:
   - Notification bell shows badge
   - Users click to read
   - Announcement appears in their feed
   - System marks as "read" when viewed

3. **Track Engagement**:
   - View read count
   - See who has read
   - Identify who hasn't read

4. **Update if Needed**:
   - Edit announcement
   - Update content
   - Extend end date
   - Save changes

5. **Automatic Expiration**:
   - Announcement hides after end date
   - Remains in archive
   - Can be reactivated if needed

**Use Cases**:
- School closure (typhoon, holiday)
- Payment reminders
- Event announcements
- Policy changes
- Emergency notifications

### Workflow 6: Handling Class Suspensions

**Actors**: Superadmin/Admin, Teacher, Students

**Scenario**: School closes for typhoon

**Steps**:

1. **Create Suspension**:
   - Navigate to Calendar
   - Click "Add Suspension"
   - Fill in:
     - Reason (Typhoon, Earthquake, etc.)
     - Start date
     - End date
     - Affected branches
     - Affected classes (all or specific)
     - Auto-reschedule? (Yes/No)
   - Click "Save"

2. **System Actions**:
   - Marks affected sessions as "Suspended"
   - If auto-reschedule enabled:
     - Extends class end dates
     - Reschedules sessions
     - Updates calendar

3. **Notify Stakeholders**:
   - Create announcement
   - Notify students
   - Notify teachers
   - Notify parents

4. **After Suspension**:
   - Resume classes
   - Follow new schedule
   - Teacher continues curriculum

**Timeline**: Immediate effect

---

## Troubleshooting

### Login Issues

**Problem**: "Invalid email or password"
- **Solution**: 
  - Verify email is correct
  - Check password (case-sensitive)
  - Contact administrator to reset password

**Problem**: "User not found"
- **Solution**:
  - Verify you have an account
  - Check if you're using correct email
  - Contact administrator to create account

**Problem**: "Access denied"
- **Solution**:
  - Your account may be inactive
  - Contact administrator to activate account

### Permission Issues

**Problem**: "You don't have permission to access this page"
- **Solution**:
  - You're trying to access a feature not available to your role
  - Check your user type (Student, Teacher, etc.)
  - Contact administrator if you need different permissions

**Problem**: Can't see certain branches
- **Solution**:
  - You may be assigned to specific branch only
  - Only Superadmin and Superfinance see all branches
  - This is normal for branch-level users

### Payment Recording Issues

**Problem**: Can't find invoice to record payment
- **Solution**:
  - Verify invoice number
  - Check if invoice exists (ask Admin)
  - Filter by student name
  - Check invoice status (may already be paid)

**Problem**: Payment amount doesn't match invoice
- **Solution**:
  - Record as partial payment
  - Note the difference in remarks
  - Create follow-up invoice if needed

**Problem**: Payment recorded to wrong invoice
- **Solution**:
  - Delete the payment (if permissions allow)
  - Re-record to correct invoice
  - Contact Superadmin if you can't delete

### Invoice Issues

**Problem**: Invoice not generating for installment
- **Solution**:
  - Check installment profile is active
  - Verify due date settings
  - Check if previous invoice is paid
  - System may require previous payment before generating next

**Problem**: Invoice shows wrong amount
- **Solution**:
  - Contact Admin to edit invoice
  - Check package price settings
  - Verify promo codes applied correctly

**Problem**: Can't download invoice PDF
- **Solution**:
  - Check internet connection
  - Try different browser
  - Clear browser cache
  - Contact IT support

### Class and Attendance Issues

**Problem**: Can't mark attendance
- **Solution**:
  - Verify you're assigned to the class
  - Check if session is today (can only mark current/past sessions)
  - Refresh the page
  - Contact administrator

**Problem**: Student not showing in class list
- **Solution**:
  - Verify student is enrolled
  - Check if payment is complete
  - Student may be reserved but not upgraded
  - Contact Admin to check enrollment status

**Problem**: Class schedule not showing
- **Solution**:
  - Check calendar filters
  - Verify you're looking at correct date
  - Refresh the page
  - Check if class is active

### System Performance Issues

**Problem**: Page loading slowly
- **Solution**:
  - Check internet connection
  - Clear browser cache
  - Close unnecessary browser tabs
  - Try during off-peak hours
  - Contact IT support if persists

**Problem**: Changes not saving
- **Solution**:
  - Verify all required fields filled
  - Check for error messages (red text)
  - Try refreshing and re-entering
  - Check internet connection
  - Contact IT support

**Problem**: Can't upload images
- **Solution**:
  - Check file size (must be under 5MB)
  - Check file type (PNG, JPG only)
  - Try smaller file
  - Try different browser
  - Contact IT support

### Data Not Showing

**Problem**: Empty tables or no data
- **Solution**:
  - Check filter settings
  - Click "Clear Filters"
  - Verify you have correct permissions
  - Data may not exist yet
  - Try refreshing page

**Problem**: Dashboard shows zero statistics
- **Solution**:
  - May be no data for your branch
  - Check if you're assigned to branch
  - Verify data exists in system
  - Contact administrator

### Email Issues

**Problem**: Not receiving invoice emails
- **Solution**:
  - Check spam/junk folder
  - Verify email address is correct in profile
  - Ask Admin to update your email
  - Contact IT to check email service

**Problem**: Invoice PDF not attached to email
- **Solution**:
  - System may have email disabled
  - Contact administrator
  - Download PDF from system instead

### Getting Help

**Contact Your Administrator**:
- Email: [Your school's IT email]
- Phone: [Your school's IT phone]
- Office Hours: [Your school's hours]

**Before Contacting Support**:
1. Note the exact error message
2. Note what you were trying to do
3. Take screenshot if possible
4. Try refreshing the page
5. Try logging out and back in

**Emergency Contact**:
For urgent issues (system down, payment issues):
- Contact Superadmin immediately
- Email: [Superadmin email]
- Phone: [Emergency phone]

---

## Appendix

### Glossary

**Branch**: Physical school location
**Phase**: Section of curriculum (e.g., Phase 1, Phase 2)
**Session**: Individual class meeting
**Package**: Enrollment plan with set price and coverage
**Invoice**: Bill for payment
**Installment**: Payment plan spread over multiple months
**Reservation**: Hold a spot in class with deposit
**Enrollment**: Full registration in class
**Promo**: Discount or promotional offer
**Curriculum**: Structured learning plan
**Program**: Educational offering (e.g., Nursery, Kindergarten)
**Guardian**: Parent or authorized adult
**Personnel**: Staff members (Admin, Teacher, Finance)
**Merchandise**: Items for sale (uniforms, supplies)
**Pricing List**: Standard fees and charges
**Calendar**: Schedule of classes and events
**Attendance**: Record of student presence
**Dashboard**: Overview page showing key information
**Status**: Current state (Active, Inactive, Pending, Paid, etc.)

### Payment Terms

**Full Payment**: Pay entire amount at once
**Installment**: Pay monthly over time
**Reservation Fee**: Deposit to hold spot
**Enrollment Fee**: Payment to fully enroll
**Partial Payment**: Pay some of amount due
**Overdue**: Payment past due date
**Penalty**: Additional charge for late payment
**Discount**: Reduction in price
**Promo**: Special pricing offer
**Refund**: Money returned to customer

### Status Definitions

**Invoice Status**:
- **Draft**: Not finalized
- **Pending**: Awaiting payment
- **Paid**: Fully paid
- **Partially Paid**: Some payment made
- **Overdue**: Past due date
- **Cancelled**: Voided

**Class Status**:
- **Active**: Currently running
- **Inactive**: Not active
- **Completed**: Finished
- **Upcoming**: Not started yet

**Student Status**:
- **Reserved**: Spot held with deposit
- **Enrolled**: Fully registered
- **Dropped**: Left class
- **Graduated**: Completed program

**Payment Status**:
- **Completed**: Payment recorded
- **Pending**: Awaiting confirmation
- **Failed**: Payment unsuccessful

### Keyboard Shortcuts

**Navigation**:
- `Ctrl + K`: Open search
- `Esc`: Close modals/dialogs
- `Tab`: Move to next field
- `Shift + Tab`: Move to previous field

**Forms**:
- `Enter`: Submit form
- `Esc`: Cancel/close

**Tables**:
- `Arrow keys`: Navigate cells
- `Page Up/Down`: Scroll table

### Contact Information

**Technical Support**:
- Email: support@little-champions-academy.com
- Phone: [Support phone number]
- Hours: Monday-Friday, 8AM-5PM

**Finance Office**:
- Email: finance@little-champions-academy.com
- Phone: [Finance phone number]
- Hours: Monday-Friday, 8AM-5PM

**Admissions**:
- Email: admissions@little-champions-academy.com
- Phone: [Admissions phone number]
- Hours: Monday-Friday, 8AM-5PM

---

## Document Information

**Version**: 1.0
**Last Updated**: January 2026
**System**: Physical School Management System
**Organization**: Little Champions Academy Inc.

**Prepared for**:
- Superadmins
- Administrators
- Finance Staff
- Teachers
- Students

**Document Updates**:
This manual is updated regularly. Check for the latest version on your system's help section or contact your administrator.

**Feedback**:
If you find errors or have suggestions for this manual, please contact your system administrator.

---

*Play. Learn. Succeed.*
**Little Champions Academy, Inc.**

