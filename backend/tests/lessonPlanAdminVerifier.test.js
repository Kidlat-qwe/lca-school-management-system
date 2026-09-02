/**
 * Unit tests for Admin lesson plan verifier lookup.
 * Run: node backend/tests/lessonPlanAdminVerifier.test.js
 */

import assert from 'node:assert/strict';
import { isConfiguredLessonPlanAdminVerifier } from '../lib/lessonPlans/index.js';

async function testIsConfiguredLessonPlanAdminVerifier() {
  const runQuery = async (sql, params) => {
    assert.match(sql, /lesson_plan_verifierstbl/i);
    assert.equal(params[0], 42);
    return { rows: [{ '?column?': 1 }] };
  };

  assert.equal(await isConfiguredLessonPlanAdminVerifier(runQuery, 42), true);
  assert.equal(await isConfiguredLessonPlanAdminVerifier(runQuery, null), false);
  assert.equal(await isConfiguredLessonPlanAdminVerifier(runQuery, 'bad'), false);
}

async function run() {
  await testIsConfiguredLessonPlanAdminVerifier();
  console.log('lessonPlanAdminVerifier.test.js: all tests passed');
}

run();
