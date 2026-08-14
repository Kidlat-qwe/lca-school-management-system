# Student full-payment invoices

Staff Student History loader for **full payment** settlements. Installment phase invoices stay on the Installment tab (`InstallmentPlanDetails`).

## Entry point

`GET /api/sms/invoices/student/:studentId/full-payment`

- Auth: Firebase token + branch access
- Roles: Superadmin, Admin, Finance (including Superfinance)
- Profile access: `assertCanViewStudentUserProfile`

## Included invoices

`installmentinvoiceprofiles_id` is null, not cancelled, not reservation/downpayment, not installment-generated (`TARGET_PHASE`, auto/manual installment remarks), **and** any of:

- Remarks contain `PACKAGE_CHANGE_TO_FULLPAYMENT` (installment → full payment conversion)
- Description contains fullpayment / full payment
- Linked package `package_type` or `payment_option` is `fullpayment`
- Remarks include `CLASS_ID` plus `PHASE_START` / `PHASE_END` (native full-payment enrollment)

Zero-balance conversions **without** a conversion invoice stay on the Installment tab (`Inactive · Upgraded to Full Payment`).

## Settlement card fields

Package, class, program, branch, level, phase coverage, invoice ID / AR#, issued / due / paid on, amount / paid / remaining, line items (credits as discounts), payments, compact enrollment phases, merchandise pending or release log.

PDF: existing `GET /invoices/:id/pdf` and `?doc_type=ar`.
