# PSMS ↔ RHET Inventory API Integration Guide

Use this document when setting up PSMS to connect with the **RHET Centralized Inventory Management System**.

---

## 1. How the integration works

```text
┌─────────────────────┐         ┌──────────────────────────┐         ┌─────────────────────┐
│  PSMS Frontend      │         │  PSMS Backend            │         │  RHET Inventory API │
│  (Merchandise form) │ ──────► │  /api/merchandise/...    │ ──────► │  /integrations/...  │
└─────────────────────┘         └──────────────────────────┘         └─────────────────────┘
                                           ▲                                      │
                                           │         webhook (optional)          │
                                           └──────────────────────────────────────┘

1. User fills merchandise request form in PSMS
2. PSMS backend sends request to RHET Inventory
3. RHET admin approves in Stock Requests page
4. Inventory auto-deducts stock
5. Inventory notifies PSMS via webhook (optional)
```

**Rules**

- PSMS **backend** calls inventory API (never call from browser/frontend).
- PSMS does **not** need SKU.
- PSMS does **not** use Firebase login.
- Stock is deducted only after RHET inventory admin **approves** the request.

---

## 2. Get an API key from RHET Inventory (one-time, per system)

Each external system (PSMS, HR, VENDOR, etc.) gets its **own** API key issued
directly from the RHET Inventory admin UI — there is no back-and-forth `.env`
negotiation with the inventory team anymore.

1. Log in to RHET Inventory as an admin.
2. Go to **Management → API Keys**.
3. Create a new key for this system (e.g. name it `PSMS`).
4. Copy the key **immediately** — it is shown once in the copy modal and cannot
   be retrieved again (only regenerated, which invalidates the old key).

**Inventory base URL**

| Environment | URL |
|---|---|
| Production | `https://api-inventory.lca-app.com/api/v1/integrations` |
| Local (inventory running locally) | `http://localhost:3000/api/v1/integrations` |

---

## 3. What to configure on PSMS

### 3.1 Environment variables

Add to PSMS backend `.env` (**backend only** — never `VITE_*` / frontend):

```env
# RHET Inventory integration
INVENTORY_API_URL=https://api-inventory.lca-app.com/api/v1/integrations
INVENTORY_INTEGRATION_KEY=<key-from-RHET-API-Keys-page>
INVENTORY_WEBHOOK_URL=https://api-cms.lca-app.com/api/webhooks/inventory
INVENTORY_SYSTEM_CODE=PSMS
```

| Variable | Description |
|---|---|
| `INVENTORY_API_URL` | RHET Inventory integration base URL |
| `INVENTORY_INTEGRATION_KEY` | Key generated on RHET → Management → API Keys for this system |
| `INVENTORY_API_KEY` | Alias/fallback for `INVENTORY_INTEGRATION_KEY` — set either one |
| `INVENTORY_WEBHOOK_URL` | PSMS endpoint that receives status updates from inventory |
| `INVENTORY_SYSTEM_CODE` | Prefix for `externalReference` (`<CODE>-<local_id>`). Defaults to `PSMS` |

If neither `INVENTORY_API_URL` nor the key is set, PSMS falls back to its
legacy Superadmin-only approval flow and never calls RHET.

### 3.2 PSMS backend routes (implemented)

| PSMS route | Purpose |
|---|---|
| `GET /api/sms/merchandise-requests/inventory/catalog` | Proxy to RHET `/catalog` for dropdowns |
| `GET /api/sms/merchandise-requests/inventory/availability` | Proxy to RHET `/availability` for a stock check |
| `POST /api/sms/merchandise-requests` | Local save + submit to RHET `/stock-requests` |
| `POST /api/webhooks/inventory` | Receive `stock_request.*` events from RHET (no Firebase auth; verified by shared key) |

Implementation: `backend/services/inventory/` (client + field mapping),
`backend/routes/merchandiserequests.js` (submit + proxy routes),
`backend/routes/inventoryWebhooks.js` (webhook receiver).

### 3.3 PSMS database columns (implemented)

`merchandiserequestlogtbl` gained these columns via migration
`124_add_inventory_integration_fields_to_merchandiserequestlogtbl.sql`:

| Column | Purpose |
|---|---|
| `inventory_request_id` | RHET stock request UUID |
| `inventory_status` | `PENDING` / `FULFILLED` / `REJECTED` / `FAILED` |
| `inventory_external_reference` | `<INVENTORY_SYSTEM_CODE>-<request_id>`, e.g. `PSMS-123` |
| `inventory_matched_sku` | SKU RHET matched (from webhook, reference only) |
| `inventory_rejection_reason` | Reason from RHET when rejected/failed |
| `inventory_synced_at` | Last successful sync timestamp |
| `inventory_processed_by` | RHET Inventory user who approved/rejected (migration `126_...`) |

---

## 4. Authentication

Every request from PSMS backend to inventory must include **one** of:

```http
X-Integration-Key: <key-from-RHET-API-Keys-page>
```

or

```http
Authorization: Bearer <key-from-RHET-API-Keys-page>
```

PSMS reads the key from `INVENTORY_INTEGRATION_KEY`, falling back to
`INVENTORY_API_KEY` if the former is unset.

Also send:

```http
Content-Type: application/json
```

---

## 5. Inventory API endpoints

### 5.1 Get catalog (populate dropdowns)

```http
GET {INVENTORY_API_URL}/catalog
X-Integration-Key: {INVENTORY_INTEGRATION_KEY}
```

**Success response**

```json
{
  "success": true,
  "data": {
    "categories": [
      { "categoryId": "uuid", "categoryName": "School Uniform" },
      { "categoryId": "uuid", "categoryName": "PE Uniform" }
    ],
    "items": [
      {
        "inventoryId": "uuid",
        "sku": "SCH-M-SHIRT-M",
        "itemName": "Classic White Polo",
        "stocks": 48,
        "status": "ACTIVE",
        "variation": "Male · Shirt · M",
        "categoryName": "School Uniform"
      }
    ]
  }
}
```

**Use in PSMS form**

| PSMS field | Source |
|---|---|
| Items (category dropdown) | `data.categories[].categoryName` |
| Gender | Fixed: `Male`, `Female`, `Unisex` |
| Type | Fixed: `Shirt`, `Pants` |
| Size | Fixed: `XS`, `S`, `M`, `L`, `XL`, `2XL`, `3XL` |

---

### 5.2 Check availability (optional)

```http
GET {INVENTORY_API_URL}/availability?categoryName=School%20Uniform&gender=Male&type=Shirt&size=M
X-Integration-Key: {INVENTORY_INTEGRATION_KEY}
```

**Query parameters**

| Parameter | Required | Example |
|---|---|---|
| `categoryName` | Yes | `School Uniform` |
| `gender` | For uniform categories | `Male` |
| `type` | For uniform categories | `Shirt` |
| `size` | For uniform categories | `M` |
| `itemName` | For non-uniform categories | `School Backpack` |

**Success response**

```json
{
  "success": true,
  "data": {
    "available": true,
    "stocks": 48,
    "status": "ACTIVE",
    "sku": "SCH-M-SHIRT-M",
    "itemName": "Classic White Polo",
    "variation": "Male · Shirt · M",
    "inventoryId": "uuid"
  }
}
```

---

### 5.3 Submit stock request(s)

```http
POST {INVENTORY_API_URL}/stock-requests
X-Integration-Key: {INVENTORY_INTEGRATION_KEY}
Content-Type: application/json
```

**Request body**

```json
{
  "requestDate": "2026-07-16",
  "requestedBy": "Paul Camus",
  "reason": "Restock campus store display",
  "webhookUrl": "http://localhost:5000/api/webhooks/inventory",
  "batchReference": "PSMS-BATCH-2026-001",
  "items": [
    {
      "categoryName": "School Uniform",
      "gender": "Male",
      "type": "Shirt",
      "size": "M",
      "quantity": 2,
      "externalReference": "PSMS-REQ-1001"
    },
    {
      "categoryName": "PE Uniform",
      "gender": "Female",
      "type": "Pants",
      "size": "L",
      "quantity": 1,
      "externalReference": "PSMS-REQ-1002"
    }
  ]
}
```

**Field mapping from PSMS merchandise form**

| PSMS form field | JSON field |
|---|---|
| Request Date | `requestDate` |
| Requested By | `requestedBy` |
| Reason for Request | `reason` |
| Items (category) | `items[].categoryName` |
| Gender | `items[].gender` |
| Type | `items[].type` |
| Size | `items[].size` |
| Quantity | `items[].quantity` |

**Notes**

- Each table row = one object in `items[]`.
- Each row becomes a **separate pending request** in inventory.
- `reason` applies to all rows in the same submission.
- `externalReference` should be unique per row: PSMS uses `<INVENTORY_SYSTEM_CODE>-<local_request_id>`.
- `webhookUrl` is sent on every request from `INVENTORY_WEBHOOK_URL`; omit it only if RHET has a default webhook configured for this system.

**Success response (201)**

```json
{
  "success": true,
  "data": [
    {
      "requestId": "b1c2d3e4-....",
      "externalReference": "PSMS-REQ-1001",
      "status": "PENDING",
      "categoryName": "School Uniform",
      "gender": "Male",
      "itemType": "Shirt",
      "sizeLabel": "M",
      "quantity": 2
    }
  ],
  "meta": {
    "count": 1
  }
}
```

**Save in PSMS**

- `requestId` → `inventory_request_id`
- `externalReference` → your PSMS reference
- `status` → `PENDING`

---

### 5.4 Get request status (polling)

```http
GET {INVENTORY_API_URL}/stock-requests/{requestId}
X-Integration-Key: {INVENTORY_INTEGRATION_KEY}
```

**Success response**

```json
{
  "success": true,
  "data": {
    "requestId": "uuid",
    "externalReference": "PSMS-REQ-1001",
    "status": "FULFILLED",
    "requestedBy": "Paul Camus",
    "categoryName": "School Uniform",
    "gender": "Male",
    "itemType": "Shirt",
    "sizeLabel": "M",
    "quantity": 2,
    "matchedSku": "SCH-M-SHIRT-M",
    "processedAt": "2026-07-16T08:00:00.000Z"
  }
}
```

**Status values**

| Status | Meaning |
|---|---|
| `PENDING` | Waiting for inventory admin approval |
| `FULFILLED` | Approved and stock deducted |
| `REJECTED` | Admin rejected the request |
| `FAILED` | Could not match item or process request |

---

## 6. Item matching (no SKU required)

### Uniform-like categories

Applies to: `Uniform`, `PE Uniform`, `School Uniform`, and any category ending with ` Uniform`.

Inventory matches using:

```text
categoryName + gender + type + size
```

School uniforms use `Polo` / `Short`. PE uniforms use `Shirt` / `Pants`.

This maps to inventory variation:

```text
Male · Polo · M
```

**Example**

| PSMS sends | Inventory looks for |
|---|---|
| `School Uniform`, `Male`, `Polo`, `M` | Variation = `Male · Polo · M` |
| `School Uniform`, `Male`, `Short`, `M` | Variation = `Male · Short · M` |
| `PE Uniform`, `Male`, `Shirt`, `M` | Variation = `Male · Shirt · M` |
| `PE Uniform`, `Male`, `Pants`, `M` | Variation = `Male · Pants · M` |

### Non-uniform categories (Bag, Book, Accessory, etc.)

Send `itemName` instead of gender/type/size:

```json
{
  "categoryName": "Bag",
  "itemName": "School Backpack",
  "quantity": 1,
  "externalReference": "PSMS-REQ-2001"
}
```

### Learning Kit (out of scope this pass)

Learning Kit is **blocked** in PSMS Request Stock. RHET matches kits via a
category-slot bill of materials plus a request-time `components[]` array,
which PSMS does not collect yet. `POST /api/v1/merchandise-requests` rejects
any request where `merchandise_name` / `category_name` contains "Learning Kit"
with `400 { error: { code: 'LEARNING_KIT_NOT_SUPPORTED' } }`. Request Learning Kit
stock directly in RHET Inventory until kit support ships in a future pass.

### Request Stock UI (catalog-first)

Admin Merchandise → Request Stock loads RHET categories/items via
`GET /api/sms/merchandise-requests/inventory/catalog` (backend proxy only).

- Uniform-like: pick category → gender → type → size (exact RHET labels).
- Non-uniform: pick category → concrete catalog item (`itemName` + `sku`).
- Never send local-only names like `LCA Bag` as `categoryName` without an item.

Persisted on create (migration 128): `inventory_category_name`,
`inventory_item_name`, `inventory_requested_sku`. RHET `failureReason` is stored
in `inventory_rejection_reason` when present on submit response.

---

## 7. Webhook setup (recommended)

Inventory sends POST requests to PSMS when request status changes.

### 7.1 Create PSMS webhook route

```text
POST /api/webhooks/inventory
```

### 7.2 Webhook payload example

```json
{
  "event": "stock_request.fulfilled",
  "requestId": "uuid",
  "externalReference": "PSMS-REQ-1001",
  "sourceSystem": "PSMS",
  "status": "FULFILLED",
  "requestedBy": "Paul Camus",
  "reason": "Restock campus store display",
  "categoryName": "School Uniform",
  "gender": "Male",
  "type": "Shirt",
  "size": "M",
  "quantity": 2,
  "matchedSku": "SCH-M-SHIRT-M",
  "inventoryId": "uuid",
  "rejectionReason": null,
  "failureReason": null,
  "processedAt": "2026-07-16T08:00:00.000Z",
  "processedBy": "Inventory Admin Name",
  "timestamp": "2026-07-16T08:00:01.000Z"
}
```

### 7.3 Webhook events

| Event | When |
|---|---|
| `stock_request.created` | Request saved as `PENDING` |
| `stock_request.fulfilled` | Admin approved; stock deducted |
| `stock_request.rejected` | Admin rejected request |

### 7.4 PSMS webhook handler logic

1. Receive POST body.
2. Find PSMS record by `requestId` or `externalReference`.
3. Update local status.
4. Optionally notify the requester in PSMS UI.
5. Return HTTP `200`.

---

## 8. PSMS backend implementation (as built)

### 8.1 Inventory client service

`backend/services/inventory/inventoryClient.js` — reads `INVENTORY_API_URL`
and `INVENTORY_INTEGRATION_KEY` (or `INVENTORY_API_KEY`), exposes:

```javascript
getCatalog()
checkAvailability(queryParams)
submitStockRequests(payload)
getStockRequest(requestId)
```

All throw `InventoryApiError` with a clear message on missing env vars or a
non-2xx response — callers must not silently swallow failures.

### 8.2 Field mapping + external reference

`backend/services/inventory/inventoryFieldMapping.js` maps PSMS UI labels to
RHET values (`Men→Male`, `Top→Shirt`, `Extra Small→XS`, etc.) and builds
`externalReference` as `<INVENTORY_SYSTEM_CODE>-<local_request_id>` (default
system code `PSMS`, configurable via `INVENTORY_SYSTEM_CODE` so this same
pattern works for other systems connecting to RHET).

### 8.3 Submit route (implemented)

`POST /api/sms/merchandise-requests` in `backend/routes/merchandiserequests.js`:

1. Validates and inserts the request into `merchandiserequestlogtbl`.
2. If the integration is enabled, forwards it to RHET `POST /stock-requests`
   with `externalReference = <INVENTORY_SYSTEM_CODE>-<request_id>`.
3. On success, stores `inventory_request_id`/`inventory_status` on the local row.
4. On failure, **deletes** the local row (rollback) and returns a `502`/`500`
   error — it never reports success while RHET rejected the call.

### 8.4 Webhook route (implemented)

`backend/routes/inventoryWebhooks.js`, mounted at `POST /api/webhooks/inventory`
(outside Firebase auth, verified by `X-Integration-Key` / `Authorization: Bearer`
matching PSMS's own `INVENTORY_INTEGRATION_KEY`):

1. Matches the local row by `externalReference` (parsed back to `request_id`)
   or by stored `inventory_request_id`.
2. On `FULFILLED`: **auto-adds** the requested quantity to the branch
   `merchandisestbl`, marks the local request `Approved`, and notifies the
   branch Admin. CMS Superadmin is not involved.
3. On `REJECTED` / `FAILED`: marks the local request `Rejected` and notifies Admin.
4. Idempotent — repeated FULFILLED webhooks do not double-add stock.

---

## 9. PSMS frontend flow

1. Open **Request Merchandise Stock** modal (Admin → Merchandise).
2. (Optional) Call `GET /api/sms/merchandise-requests/inventory/catalog` to
   load categories, and `GET /api/sms/merchandise-requests/inventory/availability`
   to check stock before submit.
3. User fills request date, requested by, reason, and line items.
4. User clicks **Submit Request**.
5. Frontend calls `POST /api/sms/merchandise-requests` (PSMS backend only).
6. Backend forwards to RHET. Superadmin is **not** notified for integrated requests.
7. RHET inventory admin reviews the request on **Stock Requests**.
8. On approve in RHET, webhook adds stock to the CMS branch automatically.

---

## 10. Error handling

**Standard error response from inventory**

```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Only 3 unit(s) are available"
  }
}
```

**Common error codes**

| Code | Meaning | PSMS action |
|---|---|---|
| `INTEGRATION_UNAUTHORIZED` | Wrong/missing API key | Check env variables |
| `INTEGRATION_DISABLED` | Inventory integration not configured | Contact inventory admin |
| `VALIDATION_ERROR` | Invalid request body | Fix form validation |
| `ITEM_NOT_MATCHED` | No matching inventory item | Show “item not available in inventory” |
| `INSUFFICIENT_STOCK` | Not enough stock on approval | Show error to admin/user |

---

## 11. Testing checklist (acceptance test)

### On RHET Inventory

- [ ] Generate an API key for this system (**Management → API Keys**, name it e.g. `PSMS`)
- [ ] Inventory items exist for test combinations (e.g. School Uniform, Male · Shirt · M)
- [ ] Stock quantity > 0 for test items

### On PSMS

- [ ] `INVENTORY_API_URL` and `INVENTORY_INTEGRATION_KEY` set in `backend/.env`
- [ ] `INVENTORY_WEBHOOK_URL` set to `https://<psms-api-domain>/api/webhooks/inventory`
- [ ] Backend redeployed/restarted after setting env vars
- [ ] `GET /api/sms/merchandise-requests/inventory/catalog` (with a valid Firebase session) returns data

### End-to-end test

1. Submit a stock request from the PSMS Admin Merchandise page.
2. Verify the request appears in RHET Inventory → **Stock Requests** as `PENDING`.
3. Approve the request in RHET Inventory.
4. Verify stock deducted in RHET Inventory.
5. Verify PSMS receives the webhook and updates `inventory_status` to `FULFILLED`
   (check the Superadmin notification, or the `inventory_status` column).
6. Confirm `Learning Kit` is not selectable in PSMS Request Stock, and
   `POST /api/v1/merchandise-requests` with `merchandise_name: "LCA Learning Kit"`
   returns `400 LEARNING_KIT_NOT_SUPPORTED`.

---

## 12. Production checklist

- [ ] Use HTTPS for both systems
- [ ] Use a long random shared key (not the dev default)
- [ ] Store integration key in server env/secrets only
- [ ] Never expose integration key in PSMS frontend
- [ ] Category names in PSMS must exactly match inventory categories
- [ ] Enable webhook or polling for status sync
- [ ] Log all integration requests in PSMS for debugging

---

## 13. Quick reference

| Action | Method | URL |
|---|---|---|
| Get catalog | `GET` | `/catalog` |
| Check availability | `GET` | `/availability?...` |
| Submit request | `POST` | `/stock-requests` |
| Get request status | `GET` | `/stock-requests/:id` |

**Base URL:** `{INVENTORY_API_URL}`  
**Auth header:** `X-Integration-Key: {INVENTORY_INTEGRATION_KEY}`

---

## 14. Do NOT

- Put the API key in frontend env vars (`VITE_*`, `NEXT_PUBLIC_*`) or frontend code.
- Ask CMS Superadmin to manually approve inventory-integrated stock requests —
  RHET admin approves in Inventory; CMS webhook auto-adds branch stock.
- Hardcode `"PSMS"` as the only possible system code — use
  `INVENTORY_SYSTEM_CODE` so the same integration pattern works for other
  systems (HR, VENDOR, etc.) connecting to RHET.
- Map `Polo` to `type: "Shirt"` (or vice versa) — School Uniform uses
  `Polo`/`Short`, PE Uniform uses `Shirt`/`Pants`; they are distinct RHET types.
- Send Learning Kit items via `POST /stock-requests` from PSMS — blocked
  client- and server-side until `components[]` support is implemented.

## 15. Support contacts

| System | Responsibility |
|---|---|
| PSMS team | Form UI, PSMS backend routes, webhook handler, local request storage |
| RHET Inventory team | Stock data, admin approval, stock deduction, API keys |

## 16. Connected Systems admin page

After PSMS is configured, inventory admins can verify the connection in the
RHET Inventory UI: **Management → Connected Systems** (or **API Keys**).

| Status | Meaning |
|---|---|
| **Not configured** | No API key generated for PSMS yet |
| **Ready** | Key generated, but PSMS has not called the API yet |
| **Connected** | PSMS has successfully called the integration API |

The page also shows total/pending/fulfilled requests per connected system.
