### Payment Logs & Student Payment Status – Documentation

This document explains the new payment-approval flow in **Payment Logs** and how it affects the **Students modal** under the Classes page.

---

## 1. Roles and Permissions

**Who can approve payments (Payment Logs):**

- `Superadmin`
- `Superfinance`
- `Finance`

**Scope:**

- `Superadmin`: can approve payments for **all branches**.
- `Superfinance`: can approve payments for **all branches** (Finance role with no branch assigned).
- `Finance`: can approve payments **only for their own branch** (their `branch_id`).

---

## 2. Payment Logs – Payment Status & Approval

### 2.1. Columns

In all Payment Logs pages (Superadmin, Admin, Finance, Superfinance):

- **Payment Status (column)**  
  - Shows an approval badge:
    - `Pending Approval` (yellow)
    - `Approved` (green)
  - The badge is **clickable** for users with permission (Superadmin / Superfinance / Finance-as-branch).

- **Transaction status filter (in header)**
  - The header still has a filter for invoice payment `status` (e.g. `Completed`), but the **cell** itself shows the **approval status**.

### 2.2. Approving / Revoking

When you click the **Payment Status** badge:

- If the payment is **Pending Approval**:
  - A small dropdown opens with:
    - `Approve`
  - Clicking `Approve`:
    - Calls `PUT /api/sms/payments/:id/approve` with `approve: true`.
    - Updates the payment row to:
      - `approval_status = 'Approved'`
      - `approved_by = current user`
      - `approved_at = current timestamp`
    - UI badge changes to `Approved`.

- If the payment is **Approved**:
  - Dropdown shows:
    - `Revoke approval`
  - Clicking `Revoke approval`:
    - Calls `PUT /api/sms/payments/:id/approve` with `approve: false`.
    - Resets:
      - `approval_status = 'Pending'`
      - `approved_by = NULL`
      - `approved_at = NULL`
    - UI badge returns to `Pending Approval`.

**Important:**

- This **approval** is an **internal control** for Finance/Superfinance/Superadmin to confirm that the payment was actually received/claimed.
- It **does not change**:
  - The student’s invoice payment status (e.g. `Paid`, `Completed`).
  - Whether the student is enrolled or not.
  - Any auto-enrollment logic tied to invoices.

---

## 3. Student Payment Status in Classes → Students Modal

### 3.1. Where this appears

- **Superadmin**: `Classes` → Student list modal (`View Students` → Students – All Phases / Phase N).
- **Admin**: `Admin Classes` → Student list modal (same flow).

In the **Students** modal table you now see:

- `STUDENT NAME`
- `EMAIL`
- `STATUS`  
  (Enrolled / Pending (Downpayment Paid) / Reserved, etc.)
- `PAYMENT STATUS`  **← new**
- `LEVEL TAG / PACKAGE`
- `PHASE`
- `DATE`
- `ENROLLED BY`

### 3.2. Payment Status column (Students modal)

For each student row, the backend now returns:

- `is_payment_verified` (boolean)
- `payment_verification_status` (`Verified` or `Not Verified`)

The **Payment Status** cell displays:

- If `is_payment_verified === true`:
  - Badge: `Verified` (with checkmark icon)
  - Style: light green (`bg-green-50 text-green-700`)
- If `is_payment_verified !== true`:
  - Badge: `Not Verified` (with warning icon)
  - Style: amber (`bg-amber-100 text-amber-800`)
  - Tooltip: "X payment(s) pending verification" when applicable

### 3.3. When is a student considered Verified?

A student is considered **Verified** when **all** Completed payments (for this class context) are Approved.

- **Per-payment verification**: Each payment must be approved individually in Payment Logs.
- **Installment students**: Downpayment and Phase 1 (and each phase) are verified **separately** – each has its own invoice and payment(s), each must be Approved.
- **Full payment**: The full tuition payment must be Approved.

**Logic**: Student is **Not Verified** when at least one Completed payment has `approval_status != 'Approved'` or is NULL.

Verification is scoped by branch:

- If the class has a `branch_id`, we check payments:
  - Where `paymenttbl.student_id = student.user_id`, and
  - `paymenttbl.branch_id = class.branch_id` **or** `branch_id` is `NULL`.

If no Completed payments exist (e.g. manually enrolled), the student is **Not Verified**.

### 3.4. Row styling – highlight for Not Verified

To make unverified payments easy to notice:

- For each student row in the modal:
  - If `is_payment_verified !== true`, the row is rendered with:
    - `bg-amber-50` (light amber background)
    - `border-l-4 border-l-amber-500` (left accent border)
  - If `is_payment_verified === true`, row is normal.

**This means:**

- **Verified** students:
  - Normal row.
  - Green `Verified` badge.
- **Not Verified** students:
  - Amber-highlighted row (easy to notice).
  - Amber `Not Verified` badge with warning icon.

This applies to:

- Fully enrolled students.
- Pending students (e.g. `Pending (Downpayment Paid)`).
- Reserved students (reservation fee payment verification).

---

## 4. Behavioral Summary for Finance Workflow

1. **Student pays / payment recorded**
   - Invoice/payment processing works as before:
     - Payment row created in `paymenttbl`.
     - Invoice status updated.
     - Auto-enrollment logic (for classes) may run depending on invoice type.

2. **Finance/Superfinance/Superadmin review Payment Logs**
   - Column `Payment Status` shows `Pending Approval` initially.
   - Finance verifies with actual bank/cash data.
   - If correct, they click and **Approve**.

3. **Effect on Classes → Students modal**
   - Once at least one `Completed + Approved` payment exists for that student:
     - `is_payment_verified = true` for that student in class-level student lists.
     - In the Students modal:
       - `Payment Status` shows `Verified`.
       - Row is no longer highlighted (full opacity).

4. **If approval is revoked**
   - Payment Logs: Payment Status returns to `Pending Approval`.
   - Next time the Students modal is loaded:
     - Backend no longer sees `Approved` payments.
     - Student shows as `Not Verified` and row is faded again.

---

## 5. Edge Cases & Notes

- **Multiple payments per student (installment):**
  - **All** Completed payments (downpayment, Phase 1, Phase 2, …) must be Approved for the student to be **Verified**.
  - Each payment is verified separately; one unverified payment keeps the highlight.
- **Pending-only payments (no approval):**
  - Student will remain `Not Verified` and highlighted even if invoices are technically `Paid` from the system’s perspective.
- **Admins (role):**
  - Admin users **can’t** approve payments.
  - They **can see** the Payment Status column and whether students are Verified / Not Verified in the Students modal.
- **No payment records:**
  - If a student was manually enrolled or data is inconsistent and no payment exists:
    - They show as `Not Verified`, row highlighted.

---