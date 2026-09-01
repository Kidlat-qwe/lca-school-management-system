# Settings Components

Reusable UI for the Settings tabs.

## Files

- `TemplateEditorCard.jsx` — Template form (title, subject, body, enabled) with variable palette; branch labels on Stay Connected group-chat variables when editing a branch override.
- `TemplatePickerSelect.jsx` — Grouped template dropdown (includes **First enrollment onboarding** optgroup).
- `TemplateVariableField.jsx` — Input/textarea that locks `{variable}` tokens after insertion.
- `TemplateVariablePalette.jsx` — Read-only, auto-detected variable chips (drag or click to insert).
- `ArchivedClassesPanel.jsx` — Settings → **Archived Classes**: list, restore, or permanently delete soft-archived classes (30-day retention).
- `LessonPlanSettingsPanel.jsx` — Settings → **Lesson Plans**: select Admin verifiers (branch-scoped). All Superadmins can always verify every branch. Review UI: `/superadmin/lesson-plans` or `/admin/lesson-plans`.
- `AnnouncementCreatorsPanel.jsx` — Settings → **Announcements**: configure who may create board announcements (all users, by role, or specific users). Superadmins always have access.

## Announcement creators

- Modes: **Allow all users**, or pick **specific users** grouped by end-user type (Admin, Teacher, Student, Finance, Superfinance).
- Each group expands to show users with **Select all [Type]** and individual checkboxes.
- API: `GET/PUT /announcements/creators` (Superadmin), `GET /announcements/creators/me` (current user).
- Enforced on create/update/delete announcements and announcement file uploads.

## Archived Classes

- Classes page **Archive** calls `DELETE /classes/:id` (soft archive).
- Panel loads `GET /classes/archived`, restore via `POST /classes/:id/restore`, permanent via `DELETE /classes/:id/permanent`.
- Superadmin sees all branches; Admin panel passes `branchId` to scope the list.
- After 30 days, Superadmin cron `POST /classes/purge-archived` permanently deletes expired rows.

## Variable rules

- Available variables are auto-detected from predefined template variables plus tokens already used in the fields.
- Variable chips are read-only; users insert them by drag-and-drop or click.
- Once a `{variable}` token is in a field, its text cannot be edited—only deleted as a whole token.
- Unsaved template edits prompt Save / Don't save when switching tabs, scope, branch, or leaving the page (`useTemplateUnsavedGuard`).

## Wired templates (backend)

| Key | When used |
|-----|-----------|
| `template_eod_summary` | End-of-day summary emails/notifications |
| `template_cash_deposit` | Cash deposit submission alerts |
| `template_payment_confirmation` | Payment recorded — email + SMS |
| `template_payment_reminder` | Overdue invoice reminder — email + SMS |
| `template_monthly_invoice_notice` | Auto-generated monthly installment invoice — email + SMS |

SMS uses Semaphore (`SEMAPHORE_API_KEY`, `SEMAPHORE_SENDER_NAME` in `backend/.env`). Templates support optional **SMS message** and **Send SMS when email is sent**.
