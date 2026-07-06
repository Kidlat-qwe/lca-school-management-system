# Shared pages

Pages used by more than one role with the same UI.

## `TeachersPage.jsx`

Teacher management under **Manage Users → Teachers** (Superadmin and Branch Admin).

- Lists teachers with active assigned classes (`GET /teachers`)
- **Class history** (view only): past and current assignments (`GET /teachers/:id/class-history`). Turnover rows show **assigned date** + **turnover date** (and who received the class). Non-turnover rows show **assigned date** + **class end date**.
- **Turn over classes** action: pick destination teacher, then immediately shows per-class fit (`POST /teachers/:id/turnover/preview`) — **Can transfer**, **Conflict** (with reasons), or **Already assigned** — before confirm
- Confirm calls `POST /teachers/:id/turnover` only for transferable selected classes (writes history)
- Superadmin / Admin only (sidebar + protected routes + page guard)
- Superadmin can scope by global branch filter (header); Admin is limited to their branch
- Search + **program** filter; assigned classes show **See more / See less** (2 visible by default) for even row height
