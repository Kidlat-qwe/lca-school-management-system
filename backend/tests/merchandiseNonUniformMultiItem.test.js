/**
 * Regression: multi-item non-uniform (Workbooks, Backpack, Accessory, …)
 * must not collapse onto one blank aggregator row.
 * Run: node backend/tests/merchandiseNonUniformMultiItem.test.js
 */

import assert from 'node:assert/strict';
import {
  findExistingMerchandiseStockRow,
  stockRowMatchesItemIdentity,
} from '../services/inventory/applyMerchandiseRequestStock.js';
import {
  assertInventoryItemHasMatchKey,
  isUniformLikeCategory,
  normalizeMerchandiseRequestInput,
} from '../services/inventory/inventoryFieldMapping.js';

function mockClient(rows) {
  return {
    async query(sql, params) {
      // merchandise_id lookup
      if (String(sql).includes('merchandise_id = $1') && String(sql).includes('branch_id = $2')) {
        const id = params[0];
        const branchId = params[1];
        return {
          rows: rows.filter(
            (r) => r.merchandise_id === id && r.branch_id === branchId
          ),
        };
      }
      // type name list lookup
      return { rows: rows.filter((r) => r.branch_id === params[0]) };
    },
  };
}

async function testIgnoresWrongMerchandiseIdWhenItemIdentityDiffers() {
  const shell = {
    merchandise_id: 10,
    branch_id: 1,
    merchandise_name: 'Workbooks',
    item_name: null,
    sku: null,
    gender: null,
    type: null,
    size: null,
    remarks: null,
    quantity: 5,
  };
  const client = mockClient([shell]);

  const found = await findExistingMerchandiseStockRow(client, {
    requested_branch_id: 1,
    merchandise_id: 10, // wrongly linked empty shell at submit
    inventory_category_name: 'Workbooks',
    merchandise_name: 'Workbooks',
    inventory_item_name: 'nc-pk-worksheets',
    inventory_requested_sku: 'WOR-NC-PK',
  });

  assert.equal(found, null, 'must not reuse empty shell when item identity is present');
}

async function testMatchesCorrectWorkbookRowByItemName() {
  const rows = [
    {
      merchandise_id: 10,
      branch_id: 1,
      merchandise_name: 'Workbooks',
      item_name: 'nc-pk-worksheets',
      sku: 'WOR-NC-PK',
      gender: null,
      type: null,
      size: null,
      remarks: null,
      quantity: 3,
    },
    {
      merchandise_id: 11,
      branch_id: 1,
      merchandise_name: 'Workbooks',
      item_name: 'nc-kg-worksheets',
      sku: 'WOR-NC-KG',
      gender: null,
      type: null,
      size: null,
      remarks: null,
      quantity: 7,
    },
  ];
  const client = mockClient(rows);

  const foundA = await findExistingMerchandiseStockRow(client, {
    requested_branch_id: 1,
    merchandise_id: 10, // points at A
    inventory_category_name: 'Workbooks',
    merchandise_name: 'Workbooks',
    inventory_item_name: 'nc-kg-worksheets', // but wants B
    inventory_requested_sku: 'WOR-NC-KG',
  });
  assert.equal(foundA?.merchandise_id, 11, 'must ignore wrong merchandise_id and match by item');

  const foundB = await findExistingMerchandiseStockRow(client, {
    requested_branch_id: 1,
    merchandise_id: null,
    inventory_category_name: 'Workbooks',
    merchandise_name: 'Workbooks',
    inventory_item_name: 'nc-pk-worksheets',
    inventory_requested_sku: 'WOR-NC-PK',
  });
  assert.equal(foundB?.merchandise_id, 10);
}

function testNormalizeRequiresItemNameAndSku() {
  const bad = normalizeMerchandiseRequestInput({
    category_name: 'Workbooks',
    item_name: 'nc-pk-worksheets',
    // sku missing
  });
  assert.ok(bad.error, 'sku required');

  const ok = normalizeMerchandiseRequestInput({
    category_name: 'Workbooks',
    item_name: 'nc-pk-worksheets',
    sku: 'WOR-NC-PK',
  });
  assert.equal(ok.error, undefined);
  assert.equal(ok.merchandise_name, 'Workbooks');
  assert.equal(ok.inventory_item_name, 'nc-pk-worksheets');
  assert.equal(ok.inventory_requested_sku, 'WOR-NC-PK');

  const payloadCheck = assertInventoryItemHasMatchKey({
    categoryName: 'Workbooks',
    itemName: 'nc-pk-worksheets',
    // sku missing
  });
  assert.ok(payloadCheck);

  assert.equal(
    assertInventoryItemHasMatchKey({
      categoryName: 'Workbooks',
      itemName: 'nc-pk-worksheets',
      sku: 'WOR-NC-PK',
    }),
    null
  );
}

function testIdentityMatcher() {
  assert.equal(
    stockRowMatchesItemIdentity(
      { item_name: 'nc-pk-worksheets', sku: 'WOR-NC-PK' },
      { itemName: 'nc-pk-worksheets', sku: 'WOR-NC-PK' }
    ),
    true
  );
  assert.equal(
    stockRowMatchesItemIdentity(
      { item_name: 'nc-pk-worksheets', sku: 'WOR-NC-PK' },
      { itemName: 'nc-kg-worksheets', sku: 'WOR-NC-KG' }
    ),
    false
  );
  assert.equal(
    stockRowMatchesItemIdentity(
      { item_name: null, sku: null, remarks: null, quantity: 15 },
      { itemName: 'kg-gs-workbooks', sku: 'WOR-GS-WORKBOOKS' }
    ),
    false,
    'blank aggregator must never match'
  );
}

function testLcaBagIsNotUniform() {
  assert.equal(isUniformLikeCategory('LCA Bag'), false);
  assert.equal(isUniformLikeCategory('Backpack'), false);
  assert.equal(isUniformLikeCategory('Workbooks'), false);
  assert.equal(isUniformLikeCategory('Accessory'), false);
  assert.equal(isUniformLikeCategory('Book'), false);
  assert.equal(isUniformLikeCategory('ID Lace'), false);
  assert.equal(isUniformLikeCategory('School Uniform'), true);
  assert.equal(isUniformLikeCategory('LCA Uniform'), true);
}

async function testBackpackBlankAggregatorNeverMatched() {
  const blank = {
    merchandise_id: 20,
    branch_id: 1,
    merchandise_name: 'Backpack',
    item_name: null,
    sku: null,
    gender: null,
    type: null,
    size: null,
    remarks: null,
    quantity: 18,
    price: 500,
  };
  const client = mockClient([blank]);

  const found = await findExistingMerchandiseStockRow(client, {
    requested_branch_id: 1,
    merchandise_id: 20,
    inventory_category_name: 'Backpack',
    merchandise_name: 'Backpack',
    inventory_item_name: 'string-bag',
    inventory_requested_sku: 'BAC-STRING-BAG',
  });

  assert.equal(found, null, 'Backpack blank aggregator must never match string-bag');
}

async function testBackpackTwoItemsStaySeparate() {
  const rows = [
    {
      merchandise_id: 21,
      branch_id: 1,
      merchandise_name: 'Backpack',
      item_name: 'string-bag',
      sku: 'BAC-STRING-BAG',
      gender: null,
      type: null,
      size: null,
      remarks: null,
      quantity: 5,
    },
    {
      merchandise_id: 22,
      branch_id: 1,
      merchandise_name: 'Backpack',
      item_name: 'lca-backpack',
      sku: 'BAC-LCA',
      gender: null,
      type: null,
      size: null,
      remarks: null,
      quantity: 10,
    },
  ];
  const client = mockClient(rows);

  const stringBag = await findExistingMerchandiseStockRow(client, {
    requested_branch_id: 1,
    merchandise_id: null,
    inventory_category_name: 'Backpack',
    merchandise_name: 'Backpack',
    inventory_item_name: 'string-bag',
    inventory_requested_sku: 'BAC-STRING-BAG',
  });
  assert.equal(stringBag?.merchandise_id, 21);

  const backpack = await findExistingMerchandiseStockRow(client, {
    requested_branch_id: 1,
    merchandise_id: 21, // wrong id — must still find by identity
    inventory_category_name: 'Backpack',
    merchandise_name: 'Backpack',
    inventory_item_name: 'lca-backpack',
    inventory_requested_sku: 'BAC-LCA',
  });
  assert.equal(backpack?.merchandise_id, 22);
}

function testNormalizeBackpackRequiresItemAndSku() {
  const bad = normalizeMerchandiseRequestInput({
    category_name: 'Backpack',
    item_name: 'string-bag',
  });
  assert.ok(bad.error, 'Backpack sku required');

  const ok = normalizeMerchandiseRequestInput({
    category_name: 'Backpack',
    item_name: 'string-bag',
    sku: 'BAC-STRING-BAG',
  });
  assert.equal(ok.error, undefined);
  assert.equal(ok.merchandise_name, 'Backpack');
  assert.equal(ok.inventory_item_name, 'string-bag');
  assert.equal(ok.inventory_requested_sku, 'BAC-STRING-BAG');
}

await testIgnoresWrongMerchandiseIdWhenItemIdentityDiffers();
await testMatchesCorrectWorkbookRowByItemName();
await testBackpackBlankAggregatorNeverMatched();
await testBackpackTwoItemsStaySeparate();
testNormalizeRequiresItemNameAndSku();
testNormalizeBackpackRequiresItemAndSku();
testIdentityMatcher();
testLcaBagIsNotUniform();
console.log('merchandiseNonUniformMultiItem.test.js: all passed');
