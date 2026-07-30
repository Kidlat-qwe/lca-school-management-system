/**
 * Learning Kit request normalization / recipe regression tests.
 * Run: node backend/tests/learningKitRequest.test.js
 */

import assert from 'node:assert/strict';
import {
  getLearningKitRecipe,
  validateLearningKitComponents,
} from '../services/inventory/learningKitRecipes.js';
import {
  assertInventoryItemHasMatchKey,
  buildInventoryStockRequestItem,
  normalizeMerchandiseRequestInput,
} from '../services/inventory/inventoryFieldMapping.js';

function testRecipeLookup() {
  const recipe = getLearningKitRecipe({ itemName: 'nc-kg-learningkits' });
  assert.ok(recipe);
  assert.equal(recipe.slots.length, 3);
  assert.equal(recipe.slots[0].categoryName, 'LCA T-Shirt');
}

function testNormalizeKitRequiresComponents() {
  const bad = normalizeMerchandiseRequestInput({
    category_name: 'Learning Kit',
    item_name: 'nc-kg-learningkits',
    sku: 'LEA-NC-KG-LEARNINGKITS',
    requested_quantity: 1,
    components: [],
  });
  assert.ok(bad.error);

  const good = normalizeMerchandiseRequestInput({
    category_name: 'Learning Kit',
    item_name: 'nc-kg-learningkits',
    sku: 'LEA-NC-KG-LEARNINGKITS',
    requested_quantity: 1,
    components: [
      { categoryName: 'LCA T-Shirt', gender: 'Unisex', type: 'Shirt', size: 'M', quantity: 1 },
      { categoryName: 'Tool Kit', itemName: 'tool-a', sku: 'TOOL-A', quantity: 1 },
      { categoryName: 'Workbooks', itemName: 'wb-1', sku: 'WB-1', quantity: 1 },
    ],
  });
  assert.equal(good.error, undefined);
  assert.equal(good.merchandise_name, 'Learning Kit');
  assert.equal(good.inventory_item_name, 'nc-kg-learningkits');
  assert.equal(good.inventory_components_json.length, 3);
  assert.equal(good.type, null);
}

function testBuildItemIncludesComponents() {
  const item = buildInventoryStockRequestItem({
    request_id: 41,
    requested_quantity: 1,
    inventory_category_name: 'Learning Kit',
    inventory_item_name: 'nc-kg-learningkits',
    inventory_requested_sku: 'LEA-NC-KG-LEARNINGKITS',
    inventory_components_json: [
      { categoryName: 'LCA T-Shirt', gender: 'Unisex', type: 'Shirt', size: 'M', quantity: 1 },
      { categoryName: 'Tool Kit', itemName: 'tool-a', sku: 'TOOL-A', quantity: 1 },
      { categoryName: 'Workbooks', itemName: 'wb-1', sku: 'WB-1', quantity: 1 },
    ],
  });
  assert.equal(item.categoryName, 'Learning Kit');
  assert.equal(item.itemName, 'nc-kg-learningkits');
  assert.equal(item.components.length, 3);
  assert.equal(assertInventoryItemHasMatchKey(item), null);
}

function testValidateRejectsExtraCategory() {
  const recipe = getLearningKitRecipe({ itemName: 'nc-kg-learningkits' });
  const result = validateLearningKitComponents(
    recipe,
    [
      { categoryName: 'LCA T-Shirt', gender: 'Unisex', type: 'Shirt', size: 'M', quantity: 1 },
      { categoryName: 'Tool Kit', itemName: 'tool-a', quantity: 1 },
      { categoryName: 'Workbooks', itemName: 'wb-1', quantity: 1 },
      { categoryName: 'Backpack', itemName: 'bag', quantity: 1 },
    ],
    1
  );
  assert.equal(result.ok, false);
}

testRecipeLookup();
testNormalizeKitRequiresComponents();
testBuildItemIncludesComponents();
testValidateRejectsExtraCategory();
console.log('learningKitRequest.test.js: all passed');
