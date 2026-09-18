# Package merch fulfillment (backorder)

Enroll and first payment may complete when package merch is at **0 stock**.
Physical handoff is a later staff action.

## Flow

1. Enroll stores `MERCH_PENDING:[...]` on the invoice (obligation), including the **exact size SKU** selected (e.g. Male XS Polo at qty 0).
   Staff-selected concrete `merchandise_id` values are **never remapped** to another Top/Bottom type
   (e.g. do not substitute Female Blouse when Polo is OOS).
2. First payment issues **in-stock** lines and writes `merchandise_release_logtbl`.
3. Out-of-stock lines stay pending (payment does not fail). **Null or blank quantity on a concrete SKU counts as 0** — it must not log a release.
4. After Request Stock → confirm delivery, staff opens Merchandise → **Pending issue**
   (newest invoice first) and clicks **Issue**.
5. **Issue from Set:** if Top or Bottom is OOS but a same-size / same-gender **Set** has stock,
   Pending issue enables **Issue from Set**. The confirm modal explains the stock move before issuing:
   - Deduct 1 Set
   - Mark the needed piece issued
   - If the sibling Top/Bottom is also pending → issue both from that one Set (no leftover)
   - Else → **+1** to the leftover piece SKU (e.g. issue Top → add 1 Bottom of that size)
   First-payment auto-issue does **not** break Sets; staff must confirm on Pending issue.

OOS sizes remain selectable in Configure Merchandise so enrollment can finish; staff fulfill later from Pending issue.

No schema change. Remaining lines = `MERCH_PENDING` minus release-log rows for
`(student_id, package_id, class_id)`. Students enrolled with 0 stock remain on
this list until stock is available and staff issues.

**Cutoff:** only enrollments / invoices on or after **2026-08-21**
(`PACKAGE_MERCH_PENDING_ISSUE_CUTOFF_YMD`) appear. Earlier MERCH_PENDING rows
are hidden from this tab.

## API

| Method | Path | Role |
|--------|------|------|
| GET | `/merchandise/package-pending?branch_id=` | Superadmin, Admin |
| POST | `/merchandise/package-pending/issue` | Superadmin, Admin |

Issue body: `{ invoice_id, student_id, line_key }`.

Issue is blocked until first package payment (or a prior partial issue) **and**
branch qty ≥ needed. Only lines with a **concrete stock row** at the branch are
listed (true out-of-stock / ready-to-issue). Placeholder package SKUs with no
matching branch stock row are omitted. Stock is resolved by merchandise id, then
name/size/type. Duplicate student+class+package+line is collapsed.
UI: out-of-stock enrollments first, then by latest `enrolled_at` (class student),
10 rows per page — so the newest OOS enrollment is row 1 of page 1.
