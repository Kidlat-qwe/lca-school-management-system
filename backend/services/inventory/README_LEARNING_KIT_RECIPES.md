# Learning Kit recipes (CMS)

BOM category slots for Learning Kit Request Stock.

## Source of truth (preferred)

RHET `GET /catalog` Learning Kit items include live **`components[]`** BOM
(`stockMode: VIRTUAL_BUNDLE`, `bomComplete: true`). CMS derives recipe slots from
that payload when you pick a kit in Request Stock.

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
