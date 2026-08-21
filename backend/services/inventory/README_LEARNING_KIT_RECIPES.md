# Learning Kit / bundle recipes (CMS)

BOM category slots for **LEARNING_KIT** bundle Request Stock (Learning Kit, Tool Kit, Moving Up Kit, …).

## Source of truth (preferred)

RHET `GET /catalog` bundle items (`categoryKind: LEARNING_KIT`) include live **`components[]`** BOM
(`stockMode: VIRTUAL_BUNDLE`, `bomComplete: true`). CMS derives recipe slots from
that payload — **no duplicate CMS recipe** when catalog exposes BOM, especially
supplies-only bundles (all slot categories have `categoryType: SUPPLIES`).

Helpers: `bundleBom.js` (`isRhetBundleCategory`, `isSuppliesOnlyBom`, `resolveKitBomSlots`, `categorizeBomSlots`, `getBomKind`).

## Three-tier BOM rendering (UI + validation)

| BOM kind | Description | UI behavior |
|---|---|---|
| **All SUPPLIES** | Every slot has `categoryType: SUPPLIES` | No component pickers. Auto-filled from catalog. Badge shown. Backend accepts empty `components[]`. |
| **All MERCHANDISE** | Every slot has `categoryType: MERCHANDISE` | Full pickers for every slot (existing behavior). |
| **Mixed** | Mix of SUPPLIES + MERCHANDISE slots | Pickers only for MERCHANDISE slots; SUPPLIES slots auto-fill. |

Slot `kind` values in recipe:
- `'supplies'` — auto-fillable (`categoryType: SUPPLIES`)
- `'uniform'` — MERCHANDISE uniform (gender + type + size)
- `'other'` — MERCHANDISE item (itemName + sku picker)

Example **NC Learning Kit** (`nc-learningkit` / `LEA-NC-LEARNINGKIT`):

- Shirt (uniform — gender + logo/type + size)
- Tool Kit (pick catalog item)
- Workbooks (pick catalog item)

Other kits may also include **ID Lace**.

## Fallback

When catalog BOM is unavailable, static maps apply:

1. Built-in map: `learningKitRecipes.js` (`BUILTIN_RECIPES`)
2. Optional override / extras: backend env `LEARNING_KIT_RECIPES_JSON`

If a kit has no catalog BOM and no static recipe, CMS shows:
**Kit recipe not configured** (better than silent wrong components).
