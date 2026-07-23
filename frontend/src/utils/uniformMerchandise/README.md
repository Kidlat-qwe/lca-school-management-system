# Uniform merchandise helpers

Shared logic for **School Uniform**, **PE Uniform**, and **LCA T-Shirt**
(separate upper/lower stock rows via `merchandisestbl.type`).

Implementation lives in `index.js`. Imports use `../../utils/uniformMerchandise`
(resolved via `uniformMerchandise.js` re-export for Vite).

## RHET-aligned labels (stored values)

Creating / editing merchandise persists the **same vocabulary as RHET Inventory**:

| Field | Stored values |
|-------|----------------|
| Category (`merchandise_name`) | `School Uniform`, `PE Uniform`, `LCA T-Shirt`, `Backpack`, … |
| Gender | `Male`, `Female`, `Unisex` |
| Size | `XS`, `S`, `M`, `L`, `XL`, `2XL`, `3XL`, `4XL`, `5XL` |
| Type / piece | `Polo`, `Short`, `Blouse`, `Skirt`, `Shirt`, `Pants` |

Legacy values (`LCA Uniform`, `Men`, `Extra Small`, …) are still **recognized on
read** and **normalized on write** via `normalizeMerchandiseAttributes()`.

## Piece labels (by category + gender)

| Category | Gender | Pieces |
|----------|--------|--------|
| School Uniform | Male | Polo, Short |
| School Uniform | Female | Blouse, Skirt |
| PE Uniform | any | Shirt, Pants |
| LCA T-Shirt | any | Shirt |

Enrollment/package matching still uses Top/Bottom **roles**:
`Polo`/`Shirt`/`Blouse` → Top, `Short`/`Pants`/`Skirt` → Bottom.

## Locked product model

Always **separate upper and lower SKUs** (no `Complete Set` type).

Canonical type names (also accept legacy):

- `UNIFORM_SCHOOL_NAME` → `School Uniform` (legacy: `LCA Uniform`)
- `UNIFORM_PE_NAME` → `PE Uniform` (legacy: `LCA PE Uniform`)

Keep in sync with backend `PACKAGE_UNIFORM_TYPE_NAMES`.

## Key exports

- `normalizeMerchandiseAttributes` / `normalizeMerchandiseGender` / `normalizeMerchandiseSize`
- `getUniformGenderOptions(name)` — Male/Female (School) or + Unisex
- `getUniformPieceOptions(name, gender)` — gender-filtered pieces
- `isSchoolUniformMerchandiseName` / `isPeUniformMerchandiseName` / `isUniformMerchandiseName`
- `UNIFORM_SIZE_OPTIONS` — RHET sizes
- `formatUniformSizeDisplayLabel(size)` — optional friendly label
