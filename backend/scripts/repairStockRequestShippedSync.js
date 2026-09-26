/**
 * Repair: sync a CMS merchandise request onto the **Shipped** tab when RHET is
 * already Arranged Delivery / SHIPPED but CMS stayed Pending (missed webhook
 * or status alias not mapped).
 *
 * Default target for this incident:
 *   Group: PSMS-REQ-85
 *   Line:  PSMS-85 (request_id 85)
 *   Item:  lca_id_lace / IDL-LCA-ID-LACE
 *   Qty:   30 (warehouse adjusted from 55)
 *   RHET:  Arranged Delivery (Branch Received still empty)
 *
 * What this script does (--apply):
 *   - Sets local status → Shipped (My Requests → Shipped tab)
 *     (also restores Cancelled → Shipped when RHET still has the line shipped)
 *   - Syncs inventory_* fields + approved qty from RHET when pollable
 *   - Does NOT credit branch stock and does NOT call RHET /deliver
 *
 * After --apply, Branch Admin uses ⋮ → Confirm received in CMS.
 * That path calls RHET /deliver and credits merchandisestbl (both systems).
 *
 * Known incident (dry-run on psms_production):
 *   request_id 85 was Cancelled locally; RHET still Arranged Delivery for
 *   PSMS-85 / lca_id_lace / IDL-LCA-ID-LACE qty 30 (was 55).
 * Usage:
 *   node scripts/repairStockRequestShippedSync.js --production
 *   node scripts/repairStockRequestShippedSync.js --production --request-id=85
 *   node scripts/repairStockRequestShippedSync.js --production --external-ref=PSMS-85
 *   node scripts/repairStockRequestShippedSync.js --production --request-id=85 --apply
 *   node scripts/repairStockRequestShippedSync.js --production --request-id=85 --inventory-request-id=<uuid> --apply
 *
 * Dry-run by default (no writes). Pass --apply to update CMS only.
 */

import '../config/loadEnv.js';
import { query, getClient } from '../config/database.js';
import {
  getStockRequest,
  isInventoryIntegrationEnabled,
} from '../services/inventory/inventoryClient.js';
import { pickApproverName } from '../services/inventory/inventoryFieldMapping.js';
import {
  buildQuantityAdjustmentPatch,
  applyQuantityAdjustmentUpdate,
} from '../services/inventory/quantityAdjustment.js';
import { runIgnoringMissingUpdatedAt } from '../services/inventory/runMerchRequestSql.js';
import {
  LOCAL_REQUEST_STATUS,
  isDeliveredRemoteStatus,
  isShippedRemoteStatus,
  isStockCreditedLocalStatus,
  normalizeRemoteStatus,
} from '../services/inventory/stockRequestLifecycle.js';

function argValue(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

const apply = process.argv.includes('--apply');
const requestIdArg = argValue('request-id');
const externalRefArg = argValue('external-ref');
const inventoryRequestIdArg = argValue('inventory-request-id');

/** Defaults for the Vista Mall Cavite ID Lace incident (Sep 2026). */
const DEFAULT_REQUEST_ID = '85';
const DEFAULT_EXTERNAL_REFS = ['PSMS-85', 'PSMS-REQ-85'];

function summarizeLocal(row) {
  return {
    request_id: row.request_id,
    status: row.status,
    merchandise_name: row.merchandise_name,
    inventory_category_name: row.inventory_category_name,
    inventory_item_name: row.inventory_item_name,
    inventory_requested_sku: row.inventory_requested_sku,
    inventory_matched_sku: row.inventory_matched_sku,
    requested_quantity: row.requested_quantity,
    inventory_original_quantity: row.inventory_original_quantity ?? null,
    inventory_request_id: row.inventory_request_id,
    inventory_external_reference: row.inventory_external_reference,
    inventory_status: row.inventory_status,
    inventory_processed_by: row.inventory_processed_by,
    requested_branch_id: row.requested_branch_id,
    request_reason: row.request_reason,
  };
}

async function findLocalRequest() {
  if (requestIdArg) {
    const byId = await query(
      'SELECT * FROM merchandiserequestlogtbl WHERE request_id = $1',
      [Number(requestIdArg)]
    );
    if (byId.rows[0]) return byId.rows[0];
  }

  const refs = [];
  if (externalRefArg) refs.push(String(externalRefArg).trim());
  if (!requestIdArg && !externalRefArg) {
    refs.push(...DEFAULT_EXTERNAL_REFS);
  }

  for (const ref of refs) {
    const byExt = await query(
      `SELECT * FROM merchandiserequestlogtbl
       WHERE inventory_external_reference = $1
          OR inventory_external_reference ILIKE $2
          OR review_notes ILIKE $3
       ORDER BY request_id
       LIMIT 5`,
      [ref, `%${ref}%`, `%${ref}%`]
    );
    if (byExt.rows.length === 1) return byExt.rows[0];
    if (byExt.rows.length > 1) {
      console.log(`Multiple rows matched ref ${ref}:`, byExt.rows.map((r) => r.request_id));
      return byExt.rows[0];
    }
  }

  if (!requestIdArg && !externalRefArg) {
    const byDefaultId = await query(
      'SELECT * FROM merchandiserequestlogtbl WHERE request_id = $1',
      [Number(DEFAULT_REQUEST_ID)]
    );
    if (byDefaultId.rows[0]) return byDefaultId.rows[0];

    // Fallback: ID Lace / lca_id_lace on recent rows
    const byItem = await query(
      `SELECT * FROM merchandiserequestlogtbl
       WHERE (
         LOWER(COALESCE(inventory_item_name, '')) LIKE '%lca_id_lace%'
         OR LOWER(COALESCE(inventory_requested_sku, '')) LIKE '%idl-lca-id-lace%'
         OR LOWER(COALESCE(merchandise_name, '')) LIKE '%id lace%'
       )
       ORDER BY request_id DESC
       LIMIT 5`
    );
    if (byItem.rows.length) {
      console.log(
        'Candidates by item/sku (pick with --request-id=):',
        byItem.rows.map((r) => ({
          request_id: r.request_id,
          status: r.status,
          merchandise_name: r.merchandise_name,
          inventory_item_name: r.inventory_item_name,
          qty: r.requested_quantity,
        }))
      );
      return byItem.rows[0];
    }
  }

  return null;
}

console.log('=== repairStockRequestShippedSync ===');
console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);
console.log(`Mode: ${apply ? 'APPLY (will write CMS Shipped)' : 'DRY-RUN (no writes)'}`);
console.log('');

if (!process.argv.includes('--production') && process.env.NODE_ENV !== 'production') {
  console.warn('Tip: pass --production to target psms_production via loadEnv.');
}

const local = await findLocalRequest();
if (!local) {
  console.error(
    'Local request not found. Pass --request-id=85 or --external-ref=PSMS-85'
  );
  process.exit(1);
}

console.log('CMS row (current):');
console.log(JSON.stringify(summarizeLocal(local), null, 2));
console.log('');

if (isStockCreditedLocalStatus(local.status)) {
  console.log(
    `Local status is already ${local.status} (stock credited). Nothing to put on Shipped tab.`
  );
  console.log('If branch qty is wrong, use repairInventoryFulfillment.js or investigate stock rows.');
  process.exit(0);
}

if (local.status === LOCAL_REQUEST_STATUS.SHIPPED) {
  console.log('Local status is already Shipped — it should appear on the Shipped tab.');
  console.log(
    'Next step for the Admin: My Requests → Shipped → ⋮ → Confirm received (updates RHET + CMS stock).'
  );
  if (!local.inventory_request_id) {
    console.warn(
      'WARNING: inventory_request_id is missing — Confirm received will fail until linked.'
    );
  }
  process.exit(0);
}

if (
  local.status !== LOCAL_REQUEST_STATUS.PENDING &&
  local.status !== LOCAL_REQUEST_STATUS.CANCELLED
) {
  console.error(
    `Refusing to move status ${local.status} → Shipped. Expected Pending or Cancelled.`
  );
  process.exit(1);
}

if (local.status === LOCAL_REQUEST_STATUS.CANCELLED) {
  console.log(
    'DIAGNOSIS: CMS status is Cancelled while RHET still has this line Arranged Delivery / SHIPPED.'
  );
  console.log(
    'That is why it is missing from the Shipped tab. --apply will restore status → Shipped.'
  );
  console.log('');
}

const inventoryRequestId =
  inventoryRequestIdArg || local.inventory_request_id || null;

let remote = null;
let remoteStatus = null;
let remoteData = {};

if (!isInventoryIntegrationEnabled()) {
  console.warn('Inventory integration env not configured — skipping RHET poll.');
} else if (!inventoryRequestId) {
  console.warn(
    'No inventory_request_id on the CMS row. Pass --inventory-request-id=<RHET uuid> on apply.'
  );
} else {
  try {
    remote = await getStockRequest(inventoryRequestId);
    remoteData = remote?.data && typeof remote.data === 'object' ? remote.data : remote || {};
    remoteStatus = normalizeRemoteStatus(remoteData.status);
    console.log('RHET poll:');
    console.log(
      JSON.stringify(
        {
          inventory_request_id: inventoryRequestId,
          status: remoteData.status,
          normalized: remoteStatus,
          shippedLike: isShippedRemoteStatus(remoteStatus),
          deliveredLike: isDeliveredRemoteStatus(remoteStatus),
          quantity: remoteData.quantity,
          originalQuantity:
            remoteData.originalQuantity || remoteData.original_quantity || null,
          itemName: remoteData.itemName || remoteData.item_name,
          sku: remoteData.matchedSku || remoteData.sku,
          categoryName: remoteData.categoryName || remoteData.category_name,
          externalReference: remoteData.externalReference,
          batchReference: remoteData.batchReference,
          processedBy: pickApproverName(remoteData),
        },
        null,
        2
      )
    );
    console.log('');
  } catch (err) {
    console.warn(`RHET poll failed (${err.message}). Will still plan CMS Shipped sync from local facts.`);
    console.log('');
  }
}

if (isDeliveredRemoteStatus(remoteStatus)) {
  console.log(
    'RHET is already DELIVERED. Do not use this script — use repairInventoryFulfillment.js to credit CMS stock.'
  );
  process.exit(1);
}

const shippedLike =
  !remoteStatus || isShippedRemoteStatus(remoteStatus) || remoteStatus === 'PENDING';

// Incident facts from RHET Manage modal (fallback when poll unavailable)
const incidentQty = 30;
const incidentOriginalQty = 55;
const planQty =
  Number(remoteData.quantity) > 0
    ? Number(remoteData.quantity)
    : Number(local.requested_quantity) === incidentOriginalQty
      ? incidentQty
      : Number(local.requested_quantity) || incidentQty;

const plan = {
  request_id: local.request_id,
  fromStatus: local.status,
  toStatus: LOCAL_REQUEST_STATUS.SHIPPED,
  inventory_status: 'SHIPPED',
  inventory_request_id: inventoryRequestId || null,
  requested_quantity: planQty,
  inventory_original_quantity:
    Number(local.inventory_original_quantity) ||
    Number(remoteData.originalQuantity || remoteData.original_quantity) ||
    (planQty < Number(local.requested_quantity) ? Number(local.requested_quantity) : incidentOriginalQty),
  inventory_matched_sku:
    remoteData.matchedSku ||
    local.inventory_matched_sku ||
    local.inventory_requested_sku ||
    'IDL-LCA-ID-LACE',
  inventory_item_name:
    remoteData.itemName ||
    remoteData.item_name ||
    local.inventory_item_name ||
    'lca_id_lace',
  inventory_category_name:
    remoteData.categoryName ||
    remoteData.category_name ||
    local.inventory_category_name ||
    local.merchandise_name,
  inventory_external_reference:
    remoteData.externalReference ||
    local.inventory_external_reference ||
    `PSMS-${local.request_id}`,
  inventory_processed_by: pickApproverName(remoteData) || local.inventory_processed_by || null,
  note:
    'In transit: repaired to Shipped so Confirm received is available. Branch stock credits on Confirm received (RHET /deliver).',
};

console.log('Planned CMS update:');
console.log(JSON.stringify(plan, null, 2));
console.log('');
console.log('After apply → Admin My Requests → Shipped → Confirm received');
console.log('  → CMS calls RHET /deliver + credits branch stock for this line.');
console.log('');

if (!shippedLike && remoteStatus) {
  console.warn(
    `WARNING: RHET status ${remoteStatus} is not shipped-like. Apply will still set CMS Shipped only if you confirm facts manually.`
  );
}

if (!apply) {
  console.log('DRY-RUN complete. Re-run with --apply to write.');
  process.exit(0);
}

if (!inventoryRequestId) {
  console.error(
    'Cannot apply without inventory_request_id (Confirm received needs it). Pass --inventory-request-id=<uuid>.'
  );
  process.exit(1);
}

const client = await getClient();
try {
  await client.query('BEGIN');
  const locked = await client.query(
    'SELECT * FROM merchandiserequestlogtbl WHERE request_id = $1 FOR UPDATE',
    [local.request_id]
  );
  const row = locked.rows[0];
  if (!row) throw new Error('Request disappeared');
  if (isStockCreditedLocalStatus(row.status) || row.status === LOCAL_REQUEST_STATUS.SHIPPED) {
    await client.query('ROLLBACK');
    console.log(`Status already ${row.status} — no write.`);
    process.exit(0);
  }

  // Best-effort qty adjustment columns (migration 147)
  const qtyPatch = buildQuantityAdjustmentPatch(row, {
    quantity: plan.requested_quantity,
    originalQuantity: plan.inventory_original_quantity,
  });
  if (qtyPatch) {
    try {
      await applyQuantityAdjustmentUpdate(
        client.query.bind(client),
        row.request_id,
        row,
        qtyPatch
      );
    } catch (qtyErr) {
      console.warn('Qty adjustment columns skipped:', qtyErr.message);
      await client.query(
        `UPDATE merchandiserequestlogtbl SET requested_quantity = $1 WHERE request_id = $2`,
        [plan.requested_quantity, row.request_id]
      );
    }
  } else if (Number(row.requested_quantity) !== plan.requested_quantity) {
    await client.query(
      `UPDATE merchandiserequestlogtbl SET requested_quantity = $1 WHERE request_id = $2`,
      [plan.requested_quantity, row.request_id]
    );
  }

  await runIgnoringMissingUpdatedAt(
    client.query.bind(client),
    `UPDATE merchandiserequestlogtbl
     SET status = $1,
         reviewed_at = COALESCE(reviewed_at, CURRENT_TIMESTAMP),
         review_notes = COALESCE(review_notes, $2),
         inventory_request_id = COALESCE($3, inventory_request_id),
         inventory_status = 'SHIPPED',
         inventory_external_reference = COALESCE($4, inventory_external_reference),
         inventory_matched_sku = COALESCE($5, inventory_matched_sku),
         inventory_item_name = COALESCE($6, inventory_item_name),
         inventory_category_name = COALESCE($7, inventory_category_name),
         inventory_processed_by = COALESCE($8, inventory_processed_by),
         inventory_synced_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE request_id = $9`,
    [
      LOCAL_REQUEST_STATUS.SHIPPED,
      plan.note,
      plan.inventory_request_id,
      plan.inventory_external_reference,
      plan.inventory_matched_sku,
      plan.inventory_item_name,
      plan.inventory_category_name,
      plan.inventory_processed_by,
      row.request_id,
    ]
  );

  const refreshed = await client.query(
    'SELECT * FROM merchandiserequestlogtbl WHERE request_id = $1',
    [row.request_id]
  );
  await client.query('COMMIT');
  console.log('APPLY complete. CMS row now:');
  console.log(JSON.stringify(summarizeLocal(refreshed.rows[0]), null, 2));
  console.log('');
  console.log('Next: CMS → Merchandise → My Requests → Shipped → Confirm received.');
  process.exit(0);
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error);
  process.exit(1);
} finally {
  client.release();
}
