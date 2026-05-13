# dailySummary

## `AdminDailySummaryDetailsModal.jsx`

Read-only **View details** modal for branch **Admin → Daily summary** (End of shift and Cash deposit). Matches the layout and data shown on the Superadmin **Daily Summary Sales** approval page details view, without verify/reject actions.

Uses:

- `GET /daily-summary-sales/:id/payments` (End of shift)
- `GET /cash-deposit-summaries/:id/payments` (Cash deposit)

Response parsing: `frontend/src/utils/dailySummaryPaymentsParse.js`.
