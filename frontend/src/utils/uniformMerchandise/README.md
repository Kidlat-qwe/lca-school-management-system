# Uniform merchandise helpers

Shared logic for **LCA Uniform** and **LCA PE Uniform** (separate upper/lower stock rows via `merchandisestbl.type`).

Implementation lives in `index.js`. Imports use `../../utils/uniformMerchandise` (resolved via `uniformMerchandise.js` re-export for Vite).

## Piece labels (by merchandise)

| Merchandise | Upper piece | Lower piece |
|-------------|-------------|-------------|
| School uniform (`LCA Uniform`, names containing “uniform” but not “pe”) | **Polo** | **Short** |
| PE uniform (name contains `pe`) | **Shirt** | **Pants** |

Enrollment/package matching still uses Top/Bottom **roles**:
`Polo`/`Shirt` → Top, `Short`/`Pants` → Bottom (via `getUniformCategory` / `isUpperUniformPiece` / `isLowerUniformPiece`).

Legacy `Top` / `Bottom` values remain valid in the DB for existing rows.

## Locked product model

Always **separate upper and lower SKUs** (no `Complete Set` type).

| Scenario | How it works |
|----------|----------------|
| Full set, same size | Two stock rows with the same size; enroll can use **Use same size for Top & Bottom** |
| Different sizes | Separate upper vs lower size selections (per student) |

Canonical type names (keep in sync with backend `PACKAGE_UNIFORM_TYPE_NAMES`):

- `UNIFORM_SCHOOL_NAME` → `LCA Uniform`
- `UNIFORM_PE_NAME` → `LCA PE Uniform`

## Key exports

- `getUniformPieceOptions(name)` — Polo/Short or Shirt/Pants for forms
- `getUniformPieceLabels(name)` — `{ upper, lower }` badge labels
- `isUpperUniformPiece` / `isLowerUniformPiece`
- `requiresUniformPieceFields(name)` — form requires Size, Gender, Piece
- `countUniformPiecesByType(stocks)` — upper/lower counts for stock-list badges
- `findUniformStockByNameSizeCategory(...)` — resolve stock for enrollment
