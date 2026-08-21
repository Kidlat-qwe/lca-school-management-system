/**
 * Regression: Request Stock form mode must follow RHET categoryKind.
 * Shirt + LCA_SHIRT is uniform (gender + Logo type + size), not Item/SKU.
 * Run: node backend/tests/categoryKindRequestStock.test.js
 */

import assert from 'node:assert/strict';
import {
  isUniformLikeCategory,
  isUniformLikeCategoryName,
  resolveRequestStockFormMode,
  isLcaShirtCategory,
  normalizeMerchandiseRequestInput,
  buildInventoryStockRequestItem,
  mapTypeToInventory,
} from '../services/inventory/inventoryFieldMapping.js';

function testShirtIsUniformByNameAndKind() {
  assert.equal(isUniformLikeCategoryName('Shirt'), true);
  assert.equal(isUniformLikeCategory('Shirt'), true);
  assert.equal(isUniformLikeCategory('Shirt', 'LCA_SHIRT'), true);
  assert.equal(isUniformLikeCategory('Workbooks', 'OTHER'), false);
  assert.equal(isUniformLikeCategory('Workbooks', 'LCA_SHIRT'), true); // kind wins
  assert.equal(isLcaShirtCategory('Shirt', 'LCA_SHIRT'), true);
  assert.equal(isLcaShirtCategory('Shirt'), true);
  assert.equal(isLcaShirtCategory('PE Uniform'), false);
}

function testFormMode() {
  assert.equal(
    resolveRequestStockFormMode({ categoryName: 'Shirt', categoryKind: 'LCA_SHIRT' }),
    'uniform'
  );
  assert.equal(
    resolveRequestStockFormMode({ categoryName: 'School Uniform', categoryKind: 'SCHOOL_UNIFORM' }),
    'uniform'
  );
  assert.equal(
    resolveRequestStockFormMode({ categoryName: 'Backpack', categoryKind: 'OTHER' }),
    'other'
  );
  assert.equal(
    resolveRequestStockFormMode({ categoryName: 'Learning Kit', categoryKind: 'LEARNING_KIT' }),
    'kit'
  );
  assert.equal(
    resolveRequestStockFormMode({ categoryName: 'Tool Kit', categoryKind: 'LEARNING_KIT' }),
    'kit'
  );
  // Missing kind → name heuristic
  assert.equal(resolveRequestStockFormMode({ categoryName: 'Shirt' }), 'uniform');
  assert.equal(resolveRequestStockFormMode({ categoryName: 'Workbooks' }), 'other');
}

function testNormalizeShirtRequiresUniformAttrs() {
  const bad = normalizeMerchandiseRequestInput({
    category_name: 'Shirt',
    category_kind: 'LCA_SHIRT',
    requested_quantity: 1,
    item_name: 'some-shirt',
    sku: 'SHIRT-SKU',
  });
  assert.ok(bad.error, 'must reject Shirt without gender/type/size');
  assert.match(String(bad.error), /logo|gender|size/i);

  const ok = normalizeMerchandiseRequestInput({
    category_name: 'Shirt',
    category_kind: 'LCA_SHIRT',
    gender: 'Unisex',
    type: 'Logo 1',
    size: 'M',
    requested_quantity: 1,
  });
  assert.equal(ok.error, undefined);
  assert.equal(ok.is_uniform, true);
  assert.equal(ok.merchandise_name, 'Shirt');
  assert.equal(ok.type, 'Logo 1');
  assert.equal(ok.inventory_item_name, null);
  assert.equal(ok.inventory_requested_sku, null);
}

function testLogoTypeNeverMappedToShirt() {
  assert.equal(mapTypeToInventory('Logo 1', 'Shirt'), 'Logo 1');
  assert.equal(mapTypeToInventory('Logo 2', 'Shirt'), 'Logo 2');
  assert.equal(mapTypeToInventory('Shirt', 'PE Uniform'), 'Shirt');
  assert.equal(mapTypeToInventory('Polo', 'School Uniform'), 'Polo');
}

function testBuildRhetPayloadForShirt() {
  const item = buildInventoryStockRequestItem({
    request_id: 99,
    requested_quantity: 1,
    inventory_category_name: 'Shirt',
    merchandise_name: 'Shirt',
    gender: 'Unisex',
    type: 'Logo 1',
    size: 'M',
  });
  assert.equal(item.categoryName, 'Shirt');
  assert.equal(item.gender, 'Unisex');
  assert.equal(item.type, 'Logo 1');
  assert.equal(item.size, 'M');
  assert.equal(item.itemName, undefined);
  assert.equal(item.sku, undefined);
  assert.equal(item.externalReference, 'PSMS-99');
}

testShirtIsUniformByNameAndKind();
testFormMode();
testNormalizeShirtRequiresUniformAttrs();
testLogoTypeNeverMappedToShirt();
testBuildRhetPayloadForShirt();

console.log('categoryKindRequestStock.test.js: all passed');
