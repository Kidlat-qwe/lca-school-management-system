/**
 * Track request progress step builder (frontend util).
 * Run: node backend/tests/trackProgress.test.js
 */

import assert from 'node:assert/strict';
import {
  buildTrackProgressSteps,
  normalizeTrackStatus,
} from '../../frontend/src/utils/merchandiseRequests/trackProgress.js';

assert.equal(normalizeTrackStatus('Approved'), 'Delivered');
assert.equal(normalizeTrackStatus('Pending'), 'Pending');

const pending = buildTrackProgressSteps({ status: 'Pending' });
assert.equal(pending.currentKey, 'Pending');
assert.equal(pending.steps.find((s) => s.key === 'Pending').state, 'current');
assert.equal(pending.steps.find((s) => s.key === 'Shipped').state, 'upcoming');
assert.equal(pending.steps.find((s) => s.key === 'Rejected').state, 'skipped');

const shipped = buildTrackProgressSteps({ status: 'Shipped' });
assert.equal(shipped.steps.find((s) => s.key === 'Pending').state, 'completed');
assert.equal(shipped.steps.find((s) => s.key === 'Shipped').state, 'current');

const delivered = buildTrackProgressSteps({ status: 'Approved' });
assert.equal(delivered.currentKey, 'Delivered');
assert.equal(delivered.steps.find((s) => s.key === 'Delivered').state, 'current');
assert.equal(delivered.steps.find((s) => s.key === 'Shipped').state, 'completed');

const rejected = buildTrackProgressSteps({
  status: 'Rejected',
  inventory_status: 'SHIPPED',
});
assert.equal(rejected.steps.find((s) => s.key === 'Shipped').state, 'completed');
assert.equal(rejected.steps.find((s) => s.key === 'Rejected').state, 'current');

const returned = buildTrackProgressSteps({
  status: 'Returned',
  review_notes: 'Returned to warehouse before delivery',
});
assert.equal(returned.steps.find((s) => s.key === 'Delivered').state, 'skipped');
assert.equal(returned.steps.find((s) => s.key === 'Returned').state, 'current');

console.log('trackProgress.test.js: all passed');
