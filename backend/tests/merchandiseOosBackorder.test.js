/**
 * Unit tests for OOS / backorder merchandise id preference.
 * Run: node backend/tests/merchandiseOosBackorder.test.js
 */

import assert from 'node:assert/strict';
import { resolveMerchandiseWithAvailableStock } from '../lib/merchandiseReleaseLog.js';

async function testPreferSelectedZeroStockSku() {
  const selected = {
    merchandise_id: 501,
    merchandise_name: 'School Uniform',
    size: 'XS',
    type: 'Polo',
    branch_id: 3,
    quantity: 0,
  };
  const otherTop = {
    merchandise_id: 400,
    merchandise_name: 'School Uniform',
    size: 'XS',
    type: 'Shirt',
    branch_id: 3,
    quantity: 0,
  };

  const db = async (sql, params) => {
    const text = String(sql);
    if (
      text.includes('FROM merchandisestbl WHERE merchandise_id = $1') ||
      (text.includes('WHERE merchandise_id = $1') && !text.includes('branch_id = $2'))
    ) {
      assert.equal(params[0], 501);
      return { rows: [selected] };
    }
    if (text.includes('merchandise_name = $1') && text.includes('size = $3')) {
      return { rows: [otherTop, selected] };
    }
    return { rows: [] };
  };

  const client = { query: db };

  const resolved = await resolveMerchandiseWithAvailableStock(client, {
    merchandiseId: 501,
    merchandiseName: 'School Uniform',
    branchId: 3,
    quantityNeeded: 1,
    size: 'XS',
    category: 'Top',
    allowZeroStock: true,
  });

  assert.ok(resolved);
  assert.equal(resolved.merchandise_id, 501, 'should keep selected XS Polo, not another Top type');
}

async function run() {
  await testPreferSelectedZeroStockSku();
  console.log('merchandiseOosBackorder.test.js: all tests passed');
}

run();
