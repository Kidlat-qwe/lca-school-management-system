/**
 * Non-uniform stock row matching (item_name / sku).
 * Run: node backend/tests/merchandiseStockItemMatch.test.js
 */

import assert from 'node:assert/strict';
import {
  parseLegacyItemIdentityFromRemarks,
  stockRowMatchesItemIdentity,
  getStockRowItemName,
} from '../services/inventory/applyMerchandiseRequestStock.js';

function testParseLegacyRemarks() {
  const parsed = parseLegacyItemIdentityFromRemarks('nc-pk-worksheets | WOR-NC-PK');
  assert.equal(parsed.itemName, 'nc-pk-worksheets');
  assert.equal(parsed.sku, 'WOR-NC-PK');
}

function testMatchByItemNameColumn() {
  const row = { item_name: 'lca-backpack', sku: 'BAC-1', remarks: null };
  assert.equal(
    stockRowMatchesItemIdentity(row, { itemName: 'lca-backpack', sku: null }),
    true
  );
  assert.equal(
    stockRowMatchesItemIdentity(row, { itemName: 'other-bag', sku: null }),
    false
  );
}

function testMatchBySku() {
  const row = { item_name: null, sku: 'WOR-NC-PK', remarks: null };
  assert.equal(
    stockRowMatchesItemIdentity(row, { itemName: null, sku: 'WOR-NC-PK' }),
    true
  );
}

function testMatchLegacyRemarks() {
  const row = {
    item_name: null,
    sku: null,
    remarks: 'nc-kg-learningkits | LEA-NC-KG-LEARNINGKITS',
  };
  assert.equal(getStockRowItemName(row), 'nc-kg-learningkits');
  assert.equal(
    stockRowMatchesItemIdentity(row, {
      itemName: 'nc-kg-learningkits',
      sku: 'LEA-NC-KG-LEARNINGKITS',
    }),
    true
  );
}

function testBlankRowNeverMatches() {
  const blank = { item_name: null, sku: null, remarks: null };
  assert.equal(
    stockRowMatchesItemIdentity(blank, {
      itemName: 'nc-pk-worksheets',
      sku: 'WOR-NC-PK',
    }),
    false
  );
}

function testDoNotMatchEmptyIdentity() {
  const row = { item_name: 'lca-backpack', sku: null, remarks: null };
  assert.equal(stockRowMatchesItemIdentity(row, { itemName: null, sku: null }), false);
}

testParseLegacyRemarks();
testMatchByItemNameColumn();
testMatchBySku();
testMatchLegacyRemarks();
testBlankRowNeverMatches();
testDoNotMatchEmptyIdentity();
console.log('merchandiseStockItemMatch.test.js: all passed');
