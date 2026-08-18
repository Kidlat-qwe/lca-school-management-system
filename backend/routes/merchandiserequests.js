import express from 'express';
import { body, param, query } from 'express-validator';
import { query as dbQuery, getClient } from '../config/database.js';
import { mapRowTimestampsToManila, MERCH_REQUEST_MANILA_TIMESTAMP_SQL } from '../utils/dateUtils.js';
import { verifyFirebaseToken, requireRole } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import {
  isInventoryIntegrationEnabled,
  getInventoryWebhookUrl,
  getCatalog as getInventoryCatalog,
  checkAvailability as checkInventoryAvailability,
  submitStockRequests,
  submitStockReturns,
  getStockRequest,
  markStockRequestDelivered,
  InventoryApiError,
} from '../services/inventory/inventoryClient.js';
import {
  buildInventorySubmitPayload,
  buildInventoryReturnPayload,
  buildExternalReference,
  buildReturnExternalReference,
  buildBatchReference,
  buildReturnBatchReference,
  wrapStockReturnReason,
  unwrapStockReturnReason,
  extractRemoteInventoryItems,
  normalizeReturnCreateInventoryStatus,
  normalizeInventoryBranchName,
  pickApproverName,
  looksLikeUuid,
  isLearningKitCategory,
  normalizeMerchandiseRequestInput,
  resolveUniformFulfillIdentity,
} from '../services/inventory/inventoryFieldMapping.js';
import {
  applyMerchandiseRequestStock,
  findExistingMerchandiseStockRow,
  deductMerchandiseStockQuantity,
  restoreMerchandiseStockQuantity,
  parseLegacyItemIdentityFromRemarks,
} from '../services/inventory/applyMerchandiseRequestStock.js';
import { runIgnoringMissingUpdatedAt } from '../services/inventory/runMerchRequestSql.js';
import { resolveLearningKitRecipe } from '../services/inventory/learningKitRecipes.js';
import {
  LOCAL_REQUEST_STATUS,
  isDeliveredRemoteStatus,
  isShippedRemoteStatus,
  isStockCreditedLocalStatus,
  normalizeRemoteStatus,
} from '../services/inventory/stockRequestLifecycle.js';

const router = express.Router();

function isInventoryApiError(error) {
  return error instanceof InventoryApiError || error?.name === 'InventoryApiError';
}

// Apply authentication middleware to all routes
router.use(verifyFirebaseToken);

/**
 * Persist RHET /stock-requests response rows onto local merchandiserequestlogtbl
 * lines, matching by `externalReference` (`PSMS-<local_request_id>`).
 */
async function applyInventoryForwardResults(requestRows, result, payload, { isReturn = false } = {}) {
  const remoteItems = extractRemoteInventoryItems(result);
  const byExternalRef = new Map();
  for (const item of remoteItems) {
    const ref = String(item?.externalReference || '').trim();
    if (ref) byExternalRef.set(ref, item);
  }

  const applied = [];
  for (let i = 0; i < requestRows.length; i += 1) {
    const requestRow = requestRows[i];
    const extRef = buildExternalReference(requestRow.request_id);
    const returnRef = buildReturnExternalReference(requestRow.request_id);
    const inventoryItem =
      byExternalRef.get(extRef) ||
      (returnRef ? byExternalRef.get(returnRef) : null) ||
      (requestRows.length === 1 ? remoteItems[0] : null) ||
      payload.items?.[i] && remoteItems[i];

    if (!inventoryItem?.requestId) {
      throw new InventoryApiError(
        `RHET Inventory did not return a request ID for ${returnRef || extRef}`
      );
    }

    const failureReason =
      inventoryItem.failureReason ||
      inventoryItem.rejectionReason ||
      null;
    const inventoryStatus = failureReason
      ? 'FAILED'
      : isReturn
        ? normalizeReturnCreateInventoryStatus(inventoryItem.status)
        : inventoryItem.status || 'PENDING';

    try {
      await runIgnoringMissingUpdatedAt(dbQuery,
        `UPDATE merchandiserequestlogtbl
         SET inventory_request_id = $1,
             inventory_status = $2,
             inventory_external_reference = $3,
             inventory_matched_sku = COALESCE($4, inventory_matched_sku),
             inventory_rejection_reason = COALESCE($5, inventory_rejection_reason),
             inventory_synced_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE request_id = $6`,
        [
          inventoryItem.requestId,
          inventoryStatus,
          inventoryItem.externalReference || returnRef || extRef,
          inventoryItem.matchedSku || null,
          failureReason,
          requestRow.request_id,
        ]
      );
    } catch (dbError) {
      const missingColumn =
        dbError?.code === '42703' ||
        String(dbError?.message || '').includes('inventory_request_id');
      if (missingColumn) {
        throw new InventoryApiError(
          'RHET Inventory accepted the request, but CMS is missing inventory tracking columns. ' +
            'Run migration 124_add_inventory_integration_fields_to_merchandiserequestlogtbl.sql on the production database, then redeploy/retry.',
          { code: 'INVENTORY_SCHEMA_MISSING', status: 500 }
        );
      }
      throw dbError;
    }

    applied.push(inventoryItem);
  }

  return applied;
}

/**
 * Forwards freshly-created local request row(s) to RHET Inventory in **one**
 * POST /stock-requests, with a shared top-level `batchReference` so RHET
 * groups the cart. Throws InventoryApiError on failure so the caller can
 * roll back local records.
 *
 * @param {object|object[]} requestRows
 * @param {{ requestedBy: string, reason?: string, branchName: string, batchReference?: string }} options
 */
async function forwardRequestToInventory(requestRows, { requestedBy, reason, branchName, batchReference }) {
  if (!isInventoryIntegrationEnabled()) {
    return null;
  }

  const rows = Array.isArray(requestRows) ? requestRows : [requestRows];
  if (!rows.length) {
    throw new InventoryApiError('At least one stock request line is required', {
      code: 'EMPTY_STOCK_REQUEST',
      status: 400,
    });
  }

  let payload;
  try {
    payload = buildInventorySubmitPayload({
      requestRows: rows,
      requestedBy,
      reason,
      branchName,
      batchReference,
      webhookUrl: getInventoryWebhookUrl(),
    });
  } catch (buildError) {
    throw new InventoryApiError(buildError.message || 'Invalid stock request for RHET Inventory', {
      code: buildError.code || 'INVALID_INVENTORY_ITEM',
      status: 400,
    });
  }

  console.log('[merchandise-requests] Forwarding to RHET /stock-requests:', {
    localRequestIds: rows.map((row) => row.request_id),
    batchReference: payload.batchReference || null,
    itemCount: payload.items?.length || 0,
    branchName: payload.branchName,
    categoryNames: (payload.items || []).map((item) => item.categoryName),
    externalReferences: (payload.items || []).map((item) => item.externalReference),
  });

  const result = await submitStockRequests(payload);
  const applied = await applyInventoryForwardResults(rows, result, payload);
  return rows.length === 1 ? applied[0] : applied;
}

/**
 * Forwards Return Stock rows to RHET POST /stock-returns (one cart).
 * Uses PSMS-RET-* refs so inbound stock-request webhooks do not match these rows.
 */
async function forwardReturnToInventory(requestRows, { requestedBy, reason, branchName, batchReference }) {
  if (!isInventoryIntegrationEnabled()) {
    return null;
  }

  const rows = Array.isArray(requestRows) ? requestRows : [requestRows];
  if (!rows.length) {
    throw new InventoryApiError('At least one stock return line is required', {
      code: 'EMPTY_STOCK_RETURN',
      status: 400,
    });
  }

  let payload;
  try {
    payload = buildInventoryReturnPayload({
      requestRows: rows,
      requestedBy,
      reason,
      branchName,
      batchReference,
      webhookUrl: getInventoryWebhookUrl(),
    });
  } catch (buildError) {
    throw new InventoryApiError(buildError.message || 'Invalid stock return for RHET Inventory', {
      code: buildError.code || 'INVALID_INVENTORY_ITEM',
      status: 400,
    });
  }

  console.log('[merchandise-returns] Forwarding to RHET /stock-returns:', {
    localRequestIds: rows.map((row) => row.request_id),
    batchReference: payload.batchReference || null,
    itemCount: payload.items?.length || 0,
    branchName: payload.branchName,
    categoryNames: (payload.items || []).map((item) => item.categoryName),
    externalReferences: (payload.items || []).map((item) => item.externalReference),
  });

  const result = await submitStockReturns(payload);
  // HTTP 201/200 + PENDING/RECEIVED is success. Do not require status RETURNED.
  const applied = await applyInventoryForwardResults(rows, result, payload, { isReturn: true });
  return rows.length === 1 ? applied[0] : applied;
}

async function insertLocalMerchandiseRequestRow({
  userId,
  branchId,
  linkedMerchandiseId,
  merchandise_name,
  size,
  requested_quantity,
  request_reason,
  gender,
  type,
  inventory_category_name,
  inventory_item_name,
  inventory_requested_sku,
  inventory_components_json,
  status = 'Pending',
  executor = dbQuery,
}) {
  const localStatus = status === 'Returned' ? 'Returned' : 'Pending';
  let result;
  try {
    result = await executor(
      `INSERT INTO merchandiserequestlogtbl 
      (merchandise_id, requested_by, requested_branch_id, merchandise_name, size, requested_quantity, request_reason, gender, type,
       inventory_category_name, inventory_item_name, inventory_requested_sku, inventory_components_json, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [
        linkedMerchandiseId,
        userId,
        branchId,
        merchandise_name,
        size || null,
        requested_quantity,
        request_reason || null,
        gender || null,
        type || null,
        inventory_category_name,
        inventory_item_name,
        inventory_requested_sku,
        inventory_components_json ? JSON.stringify(inventory_components_json) : null,
        localStatus,
      ]
    );
  } catch (insertError) {
    const missingRhetCols =
      insertError?.code === '42703' ||
      String(insertError?.message || '').includes('inventory_category_name') ||
      String(insertError?.message || '').includes('inventory_components_json');
    if (!missingRhetCols) throw insertError;

    try {
      result = await executor(
        `INSERT INTO merchandiserequestlogtbl 
        (merchandise_id, requested_by, requested_branch_id, merchandise_name, size, requested_quantity, request_reason, gender, type,
         inventory_category_name, inventory_item_name, inventory_requested_sku, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *`,
        [
          linkedMerchandiseId,
          userId,
          branchId,
          merchandise_name,
          size || null,
          requested_quantity,
          request_reason || null,
          gender || null,
          type || null,
          inventory_category_name,
          inventory_item_name,
          inventory_requested_sku,
          localStatus,
        ]
      );
    } catch (insertError2) {
      const missingIdentity =
        insertError2?.code === '42703' ||
        String(insertError2?.message || '').includes('inventory_category_name');
      if (!missingIdentity) throw insertError2;

      result = await executor(
        `INSERT INTO merchandiserequestlogtbl 
        (merchandise_id, requested_by, requested_branch_id, merchandise_name, size, requested_quantity, request_reason, gender, type, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *`,
        [
          linkedMerchandiseId,
          userId,
          branchId,
          merchandise_name,
          size || null,
          requested_quantity,
          request_reason || null,
          gender || null,
          type || null,
          localStatus,
        ]
      );
    }
    result.rows[0].inventory_category_name = inventory_category_name;
    result.rows[0].inventory_item_name = inventory_item_name;
    result.rows[0].inventory_requested_sku = inventory_requested_sku;
    result.rows[0].inventory_components_json = inventory_components_json;
  }

  return mapRowTimestampsToManila(result.rows[0]);
}

async function resolveKitRecipeForBody(body) {
  const categoryName = String(
    body.category_name || body.categoryName || body.merchandise_name || ''
  ).trim();
  if (!isLearningKitCategory(categoryName) && !isLearningKitCategory(body.merchandise_name)) {
    return null;
  }
  return resolveLearningKitRecipe({
    itemName: body.item_name || body.itemName,
    sku: body.sku,
  });
}

async function normalizeIncomingRequestLine(body, { inventoryOn, requested_quantity }) {
  if (inventoryOn) {
    const learningKitRecipe = await resolveKitRecipeForBody(body);
    const normalized = normalizeMerchandiseRequestInput(
      {
        ...body,
        requested_quantity,
      },
      { learningKitRecipe }
    );
    if (normalized.error) {
      return {
        error: {
          status: 400,
          message: normalized.error,
          code: normalized.code || 'INVALID_STOCK_REQUEST',
        },
      };
    }
    return {
      merchandise_name: normalized.merchandise_name,
      size: normalized.size,
      gender: normalized.gender,
      type: normalized.type,
      inventory_category_name: normalized.inventory_category_name || null,
      inventory_item_name: normalized.inventory_item_name || null,
      inventory_requested_sku: normalized.inventory_requested_sku || null,
      inventory_components_json: normalized.inventory_components_json || null,
    };
  }

  const merchandise_name = String(body.merchandise_name || body.category_name || '').trim();
  if (!merchandise_name) {
    return {
      error: {
        status: 400,
        message: 'Merchandise name is required',
        code: 'MERCHANDISE_NAME_REQUIRED',
      },
    };
  }
  if (isLearningKitCategory(merchandise_name)) {
    return {
      error: {
        status: 400,
        message:
          'Learning Kit requests require RHET Inventory integration (components[]). Configure INVENTORY_API_URL and the integration key.',
        code: 'KIT_REQUIRES_INVENTORY_INTEGRATION',
      },
    };
  }
  return {
    merchandise_name,
    size: body.size ? String(body.size).trim() : null,
    gender: body.gender ? String(body.gender).trim() : null,
    type: body.type ? String(body.type).trim() : null,
    inventory_category_name: null,
    inventory_item_name: null,
    inventory_requested_sku: null,
    inventory_components_json: null,
  };
}

/**
 * GET /api/v1/merchandise-requests
 * Get all merchandise requests (filtered by role)
 * Access: Superadmin (all requests), Admin (their branch requests only)
 */
router.get(
  '/',
  [
    query('status').optional().isIn(['Pending', 'Shipped', 'Delivered', 'Returned', 'Approved', 'Rejected', 'Cancelled']).withMessage('Invalid status'),
    query('branch_id').optional().isInt().withMessage('Branch ID must be an integer'),
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { status, branch_id, page = 1, limit = 100 } = req.query;
      const offset = (page - 1) * limit;

      let sql = `
        SELECT 
          mr.*,
          ${MERCH_REQUEST_MANILA_TIMESTAMP_SQL},
          u.full_name as requested_by_name,
          u.email as requested_by_email,
          b.branch_name as requested_branch_name,
          r.full_name as reviewed_by_name,
          m.image_url as merchandise_image_url,
          m.price as merchandise_price
        FROM merchandiserequestlogtbl mr
        LEFT JOIN userstbl u ON mr.requested_by = u.user_id
        LEFT JOIN branchestbl b ON mr.requested_branch_id = b.branch_id
        LEFT JOIN userstbl r ON mr.reviewed_by = r.user_id
        LEFT JOIN merchandisestbl m ON mr.merchandise_id = m.merchandise_id
        WHERE 1=1
      `;

      const params = [];
      let paramCount = 0;

      // Admin can only see their branch requests
      if (req.user.userType === 'Admin') {
        paramCount++;
        sql += ` AND mr.requested_branch_id = $${paramCount}`;
        params.push(req.user.branchId);
      }

      // Filter by status
      if (status) {
        paramCount++;
        sql += ` AND mr.status = $${paramCount}`;
        params.push(status);
      }

      // Filter by branch (Superadmin only)
      if (branch_id && req.user.userType === 'Superadmin') {
        paramCount++;
        sql += ` AND mr.requested_branch_id = $${paramCount}`;
        params.push(branch_id);
      }

      // Get total count
      const countResult = await dbQuery(`SELECT COUNT(*) as total FROM (${sql}) as count_query`, params);
      const totalItems = parseInt(countResult.rows[0].total);

      // Add ordering and pagination
      sql += ` ORDER BY mr.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
      params.push(limit, offset);

      const result = await dbQuery(sql, params);

      // Explicitly surface Approved By so the UI never depends on SELECT * quirks.
      // Skip raw UUIDs (RHET sometimes sends user id instead of display name).
      const uuidRe =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const data = result.rows.map((row) => {
        const rawProcessed =
          row.inventory_processed_by != null
            ? String(row.inventory_processed_by).trim()
            : '';
        const inventoryProcessedBy =
          rawProcessed && !uuidRe.test(rawProcessed) ? rawProcessed : '';
        const reviewedByName =
          row.reviewed_by_name != null ? String(row.reviewed_by_name).trim() : '';
        const approvedBy = inventoryProcessedBy || reviewedByName || null;

        return mapRowTimestampsToManila({
          ...row,
          inventory_processed_by: inventoryProcessedBy || null,
          approved_by: approvedBy,
        });
      });

      res.json({
        success: true,
        data,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalItems,
          totalPages: Math.ceil(totalItems / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/merchandise-requests/stats
 * Get request statistics
 * Access: Superadmin, Admin
 */
router.get(
  '/stats',
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      let branchFilter = '';
      const params = [];

      if (req.user.userType === 'Admin') {
        branchFilter = 'WHERE requested_branch_id = $1';
        params.push(req.user.branchId);
      }

      const statsQuery = `
        SELECT 
          COUNT(*) FILTER (WHERE status = 'Pending') as pending_count,
          COUNT(*) FILTER (WHERE status = 'Shipped') as shipped_count,
          COUNT(*) FILTER (WHERE status IN ('Delivered', 'Approved')) as delivered_count,
          COUNT(*) FILTER (WHERE status = 'Returned') as returned_count,
          COUNT(*) FILTER (WHERE status IN ('Delivered', 'Approved')) as approved_count,
          COUNT(*) FILTER (WHERE status = 'Rejected') as rejected_count,
          COUNT(*) FILTER (WHERE status = 'Cancelled') as cancelled_count,
          COUNT(*) as total_count
        FROM merchandiserequestlogtbl
        ${branchFilter}
      `;

      const result = await dbQuery(statsQuery, params);

      res.json({
        success: true,
        data: result.rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/merchandise-requests/inventory/catalog
 * Proxy to RHET Inventory catalog (categories + items) for dropdowns.
 * Must be registered BEFORE /:id so "inventory" is not parsed as an id.
 * Access: Superadmin, Admin
 */
router.get(
  '/inventory/catalog',
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      if (!isInventoryIntegrationEnabled()) {
        return res.status(503).json({
          success: false,
          message: 'RHET Inventory integration is not configured',
          error: { code: 'INTEGRATION_DISABLED' },
        });
      }
      const result = await getInventoryCatalog();
      res.json(result);
    } catch (error) {
      if (isInventoryApiError(error)) {
        return res.status(error.status || 502).json({
          success: false,
          message: error.message,
          error: { code: error.code },
        });
      }
      next(error);
    }
  }
);

/**
 * GET /api/v1/merchandise-requests/inventory/availability
 * Proxy to RHET Inventory availability check.
 * Access: Superadmin, Admin
 */
router.get(
  '/inventory/availability',
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      if (!isInventoryIntegrationEnabled()) {
        return res.status(503).json({
          success: false,
          message: 'RHET Inventory integration is not configured',
          error: { code: 'INTEGRATION_DISABLED' },
        });
      }
      const { categoryName, gender, type, size, itemName, sku } = req.query;
      const result = await checkInventoryAvailability({
        categoryName,
        gender,
        type,
        size,
        itemName,
        sku,
      });
      res.json(result);
    } catch (error) {
      if (isInventoryApiError(error)) {
        return res.status(error.status || 502).json({
          success: false,
          message: error.message,
          error: { code: error.code },
        });
      }
      next(error);
    }
  }
);

/**
 * GET /api/v1/merchandise-requests/:id
 * Get specific merchandise request
 * Access: Superadmin, Admin (own branch only)
 */
router.get(
  '/:id',
  [
    param('id').isInt().withMessage('Request ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      let sql = `
        SELECT 
          mr.*,
          ${MERCH_REQUEST_MANILA_TIMESTAMP_SQL},
          u.full_name as requested_by_name,
          u.email as requested_by_email,
          b.branch_name as requested_branch_name,
          r.full_name as reviewed_by_name,
          m.image_url as merchandise_image_url,
          m.price as merchandise_price,
          m.quantity as current_stock
        FROM merchandiserequestlogtbl mr
        LEFT JOIN userstbl u ON mr.requested_by = u.user_id
        LEFT JOIN branchestbl b ON mr.requested_branch_id = b.branch_id
        LEFT JOIN userstbl r ON mr.reviewed_by = r.user_id
        LEFT JOIN merchandisestbl m ON mr.merchandise_id = m.merchandise_id AND m.branch_id = mr.requested_branch_id
        WHERE mr.request_id = $1
      `;

      const params = [id];

      // Admin can only see their branch requests
      if (req.user.userType === 'Admin') {
        sql += ` AND mr.requested_branch_id = $2`;
        params.push(req.user.branchId);
      }

      const result = await dbQuery(sql, params);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Request not found',
        });
      }

      res.json({
        success: true,
        data: mapRowTimestampsToManila(result.rows[0]),
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/merchandise-requests
 * Create a new merchandise request
 * Access: Admin only
 */
router.post(
  '/',
  [
    body('merchandise_id').optional({ nullable: true }).isInt().withMessage('Merchandise ID must be an integer'),
    body('category_name').optional({ nullable: true, checkFalsy: true }).trim(),
    body('merchandise_name').optional({ nullable: true, checkFalsy: true }).trim(),
    body('item_name').optional({ nullable: true, checkFalsy: true }).trim(),
    body('sku').optional({ nullable: true, checkFalsy: true }).trim(),
    body('size').optional({ nullable: true, checkFalsy: true }).trim(),
    body('requested_quantity').isInt({ min: 1 }).withMessage('Requested quantity must be at least 1'),
    body('request_reason').optional().trim(),
    body('gender')
      .optional({ nullable: true, checkFalsy: true })
      .isIn(['Men', 'Women', 'Unisex', 'Male', 'Female', 'Boys', 'Girls', null, ''])
      .withMessage('Gender must be Male/Female/Unisex (or Men/Women)'),
    // Catalog-driven: School/PE piece types + LCA_SHIRT Logo 1/Logo 2 (not PE "Shirt")
    body('type').optional({ nullable: true, checkFalsy: true }).trim(),
    body('category_kind').optional({ nullable: true, checkFalsy: true }).trim(),
    handleValidationErrors,
  ],
  requireRole('Admin'),
  async (req, res, next) => {
    try {
      const { merchandise_id, requested_quantity, request_reason } = req.body;
      const inventoryOn = isInventoryIntegrationEnabled();

      let merchandise_name;
      let size;
      let gender;
      let type;
      let inventory_category_name = null;
      let inventory_item_name = null;
      let inventory_requested_sku = null;
      let inventory_components_json = null;

      if (inventoryOn) {
        const learningKitRecipe = await resolveKitRecipeForBody(req.body);
        const normalized = normalizeMerchandiseRequestInput(
          {
            ...req.body,
            requested_quantity,
          },
          { learningKitRecipe }
        );
        if (normalized.error) {
          return res.status(400).json({
            success: false,
            message: normalized.error,
            error: { code: normalized.code || 'INVALID_STOCK_REQUEST' },
          });
        }
        merchandise_name = normalized.merchandise_name;
        size = normalized.size;
        gender = normalized.gender;
        type = normalized.type;
        inventory_category_name = normalized.inventory_category_name || null;
        inventory_item_name = normalized.inventory_item_name || null;
        inventory_requested_sku = normalized.inventory_requested_sku || null;
        inventory_components_json = normalized.inventory_components_json || null;
      } else {
        // Legacy Superadmin-approval path: local merchandise_name only.
        merchandise_name = String(req.body.merchandise_name || req.body.category_name || '').trim();
        size = req.body.size ? String(req.body.size).trim() : null;
        gender = req.body.gender ? String(req.body.gender).trim() : null;
        type = req.body.type ? String(req.body.type).trim() : null;
        if (!merchandise_name) {
          return res.status(400).json({
            success: false,
            message: 'Merchandise name is required',
            error: { code: 'MERCHANDISE_NAME_REQUIRED' },
          });
        }
        if (isLearningKitCategory(merchandise_name)) {
          return res.status(400).json({
            success: false,
            message:
              'Learning Kit requests require RHET Inventory integration (components[]). Configure INVENTORY_API_URL and the integration key.',
            error: { code: 'KIT_REQUIRES_INVENTORY_INTEGRATION' },
          });
        }
      }

      // Validate merchandise_id if provided
      let linkedMerchandiseId = merchandise_id || null;
      if (linkedMerchandiseId) {
        const merchandiseCheck = await dbQuery(
          'SELECT merchandise_id, merchandise_name, size FROM merchandisestbl WHERE merchandise_id = $1',
          [linkedMerchandiseId]
        );

        if (merchandiseCheck.rows.length === 0) {
          return res.status(404).json({
            success: false,
            message: 'Merchandise not found',
          });
        }
      } else {
        // Prefer linking the existing CMS type on this branch (Backpack, not lca-backpack)
        try {
          const existing = await findExistingMerchandiseStockRow(dbQuery, {
            requested_branch_id: req.user.branchId,
            merchandise_id: null,
            merchandise_name,
            inventory_category_name,
            inventory_item_name,
            inventory_requested_sku,
            size: size || null,
            gender: gender || null,
            type: type || null,
          });
          if (existing?.merchandise_id) {
            linkedMerchandiseId = existing.merchandise_id;
          }
        } catch (linkErr) {
          console.warn('[merchandise-requests] Could not auto-link merchandise_id:', linkErr.message);
        }
      }

      // Create request (RHET identity on inventory_* columns when migration 128 applied)
      let result;
      try {
        result = await dbQuery(
          `INSERT INTO merchandiserequestlogtbl 
          (merchandise_id, requested_by, requested_branch_id, merchandise_name, size, requested_quantity, request_reason, gender, type,
           inventory_category_name, inventory_item_name, inventory_requested_sku, inventory_components_json, status)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'Pending')
          RETURNING *`,
          [
            linkedMerchandiseId,
            req.user.userId,
            req.user.branchId,
            merchandise_name,
            size || null,
            requested_quantity,
            request_reason || null,
            gender || null,
            type || null,
            inventory_category_name,
            inventory_item_name,
            inventory_requested_sku,
            inventory_components_json ? JSON.stringify(inventory_components_json) : null,
          ]
        );
      } catch (insertError) {
        const missingRhetCols =
          insertError?.code === '42703' ||
          String(insertError?.message || '').includes('inventory_category_name') ||
          String(insertError?.message || '').includes('inventory_components_json');
        if (!missingRhetCols) throw insertError;

        // Migration 128/131 not applied yet — insert what we can; keep components in memory for forward.
        try {
          result = await dbQuery(
            `INSERT INTO merchandiserequestlogtbl 
            (merchandise_id, requested_by, requested_branch_id, merchandise_name, size, requested_quantity, request_reason, gender, type,
             inventory_category_name, inventory_item_name, inventory_requested_sku, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'Pending')
            RETURNING *`,
            [
              linkedMerchandiseId,
              req.user.userId,
              req.user.branchId,
              merchandise_name,
              size || null,
              requested_quantity,
              request_reason || null,
              gender || null,
              type || null,
              inventory_category_name,
              inventory_item_name,
              inventory_requested_sku,
            ]
          );
        } catch (insertError2) {
          const missingIdentity =
            insertError2?.code === '42703' ||
            String(insertError2?.message || '').includes('inventory_category_name');
          if (!missingIdentity) throw insertError2;

          result = await dbQuery(
            `INSERT INTO merchandiserequestlogtbl 
            (merchandise_id, requested_by, requested_branch_id, merchandise_name, size, requested_quantity, request_reason, gender, type, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Pending')
            RETURNING *`,
            [
              linkedMerchandiseId,
              req.user.userId,
              req.user.branchId,
              merchandise_name,
              size || null,
              requested_quantity,
              request_reason || null,
              gender || null,
              type || null,
            ]
          );
        }
        result.rows[0].inventory_category_name = inventory_category_name;
        result.rows[0].inventory_item_name = inventory_item_name;
        result.rows[0].inventory_requested_sku = inventory_requested_sku;
        result.rows[0].inventory_components_json = inventory_components_json;
      }

      const requestRow = result.rows[0];
      const requestId = requestRow.request_id;

      // Branch display name for RHET Stock Requests "Branch" column (required top-level).
      const branchLookup = await dbQuery(
        'SELECT branch_name FROM branchestbl WHERE branch_id = $1',
        [req.user.branchId]
      );
      const branchNameText = normalizeInventoryBranchName(branchLookup.rows[0]?.branch_name);

      if (inventoryOn && !branchNameText) {
        await dbQuery('DELETE FROM merchandiserequestlogtbl WHERE request_id = $1', [requestId]);
        return res.status(400).json({
          success: false,
          message:
            'Your branch does not have a valid display name (at least 2 characters). ' +
            'Update the branch name in CMS before requesting stock from RHET Inventory.',
          error: { code: 'BRANCH_NAME_REQUIRED' },
        });
      }

      // Forward to RHET Inventory (backend-only call). If this fails, do not
      // silently succeed — roll back the local record so PSMS and RHET never
      // disagree about whether the request exists.
      try {
        await forwardRequestToInventory(requestRow, {
          requestedBy: req.user.fullName || req.user.email || 'PSMS Admin',
          reason: request_reason,
          branchName: branchNameText,
        });
      } catch (inventoryError) {
        // If RHET already accepted the request but CMS could not store the link
        // (e.g. migration 124 not applied), keep the local row so webhook/repair
        // can still match by PSMS-{request_id}. Do not silently delete.
        const keepLocal =
          inventoryError?.code === 'INVENTORY_SCHEMA_MISSING' ||
          String(inventoryError?.message || '').includes('missing inventory tracking columns');

        if (!keepLocal) {
          await dbQuery('DELETE FROM merchandiserequestlogtbl WHERE request_id = $1', [requestId]);
        } else {
          console.error(
            '[merchandise-requests] RHET accepted request but CMS schema is incomplete. Local row kept:',
            requestId
          );
        }

        console.error('[merchandise-requests] RHET Inventory forward failed:', {
          message: inventoryError.message,
          code: inventoryError.code,
          status: inventoryError.status,
          details: inventoryError.details,
          localRequestKept: keepLocal,
        });
        const statusCode =
          inventoryError instanceof InventoryApiError ||
          inventoryError?.name === 'InventoryApiError'
            ? inventoryError.status || 502
            : 500;
        return res.status(statusCode).json({
          success: false,
          message:
            inventoryError.message ||
            'Failed to submit stock request to RHET Inventory. Please try again or contact support.',
          error: {
            code: inventoryError.code || 'INVENTORY_FORWARD_FAILED',
            details: inventoryError.details || null,
          },
          data: keepLocal ? requestRow : undefined,
        });
      }

      // Inventory-integrated requests are approved by RHET Inventory admin, not CMS Superadmin.
      // Only notify Superadmin for the legacy local-approval flow.
      if (!isInventoryIntegrationEnabled()) {
        const legacyBranchLabel = branchNameText || 'Unknown Branch';
        let notificationBody = `${req.user.fullName || req.user.email} from ${legacyBranchLabel} has requested ${requested_quantity} units of ${merchandise_name}`;
        if (gender || type) {
          const genderType = [gender, type].filter(Boolean).join(' - ');
          notificationBody += ` (${genderType})`;
        }
        if (size) {
          notificationBody += ` Size: ${size}`;
        }
        if (request_reason) {
          notificationBody += `. Reason: ${request_reason}`;
        }

        await dbQuery(
          `INSERT INTO announcementstbl (title, body, recipient_groups, status, priority, created_by, navigation_key, navigation_query)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            'New Merchandise Stock Request',
            notificationBody,
            ['Superadmin'],
            'Active',
            'High',
            req.user.userId,
            'merchandise',
            'notificationTab=requests',
          ]
        );
      }

      const refreshed = await dbQuery('SELECT * FROM merchandiserequestlogtbl WHERE request_id = $1', [requestId]);

      res.status(201).json({
        success: true,
        message: isInventoryIntegrationEnabled()
          ? 'Stock request submitted to RHET Central Inventory. Stock will be added to your branch when inventory marks it delivered.'
          : 'Merchandise request created successfully',
        data: refreshed.rows[0] || requestRow,
        inventoryIntegrated: isInventoryIntegrationEnabled(),
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/merchandise-requests/batch
 * Create multiple local request lines from one Request Stock cart, then forward
 * them to RHET in a **single** POST /stock-requests with a shared
 * `batchReference` (`PSMS-REQ-<first_local_id>`).
 * Access: Admin only
 */
router.post(
  '/batch',
  [
    body('request_reason').optional().trim(),
    body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
    body('items.*.requested_quantity').isInt({ min: 1 }).withMessage('Requested quantity must be at least 1'),
    body('items.*.category_name').optional({ nullable: true, checkFalsy: true }).trim(),
    body('items.*.merchandise_name').optional({ nullable: true, checkFalsy: true }).trim(),
    body('items.*.item_name').optional({ nullable: true, checkFalsy: true }).trim(),
    body('items.*.sku').optional({ nullable: true, checkFalsy: true }).trim(),
    body('items.*.size').optional({ nullable: true, checkFalsy: true }).trim(),
    body('items.*.gender')
      .optional({ nullable: true, checkFalsy: true })
      .isIn(['Men', 'Women', 'Unisex', 'Male', 'Female', 'Boys', 'Girls', null, ''])
      .withMessage('Gender must be Male/Female/Unisex (or Men/Women)'),
    body('items.*.type').optional({ nullable: true, checkFalsy: true }).trim(),
    body('items.*.category_kind').optional({ nullable: true, checkFalsy: true }).trim(),
    handleValidationErrors,
  ],
  requireRole('Admin'),
  async (req, res, next) => {
    const createdIds = [];
    try {
      const inventoryOn = isInventoryIntegrationEnabled();
      const sharedReason = String(req.body.request_reason || '').trim() || null;
      const incomingItems = Array.isArray(req.body.items) ? req.body.items : [];

      if (!incomingItems.length) {
        return res.status(400).json({
          success: false,
          message: 'At least one item is required',
          error: { code: 'EMPTY_STOCK_REQUEST' },
        });
      }

      const branchLookup = await dbQuery(
        'SELECT branch_name FROM branchestbl WHERE branch_id = $1',
        [req.user.branchId]
      );
      const branchNameText = normalizeInventoryBranchName(branchLookup.rows[0]?.branch_name);
      if (inventoryOn && !branchNameText) {
        return res.status(400).json({
          success: false,
          message:
            'Your branch does not have a valid display name (at least 2 characters). ' +
            'Update the branch name in CMS before requesting stock from RHET Inventory.',
          error: { code: 'BRANCH_NAME_REQUIRED' },
        });
      }

      const preparedLines = [];
      for (let i = 0; i < incomingItems.length; i += 1) {
        const itemBody = incomingItems[i] || {};
        const requested_quantity = parseInt(itemBody.requested_quantity, 10);
        const line = await normalizeIncomingRequestLine(
          { ...itemBody, request_reason: itemBody.request_reason || sharedReason },
          { inventoryOn, requested_quantity }
        );
        if (line.error) {
          return res.status(line.error.status || 400).json({
            success: false,
            message: `Row ${i + 1}: ${line.error.message}`,
            error: { code: line.error.code },
          });
        }

        let linkedMerchandiseId = itemBody.merchandise_id || null;
        if (linkedMerchandiseId) {
          const merchandiseCheck = await dbQuery(
            'SELECT merchandise_id FROM merchandisestbl WHERE merchandise_id = $1',
            [linkedMerchandiseId]
          );
          if (merchandiseCheck.rows.length === 0) {
            return res.status(404).json({
              success: false,
              message: `Row ${i + 1}: Merchandise not found`,
            });
          }
        } else {
          try {
            const existing = await findExistingMerchandiseStockRow(dbQuery, {
              requested_branch_id: req.user.branchId,
              merchandise_id: null,
              merchandise_name: line.merchandise_name,
              inventory_category_name: line.inventory_category_name,
              inventory_item_name: line.inventory_item_name,
              inventory_requested_sku: line.inventory_requested_sku,
              size: line.size || null,
              gender: line.gender || null,
              type: line.type || null,
            });
            if (existing?.merchandise_id) {
              linkedMerchandiseId = existing.merchandise_id;
            }
          } catch (linkErr) {
            console.warn('[merchandise-requests] Could not auto-link merchandise_id:', linkErr.message);
          }
        }

        preparedLines.push({
          ...line,
          requested_quantity,
          request_reason: sharedReason || itemBody.request_reason || null,
          linkedMerchandiseId,
        });
      }

      const requestRows = [];
      for (const line of preparedLines) {
        const row = await insertLocalMerchandiseRequestRow({
          userId: req.user.userId,
          branchId: req.user.branchId,
          linkedMerchandiseId: line.linkedMerchandiseId,
          merchandise_name: line.merchandise_name,
          size: line.size,
          requested_quantity: line.requested_quantity,
          request_reason: line.request_reason,
          gender: line.gender,
          type: line.type,
          inventory_category_name: line.inventory_category_name,
          inventory_item_name: line.inventory_item_name,
          inventory_requested_sku: line.inventory_requested_sku,
          inventory_components_json: line.inventory_components_json,
        });
        createdIds.push(row.request_id);
        requestRows.push(row);
      }

      const batchReference = buildBatchReference(requestRows[0].request_id);

      if (inventoryOn) {
        try {
          await forwardRequestToInventory(requestRows, {
            requestedBy: req.user.fullName || req.user.email || 'PSMS Admin',
            reason: sharedReason,
            branchName: branchNameText,
            batchReference,
          });
        } catch (inventoryError) {
          const keepLocal =
            inventoryError?.code === 'INVENTORY_SCHEMA_MISSING' ||
            String(inventoryError?.message || '').includes('missing inventory tracking columns');

          if (!keepLocal && createdIds.length) {
            await dbQuery(
              `DELETE FROM merchandiserequestlogtbl WHERE request_id = ANY($1::int[])`,
              [createdIds]
            );
          } else if (keepLocal) {
            console.error(
              '[merchandise-requests] RHET accepted batch but CMS schema is incomplete. Local rows kept:',
              createdIds
            );
          }

          console.error('[merchandise-requests] RHET Inventory batch forward failed:', {
            message: inventoryError.message,
            code: inventoryError.code,
            status: inventoryError.status,
            details: inventoryError.details,
            localRequestIds: createdIds,
            localRequestKept: keepLocal,
            batchReference,
          });
          const statusCode =
            inventoryError instanceof InventoryApiError ||
            inventoryError?.name === 'InventoryApiError'
              ? inventoryError.status || 502
              : 500;
          return res.status(statusCode).json({
            success: false,
            message:
              inventoryError.message ||
              'Failed to submit stock request to RHET Inventory. Please try again or contact support.',
            error: {
              code: inventoryError.code || 'INVENTORY_FORWARD_FAILED',
              details: inventoryError.details || null,
            },
            data: keepLocal ? requestRows : undefined,
          });
        }
      } else {
        const legacyBranchLabel = branchNameText || 'Unknown Branch';
        const summary = requestRows
          .map((row) => `${row.requested_quantity} × ${row.merchandise_name}`)
          .join(', ');
        await dbQuery(
          `INSERT INTO announcementstbl (title, body, recipient_groups, status, priority, created_by, navigation_key, navigation_query)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            'New Merchandise Stock Request',
            `${req.user.fullName || req.user.email} from ${legacyBranchLabel} requested: ${summary}${
              sharedReason ? `. Reason: ${sharedReason}` : ''
            }`,
            ['Superadmin'],
            'Active',
            'High',
            req.user.userId,
            'merchandise',
            'notificationTab=requests',
          ]
        );
      }

      const refreshed = await dbQuery(
        `SELECT * FROM merchandiserequestlogtbl
         WHERE request_id = ANY($1::int[])
         ORDER BY request_id`,
        [createdIds]
      );

      res.status(201).json({
        success: true,
        message: inventoryOn
          ? 'Stock request submitted to RHET Central Inventory. Stock will be added to your branch when inventory marks it delivered.'
          : 'Merchandise request created successfully',
        data: refreshed.rows,
        batchReference: inventoryOn ? batchReference : null,
        inventoryIntegrated: inventoryOn,
      });
    } catch (error) {
      if (createdIds.length) {
        try {
          await dbQuery(
            `DELETE FROM merchandiserequestlogtbl WHERE request_id = ANY($1::int[])`,
            [createdIds]
          );
        } catch (cleanupErr) {
          console.error('[merchandise-requests] Batch local cleanup failed:', cleanupErr.message);
        }
      }
      next(error);
    }
  }
);

/**
 * POST /api/v1/merchandise-requests/returns/batch
 * Branch Admin Return Stock: deduct existing branch qty, log as Returned,
 * then forward one RHET POST /stock-returns with shared PSMS-RET batchReference.
 * Access: Admin only
 */
router.post(
  '/returns/batch',
  [
    body('request_reason')
      .trim()
      .isLength({ min: 5 })
      .withMessage('Return reason must be at least 5 characters'),
    body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
    body('items.*.merchandise_id').isInt({ min: 1 }).withMessage('merchandise_id is required'),
    body('items.*.requested_quantity')
      .isInt({ min: 1 })
      .withMessage('Return quantity must be at least 1'),
    handleValidationErrors,
  ],
  requireRole('Admin'),
  async (req, res, next) => {
    const createdIds = [];
    const deducted = [];
    const client = await getClient();
    try {
      const inventoryOn = isInventoryIntegrationEnabled();
      const sharedReason = unwrapStockReturnReason(req.body.request_reason) ||
        String(req.body.request_reason || '').trim();
      const storedReason = wrapStockReturnReason(sharedReason);
      const incomingItems = Array.isArray(req.body.items) ? req.body.items : [];

      if (!req.user?.branchId) {
        return res.status(400).json({
          success: false,
          message: 'Your account is not assigned to a branch.',
          error: { code: 'BRANCH_REQUIRED' },
        });
      }

      const branchLookup = await dbQuery(
        'SELECT branch_name FROM branchestbl WHERE branch_id = $1',
        [req.user.branchId]
      );
      const branchNameText = normalizeInventoryBranchName(branchLookup.rows[0]?.branch_name);
      if (inventoryOn && !branchNameText) {
        return res.status(400).json({
          success: false,
          message:
            'Your branch does not have a valid display name (at least 2 characters). ' +
            'Update the branch name in CMS before returning stock to RHET Inventory.',
          error: { code: 'BRANCH_NAME_REQUIRED' },
        });
      }

      const seenIds = new Set();
      await client.query('BEGIN');
      const requestRows = [];

      for (let i = 0; i < incomingItems.length; i += 1) {
        const itemBody = incomingItems[i] || {};
        const merchandiseId = parseInt(itemBody.merchandise_id, 10);
        const requestedQuantity = parseInt(itemBody.requested_quantity, 10);
        if (seenIds.has(merchandiseId)) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: `Row ${i + 1}: the same stock variant appears more than once`,
            error: { code: 'DUPLICATE_RETURN_ROW' },
          });
        }
        seenIds.add(merchandiseId);

        let deductedRow;
        try {
          deductedRow = await deductMerchandiseStockQuantity(client, {
            merchandiseId,
            branchId: req.user.branchId,
            quantity: requestedQuantity,
          });
        } catch (deductError) {
          await client.query('ROLLBACK');
          const statusCode = deductError.status || 400;
          return res.status(statusCode).json({
            success: false,
            message: `Row ${i + 1}: ${deductError.message}`,
            error: { code: deductError.code || 'RETURN_DEDUCT_FAILED' },
          });
        }
        deducted.push({
          merchandiseId,
          quantity: requestedQuantity,
        });

        const legacyIdentity = parseLegacyItemIdentityFromRemarks(deductedRow.remarks);
        const inventoryItemName =
          String(deductedRow.item_name || '').trim() ||
          legacyIdentity.itemName ||
          null;
        const inventorySku =
          String(deductedRow.sku || '').trim() ||
          legacyIdentity.sku ||
          null;

        const row = await insertLocalMerchandiseRequestRow({
          userId: req.user.userId,
          branchId: req.user.branchId,
          linkedMerchandiseId: merchandiseId,
          merchandise_name: deductedRow.merchandise_name,
          size: deductedRow.size || null,
          requested_quantity: requestedQuantity,
          request_reason: storedReason,
          gender: deductedRow.gender || null,
          type: deductedRow.type || null,
          inventory_category_name: deductedRow.merchandise_name,
          inventory_item_name: inventoryItemName,
          inventory_requested_sku: inventorySku,
          inventory_components_json: null,
          status: 'Pending',
          executor: (sql, params) => client.query(sql, params),
        });
        createdIds.push(row.request_id);
        requestRows.push(row);
      }

      await client.query('COMMIT');

      const batchReference = buildReturnBatchReference(requestRows[0].request_id);

      if (inventoryOn) {
        try {
          await forwardReturnToInventory(requestRows, {
            requestedBy: req.user.fullName || req.user.email || 'PSMS Admin',
            reason: sharedReason,
            branchName: branchNameText,
            batchReference,
          });
        } catch (inventoryError) {
          const keepLocal =
            inventoryError?.code === 'INVENTORY_SCHEMA_MISSING' ||
            String(inventoryError?.message || '').includes('missing inventory tracking columns');

          if (!keepLocal) {
            const rollbackClient = await getClient();
            try {
              await rollbackClient.query('BEGIN');
              for (const entry of deducted) {
                await restoreMerchandiseStockQuantity(rollbackClient, {
                  merchandiseId: entry.merchandiseId,
                  quantity: entry.quantity,
                });
              }
              if (createdIds.length) {
                await rollbackClient.query(
                  `DELETE FROM merchandiserequestlogtbl WHERE request_id = ANY($1::int[])`,
                  [createdIds]
                );
              }
              await rollbackClient.query('COMMIT');
            } catch (restoreError) {
              await rollbackClient.query('ROLLBACK');
              console.error('[merchandise-returns] Failed to restore stock after RHET error:', restoreError);
            } finally {
              rollbackClient.release();
            }
          }

          console.error('[merchandise-returns] RHET Inventory return forward failed:', {
            message: inventoryError.message,
            code: inventoryError.code,
            status: inventoryError.status,
            details: inventoryError.details,
            localRequestIds: createdIds,
            localRequestKept: keepLocal,
            batchReference,
          });
          const statusCode =
            inventoryError instanceof InventoryApiError ||
            inventoryError?.name === 'InventoryApiError'
              ? inventoryError.status || 502
              : 500;
          return res.status(statusCode).json({
            success: false,
            message:
              inventoryError.message ||
              'Failed to submit stock return to RHET Inventory. Branch stock was not changed. Please try again.',
            error: {
              code: inventoryError.code || 'INVENTORY_RETURN_FORWARD_FAILED',
              details: inventoryError.details || null,
            },
            data: keepLocal ? requestRows : undefined,
          });
        }
      } else {
        const legacyBranchLabel = branchNameText || 'Unknown Branch';
        const summary = requestRows
          .map((row) => `${row.requested_quantity} × ${row.merchandise_name}`)
          .join(', ');
        await dbQuery(
          `INSERT INTO announcementstbl (title, body, recipient_groups, status, priority, created_by, navigation_key, navigation_query)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            'Merchandise Stock Return',
            `${req.user.fullName || req.user.email} from ${legacyBranchLabel} returned: ${summary}${
              sharedReason ? `. Reason: ${sharedReason}` : ''
            }`,
            ['Superadmin'],
            'Active',
            'High',
            req.user.userId,
            'merchandise',
            'notificationTab=requests',
          ]
        );
      }

      const refreshed = await dbQuery(
        `SELECT * FROM merchandiserequestlogtbl
         WHERE request_id = ANY($1::int[])
         ORDER BY request_id`,
        [createdIds]
      );

      res.status(201).json({
        success: true,
        message: inventoryOn
          ? 'Stock return submitted to RHET. Branch quantities were deducted. It stays Pending until HQ marks reusable or not reusable.'
          : 'Stock return recorded. Branch quantities were deducted. It stays Pending until reviewed.',
        data: refreshed.rows,
        batchReference: inventoryOn ? batchReference : null,
        inventoryIntegrated: inventoryOn,
      });
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      if (createdIds.length || deducted.length) {
        try {
          const rollbackClient = await getClient();
          try {
            await rollbackClient.query('BEGIN');
            for (const entry of deducted) {
              await restoreMerchandiseStockQuantity(rollbackClient, {
                merchandiseId: entry.merchandiseId,
                quantity: entry.quantity,
              });
            }
            if (createdIds.length) {
              await rollbackClient.query(
                `DELETE FROM merchandiserequestlogtbl WHERE request_id = ANY($1::int[])`,
                [createdIds]
              );
            }
            await rollbackClient.query('COMMIT');
          } catch (restoreError) {
            await rollbackClient.query('ROLLBACK');
            console.error('[merchandise-returns] Unexpected cleanup failed:', restoreError);
          } finally {
            rollbackClient.release();
          }
        } catch (cleanupErr) {
          console.error('[merchandise-returns] Cleanup client failed:', cleanupErr.message);
        }
      }
      next(error);
    } finally {
      client.release();
    }
  }
);

/**
 * POST /api/v1/merchandise-requests/:id/sync-inventory
 * Poll RHET for this request's status and apply:
 * - SHIPPED → local Shipped (no stock)
 * - DELIVERED (or legacy FULFILLED) → local Delivered + credit branch stock once
 * Use when the webhook was missed.
 * Access: Superadmin, Admin (own branch)
 */
router.post(
  '/:id/sync-inventory',
  [
    param('id').isInt().withMessage('Request ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      if (!isInventoryIntegrationEnabled()) {
        return res.status(503).json({
          success: false,
          message: 'RHET Inventory integration is not configured',
        });
      }

      await client.query('BEGIN');

      let sql = 'SELECT * FROM merchandiserequestlogtbl WHERE request_id = $1 FOR UPDATE';
      const params = [req.params.id];
      if (req.user.userType === 'Admin') {
        sql = 'SELECT * FROM merchandiserequestlogtbl WHERE request_id = $1 AND requested_branch_id = $2 FOR UPDATE';
        params.push(req.user.branchId);
      }

      const locked = await client.query(sql, params);
      if (locked.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: 'Request not found' });
      }

      const request = locked.rows[0];
      if (!request.inventory_request_id) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message:
            'This request has no inventory_request_id. Run migration 124 and re-submit, or use the repair script with the RHET request UUID.',
        });
      }

      if (isStockCreditedLocalStatus(request.status)) {
        const remote = await getStockRequest(request.inventory_request_id);
        const processedBy = pickApproverName(remote.data || remote);
        const existingProcessedBy = request.inventory_processed_by
          ? String(request.inventory_processed_by).trim()
          : '';
        const needsNameBackfill =
          processedBy && (!existingProcessedBy || looksLikeUuid(existingProcessedBy));
        const remoteStatusRaw = remote.data?.status
          ? normalizeRemoteStatus(remote.data.status)
          : null;
        const storeStatus =
          remoteStatusRaw === 'FULFILLED' ? 'DELIVERED' : remoteStatusRaw;

        if (needsNameBackfill) {
          await runIgnoringMissingUpdatedAt(
            client.query.bind(client),
            `UPDATE merchandiserequestlogtbl
             SET inventory_processed_by = $1,
                 inventory_status = COALESCE($2, inventory_status),
                 inventory_matched_sku = COALESCE($3, inventory_matched_sku),
                 inventory_synced_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
             WHERE request_id = $4`,
            [
              processedBy,
              storeStatus,
              remote.data?.matchedSku || null,
              request.request_id,
            ]
          );
          const refreshed = await client.query(
            'SELECT * FROM merchandiserequestlogtbl WHERE request_id = $1',
            [request.request_id]
          );
          await client.query('COMMIT');
          return res.json({
            success: true,
            message: 'Request already delivered — backfilled Approved By from RHET',
            data: mapRowTimestampsToManila(refreshed.rows[0]),
          });
        }
        await client.query('COMMIT');
        return res.json({
          success: true,
          message: 'Request is already delivered and stock was applied',
          data: mapRowTimestampsToManila(request),
        });
      }

      const remote = await getStockRequest(request.inventory_request_id);
      const remoteStatus = normalizeRemoteStatus(remote.data?.status);
      const processedBy = pickApproverName(remote.data || remote);
      const storeStatus =
        remoteStatus === 'FULFILLED' ? 'DELIVERED' : remoteStatus || null;

      await runIgnoringMissingUpdatedAt(
        client.query.bind(client),
        `UPDATE merchandiserequestlogtbl
         SET inventory_status = $1,
             inventory_matched_sku = COALESCE($2, inventory_matched_sku),
             inventory_processed_by = COALESCE($3, inventory_processed_by),
             inventory_synced_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE request_id = $4`,
        [
          storeStatus,
          remote.data?.matchedSku || null,
          processedBy,
          request.request_id,
        ]
      );

      // SHIPPED: update local status only — no branch stock
      if (isShippedRemoteStatus(remoteStatus)) {
        if (request.status === LOCAL_REQUEST_STATUS.PENDING) {
          await runIgnoringMissingUpdatedAt(
            client.query.bind(client),
            `UPDATE merchandiserequestlogtbl
             SET status = $1,
                 reviewed_at = COALESCE(reviewed_at, CURRENT_TIMESTAMP),
                 review_notes = COALESCE(review_notes, $2),
                 inventory_status = 'SHIPPED',
                 updated_at = CURRENT_TIMESTAMP
             WHERE request_id = $3`,
            [
              LOCAL_REQUEST_STATUS.SHIPPED,
              'Synced from RHET Inventory: marked shipped (in transit). Stock adds on delivery.',
              request.request_id,
            ]
          );
        }
        const refreshed = await client.query(
          'SELECT * FROM merchandiserequestlogtbl WHERE request_id = $1',
          [request.request_id]
        );
        await client.query('COMMIT');
        return res.json({
          success: true,
          message: 'RHET status is SHIPPED — local request marked Shipped; stock is only added when DELIVERED',
          data: mapRowTimestampsToManila(refreshed.rows[0]),
        });
      }

      if (!isDeliveredRemoteStatus(remoteStatus)) {
        await client.query('COMMIT');
        return res.json({
          success: true,
          message: `RHET status is ${remoteStatus || 'unknown'} — stock is only added when DELIVERED`,
          data: mapRowTimestampsToManila({
            ...request,
            inventory_status: storeStatus,
            inventory_processed_by: processedBy || request.inventory_processed_by,
          }),
        });
      }

      if (
        request.status !== LOCAL_REQUEST_STATUS.PENDING &&
        request.status !== LOCAL_REQUEST_STATUS.SHIPPED
      ) {
        await client.query('COMMIT');
        return res.status(400).json({
          success: false,
          message: `Cannot apply stock for local status: ${request.status}`,
        });
      }

      const identity = resolveUniformFulfillIdentity({
        request,
        payload: remote.data || {},
      });
      const stockResult = await applyMerchandiseRequestStock(client, {
        ...request,
        inventory_matched_sku:
          remote.data?.matchedSku || request.inventory_matched_sku || null,
        inventory_category_name:
          remote.data?.categoryName ||
          remote.data?.category_name ||
          request.inventory_category_name ||
          null,
        gender: identity.gender,
        type: identity.type,
        size: identity.size,
      });
      if (stockResult?.merchandiseId) {
        await client.query(
          `UPDATE merchandiserequestlogtbl SET merchandise_id = $1 WHERE request_id = $2`,
          [stockResult.merchandiseId, request.request_id]
        );
      }
      const updated = await runIgnoringMissingUpdatedAt(
        client.query.bind(client),
        `UPDATE merchandiserequestlogtbl
         SET status = $1,
             reviewed_at = CURRENT_TIMESTAMP,
             review_notes = COALESCE(review_notes, $2),
             inventory_status = 'DELIVERED',
             inventory_processed_by = COALESCE($3, inventory_processed_by),
             inventory_synced_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE request_id = $4
         RETURNING *`,
        [
          LOCAL_REQUEST_STATUS.DELIVERED,
          `Synced from RHET Inventory (${remote.data?.matchedSku || request.inventory_request_id}). Stock ${stockResult.action}.`,
          processedBy,
          request.request_id,
        ]
      );

      await client.query('COMMIT');
      res.json({
        success: true,
        message: 'RHET delivery synced — branch stock updated',
        data: mapRowTimestampsToManila(updated.rows[0]),
        stockResult,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      if (isInventoryApiError(error)) {
        return res.status(error.status || 502).json({
          success: false,
          message: error.message,
          error: { code: error.code },
        });
      }
      next(error);
    } finally {
      client.release();
    }
  }
);

/**
 * POST /api/sms/merchandise-requests/:id/confirm-delivery
 * Branch Admin confirms physical receipt while local status is Shipped.
 *
 * Flow (aligned with RHET contract):
 * 1. POST {INVENTORY_API_URL}/stock-requests/:inventoryId/deliver  (path /deliver)
 * 2. RHET: SHIPPED → DELIVERED (409 if not SHIPPED; 200 idempotent if already DELIVERED)
 * 3. CMS credits branch stock once; later stock_request.delivered / .fulfilled webhooks are idempotent
 *
 * Access: Admin (own branch only)
 */
router.post(
  '/:id/confirm-delivery',
  [
    param('id').isInt().withMessage('Request ID must be an integer'),
    body('notes').optional({ nullable: true }).trim(),
    handleValidationErrors,
  ],
  requireRole('Admin'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      if (!isInventoryIntegrationEnabled()) {
        return res.status(503).json({
          success: false,
          message: 'RHET Inventory integration is not configured',
          error: { code: 'INTEGRATION_DISABLED' },
        });
      }

      await client.query('BEGIN');

      const locked = await client.query(
        `SELECT * FROM merchandiserequestlogtbl
         WHERE request_id = $1 AND requested_branch_id = $2
         FOR UPDATE`,
        [req.params.id, req.user.branchId]
      );

      if (locked.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: 'Request not found' });
      }

      const request = locked.rows[0];

      if (isStockCreditedLocalStatus(request.status)) {
        await client.query('COMMIT');
        return res.json({
          success: true,
          message: 'Request is already delivered and stock was applied',
          data: mapRowTimestampsToManila(request),
          alreadyDelivered: true,
        });
      }

      if (request.status !== LOCAL_REQUEST_STATUS.SHIPPED) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `Only Shipped requests can be confirmed received (current: ${request.status})`,
          error: { code: 'NOT_SHIPPED' },
        });
      }

      if (!request.inventory_request_id) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message:
            'This request has no RHET inventory_request_id. Cannot confirm delivery with Central Inventory.',
          error: { code: 'MISSING_INVENTORY_REQUEST_ID' },
        });
      }

      const branchLookup = await client.query(
        'SELECT branch_name FROM branchestbl WHERE branch_id = $1',
        [req.user.branchId]
      );
      const branchName =
        normalizeInventoryBranchName(branchLookup.rows[0]?.branch_name) ||
        String(branchLookup.rows[0]?.branch_name || '').trim() ||
        undefined;
      const confirmedBy =
        req.user.fullName || req.user.email || 'Branch Admin';
      const notes =
        String(req.body.notes || '').trim() ||
        'Branch admin confirmed physical receipt in CMS';

      let remote;
      try {
        remote = await markStockRequestDelivered(request.inventory_request_id, {
          confirmedBy,
          branchName,
          notes,
        });
      } catch (inventoryError) {
        await client.query('ROLLBACK');
        const statusCode =
          inventoryError instanceof InventoryApiError ||
          inventoryError?.name === 'InventoryApiError'
            ? inventoryError.status || 502
            : 502;
        // RHET returns 409 when request is not SHIPPED (and not already DELIVERED)
        const message =
          statusCode === 409
            ? inventoryError.message ||
              'RHET Inventory cannot mark this request delivered (it must be Shipped).'
            : inventoryError.message ||
              'Failed to mark request delivered in RHET Inventory. Please try again.';
        return res.status(statusCode).json({
          success: false,
          message,
          error: {
            code:
              statusCode === 409
                ? 'RHET_NOT_SHIPPED'
                : inventoryError.code || 'INVENTORY_DELIVER_FAILED',
            details: inventoryError.details || null,
          },
        });
      }

      const remoteData = remote?.data && typeof remote.data === 'object' ? remote.data : remote;
      const remoteStatus = String(remoteData?.status || 'DELIVERED').toUpperCase();
      // HTTP 200 from /deliver is authoritative (first transition or RHET idempotent already-DELIVERED).
      if (remoteStatus === 'REJECTED' || remoteStatus === 'FAILED' || remoteStatus === 'RETURNED') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          message: `RHET returned status ${remoteStatus}; cannot confirm delivery.`,
          error: { code: 'UNEXPECTED_REMOTE_STATUS', details: { remoteStatus } },
        });
      }

      console.log('[merchandise-requests] RHET /deliver OK', {
        localRequestId: request.request_id,
        inventoryRequestId: request.inventory_request_id,
        remoteStatus,
        rhetAlreadyDelivered: isDeliveredRemoteStatus(remoteStatus),
      });

      const identity = resolveUniformFulfillIdentity({
        request,
        payload: remoteData || {},
      });
      const stockResult = await applyMerchandiseRequestStock(client, {
        ...request,
        inventory_matched_sku:
          remoteData?.matchedSku || request.inventory_matched_sku || null,
        inventory_item_name:
          remoteData?.itemName ||
          remoteData?.item_name ||
          request.inventory_item_name ||
          null,
        inventory_category_name:
          remoteData?.categoryName ||
          remoteData?.category_name ||
          request.inventory_category_name ||
          null,
        gender: identity.gender,
        type: identity.type,
        size: identity.size,
      });

      if (stockResult?.merchandiseId) {
        await client.query(
          `UPDATE merchandiserequestlogtbl SET merchandise_id = $1 WHERE request_id = $2`,
          [stockResult.merchandiseId, request.request_id]
        );
      }

      const updated = await runIgnoringMissingUpdatedAt(
        client.query.bind(client),
        `UPDATE merchandiserequestlogtbl
         SET status = $1,
             reviewed_at = CURRENT_TIMESTAMP,
             review_notes = COALESCE(review_notes, $2),
             inventory_status = 'DELIVERED',
             inventory_processed_by = COALESCE($3, inventory_processed_by),
             inventory_matched_sku = COALESCE($4, inventory_matched_sku),
             inventory_synced_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE request_id = $5
         RETURNING *`,
        [
          LOCAL_REQUEST_STATUS.DELIVERED,
          `Branch confirmed receipt (${confirmedBy}). RHET marked delivered. Stock ${stockResult.action} on branch.${notes ? ` Notes: ${notes}` : ''}`,
          confirmedBy,
          remoteData?.matchedSku || null,
          request.request_id,
        ]
      );

      await client.query('COMMIT');
      return res.json({
        success: true,
        message:
          'Receipt confirmed. RHET Inventory moved the request to Delivered and branch stock was updated.',
        data: mapRowTimestampsToManila(updated.rows[0]),
        stockResult,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally {
      client.release();
    }
  }
);

/**
 * PUT /api/v1/merchandise-requests/:id/approve
 * Approve a merchandise request
 * Access: Superadmin only
 */
router.put(
  '/:id/approve',
  [
    param('id').isInt().withMessage('Request ID must be an integer'),
    body('review_notes').optional().trim(),
    body('price').notEmpty().withMessage('Price is required').isFloat({ min: 0.01 }).withMessage('Price must be greater than 0'),
    handleValidationErrors,
  ],
  requireRole('Superadmin'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { id } = req.params;
      const { review_notes, price } = req.body;

      // Get request details
      const requestResult = await client.query(
        'SELECT * FROM merchandiserequestlogtbl WHERE request_id = $1',
        [id]
      );

      if (requestResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Request not found',
        });
      }

      const request = requestResult.rows[0];

      // Check if request is still pending
      if (request.status !== 'Pending') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `Cannot approve request with status: ${request.status}`,
        });
      }

      // Inventory-integrated requests are delivered by RHET webhook (auto-adds branch stock).
      // Block Superadmin manual approve to avoid double-adding stock.
      if (
        request.inventory_request_id &&
        !['DELIVERED', 'FULFILLED'].includes(
          String(request.inventory_status || '').toUpperCase()
        )
      ) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message:
            'This request was sent to RHET Central Inventory. Stock will be added automatically when the inventory admin marks it delivered. Manual Superadmin approval is not needed.',
        });
      }

      // Price is required - use provided price
      const finalPrice = parseFloat(price);

      // Always use the same fulfill applier as RHET webhook (item-aware for Workbooks/etc.)
      const identity = resolveUniformFulfillIdentity({ request, payload: {} });
      const stockResult = await applyMerchandiseRequestStock(
        client,
        {
          ...request,
          gender: identity.gender,
          type: identity.type,
          size: identity.size,
        },
        {
          price: finalPrice,
        }
      );
      console.log(
        `✅ Stock ${stockResult.action} for request ${id}: merchandise_id=${stockResult.merchandiseId}, qty=${stockResult.newQuantity}`
      );

      if (stockResult?.merchandiseId) {
        await client.query(
          `UPDATE merchandiserequestlogtbl SET merchandise_id = $1 WHERE request_id = $2`,
          [stockResult.merchandiseId, id]
        );
      }

      // Update request status to Approved
      const updateResult = await runIgnoringMissingUpdatedAt(
        client.query.bind(client),
        `UPDATE merchandiserequestlogtbl
         SET status = 'Approved',
             reviewed_by = $1,
             reviewed_at = CURRENT_TIMESTAMP,
             review_notes = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE request_id = $3
         RETURNING *`,
        [req.user.userId, review_notes || null, id]
      );

      // Create notification for Admin who made the request
      const requesterName = await client.query('SELECT full_name, email FROM userstbl WHERE user_id = $1', [request.requested_by]);
      const requesterNameText = requesterName.rows[0]?.full_name || requesterName.rows[0]?.email || 'Admin';
      
      await client.query(
        `INSERT INTO announcementstbl (title, body, recipient_groups, status, priority, branch_id, created_by, navigation_key, navigation_query)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          'Merchandise Request Approved',
          `Your request for ${request.requested_quantity} units of ${request.merchandise_name}${request.size ? ` (Size: ${request.size})` : ''} has been approved. ${review_notes ? `Notes: ${review_notes}` : 'The stock has been added to your inventory.'}`,
          ['Admin'],
          'Active',
          'Medium',
          request.requested_branch_id,
          req.user.userId,
          'merchandise',
          'notificationTab=requests',
        ]
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Merchandise request approved successfully',
        data: mapRowTimestampsToManila(updateResult.rows[0]),
      });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally {
      client.release();
    }
  }
);

/**
 * PUT /api/v1/merchandise-requests/:id/reject
 * Reject a merchandise request
 * Access: Superadmin only
 */
router.put(
  '/:id/reject',
  [
    param('id').isInt().withMessage('Request ID must be an integer'),
    body('review_notes').notEmpty().trim().withMessage('Rejection reason is required'),
    handleValidationErrors,
  ],
  requireRole('Superadmin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { review_notes } = req.body;

      // Get request details
      const requestResult = await dbQuery(
        'SELECT * FROM merchandiserequestlogtbl WHERE request_id = $1',
        [id]
      );

      if (requestResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Request not found',
        });
      }

      const request = requestResult.rows[0];

      // Check if request is still pending
      if (request.status !== 'Pending') {
        return res.status(400).json({
          success: false,
          message: `Cannot reject request with status: ${request.status}`,
        });
      }

      // Update request status to Rejected
      const result = await runIgnoringMissingUpdatedAt(
        dbQuery,
        `UPDATE merchandiserequestlogtbl 
         SET status = 'Rejected', 
             reviewed_by = $1, 
             reviewed_at = CURRENT_TIMESTAMP, 
             review_notes = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE request_id = $3
         RETURNING *`,
        [req.user.userId, review_notes, id]
      );

      // Create notification for Admin who made the request
      await dbQuery(
        `INSERT INTO announcementstbl (title, body, recipient_groups, status, priority, branch_id, created_by, navigation_key, navigation_query)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          'Merchandise Request Rejected',
          `Your request for ${request.requested_quantity} units of ${request.merchandise_name}${request.size ? ` (Size: ${request.size})` : ''} has been rejected. Reason: ${review_notes}`,
          ['Admin'],
          'Active',
          'Medium',
          request.requested_branch_id,
          req.user.userId,
          'merchandise',
          'notificationTab=requests',
        ]
      );

      res.json({
        success: true,
        message: 'Merchandise request rejected',
        data: mapRowTimestampsToManila(result.rows[0]),
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/v1/merchandise-requests/:id/cancel
 * Cancel a pending merchandise request
 * Access: Admin (own requests only)
 */
router.put(
  '/:id/cancel',
  [
    param('id').isInt().withMessage('Request ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Admin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      // Get request details
      const requestResult = await dbQuery(
        'SELECT * FROM merchandiserequestlogtbl WHERE request_id = $1 AND requested_branch_id = $2',
        [id, req.user.branchId]
      );

      if (requestResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Request not found',
        });
      }

      const request = requestResult.rows[0];

      // Check if request is still pending
      if (request.status !== 'Pending') {
        return res.status(400).json({
          success: false,
          message: `Cannot cancel request with status: ${request.status}`,
        });
      }

      // Update request status to Cancelled
      const result = await runIgnoringMissingUpdatedAt(
        dbQuery,
        `UPDATE merchandiserequestlogtbl 
         SET status = 'Cancelled', 
             updated_at = CURRENT_TIMESTAMP
         WHERE request_id = $1
         RETURNING *`,
        [id]
      );

      res.json({
        success: true,
        message: 'Merchandise request cancelled',
        data: mapRowTimestampsToManila(result.rows[0]),
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/v1/merchandise-requests/:id
 * Delete a merchandise request (only if Cancelled or Rejected)
 * Access: Superadmin, Admin (own requests only)
 */
router.delete(
  '/:id',
  [
    param('id').isInt().withMessage('Request ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      let sql = 'SELECT * FROM merchandiserequestlogtbl WHERE request_id = $1';
      const params = [id];

      // Admin can only delete their branch requests
      if (req.user.userType === 'Admin') {
        sql += ' AND requested_branch_id = $2';
        params.push(req.user.branchId);
      }

      const requestResult = await dbQuery(sql, params);

      if (requestResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Request not found',
        });
      }

      const request = requestResult.rows[0];

      // Only allow deletion of Cancelled or Rejected requests
      if (!['Cancelled', 'Rejected'].includes(request.status)) {
        return res.status(400).json({
          success: false,
          message: 'Can only delete Cancelled or Rejected requests',
        });
      }

      await dbQuery('DELETE FROM merchandiserequestlogtbl WHERE request_id = $1', [id]);

      res.json({
        success: true,
        message: 'Merchandise request deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;

