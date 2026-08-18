# Date utilities (Asia/Manila)

Implementation: `frontend/src/utils/dateUtils.js`.

All CMS date/time display uses **Asia/Manila (UTC+8)**.

| Export | Output |
|--------|--------|
| `formatDateManila` | `June 06, 2026` |
| `formatDateTimeManila` | `June 06, 2026, 14:30:00` |
| `parseDateForDisplay` | `Date` instant for those formatters |

## Timestamp parsing

| API value | Meaning |
|-----------|---------|
| `2026-08-18T05:24:34.000Z` | Absolute UTC (Coolify). Display adds 8 hours → `13:24:34` Manila. |
| `2026-08-18T13:24:34+08:00` | Already Manila-offset. Display as-is. |
| `2026-08-18 13:24:34` | Naive wall clock already in Manila (payment-log `TO_CHAR`). |
| `2026-08-18` | Date-only; noon Manila, no day shift. |

Display uses fixed UTC+8 arithmetic (Philippines has no DST), not `toLocaleString`.
A Coolify request stored at 05:24 UTC must show **13:24:34** (1:24 PM), matching RHET Inventory.
