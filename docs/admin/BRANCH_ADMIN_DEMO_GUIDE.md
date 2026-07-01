# Branch Admin — Live Demonstration Guide

**Audience:** Branch Admin users  
**Purpose:** Step-by-step script for a short system demonstration  
**Companion:** [BRANCH_ADMIN_DEMO_QUICK_REFERENCE.md](./BRANCH_ADMIN_DEMO_QUICK_REFERENCE.md)

---

## Before you present

### Demo accounts

| Account | Role | Used for |
|---------|------|----------|
| `admin@…` (branch assigned) | **Branch Admin** | Main demo |
| `superfinance@…` or `finance@…` | Verifier | Optional: approve EOD or cash deposit |

### Pre-load data (recommended)

Do this **before** the live session so the demo stays fast:

- [ ] At least one **Program**, **Room**, **Package** (Full payment + Installment if showing both)
- [ ] One **Teacher** and one **Finance** user under **Personnel**
- [ ] One **Student** + **Guardian**
- [ ] One **Class** with schedule and capacity
- [ ] Optional: one **Promo** code for enrollment

### What Admin can and cannot do

**Can:** Everything for **one branch** — users, classes, enrollment, invoices, payments, EOD, cash deposit.  
**Cannot:** Other branches, create branches, create Admin/Superadmin users, verify own EOD/cash deposit.

---

## Part 1 — Login and daily starting point

*Start here for every demo.*

### 1.1 Log in

1. Open the school URL.
2. Enter Branch Admin email and password → **Login**.
3. You land on **Monthly Operational Dashboard** (`/admin/monthly-operational-dashboard`).

**Say:** *“Each branch admin only sees their branch. The dashboard defaults to this month in Manila time.”*

### 1.2 Cash holding alert (if shown)

If undeposited cash is above the threshold (default ₱100,000):

- An alert appears on login.
- Click **Go to Cash Deposit** → opens **Payment Logs** deposit flow (Part 4).

**Say:** *“The system reminds us when too much cash is still on hand before bank deposit.”*

### 1.3 Morning check (2–3 minutes)

| Step | Menu | What to show |
|------|------|----------------|
| 1 | **Dashboard → Daily Operational Dashboard** | Today’s operations snapshot |
| 2 | **Dashboard → Financial Dashboard** | Revenue / billing for the month |
| 3 | **Calendar** | Today’s class sessions |
| 4 | **Announcements** | Branch notices (if any) |

**Say:** *“Before enrollments and payments, admin checks the calendar and any open invoices from the financial view.”*

---

## Part 2 — Branch setup (greenfield or walkthrough)

*Skip this part if data is pre-loaded; use it when showing a new branch setup.*

### 2.1 Catalog and rooms

| Order | Page | Action |
|-------|------|--------|
| 1 | **Room** (`/admin/room`) | Add classroom |
| 2 | **Curriculum** | Add curriculum level (if needed) |
| 3 | **Program** | Add program linked to curriculum |
| 4 | **Package** | Create Full payment and/or Installment package |
| 5 | **Pricing List** | Optional per-phase pricing without package |
| 6 | **Merchandise** | Uniforms, kits (used in packages) |
| 7 | **Promo** | Optional discount codes |

**Say:** *“Packages drive enrollment — full payment enrolls all phases when paid; installment uses downpayment then monthly invoices.”*

### 2.2 People

| Page | Action |
|------|--------|
| **Personnel** | Add **Teacher** and **Finance** (Admin cannot create another Admin) |
| **Student** | Create student profile |
| **Guardians** | Link parent/guardian to student |

### 2.3 Class

1. Go to **Classes** → **Create Class**.
2. Fill: program, room, teacher(s), dates, capacity, weekly schedule.
3. Save → system generates sessions.

**Say:** *“Classes are the center of enrollment — every student is enrolled into a class and package.”*

---

## Part 3 — Enrollment and payment (core workflow)

### 3.1 Full payment enrollment (most common demo)

| Step | Where | Action |
|------|-------|--------|
| 1 | **Classes** | Open class → **Enroll Student** |
| 2 | Wizard | Choose **Package** → Full payment package |
| 3 | Wizard | Select student, promo (optional), merchandise sizes |
| 4 | Wizard | Confirm → **Successfully enrolled** message |
| 5 | System | Creates invoice(s) — status **Unpaid** until paid |

**Say:** *“Enrollment creates the invoice first. The student is fully enrolled in all phases only after the invoice is paid.”*

### 3.2 Record payment (closes invoice + enrolls)

| Step | Where | Action |
|------|-------|--------|
| 1 | **Invoice** (`/admin/invoice`) | Find the new invoice → **Pay** |
| 2 | Modal | Payment method, amount, reference, attachment (optional), issue date |
| 3 | Submit | Payment recorded → invoice **Paid** |
| 4 | **Classes** → **View Students** | Student appears enrolled; payment column shows verification state |

**Say:** *“We record payment on the invoice. Finance will verify on Payment Logs — until then status may show Pending Approval.”*

### 3.3 Installment enrollment (short variant)

| Step | Action |
|------|--------|
| 1 | Enroll with **Installment** package |
| 2 | Pay **downpayment** invoice → student shows **Pending (Downpayment Paid)** |
| 3 | Pay **first monthly** installment → enrolled in **Phase 1** |
| 4 | **Installment Invoice** page tracks upcoming phase invoices |

### 3.4 Reservation → upgrade (optional)

| Step | Action |
|------|--------|
| 1 | **Classes** → **Reserve Student** → reservation fee invoice |
| 2 | Pay reservation fee → status **Fee Paid** |
| 3 | **View Reserved** → **Upgrade to Enrollment** (promo allowed) |
| 4 | Pay enrollment invoice → full enrollment |

---

## Part 4 — Payment Logs and Finance interaction

### 4.1 Payment Logs overview

**Path:** **Manage Invoice → Payment Logs** (`/admin/payment-logs`)

Show:

- **Month / Payment date / Date created** filters (one mode at a time)
- Status column: **Pending Approval**, **Approved**, etc.
- Tabs: **All**, **Returned**, **Rejected**

**Say:** *“Every payment lands here. Finance verifies references and attachments. Rejected payments are excluded from dashboards and EOD.”*

### 4.2 Returned payment (Admin fixes)

1. Open **Returned** tab.
2. Open returned row → read Finance note.
3. Fix reference or attachment → **Resubmit for verification**.

### 4.3 Rejected payment

1. **Rejected** tab → **View details** → **Go to invoice**.
2. Record a **new** payment on the same invoice (enrollment is not removed).

### 4.4 Acknowledgement Receipts (optional segment)

**Path:** `/admin/acknowledgement-receipts`

- **Package AR** — tracks reservation / downpayment before invoice apply.
- **Merchandise AR** — Admin creates; pay linked invoice; stock deducts on full pay.

See [../AR_MERCHANDISE_WORKFLOW.md](../AR_MERCHANDISE_WORKFLOW.md).

---

## Part 5 — End of Shift (EOD)

*Do this at the **end of the business day** demo segment.*

### 5.1 When to submit

- After **all payments for the day** are recorded in Payment Logs.
- One submission **per branch per calendar day** (catch up pending dates if you missed days).

### 5.2 Steps

| Step | Action |
|------|--------|
| 1 | Go to **Payment Logs** |
| 2 | Click **End of Shift** (or header **End of Shift** shortcut) |
| 3 | Review preview: total amount, payment count, line list |
| 4 | Confirm date (today or oldest pending date) |
| 5 | **Submit** → status **Submitted** |

**Say:** *“Totals are automatic from Payment Logs — we don’t type the sales total. Superadmin, Finance, or Superfinance verifies on their Daily Summary Sales page.”*

### 5.3 Track submission

**Path:** **Daily Summary Sales** → **End of Shift** tab (`/admin/daily-summary-sales`)

| Status | Admin action |
|--------|----------------|
| Submitted | Wait for verifier |
| Returned | Fix issue → **Resubmit** |
| Approved | Done for that date |

---

## Part 6 — Cash deposit

*Separate from EOD — when physical cash is deposited at the bank.*

### 6.1 When to submit

- When branch cash on hand should be deposited.
- Alert on login if holding ≥ threshold (Settings).

### 6.2 Steps

| Step | Action |
|------|--------|
| 1 | **Payment Logs** → **Deposit Cash** |
| 2 | Review **From** date (locked after last deposit) and **To** date (editable, max today) |
| 3 | Review cash payment lines in the preview |
| 4 | Enter **bank reference number** |
| 5 | Upload **deposit proof** image |
| 6 | **Submit** → status **Pending** |

**Say:** *“Cash deposit is only for cash payments in the date range. Superfinance approves it — not the same as End of Shift.”*

### 6.3 Track deposit

**Path:** **Daily Summary Sales** → **Cash Deposit Summary** tab

| Status | Admin action |
|--------|----------------|
| Pending | Wait for Superfinance |
| Returned | Update reference/proof → **Resubmit** |
| Approved | Cash payments sync as approved on Payment Logs |

---

## Part 7 — Full day storyline (5–15 minute script)

Use this order for a single continuous demo:

| # | Segment | Time |
|---|---------|------|
| 1 | Login → Monthly Dashboard → Calendar | 1 min |
| 2 | Classes → Enroll student (full payment) | 3 min |
| 3 | Invoice → Pay → Classes verify enrolled | 2 min |
| 4 | Payment Logs → show Pending Approval | 1 min |
| 5 | End of Shift → submit preview | 2 min |
| 6 | Deposit Cash → show modal (submit optional) | 2 min |
| 7 | Daily Summary Sales → both tabs | 1 min |
| 8 | *(Optional second login)* Superfinance approves EOD/deposit | 2 min |

**Closing line:** *“Branch admin runs the branch all day; Finance and Superfinance close the loop on payments, end-of-shift, and cash deposit.”*

---

## Troubleshooting during demo

| Issue | What to say / do |
|-------|------------------|
| Invoice not visible | Check **Month** filter on Invoice page; new invoices are **Unpaid** |
| Student not enrolled after “success” | Invoice still **Unpaid** — record payment on Invoice page |
| End of Shift button disabled | Already submitted for that date — check Daily Summary Sales |
| Deposit From date locked | Expected — continues from last deposit end date |
| Payment missing from EOD total | Rejected payments excluded; ensure payment is **Completed** and not rejected |

---

## Related documentation

- [USER_MANUAL_ADMIN.md](../USER_MANUAL_ADMIN.md) — full feature reference  
- [DAILY_SUMMARY_SALES_WORKFLOW.md](../DAILY_SUMMARY_SALES_WORKFLOW.md) — EOD details  
- [FINANCE_APPROVAL_GUIDE.md](../FINANCE_APPROVAL_GUIDE.md) — payment verification  

---

*Document version: 1.0 — Branch Admin demonstration guide (login through EOD and cash deposit).*
