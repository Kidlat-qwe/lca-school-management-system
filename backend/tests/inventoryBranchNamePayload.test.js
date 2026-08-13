/**
 * RHET requires top-level branchName on POST /stock-requests.
 * Multi-item carts also require a shared top-level batchReference.
 * Return Stock uses requestType RETURN + PSMS-RET-* refs.
 * Run: node backend/tests/inventoryBranchNamePayload.test.js
 */

import assert from 'node:assert/strict';
import {
  buildInventorySubmitPayload,
  buildInventoryReturnPayload,
  buildBatchReference,
  buildReturnBatchReference,
  buildReturnExternalReference,
  wrapStockReturnReason,
  unwrapStockReturnReason,
  normalizeInventoryBranchName,
} from '../services/inventory/inventoryFieldMapping.js';

function testNormalizeBranchName() {
  assert.equal(normalizeInventoryBranchName('LCA Makati'), 'LCA Makati');
  assert.equal(normalizeInventoryBranchName('  LCA Cebu  '), 'LCA Cebu');
  assert.equal(normalizeInventoryBranchName('A'), null);
  assert.equal(normalizeInventoryBranchName(''), null);
  assert.equal(normalizeInventoryBranchName(null), null);
  assert.equal(normalizeInventoryBranchName('12'), null);
  assert.equal(normalizeInventoryBranchName('550e8400-e29b-41d4-a716-446655440000'), null);
}

function testPayloadIncludesTopLevelBranchName() {
  const payload = buildInventorySubmitPayload({
    requestRow: {
      request_id: 41,
      merchandise_name: 'Shirt',
      inventory_category_name: 'Shirt',
      gender: 'Unisex',
      type: 'Logo 1',
      size: 'M',
      requested_quantity: 2,
    },
    requestedBy: 'Jane Admin',
    reason: 'Restock PE Logo 1 shirts for campus display',
    webhookUrl: 'https://api-cms.lca-app.com/api/webhooks/inventory',
    branchName: 'LCA Makati',
  });

  assert.equal(payload.branchName, 'LCA Makati');
  assert.equal(payload.requestedBy, 'Jane Admin');
  assert.equal(payload.items[0].externalReference, 'PSMS-41');
  assert.equal(payload.items[0].categoryName, 'Shirt');
  assert.equal(payload.batchReference, 'PSMS-REQ-41');
  assert.equal('branchName' in (payload.items[0] || {}), false);
  assert.equal('batchReference' in (payload.items[0] || {}), false);
}

function testPayloadRejectsMissingBranchName() {
  assert.throws(
    () =>
      buildInventorySubmitPayload({
        requestRow: {
          request_id: 42,
          merchandise_name: 'Backpack',
          inventory_category_name: 'Backpack',
          inventory_item_name: 'school-backpack',
          inventory_requested_sku: 'BP-001',
          requested_quantity: 1,
        },
        requestedBy: 'Jane Admin',
        reason: 'Restock backpacks',
        branchName: '',
      }),
    (err) => err?.code === 'BRANCH_NAME_REQUIRED'
  );
}

function testNonUniformPayloadKeepsBranchTopLevel() {
  const payload = buildInventorySubmitPayload({
    requestRow: {
      request_id: 42,
      merchandise_name: 'Backpack',
      inventory_category_name: 'Backpack',
      inventory_item_name: 'school-backpack',
      inventory_requested_sku: 'BP-001',
      requested_quantity: 1,
    },
    requestedBy: 'Jane Admin',
    reason: 'Restock backpacks',
    branchName: 'LCA Makati',
  });

  assert.equal(payload.branchName, 'LCA Makati');
  assert.equal(payload.items[0].itemName, 'school-backpack');
  assert.equal(payload.items[0].categoryName, 'Backpack');
  assert.equal(payload.batchReference, 'PSMS-REQ-42');
}

function testMultiItemCartSharesBatchReference() {
  assert.equal(buildBatchReference(82), 'PSMS-REQ-82');

  const payload = buildInventorySubmitPayload({
    requestRows: [
      {
        request_id: 82,
        merchandise_name: 'Shirt',
        inventory_category_name: 'Shirt',
        gender: 'Unisex',
        type: 'Logo 1',
        size: 'M',
        requested_quantity: 2,
      },
      {
        request_id: 83,
        merchandise_name: 'Backpack',
        inventory_category_name: 'Backpack',
        inventory_item_name: 'school-backpack',
        inventory_requested_sku: 'BP-001',
        requested_quantity: 1,
      },
    ],
    requestedBy: 'Jane Admin',
    reason: 'Campus restock',
    webhookUrl: 'https://api-cms.lca-app.com/api/webhooks/inventory',
    branchName: 'LCA Makati',
  });

  assert.equal(payload.batchReference, 'PSMS-REQ-82');
  assert.equal(payload.items.length, 2);
  assert.equal(payload.items[0].externalReference, 'PSMS-82');
  assert.equal(payload.items[1].externalReference, 'PSMS-83');
  assert.equal(payload.items[0].categoryName, 'Shirt');
  assert.equal(payload.items[1].categoryName, 'Backpack');
  assert.equal(payload.items[1].itemName, 'school-backpack');
  assert.equal('batchReference' in payload.items[0], false);
}

function testReturnPayloadUsesRetReferences() {
  assert.equal(buildReturnBatchReference(82), 'PSMS-RET-82');
  assert.equal(buildReturnExternalReference(82), 'PSMS-RET-82');
  assert.equal(wrapStockReturnReason('Damaged display units'), '[STOCK_RETURN] Damaged display units');
  assert.equal(unwrapStockReturnReason('[STOCK_RETURN] Damaged display units'), 'Damaged display units');

  const payload = buildInventoryReturnPayload({
    requestRows: [
      {
        request_id: 82,
        merchandise_name: 'Shirt',
        inventory_category_name: 'Shirt',
        gender: 'Unisex',
        type: 'Logo 1',
        size: 'M',
        requested_quantity: 2,
      },
      {
        request_id: 83,
        merchandise_name: 'Backpack',
        inventory_category_name: 'Backpack',
        inventory_item_name: 'school-backpack',
        inventory_requested_sku: 'BP-001',
        requested_quantity: 1,
      },
    ],
    requestedBy: 'Jane Admin',
    reason: '[STOCK_RETURN] Excess campus stock',
    webhookUrl: 'https://api-cms.lca-app.com/api/webhooks/inventory',
    branchName: 'LCA Makati',
  });

  assert.equal(payload.requestType, 'RETURN');
  assert.equal(payload.batchReference, 'PSMS-RET-82');
  assert.equal(payload.reason, 'Excess campus stock');
  assert.equal(payload.branchName, 'LCA Makati');
  assert.equal(payload.items.length, 2);
  assert.equal(payload.items[0].externalReference, 'PSMS-RET-82');
  assert.equal(payload.items[1].externalReference, 'PSMS-RET-83');
  assert.equal(payload.items[0].categoryName, 'Shirt');
  assert.equal(payload.items[1].itemName, 'school-backpack');
}

testNormalizeBranchName();
testPayloadIncludesTopLevelBranchName();
testPayloadRejectsMissingBranchName();
testNonUniformPayloadKeepsBranchTopLevel();
testMultiItemCartSharesBatchReference();
testReturnPayloadUsesRetReferences();
console.log('inventoryBranchNamePayload.test.js: all passed');
