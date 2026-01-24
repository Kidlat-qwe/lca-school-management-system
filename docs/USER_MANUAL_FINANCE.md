# Physical School Management System - Finance User Manual

## Table of Contents

1. [Introduction](#introduction)
2. [Getting Started](#getting-started)
3. [Finance Role Overview](#finance-role-overview)
4. [Finance vs Superfinance](#finance-vs-superfinance)
5. [Dashboard](#dashboard)
6. [Pages and Features](#pages-and-features)
   - [Invoice Management](#invoice-management)
   - [Installment Invoice](#installment-invoice)
   - [Payment Logs](#payment-logs)
7. [Common Workflows](#common-workflows)
8. [Best Practices](#best-practices)
9. [Troubleshooting](#troubleshooting)

---

## Introduction

This manual is specifically designed for **Finance** and **Superfinance** users of the Physical School Management System. Finance staff are responsible for managing all financial operations, recording payments, and tracking invoices.

### Key Characteristics of Finance Roles

- **Primary Function**: Financial operations and payment management
- **Access Level**: 
  - **Finance**: Single branch (your assigned branch only)
  - **Superfinance**: All branches (system-wide)
- **Core Responsibilities**: 
  - Record payments
  - Track invoices
  - Monitor installment plans
  - Generate financial reports
  - Manage payment records

---

## Getting Started

### Accessing the System

1. Navigate to your school's system URL
2. Enter your email and password
3. Click "Login"
4. You'll be redirected to the Finance Dashboard

### First Time Setup

1. Ensure your account is created by a Superadmin or Admin
2. Verify you're assigned to the correct branch (for Finance users)
3. Review your dashboard
4. Familiarize yourself with Invoice and Payment Logs pages

---

## Finance Role Overview

### What You Can Do

- View all invoices (branch or system-wide depending on role)
- Record payments for invoices
- View and monitor installment invoice plans
- Track payment history
- Download invoice PDFs
- View payment reports
- Monitor outstanding payments
- Track overdue invoices

### What You Cannot Do

- Create invoices (created by Admin/Superadmin)
- Create or modify classes
- Create or modify packages
- Create or modify programs
- Manage personnel (except view)
- Create announcements

---

## Finance vs Superfinance

### Finance (Branch-Level)

**Access Level**: Single branch only

**Characteristics**:
- Assigned to a specific branch
- Can only see invoices and payments for your branch
- Cannot see other branches' financial data
- Branch name shown in header: "Your Branch: [Branch Name]"

**Use Case**: Branch-level finance staff managing one location

### Superfinance (System-Level)

**Access Level**: All branches

**Characteristics**:
- Not assigned to any branch (branch_id is NULL)
- Can see invoices and payments from ALL branches
- Can compare performance across branches
- Can generate system-wide reports
- Can filter by branch in all pages

**Use Case**: Finance managers overseeing multiple branches

### Identifying Your Role

- Check the header/navigation area
- Finance: Shows "Your Branch: [Name]"
- Superfinance: Can filter by branch, sees all branches
- Dashboard shows branch-specific or system-wide statistics

---

## Dashboard

**Path**: Dashboard (main page after login)

### Overview

The Finance Dashboard provides a financial overview with key metrics and recent payment activities.

### What You'll See

#### Revenue Overview

- **Total Revenue**: Total income (branch or system-wide)
- **Today's Revenue**: Revenue received today
- **This Month's Revenue**: Revenue for current month
- **Pending Invoices**: Number of unpaid invoices
- **Total Receivables**: Amount owed but not yet paid

#### Recent Payments

- Latest payment transactions
- Payment method breakdown
- Recent payment amounts
- Payment dates

#### Payment Trends (if available)

- Monthly payment charts
- Payment method distribution
- Revenue trends over time

#### Pending Invoices Summary

- Number of unpaid invoices
- Total amount due
- Overdue invoices count
- Recent invoice activity

### How to Use the Dashboard

1. **Monitor Revenue**: Check revenue statistics for quick overview
2. **Track Payments**: Review recent payments section
3. **Identify Issues**: Check pending invoices and overdue amounts
4. **Quick Navigation**: Click on statistics to navigate to related pages
5. **Daily Review**: Use dashboard for daily financial health check

---

## Pages and Features

### Invoice Management

**Path**: Manage Invoice → Invoice

#### Purpose

View and monitor all invoices. Finance users can view invoice details, download PDFs, and track payment status, but typically cannot create invoices (created by Admin/Superadmin).

#### Features

**Viewing Invoices**

- See all invoices (your branch or all branches if Superfinance)
- Filter by Status:
  - **Paid**: Fully paid invoices (green badge)
  - **Pending**: Awaiting payment (yellow badge)
  - **Unpaid**: Not paid yet (red badge)
  - **Overdue**: Past due date (red badge)
  - **Partially Paid**: Some payment received (yellow badge)
  - **Cancelled**: Voided invoices
- Search by invoice number or student name
- Filter by branch (Superfinance only)

**Invoice Table Columns**

- Invoice Number (INV-XXXX)
- Student Name(s)
- Branch (for Superfinance)
- Status (color-coded badges):
  - **Paid**: Green background
  - **Pending**: Yellow background
  - **Unpaid**: Red background
  - **Overdue**: Red background
  - **Partially Paid**: Yellow background
- Amount
- Due Date
- Actions (three dots menu)

**Viewing Invoice Details**

1. Click on invoice number or "View" (three dots menu)
2. See comprehensive invoice information:
   - Invoice number and description
   - Student information
   - Branch information
   - Issue date and due date
   - Status
   - Items breakdown:
     - Description
     - Amount
     - Tax (if applicable)
     - Discount (if applicable)
     - Penalty (if applicable)
   - Subtotal and total amounts
   - Payment history:
     - Payment dates
     - Payment amounts
     - Payment methods
     - Reference numbers
   - Remaining balance
   - Remarks
   - Linked reservations (if applicable)

**Downloading Invoice PDF**

1. Click "View" on an invoice
2. Click "Download PDF" button
3. PDF is generated and downloaded
4. PDF includes:
   - School branding and logo
   - Invoice number and date
   - Student/parent information
   - Branch information
   - Items breakdown with details
   - Tax calculations
   - Discounts and penalties
   - Total amounts
   - Payment information
   - Due date
   - Payment instructions

**Email Invoice** (if available)

1. View invoice details
2. Click "Email Invoice" or "Send Email"
3. Invoice PDF is sent to student/parent email
4. Useful for sending receipts and reminders

**Understanding Invoice Status**

- **Paid** (Green): Invoice is fully paid
- **Pending** (Yellow): Invoice is awaiting payment
- **Unpaid** (Red): Invoice is not paid (may or may not be past due)
- **Overdue** (Red): Invoice is past due date and not paid
- **Partially Paid** (Yellow): Some payment received but not full amount
- **Cancelled**: Invoice has been voided

**Invoice and Student Enrollment**

- Invoices are linked to student enrollment
- When enrollment invoice is paid, student is automatically enrolled
- Installment invoices track phase progress
- Reservation invoices track reservation status
- Payment recording triggers automatic system actions

#### Important Notes

- Finance users typically cannot create invoices (created by Admin/Superadmin)
- Can view all invoice details and payment history
- Invoice status colors help quickly identify payment status
- PDF download requires internet connection
- Unpaid and Overdue invoices use red background for visibility

---

### Installment Invoice

**Path**: Manage Invoice → Installment Invoice

#### Purpose

View and monitor installment invoice plans and logs. Track installment payment schedules, phase progress, and payment status for students on installment plans.

#### Features

**Viewing Installment Invoice Logs**

- See all installment invoice records (your branch or all branches if Superfinance)
- View phase progress for each student
- Monitor payment schedules
- Track contract completion
- Filter by status
- Search by student name or program

**Installment Invoice Table Columns**

- Student Name
- Program Name
- Amount (Excluding Tax)
- Amount (Including Tax)
- Frequency (e.g., "1 month(s)")
- Next Generation Date (when next invoice will be generated)
- Next Month (billing month)
- Phase Progress (e.g., "1/2", "2/2" with progress bar)
- Status
- Actions

**Understanding Phase Progress**

The Phase Progress column shows:
- **Format**: "X/Y" where:
  - **X** = Number of phases actually **PAID** (paid_phases)
  - **Y** = Total number of phases
- **Progress Bar**: Visual indicator showing completion percentage
  - Green bar: All phases completed
  - Blue bar: In progress
- **"Completed" Label**: Shown when all phases are paid (X = Y)

**Important**: Phase progress is based on **ACTUAL PAID invoices**, not generated invoices.

**Phase Progress Examples**

- **"0/2"**: No phases paid yet (student not enrolled)
- **"1/2"**: First phase paid (student enrolled in Phase 1)
- **"2/2" + Green Bar + "Completed"**: All phases paid (student fully enrolled)

**For Installment Packages with Downpayment**

- **Downpayment Paid**: Phase progress still shows "0/Y" (student not enrolled yet)
- **First Installment Paid**: Phase progress shows "1/Y" (student enrolled in Phase 1)
- **Subsequent Payments**: Phase progress increases (2/Y, 3/Y, etc.)
- **All Paid**: Shows "Y/Y" + "Completed"

**Installment Invoice Records**

- Each record represents a scheduled installment invoice
- Shows when next invoice will be generated
- Displays payment status
- Links to actual invoices in Invoice page
- Tracks payment schedule

**Viewing Installment Details**

1. Click on installment invoice record
2. See detailed information:
   - Student information
   - Program and class
   - Installment contract details:
     - Monthly amount
     - Frequency
     - Start date
     - Total phases
   - Payment schedule:
     - Next generation date
     - Next invoice month
     - Due dates
   - Generated invoices list:
     - Invoice numbers
     - Generation dates
     - Payment status
     - Amounts
   - Payment history
   - Phase progress tracking

**Filtering and Searching**

- **Filter by Status**: Pending, Generated, etc.
- **Search**: By student name or program name
- **Filter by Branch**: Superfinance only
- **Sort**: By date, student name, amount, etc.

**Monitoring Installment Plans**

- **Track Progress**: Monitor phase progress for all students
- **Identify Issues**: Find students with overdue payments
- **Monitor Completion**: See which contracts are completed
- **Payment Schedule**: View upcoming invoice generation dates

#### Important Notes

- Installment invoices are automatically generated by the system
- Phase progress reflects ACTUAL PAID invoices, not generated invoices
- Downpayment payments don't count toward phase progress
- Only installment invoice payments count toward phases
- Progress updates automatically when payments are recorded
- "Completed" status means all phases are paid

---

### Payment Logs

**Path**: Manage Invoice → Payment Logs

#### Purpose

Record and track all payments. This is your primary tool for managing financial transactions. Record payments received from students/parents and track payment history.

#### Features

**Viewing Payment Logs**

- See all payment records (your branch or all branches if Superfinance)
- Filter by Date Range
- Filter by Payment Method
- Search by student name or invoice number
- Filter by branch (Superfinance only)
- View payment details
- Export payment data

**Payment Table Columns**

- Payment ID
- Invoice Number (INV-XXXX)
- Student Name
- Branch (for Superfinance)
- Payment Method (Cash, Bank Transfer, GCash, etc.)
- Payment Type (Full, Partial, Deposit)
- Amount
- Payment Date
- Status
- Reference Number
- Actions (three dots menu)

**Recording Payments** (PRIMARY FUNCTION)

This is the most important function for Finance users.

1. Click "Record Payment" button (usually top right, yellow button)
2. Fill in the payment form:
   
   **Invoice Selection**
   - **Select Invoice**: Choose invoice from dropdown (required)
     - Dropdown shows unpaid and partially paid invoices
     - Shows invoice number, student name, and amount due
     - Filter/search invoices in dropdown
   - **Student**: Automatically filled from selected invoice
   - **Amount Due**: Shows remaining balance on invoice
   
   **Payment Details**
   - **Payment Method**: Select from dropdown (required):
     - Cash
     - Bank Transfer
     - GCash
     - PayMaya
     - Check
     - Credit Card
     - Other
   - **Payment Type**: Select (required):
     - **Full**: Full payment of invoice amount
     - **Partial**: Partial payment (less than invoice amount)
     - **Deposit**: Deposit payment
   - **Payable Amount**: Amount being paid (required)
     - Must be positive number
     - For Full payment: Should equal invoice amount
     - For Partial payment: Can be any amount less than invoice amount
   - **Reference Number**: Receipt/transaction number (optional but highly recommended)
     - Receipt number
     - Bank transaction reference
     - GCash/PayMaya transaction ID
     - Check number
   - **Issue Date**: Payment date (defaults to today, required)
   - **Remarks**: Additional notes (optional)
     - Payment notes
     - Special instructions
     - Related information

3. Click "Record Payment" button
4. System processes payment:
   - Payment record is created
   - Invoice status is updated automatically
   - Student enrollment is updated (if applicable)
   - Phase progression occurs (if installment invoice)
   - System actions are triggered automatically

**What Happens After Recording Payment**

The system automatically:

1. **Updates Invoice Status**:
   - If full payment: Status changes to "Paid"
   - If partial payment: Status changes to "Partially Paid"
   - If unpaid: Status remains "Unpaid" or changes to "Overdue"

2. **Student Enrollment** (if applicable):
   - If enrollment invoice is fully paid: Student is automatically enrolled in class
   - Student can now access class materials and schedule

3. **Phase Progression** (for installment invoices):
   - When installment invoice is paid: Student progresses to next phase
   - Phase progress is updated in Installment Invoice page
   - Next month's invoice is generated (if applicable)

4. **Reservation Upgrade** (if applicable):
   - If reservation fee invoice is paid: Reservation status updates
   - Student can be upgraded to full enrollment

5. **Downpayment Processing** (for Installment packages):
   - If downpayment invoice is paid:
     - Downpayment status is marked as paid
     - First installment invoice is created
     - Student appears as "Pending (Downpayment Paid)" in class modal
     - Student is NOT enrolled yet (enrolled when first installment is paid)

**Viewing Payment Details**

1. Click on payment record
2. See comprehensive payment information:
   - Payment ID
   - Invoice number and details
   - Student information
   - Payment method and type
   - Payment amount
   - Payment date
   - Reference number
   - Status
   - Remarks
   - Created by (who recorded the payment)
   - Created at (timestamp)

**Editing Payments**

1. Click "Edit" (three dots menu) on a payment
2. Modify payment details:
   - Payment method
   - Payment type
   - Amount
   - Reference number
   - Payment date
   - Remarks
3. Click "Update"
4. System recalculates invoice status
5. Student enrollment may be adjusted if amount changes significantly

**Deleting Payments**

1. Click "Delete" (three dots menu) on a payment
2. Confirm deletion (important: this action affects invoice status and enrollment)
3. Payment is removed
4. System automatically:
   - Recalculates invoice status (may become Unpaid)
   - May remove student enrollment (if enrollment was triggered by this payment)
   - Adjusts phase progress (if installment payment)
   - Reverts downpayment status (if downpayment payment)

**Warning**: Deleting payments can have significant effects. Use with caution.

**Payment Methods Explained**

- **Cash**: Physical cash payment received at office
- **Bank Transfer**: Bank deposit or online transfer
  - Include bank transaction reference number
- **GCash**: Mobile money payment via GCash
  - Include GCash transaction reference
- **PayMaya**: Mobile money payment via PayMaya
  - Include PayMaya transaction reference
- **Check**: Check payment
  - Include check number
- **Credit Card**: Card payment
  - Include transaction ID
- **Other**: Any other payment method
  - Specify in remarks

**Payment Types Explained**

- **Full**: Payment covers entire invoice amount
  - Invoice status becomes "Paid"
  - Student enrollment activated (if applicable)
- **Partial**: Payment is less than invoice amount
  - Invoice status becomes "Partially Paid"
  - Can record additional payments later
  - Student enrollment activated only when fully paid
- **Deposit**: Deposit payment (typically for reservations)
  - Part of total amount
  - Remaining balance still due

**Filtering Payments**

- **By Date Range**: 
  - Select start date and end date
  - Useful for daily, weekly, monthly reports
- **By Payment Method**:
  - Filter by Cash, Bank Transfer, GCash, etc.
  - Useful for reconciliation
- **By Student**: 
  - Search by student name
  - See all payments for a student
- **By Invoice**: 
  - Search by invoice number
  - See payment history for an invoice
- **By Branch**: 
  - Superfinance only
  - Filter by specific branch

**Exporting Payment Data**

- Export to Excel/CSV format
- Includes all filtered data
- Useful for:
  - Accounting records
  - Bank reconciliation
  - Financial reports
  - Auditing

#### Payment Recording Workflow (Detailed)

**Scenario 1: Recording Full Payment for Enrollment Invoice**

1. Student/parent comes to office with payment
2. Ask for invoice number or student name
3. Go to Payment Logs page
4. Click "Record Payment"
5. Select invoice from dropdown
6. Verify:
   - Invoice number is correct
   - Student name matches
   - Amount due matches payment received
7. Enter payment details:
   - Payment Method: Select appropriate method
   - Payment Type: Full
   - Payable Amount: Enter amount (should match invoice)
   - Reference Number: Enter receipt/transaction number
   - Issue Date: Today's date (or payment date)
   - Remarks: Any additional notes
8. Click "Record Payment"
9. System automatically:
   - Creates payment record
   - Updates invoice status to "Paid"
   - Enrolls student in class (if enrollment invoice)
   - Sends notifications (if configured)
10. Verify:
    - Check invoice status changed to "Paid"
    - Confirm student is enrolled (check Classes page)
    - Payment appears in payment logs

**Scenario 2: Recording Partial Payment**

1. Student pays partial amount
2. Follow steps 1-7 from Scenario 1
3. Payment Type: Select "Partial"
4. Payable Amount: Enter partial amount (less than invoice total)
5. Click "Record Payment"
6. System updates invoice status to "Partially Paid"
7. Student is NOT enrolled yet (must pay full amount)
8. Record additional payments later to complete invoice

**Scenario 3: Recording Downpayment Payment (Installment Package)**

1. Student enrolled with Installment package
2. Downpayment invoice created
3. Student pays downpayment
4. Go to Payment Logs → Record Payment
5. Select downpayment invoice
6. Enter payment details:
   - Payment Method: As received
   - Payment Type: Full (downpayment is full payment of downpayment invoice)
   - Payable Amount: Downpayment amount
   - Reference Number: Receipt number
7. Click "Record Payment"
8. System automatically:
   - Marks downpayment as paid
   - Creates first installment invoice record
   - Generates first monthly invoice
   - Student appears as "Pending (Downpayment Paid)" in class modal
   - Student is NOT enrolled yet
9. Student must pay first installment to be enrolled

**Scenario 4: Recording Installment Payment**

1. Student pays monthly installment invoice
2. Go to Payment Logs → Record Payment
3. Select the installment invoice (monthly invoice)
4. Enter payment details:
   - Payment Method: As received
   - Payment Type: Full
   - Payable Amount: Monthly installment amount
   - Reference Number: Receipt number
5. Click "Record Payment"
6. System automatically:
   - Updates invoice status to "Paid"
   - If this is first installment: Enrolls student in Phase 1
   - Progresses student to next phase
   - Generates next month's invoice (if applicable)
   - Updates phase progress in Installment Invoice page
7. Verify phase progress updated

#### Important Notes

- Always verify invoice number and amount before recording
- Include reference numbers for tracking and auditing
- Record payments immediately after receipt
- Double-check amounts to avoid errors
- Partial payments can be recorded multiple times
- Deleting payments has significant effects - use carefully
- Payment recording triggers automatic system actions
- Verify results after recording (invoice status, enrollment, etc.)

---

## Common Workflows

### Workflow 1: Daily Payment Recording

**Morning Preparation:**
1. Check Dashboard for pending invoices
2. Review Payment Logs for yesterday's payments
3. Prepare receipt book or payment recording system

**Throughout the Day:**
1. When student/parent pays:
   - Collect payment
   - Issue receipt
   - Note invoice number
   - Record payment immediately in system
2. For each payment:
   - Go to Payment Logs
   - Click "Record Payment"
   - Select invoice
   - Enter payment details
   - Record payment
   - Verify status updated
3. Keep physical receipts organized

**End of Day:**
1. Review all payments recorded today
2. Verify invoice statuses are correct
3. Check for any discrepancies
4. Reconcile with physical receipts
5. Generate daily report (if needed)

---

### Workflow 2: Processing Installment Payments

**Monthly Process:**
1. System automatically generates monthly invoices
2. Students receive invoices
3. When students pay:
   - Record payment in Payment Logs
   - Verify payment method and amount
   - Include reference number
4. System automatically:
   - Updates invoice status
   - Progresses student phase
   - Generates next month's invoice
5. Monitor Installment Invoice page:
   - Check phase progress
   - Identify overdue payments
   - Track contract completion

**Following Up on Overdue Payments:**
1. Filter invoices by "Overdue" status
2. Identify students with overdue installment payments
3. Contact students/parents
4. Record payments when received
5. Update payment records

---

### Workflow 3: Handling Payment Errors

**If Wrong Amount Recorded:**
1. Edit the payment record
2. Correct the amount
3. System recalculates invoice status
4. Verify status is correct

**If Wrong Invoice Selected:**
1. Delete the incorrect payment
2. Record payment to correct invoice
3. Verify both invoices have correct status

**If Payment Needs to be Refunded:**
1. Delete the payment record (if payment was just recorded)
2. Or create negative payment/adjustment (if system supports)
3. Update invoice status
4. Document refund in remarks

---

### Workflow 4: Monthly Financial Reconciliation

**End of Month Tasks:**
1. Export payment logs for the month
2. Reconcile with bank statements
3. Verify all payments are recorded
4. Check for discrepancies
5. Generate monthly financial report
6. Review outstanding invoices
7. Follow up on overdue accounts
8. Archive records

---

## Best Practices

### Payment Recording

1. **Record Immediately**: Enter payments as soon as received
   - Prevents forgetting
   - Keeps records up-to-date
   - Enables real-time tracking

2. **Always Include Reference Numbers**: 
   - Receipt numbers
   - Bank transaction IDs
   - Mobile payment references
   - Check numbers
   - Essential for auditing and tracking

3. **Verify Before Recording**:
   - Confirm invoice number is correct
   - Verify student name matches
   - Double-check payment amount
   - Ensure payment method is correct

4. **Use Clear Remarks**:
   - Document special circumstances
   - Note any payment arrangements
   - Include relevant details
   - Helps with future reference

### Invoice Management

1. **Monitor Status Regularly**:
   - Check pending invoices daily
   - Identify overdue invoices
   - Track payment trends
   - Follow up on unpaid invoices

2. **Download PDFs Promptly**:
   - Download invoices when needed
   - Email to parents/students
   - Keep digital copies
   - Useful for records

3. **Track Payment History**:
   - Review payment history on invoices
   - Verify all payments are recorded
   - Check for missing payments
   - Monitor partial payments

### Installment Management

1. **Monitor Phase Progress**:
   - Check Installment Invoice page regularly
   - Track which students are progressing
   - Identify students behind on payments
   - Monitor contract completion

2. **Follow Up on Overdue**:
   - Identify overdue installment payments
   - Contact students/parents
   - Set payment arrangements
   - Document communications

3. **Verify Auto-Generation**:
   - Check that monthly invoices are being generated
   - Verify generation dates
   - Ensure students receive invoices
   - Monitor system automation

### Daily Operations

1. **Start of Day**:
   - Check Dashboard for overview
   - Review pending invoices
   - Check for urgent payments
   - Plan day's activities

2. **During Day**:
   - Record payments as received
   - Answer payment inquiries
   - Verify payment statuses
   - Handle payment issues

3. **End of Day**:
   - Review all payments recorded
   - Verify invoice statuses
   - Reconcile with receipts
   - Prepare for next day

### Reporting and Reconciliation

1. **Daily Reconciliation**:
   - Match payments with bank deposits
   - Verify all payments recorded
   - Check for discrepancies
   - Document any issues

2. **Weekly Reviews**:
   - Review payment trends
   - Check outstanding invoices
   - Monitor installment progress
   - Generate weekly reports

3. **Monthly Closing**:
   - Export monthly payment data
   - Reconcile with accounting records
   - Generate financial reports
   - Archive records
   - Review and plan for next month

---

## Troubleshooting

### Common Issues

**Problem**: Cannot find invoice to record payment
- **Solution**: 
  - Verify invoice number is correct
  - Search by student name instead
  - Check invoice status (may already be paid)
  - Verify you're looking at correct branch
  - Contact Admin if invoice doesn't exist

**Problem**: Payment amount doesn't match invoice
- **Solution**:
  - Record as Partial payment if amount is less
  - Verify correct invoice is selected
  - Check if previous partial payments exist
  - Contact student/parent to verify amount
  - Document discrepancy in remarks

**Problem**: Invoice status not updating after payment
- **Solution**:
  - Refresh the page
  - Verify payment was recorded successfully
  - Check payment amount matches invoice
  - Verify payment type (Full vs Partial)
  - Contact IT support if issue persists

**Problem**: Student not enrolling after payment
- **Solution**:
  - Verify invoice is fully paid (not partial)
  - Check invoice is enrollment invoice (not reservation)
  - For Installment packages: Check if downpayment is paid first
  - Refresh page and check Classes page
  - Contact Admin if issue persists

**Problem**: Phase progress not updating
- **Solution**:
  - Phase progress updates when installment invoices are paid
  - Verify you recorded payment for installment invoice (not downpayment)
  - Check payment was recorded as Full payment
  - Refresh Installment Invoice page
  - Phase progress is based on PAID invoices, not generated

**Problem**: Cannot edit paid invoice
- **Solution**: This is expected - paid invoices cannot be edited
  - Create new invoice if adjustment needed
  - Or contact Admin/Superadmin for help

**Problem**: Payment recorded to wrong invoice
- **Solution**:
  - Delete the incorrect payment
  - Record payment to correct invoice
  - Verify both invoices have correct status
  - Document the correction

**Problem**: Duplicate payment recorded
- **Solution**:
  - Delete the duplicate payment
  - Keep only one payment record
  - Verify invoice status is correct

**Problem**: Cannot see other branches' data (Finance users)
- **Solution**: This is expected - Finance users only see their branch
  - Contact Superadmin if you need multi-branch access
  - Superfinance role can see all branches

**Problem**: Missing payment methods in dropdown
- **Solution**:
  - Use "Other" payment method
  - Specify method in remarks
  - Contact IT if new payment method needed

### Getting Help

**For Payment Issues**:
- Contact Admin for invoice-related questions
- Verify invoice exists and is correct
- Check with student/parent for payment details

**For System Issues**:
- Contact IT support
- Report technical problems
- Request feature enhancements

**For Policy Questions**:
- Contact your supervisor
- Review school payment policies
- Consult with Admin/Superadmin

---

## Document Information

**Version**: 1.0
**Last Updated**: January 2026
**Roles**: Finance, Superfinance
**System**: Physical School Management System
**Organization**: Little Champions Academy Inc.

---

*This manual covers all features available to Finance and Superfinance users. For role-specific questions, contact your Admin or Superadmin.*
