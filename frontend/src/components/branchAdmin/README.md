# Branch Admin components

UI pieces used only on Branch Admin (`user_type === 'Admin'`) routes.

## `BranchAdminUpcomingDropAlertModal`

Login-time urgent modal (via `Layout.jsx`) listing students in the admin’s branch whose unpaid installment phase will auto-drop within **7 days** (`due_date + installment_final_dropoff_days`).

- Landscape width (`max-w-[min(72rem,96vw)]`) so the table fits without a horizontal scrollbar on desktop
- Shown only when the list is non-empty
- Closeable via **Close**, **Continue**, **X**, or backdrop click
- **Continue** opens `/admin/installment-invoice?tab=drop-off`
- Re-checks on each fresh login / page refresh (not on in-app navigation)
- API: `GET /installment-invoices/upcoming-delinquency-drops`

## `BranchAdminHelpFloatingButton`

Fixed mini floating control shown on every `/admin/*` page (via `Layout.jsx`). Clicking **Need help?** opens the Branch Admin / Frontdesk manual PDF in a new tab.

- Manual source: `docs/branch_admin_workflows/Branch Admin, Frontdesk Manual Physical School Management System.pdf`
- Deployed static copy: `frontend/public/docs/branch-admin-frontdesk-manual.pdf`
- URL constant: `src/constants/branchAdminHelp.js`
