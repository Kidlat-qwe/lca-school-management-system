/**
 * Unit tests for uniform Set-break preview helpers.
 * Run: node backend/tests/uniformSetBreak.test.js
 */

import assert from 'node:assert/strict';
import {
  gendersCompatible,
  previewSetBreakForPendingLine,
  buildSetBreakDescription,
  findSiblingPendingLine,
} from '../lib/packageMerchFulfillment/setBreak.js';

function testGenderCompat() {
  assert.equal(gendersCompatible('Male', 'Male'), true);
  assert.equal(gendersCompatible('Male', 'Men'), true);
  assert.equal(gendersCompatible('Female', 'Women'), true);
  assert.equal(gendersCompatible('Male', 'Female'), false);
  assert.equal(gendersCompatible('Male', 'Unisex'), true);
  assert.equal(gendersCompatible('', 'Female'), true);
}

function testPreviewIssueTopFromSetAddsBottom() {
  const line = {
    merchandise_id: 82,
    merchandise_name: 'School Uniform',
    size: 'XS',
    category: 'Top',
    action: 'issue',
  };
  const pieceStock = {
    merchandise_id: 82,
    merchandise_name: 'School Uniform',
    size: 'XS',
    type: 'Polo',
    gender: 'Male',
    quantity: 0,
    branch_id: 1,
  };
  const setStock = {
    merchandise_id: 81,
    merchandise_name: 'School Uniform',
    size: 'XS',
    type: 'Set',
    gender: 'Male',
    quantity: 2,
    branch_id: 1,
  };
  const bottomStock = {
    merchandise_id: 131,
    merchandise_name: 'School Uniform',
    size: 'XS',
    type: 'Short',
    gender: 'Male',
    quantity: 5,
    branch_id: 1,
  };
  const stockByBranch = new Map([[1, [pieceStock, setStock, bottomStock]]]);

  const preview = previewSetBreakForPendingLine({
    line,
    pieceStock,
    stockByBranch,
    branchId: 1,
    remainingLines: [line],
    studentName: 'Test Student',
  });

  assert.ok(preview?.available);
  assert.equal(preview.set_merchandise_id, 81);
  assert.equal(preview.leftover_merchandise_id, 131);
  assert.equal(preview.covers_sibling, false);
  assert.match(preview.description, /Deduct 1 Set/i);
  assert.match(preview.description, /Add 1/i);
  assert.match(preview.description, /Bottom/i);
}

function testPreviewCoversSiblingTopBottom() {
  const top = {
    merchandise_id: 82,
    merchandise_name: 'School Uniform',
    size: 'XS',
    category: 'Top',
    action: 'issue',
  };
  const bottom = {
    merchandise_id: 131,
    merchandise_name: 'School Uniform',
    size: 'XS',
    category: 'Bottom',
    action: 'issue',
  };
  const pieceStock = {
    merchandise_id: 82,
    merchandise_name: 'School Uniform',
    size: 'XS',
    type: 'Polo',
    gender: 'Male',
    quantity: 0,
    branch_id: 1,
  };
  const setStock = {
    merchandise_id: 81,
    merchandise_name: 'School Uniform',
    size: 'XS',
    type: 'Set',
    gender: 'Male',
    quantity: 1,
    branch_id: 1,
  };
  const stockByBranch = new Map([[1, [pieceStock, setStock]]]);

  assert.ok(findSiblingPendingLine(top, [top, bottom]));

  const preview = previewSetBreakForPendingLine({
    line: top,
    pieceStock,
    stockByBranch,
    branchId: 1,
    remainingLines: [top, bottom],
    studentName: 'Test Student',
  });

  assert.ok(preview?.available);
  assert.equal(preview.covers_sibling, true);
  assert.equal(preview.leftover_merchandise_id, null);
  assert.match(preview.description, /Top and Bottom/i);
  assert.match(preview.description, /Not return a leftover/i);
}

function testDoesNotUseFemaleSetForMalePolo() {
  const line = {
    merchandise_id: 82,
    merchandise_name: 'School Uniform',
    size: 'XS',
    category: 'Top',
    action: 'issue',
  };
  const pieceStock = {
    merchandise_id: 82,
    merchandise_name: 'School Uniform',
    size: 'XS',
    type: 'Polo',
    gender: 'Male',
    quantity: 0,
    branch_id: 1,
  };
  const femaleSet = {
    merchandise_id: 99,
    merchandise_name: 'School Uniform',
    size: 'XS',
    type: 'Set',
    gender: 'Female',
    quantity: 5,
    branch_id: 1,
  };
  const stockByBranch = new Map([[1, [pieceStock, femaleSet]]]);

  const preview = previewSetBreakForPendingLine({
    line,
    pieceStock,
    stockByBranch,
    branchId: 1,
    remainingLines: [line],
  });

  assert.equal(preview, null);
}

function testDescriptionBuilder() {
  const text = buildSetBreakDescription({
    line: {
      merchandise_name: 'School Uniform',
      size: 'XS',
      category: 'Top',
    },
    setStock: {
      merchandise_name: 'School Uniform',
      size: 'XS',
      gender: 'Male',
      type: 'Set',
      quantity: 2,
    },
    leftoverStock: {
      merchandise_name: 'School Uniform',
      size: 'XS',
      type: 'Short',
      gender: 'Male',
      quantity: 5,
    },
    studentName: 'Kier',
  });
  assert.match(text, /Issue from Set to Kier/i);
  assert.match(text, /Short/);
}

function run() {
  testGenderCompat();
  testPreviewIssueTopFromSetAddsBottom();
  testPreviewCoversSiblingTopBottom();
  testDoesNotUseFemaleSetForMalePolo();
  testDescriptionBuilder();
  console.log('uniformSetBreak.test.js: all tests passed');
}

run();
