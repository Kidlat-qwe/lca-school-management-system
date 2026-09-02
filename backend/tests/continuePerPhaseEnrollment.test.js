/**
 * Unit tests for continue-per-phase enrollment detection and invoice remarks.
 * Run: node backend/tests/continuePerPhaseEnrollment.test.js
 */

import assert from 'node:assert/strict';
import {
  CONTINUE_PER_PHASE_REMARK,
  isContinuePerPhaseInvoiceRemarks,
  resolveIsContinuePerPhaseEnrollment,
  stampContinuePerPhaseOnRemarks,
} from '../utils/continuePerPhaseEnrollment.js';

function testResolveIsContinuePerPhaseEnrollment() {
  assert.equal(
    resolveIsContinuePerPhaseEnrollment({
      hasActiveEnrollment: true,
      highestActivePhase: 6,
      requestedStartPhase: 7,
    }),
    true
  );

  assert.equal(
    resolveIsContinuePerPhaseEnrollment({
      hasActiveEnrollment: true,
      highestActivePhase: 7,
      requestedStartPhase: 7,
    }),
    false
  );

  assert.equal(
    resolveIsContinuePerPhaseEnrollment({
      hasActiveEnrollment: false,
      highestActivePhase: 6,
      requestedStartPhase: 7,
    }),
    false
  );

  assert.equal(
    resolveIsContinuePerPhaseEnrollment({
      hasActiveEnrollment: true,
      highestActivePhase: 6,
      requestedStartPhase: null,
    }),
    false
  );
}

function testInvoiceRemarksHelpers() {
  assert.equal(isContinuePerPhaseInvoiceRemarks('foo;CONTINUE_PER_PHASE:1'), true);
  assert.equal(isContinuePerPhaseInvoiceRemarks('foo'), false);

  assert.equal(stampContinuePerPhaseOnRemarks(''), CONTINUE_PER_PHASE_REMARK);
  assert.equal(
    stampContinuePerPhaseOnRemarks('PHASE_START:7'),
    `PHASE_START:7;${CONTINUE_PER_PHASE_REMARK}`
  );
  assert.equal(
    stampContinuePerPhaseOnRemarks(`PHASE_START:7;${CONTINUE_PER_PHASE_REMARK}`),
    `PHASE_START:7;${CONTINUE_PER_PHASE_REMARK}`
  );
}

function run() {
  testResolveIsContinuePerPhaseEnrollment();
  testInvoiceRemarksHelpers();
  console.log('continuePerPhaseEnrollment.test.js: all tests passed');
}

run();
