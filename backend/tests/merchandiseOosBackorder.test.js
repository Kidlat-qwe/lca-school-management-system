/**
 * Unit tests for OOS / backorder merchandise id preference.
 * Run: node backend/tests/merchandiseOosBackorder.test.js
 */

import assert from 'node:assert/strict';
import { resolveMerchandiseWithAvailableStock } from '../lib/merchandiseReleaseLog.js';

function mockClient(byIdRow, candidates = []) {
  const db = async (sql, params) => {
    const text = String(sql);
    if (
      text.includes('FROM merchandisestbl WHERE merchandise_id = $1') ||
      (text.includes('WHERE merchandise_id = $1') && !text.includes('branch_id = $2'))
    ) {
      return { rows: byIdRow ? [byIdRow] : [] };
    }
    if (text.includes('merchandise_name = $1')) {
      return { rows: candidates };
    }
    return { rows: [] };
  };
  return { query: db };
}

async function testPreferSelectedZeroStockSku() {
  const selected = {
    merchandise_id: 501,
    merchandise_name: 'School Uniform',
    size: 'XS',
    type: 'Polo',
    gender: 'Male',
    branch_id: 3,
    quantity: 0,
  };
  const otherTop = {
    merchandise_id: 400,
    merchandise_name: 'School Uniform',
    size: 'XS',
    type: 'Shirt',
    gender: 'Male',
    branch_id: 3,
    quantity: 0,
  };

  const resolved = await resolveMerchandiseWithAvailableStock(
    mockClient(selected, [otherTop, selected]),
    {
      merchandiseId: 501,
      merchandiseName: 'School Uniform',
      branchId: 3,
      quantityNeeded: 1,
      size: 'XS',
      category: 'Top',
      allowZeroStock: true,
    }
  );

  assert.ok(resolved);
  assert.equal(resolved.merchandise_id, 501, 'should keep selected XS Polo, not another Top type');
}

async function testDoNotRemapOosPoloToInStockBlouse() {
  const selectedPolo = {
    merchandise_id: 82,
    merchandise_name: 'School Uniform',
    size: 'XS',
    type: 'Polo',
    gender: 'Male',
    branch_id: 1,
    quantity: 0,
  };
  const blouseInStock = {
    merchandise_id: 132,
    merchandise_name: 'School Uniform',
    size: 'XS',
    type: 'Blouse',
    gender: 'Female',
    branch_id: 1,
    quantity: 3,
  };

  const pending = await resolveMerchandiseWithAvailableStock(
    mockClient(selectedPolo, [blouseInStock, selectedPolo]),
    {
      merchandiseId: 82,
      merchandiseName: 'School Uniform',
      branchId: 1,
      quantityNeeded: 1,
      size: 'XS',
      category: 'Top',
      allowZeroStock: true,
    }
  );
  assert.ok(pending);
  assert.equal(
    pending.merchandise_id,
    82,
    'pending must keep Male Polo XS, not remap to Female Blouse'
  );

  const issue = await resolveMerchandiseWithAvailableStock(
    mockClient(selectedPolo, [blouseInStock, selectedPolo]),
    {
      merchandiseId: 82,
      merchandiseName: 'School Uniform',
      branchId: 1,
      quantityNeeded: 1,
      size: 'XS',
      category: 'Top',
      allowZeroStock: false,
    }
  );
  assert.equal(
    issue,
    null,
    'issue must not substitute Female Blouse when selected Polo is OOS'
  );
}

async function run() {
  await testPreferSelectedZeroStockSku();
  await testDoNotRemapOosPoloToInStockBlouse();
  console.log('merchandiseOosBackorder.test.js: all tests passed');
}

run();
