# Announcement academic audience filter

Program / class scoping for announcement **email recipients** and **Student/Teacher** board + notification visibility.

## Columns (`announcementstbl`)

| Column | Meaning |
|--------|---------|
| `program_ids` | `integer[]` — empty = all programs |
| `class_ids` | `integer[]` — empty = all classes (within `program_ids` when set) |

Migration: `backend/migrations/140_add_program_class_filters_to_announcementstbl.sql`

## Rules

1. **Recipient groups** still decide role (Students, Guardians, Teachers, Admin, …).
2. **Program / class** further narrow Students, Guardians, and Teachers only.
3. Admin / Finance / Superadmin / Superfinance are **not** filtered by program/class.
4. If `class_ids` is non-empty, membership is by those classes (program list is ignored for matching).
5. If only `program_ids` is set, match active enrollments / teacher assignments in those programs.
6. Both empty in DB → all programs/classes, but Students/Guardians still require **active enrollment**.

## Active students (aligned with Reports / class ops)

Same point-in-time “Active” rule as `GET /reports/students` and class capacity:

- `classstudentstbl.program_enrollment_status IN ('new','re_enrolled','upsell','rejoin')`
- `removed_at IS NULL`

Students must satisfy this to see the board announcement and to receive email (even when program/class is All). Guardians receive email only when their linked student is active under the same rule (and program/class filters when set).

Note: Reports → Student Status “Total Active” for a billing month uses the Month Re-enrollment matrix (can include multi-phase `completed`). Announcements use **current enrollment**, not that month matrix.

## Exports

| Export | Purpose |
|--------|---------|
| `normalizeAudienceIdList` | Body → clean id array |
| `hasAudienceRestriction` | Whether any program/class filter is set |
| `sqlStudentIsActivelyEnrolled` | Shared EXISTS for active enrollment |
| `sqlAnnouncementMatchesStudentAudience` | SQL for board/notifications |
| `sqlAnnouncementMatchesTeacherAudience` | SQL for board/notifications |
| `userTypeUsesAcademicAudience` | Student/Teacher only |
