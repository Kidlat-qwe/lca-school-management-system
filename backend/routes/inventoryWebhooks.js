import express from 'express';
import { query as dbQuery, getClient } from '../config/database.js';
import {
  parseLocalRequestIdFromExternalReference,
  pickApproverName,
  resolveUniformFulfillIdentity,
} from '../services/inventory/inventoryFieldMapping.js';
import { applyMerchandiseRequestStock } from '../services/inventory/applyMerchandiseRequestStock.js';
import {
  isMissingColumnError,
  runIgnoringMissingUpdatedAt,
} from '../services/inventory/runMerchRequestSql.js';

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

function normalizeEventName(event) {
  return String(event || '').toLowerCase();
}

function isFulfilledEvent(payload) {
  const event = normalizeEventName(payload.event);
  const status = normalizeStatus(payload.status);
  return status === 'FULFILLED' || event.includes('fulfilled') || event.endsWith('.fulfilled');
}

function isRejectedEvent(payload) {
  const event = normalizeEventName(payload.event);
  const status = normalizeStatus(payload.status);
  return (
    status === 'REJECTED' ||
    status === 'FAILED' ||
    event.includes('rejected') ||
    event.endsWith('.rejected') ||
    event.includes('failed') ||
    event.endsWith('.failed')
  );
}

/**
 * RHET may send the event body at the top level or nested under `data`.
 * Status may also be implied by `event` (stock_request.fulfilled / .rejected).
 */
function normalizeWebhookPayload(body) {
  const raw = body && typeof body === 'object' ? body : {};
  const nested =
    raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? raw.data : null;
  const payload = nested ? { ...nested, ...raw, data: nested } : { ...raw };

  const event = String(payload.event || '').toLowerCase();
  let status = normalizeStatus(payload.status);
  if (!status) {
    if (event.includes('fulfilled') || event.endsWith('.fulfilled')) status = 'FULFILLED';
    else if (event.includes('rejected') || event.endsWith('.rejected')) status = 'REJECTED';
    else if (event.includes('failed') || event.endsWith('.failed')) status = 'FAILED';
    else if (event.includes('created') || event.endsWith('.created')) status = 'PENDING';
  }

  return { ...payload, status };
}

/**
 * Approved By = human name only (processedBy / approvedBy / processedByName).
 * Never use processedByUserId. Never store a UUID.
 * On fulfill/reject, overwrite inventory_processed_by with this value (may be null).
 * On created/pending, do not write inventory_processed_by at all.
 */
function resolveProcessedByName(payload) {
  return pickApproverName(payload);
}

function isMissingInventoryProcessedByColumn(error) {
  return isMissingColumnError(error, 'inventory_processed_by');
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

/**
 * Sync RHET tracking fields.
 * - fulfill/reject (`writeApproverName: true`): overwrite inventory_processed_by with pickApproverName
 * - created/pending: do NOT touch inventory_processed_by (name is always null on created)
 * Never stores processedByUserId / UUIDs.
 */
async function syncInventoryFields(
  localRequest,
  payload,
  inventoryStatus,
  rejectionReason,
  { writeApproverName = false, client = null } = {}
) {
  const run = client ? client.query.bind(client) : dbQuery;
  const processedBy = writeApproverName ? resolveProcessedByName(payload) : null;

  try {
    if (writeApproverName) {
      await runIgnoringMissingUpdatedAt(
        run,
        `UPDATE merchandiserequestlogtbl
         SET inventory_request_id = COALESCE($1, inventory_request_id),
             inventory_status = COALESCE($2, inventory_status),
             inventory_external_reference = COALESCE($3, inventory_external_reference),
             inventory_matched_sku = COALESCE($4, inventory_matched_sku),
             inventory_rejection_reason = $5,
             inventory_processed_by = $6,
             inventory_synced_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE request_id = $7`,
        [
          payload.requestId || null,
          inventoryStatus || null,
          payload.externalReference || null,
          payload.matchedSku || null,
          rejectionReason,
          processedBy,
          localRequest.request_id,
        ]
      );
    } else {
      // created / PENDING — never write inventory_processed_by (always null on created)
      await runIgnoringMissingUpdatedAt(
        run,
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
  } catch (error) {
    if (!isMissingInventoryProcessedByColumn(error)) throw error;

    console.error(
      '[inventory-webhook] inventory_processed_by column missing — run migration 126. Continuing without Approved By.'
    );
    await runIgnoringMissingUpdatedAt(
      run,
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

  return processedBy;
}

/**
 * When RHET fulfills a request:
 * 1. Add stock to the requesting branch's merchandisestbl
 * 2. Mark the local request Approved
 * 3. Store Approved By from payload.processedBy (etc.)
 * 4. Notify the branch Admin only (no Superadmin approval step)
 *
 * Idempotent: if the local request is already Approved, only sync inventory fields
 * (including backfilling inventory_processed_by when RHET re-delivers the name).
 */
async function handleFulfilled(localRequest, payload, inventoryStatus, rejectionReason) {
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
      return { applied: false, reason: 'not_found' };
    }

    const processedBy = await syncInventoryFields(
      request,
      payload,
      inventoryStatus,
      rejectionReason,
      { writeApproverName: true, client }
    );

    console.log(
      `[inventory-webhook] FULFILLED local=${request.request_id} processedBy=${processedBy || '(none)'}`
    );

    if (request.status === 'Approved') {
      await client.query('COMMIT');
      return { applied: false, reason: 'already_approved', processedBy };
    }

    if (request.status !== 'Pending') {
      await client.query('COMMIT');
      return { applied: false, reason: `status_${request.status}`, processedBy };
    }

    const identity = resolveUniformFulfillIdentity({ request, payload });

    const stockResult = await applyMerchandiseRequestStock(client, {
      ...request,
      // Prefer webhook identity when present (matchedSku / itemName / uniform attrs)
      inventory_matched_sku:
        payload.matchedSku || request.inventory_matched_sku || null,
      inventory_item_name:
        payload.itemName ||
        payload.item_name ||
        request.inventory_item_name ||
        null,
      inventory_requested_sku:
        request.inventory_requested_sku || payload.matchedSku || null,
      inventory_category_name:
        payload.categoryName ||
        payload.category_name ||
        request.inventory_category_name ||
        null,
      // Shirt / uniforms: local request first, then webhook, then matchedSku parse
      gender: identity.gender,
      type: identity.type,
      size: identity.size,
    });

    // Always point the request at the identified stock row (never leave blank shell link)
    if (stockResult?.merchandiseId) {
      await client.query(
        `UPDATE merchandiserequestlogtbl
         SET merchandise_id = $1
         WHERE request_id = $2`,
        [stockResult.merchandiseId, request.request_id]
      );
    }

    try {
      await runIgnoringMissingUpdatedAt(
        client.query.bind(client),
        `UPDATE merchandiserequestlogtbl
         SET status = 'Approved',
             reviewed_at = CURRENT_TIMESTAMP,
             review_notes = COALESCE(review_notes, $1),
             inventory_status = 'FULFILLED',
             inventory_processed_by = $2,
             inventory_synced_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE request_id = $3`,
        [
          `Auto-approved: RHET Inventory fulfilled this request (${payload.matchedSku || payload.requestId || 'no SKU'})${processedBy ? ` by ${processedBy}` : ''}. Stock ${stockResult.action} on branch.`,
          processedBy,
          request.request_id,
        ]
      );
    } catch (error) {
      if (!isMissingInventoryProcessedByColumn(error)) throw error;
      await runIgnoringMissingUpdatedAt(
        client.query.bind(client),
        `UPDATE merchandiserequestlogtbl
         SET status = 'Approved',
             reviewed_at = CURRENT_TIMESTAMP,
             review_notes = COALESCE(review_notes, $1),
             inventory_status = 'FULFILLED',
             inventory_synced_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE request_id = $2`,
        [
          `Auto-approved: RHET Inventory fulfilled this request (${payload.matchedSku || payload.requestId || 'no SKU'}). Stock ${stockResult.action} on branch.`,
          request.request_id,
        ]
      );
    }

    const approverLabel = processedBy ? ` (${processedBy})` : '';

    await client.query(
      `INSERT INTO announcementstbl (title, body, recipient_groups, status, priority, branch_id, created_by, navigation_key, navigation_query)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        'Stock Added from Central Inventory',
        `${request.requested_quantity} units of ${request.merchandise_name}${request.size ? ` (Size: ${request.size})` : ''} were approved by RHET Central Inventory${approverLabel} and added to your branch stock.`,
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
      `[inventory-webhook] Fulfilled request ${request.request_id}: stock ${stockResult.action}, qty now ${stockResult.newQuantity}, approvedBy=${processedBy}`
    );
    return { applied: true, stockResult, processedBy };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * When RHET rejects/fails a request: mark local request Rejected, store Approved By, notify Admin.
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

    const processedBy = await syncInventoryFields(
      request,
      payload,
      inventoryStatus,
      rejectionReason,
      { writeApproverName: true, client }
    );

    console.log(
      `[inventory-webhook] ${inventoryStatus} local=${request.request_id} processedBy=${processedBy || '(none)'}`
    );

    if (request.status === 'Pending') {
      try {
        await runIgnoringMissingUpdatedAt(
          client.query.bind(client),
          `UPDATE merchandiserequestlogtbl
           SET status = 'Rejected',
               reviewed_at = CURRENT_TIMESTAMP,
               review_notes = COALESCE($1, review_notes),
               inventory_processed_by = $2,
               updated_at = CURRENT_TIMESTAMP
           WHERE request_id = $3`,
          [
            rejectionReason ||
              `Rejected by RHET Central Inventory (${inventoryStatus}).`,
            processedBy,
            request.request_id,
          ]
        );
      } catch (error) {
        if (!isMissingInventoryProcessedByColumn(error)) throw error;
        await runIgnoringMissingUpdatedAt(
          client.query.bind(client),
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
      }

      const rejectorLabel = processedBy ? ` by ${processedBy}` : '';

      await client.query(
        `INSERT INTO announcementstbl (title, body, recipient_groups, status, priority, branch_id, created_by, navigation_key, navigation_query)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          'Stock Request Rejected by Central Inventory',
          `Your request for ${request.requested_quantity} units of ${request.merchandise_name}${request.size ? ` (Size: ${request.size})` : ''} was ${inventoryStatus === 'FAILED' ? 'flagged as failed' : 'rejected'} by RHET Central Inventory${rejectorLabel}.${rejectionReason ? ` Reason: ${rejectionReason}` : ''}`,
          ['Admin'],
          'Active',
          'Medium',
          request.requested_branch_id,
          request.requested_by,
          'merchandise',
          'notificationTab=requests',
        ]
      );
    } else if (processedBy) {
      // Re-delivered reject webhook or status already Rejected — still backfill Approved By
      try {
        await runIgnoringMissingUpdatedAt(
          client.query.bind(client),
          `UPDATE merchandiserequestlogtbl
           SET inventory_processed_by = $1,
               updated_at = CURRENT_TIMESTAMP
           WHERE request_id = $2`,
          [processedBy, request.request_id]
        );
      } catch (error) {
        if (!isMissingInventoryProcessedByColumn(error)) throw error;
      }
    }

    await client.query('COMMIT');
    return { applied: true, processedBy };
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

    const payload = normalizeWebhookPayload(req.body);
    const inventoryStatus = normalizeStatus(payload.status);
    const rejectionReason = payload.rejectionReason || payload.failureReason || null;
    const processedByPreview = resolveProcessedByName(payload);
    const fulfilled = isFulfilledEvent(payload);
    const rejected = isRejectedEvent(payload);

    console.log('[inventory-webhook] Received', {
      event: payload.event,
      status: inventoryStatus,
      requestId: payload.requestId,
      externalReference: payload.externalReference,
      processedBy: processedByPreview,
      fulfilled,
      rejected,
    });

    const localRequest = await findLocalRequest(payload);
    if (!localRequest) {
      console.warn('[inventory-webhook] No matching local request for payload:', {
        event: payload.event,
        requestId: payload.requestId,
        externalReference: payload.externalReference,
      });
      return res.json({ success: true, message: 'No matching local request' });
    }

    if (fulfilled) {
      const result = await handleFulfilled(localRequest, payload, inventoryStatus, rejectionReason);
      return res.json({ success: true, ...result });
    }

    if (rejected) {
      const result = await handleRejected(localRequest, payload, inventoryStatus, rejectionReason);
      return res.json({ success: true, ...result });
    }

    // created / PENDING — sync tracking fields only; do NOT write inventory_processed_by
    await syncInventoryFields(localRequest, payload, inventoryStatus, rejectionReason, {
      writeApproverName: false,
    });

    res.json({ success: true, processedBy: null });
  } catch (error) {
    console.error('[inventory-webhook] Error processing webhook:', error);
    res.status(500).json({ success: false, message: error.message || 'Webhook processing failed' });
  }
});

export default router;
