import express from 'express';
import { query as dbQuery, getClient } from '../config/database.js';
import {
  parseLocalRequestIdFromExternalReference,
  parseReturnLocalRequestIdFromExternalReference,
  isReturnExternalReference,
  isStockReturnLocalRow,
  buildReturnInspectionNotes,
  pickApproverName,
  resolveUniformFulfillIdentity,
} from '../services/inventory/inventoryFieldMapping.js';
import {
  applyMerchandiseRequestStock,
  reverseMerchandiseRequestStock,
} from '../services/inventory/applyMerchandiseRequestStock.js';
import {
  isMissingColumnError,
  runIgnoringMissingUpdatedAt,
} from '../services/inventory/runMerchRequestSql.js';
import {
  buildQuantityAdjustmentPatch,
  isQuantityAdjustmentNoOp,
  resolveFulfillQuantity,
  withFulfillQuantity,
  applyQuantityAdjustmentUpdate,
} from '../services/inventory/quantityAdjustment.js';
import {
  LOCAL_REQUEST_STATUS,
  isDeliveredEvent,
  isRejectedEvent,
  isReturnedEvent,
  isShippedEvent,
  isStockCreditedLocalStatus,
  inferInventoryStatusFromPayload,
  normalizeRemoteStatus,
  resolveWasDelivered,
  isStockReturnWebhookEvent,
  isStockReturnAcceptedEvent,
  isStockReturnReceivedEvent,
  isQuantityAdjustedEvent,
} from '../services/inventory/stockRequestLifecycle.js';

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

/**
 * RHET may send the event body at the top level or nested under `data`.
 * Status may also be implied by `event` (stock_request.shipped / .delivered / …).
 */
function normalizeWebhookPayload(body) {
  const raw = body && typeof body === 'object' ? body : {};
  const nested =
    raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? raw.data : null;
  const payload = nested ? { ...nested, ...raw, data: nested } : { ...raw };

  const status = inferInventoryStatusFromPayload(payload);
  return { ...payload, status };
}

/**
 * Approved By = human name only (processedBy / approvedBy / processedByName).
 * Never use processedByUserId. Never store a UUID.
 */
function resolveProcessedByName(payload) {
  return pickApproverName(payload);
}

function isMissingInventoryProcessedByColumn(error) {
  return isMissingColumnError(error, 'inventory_processed_by');
}

async function findLocalRequest(payload, client = null) {
  const run = client ? client.query.bind(client) : dbQuery;
  const localIdFromRef =
    parseLocalRequestIdFromExternalReference(payload.externalReference) ||
    parseReturnLocalRequestIdFromExternalReference(payload.externalReference);

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
 * - terminal events (`writeApproverName: true`): overwrite inventory_processed_by
 * - created/pending/shipped: do NOT touch inventory_processed_by unless writeApproverName
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

function buildStockApplyRequest(request, payload) {
  const identity = resolveUniformFulfillIdentity({ request, payload });
  return withFulfillQuantity(
    {
      ...request,
      inventory_matched_sku: payload.matchedSku || request.inventory_matched_sku || null,
      inventory_item_name:
        payload.itemName || payload.item_name || request.inventory_item_name || null,
      inventory_requested_sku:
        request.inventory_requested_sku || payload.matchedSku || null,
      inventory_category_name:
        payload.categoryName ||
        payload.category_name ||
        request.inventory_category_name ||
        null,
      gender: identity.gender,
      type: identity.type,
      size: identity.size,
    },
    payload
  );
}

function isMissingQuantityAdjustmentColumn(error) {
  return (
    isMissingColumnError(error, 'inventory_original_quantity') ||
    isMissingColumnError(error, 'inventory_adjustment_remarks') ||
    isMissingColumnError(error, 'inventory_adjusted_by') ||
    isMissingColumnError(error, 'inventory_adjusted_at')
  );
}

/**
 * RHET warehouse reduced qty on a PENDING line (stock_request.quantity_adjusted).
 * Updates local row only — no branch stock change.
 */
async function handleQuantityAdjusted(localRequest, payload) {
  const patch = buildQuantityAdjustmentPatch(localRequest, payload);
  if (!patch) {
    return { applied: false, reason: 'invalid_quantity' };
  }

  if (isQuantityAdjustmentNoOp(localRequest, patch)) {
    return { applied: false, reason: 'already_synced' };
  }

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

    if (isQuantityAdjustmentNoOp(request, patch)) {
      await client.query('COMMIT');
      return { applied: false, reason: 'already_synced' };
    }

    // Do not adjust qty after branch stock was credited
    if (isStockCreditedLocalStatus(request.status)) {
      await client.query('COMMIT');
      return { applied: false, reason: `status_${request.status}` };
    }

    try {
      await runIgnoringMissingUpdatedAt(
        client.query.bind(client),
        `UPDATE merchandiserequestlogtbl
         SET requested_quantity = $1,
             inventory_original_quantity = COALESCE(inventory_original_quantity, $2),
             inventory_adjustment_remarks = $3,
             inventory_adjusted_by = $4,
             inventory_adjusted_at = COALESCE($5::timestamptz, CURRENT_TIMESTAMP),
             inventory_request_id = COALESCE($6, inventory_request_id),
             inventory_external_reference = COALESCE($7, inventory_external_reference),
             inventory_matched_sku = COALESCE($8, inventory_matched_sku),
             inventory_status = COALESCE($9, inventory_status),
             inventory_synced_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE request_id = $10`,
        [
          patch.adjustedQty,
          patch.originalQty,
          patch.remarks,
          patch.adjustedBy,
          patch.adjustedAt,
          payload.requestId || null,
          payload.externalReference || null,
          payload.matchedSku || null,
          payload.status ? String(payload.status).toUpperCase() : 'PENDING',
          request.request_id,
        ]
      );
    } catch (error) {
      if (!isMissingQuantityAdjustmentColumn(error)) throw error;
      console.error(
        '[inventory-webhook] quantity adjustment columns missing — run migration 147. Falling back to requested_quantity only.'
      );
      await runIgnoringMissingUpdatedAt(
        client.query.bind(client),
        `UPDATE merchandiserequestlogtbl
         SET requested_quantity = $1,
             inventory_synced_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE request_id = $2`,
        [patch.adjustedQty, request.request_id]
      );
    }

    await client.query('COMMIT');
    console.log(
      `[inventory-webhook] quantity_adjusted local=${request.request_id} ${patch.originalQty ?? '?'}→${patch.adjustedQty}`
    );
    return {
      applied: true,
      adjustedQty: patch.adjustedQty,
      originalQty: patch.originalQty,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * SHIPPED: warehouse deducted / handed to courier.
 * Local status → Shipped. Do NOT add branch stock.
 */
async function handleShipped(localRequest, payload, inventoryStatus) {
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

    const qtyPatch = buildQuantityAdjustmentPatch(request, payload);
    if (qtyPatch && !isStockCreditedLocalStatus(request.status)) {
      try {
        await applyQuantityAdjustmentUpdate(
          client.query.bind(client),
          request.request_id,
          request,
          qtyPatch
        );
        const refreshed = await client.query(
          'SELECT * FROM merchandiserequestlogtbl WHERE request_id = $1',
          [request.request_id]
        );
        if (refreshed.rows[0]) {
          Object.assign(request, refreshed.rows[0]);
        }
      } catch (qtyErr) {
        if (!isMissingQuantityAdjustmentColumn(qtyErr)) throw qtyErr;
      }
    }

    // Already past shipped (delivered/approved/returned) — sync fields only
    if (
      isStockCreditedLocalStatus(request.status) ||
      request.status === LOCAL_REQUEST_STATUS.RETURNED ||
      request.status === LOCAL_REQUEST_STATUS.REJECTED
    ) {
      await syncInventoryFields(request, payload, inventoryStatus || 'SHIPPED', null, {
        writeApproverName: false,
        client,
      });
      await client.query('COMMIT');
      return { applied: false, reason: `status_${request.status}` };
    }

    const processedBy = await syncInventoryFields(
      request,
      payload,
      inventoryStatus || 'SHIPPED',
      null,
      { writeApproverName: true, client }
    );

    if (request.status === LOCAL_REQUEST_STATUS.SHIPPED) {
      await client.query('COMMIT');
      return { applied: false, reason: 'already_shipped', processedBy };
    }

    // Pending (or Cancelled unlikely) → Shipped
    if (
      request.status !== LOCAL_REQUEST_STATUS.PENDING &&
      request.status !== LOCAL_REQUEST_STATUS.SHIPPED
    ) {
      await client.query('COMMIT');
      return { applied: false, reason: `status_${request.status}`, processedBy };
    }

    try {
      await runIgnoringMissingUpdatedAt(
        client.query.bind(client),
        `UPDATE merchandiserequestlogtbl
         SET status = $1,
             reviewed_at = COALESCE(reviewed_at, CURRENT_TIMESTAMP),
             review_notes = COALESCE(review_notes, $2),
             inventory_status = 'SHIPPED',
             inventory_processed_by = COALESCE($3, inventory_processed_by),
             inventory_synced_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE request_id = $4`,
        [
          LOCAL_REQUEST_STATUS.SHIPPED,
          `In transit: RHET Inventory marked this request as shipped${processedBy ? ` (${processedBy})` : ''}. Branch stock will be added when delivered.`,
          processedBy,
          request.request_id,
        ]
      );
    } catch (error) {
      if (!isMissingInventoryProcessedByColumn(error)) throw error;
      await runIgnoringMissingUpdatedAt(
        client.query.bind(client),
        `UPDATE merchandiserequestlogtbl
         SET status = $1,
             reviewed_at = COALESCE(reviewed_at, CURRENT_TIMESTAMP),
             review_notes = COALESCE(review_notes, $2),
             inventory_status = 'SHIPPED',
             inventory_synced_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE request_id = $3`,
        [
          LOCAL_REQUEST_STATUS.SHIPPED,
          `In transit: RHET Inventory marked this request as shipped. Branch stock will be added when delivered.`,
          request.request_id,
        ]
      );
    }

    const shipQty = resolveFulfillQuantity(request, payload);
    const shipperLabel = processedBy ? ` (${processedBy})` : '';
    await client.query(
      `INSERT INTO announcementstbl (title, body, recipient_groups, status, priority, branch_id, created_by, navigation_key, navigation_query)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        'Stock Request Shipped',
        `${shipQty} units of ${request.merchandise_name}${request.size ? ` (Size: ${request.size})` : ''} were marked shipped by RHET Central Inventory${shipperLabel}. Stock will be added to your branch when delivery is confirmed.`,
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
      `[inventory-webhook] SHIPPED local=${request.request_id} (no branch stock add)`
    );
    return { applied: true, processedBy, stockAdded: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * DELIVERED (and legacy FULFILLED alias): branch received.
 * Add branch stock once (idempotent by local Delivered/Approved status).
 */
async function handleDelivered(localRequest, payload, inventoryStatus, rejectionReason) {
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

    const qtyPatch = buildQuantityAdjustmentPatch(request, payload);
    if (qtyPatch && !isStockCreditedLocalStatus(request.status)) {
      try {
        await applyQuantityAdjustmentUpdate(
          client.query.bind(client),
          request.request_id,
          request,
          qtyPatch
        );
        const refreshed = await client.query(
          'SELECT * FROM merchandiserequestlogtbl WHERE request_id = $1',
          [request.request_id]
        );
        if (refreshed.rows[0]) {
          Object.assign(request, refreshed.rows[0]);
        }
      } catch (qtyErr) {
        if (!isMissingQuantityAdjustmentColumn(qtyErr)) throw qtyErr;
      }
    }

    const processedBy = await syncInventoryFields(
      request,
      payload,
      inventoryStatus || 'DELIVERED',
      rejectionReason,
      { writeApproverName: true, client }
    );

    console.log(
      `[inventory-webhook] DELIVERED local=${request.request_id} processedBy=${processedBy || '(none)'} priorStatus=${request.status}`
    );

    // Idempotent: already credited (Delivered or legacy Approved)
    if (isStockCreditedLocalStatus(request.status)) {
      await client.query('COMMIT');
      return { applied: false, reason: 'already_delivered', processedBy, stockAdded: false };
    }

    if (
      request.status === LOCAL_REQUEST_STATUS.RETURNED ||
      request.status === LOCAL_REQUEST_STATUS.REJECTED ||
      request.status === LOCAL_REQUEST_STATUS.CANCELLED
    ) {
      await client.query('COMMIT');
      return { applied: false, reason: `status_${request.status}`, processedBy };
    }

    // Pending or Shipped → Delivered + credit
    const stockResult = await applyMerchandiseRequestStock(
      client,
      buildStockApplyRequest(request, payload)
    );

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
         SET status = $1,
             reviewed_at = CURRENT_TIMESTAMP,
             review_notes = COALESCE(review_notes, $2),
             inventory_status = 'DELIVERED',
             inventory_processed_by = $3,
             inventory_synced_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE request_id = $4`,
        [
          LOCAL_REQUEST_STATUS.DELIVERED,
          `Delivered: RHET Inventory confirmed delivery (${payload.matchedSku || payload.requestId || 'no SKU'})${processedBy ? ` by ${processedBy}` : ''}. Stock ${stockResult.action} on branch.`,
          processedBy,
          request.request_id,
        ]
      );
    } catch (error) {
      if (!isMissingInventoryProcessedByColumn(error)) throw error;
      await runIgnoringMissingUpdatedAt(
        client.query.bind(client),
        `UPDATE merchandiserequestlogtbl
         SET status = $1,
             reviewed_at = CURRENT_TIMESTAMP,
             review_notes = COALESCE(review_notes, $2),
             inventory_status = 'DELIVERED',
             inventory_synced_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE request_id = $3`,
        [
          LOCAL_REQUEST_STATUS.DELIVERED,
          `Delivered: RHET Inventory confirmed delivery (${payload.matchedSku || payload.requestId || 'no SKU'}). Stock ${stockResult.action} on branch.`,
          request.request_id,
        ]
      );
    }

    const deliverQty = resolveFulfillQuantity(request, payload);
    const approverLabel = processedBy ? ` (${processedBy})` : '';
    await client.query(
      `INSERT INTO announcementstbl (title, body, recipient_groups, status, priority, branch_id, created_by, navigation_key, navigation_query)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        'Stock Delivered from Central Inventory',
        `${deliverQty} units of ${request.merchandise_name}${request.size ? ` (Size: ${request.size})` : ''} were marked delivered by RHET Central Inventory${approverLabel} and added to your branch stock.`,
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
      `[inventory-webhook] Delivered request ${request.request_id}: stock ${stockResult.action}, qty now ${stockResult.newQuantity}`
    );
    return { applied: true, stockResult, processedBy, stockAdded: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function isReturnStockRow(request, payload = {}) {
  return (
    isStockReturnLocalRow(request) ||
    isReturnExternalReference(payload.externalReference) ||
    isReturnExternalReference(request?.inventory_external_reference) ||
    isStockReturnWebhookEvent(payload)
  );
}

/**
 * stock_return.received — HQ has the return (Pending inspection).
 * Keep branch qty deducted. Local status stays Pending (My Requests → Pending).
 * inventory_status RECEIVED/PENDING until HQ accepts.
 */
async function handleStockReturnReceived(localRequest, payload, inventoryStatus) {
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

    const currentInv = String(request.inventory_status || '').toUpperCase();
    if (currentInv === 'RETURNED') {
      await syncInventoryFields(request, payload, 'RETURNED', null, {
        writeApproverName: false,
        client,
      });
      await client.query('COMMIT');
      return { applied: false, reason: 'already_accepted', kind: 'stock_return', stockChanged: false };
    }

    const incoming = String(inventoryStatus || '').toUpperCase();
    const storeStatus = incoming === 'PENDING' || incoming === 'RECEIVED' ? incoming : 'RECEIVED';
    const processedBy = await syncInventoryFields(
      request,
      payload,
      storeStatus,
      payload.rejectionReason || payload.failureReason || null,
      { writeApproverName: false, client }
    );

    try {
      await runIgnoringMissingUpdatedAt(
        client.query.bind(client),
        `UPDATE merchandiserequestlogtbl
         SET status = $1,
             inventory_status = $2,
             inventory_synced_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE request_id = $3`,
        [LOCAL_REQUEST_STATUS.PENDING, storeStatus, request.request_id]
      );
    } catch (error) {
      if (!isMissingInventoryProcessedByColumn(error)) throw error;
    }

    await client.query('COMMIT');
    console.log(
      `[inventory-webhook] stock_return.received local=${request.request_id} inventory_status=${storeStatus} (branch qty unchanged)`
    );
    return { applied: true, kind: 'stock_return', phase: 'received', processedBy, stockChanged: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * stock_return.accepted — HQ inspected. inventory_status RETURNED.
 * Store returnReusable / returnNotes on review_notes. NEVER re-credit branch qty.
 */
async function handleStockReturnAccepted(localRequest, payload, inventoryStatus) {
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
      inventoryStatus || 'RETURNED',
      payload.rejectionReason || payload.failureReason || null,
      { writeApproverName: true, client }
    );

    const inspectionNotes = buildReturnInspectionNotes({
      returnReusable: payload.returnReusable,
      returnNotes: payload.returnNotes,
      processedBy,
    });
    const alreadyInspected = String(request.inventory_status || '').toUpperCase() === 'RETURNED';

    try {
      await runIgnoringMissingUpdatedAt(
        client.query.bind(client),
        `UPDATE merchandiserequestlogtbl
         SET status = $1,
             reviewed_at = COALESCE(reviewed_at, CURRENT_TIMESTAMP),
             review_notes = CASE
               WHEN $4::boolean THEN COALESCE(review_notes, $2)
               ELSE $2
             END,
             inventory_status = 'RETURNED',
             inventory_processed_by = COALESCE($3, inventory_processed_by),
             inventory_synced_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE request_id = $5`,
        [
          LOCAL_REQUEST_STATUS.RETURNED,
          inspectionNotes,
          processedBy,
          alreadyInspected,
          request.request_id,
        ]
      );
    } catch (error) {
      if (!isMissingInventoryProcessedByColumn(error)) throw error;
      await runIgnoringMissingUpdatedAt(
        client.query.bind(client),
        `UPDATE merchandiserequestlogtbl
         SET status = $1,
             reviewed_at = COALESCE(reviewed_at, CURRENT_TIMESTAMP),
             review_notes = CASE
               WHEN $3::boolean THEN COALESCE(review_notes, $2)
               ELSE $2
             END,
             inventory_status = 'RETURNED',
             inventory_synced_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE request_id = $4`,
        [LOCAL_REQUEST_STATUS.RETURNED, inspectionNotes, alreadyInspected, request.request_id]
      );
    }

    await client.query('COMMIT');
    console.log(
      `[inventory-webhook] stock_return.accepted local=${request.request_id} reusable=${payload.returnReusable} (branch qty unchanged)`
    );
    return {
      applied: !alreadyInspected,
      kind: 'stock_return',
      phase: 'accepted',
      processedBy,
      stockChanged: false,
      returnReusable: payload.returnReusable,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * RETURNED: reverse CMS credit only when wasDelivered (or local was Delivered/Approved).
 * From Shipped only → status Returned, no reverse.
 */
async function handleReturned(localRequest, payload, inventoryStatus) {
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
      inventoryStatus || 'RETURNED',
      payload.rejectionReason || payload.failureReason || null,
      { writeApproverName: true, client }
    );

    if (request.status === LOCAL_REQUEST_STATUS.RETURNED) {
      await client.query('COMMIT');
      return { applied: false, reason: 'already_returned', processedBy };
    }

    const wasDelivered = resolveWasDelivered(payload, request.status);
    let stockResult = null;

    if (wasDelivered) {
      stockResult = await reverseMerchandiseRequestStock(
        client,
        buildStockApplyRequest(request, payload)
      );
    }

    try {
      await runIgnoringMissingUpdatedAt(
        client.query.bind(client),
        `UPDATE merchandiserequestlogtbl
         SET status = $1,
             reviewed_at = CURRENT_TIMESTAMP,
             review_notes = COALESCE(review_notes, $2),
             inventory_status = 'RETURNED',
             inventory_processed_by = COALESCE($3, inventory_processed_by),
             inventory_synced_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE request_id = $4`,
        [
          LOCAL_REQUEST_STATUS.RETURNED,
          wasDelivered
            ? `Returned to warehouse after delivery${processedBy ? ` (${processedBy})` : ''}. Branch stock reversed (${stockResult?.qtyRemoved ?? 0} units).`
            : `Returned to warehouse before delivery${processedBy ? ` (${processedBy})` : ''}. No branch stock change.`,
          processedBy,
          request.request_id,
        ]
      );
    } catch (error) {
      if (!isMissingInventoryProcessedByColumn(error)) throw error;
      await runIgnoringMissingUpdatedAt(
        client.query.bind(client),
        `UPDATE merchandiserequestlogtbl
         SET status = $1,
             reviewed_at = CURRENT_TIMESTAMP,
             review_notes = COALESCE(review_notes, $2),
             inventory_status = 'RETURNED',
             inventory_synced_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE request_id = $3`,
        [
          LOCAL_REQUEST_STATUS.RETURNED,
          wasDelivered
            ? `Returned to warehouse after delivery. Branch stock reversed (${stockResult?.qtyRemoved ?? 0} units).`
            : `Returned to warehouse before delivery. No branch stock change.`,
          request.request_id,
        ]
      );
    }

    const returnQty = resolveFulfillQuantity(request, payload);
    const actorLabel = processedBy ? ` (${processedBy})` : '';
    await client.query(
      `INSERT INTO announcementstbl (title, body, recipient_groups, status, priority, branch_id, created_by, navigation_key, navigation_query)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        'Stock Request Returned',
        wasDelivered
          ? `Your request for ${returnQty} units of ${request.merchandise_name}${request.size ? ` (Size: ${request.size})` : ''} was returned to RHET warehouse${actorLabel}. Branch stock was reversed.`
          : `Your request for ${returnQty} units of ${request.merchandise_name}${request.size ? ` (Size: ${request.size})` : ''} was returned to RHET warehouse${actorLabel} before delivery. Branch stock was unchanged.`,
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
      `[inventory-webhook] RETURNED local=${request.request_id} wasDelivered=${wasDelivered} reversed=${stockResult?.action || 'n/a'}`
    );
    return {
      applied: true,
      processedBy,
      wasDelivered,
      stockResult,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * When RHET rejects a request: mark local request Rejected, notify Admin.
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
      inventoryStatus || 'REJECTED',
      rejectionReason,
      { writeApproverName: true, client }
    );

    console.log(
      `[inventory-webhook] ${inventoryStatus} local=${request.request_id} processedBy=${processedBy || '(none)'}`
    );

    const canReject =
      request.status === LOCAL_REQUEST_STATUS.PENDING ||
      request.status === LOCAL_REQUEST_STATUS.SHIPPED;

    if (canReject) {
      try {
        await runIgnoringMissingUpdatedAt(
          client.query.bind(client),
          `UPDATE merchandiserequestlogtbl
           SET status = 'Rejected',
               reviewed_at = CURRENT_TIMESTAMP,
               review_notes = COALESCE($1, review_notes),
               inventory_processed_by = $2,
               inventory_status = 'REJECTED',
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
               inventory_status = 'REJECTED',
               updated_at = CURRENT_TIMESTAMP
           WHERE request_id = $2`,
          [
            rejectionReason ||
              `Rejected by RHET Central Inventory (${inventoryStatus}).`,
            request.request_id,
          ]
        );
      }

      const rejectQty = resolveFulfillQuantity(request, payload);
      const rejectorLabel = processedBy ? ` by ${processedBy}` : '';

      await client.query(
        `INSERT INTO announcementstbl (title, body, recipient_groups, status, priority, branch_id, created_by, navigation_key, navigation_query)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          'Stock Request Rejected by Central Inventory',
          `Your request for ${rejectQty} units of ${request.merchandise_name}${request.size ? ` (Size: ${request.size})` : ''} was rejected by RHET Central Inventory${rejectorLabel}.${rejectionReason ? ` Reason: ${rejectionReason}` : ''}`,
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
    return { applied: canReject, processedBy };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * POST /api/webhooks/inventory
 * Receives stock_request.* and stock_return.received / stock_return.accepted
 * from RHET Inventory.
 *
 * Stock is added only on delivered (fulfilled is a legacy alias — credit once).
 */
router.post('/', async (req, res) => {
  try {
    if (!verifyWebhookKey(req)) {
      return res.status(401).json({ success: false, message: 'Invalid or missing integration key' });
    }

    const payload = normalizeWebhookPayload(req.body);
    const inventoryStatus = normalizeRemoteStatus(payload.status);
    const rejectionReason = payload.rejectionReason || payload.failureReason || null;
    const processedByPreview = resolveProcessedByName(payload);
    const shipped = isShippedEvent(payload);
    const delivered = isDeliveredEvent(payload);
    const returned = isReturnedEvent(payload);
    const rejected = isRejectedEvent(payload);

    console.log('[inventory-webhook] Received', {
      event: payload.event,
      status: inventoryStatus,
      requestId: payload.requestId,
      externalReference: payload.externalReference,
      branchName: payload.branchName || null,
      wasDelivered: payload.wasDelivered,
      processedBy: processedByPreview,
      shipped,
      delivered,
      returned,
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

    if (isReturnStockRow(localRequest, payload) || isStockReturnWebhookEvent(payload)) {
      if (isStockReturnAcceptedEvent(payload) || inventoryStatus === 'RETURNED') {
        const result = await handleStockReturnAccepted(localRequest, payload, inventoryStatus);
        return res.json({ success: true, ...result });
      }
      if (
        isStockReturnReceivedEvent(payload) ||
        inventoryStatus === 'PENDING' ||
        inventoryStatus === 'RECEIVED' ||
        isStockReturnWebhookEvent(payload)
      ) {
        const result = await handleStockReturnReceived(localRequest, payload, inventoryStatus);
        return res.json({ success: true, ...result });
      }
      return res.json({
        success: true,
        message: 'Ignored non-return event for Return Stock row',
        ignored: true,
      });
    }

    if (isReturnExternalReference(payload.externalReference) || isStockReturnLocalRow(localRequest)) {
      return res.json({
        success: true,
        message: 'Ignored stock_request event for Return Stock row',
        ignored: true,
      });
    }

    if (isQuantityAdjustedEvent(payload)) {
      const result = await handleQuantityAdjusted(localRequest, payload);
      return res.json({ success: true, ...result });
    }

    // Order matters: returned/rejected before delivered; shipped before created fallback.
    // delivered covers legacy fulfilled alias.
    if (returned) {
      const result = await handleReturned(localRequest, payload, inventoryStatus);
      return res.json({ success: true, ...result });
    }

    if (rejected) {
      const result = await handleRejected(localRequest, payload, inventoryStatus, rejectionReason);
      return res.json({ success: true, ...result });
    }

    if (delivered) {
      const result = await handleDelivered(
        localRequest,
        payload,
        inventoryStatus,
        rejectionReason
      );
      return res.json({ success: true, ...result });
    }

    if (shipped) {
      const result = await handleShipped(localRequest, payload, inventoryStatus);
      return res.json({ success: true, ...result });
    }

    // created / PENDING — sync tracking fields only
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
