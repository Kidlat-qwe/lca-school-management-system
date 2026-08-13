# Merchandise Returns (frontend utils)

Helpers for Branch Admin **Return Stock** (send existing branch inventory back to RHET).

| Export | Purpose |
|---|---|
| `getReturnableBranchStockRows` | Concrete `merchandisestbl` rows on this branch with qty > 0 (type shells excluded) |
| `getReturnStockCategoryNames` | Unique existing categories from those rows |
| `getReturnStockVariantsForCategory` | Gender/type/size or item/sku variants for one category |
| `formatReturnStockVariantLabel` | Dropdown label for a stock row |
| `createEmptyReturnLine` / `buildReturnStockSubmitPayload` | Return Stock modal cart → `POST /merchandise-requests/returns/batch` |
| `getAvailableReturnQty` / `constrainReturnQuantity` / `isReturnQtyInputAllowed` / `nextReturnQtyAfterKey` | Return Qty cannot be typed above on-hand stock |
| `isStockReturnRequest` / `wrapStockReturnReason` / `unwrapStockReturnReason` | Local log marker `[STOCK_RETURN]` (no extra DB column) |

## Rules

1. Category dropdown = **existing branch types with stock only** (not the full RHET catalog).
2. Variant dropdown = existing stock rows for that category.
3. Return qty per row cannot exceed available qty. The modal **blocks keystrokes
   and paste** above on-hand stock; the API also rejects `INSUFFICIENT_STOCK`.
3b. One category per row (same as Request Stock) — already-selected categories are
   hidden on other rows.
4. Submit goes to CMS `POST /merchandise-requests/returns/batch`. CMS deducts branch stock and forwards one RHET `POST /stock-returns` with shared `batchReference` (`PSMS-RET-<id>`).

```js
import {
  getReturnableBranchStockRows,
  buildReturnStockSubmitPayload,
} from '../utils/merchandiseReturns';
```
