/**
 * Learning Kit request normalization / recipe regression tests.
 * Run: node backend/tests/learningKitRequest.test.js
 */

import assert from 'node:assert/strict';
import {
  getLearningKitRecipe,
  recipeFromCatalogKitItem,
  validateLearningKitComponents,
} from '../services/inventory/learningKitRecipes.js';
import {
  assertInventoryItemHasMatchKey,
  buildInventoryStockRequestItem,
  normalizeMerchandiseRequestInput,
} from '../services/inventory/inventoryFieldMapping.js';

function testRecipeLookup() {
  const recipe = getLearningKitRecipe({ itemName: 'nc-learningkit' });
  assert.ok(recipe);
  assert.equal(recipe.slots.length, 3);
  assert.equal(recipe.slots[0].categoryName, 'Shirt');
}

function testCatalogBomRecipe() {
  const recipe = recipeFromCatalogKitItem({
    itemName: 'nc-learningkit',
    sku: 'LEA-NC-LEARNINGKIT',
    components: [
      { categoryName: 'Shirt', quantity: 1 },
      { categoryName: 'Tool Kit', quantity: 1 },
      { categoryName: 'Workbooks', quantity: 1 },
    ],
  });
  assert.ok(recipe);
  assert.equal(recipe.source, 'catalog');
  assert.equal(recipe.slots.length, 3);
  assert.equal(recipe.slots[0].kind, 'uniform');
  assert.equal(recipe.slots[1].kind, 'other');
}

function testNormalizeKitRequiresComponents() {
  const bad = normalizeMerchandiseRequestInput({
    category_name: 'Learning Kit',
    item_name: 'nc-learningkit',
    sku: 'LEA-NC-LEARNINGKIT',
    requested_quantity: 1,
    components: [],
  });
  assert.ok(bad.error);

  const good = normalizeMerchandiseRequestInput({
    category_name: 'Learning Kit',
    item_name: 'nc-learningkit',
    sku: 'LEA-NC-LEARNINGKIT',
    requested_quantity: 1,
    components: [
      { categoryName: 'Shirt', gender: 'Unisex', type: 'ACC', size: 'M', quantity: 1 },
      { categoryName: 'Tool Kit', itemName: 'tool-a', sku: 'TOOL-A', quantity: 1 },
      { categoryName: 'Workbooks', itemName: 'wb-1', sku: 'WB-1', quantity: 1 },
    ],
  });
  assert.equal(good.error, undefined);
  assert.equal(good.merchandise_name, 'Learning Kit');
  assert.equal(good.inventory_item_name, 'nc-learningkit');
  assert.equal(good.inventory_components_json.length, 3);
  assert.equal(good.type, null);
}

function testBuildItemIncludesComponents() {
  const item = buildInventoryStockRequestItem({
    request_id: 41,
    requested_quantity: 1,
    inventory_category_name: 'Learning Kit',
    inventory_item_name: 'nc-learningkit',
    inventory_requested_sku: 'LEA-NC-LEARNINGKIT',
    inventory_components_json: [
      { categoryName: 'Shirt', gender: 'Unisex', type: 'ACC', size: 'M', quantity: 1 },
      { categoryName: 'Tool Kit', itemName: 'tool-a', sku: 'TOOL-A', quantity: 1 },
      { categoryName: 'Workbooks', itemName: 'wb-1', sku: 'WB-1', quantity: 1 },
    ],
  });
  assert.equal(item.categoryName, 'Learning Kit');
  assert.equal(item.itemName, 'nc-learningkit');
  assert.equal(item.components.length, 3);
  assert.equal(assertInventoryItemHasMatchKey(item), null);
}

function testNormalizeToolKitUsesParentCategoryName() {
  const toolKitCategories = [
    { categoryName: 'Crayola', categoryType: 'SUPPLIES' },
    { categoryName: 'Glue', categoryType: 'SUPPLIES' },
    { categoryName: 'Notebook', categoryType: 'SUPPLIES' },
    { categoryName: 'Tool Kit', categoryKind: 'LEARNING_KIT', categoryType: 'MERCHANDISE' },
  ];
  const catalogItem = {
    itemName: 'nc_kg_toolkit',
    sku: 'TOO-NC-KG-TOOLKIT',
    components: [
      { categoryName: 'Crayola', quantity: 1 },
      { categoryName: 'Glue', quantity: 1 },
      { categoryName: 'Notebook', quantity: 1 },
    ],
  };
  const recipe = getLearningKitRecipe({
    itemName: 'nc_kg_toolkit',
    sku: 'TOO-NC-KG-TOOLKIT',
    catalogItem,
    catalogCategories: toolKitCategories,
  });
  assert.ok(recipe, 'Tool Kit recipe from catalog BOM');
  assert.equal(recipe.source, 'catalog');
  // All BOM slots should resolve as 'supplies'
  assert.ok(recipe.slots.every((s) => s.kind === 'supplies'), 'All slots are supplies');

  const good = normalizeMerchandiseRequestInput(
    {
      category_name: 'Tool Kit',
      category_kind: 'LEARNING_KIT',
      item_name: 'nc_kg_toolkit',
      sku: 'TOO-NC-KG-TOOLKIT',
      requested_quantity: 2,
      components: [
        { categoryName: 'Crayola', itemName: 'crayola-1', sku: 'CRAY-1', quantity: 2 },
        { categoryName: 'Glue', itemName: 'glue-1', sku: 'GLU-1', quantity: 2 },
        { categoryName: 'Notebook', itemName: 'nb-1', sku: 'NB-1', quantity: 2 },
      ],
    },
    { learningKitRecipe: recipe }
  );
  assert.equal(good.error, undefined);
  assert.equal(good.merchandise_name, 'Tool Kit');
  assert.equal(good.inventory_category_name, 'Tool Kit');
}

function testAllSuppliesKitValidationAcceptsAutoFilled() {
  const toolKitCategories = [
    { categoryName: 'Crayola', categoryType: 'SUPPLIES' },
    { categoryName: 'Glue', categoryType: 'SUPPLIES' },
  ];
  const catalogItem = {
    itemName: 'toolkit-mini',
    sku: 'TOO-MINI',
    components: [
      { categoryName: 'Crayola', quantity: 1 },
      { categoryName: 'Glue', quantity: 1 },
    ],
  };
  const recipe = getLearningKitRecipe({
    catalogItem,
    catalogCategories: toolKitCategories,
  });
  assert.ok(recipe);
  // Validate with auto-filled items (supplies-only kit can omit components[] at backend)
  const result = validateLearningKitComponents(recipe, [], 1);
  // All supplies slots skipped → valid
  assert.equal(result.ok, true, 'Supplies-only kit with no user components should pass');
}

function testBuildItemToolKitCategoryName() {
  const item = buildInventoryStockRequestItem({
    request_id: 55,
    requested_quantity: 1,
    inventory_category_name: 'Tool Kit',
    inventory_item_name: 'nc_kg_toolkit',
    inventory_requested_sku: 'TOO-NC-KG-TOOLKIT',
    inventory_components_json: [
      { categoryName: 'Crayola', itemName: 'crayola-1', sku: 'CRAY-1', quantity: 1 },
    ],
  });
  assert.equal(item.categoryName, 'Tool Kit');
  assert.equal(item.itemName, 'nc_kg_toolkit');
}

function testValidateRejectsExtraCategory() {
  const recipe = getLearningKitRecipe({ itemName: 'nc-learningkit' });
  const result = validateLearningKitComponents(
    recipe,
    [
      { categoryName: 'Shirt', gender: 'Unisex', type: 'ACC', size: 'M', quantity: 1 },
      { categoryName: 'Tool Kit', itemName: 'tool-a', quantity: 1 },
      { categoryName: 'Workbooks', itemName: 'wb-1', quantity: 1 },
      { categoryName: 'Backpack', itemName: 'bag', quantity: 1 },
    ],
    1
  );
  assert.equal(result.ok, false);
}

testRecipeLookup();
testCatalogBomRecipe();
testNormalizeKitRequiresComponents();
testBuildItemIncludesComponents();
testNormalizeToolKitUsesParentCategoryName();
testAllSuppliesKitValidationAcceptsAutoFilled();
testBuildItemToolKitCategoryName();
testValidateRejectsExtraCategory();
console.log('learningKitRequest.test.js: all passed');
