/**
 * Unit tests for billing realignment helpers (class start date adjustment).
 * Run: node backend/tests/billingRealignment.test.js
 */

import assert from 'node:assert/strict';
import {
  addDaysYmd,
  computePhaseDueFromStart,
  dateParam,
  isSettledInvoiceStatus,
  planDownpaymentRealignment,
  planProfileBillingRealignment,
  resolveInvoicePhaseForRealignment,
  resolveIssueDateAfterDueAlign,
  resolveTargetGeneratedCount,
} from '../utils/classStartDateAdjustment/billingRealignment.js';

function testComputePhaseDueFromStart() {
  assert.equal(computePhaseDueFromStart('2026-08-03'), '2026-08-02');
  assert.equal(computePhaseDueFromStart('2026-07-03'), '2026-07-02');
}

function testJulyToAugustShiftScenario() {
  const phaseStartDateMap = { 1: '2026-08-03', 2: '2026-09-11' };
  const profile = {
    installmentinvoiceprofiles_id: 1,
    student_id: 10,
    generated_count: 2,
    total_phases: 6,
    is_active: true,
    full_name: 'Test Student',
    email: 'test@example.com',
  };
  const phaseInvoices = [
    {
      invoice_id: 100,
      invoice_ar_number: 'INV-100',
      status: 'Unpaid',
      issue_ymd: '2026-06-15',
      due_ymd: '2026-07-02',
      phase: 1,
      remarks: 'TARGET_PHASE:1',
    },
    {
      invoice_id: 101,
      invoice_ar_number: 'INV-101',
      status: 'Unpaid',
      issue_ymd: '2026-06-25',
      due_ymd: '2026-07-05',
      phase: 2,
      remarks: 'TARGET_PHASE:2',
    },
  ];

  const plan = planProfileBillingRealignment(profile, phaseInvoices, null, phaseStartDateMap);

  const phase1Update = plan.changes.find((c) => c.type === 'update_phase_invoice' && c.phase === 1);
  assert.ok(phase1Update, 'phase 1 invoice should be realigned');
  assert.equal(phase1Update.new_due_date, '2026-08-02');
  assert.equal(phase1Update.old_due_date, '2026-07-02');
  assert.ok(phase1Update.clear_penalty);

  const phase2Update = plan.changes.find((c) => c.type === 'update_phase_invoice' && c.phase === 2);
  assert.ok(phase2Update, 'unpaid phase 2 should be realigned, not deleted');
  assert.equal(phase2Update.new_due_date, '2026-09-10');
  assert.equal(phase2Update.old_due_date, '2026-07-05');
  assert.ok(phase2Update.clear_penalty);

  const prematureDelete = plan.changes.find((c) => c.type === 'delete_premature_invoice');
  assert.equal(prematureDelete, undefined);
  assert.equal(plan.deleteInvoiceIds.length, 0);
  assert.equal(plan.targetGeneratedCount, 2);
}

function testPaidInvoiceUnchanged() {
  const phaseStartDateMap = { 1: '2026-08-03' };
  const profile = {
    installmentinvoiceprofiles_id: 2,
    student_id: 11,
    generated_count: 1,
    total_phases: 6,
    is_active: true,
  };
  const phaseInvoices = [
    {
      invoice_id: 200,
      status: 'Paid',
      issue_ymd: '2026-06-15',
      due_ymd: '2026-07-02',
      phase: 1,
      remarks: 'TARGET_PHASE:1',
    },
  ];

  const plan = planProfileBillingRealignment(profile, phaseInvoices, null, phaseStartDateMap);
  const updates = plan.changes.filter((c) => c.type === 'update_phase_invoice');
  assert.equal(updates.length, 0);
}

function testDelinquencyDropRestore() {
  const phaseStartDateMap = { 1: '2026-08-03' };
  const profile = {
    installmentinvoiceprofiles_id: 3,
    student_id: 12,
    generated_count: 1,
    total_phases: 6,
    is_active: false,
  };
  const phaseInvoices = [
    {
      invoice_id: 300,
      status: 'Unpaid',
      issue_ymd: '2026-06-15',
      due_ymd: '2026-07-02',
      phase: 1,
      remarks: 'TARGET_PHASE:1',
    },
  ];
  const enrollment = {
    classstudent_id: 50,
    program_enrollment_status: 'dropped',
    removed_reason: 'Installment delinquency auto-drop',
  };

  const plan = planProfileBillingRealignment(profile, phaseInvoices, enrollment, phaseStartDateMap);
  const restore = plan.changes.find((c) => c.type === 'restore_enrollment');
  assert.ok(restore);
  assert.equal(restore.new_status, 'pending_enrollment');
}

function testDownpaymentRealignment() {
  const change = planDownpaymentRealignment(
    { invoice_id: 400, status: 'Unpaid', issue_ymd: '2026-06-01', due_ymd: '2026-06-05' },
    '2026-06-10'
  );
  assert.ok(change);
  assert.equal(change.new_due_date, '2026-06-17');
}

function testResolveIssueDateAfterDueAlign() {
  assert.equal(resolveIssueDateAfterDueAlign('2026-08-10', '2026-08-02'), '2026-08-02');
  assert.equal(resolveIssueDateAfterDueAlign('2026-06-01', '2026-08-02'), '2026-06-01');
}

function testSettledStatuses() {
  assert.equal(isSettledInvoiceStatus('Paid'), true);
  assert.equal(isSettledInvoiceStatus('Partially Paid'), true);
  assert.equal(isSettledInvoiceStatus('Unpaid'), false);
}

function testAddDaysYmd() {
  assert.equal(addDaysYmd('2026-07-03', 30), '2026-08-02');
}

function testDateParam() {
  assert.equal(dateParam('2026-08-02'), '2026-08-02');
  assert.equal(dateParam(''), null);
  assert.equal(dateParam(null), null);
  assert.equal(dateParam(undefined), null);
}

function testFirstInvoiceWithoutTargetPhaseRemark() {
  const phaseStartDateMap = { 1: '2026-08-07' };
  const profile = {
    installmentinvoiceprofiles_id: 4,
    student_id: 13,
    generated_count: 1,
    total_phases: 6,
    phase_start: 1,
    is_active: true,
    full_name: 'Anygma Yuson',
    email: 'anygma@gmail.com',
  };
  const phaseInvoices = [
    {
      invoice_id: 645,
      invoice_ar_number: 'INV-645',
      status: 'Unpaid',
      issue_ymd: '2026-07-09',
      due_ymd: '2026-07-02',
      phase: 1,
      remarks: 'CLASS_ID:54;PHASE_START:1;PHASE_END:6',
    },
  ];

  assert.equal(resolveInvoicePhaseForRealignment(phaseInvoices[0], profile, 0), 1);

  const plan = planProfileBillingRealignment(
    profile,
    phaseInvoices,
    null,
    phaseStartDateMap
  );

  const phase1Update = plan.changes.find((c) => c.type === 'update_phase_invoice' && c.phase === 1);
  assert.ok(phase1Update, 'first generated invoice should realign to new phase 1 due');
  assert.equal(phase1Update.new_due_date, '2026-08-06');
  assert.equal(phase1Update.old_due_date, '2026-07-02');
}

function testMidPackageTargetGeneratedCount() {
  const phaseInvoices = [
    {
      invoice_id: 500,
      status: 'Unpaid',
      issue_ymd: '2026-06-25',
      due_ymd: '2026-09-10',
      phase: 2,
      remarks: 'TARGET_PHASE:2',
    },
  ];
  const profile = {
    installmentinvoiceprofiles_id: 5,
    student_id: 14,
    generated_count: 1,
    total_phases: 6,
    phase_start: 2,
    is_active: true,
  };

  assert.equal(resolveTargetGeneratedCount(phaseInvoices), 1);

  const plan = planProfileBillingRealignment(
    profile,
    phaseInvoices,
    null,
    { 2: '2026-07-03', 3: '2026-08-07' }
  );

  assert.equal(plan.targetGeneratedCount, 1);
  const phase2Update = plan.changes.find((c) => c.type === 'update_phase_invoice' && c.phase === 2);
  assert.ok(phase2Update);
  assert.equal(phase2Update.new_due_date, '2026-07-02');
  const generatedCountChange = plan.changes.find((c) => c.type === 'set_generated_count');
  assert.equal(generatedCountChange, undefined);
}

function testRecurringDateByPhaseOverridesSessionMinusOne() {
  const phaseStartDateMap = { 1: '2026-07-20', 2: '2026-08-17' };
  const profile = {
    installmentinvoiceprofiles_id: 6,
    student_id: 15,
    generated_count: 2,
    total_phases: 6,
    is_active: true,
  };
  const phaseInvoices = [
    {
      invoice_id: 600,
      invoice_ar_number: 'INV-600',
      status: 'Unpaid',
      issue_ymd: '2026-07-20',
      due_ymd: '2026-07-19',
      phase: 1,
      remarks: 'TARGET_PHASE:1',
    },
    {
      invoice_id: 601,
      invoice_ar_number: 'INV-601',
      status: 'Unpaid',
      issue_ymd: '2026-07-25',
      due_ymd: '2026-08-05',
      phase: 2,
      remarks: 'TARGET_PHASE:2',
    },
  ];

  const plan = planProfileBillingRealignment(profile, phaseInvoices, null, phaseStartDateMap, {
    recurringDateByPhase: {
      2: { issue: '2026-08-01', due: '2026-08-05' },
    },
  });

  const phase2Update = plan.changes.find((c) => c.type === 'update_phase_invoice' && c.phase === 2);
  assert.ok(phase2Update);
  assert.equal(phase2Update.new_issue_date, '2026-08-01');
  assert.equal(phase2Update.new_due_date, '2026-08-05');
}

const tests = [
  testComputePhaseDueFromStart,
  testJulyToAugustShiftScenario,
  testPaidInvoiceUnchanged,
  testDelinquencyDropRestore,
  testDownpaymentRealignment,
  testResolveIssueDateAfterDueAlign,
  testSettledStatuses,
  testAddDaysYmd,
  testDateParam,
  testFirstInvoiceWithoutTargetPhaseRemark,
  testMidPackageTargetGeneratedCount,
  testRecurringDateByPhaseOverridesSessionMinusOne,
];

let failed = 0;
for (const run of tests) {
  try {
    run();
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

console.log(`\n${tests.length} billing realignment tests passed.`);
