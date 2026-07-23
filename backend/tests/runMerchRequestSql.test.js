/**
 * Regression: inventory webhook must not die on missing merchandiserequestlogtbl.updated_at.
 * Run: node backend/tests/runMerchRequestSql.test.js
 */

import assert from 'node:assert/strict';
import {
  isMissingColumnError,
  runIgnoringMissingUpdatedAt,
  stripUpdatedAtAssignment,
} from '../services/inventory/runMerchRequestSql.js';

function testStripUpdatedAt() {
  const sql = `UPDATE merchandiserequestlogtbl
     SET status = 'Approved',
         inventory_synced_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE request_id = $1`;
  const stripped = stripUpdatedAtAssignment(sql);
  assert.equal(stripped.includes('updated_at'), false);
  assert.equal(stripped.includes("status = 'Approved'"), true);
  assert.equal(stripped.includes('inventory_synced_at = CURRENT_TIMESTAMP'), true);
}

function testIsMissingColumnError() {
  assert.equal(
    isMissingColumnError({ code: '42703', message: 'column "updated_at" does not exist' }, 'updated_at'),
    true
  );
  assert.equal(
    isMissingColumnError({ code: '23505', message: 'duplicate key' }, 'updated_at'),
    false
  );
}

async function testRetryWithoutUpdatedAt() {
  let calls = 0;
  const run = async (sql) => {
    calls += 1;
    if (calls === 1 && /updated_at\s*=\s*CURRENT_TIMESTAMP/i.test(sql)) {
      const err = new Error('column "updated_at" does not exist');
      err.code = '42703';
      throw err;
    }
    return { rows: [{ ok: true }], sql };
  };

  const result = await runIgnoringMissingUpdatedAt(
    run,
    `UPDATE t SET a = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [1, 2]
  );
  assert.equal(calls, 2);
  assert.equal(result.sql.includes('updated_at'), false);
  assert.equal(result.rows[0].ok, true);
}

testStripUpdatedAt();
testIsMissingColumnError();
await testRetryWithoutUpdatedAt();
console.log('runMerchRequestSql.test.js: all passed');
