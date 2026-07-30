# Learning Kit recipes (CMS)

Static BOM category slots for Learning Kit Request Stock until RHET `/catalog`
returns live kit BOM.

## Why

RHET kits are **virtual**: warehouse BOM = category slots only
(e.g. LCA T-Shirt + Tool Kit + Workbooks). CMS must send `components[]` with
concrete choices when requesting. Available kits on RHET = min(category totals).

## Config

1. Built-in map: `learningKitRecipes.js` (`BUILTIN_RECIPES`)
2. Optional override / extras: backend env `LEARNING_KIT_RECIPES_JSON`

Example env JSON:

```json
{
  "nc-kg-learningkits": {
    "itemName": "nc-kg-learningkits",
    "sku": "LEA-NC-KG-LEARNINGKITS",
    "label": "NC KG Learning Kits",
    "slots": [
      { "categoryName": "LCA T-Shirt", "kind": "uniform", "minCount": 1 },
      { "categoryName": "Tool Kit", "kind": "other", "minCount": 1 },
      { "categoryName": "Workbooks", "kind": "other", "minCount": 1 }
    ]
  }
}
```

If a kit is selected in Request Stock but has no recipe, CMS returns:
**Kit recipe not configured in CMS** (better than silent wrong components).

When RHET exposes BOM on catalog/detail, switch to live BOM and deprecate this map.
