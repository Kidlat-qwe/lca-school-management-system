# Student UI components

## `StudentHistoryModal.jsx`

**Student history** dialog used on Superadmin / Admin **Student** lists and on **re-enrollment dashboards** (phase/month matrix — click student name). Finance / Superfinance have **read-only** access (view tabs; edits remain Admin/Superadmin only).

- **Access (API):** `GET /users/:id` and `GET /guardians/student/:id` allow Superfinance (Finance with no branch), branch Finance (same-branch students), Admin, and Superadmin — see `assertCanViewStudentUserProfile` in `backend/middleware/auth.js`.

- **Layout:** Wide (“landscape”) shell (`max-w-[min(96vw,1320px)]`) with a **left sidebar** for tab navigation on `lg+` screens. Mobile / tablet falls back to a horizontal scrolling tab bar at the top.
- **Tabs:** Student info, Guardian info, Enrolled class, **Attendance**, Invoices.
- **Student info tab (editable):**
  - Profile picture with **Upload** / **Change** / **Remove** controls. Upload calls `POST /upload/user-avatar`; both upload and remove persist via `PUT /users/:id` with `profile_picture_url`.
  - Editable details: full name, email, phone, gender, DOB, LRN, level tag, branch. Save calls `PUT /users/:id`.
  - Unsaved-changes pill, Reset and Save buttons. Closing while dirty prompts via `appConfirm`.
- **Guardian info tab (editable, per guardian):**
  - One card per guardian with editable fields (name, email, relationship, phone, TIN, gender, address, city, postal code, state, country).
  - Each card has its own **Reset** and **Save changes** buttons (calls `PUT /guardians/:id`) and tracks unsaved changes independently.
  - Closing the dialog while any guardian card has unsaved edits triggers the same discard prompt as Student info.
- **Enrolled class:** Read-only table of enrollments (program, class, level, room, **assigned teacher(s)**, start–end, phases, first enrolled). Teachers come from `GET /students/:id/classes` (`classteacherstbl`, comma-separated when multiple).
- **Attendance tab:** Read-only session list and status per class (`GET /attendance/student/:id`). Uses the same enrollment + phase matching as class **View details → Attendance** (`GET /attendance/session/:sessionId`). Optional filter by enrolled class. Summary counts (present, absent, not marked, etc.).
- **Invoices tab:** Renders one **inline plan-details panel per installment plan** (see `components/installmentInvoice/InstallmentPlanDetails.jsx`) with the same layout as the **View details** dialog on the Installment Invoice Logs page — student/plan card, optional downpayment card, full phases table (paid, unpaid, not yet generated), and totals (outstanding balance + total paid).
- **Data sources:** `GET /users/:id`, `GET /guardians/student/:id`, `GET /students/:id/classes`, `GET /branches?limit=100`, and all pages of `GET /installment-invoices/invoices?student_id=` (via `fetchAllInstallmentInvoicePages`).
- **Props:**
  - `isOpen`, `student`, `onClose`
  - `onUpdated` (optional) — called after successful save / picture change so parent lists can refresh.

## Related pages

- `frontend/src/pages/superadmin/Student.jsx`
- `frontend/src/pages/admin/adminStudent.jsx`
- `frontend/src/pages/superadmin/PhaseEnrollmentDashboard.jsx` / `MonthlyEnrollmentDashboard.jsx` (and Finance / Superfinance routes)
