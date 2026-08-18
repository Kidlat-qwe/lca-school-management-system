# Merchandise stock helpers

Shared helpers for branch **Stocks** tables and enrollment stock picks.

| Export | Purpose |
|---|---|
| `parseMerchandiseQuantity` | Numeric qty or `null` if untracked |
| `formatStockCountLabel` | `"12 in stock"` |
| `sumMerchandiseTypeStock` | Total qty for a type (Backpack, ID Lace, …), excluding type-shell rows |
| `lookupMerchandiseQuantity` | Qty for one `merchandise_id` |
| `merchandiseHasAvailableStock` | Quantity > 0 (or untracked) |
| `pickFirstInStockMerchandiseItem` | Prefer an in-stock variant |
| `isUniformStockCategory` / `isItemNamedStockCategory` | Column layout: Gender/Type/Size vs Item name |
| `getMerchandiseStockItemName` / `getMerchandiseStockSku` | Read `item_name`/`sku`, with legacy `remarks` `"item \| sku"` fallback (ops audit notes are ignored) |
| `formatMerchandiseStockItemName` | Display for Stocks table |
| `formatMerchandiseVariantOptionLabel` | AR / picker dropdown: Item name · SKU - ₱price |
| `formatMerchandiseVariantSubtitle` | Selected-row subtitle without price |

## Data model

| Field | Meaning |
|---|---|
| `merchandise_name` | CMS type = RHET `categoryName` (Workbooks, Backpack, School Uniform, …) |
| `item_name` | Concrete RHET `itemName` for **all** non-uniform types + Learning Kit |
| `sku` | RHET SKU (required with item_name for non-uniform stock identity) |
| `remarks` | Free-text notes (not the primary item identity going forward) |

Applies to Workbooks, Backpack, Book, Accessory, ID Lace, Other, Learning Kit — **not** uniforms (Gender/Type/Size).

Migration **133** adds `item_name` / `sku` on `merchandisestbl`.

```js
import {
  isItemNamedStockCategory,
  formatMerchandiseStockItemName,
} from '../../utils/merchandiseStock';
```
