# RHET Inventory Integration Service

Backend-only client for the **RHET Centralized Inventory Management System**
machine-to-machine API.

## Business flow (current)

1. Branch Admin submits **Request Merchandise Stock** in CMS.
2. CMS saves the request and forwards it to RHET `POST /stock-requests`.
3. **CMS Superadmin is not notified** and does not approve these requests.
4. RHET Inventory admin approves on **Stock Requests**.
5. RHET sends webhook `stock_request.fulfilled` to CMS.
6. CMS **automatically adds** the requested quantity to the branch's
   `merchandisestbl` and marks the local request `Approved`.
7. Branch Admin is notified that stock was added.

On reject/fail, CMS marks the local request `Rejected` and notifies the Admin.

## RHET matching (structured attributes)

RHET matches uniform stock on exact `categoryName + gender + type + size`, not
free text. **Create Merchandise** (Superadmin) and **Request Stock** now use the
same RHET-canonical labels in CMS:

| Field | Stored CMS values (aligned with RHET) |
|---|---|
| Category (`merchandise_name`) | `School Uniform`, `PE Uniform`, `LCA T-Shirt`, `Backpack`, … |
| Gender | `Male`, `Female`, `Unisex` |
| Size | `XS` … `5XL` |
| Type | `Polo`, `Short`, `Blouse`, `Skirt`, `Shirt`, `Pants` |

Legacy labels (`LCA Uniform`, `Men`, `Extra Small`) are still recognized on read
and normalized on write. Migration **129** + script
`migrateMerchandiseLabelsToRhet.js` rewrite existing rows.

Request Stock prefers catalog / `inventory_*` fields; fulfill maps RHET → local
with identity for the new canonical names.

## Learning Kit (not yet supported)

Learning Kit stock requests are **blocked** in CMS Request Stock
(`isLearningKitCategory()` in `inventoryFieldMapping.js`, enforced in
`POST /api/v1/merchandise-requests`). RHET matches kits via a category-slot
bill of materials plus a request-time `components[]` array that CMS does not
collect yet. Branches must request Learning Kit stock directly in RHET
Inventory until kit support is implemented in a future pass. Kit fulfillment
into `merchandisestbl` is out of scope while kits are blocked.

## Environment variables (backend `.env` only)

| Variable | Required | Description |
|---|---|---|
| `INVENTORY_API_URL` | Yes | e.g. `https://api-inventory.lca-app.com/api/v1/integrations` |
| `INVENTORY_INTEGRATION_KEY` | Yes* | Key from RHET → Management → API Keys |
| `INVENTORY_API_KEY` | Yes* | Alias for `INVENTORY_INTEGRATION_KEY` |
| `INVENTORY_WEBHOOK_URL` | Recommended | e.g. `https://api-cms.lca-app.com/api/webhooks/inventory` |
| `INVENTORY_SYSTEM_CODE` | No (default `PSMS`) | Prefix for `externalReference` |

\* Set one of the two key variables.

When integration env is missing, CMS falls back to the legacy Superadmin-approval flow.

## Files

| File | Purpose |
|---|---|
| `inventoryClient.js` | HTTP client to RHET |
| `inventoryFieldMapping.js` | Label mapping + `externalReference` |
| `applyMerchandiseRequestStock.js` | Adds fulfilled qty to branch `merchandisestbl` |
| `runMerchRequestSql.js` | Retries merch-request UPDATEs if `updated_at` column is missing |

## Webhook

`POST /api/webhooks/inventory` (`backend/routes/inventoryWebhooks.js`):

- Auth: `X-Integration-Key` / `Bearer` matching CMS integration key
- `FULFILLED` → add branch stock + mark `Approved` (idempotent)
- `REJECTED` / `FAILED` → mark `Rejected` + notify Admin
- Stores `inventory_processed_by` via `pickApproverName`:
  `processedBy` → `approvedBy` → `processedByName` → `rejectedBy` (skips UUIDs).
  Never uses `processedByUserId`.
- Written on **fulfilled / rejected** (matched by `status` or `event` name).
- Re-delivered webhooks backfill Approved By even if local status is already terminal.
- Does **not** notify Superadmin
- UPDATEs use `runIgnoringMissingUpdatedAt` so a missing `updated_at` column
  returns 200 after retry (then apply migration **130**). Never query
  `merchandisestbl.updated_at` (that table has no such column).

## Database columns

| Migration | Columns |
|---|---|
| `124_...` | `inventory_request_id`, `inventory_status`, `inventory_external_reference`, `inventory_matched_sku`, `inventory_rejection_reason`, `inventory_synced_at` |
| `126_...` | `inventory_processed_by` |
| `128_...` | `inventory_category_name`, `inventory_item_name`, `inventory_requested_sku` |
| `129_...` | Gender/type CHECKs allow Male/Female + Blouse/Skirt (RHET-aligned) |
| `130_...` | Ensure `merchandiserequestlogtbl.updated_at` exists (PSMS-33 500 fix) |

## Repair stuck FULFILLED (e.g. PSMS-33)

When RHET is `FULFILLED` but CMS stayed `Pending` (webhook 500 / missed delivery):

1. Deploy webhook fix + run migration **130**.
2. Repair one of:
   - `POST /api/v1/merchandise-requests/:id/sync-inventory` (Admin/Superadmin)
   - `node scripts/repairInventoryFulfillment.js --request-id=<localId>`
   - Ask RHET to resend: `node scripts/resend-processed-by-webhook.mjs PSMS-<n> --send`
3. Verify: local status `Approved`, `inventory_status = FULFILLED`, Approved By name set,
   branch stock increased **once**; replaying fulfill webhook does not double stock.

Find other stuck rows (local Pending + has inventory id):

```sql
SELECT request_id, status, inventory_status, inventory_external_reference,
       inventory_request_id, inventory_processed_by
FROM merchandiserequestlogtbl
WHERE inventory_request_id IS NOT NULL
  AND status = 'Pending'
  AND COALESCE(inventory_status, '') NOT IN ('REJECTED', 'FAILED', 'CANCELLED');
```

Then confirm each against RHET; if RHET is FULFILLED, run sync/repair above.

## Regression checklist

- `node backend/tests/runMerchRequestSql.test.js` — strip/retry helper
- Grep: no `merchandisestbl` SQL should reference `updated_at`
- Fulfill webhook → 200, Approved, stock +qty once; replay → 200, stock unchanged
- Reject webhook → Rejected, no stock add

## Price when creating a new merchandise row

If the branch does not yet have that item:

1. Use price from `merchandise_id` reference (if set)
2. Else use price from the same item on any other branch
3. Else use `0` (Admin/Superadmin can edit price later on Merchandise)
