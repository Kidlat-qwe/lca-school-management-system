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
- Does **not** notify Superadmin

## Price when creating a new merchandise row

If the branch does not yet have that item:

1. Use price from `merchandise_id` reference (if set)
2. Else use price from the same item on any other branch
3. Else use `0` (Admin/Superadmin can edit price later on Merchandise)
