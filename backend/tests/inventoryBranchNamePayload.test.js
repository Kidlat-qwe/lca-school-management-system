/**
 * RHET requires top-level branchName on POST /stock-requests.
 * Run: node backend/tests/inventoryBranchNamePayload.test.js
 */

import assert from 'node:assert/strict';
import {
  buildInventorySubmitPayload,
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
  assert.equal('branchName' in (payload.items[0] || {}), false);
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
}

testNormalizeBranchName();
testPayloadIncludesTopLevelBranchName();
testPayloadRejectsMissingBranchName();
testNonUniformPayloadKeepsBranchTopLevel();
console.log('inventoryBranchNamePayload.test.js: all passed');
