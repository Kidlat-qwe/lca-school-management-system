/**
 * Package freebie swap upgrade adjustment tests.
 * Run: node backend/tests/packageMerchSwapAdjustment.test.js
 */
import assert from 'assert';
import {
  buildPackageMerchPriceByType,
  computePackageMerchSwapInvoiceAdjustments,
} from '../lib/packageMerchSwapAdjustment/index.js';

{
  const map = new Map([
    [
      10,
      {
        merchandise_name: 'Backpack',
        price: 500,
        is_included: true,
      },
    ],
  ]);
  const byType = buildPackageMerchPriceByType(map);
  assert.equal(byType.get('backpack').price, 500);
}

{
  const deduct = new Map([
    [
      'swap-bag',
      {
        merchandise_id: 99,
        merchandise_name: 'School Uniform',
        action: 'swap',
        original_type_name: 'Backpack',
        count: 1,
      },
    ],
  ]);
  const byType = new Map([
    ['backpack', { merchandise_name: 'Backpack', price: 500 }],
  ]);
  const result = await computePackageMerchSwapInvoiceAdjustments(
    deduct,
    byType,
    async () => ({
      merchandise_id: 99,
      merchandise_name: 'School Uniform',
      size: 'M',
      type: 'Polo',
      price: 600,
    })
  );
  assert.equal(result.totalAdjustment, 100);
  assert.equal(result.items.length, 1);
  assert.ok(result.items[0].description.includes('Backpack'));
}

{
  const deduct = new Map([
    [
      'swap-bag',
      {
        merchandise_id: 99,
        action: 'swap',
        original_type_name: 'Backpack',
        count: 1,
      },
    ],
  ]);
  const byType = new Map([
    ['backpack', { merchandise_name: 'Backpack', price: 500 }],
  ]);
  const result = await computePackageMerchSwapInvoiceAdjustments(
    deduct,
    byType,
    async () => ({
      merchandise_name: 'ID Lace',
      price: 300,
    })
  );
  assert.equal(result.totalAdjustment, 0);
  assert.equal(result.items.length, 0);
}

console.log('packageMerchSwapAdjustment.test.js OK');
