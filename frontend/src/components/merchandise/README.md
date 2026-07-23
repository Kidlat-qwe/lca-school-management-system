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

Dropdown of exact RHET Inventory `categoryName` values for **Add Merchandise Type**.
Data from `GET /merchandise-requests/inventory/catalog` (CMS proxy). Learning Kit excluded.
