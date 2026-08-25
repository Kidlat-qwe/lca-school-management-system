# Lesson plans module

Helpers for teacher lesson plan CRUD and Superadmin/Admin verification.

## Status flow

`draft` → `submitted` → `awaiting_reflection` → `completed`  
`submitted` → `revision_requested` → (edit) → `submitted`

### Teacher's Reflection

- Locked while drafting / submitting / pending verification.
- After verifier **approves**, status becomes **`awaiting_reflection`** (label: Awaiting Reflection).
- Reflection fields unlock **only on the lesson date** (Asia/Manila calendar day). Locked again the day after.
- Saving reflections marks the plan **`completed`** — no second verifier approval.

### Structured revision feedback

Verifiers can flag a **field** and/or **highlighted quote** (+ note). Stored as JSON in `revision_reason` (`revision_feedback` on API). Legacy plain-text reasons still display.

## Active student note

N/A — this module is teacher-authored lesson plans.

## Header meta (Region / District / Division / School ID)

Teacher page styling matches `TeacherLessonPlans.jsx` (sheet padding, header grid `270px | 1fr`, logo sizes, peach buttons, Poppins).

Hardcoded for all branches (never use per-branch address):

| Field | Value |
|-------|--------|
| School name | Little Champions Academy, Inc. |
| Address | North Centrum Building, Guiguinto Bulacan 3015 |
| Region | Region III |
| Division | Bulacan |
| District | 5th District |
| School ID | 411093 |

## Notifications

- Teacher submit → system notification to matching verifiers (`navigation_key: lesson-plans`):
  - Superadmin verifiers (all plans)
  - Admin verifiers whose `branch_id` matches the plan's branch
  - Fallback when none configured: all Superadmins
- Verifier approve / request revision → system notification to the teacher

## Review

Configured verifiers open **Lesson Plans**:
- Superadmin → `/superadmin/lesson-plans` (all branches)
- Admin → `/admin/lesson-plans` (designated branch only)

Settings only manages the verifier list (Superadmin + Admin candidates).
