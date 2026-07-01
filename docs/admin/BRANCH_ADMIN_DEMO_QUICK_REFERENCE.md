# Branch Admin Demo — Quick Reference

One-page cheat sheet for live demonstrations.

---

## Login & landing

| Item | Value |
|------|--------|
| Role | Branch Admin |
| Scope | Single assigned branch only |
| Default page after login | **Monthly Operational Dashboard** (`/admin/monthly-operational-dashboard`) |
| Header shortcut | **End of Shift** → Payment Logs with EOD modal |

---

## Main menu → routes

| Menu | Route |
|------|-------|
| Monthly Operational Dashboard | `/admin/monthly-operational-dashboard` |
| Daily Operational Dashboard | `/admin/daily-operational-dashboard` |
| Financial Dashboard | `/admin/financial-dashboard` |
| Calendar | `/admin/calendar` |
| Personnel | `/admin/personnel` |
| Student | `/admin/student` |
| Guardians | `/admin/guardians` |
| Classes | `/admin/classes` |
| Package / Pricing / Merchandise / Promo | `/admin/package`, `/admin/pricinglist`, `/admin/merchandise`, `/admin/promo` |
| Invoice | `/admin/invoice` |
| Installment Invoice | `/admin/installment-invoice` |
| Payment Logs | `/admin/payment-logs` |
| Acknowledgement Receipts | `/admin/acknowledgement-receipts` |
| Daily Summary Sales | `/admin/daily-summary-sales` |
| Settings | `/admin/settings` |

---

## Who does what (after Admin submits)

| Action | Admin | Finance (branch) | Superfinance | Superadmin |
|--------|-------|------------------|--------------|------------|
| Record payment | Yes | Yes | Yes | Yes |
| Return payment for correction | No | Yes | Yes | Yes |
| Reject payment | No | Yes | Yes | Yes |
| Resubmit returned payment | Yes | — | — | — |
| Submit End of Shift (EOD) | Yes | No | No | No |
| Verify EOD | No | Yes | Yes | Yes |
| Submit cash deposit | Yes | No | No | No |
| Verify cash deposit | No | No | Yes | No |

---

## Status words (demo)

| Area | Status | Meaning |
|------|--------|---------|
| Invoice | Unpaid | Bill open — student not fully paid |
| Invoice | Paid | Invoice settled |
| Invoice | Partially Paid | Balance invoice / partial settlement |
| Payment Log | Pending Approval | Waiting for Finance verification |
| Payment Log | Approved | Verified on Payment Logs |
| Payment Log | Returned | Finance sent back — Admin fixes and resubmits |
| Payment Log | Rejected | Permanent — record **new** payment on invoice |
| EOD | Submitted | Admin submitted End of Shift |
| EOD | Approved / Returned | Verifier outcome |
| Cash deposit | Pending | Admin submitted deposit |
| Cash deposit | Approved / Returned | Superfinance outcome |

---

## End of day (two separate actions)

1. **End of Shift** — daily sales close (all payment types in totals)  
   - Where: **Payment Logs** → **End of Shift**  
   - Track: **Daily Summary Sales** → **End of Shift** tab  

2. **Deposit Cash** — physical cash brought to bank  
   - Where: **Payment Logs** → **Deposit Cash**  
   - Requires: reference number + deposit proof image  
   - Track: **Daily Summary Sales** → **Cash Deposit Summary** tab  

---

## Demo pitfalls

- Rejected payments do **not** appear in EOD totals or Financial Dashboard.
- Enrollment stays even if payment is rejected — only the payment is reversed.
- Cash deposit **From** date is locked after the last deposit (continuous periods).
- Pre-seed a class + student before the live demo (`Classes` page is large).
- Use **Invoice → Pay** (not only Payment Logs) for the clearest enrollment demo.
