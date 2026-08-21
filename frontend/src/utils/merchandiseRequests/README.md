# Merchandise Requests (frontend utils)

Shared helpers for Admin / Superadmin Merchandise **stock request** and
**Create Merchandise Type** UI.

| File | Purpose |
|---|---|
| `approvedBy.js` | Display label for who approved/rejected a request. |
| `bundleBom.js` | LEARNING_KIT bundle detection, supplies-only BOM, catalog slot resolution, `categorizeBomSlots`/`getBomKind` (mirror: backend `bundleBom.js`). |
| `learningKit.js` | Bundle kit recipes from catalog `components[]`, component validation/serialize for Request Stock. |
| `catalogOptions.js` | RHET catalog unwrap, stale-cache warning vs blocking error, uniform-like detection, gender/type/size and non-uniform item options for Request Stock. |
| `catalogBundleFilter.js` | Virtual-bundle filter: parent categories (Tool Kit) show kit SKUs only, not raw BOM parts in `components[]`. |
| `createTypeCategory.js` | Catalog-driven category options + defaults for Add Merchandise Type; stock type names for Promo (no hard-coded category lists). |
| `trackProgress.js` | Build Pending → Shipped → Delivered / Returned / Rejected steps for Track request modal. |
| `requestActionMenu.js` | Ellipsis menu items + `canConfirmReceived` (Shipped, not return, has RHET id). Admin My Requests Shipped tab uses checkboxes for bulk Confirm received. |
| `requestStatusModules.js` | Count/filter/paginate helpers for My Requests status modules (Pending / Shipped / Delivered / Returned / Rejected). |
| `uniqueCartCategory.js` | Request / Return carts: one category per row (no double-select). |

**Return Stock** (existing branch qty → RHET warehouse) lives in
`frontend/src/utils/merchandiseReturns/` and
`components/merchandise/ReturnStockModal.jsx`. Admin Merchandise submits
`POST /merchandise-requests/returns/batch`. RHET create `PENDING` is success.
My Requests: **Pending** until `stock_return.accepted`, then **Returned**.

## Catalog is the source of truth for category dropdowns

1. Load categories + items from CMS proxy `GET /merchandise-requests/inventory/catalog` (never call RHET from the browser).
   CMS may return a short-lived / stale cached catalog (`meta.cached` / `meta.stale`) when RHET `/catalog` is briefly down.
   Treat that as a **warning**, not a blocking error: `describeInventoryCatalogLoad` keeps Submit enabled when categories loaded.
   Real failures (empty catalog, 401, no cache) still block Request Stock.
2. **Create Merchandise Type** and **Request Stock** category dropdowns use
   `getCreateMerchandiseCategoryOptions(catalog)` — exact RHET `categoryName` values only.
3. Prefer `categories[].categoryKind` for form mode:
   - `SCHOOL_UNIFORM` / `PE_UNIFORM` / `LCA_SHIRT` → Gender + Type/Logo + Size
     (Shirt logos from RHET catalog: `ACC`, `Beeli`, `LCA`, or legacy `Logo 1`/`Logo 2`)
   - `OTHER` → concrete catalog item (`itemName` + `sku`)
   - `LEARNING_KIT` → kit item + `components[]`
   Name heuristics are fallback only when kind is missing (`Shirt` is still uniform).
4. Uniform options MUST come from catalog items for that category (no inventing Logo/gender/size).
5. Submit the whole cart to `POST /merchandise-requests/batch` with shared
   `request_reason` + `items[]` (`category_name` + optional `category_kind` +
   attrs / `item_name`/`sku` + kit `components`). CMS forwards one RHET
   `/stock-requests` with top-level `batchReference` and unique per-line
   `externalReference`.
6. Promo free-merchandise optgroups use `getMerchandiseTypeNamesFromStock(merchandise)`
   (unique `merchandise_name` from branch stock — not a frozen CMS array).
7. If inventory env is missing (`INTEGRATION_DISABLED`), Create Merchandise Type falls back to
   legacy free-text; Request Stock still requires integration when forwarding to RHET.

Do **not** reintroduce hard-coded arrays like
`['School Uniform', 'PE Uniform', 'Backpack', …]` or
`['LCA Uniform', 'LCA Bag', …]` as the primary dropdown source.

## Add Merchandise Type (category + image only)

Creating a branch merchandise type is **not** Request Stock and must not invent local taxonomy
(Uniform vs Other toggles, gender/size/piece, custom type codes).

| Field | Rule |
|---|---|
| Category | Required. Exact RHET `categoryName` from catalog proxy. |
| Image | Required when inventory integration is enabled. |
| Learning Kit | Hidden from create-type dropdown by default (`excludeLearningKit: true`). |
| Already added | Pass `excludeNames` so branch types already present are omitted. |
| Edit type | Image always. Category editable when current name is **not** an exact RHET `categoryName` (`canEditMerchandiseTypeCategory`). Catalog is loaded on edit (not only on create). Aligned types stay locked. |
| Stock / sizes | Come later from Request Stock / View Stocks — type create posts a CMS **type shell** only. |
| View Stocks | Type-shell rows are hidden via `isMerchandiseTypeShellRow` (empty table until real stock). |
| Request Stock (Admin) | Category dropdown = branch types ∩ RHET catalog (`getRequestStockCategoryOptions`). |

```js
getCreateMerchandiseCategoryOptions(catalog, {
  excludeLearningKit: true,
  excludeNames: existingTypeNames,
});
isCreateMerchandiseTypeMode({ editingMerchandise, editingMerchandiseType, viewingStocksFor });
```

Backend `POST /merchandise` accepts a type shell (`quantity` + attrs blank) with
`allowTypeShell` and rejects a duplicate type name per branch.

## Learning Kit

RHET kits are virtual (category-slot BOM). CMS recipes live in
`frontend/.../learningKit.js` and `backend/services/inventory/learningKitRecipes.js`
(keep in sync). Prefer live RHET catalog kit `components[]` when present.
(keep in sync). Missing recipe → clear error, not silent submit.

## Catalog helpers

```js
import {
  unwrapCatalogPayload,
  describeInventoryCatalogLoad,
  isStaleOrCachedCatalog,
  isUniformLikeCategory,
  buildCatalogRequestPayload,
} from '../utils/merchandiseRequests/catalogOptions';
```

## Create Merchandise Type helpers

```js
import {
  getCreateMerchandiseCategoryOptions,
  applyCreateTypeCategoryDefaults,
  getMerchandiseTypeNamesFromStock,
  isInventoryIntegrationDisabledError,
  isCreateMerchandiseTypeMode,
} from '../utils/merchandiseRequests/createTypeCategory';
```

Use with `RhetCategorySelect` — never free-text invent category names when the catalog is available.
