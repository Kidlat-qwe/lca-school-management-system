# Package merchandise keep / swap

Enroll-time controls for package-included freebies (e.g. Backpack):

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

## Swappable types

`PACKAGE_MERCH_SWAPABLE_TYPE_NAMES` — Backpack, ID Lace, Book/Workbook, etc.
Uniforms / Shirt / Learning Kit stay on sized Configure Merchandise.

## UI

`components/packageMerch/PackageMerchEntitlementPanel.jsx` — per student Keep / Swap on the **Configure Merchandise** enroll step. Keep shows total stock for the included type; Swap options use `formatPackageMerchSwapOptionLabel` (`(N in stock)`).

Review & Enroll uses `resolvePackageMerchInclusionDisplay` so a swapped freebie
(e.g. Backpack → ID Lace) shows the replacement name, image, and
“Swapped from Backpack”.

Swap options exclude **type-shell** rows (`isMerchandiseTypeShellRow`) so the
dropdown matches Merchandise → View Stocks (real stock lines only, not the
category placeholder).
