# Settings Components

Reusable UI for the Settings tabs.

## Files

- `TemplateEditorCard.jsx` — Template form (title, subject, body, enabled) with variable palette.
- `TemplateVariableField.jsx` — Input/textarea that locks `{variable}` tokens after insertion.
- `TemplateVariablePalette.jsx` — Read-only, auto-detected variable chips (drag or click to insert).
- `ArchivedClassesPanel.jsx` — Settings → **Archived Classes**: list, restore, or permanently delete soft-archived classes (30-day retention).

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
