/**
 * First enrollment template resolution tests.
 * Run: node backend/tests/firstEnrollmentTemplateConfig.test.js
 */
import assert from 'assert';
import { buildFirstEnrollmentTemplateVariables } from '../utils/firstEnrollmentWelcomeEmail/templateConfig.js';
import { FIRST_ENROLLMENT_TEMPLATE_DEFAULTS } from '../utils/firstEnrollmentWelcomeEmail/defaultTemplates.js';

{
  const vars = buildFirstEnrollmentTemplateVariables('onboarding', {
    academicYear: '2026–2027',
    includeArAttachmentNote: true,
  });
  assert.ok(vars.academicYear === '2026–2027');
  assert.ok(vars.arAttachmentNote.includes('acknowledgement receipt'));
}

{
  const vars = buildFirstEnrollmentTemplateVariables('class_schedule', {
    classStartDateDisplay: 'March 1, 2026',
    classScheduleText: 'Mon/Wed 9:00 AM',
  });
  assert.ok(vars.classStartDate.includes('March'));
  assert.ok(vars.classSchedule.includes('Mon'));
}

{
  assert.ok(FIRST_ENROLLMENT_TEMPLATE_DEFAULTS.template_first_enrollment_onboarding.body.includes('{academicYear}'));
  assert.ok(FIRST_ENROLLMENT_TEMPLATE_DEFAULTS.template_first_enrollment_stay_connected.body.includes('{groupChatLine}'));
}

console.log('firstEnrollmentTemplateConfig.test.js OK');
