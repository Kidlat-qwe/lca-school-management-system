# Merchandise package inclusion

Branch merchandise types can be marked **Included in package** (default) or
**Not included**.

| Flag | Behavior |
|------|----------|
| Included (`true`) | May be added to Package Details; enroll / first payment can auto-issue. |
| Not included (`false`) | Blocked from Package Details; no enroll auto-issue. Stock is reduced only via **Manual deduct** with required remarks. |

Set on Superadmin **Add Merchandise Type** / Edit Type. Stored on
`merchandisestbl.is_package_included` (type shell + stock rows for that branch
category stay in sync).

Manual deduct: `POST /merchandise/:id/manual-deduct` `{ quantity, remarks }` →
writes `merchandise_release_logtbl` with `source = manual_deduct`.
