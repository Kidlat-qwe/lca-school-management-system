/**
 * Stock request lifecycle helpers + event classification.
 * Run: node backend/tests/stockRequestLifecycle.test.js
 */

import assert from 'node:assert/strict';
import {
  isDeliveredEvent,
  isDeliveredRemoteStatus,
  isRejectedEvent,
  isReturnedEvent,
  isShippedEvent,
  isStockCreditedLocalStatus,
  inferInventoryStatusFromPayload,
  resolveWasDelivered,
} from '../services/inventory/stockRequestLifecycle.js';

function testRemoteDeliveredAliases() {
  assert.equal(isDeliveredRemoteStatus('DELIVERED'), true);
  assert.equal(isDeliveredRemoteStatus('FULFILLED'), true);
  assert.equal(isDeliveredRemoteStatus('SHIPPED'), false);
}

function testEventClassification() {
  assert.equal(isShippedEvent({ event: 'stock_request.shipped', status: 'SHIPPED' }), true);
  assert.equal(isDeliveredEvent({ event: 'stock_request.delivered', status: 'DELIVERED' }), true);
  assert.equal(isDeliveredEvent({ event: 'stock_request.fulfilled', status: 'FULFILLED' }), true);
  assert.equal(isReturnedEvent({ event: 'stock_request.returned', status: 'RETURNED' }), true);
  assert.equal(isRejectedEvent({ event: 'stock_request.rejected', status: 'REJECTED' }), true);
  assert.equal(isShippedEvent({ event: 'stock_request.delivered', status: 'DELIVERED' }), false);
}

function testInferStatus() {
  assert.equal(inferInventoryStatusFromPayload({ event: 'stock_request.fulfilled' }), 'DELIVERED');
  assert.equal(inferInventoryStatusFromPayload({ status: 'FULFILLED' }), 'DELIVERED');
  assert.equal(inferInventoryStatusFromPayload({ event: 'stock_request.shipped' }), 'SHIPPED');
  assert.equal(inferInventoryStatusFromPayload({ status: 'FAILED' }), 'REJECTED');
}

function testStockCredited() {
  assert.equal(isStockCreditedLocalStatus('Delivered'), true);
  assert.equal(isStockCreditedLocalStatus('Approved'), true);
  assert.equal(isStockCreditedLocalStatus('Shipped'), false);
  assert.equal(isStockCreditedLocalStatus('Pending'), false);
}

function testWasDelivered() {
  assert.equal(resolveWasDelivered({ wasDelivered: true }, 'Shipped'), true);
  assert.equal(resolveWasDelivered({ wasDelivered: false }, 'Shipped'), false);
  assert.equal(resolveWasDelivered({}, 'Delivered'), true);
  assert.equal(resolveWasDelivered({}, 'Approved'), true);
  assert.equal(resolveWasDelivered({}, 'Shipped'), false);
}

testRemoteDeliveredAliases();
testEventClassification();
testInferStatus();
testStockCredited();
testWasDelivered();
console.log('stockRequestLifecycle.test.js: all passed');
