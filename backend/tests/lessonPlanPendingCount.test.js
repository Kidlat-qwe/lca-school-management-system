/**
 * Unit tests for lesson plan pending submission count helper.
 * Run: node backend/tests/lessonPlanPendingCount.test.js
 */

import assert from 'node:assert/strict';
import { countPendingLessonPlanSubmissions } from '../lib/lessonPlans/notifications.js';

async function testCountPendingLessonPlanSubmissions() {
  const calls = [];
  const runQuery = async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ total: 7 }] };
  };

  const superadminCount = await countPendingLessonPlanSubmissions(runQuery, {
    userType: 'Superadmin',
    branchId: null,
  });
  assert.equal(superadminCount, 7);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /status = 'submitted'/i);
  assert.equal(calls[0].params.length, 0);

  const adminNoBranch = await countPendingLessonPlanSubmissions(runQuery, {
    userType: 'Admin',
    branchId: null,
  });
  assert.equal(adminNoBranch, 0);

  const adminCount = await countPendingLessonPlanSubmissions(runQuery, {
    userType: 'Admin',
    branchId: 12,
  });
  assert.equal(adminCount, 7);
  assert.equal(calls[1].params[0], 12);
  assert.match(calls[1].sql, /branch_id = \$1/i);
}

async function run() {
  await testCountPendingLessonPlanSubmissions();
  console.log('lessonPlanPendingCount.test.js: all tests passed');
}

run();
