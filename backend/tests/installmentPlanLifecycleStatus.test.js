/**
 * Unit tests for Student History / matrix lifecycle Active-Inactive.
 * Run: node backend/tests/installmentPlanLifecycleStatus.test.js
 */

import assert from 'node:assert/strict';
import {
  hasOpenUnpaidInstallmentPastDue,
  resolveInstallmentPlanLifecycleActive,
} from '../utils/installmentPlanLifecycleStatus/index.js';

const TODAY = '2026-08-14';

function testHavenOverduePhase6Inactive() {
  const phases = [
    { is_generated: true, status: 'Paid', due_date: '2026-07-05', remaining_balance: 0 },
    {
      is_generated: true,
      status: 'Overdue',
      due_date: '2026-08-05',
      remaining_balance: 4659.6,
      program_enrollment_status: null,
    },
  ];
  assert.equal(hasOpenUnpaidInstallmentPastDue(phases, TODAY), true);
  assert.equal(
    resolveInstallmentPlanLifecycleActive({
      isActive: true,
      phases,
      todayYmd: TODAY,
    }),
    false
  );
}

function testUnderGraceIsInactive() {
  const phases = [
    {
      is_generated: true,
      status: 'Under grace period',
      due_date: '2026-08-05',
      remaining_balance: 4236,
    },
  ];
  assert.equal(
    resolveInstallmentPlanLifecycleActive({
      isActive: true,
      phases,
      todayYmd: TODAY,
    }),
    false
  );
}

function testUnpaidNotYetDueStaysActive() {
  const phases = [
    {
      is_generated: true,
      status: 'Unpaid',
      due_date: '2026-08-14',
      remaining_balance: 4236,
    },
  ];
  assert.equal(
    resolveInstallmentPlanLifecycleActive({
      isActive: true,
      phases,
      todayYmd: TODAY,
    }),
    true
  );
}

function testDroppedUnpaidHistoryDoesNotForceInactive() {
  const phases = [
    {
      is_generated: true,
      status: 'Unpaid',
      due_date: '2026-04-05',
      remaining_balance: 5660.6,
      program_enrollment_status: 'dropped',
    },
    {
      is_generated: true,
      status: 'Paid',
      due_date: '2026-08-05',
      remaining_balance: 0,
      program_enrollment_status: 'rejoin',
    },
  ];
  assert.equal(hasOpenUnpaidInstallmentPastDue(phases, TODAY), false);
  assert.equal(
    resolveInstallmentPlanLifecycleActive({
      isActive: true,
      phases,
      todayYmd: TODAY,
    }),
    true
  );
}

function testStoredInactiveWins() {
  assert.equal(
    resolveInstallmentPlanLifecycleActive({
      isActive: false,
      phases: [],
      todayYmd: TODAY,
    }),
    false
  );
}

function testFullPaymentUpgradeInactive() {
  assert.equal(
    resolveInstallmentPlanLifecycleActive({
      isActive: true,
      upgradedToFullPayment: true,
      phases: [],
      todayYmd: TODAY,
    }),
    false
  );
}

testHavenOverduePhase6Inactive();
testUnderGraceIsInactive();
testUnpaidNotYetDueStaysActive();
testDroppedUnpaidHistoryDoesNotForceInactive();
testStoredInactiveWins();
testFullPaymentUpgradeInactive();
console.log('installmentPlanLifecycleStatus tests passed');
