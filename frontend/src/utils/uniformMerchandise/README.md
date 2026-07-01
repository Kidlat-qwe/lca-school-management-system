# Uniform merchandise helpers

Shared logic for **LCA Uniform** and **LCA PE Uniform** (separate Top / Bottom stock rows via `merchandisestbl.type`).

Implementation lives in `index.js`. Imports use `../../utils/uniformMerchandise` (resolved via `uniformMerchandise.js` re-export for Vite).

- `isUniformTopBottomType(name)` — whether Configure Merchandise uses Top/Bottom tabs
- `findUniformStockByNameSizeCategory(...)` — resolve the correct `merchandise_id` for enrollment payload

Keep `UNIFORM_TOP_BOTTOM_TYPE_NAMES` aligned with backend `PACKAGE_UNIFORM_TYPE_NAMES` in `backend/lib/merchandiseReleaseLog.js`.
