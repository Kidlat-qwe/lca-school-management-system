# Uniform merchandise helpers

Shared logic for **School Uniform**, **PE Uniform**, **Shirt (LCA_SHIRT)**, and
related stock rows via `merchandisestbl.type`.

Implementation lives in `index.js`. Imports use `../../utils/uniformMerchandise`
(resolved via `uniformMerchandise.js` re-export for Vite).

## RHET-aligned labels (stored values)

Creating / editing merchandise persists the **same vocabulary as RHET Inventory**:

| Field | Stored values |
|-------|----------------|
| Category (`merchandise_name`) | `School Uniform`, `PE Uniform`, `Shirt`, `Backpack`, … |
| Gender | `Male`, `Female`, `Unisex` |
| Size | `XS`, `S`, `M`, `L`, `XL`, `2XL`, `3XL`, `4XL`, `5XL`, `Teen` |
| Type / piece | `Polo`, `Short`, `Blouse`, `Skirt`, `Shirt`, `Pants`, `Logo 1`, `Logo 2`, `Set` |

Legacy values (`LCA Uniform`, `Men`, `Extra Small`, …) are still **recognized on
read** and **normalized on write** via `normalizeMerchandiseAttributes()`.

## Piece labels (by category + gender)

| Category | Gender | Pieces |
|----------|--------|--------|
| School Uniform | Male | Polo, Short, Set |
| School Uniform | Female | Blouse, Skirt, Set |
| PE Uniform | any | Shirt, Pants, Set |
| Shirt (LCA_SHIRT) | any | Logo 1, Logo 2, ACC, Beeli, LCA (from RHET catalog) |

Enrollment / Configure Merchandise roles (`getUniformCategory`):

- `Polo` / `Shirt` / `Blouse` / `Logo *` → **Top**
- `Short` / `Pants` / `Skirt` → **Bottom**
- `Set` → **Set** (full uniform in one SKU)

Sizing is complete when the student picks **Set**, or every piece role that
exists in branch stock (Top and/or Bottom). See
`isStudentUniformSelectionComplete`.

## Product model

Prefer separate upper/lower SKUs when RHET stocks them that way. RHET may also
stock type **`Set`** (one row = full uniform). Enrollment shows a **Set** tab
whenever Set stock exists for that category.

Canonical type names (also accept legacy):

- `UNIFORM_SCHOOL_NAME` → `School Uniform` (legacy: `LCA Uniform`)
- `UNIFORM_PE_NAME` → `PE Uniform` (legacy: `LCA PE Uniform`)

Keep in sync with backend `PACKAGE_UNIFORM_TYPE_NAMES`.

## Key exports

- `normalizeMerchandiseAttributes` / `normalizeMerchandiseGender` / `normalizeMerchandiseSize`
- `getUniformGenderOptions(name)` — Male/Female (School) or + Unisex
- `getUniformPieceOptions(name, gender)` — gender-filtered pieces (includes Set)
- `getUniformCategory` / `listUniformStockCategories` / `isStudentUniformSelectionComplete`
- `isSchoolUniformMerchandiseName` / `isPeUniformMerchandiseName` / `isUniformMerchandiseName`
- `UNIFORM_SIZE_OPTIONS` — RHET sizes
- `formatUniformSizeDisplayLabel(size)` — optional friendly label
