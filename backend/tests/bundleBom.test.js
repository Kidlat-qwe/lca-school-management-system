/**
 * RHET LEARNING_KIT bundle BOM regression tests.
 * Run: node backend/tests/bundleBom.test.js
 */

import assert from 'node:assert/strict';
import {
  isRhetBundleCategory,
  isSuppliesOnlyBom,
  resolveKitBomSlots,
  categorizeBomSlots,
  getBomKind,
} from '../services/inventory/bundleBom.js';
import { resolveRequestStockFormMode } from '../services/inventory/inventoryFieldMapping.js';

function testBundleKindDetection() {
  assert.equal(isRhetBundleCategory({ categoryKind: 'LEARNING_KIT' }), true);
  assert.equal(isRhetBundleCategory({ categoryName: 'Tool Kit', categoryKind: 'LEARNING_KIT' }), true);
  assert.equal(isRhetBundleCategory({ categoryName: 'Backpack', categoryKind: 'OTHER' }), false);
  assert.equal(
    resolveRequestStockFormMode({ categoryName: 'Tool Kit', categoryKind: 'LEARNING_KIT' }),
    'kit'
  );
}

function testSuppliesOnlyBom() {
  const categories = [
    { categoryName: 'Crayola', categoryType: 'SUPPLIES' },
    { categoryName: 'Glue', categoryType: 'SUPPLIES' },
  ];
  const kitItem = {
    components: [
      { categoryName: 'Crayola', quantity: 1 },
      { categoryName: 'Glue', quantity: 1 },
    ],
  };
  assert.equal(isSuppliesOnlyBom(kitItem, categories), true);
  const slots = resolveKitBomSlots(kitItem, categories, null);
  assert.equal(slots.length, 2);
  assert.equal(slots[0].categoryName, 'Crayola');
}

function testCategorizeBomSlots() {
  const categories = [
    { categoryName: 'Crayola', categoryType: 'SUPPLIES' },
    { categoryName: 'Glue', categoryType: 'SUPPLIES' },
    { categoryName: 'Notebook', categoryType: 'SUPPLIES' },
    { categoryName: 'Shirt', categoryType: 'MERCHANDISE' },
    { categoryName: 'Tool Kit', categoryType: 'MERCHANDISE', categoryKind: 'LEARNING_KIT' },
  ];

  // All supplies
  const allSuppliesKit = {
    components: [
      { categoryName: 'Crayola', quantity: 1 },
      { categoryName: 'Glue', quantity: 1 },
      { categoryName: 'Notebook', quantity: 1 },
    ],
  };
  const allSupplies = categorizeBomSlots(allSuppliesKit, categories);
  assert.equal(allSupplies.isAllSupplies, true);
  assert.equal(allSupplies.isAllMerchandise, false);
  assert.equal(allSupplies.isMixed, false);
  assert.equal(getBomKind(allSuppliesKit, categories), 'supplies');

  // All merchandise
  const allMerchKit = {
    components: [
      { categoryName: 'Shirt', quantity: 1 },
      { categoryName: 'Tool Kit', quantity: 1 },
    ],
  };
  const allMerch = categorizeBomSlots(allMerchKit, categories);
  assert.equal(allMerch.isAllMerchandise, true);
  assert.equal(allMerch.isAllSupplies, false);
  assert.equal(getBomKind(allMerchKit, categories), 'merchandise');

  // Mixed
  const mixedKit = {
    components: [
      { categoryName: 'Shirt', quantity: 1 },
      { categoryName: 'Crayola', quantity: 1 },
    ],
  };
  const mixed = categorizeBomSlots(mixedKit, categories);
  assert.equal(mixed.isMixed, true);
  assert.equal(getBomKind(mixedKit, categories), 'mixed');
}

testBundleKindDetection();
testSuppliesOnlyBom();
testCategorizeBomSlots();
console.log('bundleBom.test.js: all passed');
