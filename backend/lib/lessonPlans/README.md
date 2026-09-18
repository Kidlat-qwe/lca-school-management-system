# Lesson plans module

Helpers for teacher lesson plan CRUD and Superadmin/Admin verification.

## Status flow

`draft` → `submitted` → `awaiting_reflection` → `completed`  
`submitted` → `revision_requested` → (edit) → `submitted`

### Missed lesson plans

`fetchMissedLessonPlans` / `mapMissedLessonPlanRow` compare overdue `classsessionstbl` rows to submitted plans.

- **Window**: `since <= scheduled_date <` Asia/Manila today
- **Default `since`**: `LESSON_PLAN_MISSED_SINCE_DEFAULT` in `lib/lessonPlans` (**2026-09-19**); UI **Track from** can override per request
- **Draft**: does not count as submitted
- **Match**: teacher + `class_id` + phase number + session number
- **Clears miss**: `submitted`, `revision_requested`, `awaiting_reflection`, `completed`

### `submitted_at`

- **Draft create/save**: `submitted_at` stays `NULL` (not stamped).
- **First submit** (`draft` → `submitted`, or create with status `submitted`): set to `NOW()`.
- **Resubmit after revision** (`revision_requested` → `submitted`): keep the original `submitted_at` (do not overwrite).

### Teacher's Reflection

LCA labels: **Successes**, **Amazing Moments**, **Challenges**, **Improvements**  
(`reflection_went_well`, `reflection_amazing_moments`, `reflection_challenges`, `reflection_improvements`)

- Locked while drafting / submitting / pending verification.
- After verifier **approves**, status becomes **`awaiting_reflection`** (label: Awaiting Reflection).
- Reflection fields unlock while status is **`awaiting_reflection`** (all four fields editable).
- Saving complete reflections marks the plan **`completed`** — no second verifier approval.

### Form fields

Aligned to the LCA Lesson Plan PDF (plus `grade_level` for program folder browsing). **Grade level** and **class code** options come from the teacher's designated classes only (`classestbl.teacher_id` or `classteacherstbl`). Class Code is the **session** `class_code` for the selected Phase/Session (View Class Details). On save, that code is stored in `subject` and Phase/Session are stored as display strings (`Phase N`, `Session N`). List/API resolve Class Code from phase+session match, then saved `subject`, then first session code fallback.

### Head Teacher review

Verifier-only on approve (all three required): `head_teacher_overall_assessment`, `head_teacher_specific_feedback`, `head_teacher_next_steps`.

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

- Teacher submit → **no urgent in-app alert**; verifiers see a **pending count badge** on the sidebar **Lesson Plans** item (`GET /lesson-plans/verifiers/me` → `pending_submission_count`, status = `submitted`).
- Verifier approve / request revision → system notification to the teacher (`navigation_key: lesson-plans`, priority High)

## Review

- **Superadmin** → `/superadmin/lesson-plans` (all branches; always visible in sidebar when feature flag is on)
- **Admin** → `/admin/lesson-plans` (designated branch only; sidebar visible only when selected in Settings → Lesson Plans)

`POST /auth/verify` includes `is_lesson_plan_verifier` on the user object so Admin sidebars can show Lesson Plans immediately after login without waiting on a second API call.

Settings only manages the **Admin** verifier list.
