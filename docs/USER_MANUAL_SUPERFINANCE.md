# Physical School Management System - Superfinance User Manual

## Table of Contents

1. [Introduction](#introduction)
2. [What's New in v1.3](#whats-new-in-v13)
3. [Getting Started](#getting-started)
4. [Superfinance Role Overview](#superfinance-role-overview)
5. [Finance vs Superfinance](#finance-vs-superfinance)
6. [Dashboards](#dashboards)
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

## What's New in v1.3

This release significantly changes how you verify branch payments and EOD/Cash Deposit submissions across the system.

### Payment verification: Approve / Return / **Reject**

The Payment Status modal (opened from the Pending tab in Payment Logs) now offers three terminal actions:

- **Verify** — approves the payment. Invoice settlement uses `payable_amount + discount_amount`.
- **Return** — sends the row back to the issuer to fix and resubmit. No money or status changes.
- **Reject** — **new** action. Permanently rejects the payment with a mandatory **reject reason**. The linked invoice immediately becomes **Rejected** so Admin/Superadmin can record a new payment. The amount is removed from revenue, the dashboards and the Daily Sales report. **Student enrollment is unchanged** — only the money is reversed.

You can also now **edit the Payment Date** in the modal before approving — useful when the issuer entered the wrong day. The new date is reflected everywhere.

### New "Rejected" tab in Payment Logs

A dedicated **Rejected** tab lists all payments that were rejected (across all branches when no Branch is selected). It is **de-duplicated per invoice** (only the most recent rejection appears) and **auto-clears** when a fresh successful payment moves the invoice out of Rejected status.

### Discount Amount on Record Payment

The Record Payment modal accepts an optional **Discount Amount** that counts toward invoice settlement but **not** revenue. A fully discounted payment correctly closes the invoice as "Paid" instead of "Partial".

### EOD email digest

You **no longer receive** the EOD digest by email — only Superadmins do (with optional `EOD_STAKEHOLDER_EMAILS` recipients). Use the in-app **Daily Summary Sales** page to monitor branch submissions instead.

### New page: Daily Summary Sales

Verify or audit **End of Shift** and **Cash Deposit Summary** submissions across every branch. Includes a "Returned" view, server-side filters and date filters.

### Standardized list UX

- Debounced server-side search on every list (no auto-refresh per keystroke; pagination resets).
- Sortable column headers (▲/▼) on Issue Date, Payment Date, Branch, Status, Issued By.
- **Three date-filter modes** on Payment Logs: Month picker (default = current Manila month), Payment date From/To, Date created From/To.
- AR and Invoice pages share Month / From-To filtering with default "This Month" on AR and Dashboards.
- Counts labelled **"Total Invoice: N"** and **"Total Amount: ₱…"** uniformly. Excel exports include a Total Amount footer that excludes Returned/Rejected amounts.

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

1. Choose a **Branch** in the dashboard filter if you want branch‑level metrics, or leave it set to "All" for consolidated totals.
2. Scan **Overdue / Pending** cards to identify problem branches.
3. Click through from widgets (where supported) to go into **Invoices** or **Payment Logs** for deeper investigation.

### Default date range

The Superfinance Financial Dashboard defaults the **From / To** to the current Manila month on first load. Change them to investigate other periods.

> Rejected and Returned payments are excluded from revenue. Only Verified payments contribute to dashboard totals.

---

## Common UI Patterns

### Search bars (debounced + server-side)

- ~300 ms debounce after the last keystroke; no per-character refresh.
- Pagination resets to page 1 on search so matches are visible immediately.
- Filtering is server-side, so the totals on the page reflect the filtered set.

### Sortable column headers

- ▲/▼ arrows on **Issue Date, Payment Date, Branch, Status, Issued By**.
- First click ascending, second descending; click another column to reset.

### Date filter modes

Payment Logs, AR, Invoice and Daily Summary Sales pages share the same three filter inputs. Selecting one clears the others:

1. **Month picker** (`YYYY-MM`) — defaults to current Manila month on AR, Daily Summary Sales and Dashboards.
2. **Payment date** From / To — Payment Logs only.
3. **From / To** — record-created date for Payment Logs; issue date for AR / Invoice.

Use **Clear filters** to reset all three.

### Branch dropdown

Every list also exposes a **Branch** dropdown. Leave it blank for system-wide totals; choose one to scope filters, sums and exports.

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

Audit trail of **all payments** recorded in the system, plus the verification workspace where you Approve / Return / Reject branch payments.

#### Tabs

- **All** — every payment matching the filters.
- **Pending** — payments awaiting verification (your verification queue).
- **Verified** — approved payments.
- **Returned** — payments you returned to the issuer for correction.
- **Rejected** — payments permanently rejected.

#### Filters

- **Branch** (system-wide list when blank).
- **Date filter modes** — Month picker (default = This Month), Payment date From/To, Date created From/To.
- **Status** and **Payment method**.
- Debounced search by invoice number, student name or reference number.
- Sortable columns per Common UI Patterns.

#### Verifying a payment (Pending → Status modal)

1. Open the **Pending** tab and click a row to open the **Payment Status info** modal.
2. Inspect the linked invoice, the student, the payment method and any attached proof.
3. (Optional) Update the **Payment Date** if the issuer used the wrong date — the change cascades to dashboards, daily summary, AR and exports.
4. Choose one action (left → right):
   - **Cancel** — close without changes.
   - **Reject** — permanently rejects the payment. **Reject reason is required**. The linked invoice immediately becomes **Rejected** so Admin/Superadmin can record a new payment. The amount is removed from revenue and dashboards. Student enrollment is unchanged.
   - **Verify** — approve the payment. Invoice settlement uses `payable_amount + discount_amount`.
5. Both **Reject** and **Verify** notify the issuer in-app.

> **Return vs Reject**:
> - **Return** = "fix this and resubmit" (no money is reversed; the row goes back to the issuer's draft).
> - **Reject** = "this payment never happened in our books" (money is reversed; the invoice flips to Rejected for re-payment).

#### Rejected tab

- Shows every rejected payment across branches (or a single branch when you've selected one).
- Columns include rejected by, rejected at, reject reason, branch and student.
- **De-duplicated by invoice** — only the latest rejection appears, even if a payment for that invoice has been rejected multiple times across resubmissions.
- **Auto-clears** when Admin/Superadmin records a new payment that moves the invoice out of Rejected status.

#### Excel export

The export honors the active filter (branch + status + dates) and appends a single **Total Amount** row that excludes Returned and Rejected amounts.

---

### Acknowledgement Receipts

**Menu Path**: Manage Invoice → **Acknowledgement Receipts**

#### Purpose

Audit every up-front payment (reservation fees, downpayments) across all branches before they are fully tied to an invoice or enrollment.

#### Filters

- **Branch**, **Status** (Submitted / Pending / Verified / Applied / Rejected / Cancelled).
- **From / To** issue date or **Month picker** (default = current Manila month).
- Search by AR number, student/prospect name, reference number.
- Sortable headers on Issue Date, Status, Branch, Issued By.

#### Each row

- AR number rendered as **"Acknowledgement Receipt# AR-XXXX"**.
- Student / prospect, package, level tag, **Amount**, branch, status.
- Reference number, attachment (proof image), reject reason if any.
- Issue date and Issued By.

Click a row to view full details, the proof attachment, the linked invoice (if any) and the reject reason. PDF download is available.

> Audit tip: pair AR + Payment Logs filters by **Branch + Date range** to reconcile bank deposits against actual receipts.

---

### Daily Summary Sales

**Menu Path**: **Daily Summary Sales**

#### Purpose

Verify or audit branch admins' **End of Shift (EOD)** and **Cash Deposit Summary** submissions across every branch.

#### Tabs

- **End of Shift** — daily branch closeouts (Submitted → Verified or Returned).
- **Cash Deposit Summary** — periodic cash deposit submissions with proof attachment (Submitted → Approved or Returned).

Each tab includes a **Pending verification** view (Submitted) and a **Returned** view.

#### Filters

- **Branch**, **Status**.
- **From / To** + **Month picker** (default = current Manila month).

#### Verifying

1. Open a Submitted row to view the recalculated payment list and totals.
2. **End of Shift** — confirm cash on hand, payment count and total amount match the submission. Approve or Return with a reason.
3. **Cash Deposit Summary** — confirm the listed cash payments match the deposit slip. The modal shows live recalculated rows; if the live recalc returns nothing (e.g. payments were deleted after submission), it falls back to the **original audit snapshot** with an amber notice. Use the snapshot to validate the original deposit.
4. Click **Verify** / **Approve**, or **Return** with a clear reason.

#### EOD email digest

You **no longer receive** the EOD digest by email. Use this page to monitor submissions instead.

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

---

## Document Information

**Version**: 1.3
**Last Updated**: May 11, 2026
**Role**: Superfinance
**System**: Physical School Management System
**Organization**: Little Champions Academy Inc.

### Change log

- **v1.3 (May 11, 2026)** — Added the Reject action with mandatory reason and Rejected tab, the editable Payment Date in the Payment Status modal, the optional Discount Amount on Record Payment, the Daily Summary Sales page, three date-filter modes, debounced server-side search and sortable columns. Removed the EOD email digest for Superfinance.
- **v1.2 (January 29, 2026)** — Earlier baseline.

