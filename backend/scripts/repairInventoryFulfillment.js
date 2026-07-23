/**
 * Repair / apply a RHET-fulfilled stock request onto CMS branch merchandise.
 *
 * Use when:
 * - Migration 124 was missing when the request was submitted
 * - The webhook never reached CMS
 * - Local row exists (Pending) and you have the RHET request UUID
 *
 * Usage:
 *   node scripts/repairInventoryFulfillment.js --production --request-id=123
 *   node scripts/repairInventoryFulfillment.js --production --request-id=123 --inventory-request-id=<uuid>
 *
 * If --inventory-request-id is omitted, the script uses inventory_request_id from the local row
 * (requires migration 124) or polls is not possible without the UUID.
 */
import '../config/loadEnv.js';
import { query, getClient } from '../config/database.js';
import { getStockRequest, isInventoryIntegrationEnabled } from '../services/inventory/inventoryClient.js';
import { pickApproverName } from '../services/inventory/inventoryFieldMapping.js';
import { applyMerchandiseRequestStock } from '../services/inventory/applyMerchandiseRequestStock.js';

function argValue(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

const localRequestId = argValue('request-id');
const inventoryRequestIdArg = argValue('inventory-request-id');

if (!localRequestId) {
  console.error('Required: --request-id=<merchandiserequestlogtbl.request_id>');
  process.exit(1);
}

if (!isInventoryIntegrationEnabled()) {
  console.error('Inventory integration env vars are not configured.');
  process.exit(1);
}

const client = await getClient();
try {
  await client.query('BEGIN');

  const localRes = await client.query(
    'SELECT * FROM merchandiserequestlogtbl WHERE request_id = $1 FOR UPDATE',
    [localRequestId]
  );
  if (localRes.rows.length === 0) {
    throw new Error(`Local request ${localRequestId} not found`);
  }

  const request = localRes.rows[0];
  if (request.status === 'Approved') {
    console.log('Already Approved — nothing to do.');
    await client.query('ROLLBACK');
    process.exit(0);
  }

  const inventoryRequestId = inventoryRequestIdArg || request.inventory_request_id;
  if (!inventoryRequestId) {
    throw new Error(
      'No inventory_request_id. Pass --inventory-request-id=<uuid> from RHET Stock Requests.'
    );
  }

  const remote = await getStockRequest(inventoryRequestId);
  const remoteStatus = String(remote.data?.status || '').toUpperCase();
  const processedBy = pickApproverName(remote.data || remote);
  console.log('RHET status:', remoteStatus, 'SKU:', remote.data?.matchedSku, 'by:', processedBy);

  if (remoteStatus !== 'FULFILLED') {
    throw new Error(`RHET status is ${remoteStatus}, expected FULFILLED`);
  }

  // Best-effort store tracking fields (requires migrations 124 + 126).
  try {
    await client.query(
      `UPDATE merchandiserequestlogtbl
       SET inventory_request_id = $1,
           inventory_status = 'FULFILLED',
           inventory_external_reference = COALESCE($2, inventory_external_reference),
           inventory_matched_sku = COALESCE($3, inventory_matched_sku),
           inventory_processed_by = COALESCE($4, inventory_processed_by),
           inventory_synced_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE request_id = $5`,
      [
        inventoryRequestId,
        remote.data?.externalReference || null,
        remote.data?.matchedSku || null,
        processedBy,
        request.request_id,
      ]
    );
  } catch (e) {
    console.warn('Could not update inventory_* columns (run migrations 124/126):', e.message);
  }

  const stockResult = await applyMerchandiseRequestStock(client, request);
  await client.query(
    `UPDATE merchandiserequestlogtbl
     SET status = 'Approved',
         reviewed_at = CURRENT_TIMESTAMP,
         review_notes = COALESCE(review_notes, $1),
         updated_at = CURRENT_TIMESTAMP
     WHERE request_id = $2`,
    [
      `Repaired from RHET Inventory (${remote.data?.matchedSku || inventoryRequestId}). Stock ${stockResult.action}.`,
      request.request_id,
    ]
  );

  await client.query('COMMIT');
  console.log('Done.', stockResult);
  process.exit(0);
} catch (error) {
  await client.query('ROLLBACK');
  console.error('Repair failed:', error.message);
  process.exit(1);
} finally {
  client.release();
}
