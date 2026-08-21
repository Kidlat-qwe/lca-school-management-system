/**
 * Request Stock catalog item filter (parent category → child kit SKUs only).
 * Run: node backend/tests/catalogRequestStockItemFilter.test.js
 */

import assert from 'node:assert/strict';
import {
  filterRequestStockCatalogItems,
  isVirtualBundleCatalogItem,
} from '../../frontend/src/utils/merchandiseRequests/catalogBundleFilter.js';

const TOOL_KIT_ITEMS = [
  {
    categoryName: 'Tool Kit',
    itemName: 'gs-toolkits',
    sku: 'TOO-GS-TOOLKITS',
    stockMode: 'VIRTUAL_BUNDLE',
    components: [
      { categoryName: 'Tool Kit', itemName: 'crayons', sku: 'TOO-CRAYONS', quantity: 1 },
      { categoryName: 'Tool Kit', itemName: 'glue', sku: 'TOO-GLUE', quantity: 1 },
    ],
  },
  {
    categoryName: 'Tool Kit',
    itemName: 'nc-kg-toolkits',
    sku: 'TOO-NC-KG-TOOLKITS',
    stockMode: 'VIRTUAL_BUNDLE',
    components: [
      { categoryName: 'Tool Kit', itemName: 'notebook', sku: 'TOO-NOTEBOOK', quantity: 1 },
      { categoryName: 'Tool Kit', itemName: 'pencil', sku: 'TOO-PENCIL', quantity: 1 },
    ],
  },
  { categoryName: 'Tool Kit', itemName: 'crayons', sku: 'TOO-CRAYONS', stocks: 100 },
  { categoryName: 'Tool Kit', itemName: 'glue', sku: 'TOO-GLUE', stocks: 100 },
  { categoryName: 'Tool Kit', itemName: 'notebook', sku: 'TOO-NOTEBOOK', stocks: 100 },
  { categoryName: 'Tool Kit', itemName: 'pencil', sku: 'TOO-PENCIL', stocks: 100 },
  { categoryName: 'Tool Kit', itemName: 'whiteboard', sku: 'TOO-WHITEBOARD', stocks: 100 },
];

function testToolKitHidesRawBomParts() {
  const filtered = filterRequestStockCatalogItems(TOOL_KIT_ITEMS, 'Tool Kit');
  const names = filtered.map((i) => i.itemName).sort();
  assert.deepEqual(names, ['gs-toolkits', 'nc-kg-toolkits', 'whiteboard']);
}

function testPlainCategoryUnchanged() {
  const items = [
    { categoryName: 'Workbooks', itemName: 'nc-pk-worksheets', sku: 'WOR-NC-PK' },
    { categoryName: 'Workbooks', itemName: 'nc-kg-worksheets', sku: 'WOR-NC-KG' },
  ];
  assert.equal(filterRequestStockCatalogItems(items, 'Workbooks').length, 2);
}

function testVirtualBundleDetection() {
  assert.equal(isVirtualBundleCatalogItem({ components: [{ categoryName: 'Shirt' }] }), true);
  assert.equal(isVirtualBundleCatalogItem({ itemName: 'crayons' }), false);
}

testToolKitHidesRawBomParts();
testPlainCategoryUnchanged();
testVirtualBundleDetection();
console.log('catalogRequestStockItemFilter.test.js: all passed');
