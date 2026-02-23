# Finance Approval – User Guide

This guide explains how to **approve (and revoke) payments** in Payment Logs and how that affects the **Payment Status** shown in the Classes → Students view.

---

## 1. What Finance Approval Is

- Payments recorded in the system can be marked as **Approved** or left as **Pending Approval**.
- **Approval** is an internal check: Finance (or Superadmin/Superfinance) confirms that the payment was actually received (e.g. bank/cash verified).
- Approving a payment **does not** change whether the student is enrolled or how invoices are paid in the system; it only updates the **approval status** used for reporting and for the **Verified** / **Not Verified** badge in the Students list.

---

## 2. Who Can Approve Payments

| Role | Can approve payments? | Scope |
|------|------------------------|--------|
| **Superadmin** | Yes | All branches |
| **Superfinance** | Yes | All branches (Finance with no branch) |
| **Finance** | Yes | Only their own branch |
| **Admin** | No | Can only see Payment Status (Verified / Not Verified) in the Students modal |

---

## 3. Where to Approve Payments

1. Log in as **Superadmin**, **Superfinance**, or **Finance** (with branch).
2. Go to **Payment Logs** (path depends on role, e.g. Superadmin → Payment Logs, or Finance → Payment Logs).
3. In the table, find the **Payment Status** column.
4. Each cell shows either:
   - **Pending Approval** (e.g. yellow badge), or  
   - **Approved** (e.g. green badge).
5. **Click the Payment Status** badge for the payment you want to approve or revoke.

---

## 4. How to Approve a Payment

1. In **Payment Logs**, find the payment with status **Pending Approval**.
2. **Click** the **Pending Approval** badge.
3. In the dropdown, click **Approve**.
4. The status changes to **Approved** and the badge turns green.  
   The system records who approved it and when.

---

## 5. How to Revoke an Approval

1. In **Payment Logs**, find the payment with status **Approved**.
2. **Click** the **Approved** badge.
3. In the dropdown, click **Revoke approval**.
4. The status returns to **Pending Approval** and the badge returns to yellow.  
   Approved-by and approved-at are cleared.

---

## 6. What “Verified” and “Not Verified” Mean (Classes → Students)

In **Classes** → **View Students** (Superadmin or Admin), each student has a **Payment** column:

| Display | Meaning |
|--------|--------|
| **Verified** | All completed payments that count for this class have been **Approved** in Payment Logs. |
| **Not verified** | At least one completed payment for this class is still **Pending Approval** (or not approved). |

- **Verified** is shown with a green-style badge (e.g. checkmark).
- **Not verified** is shown with an amber-style badge and may highlight the row so it’s easy to spot.

**Installment students:** Downpayment and each phase payment are checked separately. The student is **Verified** only when every relevant completed payment is **Approved**.

---

## 7. Typical Workflow

1. **Payment is recorded**  
   Invoice/payment is added (e.g. from enrollment or manual entry). Payment appears in Payment Logs as **Pending Approval**.

2. **Finance checks actual receipt**  
   Finance (or Superadmin/Superfinance) checks bank/cash and confirms the payment was received.

3. **Finance approves in Payment Logs**  
   In Payment Logs, they click the **Pending Approval** badge and choose **Approve**.

4. **Students modal reflects it**  
   In Classes → View Students, that student’s **Payment** column can now show **Verified** (once all relevant payments for that class are approved).

5. **If approval was wrong**  
   In Payment Logs, click **Approved** → **Revoke approval**. The student will show as **Not verified** again when the list is refreshed.

---

## 8. Important Notes

- **Admin** users cannot approve payments; they can only see Verified / Not Verified in the Students modal.
- If a student has **no** payment records (e.g. manually enrolled), they will show as **Not verified**.
- Approval does **not** change invoice status, enrollment status, or auto-enrollment logic; it only affects the approval flag and the Verified/Not Verified display.

For technical details (API endpoints, database fields, exact logic), see **docs/finance_approval.md**.
