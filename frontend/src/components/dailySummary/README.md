# dailySummary

## `AdminDailySummaryDetailsModal.jsx`

Read-only **View details** modal for branch **Admin → Daily summary** (End of shift and Cash deposit). Matches the layout and data shown on the Superadmin **Daily Summary Sales** approval page details view, without verify/reject actions.

Uses:

- `GET /daily-summary-sales/:id/payments` (End of shift)
- `GET /cash-deposit-summaries/:id/payments` (Cash deposit)

Response parsing: `frontend/src/utils/dailySummaryPaymentsParse.js`.

## List date filtering (admin + approval page)

The **Daily summary** list UIs use the same three-mode pattern as **Invoices** (Month | primary business dates | Date created). Query translation lives in `frontend/src/utils/dailySummaryListDateFilters.js`; APIs accept `created_date_from` / `created_date_to` on `GET /daily-summary-sales` and `GET /cash-deposit-summaries` (filters `created_at::date`).
