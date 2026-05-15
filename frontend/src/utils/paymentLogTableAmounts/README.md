# paymentLogTableAmounts

Helpers for **Payment Logs** table columns **Amount** and **Total amount** so discount rows stay consistent across Admin, Superadmin, Finance, and Superfinance.

## Semantics

- **Amount** — “fixed” gross for the line: `payable_amount + discount_amount`. When there is no discount, this equals `payable_amount`.
- **Total amount** — amount after discount (settlement line + tip): `payable_amount + tip_amount`. Discount is not added here so the column reflects net toward the invoice plus optional tip/excess.

## Exports

- `getPaymentLogTableAmountColumn(payment)`
- `getPaymentLogTableTotalAmountColumn(payment)`

Both accept a payment-like object with numeric or string `payable_amount`, `discount_amount`, and `tip_amount`.

## Related: `paymentLogsTableSortAccessors.js`

Shared `sortRows` accessor maps for payment log UIs live in `frontend/src/utils/paymentLogsTableSortAccessors.js`:

- `buildPaymentLogsTableSortAccessors({ branchAccessor, issuedByAccessor, logTab })` — staff grids (superadmin, admin, finance, superfinance).
- `buildStudentPaymentLogsTableSortAccessors()` — student payment history.
- `paymentLogsInvoiceSortKey(p)` — stable invoice-column ordering (invoice id vs AR / fallback id).
