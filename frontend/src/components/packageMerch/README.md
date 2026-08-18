# Package merchandise UI

## PackageMerchEntitlementPanel

Enroll modal controls for package-included **freebies** (non-uniform):

- **Keep** — release the package’s included item (default). Shows type stock (e.g. `12 in stock`).
- **Swap** — deduct a different item instead; package price unchanged. Replacement options and the selected item show stock.
- Zero stock is allowed; fulfill later from **Pending issue**

## PackageMerchPendingQueue

Merchandise tab **Pending issue**: out-of-stock enrollments from **2026-08-17**
onward only (latest enrolled student on row 1), then ready-to-issue. Paginated
(10 / page). **Issue** deducts 1 unit when first payment exists and branch stock > 0.

**API:** `GET /merchandise/package-pending`, `POST /merchandise/package-pending/issue`

Used on Admin / Superadmin Classes enroll wizard:

1. Select students
2. Configure items (keep / swap cards)
3. Review (replacement item badge when swapped)

Layout shell: `frontend/src/components/enrollStudentSelection/`.

Helpers: `frontend/src/utils/packageMerchSwap/`.
