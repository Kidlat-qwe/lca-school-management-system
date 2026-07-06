# Payment log UI components

- **`PaymentLogPackageItemCell.jsx`** — Package/Item column for admin, finance, and superadmin payment log tables. Resolves installment phase labels and shows partial-payment context (partial payment, remaining balance, completed balance).
- **`PaymentLogBranchCell.jsx`** — Center-aligned branch column for payment log tables.
- **`PaymentLogUpdatedAtCell.jsx`** — Two-line Updated At display (date line + time line, Asia/Manila).
- **`PaymentLogsViewTabs.jsx`** — Branch-scoped payment log tab navigation.
- **`PaymentAttachmentViewerModal.jsx`** — View payment attachment images.
- **`PaymentFinanceVerifyModal.jsx`** — Finance/Superfinance landscape payment review modal (verify, return, reject). Matches AR verify layout; includes reference number entry for verification.

Payment log tables include an **Updated At** column (after **Payment Date**) showing when the payment row was last saved in the system. This is distinct from **Payment Date** / **Issue Date** (the business date on the receipt).

**Month filter vs Updated At:** The month/date filters use `paymenttbl.issue_date` (business payment date). **Updated At** uses system timestamps (`created_at`, `approved_at`, etc.). A payment can appear under July because its issue date is in July, while Updated At still shows April if it was recorded or approved in April with a forward-dated payment date.

- DB: `paymenttbl.updated_at` (migrations `119_add_updated_at_to_paymenttbl.sql`, `120_repair_paymenttbl_updated_at_accuracy.sql`)
- Triggers set `updated_at = CURRENT_TIMESTAMP` on every INSERT and UPDATE
- Historical rows backfill from the latest of `created_at`, `approved_at`, `returned_at`, `rejected_at`
- Apply on server: `node scripts/applyPaymentUpdatedAtMigration.js`
- Formatting: `formatPaymentLogUpdatedAt` in `frontend/src/utils/paymentLogUpdatedAt.js` (API sends Manila wall clock; DB stores UTC)
