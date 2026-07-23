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
free text. `inventoryFieldMapping.js` maps CMS merchandise fields to those
exact labels:

| Field | CMS source | Mapped RHET values |
|---|---|---|
| `categoryName` | `merchandise_name` (e.g. `LCA Uniform`, `LCA PE Uniform`) | `School Uniform`, `PE Uniform`, or passthrough for non-uniform names |
| `gender` | `gender` (`Men`/`Women`/`Boys`/`Girls`/`Unisex`) | `Male`, `Female`, `Unisex` |
| `type` | `type` (`Polo`/`Short`/`Shirt`/`Pants`, legacy `Top`/`Bottom`) | `Polo`/`Short` (School Uniform), `Shirt`/`Pants` (PE Uniform) |
| `size` | `size` (`Extra Small`…`4XL`) | `XS`…`5XL` |

**Polo and Shirt are never interchangeable.** School Uniform pieces map to
`Polo`/`Short`; PE Uniform pieces map to `Shirt`/`Pants`. Non-uniform items
(Backpack, Book, etc.) match on `categoryName` + `itemName` instead.

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

## Database columns

| Migration | Columns |
|---|---|
| `124_...` | `inventory_request_id`, `inventory_status`, `inventory_external_reference`, `inventory_matched_sku`, `inventory_rejection_reason`, `inventory_synced_at` |
| `126_...` | `inventory_processed_by` |

## Price when creating a new merchandise row

If the branch does not yet have that item:

1. Use price from `merchandise_id` reference (if set)
2. Else use price from the same item on any other branch
3. Else use `0` (Admin/Superadmin can edit price later on Merchandise)
