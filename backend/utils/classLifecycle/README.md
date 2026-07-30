# classLifecycle

End-of-class finalization and soft-archive lifecycle for `classestbl`.

Service: `classLifecycleService.js`

## Behaviors

| Action | Behavior |
|--------|----------|
| **Finalize ended** | When `end_date` is before today (Manila): set class **Inactive**, mark latest active enrollment phase **completed**, deactivate installment profiles for the class |
| **Archive** | Soft-delete: set `archived_at`, `archived_by`, `archive_purge_after` (+30 days). Ended classes are finalized first. Non-ended classes block if they still have active enrollments / reservations / active profiles |
| **Restore** | Clears archive fields; keeps **Inactive** if end date already passed |
| **Permanent delete** | FK-safe cleanup (reservations, null profile `class_id`, enrollments, schedules, sessions, teachers, then class row). Only for archived classes (or cron purge) |
| **Purge cron** | Permanently deletes where `archive_purge_after <= today` |

## API (via `routes/classes.js`)

- `DELETE /classes/:id` → archive (soft)
- `GET /classes/archived`
- `POST /classes/:id/restore`
- `DELETE /classes/:id/permanent`
- `POST /classes/purge-archived` (Superadmin)
- `POST /classes/finalize-ended` (Superadmin) — run finalize job on demand

Main Classes list excludes `archived_at IS NOT NULL`. Active enrolled count excludes `completed`.

## Migration

`backend/migrations/132_add_class_archive_columns.sql`
