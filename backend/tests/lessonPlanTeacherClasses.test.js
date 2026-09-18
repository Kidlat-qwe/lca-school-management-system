/**
 * Unit tests for teacher-designated class filtering on lesson plan meta.
 * Run: node backend/tests/lessonPlanTeacherClasses.test.js
 */

import assert from 'node:assert/strict';
import {
  deriveBranchGradeLevelsFromClasses,
  fetchLessonPlanMetaClasses,
  isTeacherAssignedToClass,
  LESSON_PLAN_MISSED_SINCE_DEFAULT,
  mapMissedLessonPlanRow,
  resolveLessonPlanMissedSince,
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
  assert.match(calls[0].sql, /class_code/i);

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

function testMapMissedLessonPlanRow() {
  const mapped = mapMissedLessonPlanRow({
    classsession_id: 12,
    class_id: 94,
    phase_number: 1,
    phase_session_number: 6,
    class_code: 'ABC-1',
    scheduled_date: '2026-09-10',
    days_overdue: 7,
    topic: 'Phonics',
    teacher_user_id: 5,
    branch_id: 2,
    grade_level: 'Kindergarten',
    class_name: 'Busy Bees',
    teacher_name: 'Jane Teacher',
    branch_name: 'Main',
  });
  assert.equal(mapped.status, 'missed');
  assert.equal(mapped.phase, 'Phase 1');
  assert.equal(mapped.session, 'Session 6 — Phonics');
  assert.equal(mapped.days_overdue, 7);
  assert.equal(mapped.miss_key, '12:5:94:1:6');
}

function testResolveMissedSince() {
  assert.equal(resolveLessonPlanMissedSince(null), LESSON_PLAN_MISSED_SINCE_DEFAULT);
  assert.equal(resolveLessonPlanMissedSince('2026-09-20'), '2026-09-20');
}

async function run() {
  await testFetchLessonPlanMetaClassesTeacherFilter();
  await testIsTeacherAssignedToClass();
  testGradeLevelsFromDesignatedClasses();
  testMapMissedLessonPlanRow();
  testResolveMissedSince();
  console.log('lessonPlanTeacherClasses.test.js: all tests passed');
}

run();
