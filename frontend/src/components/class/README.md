# Class components

Reusable UI for class detail views.

## ClassStatusToggle

Status **dropdown** for **Active / Inactive** class status on the Superadmin and Branch Admin classes list (pill button with chevron; options shown in uppercase).

- **API:** `PATCH /classes/:id/status` with body `{ status: 'Active' | 'Inactive' }`
- Reactivating a class **auto-restores** teachers from the last inactive release when they are **not** assigned to another active class.
- **Cannot activate** without at least one assigned teacher. If restore fails, status stays **Inactive** and the **Assign teacher** modal opens (`ClassReactivateAssignTeacherModal`); after assign, the class is marked **Active**.
- Deactivating a class releases all teacher assignments (`classestbl.teacher_id`, `classteacherstbl`) and closes open rows in `teacher_class_historytbl` with `end_reason = class_inactive`, so teachers can be assigned to other active classes.
- Installment plans for that class are paused (`installmentinvoiceprofilestbl.is_active = false`): no new auto/manual installment invoices, monthly notices, overdue email/SMS, or delinquency auto-drop. Existing invoices, payments, enrollments, and profiles remain in the database.
- Backend logic: `backend/utils/classStatusService.js`, `backend/utils/billingNotificationEligibility.js`

**Props:** `classId`, `status`, `enrolledStudents`, `teacherLabel`, `onStatusChanged`, `onNeedsTeacherAssignment`, `disabled`

## ClassStartDateAdjustmentPreviewPanel

Inline preview for shifting class `start_date` inside **Edit Class** (Superadmin / Admin).

- **API:** `POST /classes/:id/adjust-start-date/preview`, `POST /classes/:id/adjust-start-date/apply`
- When the class has enrollments or installment billing, change **Start Date** in Edit Class, enter a **reason**, review the auto-loaded impact preview, then **Update Class**
- Preview loads automatically when start date changes (debounced); shows session dates, room/teacher conflicts, and per-student billing impact
- Backend: `backend/utils/classStartDateAdjustment/`

**Props:** `preview`, `loading`, `acknowledgeWarnings`, `onAcknowledgeWarningsChange`

## ClassStartDateAdjustmentModal

Legacy standalone wizard (same APIs). Prefer Edit Class inline flow above.

**Props:** `open`, `classItem`, `onClose`, `onApplied`

## ClassReactivateAssignTeacherModal

Opens when activating a class (**Inactive → Active**) requires a teacher assignment (none on file or previous teacher on another class). Uses schedule conflict checks; **Assign & activate** saves teachers then `PATCH`es status to Active.

**Props:** `open`, `classItem` (`pending_activation`, `teachers_skipped`), `onClose`, `onAssigned`, `activateOnAssign`

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
