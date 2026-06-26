# Class components

Reusable UI for class detail views.

## ClassPhaseHeader

Collapsible phase row with an **Attendance History** action for attendance summary. Used on superadmin, admin, and teacher class detail pages.

## ClassPhaseAttendanceSummaryModal

Modal showing phase attendance as a student × session matrix (spreadsheet-style), with:

- Summary pills (enrolled, sessions completed, present rate, absent, late, not marked)
- Legend for Present, Absent, Late, Excused, Leave Early, Not marked
- Per-student total columns (P, A, L, E, LE)

**API:** `GET /attendance/class/:classId/phase/:phaseNumber/summary`

Backend logic: `backend/utils/phaseAttendanceSummaryService.js`

## ClassSessionAttendanceModal

Shared modal for taking or viewing attendance for a single class session. Used on operational dashboards (`OperationalAttendanceCard`, `OperationalAttendanceModal`, `OperationalAttendanceShortcuts`) and can be reused anywhere a session ID is available.

**API (same as Class Details attendance):**

- `GET /attendance/session/:classsessionId` — load session, roster, and saved marks
- `POST /attendance/session/:classsessionId` — save attendance, notes, and agenda

Saving through this modal updates the same records shown in **Classes → View class details → Attendance**.

**Props:** `open`, `onClose`, `classsessionId`, `teacherName` (optional display), `onSaved` (callback after successful save)
