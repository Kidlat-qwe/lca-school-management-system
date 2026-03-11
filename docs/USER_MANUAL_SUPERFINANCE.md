# Physical School Management System - Superfinance User Manual

## Table of Contents

1. [Introduction](#introduction)
2. [Getting Started](#getting-started)
3. [Superfinance Role Overview](#superfinance-role-overview)
4. [Finance vs Superfinance](#finance-vs-superfinance)
5. [Dashboards](#dashboards)
6. [Pages and Features](#pages-and-features)
   - [Invoice Management](#invoice-management)
   - [Installment Invoice](#installment-invoice)
   - [Payment Logs](#payment-logs)
   - [Acknowledgement Receipts](#acknowledgement-receipts)
7. [Common Workflows](#common-workflows)
8. [Best Practices](#best-practices)
9. [Troubleshooting](#troubleshooting)

---

## Introduction

This manual is specifically designed for **Superfinance** users of the Physical School Management System. As Superfinance, you oversee financial operations **across all branches**, with the ability to review invoices, payments, acknowledgements, and trends system‑wide.

If you are a branch‑level **Finance** user, please refer to `USER_MANUAL_FINANCE.md` for a version of this guide tailored to a single‑branch workflow. Most features are the same, but Superfinance sees and controls data for **every branch**.

### Key Characteristics of the Superfinance Role

- **Access Level**: All branches (system‑wide)
- **Primary Focus**:
  - Monitoring revenue and collections across branches
  - Reviewing and approving payments
  - Tracking installment invoices
  - Reviewing acknowledgement receipts (upfront payments) per branch
- **You do _not_**:
  - Create classes, packages, programs, or students
  - Configure academic structures (that is managed by Admin/Superadmin)

---

## Getting Started

### Logging In

1. Go to your school’s system URL.
2. Enter your **email** and **password**.
3. Click **Login**.
4. If your account is configured as Superfinance (Finance with no `branch_id`), you will be redirected to the **Superfinance dashboard**.

### Identifying That You Are Superfinance

You are using a **Superfinance** account if:

- The role label in the top‑right header shows **Superfinance**.
- You can see and use **Branch** filters on finance pages (Invoices, Installment Invoices, Payment Logs, Acknowledgement Receipts).
- You can see data from **multiple branches**, not just one.

If you only see data for a single branch and there is no branch filter, you are a regular Finance user.

---

## Superfinance Role Overview

### What You Can Do

- View all invoices across **all branches**.
- Filter invoices and payments by **branch**, **status**, **date range**, and **student**.
- View and monitor **installment invoice profiles** and generated installment invoices.
- Track **payment history** and exported logs for auditing.
- Review **acknowledgement receipts** (upfront payments) and link them to invoices later (via Finance/Admin workflows).
- Download invoice PDFs and receipt documents.

### What You Cannot Do

- Create or edit:
  - Branches
  - Academic structure (programs, classes, curriculum)
  - Packages or pricing lists
  - Personnel and user roles
- Post manual journal entries (the system abstracts this via invoices and payments).

Those actions belong to **Superadmin** or **Admin** roles.

---

## Finance vs Superfinance

The system already has a combined manual for Finance and Superfinance in `USER_MANUAL_FINANCE.md`. This section summarizes the difference from a Superfinance point of view.

### Finance (Branch-Level)

- Assigned to **one branch**.
- Sees only invoices, payments, and receipts for **that branch**.
- No branch filter in tables (the branch is implicit).

### Superfinance (System-Level)

- **Not** assigned to a specific branch (`branch_id` is empty).
- Sees **all** financial data across branches.
- Every major finance page has a **Branch** dropdown/filter.
- Can compare performance between branches by switching branch filters.

### Practical Impact

- When troubleshooting a parent complaint, you can quickly switch branches and search by **student name**, **invoice number**, or **acknowledgement reference number** regardless of which branch created it.
- For month‑end review, you can:
  - View **per‑branch** totals by filtering.
  - Or leave branch blank to see a **consolidated** view.

---

## Dashboards

Depending on your system configuration, you may see:

- `SuperfinanceFinancialDashboard` (overall finance dashboard).
- `SuperfinanceOperationalDashboard` (operations‑focused metrics).

### Typical Dashboard Widgets

- **Total Revenue** (system‑wide or for the selected branch).
- **Today’s Revenue** and **This Month’s Revenue**.
- **Outstanding Receivables** and **Overdue Invoices**.
- **Recent Payments** list.
- **Branch Filters** to narrow the view.

### How to Use as Superfinance

1. Choose a **Branch** in the dashboard filter if you want branch‑level metrics, or leave it set to “All” for consolidated totals.
2. Scan **Overdue / Pending** cards to identify problem branches.
3. Click through from widgets (where supported) to go into **Invoices** or **Payment Logs** for deeper investigation.

---

## Pages and Features

### Invoice Management

**Menu Path**: Manage Invoice → **Invoice** (Superfinance menu)

#### Purpose

Central place to **review all invoices** across branches, track status, and open invoice details.

#### Key Elements

- **Search Bar**:
  - Search by **invoice number** (e.g., `INV-105`).
  - Search by **student name**.
- **Branch Filter**:
  - Select a branch to limit the list.
  - Clear to see all branches.
- **Status Filter**:
  - `Paid`, `Pending`, `Unpaid`, `Overdue`, `Partially Paid`, `Cancelled`.
- **Amount, Due Date, Actions** columns:
  - Amount shows the total invoice amount.
  - Actions usually include:
    - **View / Details** – open full invoice details.
    - **Download PDF** – invoice PDF (if enabled).

#### As Superfinance, You Typically:

- Monitor **aging** invoices by sorting/filtering on `Status` and `Due Date`.
- Validate that branch Finance has correctly recorded payments.
- Open invoice details to see:
  - Line items and tax.
  - Payment history.
  - Student and branch context.

---

### Installment Invoice

**Menu Path**: Manage Invoice → **Installment Invoice**

#### Purpose

Shows **installment invoice profiles** and generated installment invoices, especially for long‑term payment plans.

#### Typical Actions

- Filter by:
  - Branch
  - Status (Active, Completed, Delinquent if enabled)
  - Student name
- Open a profile to see:
  - Original package or enrollment.
  - Total amount and per‑invoice amounts.
  - Next generation date and frequency.

#### As Superfinance

- Monitor whether installment invoices are **generated on schedule** (e.g., monthly).
- Check branches for:
  - Many **overdue** installment invoices.
  - Incorrect frequencies or amounts (for escalation to Admin).

---

### Payment Logs

**Menu Path**: Manage Invoice → **Payment Logs**

#### Purpose

Audit trail of **all payments** recorded in the system.

#### Key Features

- Filters:
  - **Branch** (Superfinance only).
  - **Date range**.
  - **Payment method** (cash, bank, e‑wallet, etc., depending on setup).
  - **Invoice number** or **student name**.
- Table columns typically include:
  - Payment date and time.
  - Invoice number.
  - Student name.
  - Amount paid.
  - Payment method and reference number.
  - Branch.

#### As Superfinance

- Verify **branch deposits** against recorded payments.
- Investigate disputes by:
  - Searching for a specific **reference number** or **amount**.
  - Comparing payment timestamps with bank statements.
- Export or copy data (if export is enabled) for external reporting.

---

### Acknowledgement Receipts

**Menu Path**: Manage Invoice → **Acknowledgement Receipts**

#### Purpose

Record and review **up‑front payments** (e.g., reservation fees, downpayments) before they are fully tied to an invoice or enrollment.

#### Main Columns

- Student Name and Guardian Name.
- Package and Level Tag.
- **Amount** (what the parent paid up front).
- Branch and Status (e.g., `Enrolled`, `Reserved`).
- Reference Number and Attachment (uploaded proof of payment).
- Issue Date.

#### As Superfinance

- Check that branches:
  - Record all **reservation/downpayment** receipts.
  - Attach proof (screenshot, deposit slip) where required.
- Use branch filter + date range (if available) to reconcile **daily bank deposits** vs acknowledgement receipts.

> Note: Creating new acknowledgement receipts is usually done by **Finance** at the branch; Superfinance primarily **reviews and audits**.

---

## Common Workflows

### 1. Reviewing Daily Collections per Branch

1. Open **Payment Logs**.
2. Select a **Branch**.
3. Filter **Date** to `Today` (or a specific date range).
4. Review:
   - Total amount for the day.
   - List of all payments, methods, and references.
5. Cross‑check with:
   - Branch’s cash report.
   - Bank/e‑wallet deposit slip.

### 2. Checking Overdue Invoices Across Branches

1. Open **Invoice Management**.
2. Filter `Status` = **Overdue**.
3. Optionally filter by **Branch** to see which locations are behind.
4. Sort by **Due Date** or **Amount** to prioritize follow‑ups.
5. Coordinate with the branch’s Finance/Admin team for action.

### 3. Validating Installment Performance

1. Go to **Installment Invoice**.
2. Filter by **Branch** and, if available, **Status**.
3. Check:
   - How many profiles are **Active vs Completed**.
   - Whether next generation dates look correct.
4. Drill into individual profiles when a parent has billing questions.

### 4. Auditing Acknowledgement Receipts

1. Open **Acknowledgement Receipts**.
2. Filter by **Branch** and date range.
3. Confirm:
   - Amounts and reference numbers.
   - Attachments exist where your policy requires them.
4. Spot‑check that receipts have corresponding invoices/enrollments downstream (via Invoice and Classes pages together with Admin/Superadmin).

---

## Best Practices

- **Always filter by branch** before making decisions; avoid assuming the list is for a single branch.
- **Use date filters** when investigating an issue to avoid noise.
- **Download PDFs** (invoices/receipts) when sharing with parents to ensure consistent formatting.
- **Coordinate with Admin/Superadmin** for structural issues (wrong package price, mis‑configured installment, wrong student assignment).
- **Keep communication notes outside the system** (email, ticketing) so financial records remain strictly transactional and auditable.

---

## Troubleshooting

### I Don’t See Any Branch Filter

- You might be logged in as **Finance**, not Superfinance.
- Ask Superadmin to verify your role; Superfinance users must have **no branch assigned**.

### A Payment or Invoice Looks Wrong

- Use **Payment Logs** or **Invoice** details to see all activity.
- Check **Acknowledgement Receipts** for earlier up‑front payments.
- If an amount is truly incorrect:
  - Coordinate with branch Finance and Admin to cancel/adjust via proper workflows.

### I Can’t Access a Page Mentioned Here

- Your account may have restricted access based on school policy.
- Contact Superadmin or system administrator to confirm your permissions.

---

For more detailed, step‑by‑step screens and screenshots, refer also to:

- `USER_MANUAL_FINANCE.md` – shared Finance/Superfinance behavior.
- `USER_MANUAL_SUPERADMIN.md` – for understanding how branches, packages, and invoices are configured.

