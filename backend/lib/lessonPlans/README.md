# Lesson plans module

Helpers for teacher lesson plan CRUD and Superadmin/Admin verification.

## Status flow

`draft` → `submitted` → `awaiting_reflection` → `completed`  
`submitted` → `revision_requested` → (edit) → `submitted`

### Teacher's Reflection

LCA labels: **Successes**, **Amazing Moments**, **Challenges**, **Improvements**  
(`reflection_went_well`, `reflection_amazing_moments`, `reflection_challenges`, `reflection_improvements`)

- Locked while drafting / submitting / pending verification.
- After verifier **approves**, status becomes **`awaiting_reflection`** (label: Awaiting Reflection).
- Reflection fields unlock **only on the lesson date** (Asia/Manila calendar day). Locked again the day after.
- Saving reflections marks the plan **`completed`** — no second verifier approval.

### Form fields

Aligned to the LCA Lesson Plan PDF (plus `grade_level` for program folder browsing). **Grade level** and **class** options come from non-archived classes in the teacher's branch (`GET /meta`). Each plan is linked to **one CMS class** via `class_id` (migration `148_add_class_id_to_lessonplanstbl.sql`).

### Head Teacher review

Verifier-only on approve: `head_teacher_overall_assessment`, `head_teacher_specific_feedback`, `head_teacher_next_steps`.

### Structured revision feedback

Verifiers can flag a **field** and/or **highlighted quote** (+ note). Stored as JSON in `revision_reason` (`revision_feedback` on API). Legacy plain-text reasons still display.

## Active student note

N/A — this module is teacher-authored lesson plans.

## Header meta (Region / District / Division / School ID)

DepEd letterhead: LCA seal **left** · Republika / DepEd / Region / Schools Division Office / School (**center**, gothic for first two lines) · DepEd seal **right** · underlined **LESSON PLAN**.

| Field | Source |
|-------|--------|
| Region line | Branch `deped_region` → e.g. `REGION III` |
| Division office line | Branch `deped_division` → e.g. `SCHOOLS DIVISION OFFICE OF BULACAN` |
| School name | Always `LITTLE CHAMPIONS ACADEMY INC.` |
| School ID | Always `411093` (app constant; not shown on letterhead) |

Migration: `146_add_deped_meta_to_branchestbl.sql`. Editable under Branches → Lesson Plan Header (DepEd).

## Notifications

- Teacher submit → system notification to verifiers (`navigation_key: lesson-plans`):
  - All Superadmins (always)
  - Admin verifiers selected in Settings whose `branch_id` matches the plan's branch
- Verifier approve / request revision → system notification to the teacher

## Review

- **Superadmin** → `/superadmin/lesson-plans` (all branches; always allowed, no Settings selection)
- **Admin** → `/admin/lesson-plans` (designated branch only; must be selected in Settings → Lesson Plans)

Settings only manages the **Admin** verifier list.
