# Merchandise components

Shared UI for the Merchandise module (Superadmin / Admin).

**My Requests Date & Time** uses `formatDateTimeManila` (Asia/Manila, UTC+8). Do not use
`toLocaleString()` — Coolify UTC ISO timestamps would show the wrong clock.

## MerchandiseReleaseLogsPanel

Tab panel listing **released stocks** from `merchandise_release_logtbl`.

| Prop | Description |
|------|-------------|
| `branchId` | Optional branch filter (Superadmin global filter). Admin: pass admin branch id. |
| `branchName` | Display label for scope subtitle. |
| `showBranchColumn` | Default `true`. Set `false` on Admin when always one branch. |

**API:** `GET /dashboard/merchandise-released-details` with `summary_month` or `summary_date` (+ optional `branch_id`).

Sources: Package first payment (`package_enroll`) and Merchandise AR (`merchandise_ar`).

Package items still owed after 0-stock enroll/pay are on **Pending issue**
(`PackageMerchPendingQueue` in `components/packageMerch/`).

## RhetCategorySelect

Dropdown of exact RHET Inventory `categoryName` values for **Add Merchandise Type**
(category + image shell only — no local Uniform/Other taxonomy on create).

Also used on Superadmin **Edit Merchandise Type** when the current CMS category is
misaligned with RHET (`canEditMerchandiseTypeCategory`) so ops can realign to a
catalog category in one update.

Data from `GET /merchandise-requests/inventory/catalog` (CMS proxy) — not a hard-coded
CMS category list. Supports `onRetry` when RHET catalog fails temporarily.
A stale/cached catalog is a warning (`describeInventoryCatalogLoad`); do not pass it as
`error` or Request Stock Submit stays disabled.

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
- **Return Stock pending** (awaiting HQ): Track only — no Cancel / Confirm received
- `disabled` locks the ⋮ button while Confirm received is in progress

## ConfirmDeliveryLoadingOverlay

Full-page spinner overlay while Branch Admin confirms a **Shipped** item
(`POST /merchandise-requests/:id/confirm-delivery`). Mounted from
`ConfirmDeliveryProvider` in `Layout` (not the Merchandise page) so it survives
navigation.

**Minimize:** users can click **Minimize**, acknowledge a notice
(“Please wait for the receipt confirmation to be completed before enrolling
the student.”), then navigate elsewhere while the API call continues. A **mini
round yellow spinner** stays fixed above the Branch Admin **Need help?** button;
click it to expand the full overlay again. When confirm finishes, the usual
success/error alert still appears.

In-flight request IDs stay locked on the Shipped tab (checkbox + row actions)
until the confirm completes — see `contexts/confirmDelivery/`.

## ReturnStockModal

Branch Admin **Return Stock** dialog (beside Request Stock). Same landscape
modal pattern: date / returned-by, add-row table, reason.

- Category dropdown = existing branch types with on-hand qty only (one category per row; already-selected categories are hidden)
- Variant dropdown = concrete stock rows (gender/type/size or item/sku)
- Return qty per row, capped at available
- Submit → `POST /merchandise-requests/returns/batch` (HTTP 201/200 PENDING is success). My Requests → **Pending** until HQ accepts, then **Returned**.

## TrackRequestProgressModal

Landscape modal (md+) for RHET stock-request progress: item/status on the left,
timeline on the right. Stacks vertically on small screens.

`Pending` → `Shipped` → `Delivered` (with terminal `Returned` / `Rejected`).

When status is **Shipped**, Branch Admin can **Confirm received** (calls
`POST /merchandise-requests/:id/confirm-delivery` → RHET `/stock-requests/:id/deliver`).
The confirm button shows a spinner; close is disabled until the request finishes.

Uses `utils/merchandiseRequests/trackProgress.js` to map local `status`
(and legacy `Approved` → Delivered) onto step states.

Admin / Superadmin Merchandise pages use `useMerchandiseLiveRefresh` so request
status and branch stock update automatically after RHET webhooks (no manual reload).

## UI feature flags (temporary)

| Page | Constant | Location |
|------|----------|----------|
| Superadmin Merchandise | `ADD_MERCHANDISE_TYPE_ENABLED` | `pages/superadmin/Merchandise.jsx` |
| Admin Merchandise | `REQUEST_STOCK_ENABLED` | `pages/admin/adminMerchandise.jsx` |
| Admin Merchandise | `RETURN_STOCK_ENABLED` | `pages/admin/adminMerchandise.jsx` |

Set to `false` to disable the header buttons. Disabled buttons stay visible with reduced opacity and a tooltip.
