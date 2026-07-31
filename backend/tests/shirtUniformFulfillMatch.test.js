/**
 * Regression: Shirt / LCA_SHIRT fulfill must credit Unisex + Logo + Size,
 * never blank "Unspecified piece" shells (even when merchandise_id points at them).
 * Run: node backend/tests/shirtUniformFulfillMatch.test.js
 */

import assert from 'node:assert/strict';
import {
  findExistingMerchandiseStockRow,
  isBlankUniformIdentityRow,
  stockRowMatchesUniformIdentity,
  applyMerchandiseRequestStock,
} from '../services/inventory/applyMerchandiseRequestStock.js';
import {
  isUniformLikeCategory,
  parseUniformIdentityFromMatchedSku,
  resolveUniformFulfillIdentity,
} from '../services/inventory/inventoryFieldMapping.js';

function mockClient(rows, { onInsert, onUpdate } = {}) {
  return {
    async query(sql, params) {
      const text = String(sql);
      if (text.includes('merchandise_id = $1') && text.includes('branch_id = $2')) {
        const id = params[0];
        const branchId = params[1];
        return {
          rows: rows.filter(
            (r) => r.merchandise_id === id && r.branch_id === branchId
          ),
        };
      }
      if (text.trim().toUpperCase().startsWith('INSERT')) {
        if (onInsert) onInsert(params);
        const created = {
          merchandise_id: 999,
          quantity: params[2],
          merchandise_name: params[0],
          gender: params[6],
          type: params[7],
          size: params[1],
          branch_id: params[4],
        };
        rows.push(created);
        return { rows: [created] };
      }
      if (text.trim().toUpperCase().startsWith('UPDATE') && onUpdate) {
        onUpdate(params);
      }
      if (text.includes('SELECT price')) {
        return { rows: [] };
      }
      if (text.includes('SELECT image_url')) {
        return { rows: [] };
      }
      return { rows: rows.filter((r) => r.branch_id === params[0]) };
    },
  };
}

function testShirtIsUniform() {
  assert.equal(isUniformLikeCategory('Shirt'), true);
  assert.equal(isUniformLikeCategory('Shirt', 'LCA_SHIRT'), true);
}

function testBlankUniformHelpers() {
  assert.equal(
    isBlankUniformIdentityRow({ gender: null, type: null, size: null }),
    true
  );
  assert.equal(
    isBlankUniformIdentityRow({ gender: null, type: null, size: 'N/A' }),
    true
  );
  assert.equal(
    isBlankUniformIdentityRow({ gender: 'Unisex', type: 'Logo 1', size: 'XS' }),
    false
  );
  assert.equal(
    stockRowMatchesUniformIdentity(
      { gender: null, type: null, size: null },
      { gender: 'Unisex', type: 'Logo 1', size: 'XS' }
    ),
    false
  );
  assert.equal(
    stockRowMatchesUniformIdentity(
      { gender: 'Unisex', type: 'Logo 1', size: 'XS' },
      { gender: 'Unisex', type: 'Logo 1', size: 'XS' }
    ),
    true
  );
}

function testIdentityResolutionOrder() {
  const fromSku = parseUniformIdentityFromMatchedSku('SHI-U-LOGO1-XS');
  assert.deepEqual(fromSku, { gender: 'Unisex', type: 'Logo 1', size: 'XS' });

  const identity = resolveUniformFulfillIdentity({
    request: { gender: 'Unisex', type: 'Logo 1', size: 'XS' },
    payload: { gender: 'Male', type: 'Logo 2', size: 'M', matchedSku: 'SHI-U-LOGO1-S' },
  });
  // Local request wins over webhook / SKU
  assert.deepEqual(identity, { gender: 'Unisex', type: 'Logo 1', size: 'XS' });

  const fromPayload = resolveUniformFulfillIdentity({
    request: {},
    payload: { matchedSku: 'SHI-U-LOGO2-M' },
  });
  assert.deepEqual(fromPayload, { gender: 'Unisex', type: 'Logo 2', size: 'M' });
}

async function testIgnoresBlankMerchandiseIdWhenUniformIdentityPresent() {
  const blank = {
    merchandise_id: 100,
    branch_id: 1,
    merchandise_name: 'Shirt',
    gender: null,
    type: null,
    size: null,
    quantity: 5,
    price: 0,
    remarks: null,
    item_name: null,
    sku: null,
  };
  const identified = {
    merchandise_id: 101,
    branch_id: 1,
    merchandise_name: 'Shirt',
    gender: 'Unisex',
    type: 'Logo 1',
    size: 'XS',
    quantity: 0,
    price: 0,
    remarks: null,
    item_name: null,
    sku: null,
  };
  const client = mockClient([blank, identified]);

  const found = await findExistingMerchandiseStockRow(client, {
    requested_branch_id: 1,
    merchandise_id: 100, // wrongly linked blank shell
    inventory_category_name: 'Shirt',
    merchandise_name: 'Shirt',
    gender: 'Unisex',
    type: 'Logo 1',
    size: 'XS',
  });

  assert.equal(found?.merchandise_id, 101, 'must match Unisex·Logo 1·XS, not blank shell');
}

async function testDoesNotFallbackToBlankWhenNoIdentifiedRow() {
  const blank = {
    merchandise_id: 100,
    branch_id: 1,
    merchandise_name: 'Shirt',
    gender: null,
    type: null,
    size: null,
    quantity: 5,
    price: 0,
    remarks: null,
    item_name: null,
    sku: null,
  };
  const client = mockClient([blank]);

  const found = await findExistingMerchandiseStockRow(client, {
    requested_branch_id: 1,
    merchandise_id: 100,
    inventory_category_name: 'Shirt',
    merchandise_name: 'Shirt',
    gender: 'Unisex',
    type: 'Logo 1',
    size: 'XS',
  });

  assert.equal(found, null, 'must return null so apply creates identified row');
}

async function testLogo2DoesNotMatchLogo1() {
  const logo1 = {
    merchandise_id: 101,
    branch_id: 1,
    merchandise_name: 'Shirt',
    gender: 'Unisex',
    type: 'Logo 1',
    size: 'XS',
    quantity: 5,
    price: 0,
  };
  const client = mockClient([logo1]);

  const found = await findExistingMerchandiseStockRow(client, {
    requested_branch_id: 1,
    inventory_category_name: 'Shirt',
    merchandise_name: 'Shirt',
    gender: 'Unisex',
    type: 'Logo 2',
    size: 'M',
  });

  assert.equal(found, null, 'Logo 2 / M must not credit Logo 1 / XS');
}

async function testApplyCreatesIdentifiedRowNotBlank() {
  const blank = {
    merchandise_id: 100,
    branch_id: 1,
    merchandise_name: 'Shirt',
    gender: null,
    type: null,
    size: null,
    quantity: 5,
    price: 0,
    remarks: null,
    item_name: null,
    sku: null,
  };
  let inserted = null;
  const client = mockClient([blank], {
    onInsert: (params) => {
      inserted = {
        merchandise_name: params[0],
        size: params[1],
        quantity: params[2],
        gender: params[6],
        type: params[7],
      };
    },
  });

  const result = await applyMerchandiseRequestStock(client, {
    requested_branch_id: 1,
    merchandise_id: 100,
    inventory_category_name: 'Shirt',
    merchandise_name: 'Shirt',
    gender: 'Unisex',
    type: 'Logo 1',
    size: 'XS',
    requested_quantity: 5,
  });

  assert.equal(result.action, 'created');
  assert.equal(inserted.merchandise_name, 'Shirt');
  assert.equal(inserted.gender, 'Unisex');
  assert.equal(inserted.type, 'Logo 1');
  assert.equal(inserted.size, 'XS');
  assert.equal(inserted.quantity, 5);
  assert.equal(blank.quantity, 5, 'blank shell qty must stay unchanged');
}

async function testApplyCreditsExistingLogoRow() {
  const blank = {
    merchandise_id: 100,
    branch_id: 1,
    merchandise_name: 'Shirt',
    gender: null,
    type: null,
    size: null,
    quantity: 10,
    price: 0,
  };
  const identified = {
    merchandise_id: 101,
    branch_id: 1,
    merchandise_name: 'Shirt',
    gender: 'Unisex',
    type: 'Logo 1',
    size: 'XS',
    quantity: 2,
    price: 0,
  };
  let updatedParams = null;
  const client = mockClient([blank, identified], {
    onUpdate: (params) => {
      updatedParams = params;
      identified.quantity = params[0];
    },
  });

  const result = await applyMerchandiseRequestStock(client, {
    requested_branch_id: 1,
    merchandise_id: 100,
    inventory_category_name: 'Shirt',
    merchandise_name: 'Shirt',
    gender: 'Unisex',
    type: 'Logo 1',
    size: 'XS',
    requested_quantity: 5,
  });

  assert.equal(result.action, 'updated');
  assert.equal(result.merchandiseId, 101);
  assert.equal(result.newQuantity, 7);
  assert.equal(blank.quantity, 10, 'blank shell must not receive qty');
  assert.ok(updatedParams, 'uniform update must run');
}

async function testApplyRejectsIncompleteUniformIdentity() {
  await assert.rejects(
    () =>
      applyMerchandiseRequestStock(mockClient([]), {
        requested_branch_id: 1,
        inventory_category_name: 'Shirt',
        merchandise_name: 'Shirt',
        gender: 'Unisex',
        // missing type/size
        requested_quantity: 5,
      }),
    /without gender, type, and size/i
  );
}

testShirtIsUniform();
testBlankUniformHelpers();
testIdentityResolutionOrder();
await testIgnoresBlankMerchandiseIdWhenUniformIdentityPresent();
await testDoesNotFallbackToBlankWhenNoIdentifiedRow();
await testLogo2DoesNotMatchLogo1();
await testApplyCreatesIdentifiedRowNotBlank();
await testApplyCreditsExistingLogoRow();
await testApplyRejectsIncompleteUniformIdentity();

console.log('shirtUniformFulfillMatch.test.js: all passed');
