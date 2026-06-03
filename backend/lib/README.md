# Backend shared libraries

## `merchandiseReleaseLog.js`

Records each physical merchandise stock deduction in `merchandise_release_logtbl` for operational dashboards.

| Source | When logged | `release_batch_id` |
|--------|-------------|-------------------|
| `merchandise_ar` | Merchandise acknowledgement receipt created (stock deduct) | `ar-{ack_receipt_id}` |
| `package_enroll` | First qualifying package payment (downpayment or Phase 1 / full payment) | `pkg-pay-{payment_id}` |

Package included merchandise (e.g. PE uniform top + bottom):

- Stored on invoice remarks as `MERCH_PENDING:{json}` at enroll (validation only; stock not deducted yet).
- Stock deduct + log on **first payment** only, keyed by `(student_id, package_id, class_id)`.
- **Re-enrollment** with the same package/class does not issue or count again.

Dashboard daily/monthly metrics read from this table (quantity = sum of `quantity`; events = distinct `release_batch_id`).

Migration: `migrations/117_create_merchandise_release_logtbl.sql`

Package pending lines are normalized with `normalizePackageMerchLines()` so placeholder package SKUs do not duplicate configured uniform Top/Bottom or duplicate Learning Kit rows.

Backfill (optional, AR history only): `scripts/backfillMerchandiseReleaseLogFromAr.js`

## `paymentLogArApproval.js`

Maps unapplied verified package AR rows to Payment Logs approval fields in `GET /payments/finance-unified`:

- Finance/Superfinance/Superadmin verifier → `approval_status: Approved` with verifier name
- Admin verifier → `approval_status: Pending` (AR record stays Verified/Applied in `acknowledgement_receiptstbl`)

Also gates whether `acknowledgementreceipts.js` auto-approves linked `paymenttbl` rows when an AR is verified.
