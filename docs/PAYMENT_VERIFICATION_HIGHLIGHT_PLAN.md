# Payment Verification Highlight – Implementation Plan

## 1. Client Requirements Summary

### 1.1 Business Rules (Unchanged)
- **Enrollment is independent of verification**: Students can attend class as soon as they pay:
  - **Installment**: Downpayment + first phase payment → enrolled
  - **Full payment**: Full tuition paid → enrolled
- Verification (Superadmin/Finance/Superfinance approval) does **not** block enrollment.

### 1.2 New Requirement: Visual Indicator
- **Highlight** when a student's payment status is **not yet verified**
- Must be **easy to notice** so staff can prioritize verification

### 1.3 Per-Payment Verification (Installment)
- **Installment students**: Each payment is verified **separately** – downpayment and Phase 1 are **not** combined
- **Downpayment**: Has its own invoice and payment(s). Must be approved individually in Payment Logs.
- **Phase 1**: Has its own invoice and payment(s). Must be approved individually in Payment Logs.
- **Phase 2, 3, …**: Same – each phase has its own invoice and payment(s), each verified separately.
- If downpayment paid but **not** verified → highlight
- If Phase 1 paid but **not** verified → highlight (even if downpayment is verified)
- If Phase 2 paid but **not** verified → highlight
- Student is **Verified** only when **all** payments (downpayment + every paid phase) are Approved.

### 1.4 Full Payment
- Same logic: full tuition paid → enrolled
- If payment is not verified → show highlight

---

## 2. Verification Logic (Updated)

### 2.1 Current Logic (from finance_approval.md)
- Student is **Verified** when: **any** Completed + Approved payment exists
- Result: One verified payment = entire student verified

### 2.2 New Logic (Client Requirement)
- Student is **Verified** when: **all** Completed payments (for this class context) are Approved
- Student is **Not Verified** when: **at least one** Completed payment is not Approved

| Scenario | Result |
|----------|--------|
| Downpayment paid, not verified | **Not Verified** (highlight) |
| Downpayment verified, Phase 1 not paid yet | N/A (pending) |
| Downpayment + Phase 1 paid, both verified | Verified |
| Downpayment + Phase 1 paid, Phase 1 not verified | **Not Verified** (highlight) |
| Downpayment + Phase 1 paid, downpayment not verified | **Not Verified** (highlight) |
| Downpayment + Phase 1 + 2 paid, Phase 2 not verified | **Not Verified** (highlight) |
| All paid phases verified | Verified |
| Full payment paid, not verified | **Not Verified** (highlight) |
| No payments | Not Verified |

---

## 3. “Relevant Payments” for a Student in a Class

### 3.1 Enrolled Students (Installment)
- **Source**: `installmentinvoiceprofilestbl` (`class_id`, `student_id`)
- **Invoices** (each verified separately):
  - **Downpayment**: `downpayment_invoice_id` – separate invoice
  - **Phase 1**: First phase invoice – separate invoice
  - **Phase 2, 3, …**: Phase invoices with `installmentinvoiceprofiles_id` from that profile
- **Payments**: All `paymenttbl` rows where:
  - `student_id` = student
  - `invoice_id` IN (downpayment + phase invoices for this class)
  - `status` = 'Completed'

### 3.2 Enrolled Students (Full Payment)
- **Source**: `invoicestbl` with `remarks` containing `CLASS_ID:{classId}`
- **Invoices**: `invoicestudentstbl` links student to invoice
- **Payments**: `paymenttbl` where `invoice_id` IN those invoices, `status` = 'Completed'

### 3.3 Pending Students (Downpayment Paid, Phase 1 Not Paid)
- **Source**: `installmentinvoiceprofilestbl` (`class_id`, `student_id`), not yet in `classstudentstbl`
- **Invoices**: Downpayment + any phase invoices already created
- **Payments**: Same as 3.1

### 3.4 Reserved Students
- **Source**: `reservedstudentstbl` (`class_id`, `student_id`)
- **Invoices**: Reservation fee invoice
- **Payments**: For reservation fee invoice only

---

## 4. Backend Implementation

### 4.1 Endpoint
`GET /api/sms/students/class/:classId` (existing)

### 4.2 Changes
After fetching enrolled + pending + reserved students, for each student:

1. **Determine relevant invoices**:
   - Installment: from `installmentinvoiceprofilestbl` + downpayment + phase invoices
   - Full: invoices with `CLASS_ID:{classId}` in remarks
   - Reserved: reservation fee invoice

2. **Find Completed payments** for those invoices:
   ```sql
   SELECT p.payment_id, p.approval_status
   FROM paymenttbl p
   WHERE p.student_id = $studentId
     AND p.invoice_id IN ($relevantInvoiceIds)
     AND p.status = 'Completed'
   ```

3. **Compute verification**:
   - If **no** Completed payments → `is_payment_verified = false` (no payments to verify)
   - If **any** Completed payment has `approval_status != 'Approved'` or NULL → `is_payment_verified = false`
   - If **all** Completed payments have `approval_status = 'Approved'` → `is_payment_verified = true`

4. **Add to response**:
   - `is_payment_verified`: boolean
   - `payment_verification_status`: `'Verified'` or `'Not Verified'`
   - Optional: `unverified_payment_count` for UI tooltip

### 4.3 Branch Scoping
- If class has `branch_id`, restrict payments to `branch_id` (or NULL) same as current logic

---

## 5. Frontend Implementation

### 5.1 Where to Show
- **Superadmin**: Classes → View Students modal
- **Admin**: Admin Classes → View Students modal
- No change for Teacher/Student views (they don’t need verification status)

### 5.2 New Column
- **PAYMENT STATUS**: Badge “Verified” (green) or “Not Verified” (highlighted)

### 5.3 Highlight for “Not Verified”
Client wants something **easy to notice**:

| Option | Description |
|--------|-------------|
| A | Row background: light yellow/amber (`bg-amber-50`) |
| B | Left border accent (`border-l-4 border-amber-500`) |
| C | Badge with warning icon + “Not Verified” |
| D | Combination: badge + subtle row background |

**Recommendation**: Use **Option D** – badge + row background.

### 5.4 UI Mockup
- **Verified**: Normal row, green badge “Verified”
- **Not Verified**: 
  - Row: `bg-amber-50` or `bg-yellow-50`
  - Left border: `border-l-4 border-amber-500`
  - Badge: “Not Verified” with warning icon, `bg-amber-100 text-amber-800`

### 5.5 Optional Tooltip
- “X payment(s) pending verification” when `unverified_payment_count > 0`

---

## 6. Data Model (No New Tables)

- `paymenttbl`: `approval_status`, `approved_by`, `approved_at` (already exist)
- `invoicestbl`: `remarks` (CLASS_ID), `installmentinvoiceprofiles_id`
- `installmentinvoiceprofilestbl`: `class_id`, `downpayment_invoice_id`
- `installmentinvoicestbl`: links to invoices via profile

---

## 7. Implementation Tasks

### Phase 1: Backend
1. [ ] Add helper to resolve “relevant invoices” for a student in a class (installment, full, reserved)
2. [ ] Add helper to get Completed payments for those invoices
3. [ ] Compute `is_payment_verified` and `payment_verification_status` per student
4. [ ] Extend `GET /students/class/:classId` response with these fields
5. [ ] Unit/integration tests for verification logic

### Phase 2: Frontend
1. [ ] Add PAYMENT STATUS column to Students modal (Classes.jsx, adminClasses.jsx)
2. [ ] Render Verified/Not Verified badge
3. [ ] Add row highlight (background + border) for Not Verified
4. [ ] Optional: tooltip with unverified count

### Phase 3: Documentation
1. [ ] Update `docs/finance_approval.md` with new per-payment verification logic
2. [ ] Add this plan to docs index

---

## 8. Edge Cases

| Case | Behavior |
|------|----------|
| Manually enrolled (no payment) | Not Verified, highlight |
| Partial payment (Full) | Not Verified until full amount paid and verified |
| Multiple payments for same invoice | All must be Approved |
| Payment approval revoked | Student becomes Not Verified on next load |
| Reserved, fee not paid | Not Verified (or N/A if no payment expected yet) |

---

## 9. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Performance: many invoices per student | Use single query with JOINs; add indexes if needed |
| Complex invoice resolution | Use clear helper functions and comments |
| Reserved vs enrolled mismatch | Use same verification logic for all student types |

---

## 10. Summary

- **Logic**: Student is Verified only when **all** Completed payments (for class context) are Approved.
- **Installment**: Downpayment and Phase 1 (and each phase) are verified **separately** – each has its own invoice and payment(s), each must be Approved in Payment Logs.
- **UI**: Clear “Not Verified” state with badge + row highlight.
- **Scope**: Classes → View Students modal (Superadmin, Admin).
- **No change**: Enrollment rules, payment recording, or approval workflow.
