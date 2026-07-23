/**
 * Regression: fulfill maps RHET categoryName → CMS type, never itemName.
 * Run: node backend/tests/merchandiseFulfillTypeMatch.test.js
 */

import assert from 'node:assert/strict';
import {
  localMerchandiseTypeNameCandidates,
  normalizeMerchandiseRequestInput,
  resolveLocalMerchandiseTypeName,
} from '../services/inventory/inventoryFieldMapping.js';

function testNormalizeNonUniformUsesCategoryNotItemName() {
  const normalized = normalizeMerchandiseRequestInput({
    category_name: 'Backpack',
    item_name: 'lca-backpack',
    sku: 'BAC-LCA-BACKPACK',
  });
  assert.equal(normalized.error, undefined);
  assert.equal(normalized.merchandise_name, 'Backpack');
  assert.equal(normalized.inventory_category_name, 'Backpack');
  assert.equal(normalized.inventory_item_name, 'lca-backpack');
  assert.equal(normalized.inventory_requested_sku, 'BAC-LCA-BACKPACK');
}

function testResolveTypeNamePrefersInventoryCategory() {
  const name = resolveLocalMerchandiseTypeName({
    merchandise_name: 'lca-backpack',
    inventory_category_name: 'Backpack',
    inventory_item_name: 'lca-backpack',
  });
  assert.equal(name, 'Backpack');
}

function testResolveTypeNameRejectsItemSlugAlone() {
  const name = resolveLocalMerchandiseTypeName({
    merchandise_name: 'lca-backpack',
    inventory_item_name: 'lca-backpack',
  });
  assert.equal(name, '');
}

function testCandidatesIncludeLegacyBagAlias() {
  const candidates = localMerchandiseTypeNameCandidates({
    inventory_category_name: 'Backpack',
    inventory_item_name: 'lca-backpack',
    merchandise_name: 'lca-backpack',
  });
  assert.ok(candidates.map((c) => c.toLowerCase()).includes('backpack'));
  assert.ok(candidates.map((c) => c.toLowerCase()).includes('lca bag'));
  assert.ok(!candidates.map((c) => c.toLowerCase()).includes('lca-backpack'));
}

function testUniformStillUsesCategory() {
  const normalized = normalizeMerchandiseRequestInput({
    category_name: 'School Uniform',
    gender: 'Male',
    type: 'Polo',
    size: 'M',
  });
  assert.equal(normalized.merchandise_name, 'School Uniform');
  assert.equal(normalized.gender, 'Male');
  assert.equal(normalized.type, 'Polo');
  assert.equal(normalized.size, 'M');
}

testNormalizeNonUniformUsesCategoryNotItemName();
testResolveTypeNamePrefersInventoryCategory();
testResolveTypeNameRejectsItemSlugAlone();
testCandidatesIncludeLegacyBagAlias();
testUniformStillUsesCategory();
console.log('merchandiseFulfillTypeMatch.test.js: all passed');
