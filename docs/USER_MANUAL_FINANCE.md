# Physical School Management System - Finance User Manual

## Table of Contents

1. [Introduction](#introduction)
2. [What's New in v1.3](#whats-new-in-v13)
3. [Getting Started](#getting-started)
4. [Finance Role Overview](#finance-role-overview)
5. [Finance vs Superfinance](#finance-vs-superfinance)
6. [Dashboard](#dashboard)
7. [Common UI Patterns](#common-ui-patterns)
8. [Pages and Features](#pages-and-features)
   - [Invoice Management](#invoice-management)
   - [Installment Invoice](#installment-invoice)
   - [Payment Logs](#payment-logs)
   - [Acknowledgement Receipts](#acknowledgement-receipts)
   - [Daily Summary Sales](#daily-summary-sales)
9. [Common Workflows](#common-workflows)
10. [Best Practices](#best-practices)
11. [Troubleshooting](#troubleshooting)

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
  - **Verify** branch payments (Approve / Return / **Reject**)
  - **Verify** End of Shift and Cash Deposit submissions on Daily Summary Sales

---

## What's New in v1.3

This release significantly changes the verification flow and the Payment Status modal. Read this section carefully if you handle daily verification.

### Payment Status info modal — new actions

When you open a Submitted/Pending payment to verify:

- **Editable Payment Date** — you can change the payment's actual issue date before approving (e.g. when the branch admin posted it on the wrong day). The new date is reflected everywhere the payment appears (dashboards, daily summary, AR, invoice, exports).
- **Reject** button — placed between **Cancel** and **Verify**. Rejecting requires a **reject reason** (free text, required). Once submitted:
  - The payment's `status` and `approval_status` flip to **Rejected**.
  - The linked invoice flips to **Rejected** immediately so Admin/Superadmin can record a new payment.
  - The student stays enrolled in their class — only the money is reversed.
  - The payment is excluded from the Total Amount, the Financial Dashboard and Daily Summary forever.
- **Return** still exists for fixable mistakes that should go back to the issuer for correction (no money/status change beyond returning).

### New "Rejected" tab in Payment Logs

A dedicated **Rejected** tab on your Payment Logs page lists every payment **you (or another Finance user) rejected**. It is **de-duplicated per invoice** — only the most recent rejection appears. Once Admin/Superadmin records a new payment that closes/clears the invoice, the entry **auto-clears** from the tab.

### Discount Amount on Record Payment

The Record Payment modal now accepts an optional **Discount Amount**. It counts toward invoice settlement but **not** revenue. A fully discounted payment closes the invoice as "Paid" rather than "Partial".

### EOD email digest

Branch EOD submissions no longer email Finance/Superfinance — only Superadmins (and any addresses listed in the `EOD_STAKEHOLDER_EMAILS` env var) receive the daily digest. Use the in-app Daily Summary Sales page to monitor submissions instead.

### New pages

- **Acknowledgement Receipts** — review every up-front payment for your branch with status, attachment, branch and date filters.
- **Daily Summary Sales** — verify End of Shift and Cash Deposit Summary submissions from your branch admins; Return them with a reason if corrections are needed.

### Standardized list UX

- **Debounced server-side search** on every list (no auto-refresh per keystroke; pagination resets on search).
- **Sortable column headers** with ▲/▼ arrows on Issue Date, Payment Date, Branch, Status, Issued By.
- **Three date-filter modes** on Payment Logs: **Month picker** (default = current Manila month), **Payment date** From/To, **Date created** From/To.
- AR and Invoice pages share Month / From-To filtering. Invoice date filtering is now server-side, so the visible totals always match what's in the table. The summary card uses **"Total Invoice: N"** universally.
- Financial / Enrollment Dashboards default to the current Manila month.

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

- Create invoices (invoices are typically generated by Admin/Superadmin and enrollment workflows)
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

### Default date range

The Financial Dashboard defaults to the **current Manila month** on first load (From = first day of the month, To = today). Adjust the From/To filters to view another period.

> **Reminder**: Rejected payments (see Payment Logs) and Returned payments are excluded from revenue. Only Approved/Verified payments contribute to dashboard totals.

---

## Common UI Patterns

These behaviors are consistent across every list/table.

### Search bars (debounced + server-side)

- ~300 ms debounce after last keystroke. The page does not refresh per character.
- Pagination resets to page 1 so search matches are visible immediately.
- Filtering happens server-side, so the totals on the page reflect the filtered result.

### Sortable column headers

- ▲/▼ arrows next to **Issue Date, Payment Date, Branch, Status, Issued By**.
- First click sorts ascending, second click descending; click another column to reset.

### Date filter modes (Payment Logs, AR, Invoice, Daily Summary Sales)

Each of these pages exposes three mutually exclusive date inputs:

1. **Month picker** (`YYYY-MM`) — defaults to current Manila month on AR, Daily Summary Sales and Dashboards.
2. **Payment date** From / To — Payment Logs only.
3. **From / To** — record-created date for Payment Logs; issue date for AR / Invoice.

Choosing one clears the others. Use **Clear filters** to reset all three.

---

## Pages and Features

### Invoice Management

**Path**: Manage Invoice → Invoice

#### Purpose

View and monitor invoices, download PDFs, and record payments from an invoice using the **Pay** action. Invoices are typically created by Admin/Superadmin and enrollment workflows (Finance usually does not create invoices).

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
  - **Rejected**: A payment was permanently rejected; the invoice is awaiting a new payment from Admin/Superadmin
- Search by invoice number (e.g., `INV-123`), invoice description, or branch name (debounced, server-side)
- Filter by branch (Superfinance only)
- **From / To** issue-date filter or **Month picker** (server-side filtering — totals match the table)
- Sortable headers on Issue Date, Status, Branch
- Summary card uses **"Total Invoice: N"** and **"Total Amount: ₱…"**

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

**Invoice Actions (three dots menu)**

- **Download Invoice PDF**: downloads the invoice PDF immediately
- **Pay**: opens the **Record Payment** modal for the selected invoice
- **Delete Invoice**: permanently deletes the invoice (use with caution)

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

- Finance users typically do not create invoices (created by Admin/Superadmin and enrollment workflows)
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

View and export payment history for auditing and reconciliation. Finance users use this page mainly for **tracking** and **reporting** (not for creating payments).

#### Features

**Viewing Payments**

- See all payment records (your branch, or all branches if Superfinance)
- **Tabs**: All / **Pending** (awaiting your verification) / **Verified** (approved by Finance) / **Returned** (sent back to issuer) / **Rejected** (permanently rejected)
- **Date filter modes**: Month picker (default = This Month), Payment date From/To, Date created From/To
- Filter by Payment Method, Status, Branch (Superfinance only)
- Debounced search by invoice number, student name or reference number
- Sortable headers per Common UI Patterns
- Export to Excel — the export now appends a **Total Amount** row honoring the active filters and excluding Returned/Rejected amounts

#### Verifying a payment (Pending tab → Status modal)

1. Open the **Pending** tab and click a row to open the **Payment Status info** modal.
2. Review the linked invoice, the student, the payment method and the cash/proof attached.
3. (Optional) Update the **Payment Date** if the issuer used the wrong date — the change cascades to all dashboards, daily summary, AR and exports.
4. Choose one action at the bottom (left → right):
   - **Cancel** — close the modal without changes.
   - **Reject** — mark the payment as permanently rejected. You **must** provide a **reject reason**. The linked invoice immediately becomes **Rejected** so Admin/Superadmin can record a new payment. The amount is removed from revenue, the dashboards and daily summary forever. Student enrollment is unchanged.
   - **Verify** — approve the payment. The invoice status recalculates from `payable_amount + discount_amount` of all approved payments.
5. Both **Reject** and **Verify** notify the issuer in-app.

> **Return vs Reject**:
> - **Return** = "fix this and resubmit" (no money is reversed; the row goes back to the issuer's draft).
> - **Reject** = "this payment never happened in our books" (money is reversed; the invoice flips to Rejected for re-payment).

#### Rejected tab

The **Rejected** tab shows the payments you (or another Finance user) rejected for your branch.

- Columns include rejected by, rejected at, reject reason, branch and student.
- **De-duplicated by invoice** — only the latest rejection appears even if a payment for that invoice has been rejected multiple times across resubmissions.
- **Auto-clears** when Admin/Superadmin records a new payment that moves the invoice out of Rejected status.
- Excluded from Total Amount and exports.

#### Recording a payment (Invoice → Pay)

Payments are recorded from `Manage Invoice → Invoice`:

1. Find the invoice (search by invoice number / description / branch name and/or filter by status)
2. Click the three-dots menu → **Pay**
3. In the **Record Payment** modal:
   - Select **Student** (required)
   - Select **Payment Type**: Full Payment / Partial Payment / Advance Payment
   - Select **Payment Method**: Cash / Online Banking / Credit Card / E-wallets
   - Enter **Payable Amount** and **Issue Date**
   - Enter **Discount Amount** (optional) — counts toward invoice settlement, not revenue
   - Enter **Reference Number** (shown for non-cash methods)
   - Add **Remarks** (optional)
4. Click **Record Payment**
5. Verify invoice status updated and the payment appears in `Manage Invoice → Payment Logs`

#### Important Notes

- Always verify the invoice number and amount before recording a payment.
- If your Finance UI does not allow editing/deleting payments, escalate corrections/refunds to Admin/Superadmin.
- Once a payment is **Rejected** it cannot be approved later. The issuer must record a new payment for the invoice.

---

### Acknowledgement Receipts

**Path**: Manage Invoice → Acknowledgement Receipts

#### Purpose

Review every up-front payment recorded in your branch (reservation fees, downpayments) before they are fully tied to an invoice or enrollment.

#### Filters

- **Status** (Submitted / Pending / Verified / Applied / Rejected / Cancelled)
- **From / To** issue date or **Month picker** (default = current Manila month)
- Search by AR number, student/prospect name or reference number
- (Superfinance) Branch filter

#### Each row

- AR number rendered as **"Acknowledgement Receipt# AR-XXXX"**
- Student / prospect, package, level tag, **Amount**, branch, status
- Reference number, attachment (proof image) and reject reason if any
- Issue date and Issued By

Click a row to open full details, view the proof attachment, see the linked invoice (if any) and download the AR PDF.

> **Tip**: Reconcile bank deposits by combining the **Branch + Date range** filter on AR and Payment Logs.

---

### Daily Summary Sales

**Path**: Daily Summary Sales

#### Purpose

Verify branch admins' **End of Shift (EOD)** and **Cash Deposit Summary** submissions for your branch.

#### Tabs

- **End of Shift** — daily branch closeouts (Submitted → Verified or Returned).
- **Cash Deposit Summary** — periodic cash deposit submissions with proof attachment (Submitted → Approved or Returned).

Each tab includes a **Pending verification** view (Submitted) and a **Returned** view (rows you sent back).

#### Filters

- **Status**, **Branch** (Superfinance), **From / To**, **Month picker** (default = current Manila month)

#### Verifying

1. Open a Submitted row to view the recalculated payment list and totals.
2. **End of Shift** — confirm the cash on hand, the payment count and the total amount match the issuer's submission. Approve or Return with a reason.
3. **Cash Deposit Summary** — confirm the listed cash payments match the deposit slip. The modal shows live recalculated rows; if the live recalc returns nothing (e.g. payments were deleted after submission), it falls back to the **original audit snapshot** with an amber notice at the top of the table. Use the snapshot to validate the original deposit.
4. Click **Verify** / **Approve**, or **Return** with a clear reason.

#### EOD email digest

You **no longer receive** the EOD email digest — Superadmins do. Use this page to monitor daily submissions instead.

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
   - Go to Manage Invoice → Invoice
   - Search the invoice number (e.g., `INV-123`)
   - Open the three dots menu → **Pay**
   - Complete the **Record Payment** form and submit
   - Verify invoice status updated and payment appears in Payment Logs
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
   - Go to Manage Invoice → Invoice → three dots menu → **Pay**
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
1. Gather the invoice number and payment reference/receipt details
2. Notify Admin/Superadmin for correction (refund/adjustment workflow)
3. Verify invoice and payment history after the correction

**If Wrong Invoice Selected:**
1. Gather both invoice numbers and the payment reference/receipt details
2. Notify Admin/Superadmin to reverse/adjust the incorrect posting
3. Record the payment against the correct invoice (if needed) and verify statuses

**If Payment Needs to be Refunded:**
1. Follow your branch refund policy and document the reason + proof
2. Notify Admin/Superadmin to process the refund/adjustment in the system
3. Verify the updated invoice status and payment history

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

**Version**: 1.3
**Last Updated**: May 11, 2026
**Roles**: Finance, Superfinance
**System**: Physical School Management System
**Organization**: Little Champions Academy Inc.

### Change log

- **v1.3 (May 11, 2026)** — Added the new **Reject** action with mandatory reason and Rejected tab, the editable Payment Date in the Payment Status modal, the optional Discount Amount on Record Payment, the Acknowledgement Receipts and Daily Summary Sales pages, three date-filter modes, debounced server-side search and sortable columns. Removed the EOD email digest for Finance/Superfinance.
- **v1.2 (January 29, 2026)** — Earlier baseline.

---

*This manual covers all features available to Finance and Superfinance users. For role-specific questions, contact your Admin or Superadmin.*
