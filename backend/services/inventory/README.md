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

## Learning Kit (Request Stock enabled)

Learning Kit is a **virtual RHET kit**: BOM = category slots only. CMS Request Stock
collects concrete `components[]` from a CMS recipe map (`learningKitRecipes.js`).

1. Admin selects category **Learning Kit** + kit item (e.g. `nc-kg-learningkits`)
2. UI requires a choice for every recipe slot (uniform attrs or itemName/sku)
3. CMS POSTs RHET `/stock-requests` with `components[]`
4. On fulfill, CMS credits branch type **Learning Kit** (concrete kit in
   `item_name` + `sku`; migration **133**). Legacy rows may still have identity
   in `remarks` as `itemName | sku`. Request-log / merchandisestbl `type` stays
   NULL for kits (CHECK only allows uniform pieces).
5. Component categories are **not** auto-added to branch stock

See `README_LEARNING_KIT_RECIPES.md`. Migration **131** stores
`inventory_components_json` on the request row. Migration **133** adds
`merchandisestbl.item_name` / `sku` for non-uniform + kit identity.

## Non-uniform stock identity

`merchandise_name` = RHET `categoryName` (Workbooks, Backpack).
`item_name` / `sku` = concrete RHET product under that category.
Fulfill matches by category + item_name/sku — never dumps all Workbooks qty
onto one anonymous row. Stocks UI shows **Item name** (not Gender/Type) for
non-uniform categories.

**Multi-item / blank Item name bug (fixed for ALL non-uniform types):**
Submit used to auto-link every Workbooks/Backpack request to the same empty
shell `merchandise_id`. Fulfill then trusted that id and credited one anonymous
row (`item_name`/`sku` null). Also `isUniformLikeCategory` wrongly treated any
`CATEGORY_NAME_MAP` key (e.g. `LCA Bag`) as uniform. Now:
- Request Stock requires **both** itemName and sku for every non-uniform type
  (Workbooks, Backpack, Book, Accessory, ID Lace, Other, Learning Kit, …).
- Catalog picker binds itemName+sku from the **same** catalog row.
- `findExistingMerchandiseStockRow` ignores `merchandise_id` when it does not
  match the requested item identity.
- Blank (null item_name AND null sku) rows are **never** credited when identity
  is present — a new identified row is created under the **category type** instead.
- Ops: `scripts/repairBlankNonUniformStockRows.js --branch-id=… --type=all`
  (or `--type=Workbooks` / `--type=Backpack`).

## Environment variables (backend `.env` only)

| Variable | Required | Description |
|---|---|---|
| `INVENTORY_API_URL` | Yes | e.g. `https://api-inventory.lca-app.com/api/v1/integrations` |
| `INVENTORY_INTEGRATION_KEY` | Yes* | Key from RHET → Management → API Keys |
| `INVENTORY_API_KEY` | Yes* | Alias for `INVENTORY_INTEGRATION_KEY` |
| `INVENTORY_WEBHOOK_URL` | Recommended | e.g. `https://api-cms.lca-app.com/api/webhooks/inventory` |
| `INVENTORY_SYSTEM_CODE` | No (default `PSMS`) | Prefix for `externalReference` |
| `INVENTORY_HTTP_TIMEOUT_MS` | No (default `45000`) | Per-request abort timeout |
| `INVENTORY_CATALOG_CACHE_MS` | No (default `120000`) | In-memory catalog TTL; `0` disables. On RHET catalog 5xx, CMS may serve a stale cache so Request Stock still opens. |

\* Set one of the two key variables.

When integration env is missing, CMS falls back to the legacy Superadmin-approval flow.

## Files

| File | Purpose |
|---|---|
| `inventoryClient.js` | HTTP client to RHET |
| `inventoryFieldMapping.js` | Label mapping + `externalReference` |
| `applyMerchandiseRequestStock.js` | Adds fulfilled qty to branch `merchandisestbl` |
| `runMerchRequestSql.js` | Retries merch-request UPDATEs if `updated_at` column is missing |

**Fulfill matching (critical):** CMS type = RHET `categoryName` (`Backpack`), never
RHET `itemName` (`lca-backpack`) or SKU. Prefer `merchandise_id` on the request,
then match existing type name aliases (`Backpack` / `LCA Bag`), then create a row
named after `categoryName` only.

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
| `131_...` | `inventory_components_json` (Learning Kit components[] snapshot) |
| `133_...` | `merchandisestbl.item_name`, `sku` (non-uniform / kit identity under category) |

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
- `node backend/tests/merchandiseFulfillTypeMatch.test.js` — category vs itemName
- Grep: no `merchandisestbl` SQL should reference `updated_at`
- Fulfill webhook → 200, Approved, stock +qty once; replay → 200, stock unchanged
- Reject webhook → Rejected, no stock add
- Branch has type Backpack qty 0 → fulfill Backpack/lca-backpack → Backpack qty += N;
  **no** new type `lca-backpack`

### Repair mistaken itemName types

If fulfill already created `lca-backpack` (etc.):

```bash
node scripts/mergeMistakenMerchandiseTypes.js --dry-run
node scripts/mergeMistakenMerchandiseTypes.js --apply
```

## Price when creating a new merchandise row

If the branch does not yet have that item:

1. Use price from `merchandise_id` reference (if set)
2. Else use price from the same item on any other branch
3. Else use `0` (Admin/Superadmin can edit price later on Merchandise)
