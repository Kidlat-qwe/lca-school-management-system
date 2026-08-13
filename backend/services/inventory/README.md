# RHET Inventory Integration Service

Backend-only client for the **RHET Centralized Inventory Management System**
machine-to-machine API.

## Business flow (current)

1. Branch Admin submits **Request Merchandise Stock** in CMS.
2. CMS saves the request line(s) and forwards them to RHET `POST /stock-requests`
   with top-level `branchName` = campus display name from `branchestbl`
   (e.g. `"LCA Makati"`). RHET requires this field (min 2 chars) for the
   Stock Requests **Branch** column; CMS blocks submit locally if missing.
   Multi-item Request Stock uses **one** RHET POST with shared top-level
   `batchReference` (`PSMS-REQ-<first_local_id>`) and unique per-line
   `externalReference` (`PSMS-<local_id>`).
3. **CMS Superadmin is not notified** and does not approve these requests.
5. RHET marks **Shipped** (warehouse stock deducted).
   CMS webhook → local status **Shipped**; branch stock **unchanged**.
6. **Branch Admin confirms receipt** in CMS (⋮ → Confirm received, or Track modal).
   CMS calls RHET `POST /stock-requests/:id/deliver` (hardcoded **/deliver** path):
   - SHIPPED → DELIVERED; RHET returns **409** if not SHIPPED
   - Already DELIVERED → **200 idempotent** (safe CMS retry; no re-webhook)
   CMS then credits branch `merchandisestbl` once (idempotent with later
   `stock_request.delivered` / legacy `.fulfilled` webhooks).
7. Optional: RHET marks **Returned**. If `wasDelivered` (or local was
   Delivered/Approved), CMS reverses the branch credit; otherwise status only.
8. Branch Admin is notified on shipped / delivered / returned / rejected.
9. Branch Admin **Return Stock** deducts on-hand branch qty immediately and
   forwards one RHET `POST /stock-returns` (`requestType: RETURN`,
   `batchReference` `PSMS-RET-<id>`, per-line `PSMS-RET-<id>`). Local log status
   is **Returned**. RHET failure rolls back qty + log rows.

On reject: CMS marks the local request `Rejected` and notifies the Admin.

### Local statuses (UI)

`Pending` → `Shipped` → `Delivered` → optional `Returned`  
`Pending` / `Shipped` → `Rejected`  
Legacy `Approved` displays as Delivered (stock already credited).

## RHET matching (structured attributes)

RHET matches uniform stock on exact `categoryName + gender + type + size`, not
free text. **Request Stock** form mode prefers catalog `categoryKind`:

| categoryKind | Form mode | Required fields |
|---|---|---|
| `SCHOOL_UNIFORM` | Uniform | gender + type + size |
| `PE_UNIFORM` | Uniform | gender + type + size |
| `LCA_SHIRT` | Uniform (Shirt) | gender + type (`Logo 1`/`Logo 2`) + size |
| `LEARNING_KIT` | Kit | itemName/sku + components[] |
| `OTHER` (or missing + not kit) | Non-uniform | itemName + sku |

Name heuristics are **fallback only** when `categoryKind` is missing
(e.g. plain name `Shirt` is still uniform). Never treat Shirt as Item/SKU-only.

| Field | Stored CMS values (aligned with RHET) |
|---|---|
| Category (`merchandise_name`) | `School Uniform`, `PE Uniform`, `Shirt`, `Backpack`, … |
| Gender | `Male`, `Female`, `Unisex` |
| Size | `XS` … `5XL`, `Teen` |
| Type | `Polo`, `Short`, `Blouse`, `Skirt`, `Shirt`, `Pants`, `Logo 1`, `Logo 2` |

Migration **134** allows `Logo 1` / `Logo 2` on merchandise + request-log type CHECKs.
Legacy labels (`LCA Uniform`, `Men`, `Extra Small`) are still recognized on read
and normalized on write. Migration **129** + script
`migrateMerchandiseLabelsToRhet.js` rewrite existing rows.

Request Stock prefers catalog / `inventory_*` fields; fulfill maps RHET → local
with identity for the new canonical names. Fulfill type name = RHET
`categoryName` only (e.g. type `Shirt`, never `Logo 1`).

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
| `inventoryClient.js` | HTTP client to RHET (`/stock-requests`, `/stock-returns`, `/deliver`, catalog) |
| `inventoryFieldMapping.js` | Label mapping + `externalReference` + `batchReference` / `PSMS-RET-*` return refs + `branchName` |
| `stockRequestLifecycle.js` | PENDING → SHIPPED → DELIVERED / RETURNED / REJECTED helpers |
| `applyMerchandiseRequestStock.js` | Adds / reverses / deducts qty on branch `merchandisestbl` |
| `runMerchRequestSql.js` | Retries merch-request UPDATEs if `updated_at` column is missing |

**Fulfill matching (critical):** CMS type = RHET `categoryName` (`Backpack` /
`Shirt`), never RHET `itemName` (`lca-backpack`) or Logo (`Logo 1`). Prefer
`merchandise_id` on the request **only when** that row matches identity.
Uniforms (including `LCA_SHIRT` / `Shirt`): match gender + type/Logo + size;
never credit blank Gender/Type (“Unspecified piece”) shells when identity is
present — create an identified row instead. Non-uniforms: match item_name/sku.

Identity for fulfill is resolved by `resolveUniformFulfillIdentity`:
1. Local request `gender` / `type` / `size`
2. Webhook payload fields
3. Optional parse of `matchedSku` (e.g. `SHI-U-LOGO1-XS`)

Webhook then sets `merchandiserequestlogtbl.merchandise_id` to the credited
identified stock row. Do **not** rely on `repairBlankUniformStockFromRequests.js`
for normal fulfills — that script is one-time legacy cleanup only.

## Webhook

`POST /api/webhooks/inventory` (`backend/routes/inventoryWebhooks.js`):

- Auth: `X-Integration-Key` / `Bearer` matching CMS integration key
- `SHIPPED` → local **Shipped**; **no** branch stock add
- `DELIVERED` → local **Delivered** + add branch stock (idempotent)
- Legacy `FULFILLED` / `stock_request.fulfilled` → same as delivered (credit once)
- `RETURNED` → local **Returned**; reverse branch qty if `wasDelivered`
- `REJECTED` / `FAILED` → mark `Rejected` + notify Admin
- Stores `inventory_processed_by` via `pickApproverName`:
  `processedBy` → `approvedBy` → `processedByName` → `rejectedBy` (skips UUIDs).
  Never uses `processedByUserId`.
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
| `135_...` | Document lifecycle statuses (Pending/Shipped/Delivered/Returned) |

## Repair stuck DELIVERED (e.g. PSMS-33)

When RHET is `DELIVERED` (or legacy `FULFILLED`) but CMS stayed `Pending`/`Shipped`:

1. Deploy webhook fix + run migration **130**.
2. Repair one of:
   - `POST /api/sms/merchandise-requests/:id/sync-inventory` (Admin/Superadmin)
   - `node scripts/repairInventoryFulfillment.js --request-id=<localId>`
   - Ask RHET to resend delivered webhook
3. Verify: local status `Delivered`, `inventory_status = DELIVERED`, Approved By name set,
   branch stock increased **once**; replaying delivered/fulfilled webhook does not double stock.

Find other stuck rows (local Pending/Shipped + has inventory id):

```sql
SELECT request_id, status, inventory_status, inventory_external_reference,
       inventory_request_id, inventory_processed_by
FROM merchandiserequestlogtbl
WHERE inventory_request_id IS NOT NULL
  AND status IN ('Pending', 'Shipped')
  AND COALESCE(inventory_status, '') NOT IN ('REJECTED', 'FAILED', 'CANCELLED', 'RETURNED');
```

Then confirm each against RHET; if RHET is DELIVERED, run sync/repair above.

## Regression checklist

- `node backend/tests/runMerchRequestSql.test.js` — strip/retry helper
- `node backend/tests/merchandiseFulfillTypeMatch.test.js` — category vs itemName
- `node backend/tests/stockRequestLifecycle.test.js` — shipped/delivered/returned helpers
- `node backend/tests/inventoryBranchNamePayload.test.js` — `branchName` + `batchReference` + Return Stock `PSMS-RET-*`
- Grep: no `merchandisestbl` SQL should reference `updated_at`
- Shipped webhook → 200, Shipped, stock unchanged
- Delivered webhook → 200, Delivered, stock +qty once; fulfilled alias replay → stock unchanged
- Returned (wasDelivered) → Returned, stock reversed once
- Reject webhook → Rejected, no stock add
- Branch has type Backpack qty 0 → deliver Backpack/lca-backpack → Backpack qty += N;
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
