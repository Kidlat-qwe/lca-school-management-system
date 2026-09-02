/**
 * Unit tests for teacher-designated class filtering on lesson plan meta.
 * Run: node backend/tests/lessonPlanTeacherClasses.test.js
 */

import assert from 'node:assert/strict';
import {
  deriveBranchGradeLevelsFromClasses,
  fetchLessonPlanMetaClasses,
  isTeacherAssignedToClass,
} from '../lib/lessonPlans/index.js';

async function testFetchLessonPlanMetaClassesTeacherFilter() {
  const calls = [];
  const db = async (sql, params) => {
    calls.push({ sql, params });
    return {
      rows: [
        {
          class_id: 10,
          class_name: 'Lively Bees',
          level_tag: 'Pre-Kindergarten',
          status: 'Active',
          program_name: 'Test Program',
        },
      ],
    };
  };

  const all = await fetchLessonPlanMetaClasses(db, { branchId: 3 });
  assert.equal(all.length, 1);
  assert.equal(calls[0].params.length, 1);

  calls.length = 0;
  const teacherOnly = await fetchLessonPlanMetaClasses(db, {
    branchId: 3,
    teacherUserId: 99,
  });
  assert.equal(teacherOnly.length, 1);
  assert.equal(calls[0].params[1], 99);
  assert.match(calls[0].sql, /classteacherstbl/i);
}

async function testIsTeacherAssignedToClass() {
  const db = async () => ({ rows: [{ '?column?': 1 }] });
  assert.equal(await isTeacherAssignedToClass(db, 5, 99), true);
  assert.equal(await isTeacherAssignedToClass(db, 0, 99), false);
}

function testGradeLevelsFromDesignatedClasses() {
  const levels = deriveBranchGradeLevelsFromClasses([
    { level_tag: 'Grade 2' },
    { level_tag: 'Pre-Kindergarten' },
  ]);
  assert.deepEqual(levels, ['Pre-Kindergarten', 'Grade 2']);
}

async function run() {
  await testFetchLessonPlanMetaClassesTeacherFilter();
  await testIsTeacherAssignedToClass();
  testGradeLevelsFromDesignatedClasses();
  console.log('lessonPlanTeacherClasses.test.js: all tests passed');
}

run();
