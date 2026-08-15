# Financial Dashboard — Paid invoice penalties

Module: `backend/lib/financialDashboardPaidInvoicePenalties/`

## Purpose

KPI for **Financial Dashboard** (Superadmin, Admin, Superfinance, Finance):

| Field | Meaning |
|-------|---------|
| `invoice_count` | Distinct **Paid** invoices that have at least one late-penalty line (`invoiceitemstbl.penalty_amount` > 0) |
| `penalty_amount` | Sum of those penalty line amounts (₱) |

## Scope

Same payment-date window as Total Payments / finance metrics:

- Invoice `status = Paid`
- Linked `paymenttbl` rows: `status = Completed`, approval not Returned/Rejected
- Date filter on `paymenttbl.issue_date` (inclusive)
- Optional `branch_id` on invoice/payment branch

Each invoice is counted once even if it has multiple completed payments.

## Used by

| API | Response field |
|-----|----------------|
| `GET /dashboard` | `paid_invoice_penalties` |
| `GET /payments/financial-dashboard-metrics` | `paidInvoicePenaltiesCount`, `paidInvoicePenaltiesAmount` |

## Drill-down (Invoice list)

Financial Dashboard **Penalties** card opens **Invoice** (not Payment Logs), because late penalties are invoice line items:

- `statuses=Paid`
- `has_penalty=1` → `GET /invoices?has_penalty=1` (same penalty + payment-date rules as this KPI)
- `invoice_month=YYYY-MM` (Superadmin / Admin month picker) **or** `payment_date_from` / `payment_date_to` (Finance / Superfinance)

Invoice list header shows **Penalties amount** (from `filterSummary.penaltiesAmount`) beside Total amount so it matches this KPI.

Frontend helper: `frontend/src/utils/invoiceListDeepLink/`.
