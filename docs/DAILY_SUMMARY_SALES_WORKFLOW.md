# Daily Summary Sales – User Manual Workflow

This document describes how **Branch Admin** submits an end-of-shift daily summary and how **Superadmin** and **Superfinance** verify those submissions for financial closing tracking.

---

## Table of Contents

1. [Overview](#overview)
2. [Roles and Responsibilities](#roles-and-responsibilities)
3. [Branch Admin: Submitting End of Shift](#branch-admin-submitting-end-of-shift)
4. [Superadmin & Superfinance: Verifying Submissions](#superadmin--superfinance-verifying-submissions)
5. [Status Definitions](#status-definitions)
6. [Best Practices](#best-practices)
7. [Troubleshooting](#troubleshooting)

---

## Overview

The **Daily Summary Sales** feature supports end-of-day financial closing:

- **Branch Admin** submits a daily sales summary at end of shift.
- The total amount is **auto-calculated** from Payment Logs for that branch and date.
- **Superadmin** and **Superfinance** review and verify (or flag) each submission.

---

## Roles and Responsibilities

| Role | Can Submit End of Shift | Can Verify Submissions |
|------|--------------------------|------------------------|
| **Branch Admin** | Yes (own branch only) | No |
| **Superadmin** | No | Yes |
| **Superfinance** | No | Yes |
| **Finance** (branch-level) | No | No |

**Note:** Only **Superadmin** and **Superfinance** can verify daily summaries. Branch-level Finance users do not have access to the verification page.

---

## Branch Admin: Submitting End of Shift

### When to Submit

Submit the daily summary at **end of shift** after all payments for the day have been recorded in Payment Logs.

### Where to Submit

**Path:** Manage Invoice → Payment Logs

The **End of Shift** button is on the Payment Logs page.

### Step-by-Step: Submitting End of Shift

1. **Record all payments for the day**
   - Ensure every payment received today is recorded in Payment Logs.
   - Verify amounts, reference numbers, and invoice links.

2. **Open Payment Logs**
   - Go to **Manage Invoice** → **Payment Logs**.

3. **Click "End of Shift"**
   - The button is near the top of the Payment Logs page.
   - If you have already submitted for today, the button is disabled.

4. **Review the preview modal**
   - The system shows:
     - Today’s total amount (from Payment Logs).
     - Number of payments included.
     - List of payment records (invoice, student, method, amount, reference).
   - If there are no payments for today, the total will be ₱0.00 (0 payments).

5. **Confirm and submit**
   - Click **Submit** to send the daily summary.
   - Or click **Cancel** to close without submitting.

6. **Confirmation**
   - A success message appears: *"Daily summary submitted successfully. Superadmin and Superfinance will verify your submission."*
   - The **End of Shift** button is disabled for the rest of the day.

### Important Rules for Branch Admin

- You can submit **only for today’s date** (Manila timezone).
- You can submit **only once per day** per branch.
- The amount is **auto-calculated** from Payment Logs; you cannot edit it.
- If you resubmit for the same day (e.g. after correcting a payment), the system updates the existing record with the new total and payment count.

---

## Superadmin & Superfinance: Verifying Submissions

### Where to Verify

**Path:** Daily Summary Sales (main menu)

- **Superadmin:** Daily Summary Sales → `/superadmin/daily-summary-sales`
- **Superfinance:** Daily Summary Sales → `/superfinance/daily-summary-sales`

### Step-by-Step: Verifying a Submission

1. **Open Daily Summary Sales**
   - Click **Daily Summary Sales** in the sidebar.

2. **Filter the list (optional)**
   - **Branch:** Filter by branch.
   - **Status:** Submitted / Verified / Flagged.
   - **Date:** Filter by summary date.

3. **Review the table**
   - Each row shows:
     - Branch
     - Date
     - Total amount
     - Payment count
     - Status (Submitted / Verified / Flagged)
     - Submitted by
     - Approved by (if verified or flagged)

4. **View details**
   - Click the **three-dots (⋮)** menu on a row.
   - Select **View details**.
   - The modal shows:
     - Branch, date, total amount, payment count.
     - Status, submitted by, submitted at.
     - Verified by, verified at (if applicable).
     - Full list of payment records (invoice, student, method, amount, reference).

5. **Verify or flag**
   - For rows with status **Submitted**, the menu shows:
     - **Verify** – approve the submission.
     - **Flag for review** – mark for follow-up.

### Verify (Approve)

1. Click **Verify** from the three-dots menu.
2. A **Verify daily summary** modal opens with:
   - Branch, date, total amount, payment count.
   - Table of payment records.
3. Cross-check the payment list with your records (e.g. bank deposits, cash count).
4. Click **Verify** to approve.
5. Status changes to **Verified** and your name appears in **Approved By**.

### Flag for Review

1. Click **Flag for review** from the three-dots menu.
2. A modal opens with an optional **Reason** field.
3. Enter a reason (e.g. *"Discrepancy to clarify with branch admin"*).
4. Click **Flag for review**.
5. Status changes to **Flagged** and your name appears in **Approved By**.

### What to Check When Verifying

- **Total amount** matches expected deposits for that branch and date.
- **Payment count** matches the number of transactions.
- **Payment records** list matches Payment Logs for that date.
- **Reference numbers** are present for non-cash payments.
- No obvious duplicates or missing payments.

---

## Status Definitions

| Status | Meaning |
|--------|---------|
| **Submitted** | Branch Admin has submitted; awaiting verification. |
| **Verified** | Superadmin or Superfinance has approved the submission. |
| **Flagged** | Superadmin or Superfinance has flagged it for review (e.g. discrepancy). |

---

## Best Practices

### For Branch Admin

1. **Submit at end of shift** – after all payments are recorded.
2. **Verify payments first** – ensure all today’s payments are in Payment Logs before submitting.
3. **Check the preview** – confirm the total and payment list before submitting.
4. **One submission per day** – the system allows only one submission per branch per day.

### For Superadmin & Superfinance

1. **Verify daily** – review submissions soon after they are submitted.
2. **Use filters** – filter by status **Submitted** to see pending items.
3. **Check payment details** – open **View details** or **Verify** to review the payment list.
4. **Add clear remarks when flagging** – explain what needs to be clarified.
5. **Follow up on flagged items** – contact the branch admin to resolve issues.

---

## Troubleshooting

### Branch Admin

**Problem:** "End of Shift" button is disabled.

- **Cause:** You have already submitted for today.
- **Solution:** No action needed. One submission per day per branch is allowed.

**Problem:** Total amount in preview is wrong.

- **Cause:** Amount comes from Payment Logs for today. A payment may be missing or incorrect.
- **Solution:** Add or correct the payment in Payment Logs, then submit again (the system will update the existing summary).

**Problem:** Cannot submit – "You can only submit for today".

- **Cause:** The system uses Manila timezone. You may be trying to submit for a different date.
- **Solution:** Submit only for the current date in Manila time.

### Superadmin & Superfinance

**Problem:** Cannot verify – "Cannot change verification. Current status: Verified/Flagged".

- **Cause:** The submission has already been verified or flagged.
- **Solution:** No further action. Use **View details** to see who verified and when.

**Problem:** Payment records list is empty but total is not zero.

- **Cause:** Possible data inconsistency.
- **Solution:** Flag for review and contact technical support or the branch admin.

**Problem:** Need to see which branch admin submitted.

- **Solution:** Check the **Submitted By** column or the **View details** modal.

---

## Summary Flowchart

```
┌─────────────────────────────────────────────────────────────────────────┐
│ BRANCH ADMIN (End of Shift)                                              │
├─────────────────────────────────────────────────────────────────────────┤
│ 1. Record all payments in Payment Logs                                   │
│ 2. Go to Manage Invoice → Payment Logs                                   │
│ 3. Click "End of Shift"                                                  │
│ 4. Review preview (total, payment count, payment list)                   │
│ 5. Click Submit                                                          │
│ 6. Status: Submitted                                                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ SUPERADMIN / SUPERFINANCE (Verification)                                 │
├─────────────────────────────────────────────────────────────────────────┤
│ 1. Go to Daily Summary Sales                                             │
│ 2. Filter by Branch, Status (Submitted), Date                           │
│ 3. Click three-dots (⋮) on a Submitted row                              │
│ 4. Choose:                                                               │
│    • View details – review summary and payment list                      │
│    • Verify – approve (status → Verified)                               │
│    • Flag for review – add reason (status → Flagged)                     │
│ 5. If Verify: confirm payment list matches records, click Verify        │
│ 6. If Flag: enter reason, click Flag for review                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

*Last updated: March 2025*
