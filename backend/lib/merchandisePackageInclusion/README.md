# merchandisePackageInclusion

Shared helpers for `merchandisestbl.is_package_included`.

| Export | Purpose |
|--------|---------|
| `parseIsPackageIncluded` | Coerce request body / row value to boolean (default `true`) |
| `isMerchandisePackageIncluded` | True when type may be used in packages / enroll auto-issue |

Used by merchandise create/update, package detail guards, and enroll skip.
