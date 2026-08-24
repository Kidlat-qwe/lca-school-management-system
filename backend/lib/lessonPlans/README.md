# Lesson plans module

Helpers for teacher lesson plan CRUD and Superadmin verification.

## Status flow

`draft` → `submitted` → `approved`  
`submitted` → `revision_requested` → (edit) → `submitted`

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

- Teacher submit → system notification to configured lesson-plan verifiers (`navigation_key: lesson-plans`)
- Verifier approve / request revision → system notification to the teacher

## Superadmin review

Configured verifiers open **Lesson Plans** (`/superadmin/lesson-plans`) to review submitted plans. Settings only manages the verifier list.
