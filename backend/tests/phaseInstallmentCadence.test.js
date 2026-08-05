/**
 * Unit tests for mid-month vs first-week installment billing cadence.
 * Run: node backend/tests/phaseInstallmentCadence.test.js
 */

import assert from 'node:assert/strict';
import { formatYmdLocal } from '../utils/dateUtils.js';
import {
  BILLING_CADENCE_1_5,
  BILLING_CADENCE_25_5,
  advanceInstallmentQueueByOneCycle,
  buildFirstOfMonthCycleDates,
  buildPhaseInstallmentSchedule,
  buildRecurringCycleDates,
  inferBillingCadenceFromAnchorYmd,
  resolveClassBillingCadence,
  resolveFirstOfMonthRecurringIssueYmd,
  resolveFirstRecurringCycleAfterIssue,
  resolveProfileBillingCadence,
} from '../utils/phaseInstallmentUtils.js';

function testClassBillingCadence() {
  assert.equal(resolveClassBillingCadence('2026-07-01'), BILLING_CADENCE_25_5);
  assert.equal(resolveClassBillingCadence('2026-07-07'), BILLING_CADENCE_25_5);
  assert.equal(resolveClassBillingCadence('2026-07-08'), BILLING_CADENCE_1_5);
  assert.equal(resolveClassBillingCadence('2026-07-20'), BILLING_CADENCE_1_5);
  assert.equal(resolveClassBillingCadence('2026-06-24'), BILLING_CADENCE_1_5);
}

function testFirstOfMonthSkip() {
  assert.equal(resolveFirstOfMonthRecurringIssueYmd('2026-07-20'), '2026-08-01');
  assert.equal(resolveFirstOfMonthRecurringIssueYmd('2026-07-08'), '2026-08-01');
  assert.equal(resolveFirstOfMonthRecurringIssueYmd('2026-06-24'), '2026-08-01');
  assert.equal(resolveFirstOfMonthRecurringIssueYmd('2026-07-24'), '2026-08-01');
  assert.equal(resolveFirstOfMonthRecurringIssueYmd('2026-07-25'), '2026-09-01');
  assert.equal(resolveFirstOfMonthRecurringIssueYmd('2026-08-28'), '2026-10-01');
}

function testInferAndGrandfatherCadence() {
  assert.equal(inferBillingCadenceFromAnchorYmd('2026-08-25'), BILLING_CADENCE_25_5);
  assert.equal(inferBillingCadenceFromAnchorYmd('2026-08-01'), BILLING_CADENCE_1_5);
  assert.equal(inferBillingCadenceFromAnchorYmd('2026-08-15'), null);

  assert.equal(
    resolveProfileBillingCadence({
      classStartYmd: '2026-07-20',
      profile: { next_generation_date: '2026-08-25' },
      generatedCount: 1,
    }),
    BILLING_CADENCE_25_5
  );
  assert.equal(
    resolveProfileBillingCadence({
      classStartYmd: '2026-07-20',
      profile: { next_generation_date: '2026-08-01' },
      generatedCount: 1,
    }),
    BILLING_CADENCE_1_5
  );
  assert.equal(
    resolveProfileBillingCadence({
      classStartYmd: '2026-07-20',
      profile: { next_generation_date: '2026-08-25' },
      generatedCount: 1,
      ignoreStoredQueueAnchor: true,
    }),
    BILLING_CADENCE_1_5
  );
  assert.equal(
    resolveProfileBillingCadence({
      classStartYmd: '2026-07-01',
      profile: {},
      generatedCount: 0,
    }),
    BILLING_CADENCE_25_5
  );
}

function testCycleDates() {
  const legacy = buildRecurringCycleDates('2026-07-25', 1, BILLING_CADENCE_25_5);
  assert.equal(formatYmdLocal(legacy.issueDate), '2026-07-25');
  assert.equal(formatYmdLocal(legacy.dueDate), '2026-08-05');
  assert.equal(formatYmdLocal(legacy.nextGenerationDate), '2026-08-25');
  assert.equal(formatYmdLocal(legacy.nextInvoiceMonth), '2026-09-01');

  const mid = buildFirstOfMonthCycleDates('2026-08-01');
  assert.equal(formatYmdLocal(mid.issueDate), '2026-08-01');
  assert.equal(formatYmdLocal(mid.dueDate), '2026-08-05');
  assert.equal(formatYmdLocal(mid.nextGenerationDate), '2026-09-01');
  assert.equal(formatYmdLocal(mid.nextInvoiceMonth), '2026-09-01');
}

function testAdvanceQueueByCadence() {
  const from25 = advanceInstallmentQueueByOneCycle('2026-08-25');
  assert.equal(from25.next_generation_date, '2026-09-25');
  assert.equal(from25.next_invoice_month, '2026-10-01');

  const from1 = advanceInstallmentQueueByOneCycle('2026-08-01');
  assert.equal(from1.next_generation_date, '2026-09-01');
  assert.equal(from1.next_invoice_month, '2026-09-01');
}

function testFirstRecurringAfterIssue() {
  const july1 = resolveFirstRecurringCycleAfterIssue('2026-06-20', {
    firstPhaseStartYmd: '2026-07-01',
    classStartYmd: '2026-07-01',
  });
  assert.equal(formatYmdLocal(july1.issueDate), '2026-07-25');
  assert.equal(formatYmdLocal(july1.dueDate), '2026-08-05');

  const july20 = resolveFirstRecurringCycleAfterIssue('2026-07-20', {
    firstPhaseStartYmd: '2026-07-20',
    classStartYmd: '2026-07-20',
  });
  assert.equal(formatYmdLocal(july20.issueDate), '2026-08-01');
  assert.equal(formatYmdLocal(july20.dueDate), '2026-08-05');

  const june24 = resolveFirstRecurringCycleAfterIssue('2026-06-20', {
    firstPhaseStartYmd: '2026-06-24',
    classStartYmd: '2026-06-24',
  });
  assert.equal(formatYmdLocal(june24.issueDate), '2026-08-01');
  assert.equal(formatYmdLocal(june24.dueDate), '2026-08-05');

  const lateJoiner = resolveFirstRecurringCycleAfterIssue('2026-09-10', {
    firstPhaseStartYmd: '2026-07-20',
    classStartYmd: '2026-07-20',
  });
  assert.equal(formatYmdLocal(lateJoiner.issueDate), '2026-10-01');
  assert.equal(formatYmdLocal(lateJoiner.dueDate), '2026-10-05');
}

function makeDb({ classStartYmd, phaseStarts = {} }) {
  return {
    query: async (sql, params) => {
      const text = String(sql);
      if (text.includes('FROM classestbl')) {
        return { rows: classStartYmd ? [{ start_ymd: classStartYmd }] : [] };
      }
      if (text.includes('FROM classsessionstbl')) {
        const phase = params?.[1];
        const start = phaseStarts[phase];
        return { rows: start ? [{ phase_start_date: start }] : [] };
      }
      if (text.includes('FROM invoicestbl')) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

async function testScheduleJuly20Enrollment() {
  const schedule = await buildPhaseInstallmentSchedule({
    db: makeDb({
      classStartYmd: '2026-07-20',
      phaseStarts: { 1: '2026-07-20', 2: '2026-08-17', 3: '2026-09-14' },
    }),
    profile: { class_id: 99, phase_start: 1, total_phases: 6, generated_count: 0 },
    generatedCountOverride: 0,
    issueDateOverride: '2026-07-20',
  });

  assert.equal(schedule.billing_cadence, BILLING_CADENCE_1_5);
  assert.equal(schedule.current_due_date, '2026-07-19');
  assert.equal(schedule.current_issue_date, '2026-07-20');
  assert.equal(schedule.next_generation_date, '2026-08-01');
  assert.equal(schedule.next_due_date, '2026-08-05');
  assert.equal(schedule.next_invoice_month, '2026-08-01');
}

async function testScheduleJuly1Enrollment() {
  const schedule = await buildPhaseInstallmentSchedule({
    db: makeDb({
      classStartYmd: '2026-07-01',
      phaseStarts: { 1: '2026-07-01', 2: '2026-07-29', 3: '2026-08-26' },
    }),
    profile: { class_id: 100, phase_start: 1, total_phases: 6, generated_count: 0 },
    generatedCountOverride: 0,
    issueDateOverride: '2026-06-20',
  });

  assert.equal(schedule.billing_cadence, BILLING_CADENCE_25_5);
  assert.equal(schedule.current_due_date, '2026-06-30');
  assert.equal(schedule.next_generation_date, '2026-07-25');
  assert.equal(schedule.next_due_date, '2026-08-05');
}

async function testScheduleJune24Skip() {
  const schedule = await buildPhaseInstallmentSchedule({
    db: makeDb({
      classStartYmd: '2026-06-24',
      phaseStarts: { 1: '2026-06-24', 2: '2026-07-22', 3: '2026-08-19' },
    }),
    profile: { class_id: 101, phase_start: 1, total_phases: 6, generated_count: 0 },
    generatedCountOverride: 0,
    issueDateOverride: '2026-06-20',
  });

  assert.equal(schedule.billing_cadence, BILLING_CADENCE_1_5);
  assert.equal(schedule.next_generation_date, '2026-08-01');
  assert.equal(schedule.next_due_date, '2026-08-05');
}

async function testScheduleGrandfather25Queue() {
  const schedule = await buildPhaseInstallmentSchedule({
    db: makeDb({
      classStartYmd: '2026-07-20',
      phaseStarts: { 1: '2026-07-20', 2: '2026-08-17', 3: '2026-09-14' },
    }),
    profile: {
      class_id: 102,
      phase_start: 1,
      total_phases: 6,
      generated_count: 1,
      next_generation_date: '2026-08-25',
    },
    generatedCountOverride: 1,
    generationAnchorYmd: '2026-08-25',
  });

  assert.equal(schedule.billing_cadence, BILLING_CADENCE_25_5);
  assert.equal(schedule.current_issue_date, '2026-08-25');
  assert.equal(schedule.current_due_date, '2026-09-05');
  assert.equal(schedule.next_generation_date, '2026-09-25');
}

async function testScheduleRebuildUsesClassStart() {
  const schedule = await buildPhaseInstallmentSchedule({
    db: makeDb({
      classStartYmd: '2026-07-20',
      phaseStarts: { 1: '2026-07-20', 2: '2026-08-17', 3: '2026-09-14' },
    }),
    profile: {
      class_id: 103,
      phase_start: 1,
      total_phases: 6,
      generated_count: 1,
      next_generation_date: '2026-08-25',
    },
    generatedCountOverride: 1,
    ignoreStoredQueueAnchor: true,
    classStartYmdOverride: '2026-07-20',
  });

  assert.equal(schedule.billing_cadence, BILLING_CADENCE_1_5);
  assert.equal(schedule.current_issue_date, '2026-08-01');
  assert.equal(schedule.current_due_date, '2026-08-05');
}

const tests = [
  testClassBillingCadence,
  testFirstOfMonthSkip,
  testInferAndGrandfatherCadence,
  testCycleDates,
  testAdvanceQueueByCadence,
  testFirstRecurringAfterIssue,
  testScheduleJuly20Enrollment,
  testScheduleJuly1Enrollment,
  testScheduleJune24Skip,
  testScheduleGrandfather25Queue,
  testScheduleRebuildUsesClassStart,
];

let failed = 0;
for (const run of tests) {
  try {
    await run();
    console.log(`✓ ${run.name}`);
  } catch (err) {
    failed += 1;
    console.error(`✗ ${run.name}`);
    console.error(err);
  }
}

if (failed > 0) {
  process.exit(1);
}

console.log(`\n${tests.length} phase installment cadence tests passed.`);
