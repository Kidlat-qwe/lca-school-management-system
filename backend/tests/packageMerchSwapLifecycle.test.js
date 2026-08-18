/**
 * Regression: package freebie waive/swap coverage + normalize pass-through.
 * Run: node backend/tests/packageMerchSwapLifecycle.test.js
 */
import assert from 'assert';
import {
  isPackageMerchTypeCovered,
  linesFromMerchandiseToDeduct,
  normalizePackageMerchLines,
  remainingIssuablePackageMerchLines,
  isPackageMerchLineIssued,
  packageMerchLineKey,
} from '../lib/merchandiseReleaseLog.js';

{
  const map = new Map();
  map.set('waive-bag', {
    merchandise_id: 10,
    merchandise_name: 'Backpack',
    action: 'waive',
    original_type_name: 'Backpack',
    count: 1,
  });
  assert.equal(isPackageMerchTypeCovered('Backpack', map), true);
}

{
  const map = new Map();
  map.set('swap-bag', {
    merchandise_id: 99,
    merchandise_name: 'ID Lace',
    action: 'swap',
    original_type_name: 'Backpack',
    count: 1,
  });
  assert.equal(isPackageMerchTypeCovered('Backpack', map), true);
  assert.equal(isPackageMerchTypeCovered('ID Lace', map), true);
}

{
  const map = new Map();
  map.set('w', {
    merchandise_id: 10,
    merchandise_name: 'Backpack',
    action: 'waive',
    original_type_name: 'Backpack',
    count: 1,
  });
  map.set('i', {
    merchandise_id: 20,
    merchandise_name: 'ID Lace',
    action: 'issue',
    original_type_name: 'ID Lace',
    count: 1,
  });
  const lines = linesFromMerchandiseToDeduct(map);
  assert.ok(lines.some((l) => l.action === 'waive' && l.original_type_name === 'Backpack'));
  assert.ok(lines.some((l) => l.action === 'issue' && l.merchandise_name === 'ID Lace'));
}

{
  const normalized = normalizePackageMerchLines([
    {
      merchandise_id: 1,
      quantity: 1,
      merchandise_name: 'Backpack',
      action: 'waive',
      original_type_name: 'Backpack',
      reason: 'Already owns',
    },
  ]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].action, 'waive');
  assert.equal(normalized[0].reason, 'Already owns');
}

{
  const pending = normalizePackageMerchLines([
    {
      merchandise_id: 10,
      quantity: 1,
      merchandise_name: 'Backpack',
      action: 'issue',
      original_type_name: 'Backpack',
    },
    {
      merchandise_id: 20,
      quantity: 1,
      merchandise_name: 'School Uniform',
      category: 'Top',
      size: 'M',
      action: 'issue',
    },
  ]);
  const issuedRows = [
    {
      merchandise_id: 10,
      merchandise_name: 'Backpack',
      size: null,
      category: null,
    },
  ];
  assert.equal(isPackageMerchLineIssued(pending[0], issuedRows), true);
  const remaining = remainingIssuablePackageMerchLines(pending, issuedRows);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].merchandise_name, 'School Uniform');
  assert.ok(packageMerchLineKey(remaining[0]).includes('school uniform'));
}

console.log('packageMerchSwapLifecycle.test.js OK');
