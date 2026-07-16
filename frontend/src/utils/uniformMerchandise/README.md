# Uniform merchandise helpers

Shared logic for **LCA Uniform** and **LCA PE Uniform** (separate Top / Bottom stock rows via `merchandisestbl.type`).

Implementation lives in `index.js`. Imports use `../../utils/uniformMerchandise` (resolved via `uniformMerchandise.js` re-export for Vite).

## Locked product model

Always **separate Top and Bottom SKUs** (no `Complete Set` type).

| Scenario | How it works |
|----------|----------------|
| Full set, same size | Two stock rows with the same size (Top + Bottom); enroll can use **Use same size for Top & Bottom** |
| Different sizes | Separate Top vs Bottom size selections (per student) |
| Stock entry pair shortcut | Merchandise form **Top & Bottom pair (same size)** creates two POST rows in one submit |

Canonical type names (keep in sync with backend `PACKAGE_UNIFORM_TYPE_NAMES`):

- `UNIFORM_SCHOOL_NAME` → `LCA Uniform`
- `UNIFORM_PE_NAME` → `LCA PE Uniform`
- `UNIFORM_TOP_BOTTOM_TYPE_NAMES` → both of the above

## Exports

- `isUniformTopBottomType(name)` — whether Configure Merchandise uses Top/Bottom tabs
- `isUniformMerchandiseName(name)` / `requiresUniformPieceFields(name)` — merchandise form requires Size, Gender, Piece
- `UNIFORM_PIECE_OPTIONS` — Top / Bottom select options
- `countUniformPiecesByType(stocks)` — Top vs Bottom counts for stock-list badges
- `findUniformStockByNameSizeCategory(..., preferredGender?)` — resolve `merchandise_id` for enrollment payload
- `findMatchingTopBottomBySize(...)` — resolve both pieces for a shared size
- `getSharedUniformSizesForTopBottom(...)` — sizes available in **both** Top and Bottom (gender-filtered)
- `getUniformSizePairAvailability(...)` — per-size `{ hasTop, hasBottom, canPair, topItem, bottomItem, gender }` for enroll same-size dropdown
- `formatUniformSameSizePairOptionLabel(row, topQty, bottomQty)` — e.g. `Medium · Men (Top 995 / Bottom 978)`
- `merchandiseGendersForStudent(studentGender)` — Male → Men/Boys/Unisex; Female → Women/Girls/Unisex
- `filterMerchandiseByStudentGender(items, studentGender)` — size-option filter for enroll UI
- `formatUniformSizeOptionLabel(item, qty)` — e.g. `Medium · Men (12)`
- `formatMerchandiseGenderLabel(gender)` — Men / Women / Unisex display labels

Keep `UNIFORM_TOP_BOTTOM_TYPE_NAMES` aligned with backend `PACKAGE_UNIFORM_TYPE_NAMES` in `backend/lib/merchandiseReleaseLog.js`.
