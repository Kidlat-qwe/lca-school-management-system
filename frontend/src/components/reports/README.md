# Reports Components

## `StatusLegend.jsx`

Displays a concise status legend for report tabs:

- Student Status
- Program Payment Status
- Program Enrollment Status

The legend is tab-aware and keeps label meanings short for end users.

## Excel export (Student Status)

On **Report → Student Status**, use **Export to Excel** to download rows for the selected billing month.

In the export modal, choose:

- **Active only**
- **Inactive only**
- **All (active + inactive)**

Export uses the same Month Re-enrollment matrix rules as the table, and respects the current search (and Superadmin branch filter). Helper: `frontend/src/utils/studentStatusExcelExport.js`.
