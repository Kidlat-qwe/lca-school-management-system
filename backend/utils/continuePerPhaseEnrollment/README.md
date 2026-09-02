# Continue Per Phase Enrollment

Utilities for detecting **continue per phase** enrollments (student already active in class, new billing starts after their highest enrolled phase).

## Policy

- **No package merchandise** on continue per phase: no `MERCH_PENDING`, no stock issue on payment.
- Invoices created on this path include `CONTINUE_PER_PHASE:1` in remarks.

## Exports (`../continuePerPhaseEnrollment.js`)

| Function | Purpose |
|----------|---------|
| `resolveIsContinuePerPhaseEnrollment` | True when active enrollment exists and requested start phase is higher than highest active phase |
| `isContinuePerPhaseInvoiceRemarks` | Parse `CONTINUE_PER_PHASE:1` from invoice remarks |
| `stampContinuePerPhaseOnRemarks` | Append marker once |
