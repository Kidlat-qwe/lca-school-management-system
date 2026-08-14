/**
 * Full-payment completed → next month Inactive overlay.
 * Run: node backend/tests/fullPaymentCompletedNextInactive.test.js
 */

import assert from 'node:assert/strict';
import { applyFullPaymentCompletedNextPeriodInactive } from '../lib/enrollmentRateMetrics.js';

const months = [
  { key: '2026-01' },
  { key: '2026-02' },
  { key: '2026-03' },
  { key: '2026-04' },
  { key: '2026-05' },
  { key: '2026-06' },
  { key: '2026-07' },
  { key: '2026-08' },
  { key: '2026-09' },
  { key: '2026-10' },
];

const enrolled = (label, status, phase) => ({
  mark: '1',
  label,
  status,
  phase_number: phase,
  is_full_payment: true,
});

function testBriaJulyCompletedAugustInactive() {
  const student = {
    student_id: 356,
    class_id: 68,
    class_number_of_phase: 10,
    last_full_pay_month_key: '2026-07',
    months: {
      '2026-01': enrolled('new', 'new', 1),
      '2026-02': enrolled('re-enrolled', 're_enrolled', 2),
      '2026-03': enrolled('re-enrolled', 're_enrolled', 3),
      '2026-04': enrolled('re-enrolled', 're_enrolled', 4),
      '2026-05': enrolled('re-enrolled', 're_enrolled', 5),
      '2026-06': enrolled('re-enrolled', 're_enrolled', 6),
      '2026-07': enrolled('completed', 'completed', 7),
    },
  };

  applyFullPaymentCompletedNextPeriodInactive([student], months, 'months');

  assert.equal(student.months['2026-07'].label, 'completed');
  assert.equal(student.months['2026-08'].label, 'Inactive');
  assert.equal(student.months['2026-08'].status, 'inactive');
  assert.equal(student.months['2026-08'].mark, 'X');
  assert.equal(student.months['2026-08'].phase_number, 8);
  assert.equal(student.months['2026-09'], undefined);
  assert.equal(student.months['2026-10'], undefined);
}

function testSinglePhaseCompletedHasNoInactive() {
  const student = {
    student_id: 1,
    class_id: 2,
    class_number_of_phase: 1,
    last_full_pay_month_key: '2026-07',
    months: {
      '2026-07': enrolled('completed', 'completed', 1),
    },
  };

  applyFullPaymentCompletedNextPeriodInactive([student], months, 'months');
  assert.equal(student.months['2026-08'], undefined);
}

function testDoesNotOverwriteNextEnrolledMonth() {
  const student = {
    student_id: 2,
    class_id: 3,
    class_number_of_phase: 10,
    last_full_pay_month_key: '2026-07',
    months: {
      '2026-06': enrolled('re-enrolled', 're_enrolled', 6),
      '2026-07': enrolled('completed', 'completed', 7),
      '2026-08': enrolled('re-enrolled', 're_enrolled', 8),
    },
  };

  applyFullPaymentCompletedNextPeriodInactive([student], months, 'months');
  assert.equal(student.months['2026-08'].label, 're-enrolled');
  assert.equal(student.months['2026-08'].mark, '1');
}

testBriaJulyCompletedAugustInactive();
testSinglePhaseCompletedHasNoInactive();
testDoesNotOverwriteNextEnrolledMonth();
console.log('fullPaymentCompletedNextInactive tests passed');
