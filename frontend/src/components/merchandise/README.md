# Merchandise components

Shared UI for the Merchandise module (Superadmin / Admin).

## MerchandiseReleaseLogsPanel

Tab panel listing **released stocks** from `merchandise_release_logtbl`.

| Prop | Description |
|------|-------------|
| `branchId` | Optional branch filter (Superadmin global filter). Admin: pass admin branch id. |
| `branchName` | Display label for scope subtitle. |
| `showBranchColumn` | Default `true`. Set `false` on Admin when always one branch. |

**API:** `GET /dashboard/merchandise-released-details` with `summary_month` or `summary_date` (+ optional `branch_id`).

Sources: Package first payment (`package_enroll`) and Merchandise AR (`merchandise_ar`).

## RhetCategorySelect

Dropdown of exact RHET Inventory `categoryName` values for **Add Merchandise Type**
(category + image shell only — no local Uniform/Other taxonomy on create).

Data from `GET /merchandise-requests/inventory/catalog` (CMS proxy) — not a hard-coded
CMS category list. Supports `onRetry` when RHET catalog fails temporarily.

Options are usually filtered with `getCreateMerchandiseCategoryOptions(catalog, {
  excludeLearningKit: true,
  excludeNames: existingBranchTypeNames,
})`.


## LearningKitRequestFields

Request Stock panel for Learning Kit: kit picker + BOM component collector
(recipes from `merchandiseRequests/learningKit.js`).

## MerchandiseRequestStatusModules

RHET Inventory-style status chips for Merchandise → **My Requests** /
**Stock Requests**:

`Pending` · `Shipped` · `Delivered` · `Returned` · `Rejected`

Shows live counts and filters the request table. Legacy `Approved` counts as Delivered.
Each module has its own pagination (10 requests per page via `FixedTablePagination`).

## RequestActionsMenu

Ellipsis (⋮) menu for Merchandise → **Requests** Actions column.
Built via `buildMerchandiseRequestActionItems`:
- **Delivered / Returned / Rejected** (and legacy Approved): **View details** only → track timeline (read-only)
- **Pending / Shipped**: **Track request item** plus Cancel / Confirm / Review as applicable


## TrackRequestProgressModal

Modal timeline for RHET stock-request progress:

`Pending` → `Shipped` → `Delivered` (with terminal `Returned` / `Rejected`).

When status is **Shipped**, Branch Admin can **Confirm received** (calls
`POST /merchandise-requests/:id/confirm-delivery` → RHET `/stock-requests/:id/deliver`).

Uses `utils/merchandiseRequests/trackProgress.js` to map local `status`
(and legacy `Approved` → Delivered) onto step states.

Admin / Superadmin Merchandise pages use `useMerchandiseLiveRefresh` so request
status and branch stock update automatically after RHET webhooks (no manual reload).
