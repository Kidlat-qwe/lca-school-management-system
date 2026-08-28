/**
 * RHET stock-request quantity adjustment helpers.
 * Run: node backend/tests/inventoryQuantityAdjustment.test.js
 */

import assert from 'node:assert/strict';
import {
  parseRemoteQuantity,
  resolveFulfillQuantity,
  buildQuantityAdjustmentPatch,
  isQuantityAdjustmentNoOp,
  hasStoredQuantityAdjustment,
  withFulfillQuantity,
} from '../services/inventory/quantityAdjustment.js';
import { isQuantityAdjustedEvent } from '../services/inventory/stockRequestLifecycle.js';

function testParseQuantity() {
  assert.equal(parseRemoteQuantity(5), 5);
  assert.equal(parseRemoteQuantity('3'), 3);
  assert.equal(parseRemoteQuantity(0), 0);
  assert.equal(parseRemoteQuantity(null), null);
  assert.equal(parseRemoteQuantity(''), null);
}

function testResolveFulfillQuantity() {
  const request = { requested_quantity: 3, inventory_original_quantity: 5 };
  assert.equal(resolveFulfillQuantity(request, { quantity: 3 }), 3);
  assert.equal(resolveFulfillQuantity(request, { quantity: 2 }), 2);
  assert.equal(resolveFulfillQuantity(request, {}), 3);
  assert.equal(resolveFulfillQuantity({ requested_quantity: 5 }, {}), 5);
}

function testBuildPatch() {
  const request = { requested_quantity: 5 };
  const patch = buildQuantityAdjustmentPatch(request, {
    quantity: 3,
    originalQuantity: 5,
    quantityAdjustmentRemarks: 'Only 3 available',
    adjustedBy: 'Abby',
    quantityAdjustedAt: '2026-08-28T02:40:00.000Z',
  });
  assert.equal(patch.adjustedQty, 3);
  assert.equal(patch.originalQty, 5);
  assert.equal(patch.remarks, 'Only 3 available');
  assert.equal(patch.adjustedBy, 'Abby');
}

function testNoOp() {
  const request = {
    requested_quantity: 3,
    inventory_adjustment_remarks: 'Only 3 available',
  };
  const patch = buildQuantityAdjustmentPatch(request, {
    quantity: 3,
    quantityAdjustmentRemarks: 'Only 3 available',
  });
  assert.equal(isQuantityAdjustmentNoOp(request, patch), true);
}

function testHasStoredAdjustment() {
  assert.equal(
    hasStoredQuantityAdjustment({ inventory_original_quantity: 5, requested_quantity: 3 }),
    true
  );
  assert.equal(
    hasStoredQuantityAdjustment({ inventory_original_quantity: 5, requested_quantity: 5 }),
    false
  );
  assert.equal(hasStoredQuantityAdjustment({ requested_quantity: 5 }), false);
}

function testWithFulfillQuantity() {
  const row = withFulfillQuantity({ requested_quantity: 5 }, { quantity: 3 });
  assert.equal(row.requested_quantity, 3);
}

function testEventDetection() {
  assert.equal(
    isQuantityAdjustedEvent({ event: 'stock_request.quantity_adjusted' }),
    true
  );
  assert.equal(isQuantityAdjustedEvent({ event: 'stock_request.shipped' }), false);
}

testParseQuantity();
testResolveFulfillQuantity();
testBuildPatch();
testNoOp();
testHasStoredAdjustment();
testWithFulfillQuantity();
testEventDetection();

console.log('inventoryQuantityAdjustment.test.js: all passed');
