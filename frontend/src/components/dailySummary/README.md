# dailySummary

## `AdminDailySummaryDetailsModal.jsx`

Read-only **View details** modal for branch **Admin → Daily summary** (End of shift and Cash deposit). Matches the layout and data shown on the Superadmin **Daily Summary Sales** approval page details view, without verify/reject actions.

Uses:

- `GET /daily-summary-sales/:id/payments` (End of shift)
- `GET /cash-deposit-summaries/:id/payments` (Cash deposit)

Response parsing: `frontend/src/utils/dailySummaryPaymentsParse.js`.

When a **cash deposit** is **Returned**, invoice IDs in the payment table are clickable for **Admin** and **Superadmin**. They open `CashDepositPaymentEditModal.jsx` (invoice-page style: payment type, amounts, proof, reference, invoice summary). Saving calls `PUT /payments/:id` and reloads live deposit totals from `GET /cash-deposit-summaries/:id/payments`.

## `CashDepositResubmitModal.jsx`

**Review & resubmit** modal for returned cash deposits (branch Admin → Daily Summary Sales). Layout matches Payment Logs → **Deposit Cash** submission: date range, reference/proof, summary cards, and full payment-lines table.

## `CashDepositPaymentsTable.jsx`

Shared cash payment lines table (Payment date, Invoice, Student, Method, Amount, Total Amount, Status, AR#, Reference).

## `CashDepositPaymentEditModal.jsx`

Shared payment editor for returned cash-deposit lines. Used by branch Admin resubmit/details modals and Superadmin Daily Summary Sales.

## `CashDepositPaymentInvoiceCell.jsx`

Clickable invoice column when `canEditCashDepositPayments` is true (`frontend/src/utils/cashDepositPaymentEdit.js`).

## List date filtering (admin + approval page)

The **Daily summary** list UIs use the same three-mode pattern as **Invoices** (Month | primary business dates | Date created). Query translation lives in `frontend/src/utils/dailySummaryListDateFilters.js`; APIs accept `created_date_from` / `created_date_to` on `GET /daily-summary-sales` and `GET /cash-deposit-summaries` (filters `created_at::date`).
