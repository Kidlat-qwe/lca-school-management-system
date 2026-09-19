/**
 * Regression: Request Stock form mode must follow RHET categoryKind.
 * Shirt + LCA_SHIRT is uniform (gender + Logo type + size), not Item/SKU.
 * FREEBIE_* kinds strip to the same base mode as Uniform / Shirt / Kit.
 * Run: node backend/tests/categoryKindRequestStock.test.js
 */

import assert from 'node:assert/strict';
import {
  baseCategoryKind,
  isUniformLikeCategory,
  isUniformLikeCategoryName,
  isKitCategoryKind,
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

function testBaseCategoryKindStripsFreebiePrefix() {
  assert.equal(baseCategoryKind('FREEBIE_SCHOOL_UNIFORM'), 'SCHOOL_UNIFORM');
  assert.equal(baseCategoryKind('FREEBIE_PE_UNIFORM'), 'PE_UNIFORM');
  assert.equal(baseCategoryKind('FREEBIE_LCA_SHIRT'), 'LCA_SHIRT');
  assert.equal(baseCategoryKind('FREEBIE_LEARNING_KIT'), 'LEARNING_KIT');
  assert.equal(baseCategoryKind('SCHOOL_UNIFORM'), 'SCHOOL_UNIFORM');
  assert.equal(baseCategoryKind('freebie_lca_shirt'), 'LCA_SHIRT');
  assert.equal(baseCategoryKind(''), '');
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
  assert.equal(
    resolveRequestStockFormMode({ categoryName: 'Tool Kit', categoryKind: 'TOOL_KIT' }),
    'kit'
  );
  // Missing kind → name heuristic
  assert.equal(resolveRequestStockFormMode({ categoryName: 'Shirt' }), 'uniform');
  assert.equal(resolveRequestStockFormMode({ categoryName: 'Workbooks' }), 'other');
}

function testFreebieFormModes() {
  assert.equal(
    resolveRequestStockFormMode({
      categoryName: 'School Uniform Freebies',
      categoryKind: 'FREEBIE_SCHOOL_UNIFORM',
    }),
    'uniform'
  );
  assert.equal(
    resolveRequestStockFormMode({
      categoryName: 'PE Uniform Freebies',
      categoryKind: 'FREEBIE_PE_UNIFORM',
    }),
    'uniform'
  );
  assert.equal(
    resolveRequestStockFormMode({
      categoryName: 'Shirt Freebies',
      categoryKind: 'FREEBIE_LCA_SHIRT',
    }),
    'uniform'
  );
  assert.equal(
    resolveRequestStockFormMode({
      categoryName: 'Learning Kit Freebies',
      categoryKind: 'FREEBIE_LEARNING_KIT',
    }),
    'kit'
  );
  assert.equal(isKitCategoryKind('FREEBIE_LEARNING_KIT'), true);
  assert.equal(isKitCategoryKind('FREEBIE_TOOL_KIT'), true);
  assert.equal(isUniformLikeCategory('Promo Shirt', 'FREEBIE_LCA_SHIRT'), true);
  assert.equal(isLcaShirtCategory('Promo Shirt', 'FREEBIE_LCA_SHIRT'), true);
  // Freebie display names (no categoryKind on View Stocks) still resolve as uniform/shirt
  assert.equal(isUniformLikeCategoryName('Shirt - Freebies'), true);
  assert.equal(isUniformLikeCategory('Shirt - Freebies'), true);
  assert.equal(isLcaShirtCategory('Shirt - Freebies'), true);
  assert.equal(isUniformLikeCategoryName('School Uniform Freebies'), true);
  // Unknown FREEBIE_* that is not a known base → other (not silent non-uniform Item)
  assert.equal(
    resolveRequestStockFormMode({
      categoryName: 'Mystery Freebie',
      categoryKind: 'FREEBIE_OTHER',
    }),
    'other'
  );
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

function testNormalizeFreebieUniformRequiresAttrs() {
  const bad = normalizeMerchandiseRequestInput({
    category_name: 'School Uniform Freebies',
    category_kind: 'FREEBIE_SCHOOL_UNIFORM',
    requested_quantity: 1,
    item_name: 'polo-freebie',
    sku: 'FREE-POLO',
  });
  assert.ok(bad.error, 'FREEBIE uniform must not fall through to Item+SKU');
  assert.match(String(bad.error), /gender|type|size/i);

  const ok = normalizeMerchandiseRequestInput({
    category_name: 'School Uniform Freebies',
    category_kind: 'FREEBIE_SCHOOL_UNIFORM',
    gender: 'Male',
    type: 'Polo',
    size: 'M',
    requested_quantity: 2,
  });
  assert.equal(ok.error, undefined);
  assert.equal(ok.is_uniform, true);
  assert.equal(ok.category_kind, 'FREEBIE_SCHOOL_UNIFORM');
  assert.equal(ok.inventory_item_name, null);

  const shirtOk = normalizeMerchandiseRequestInput({
    category_name: 'Shirt Freebies',
    category_kind: 'FREEBIE_LCA_SHIRT',
    gender: 'Unisex',
    type: 'Logo 1',
    size: 'S',
    requested_quantity: 1,
  });
  assert.equal(shirtOk.error, undefined);
  assert.equal(shirtOk.is_uniform, true);
  assert.equal(shirtOk.type, 'Logo 1');
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

function testBuildRhetPayloadForFreebieUniform() {
  const item = buildInventoryStockRequestItem({
    request_id: 120,
    requested_quantity: 3,
    inventory_category_name: 'School Uniform Freebies',
    merchandise_name: 'School Uniform Freebies',
    category_kind: 'FREEBIE_SCHOOL_UNIFORM',
    gender: 'Female',
    type: 'Blouse',
    size: 'L',
  });
  assert.equal(item.categoryName, 'School Uniform Freebies');
  assert.equal(item.gender, 'Female');
  assert.equal(item.type, 'Blouse');
  assert.equal(item.size, 'L');
  assert.equal(item.itemName, undefined);
  assert.equal(item.sku, undefined);
  assert.equal(item.externalReference, 'PSMS-120');
}

testShirtIsUniformByNameAndKind();
testBaseCategoryKindStripsFreebiePrefix();
testFormMode();
testFreebieFormModes();
testNormalizeShirtRequiresUniformAttrs();
testNormalizeFreebieUniformRequiresAttrs();
testLogoTypeNeverMappedToShirt();
testBuildRhetPayloadForShirt();
testBuildRhetPayloadForFreebieUniform();

console.log('categoryKindRequestStock.test.js: all passed');
