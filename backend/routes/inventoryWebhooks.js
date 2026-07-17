import express from 'express';
import { query as dbQuery, getClient } from '../config/database.js';
import { parseLocalRequestIdFromExternalReference } from '../services/inventory/inventoryFieldMapping.js';
import { applyMerchandiseRequestStock } from '../services/inventory/applyMerchandiseRequestStock.js';

const router = express.Router();

/**
 * Verifies the shared secret RHET Inventory sends with every webhook call.
 * Accepts either X-Integration-Key or Authorization: Bearer <key>.
 *
 * If RHET sends no auth header, we still accept the webhook (match is by
 * externalReference / inventory_request_id). Wrong key is always rejected.
 */
function verifyWebhookKey(req) {
  const expectedKey = String(
    process.env.INVENTORY_INTEGRATION_KEY || process.env.INVENTORY_API_KEY || ''
  ).trim();

  const headerKey =
    req.headers['x-integration-key'] ||
    (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();

  if (!headerKey) {
    console.warn(
      '[inventory-webhook] No integration key header on webhook request — accepting by request match only'
    );
    return true;
  }

  if (!expectedKey) {
    console.warn(
      '[inventory-webhook] INVENTORY_INTEGRATION_KEY is not set on CMS — cannot verify key header'
    );
    return true;
  }

  return headerKey === expectedKey;
}

function normalizeStatus(status) {
  return String(status || '').toUpperCase();
}

async function findLocalRequest(payload, client = null) {
  const run = client ? client.query.bind(client) : dbQuery;
  const localIdFromRef = parseLocalRequestIdFromExternalReference(payload.externalReference);

  if (localIdFromRef) {
    const byId = await run('SELECT * FROM merchandiserequestlogtbl WHERE request_id = $1', [
      localIdFromRef,
    ]);
    if (byId.rows.length > 0) return byId.rows[0];
  }

  if (payload.requestId) {
    const byInventoryId = await run(
      'SELECT * FROM merchandiserequestlogtbl WHERE inventory_request_id = $1',
      [payload.requestId]
    );
    if (byInventoryId.rows.length > 0) return byInventoryId.rows[0];
  }

  if (payload.externalReference) {
    const byExternalRef = await run(
      'SELECT * FROM merchandiserequestlogtbl WHERE inventory_external_reference = $1',
      [payload.externalReference]
    );
    if (byExternalRef.rows.length > 0) return byExternalRef.rows[0];
  }

  return null;
}

async function syncInventoryFields(client, localRequest, payload, inventoryStatus, rejectionReason) {
  await client.query(
    `UPDATE merchandiserequestlogtbl
     SET inventory_request_id = COALESCE($1, inventory_request_id),
         inventory_status = COALESCE($2, inventory_status),
         inventory_external_reference = COALESCE($3, inventory_external_reference),
         inventory_matched_sku = COALESCE($4, inventory_matched_sku),
         inventory_rejection_reason = $5,
         inventory_synced_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE request_id = $6`,
    [
      payload.requestId || null,
      inventoryStatus || null,
      payload.externalReference || null,
      payload.matchedSku || null,
      rejectionReason,
      localRequest.request_id,
    ]
  );
}

/**
 * When RHET fulfills a request:
 * 1. Add stock to the requesting branch's merchandisestbl
 * 2. Mark the local request Approved
 * 3. Notify the branch Admin only (no Superadmin approval step)
 *
 * Idempotent: if the local request is already Approved, only sync inventory fields.
 */
async function handleFulfilled(localRequest, payload, inventoryStatus, rejectionReason) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Re-read inside the transaction to avoid double-adding stock on retries.
    const locked = await client.query(
      'SELECT * FROM merchandiserequestlogtbl WHERE request_id = $1 FOR UPDATE',
      [localRequest.request_id]
    );
    const request = locked.rows[0];
    if (!request) {
      await client.query('ROLLBACK');
      return { applied: false, reason: 'not_found' };
    }

    await syncInventoryFields(client, request, payload, inventoryStatus, rejectionReason);

    if (request.status === 'Approved') {
      await client.query('COMMIT');
      return { applied: false, reason: 'already_approved' };
    }

    if (request.status !== 'Pending') {
      await client.query('COMMIT');
      return { applied: false, reason: `status_${request.status}` };
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
        `Auto-approved: RHET Inventory fulfilled this request (${payload.matchedSku || payload.requestId || 'no SKU'}). Stock ${stockResult.action} on branch.`,
        request.request_id,
      ]
    );

    await client.query(
      `INSERT INTO announcementstbl (title, body, recipient_groups, status, priority, branch_id, created_by, navigation_key, navigation_query)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        'Stock Added from Central Inventory',
        `${request.requested_quantity} units of ${request.merchandise_name}${request.size ? ` (Size: ${request.size})` : ''} were approved by RHET Central Inventory and added to your branch stock.`,
        ['Admin'],
        'Active',
        'Medium',
        request.requested_branch_id,
        request.requested_by,
        'merchandise',
        'notificationTab=requests',
      ]
    );

    await client.query('COMMIT');
    console.log(
      `[inventory-webhook] Fulfilled request ${request.request_id}: stock ${stockResult.action}, qty now ${stockResult.newQuantity}`
    );
    return { applied: true, stockResult };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * When RHET rejects/fails a request: mark local request Rejected and notify Admin.
 */
async function handleRejected(localRequest, payload, inventoryStatus, rejectionReason) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const locked = await client.query(
      'SELECT * FROM merchandiserequestlogtbl WHERE request_id = $1 FOR UPDATE',
      [localRequest.request_id]
    );
    const request = locked.rows[0];
    if (!request) {
      await client.query('ROLLBACK');
      return { applied: false };
    }

    await syncInventoryFields(client, request, payload, inventoryStatus, rejectionReason);

    if (request.status === 'Pending') {
      await client.query(
        `UPDATE merchandiserequestlogtbl
         SET status = 'Rejected',
             reviewed_at = CURRENT_TIMESTAMP,
             review_notes = COALESCE($1, review_notes),
             updated_at = CURRENT_TIMESTAMP
         WHERE request_id = $2`,
        [
          rejectionReason ||
            `Rejected by RHET Central Inventory (${inventoryStatus}).`,
          request.request_id,
        ]
      );

      await client.query(
        `INSERT INTO announcementstbl (title, body, recipient_groups, status, priority, branch_id, created_by, navigation_key, navigation_query)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          'Stock Request Rejected by Central Inventory',
          `Your request for ${request.requested_quantity} units of ${request.merchandise_name}${request.size ? ` (Size: ${request.size})` : ''} was ${inventoryStatus === 'FAILED' ? 'flagged as failed' : 'rejected'} by RHET Central Inventory.${rejectionReason ? ` Reason: ${rejectionReason}` : ''}`,
          ['Admin'],
          'Active',
          'Medium',
          request.requested_branch_id,
          request.requested_by,
          'merchandise',
          'notificationTab=requests',
        ]
      );
    }

    await client.query('COMMIT');
    return { applied: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * POST /api/webhooks/inventory
 * Receives stock_request.created / fulfilled / rejected events from RHET Inventory.
 *
 * On fulfilled: auto-adds stock to the requesting branch and marks the local
 * request Approved. Superadmin does not need to approve inventory-integrated requests.
 */
router.post('/', async (req, res) => {
  try {
    if (!verifyWebhookKey(req)) {
      return res.status(401).json({ success: false, message: 'Invalid or missing integration key' });
    }

    const payload = req.body || {};
    const inventoryStatus = normalizeStatus(payload.status);
    const rejectionReason = payload.rejectionReason || payload.failureReason || null;

    const localRequest = await findLocalRequest(payload);
    if (!localRequest) {
      console.warn('[inventory-webhook] No matching local request for payload:', {
        event: payload.event,
        requestId: payload.requestId,
        externalReference: payload.externalReference,
      });
      return res.json({ success: true, message: 'No matching local request' });
    }

    if (inventoryStatus === 'FULFILLED') {
      const result = await handleFulfilled(localRequest, payload, inventoryStatus, rejectionReason);
      return res.json({ success: true, ...result });
    }

    if (inventoryStatus === 'REJECTED' || inventoryStatus === 'FAILED') {
      const result = await handleRejected(localRequest, payload, inventoryStatus, rejectionReason);
      return res.json({ success: true, ...result });
    }

    // created / PENDING — sync tracking fields only
    await dbQuery(
      `UPDATE merchandiserequestlogtbl
       SET inventory_request_id = COALESCE($1, inventory_request_id),
           inventory_status = COALESCE($2, inventory_status),
           inventory_external_reference = COALESCE($3, inventory_external_reference),
           inventory_matched_sku = COALESCE($4, inventory_matched_sku),
           inventory_synced_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE request_id = $5`,
      [
        payload.requestId || null,
        inventoryStatus || null,
        payload.externalReference || null,
        payload.matchedSku || null,
        localRequest.request_id,
      ]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('[inventory-webhook] Error processing webhook:', error);
    res.status(500).json({ success: false, message: error.message || 'Webhook processing failed' });
  }
});

export default router;
