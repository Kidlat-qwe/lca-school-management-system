# Merchandise Requests (frontend utils)

Shared helpers for Admin / Superadmin Merchandise **stock request** UI.

| File | Purpose |
|---|---|
| `approvedBy.js` | Display label for who approved/rejected a request (RHET Inventory user or CMS Superadmin). Ignores UUID user ids. |
| `learningKit.js` | Blocks Learning Kit in Request Stock (RHET kit `components[]` not supported yet). |


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
