/**
 * Return Stock HQ inspection: PENDING create is success; PSMS-RET-* parse;
 * stock_return webhooks must not be treated as stock_request.returned.
 * Run: node backend/tests/inventoryReturnLifecycle.test.js
 */

import assert from 'node:assert/strict';
import {
  buildReturnExternalReference,
  parseReturnLocalRequestIdFromExternalReference,
  isReturnExternalReference,
  parseLocalRequestIdFromExternalReference,
  extractRemoteInventoryItems,
  normalizeReturnCreateInventoryStatus,
  buildReturnInspectionNotes,
  RETURN_REUSABLE_MARKER,
  RETURN_NOT_REUSABLE_MARKER,
} from '../services/inventory/inventoryFieldMapping.js';
import {
  inferInventoryStatusFromPayload,
  isReturnedEvent,
  isStockReturnWebhookEvent,
  isStockReturnAcceptedEvent,
  isStockReturnReceivedEvent,
} from '../services/inventory/stockRequestLifecycle.js';

function testReturnRefs() {
  assert.equal(buildReturnExternalReference(82), 'PSMS-RET-82');
  assert.equal(isReturnExternalReference('PSMS-RET-82'), true);
  assert.equal(isReturnExternalReference('PSMS-82'), false);
  assert.equal(parseReturnLocalRequestIdFromExternalReference('PSMS-RET-82'), 82);
  assert.equal(parseLocalRequestIdFromExternalReference('PSMS-RET-82'), null);
  assert.equal(parseLocalRequestIdFromExternalReference('PSMS-82'), 82);
}

function testCreateStatusDoesNotRequireReturned() {
  assert.equal(normalizeReturnCreateInventoryStatus('PENDING'), 'PENDING');
  assert.equal(normalizeReturnCreateInventoryStatus('RECEIVED'), 'RECEIVED');
  assert.equal(normalizeReturnCreateInventoryStatus(''), 'PENDING');
  assert.equal(normalizeReturnCreateInventoryStatus('RETURNED'), 'RETURNED');
  assert.equal(normalizeReturnCreateInventoryStatus('FAILED'), 'FAILED');
}

function testExtractRemoteItems() {
  assert.deepEqual(
    extractRemoteInventoryItems({
      data: [{ requestId: 'a', status: 'PENDING', externalReference: 'PSMS-RET-82' }],
    }).map((i) => i.requestId),
    ['a']
  );
  assert.equal(
    extractRemoteInventoryItems({
      data: { requestId: 'b', status: 'PENDING', externalReference: 'PSMS-RET-82' },
    })[0].requestId,
    'b'
  );
  assert.equal(
    extractRemoteInventoryItems({
      data: {
        items: [{ requestId: 'c', status: 'PENDING', externalReference: 'PSMS-RET-83' }],
      },
    })[0].requestId,
    'c'
  );
}

function testStockReturnWebhookClassification() {
  assert.equal(isStockReturnWebhookEvent({ event: 'stock_return.received' }), true);
  assert.equal(isStockReturnWebhookEvent({ event: 'stock_return.accepted' }), true);
  assert.equal(isStockReturnWebhookEvent({ requestKind: 'RETURN', status: 'PENDING' }), true);
  assert.equal(isStockReturnWebhookEvent({ event: 'stock_request.returned' }), false);

  assert.equal(isStockReturnReceivedEvent({ event: 'stock_return.received', status: 'PENDING' }), true);
  assert.equal(isStockReturnAcceptedEvent({ event: 'stock_return.accepted', status: 'RETURNED' }), true);

  assert.equal(inferInventoryStatusFromPayload({ event: 'stock_return.received' }), 'RECEIVED');
  assert.equal(inferInventoryStatusFromPayload({ event: 'stock_return.accepted' }), 'RETURNED');
  assert.equal(inferInventoryStatusFromPayload({ event: 'stock_request.returned' }), 'RETURNED');

  // stock_request.returned must still classify as inbound return, not stock_return.*
  assert.equal(isReturnedEvent({ event: 'stock_request.returned', status: 'RETURNED' }), true);
  assert.equal(isStockReturnWebhookEvent({ event: 'stock_request.returned', status: 'RETURNED' }), false);
}

function testInspectionNotes() {
  const reusable = buildReturnInspectionNotes({
    returnReusable: true,
    returnNotes: 'Good condition',
    processedBy: 'HQ Admin',
  });
  assert.equal(reusable.includes(RETURN_REUSABLE_MARKER), true);
  assert.equal(reusable.includes('Good condition'), true);

  const damaged = buildReturnInspectionNotes({
    returnReusable: false,
    returnNotes: 'Torn strap',
  });
  assert.equal(damaged.includes(RETURN_NOT_REUSABLE_MARKER), true);
  assert.equal(damaged.includes('not reusable'), true);
}

testReturnRefs();
testCreateStatusDoesNotRequireReturned();
testExtractRemoteItems();
testStockReturnWebhookClassification();
testInspectionNotes();
console.log('inventoryReturnLifecycle.test.js: all passed');
