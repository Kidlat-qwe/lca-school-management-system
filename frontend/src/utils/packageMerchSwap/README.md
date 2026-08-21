# Package merchandise keep / swap

Enroll-time controls for package-included freebies:

| Action (API) | UI label | Meaning |
|--------------|----------|---------|
| `issue` | **Keep** | Deduct/release the included type (default) |
| `swap` | **Swap** | Deduct a different item instead (0 stock allowed; issue after restock) |

`waive` remains accepted by the backend for older pending lines, but is **not**
offered in the enroll UI.

## Persistence (no schema change)

Lines go on `POST /classes/:id/enroll` → `selected_merchandise[]` and are stored in
invoice `remarks` as `MERCH_PENDING:[...]` with optional fields:

- `action`
- `original_type_name`
- `reason`

## Who gets Keep / Swap

Not a hard-coded category allowlist and not RHET catalog–driven.

`isPackageMerchSwappable(typeName)` is true for any package-included freebie that is
**not** sizing/uniform / Shirt / Learning Kit. Configure Items then shows Keep/Swap
for those types (e.g. Backpack, Workbooks, Toga, or any future CMS type).

Multi-SKU item types (Tool Kit / Moving Up Kit with **more than one** stock row)
use `PackageMerchItemVariantPanel` instead — callers exclude them from the swappable
list via `requiresPackageItemVariantSelection`.

## Swap targets

`getPackageMerchSwapOptions(merchandiseList, { originalTypeName })` — other **existing
branch merchandise** rows in CMS (`merchandisestbl`), excluding:

- the original type
- type-shell placeholders
- uniforms / Learning Kit

No RHET live catalog call for the swap dropdown.

## Item-keyed variants

Types with multiple RHET `itemName` / `sku` rows use
`requiresPackageItemVariantSelection` + `PackageMerchItemVariantPanel`.

## UI

`components/packageMerch/PackageMerchEntitlementPanel.jsx` — per student Keep / Swap on the
**Configure Merchandise** enroll step. Keep shows total stock for the included type;
Swap options use `formatPackageMerchSwapOptionLabel` (`(N in stock)`).

Review & Enroll uses `resolvePackageMerchInclusionDisplay` so a swapped freebie
(e.g. Backpack → ID Lace) shows the replacement name, image, and
“Swapped from Backpack”.

`PACKAGE_MERCH_SWAPABLE_TYPE_NAMES` is deprecated (empty) and must not be used as an
allowlist.
