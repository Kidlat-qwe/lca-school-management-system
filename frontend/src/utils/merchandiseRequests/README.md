# Merchandise Requests (frontend utils)

Shared helpers for Admin / Superadmin Merchandise **stock request** UI.

| File | Purpose |
|---|---|
| `approvedBy.js` | Display label for who approved/rejected a request (RHET Inventory user or CMS Superadmin). Ignores UUID user ids. |
| `learningKit.js` | Blocks Learning Kit in Request Stock (RHET kit `components[]` not supported yet). |
| `catalogOptions.js` | RHET catalog unwrap, uniform-like detection, gender/type/size and non-uniform item options for Request Stock. |

## Request Stock mental model (match RHET Inventory)

1. Load categories + items from CMS proxy `GET /merchandise-requests/inventory/catalog` (never call RHET from the browser).
2. User picks an **exact RHET `categoryName`** (not local labels like `LCA Bag`).
3. Uniform-like categories → Gender + Type + Size from catalog variants (`variation` parsed as `Gender · Type · Size`).
4. Non-uniform → pick a concrete catalog item (`itemName` + `sku`).
5. Submit to `POST /merchandise-requests` with `category_name` + attrs / `item_name`/`sku`.
6. Learning Kit stays blocked/hidden.

## Approved By

```js
import { getMerchandiseRequestApprovedBy } from '../utils/merchandiseRequests/approvedBy';

getMerchandiseRequestApprovedBy(request);
// → inventory_processed_by | reviewed_by_name | "RHET Inventory" | "—"
```

## Learning Kit block

```js
import { isLearningKitMerchandiseName, LEARNING_KIT_NOT_SUPPORTED_MESSAGE } from '../utils/merchandiseRequests/learningKit';

isLearningKitMerchandiseName('LCA Learning Kit'); // → true
```

Used to hide Learning Kit from Request Stock item pickers and to show a clear
validation error if a stale row still references it. Mirrors backend
`isLearningKitCategory()` in `backend/services/inventory/inventoryFieldMapping.js`.

## Catalog helpers

```js
import {
  unwrapCatalogPayload,
  isUniformLikeCategory,
  buildCatalogRequestPayload,
} from '../utils/merchandiseRequests/catalogOptions';
```
