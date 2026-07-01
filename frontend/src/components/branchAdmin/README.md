# Branch Admin components

UI pieces used only on Branch Admin (`user_type === 'Admin'`) routes.

## `BranchAdminHelpFloatingButton`

Fixed mini floating control shown on every `/admin/*` page (via `Layout.jsx`). Clicking **Need help?** opens the Branch Admin / Frontdesk manual PDF in a new tab.

- Manual source: `docs/branch_admin_workflows/Branch Admin, Frontdesk Manual Physical School Management System.pdf`
- Deployed static copy: `frontend/public/docs/branch-admin-frontdesk-manual.pdf`
- URL constant: `src/constants/branchAdminHelp.js`
