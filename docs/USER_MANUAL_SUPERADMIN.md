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

**Path**: Branch → Branch List

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
   - **Branch Address**: Physical address (required)
   - **City**: City name (required)
   - **State/Province**: State or province (required)
   - **Postal Code**: ZIP/postal code (required)
   - **Country**: Country name (required)
   - **Phone Number**: Contact phone (required)
   - **Email**: Branch email address (required)
   - **Business Registration Number**: Legal registration number
   - **Tax ID**: Tax identification number
   - **Establishment Date**: When branch was established
   - **Currency**: Currency code (e.g., USD, PHP)
   - **Locale**: Language/locale setting
   - **Status**: Active or Inactive (required)
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

**Path**: Calendar → Calendar Schedule

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
   - **Priority**: High, Medium, or Low (required)
   - **Recipient Groups**: Select who should see this:
     - All
     - Students
     - Teachers
     - Parents
     - Admin
     - Finance
   - **Branch Selection**: 
     - Specific Branch (select from dropdown)
     - All Branches (system-wide)
   - **Start Date**: When announcement becomes visible
   - **End Date**: When announcement expires
   - **Status**: Active, Inactive, or Draft
3. Click "Publish" to make it active

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

Manage all users across all branches. Create, edit, and manage Superadmin, Admin, Finance, Teacher, and Student users.

#### Features

**Viewing Personnel**

- See all users across all branches
- Filter by Branch
- Filter by User Type
- Search by name or email
- View user details

**Table Columns**
- Full Name
- Email
- User Type
- Branch (if assigned)
- Phone Number
- Actions

**Creating New Users**

1. Click "Add Personnel" button
2. Fill in the form:
   - **Full Name**: User's full name (required)
   - **Email**: Unique email address (required)
   - **Password**: Initial password (required, min 6 characters)
   - **User Type**: Select from:
     - **Superadmin**: Full system access (Superadmin only)
     - **Admin**: Branch administrator
     - **Finance**: Financial staff
       - Can assign to branch (branch-level Finance)
       - Or leave branch unassigned (Superfinance - system-wide)
     - **Teacher**: Teaching staff
     - **Student**: Students
   - **Gender**: Select from dropdown
   - **Date of Birth**: Select date
   - **Phone Number**: Contact number
   - **Branch**: Select branch (required for Admin, Teacher, Student, branch-level Finance)
     - Leave empty for Superadmin and Superfinance
   - **Level Tag**: Required for Students (Nursery, Pre-K, etc.)
3. Click "Create User"

**User Types You Can Create**

- **Superadmin**: Full system access (only Superadmin can create)
- **Admin**: Branch administrators (only Superadmin can create)
- **Finance**: 
  - Branch-level: Assigned to specific branch
  - Superfinance: No branch assigned (system-wide)
- **Teacher**: Teaching staff
- **Student**: Students

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

- **Search Bar**: Type name or email to search
- **Filter by Branch**: Select branch from dropdown
- **Filter by User Type**: Select user type from dropdown
- **Clear Filters**: Click "Clear" to reset

#### Important Notes

- Only Superadmin can create Superadmin and Admin users
- Email addresses must be unique
- Passwords must be at least 6 characters
- Students require a Level Tag
- Superfinance users should not have a branch assigned
- Deleting a user is permanent and may affect related records

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
   - **Promo Type**: Percentage Discount, Fixed Amount Discount, or Referral Bonus
   - **Discount Value**: Amount or percentage (required)
   - **Start Date**: When promo becomes active (required)
   - **End Date**: When promo expires (required)
   - **Status**: Active or Inactive
   - **Applicable Branches**: 
     - Select specific branches
     - Or select "All Branches" for system-wide promo
   - **Applicable Packages**: Select packages that can use this promo
   - **Usage Limits**: Maximum times promo can be used
3. Click "Save"

**System-Wide vs Branch-Specific Promos**

- **System-Wide**: Select "All Branches" - usable across all branches
- **Branch-Specific**: Select specific branches - only usable in those branches

**Promo Management**

- Edit promos
- Deactivate promos
- Track promo usage
- Manage system-wide and branch-specific promos

#### Important Notes

- Superadmin can create system-wide promos (Admin cannot)
- Promo codes must be unique
- System-wide promos are available to all branches

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

## Common Workflows

### Workflow 1: Setting Up a New Branch

1. **Create Branch**
   - Go to Branch → Add Branch
   - Fill in all branch details
   - Save branch

2. **Create Branch Admin**
   - Go to Personnel → Add Personnel
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
   - Go to Personnel → Add Personnel
   - Create Student user
   - Assign to branch

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

**Version**: 1.0
**Last Updated**: January 2026
**Role**: Superadmin
**System**: Physical School Management System
**Organization**: Little Champions Academy Inc.

---

*This manual covers all features available to Superadmin users. You have full system access and can manage all aspects of the system across all branches.*
