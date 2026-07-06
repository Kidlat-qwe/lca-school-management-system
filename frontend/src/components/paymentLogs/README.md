# Payment log UI components

- **`PaymentLogPackageItemCell.jsx`** — Package/Item column for admin, finance, and superadmin payment log tables. Resolves installment phase labels and shows partial-payment context (partial payment, remaining balance, completed balance).
- **`PaymentLogBranchCell.jsx`** — Center-aligned branch column for payment log tables.
- **`PaymentLogUpdatedAtCell.jsx`** — Two-line **Created At** display (date line + time line, Asia/Manila). Shows when the payment was encoded (`paymenttbl.created_at`).
- **`PaymentLogsViewTabs.jsx`** — Branch-scoped payment log tab navigation.
- **`PaymentAttachmentViewerModal.jsx`** — View payment attachment images.
- **`PaymentFinanceVerifyModal.jsx`** — Finance/Superfinance landscape payment review modal (verify, return, reject). Matches AR verify layout; includes reference number entry for verification.

Payment log tables include a **Created At** column (after **Payment Date**) showing when the payment row was first encoded in the system.

**Issue Date** = invoice date (`invoicestbl.issue_date`). **Payment Date** = client-paid date (`paymenttbl.issue_date`). Finance approve may update Payment Date only.

- DB: `paymenttbl.created_at` (UTC stored; API converts to Manila for display)
- Formatting: `formatPaymentLogCreatedAt` in `frontend/src/utils/paymentLogUpdatedAt.js`
