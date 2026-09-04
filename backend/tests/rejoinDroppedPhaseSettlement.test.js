/**
 * Unit tests for rejoin dropped-phase settlement helpers (Policy A).
 * Run: node backend/tests/rejoinDroppedPhaseSettlement.test.js
 */

import assert from 'node:assert/strict';
import {
  resolveAbsolutePhaseForChain,
} from '../utils/rejoinDroppedPhaseSettlement/index.js';

function testResolveAbsolutePhaseForChain() {
  const profile = { phase_start: 1 };
  assert.equal(
    resolveAbsolutePhaseForChain(
      { representative: { remarks: 'TARGET_PHASE:5' }, invoices: [] },
      profile
    ),
    5
  );
  assert.equal(
    resolveAbsolutePhaseForChain(
      { representative: { remarks: 'REJOIN_PHASE:10' }, invoices: [] },
      profile
    ),
    10
  );
  assert.equal(
    resolveAbsolutePhaseForChain(
      {
        representative: { remarks: '' },
        invoices: [{ remarks: 'PHASE_START:7;PHASE_END:7' }],
      },
      profile
    ),
    7
  );
}

async function run() {
  testResolveAbsolutePhaseForChain();
  console.log('rejoinDroppedPhaseSettlement.test.js: all tests passed');
}

run();
