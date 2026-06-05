# paymentLogPackageItem

Resolves user-friendly **Package/Item** labels for payment log tables.

- **`resolvePaymentLogBaseDescription`** — Builds the main plan line (e.g. `Phase 2 - Installment plan for …`) from `invoice_description`, installment profile, and invoice remarks when the stored description is only `INV-{id}`.
- **`getPaymentLogPackageItemContext`** — Adds a second-line context for partial payments and balance-continuation invoices.
- **`getPaymentLogPackageItemDisplayText`** — Single string for export, sorting, and tooltips.

Used by `components/paymentLogs/PaymentLogPackageItemCell.jsx`.
