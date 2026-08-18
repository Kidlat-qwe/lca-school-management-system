/**
 * Unit tests for Student History full-payment invoice classification.
 * Run: node backend/tests/studentFullPaymentInvoices.test.js
 */

import assert from 'node:assert/strict';
import {
  isStudentFullPaymentInvoiceCandidate,
  normalizeFullPaymentEnrollmentPhases,
  resolveFullPaymentStudentStatus,
} from '../lib/studentFullPaymentInvoices/index.js';

function testNativeFullPaymentPackage() {
  assert.equal(
    isStudentFullPaymentInvoiceCandidate({
      remarks: 'CLASS_ID:95;PHASE_START:1;PHASE_END:10',
      invoice_description: 'Fullpayment Pre-K',
      package_type: 'Fullpayment',
      installmentinvoiceprofiles_id: null,
      status: 'Paid',
    }),
    true
  );
}

function testConversionRemarks() {
  assert.equal(
    isStudentFullPaymentInvoiceCandidate({
      remarks: 'PACKAGE_CHANGE_TO_FULLPAYMENT;CLASS_ID:12;CREDIT_APPLIED:5000;TARGET_FULL_PRICE:18000',
      invoice_description: 'Package change to Fullpayment',
      installmentinvoiceprofiles_id: null,
      status: 'Unpaid',
    }),
    true
  );
}

function testInstallmentPhaseExcluded() {
  assert.equal(
    isStudentFullPaymentInvoiceCandidate({
      remarks: 'CLASS_ID:12;TARGET_PHASE:3;PHASE_START:3;PHASE_END:3;Auto-generated from installment',
      invoice_description: 'Phase 3',
      installmentinvoiceprofiles_id: 54,
      status: 'Unpaid',
    }),
    false
  );
}

function testDownpaymentExcluded() {
  assert.equal(
    isStudentFullPaymentInvoiceCandidate({
      remarks: 'CLASS_ID:12;PHASE_START:1;PHASE_END:1',
      invoice_description: 'Downpayment - Pre-K',
      installmentinvoiceprofiles_id: null,
      status: 'Paid',
    }),
    false
  );
}

function testCancelledExcluded() {
  assert.equal(
    isStudentFullPaymentInvoiceCandidate({
      remarks: 'PACKAGE_CHANGE_TO_FULLPAYMENT;CLASS_ID:12',
      invoice_description: 'Full payment',
      installmentinvoiceprofiles_id: null,
      status: 'Cancelled',
    }),
    false
  );
}

testNativeFullPaymentPackage();
testConversionRemarks();
testInstallmentPhaseExcluded();
testDownpaymentExcluded();
testCancelledExcluded();

function testFirstPhaseReEnrolledDisplaysAsNew() {
  const normalized = normalizeFullPaymentEnrollmentPhases([
    { phase_number: 1, status: 're_enrolled' },
    { phase_number: 2, status: 're_enrolled' },
    { phase_number: 10, status: 'completed' },
  ]);
  assert.equal(normalized[0].status, 'new');
  assert.equal(normalized[1].status, 're_enrolled');
  assert.equal(normalized[2].status, 'completed');
}

function testStudentStatusActiveWhenEnrolled() {
  assert.equal(
    resolveFullPaymentStudentStatus([
      { phase_number: 1, status: 'new' },
      { phase_number: 10, status: 'completed' },
    ]),
    'active'
  );
  assert.equal(
    resolveFullPaymentStudentStatus([{ phase_number: 10, status: 'completed' }]),
    'inactive'
  );
}

testFirstPhaseReEnrolledDisplaysAsNew();
testStudentStatusActiveWhenEnrolled();
console.log('studentFullPaymentInvoices tests passed');
