# Invoice list deep links

Module: `frontend/src/utils/invoiceListDeepLink/`

## Purpose

Hydrate Invoice list filters from URL query params when opening from Financial Dashboard (and similar cross-links).

## Penalties KPI → Invoice

| Query param | Effect |
|-------------|--------|
| `has_penalty=1` | API `has_penalty=1` — Paid invoices with late-penalty line amounts |
| `statuses=Paid` | Status multi-filter = Paid |
| `invoice_month=YYYY-MM` | Month date mode (same Manila month as dashboard picker) |
| `payment_date_from` / `payment_date_to` | Payment date mode (Finance / Superfinance date range) |

API filter aligns with `backend/lib/financialDashboardPaidInvoicePenalties`: Completed payments by `paymenttbl.issue_date`, approval not Returned/Rejected, `invoiceitemstbl.penalty_amount` > 0.

## Exports

- `parseInvoiceListDeepLinkFromSearchParams(searchParams)`
- `buildPaidInvoicePenaltiesInvoiceListSearchParams({ monthYm, paymentDateFrom, paymentDateTo })`
- `hasInvoicePenaltyDeepLinkParam(searchParams)`
- `parseTruthyQueryFlag(raw)`
