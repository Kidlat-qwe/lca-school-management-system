/**
 * First enrollment template resolution tests.
 * Run: node backend/tests/firstEnrollmentTemplateConfig.test.js
 */
import assert from 'assert';
import {
  buildFirstEnrollmentTemplateVariables,
  isStaleShortOnboardingBody,
} from '../utils/firstEnrollmentWelcomeEmail/templateConfig.js';
import { FIRST_ENROLLMENT_TEMPLATE_DEFAULTS } from '../utils/firstEnrollmentWelcomeEmail/defaultTemplates.js';
import {
  buildOnboardingPlainText,
  SEQUENCE_EMAIL_IDS,
} from '../utils/firstEnrollmentWelcomeEmail/emailBodies.js';

{
  const vars = buildFirstEnrollmentTemplateVariables('onboarding', {
    academicYear: '2026–2027',
    includeArAttachmentNote: true,
    classStartDateDisplay: 'March 1, 2026',
    classScheduleText: 'Mon/Wed 9:00 AM',
    facebookUrl: 'https://www.facebook.com/littlechampionsacademy',
    groupChatUrl: 'https://m.me/j/example',
    groupChatLabel: 'Malolos Group Chat',
  });
  assert.ok(vars.academicYear === '2026–2027');
  assert.ok(vars.arAttachmentNote.includes('acknowledgement receipt'));
  assert.ok(vars.classStartDate.includes('March'));
  assert.ok(vars.classSchedule.includes('Mon'));
  assert.ok(vars.groupChatLine.includes('Malolos'));
}

{
  const body = FIRST_ENROLLMENT_TEMPLATE_DEFAULTS.template_first_enrollment_onboarding.body;
  assert.ok(body.includes('{academicYear}'));
  assert.ok(body.includes('{classStartDate}'));
  assert.ok(body.includes('{classSchedule}'));
  assert.ok(body.includes('{groupChatLine}'));
  assert.ok(body.includes('THINGS TO PREPARE'));
  assert.ok(body.includes('IMPORTANT REMINDERS'));
  assert.ok(body.includes('STAY CONNECTED'));
  assert.strictEqual(isStaleShortOnboardingBody(body), false);
}

{
  assert.strictEqual(
    isStaleShortOnboardingBody(
      'Congratulations!\n\nWe are pleased to inform you that your child is officially enrolled.'
    ),
    true
  );
}

{
  assert.deepStrictEqual(SEQUENCE_EMAIL_IDS, ['onboarding']);
  const plain = buildOnboardingPlainText({
    academicYear: '2026–2027',
    classStartDateDisplay: 'Sep 1, 2026',
    classScheduleText: 'TTh 1:00 PM',
  });
  assert.ok(plain.includes('FIRST DAY OF SCHOOL'));
  assert.ok(plain.includes('THINGS TO PREPARE'));
  assert.ok(plain.includes('IMPORTANT REMINDERS'));
  assert.ok(plain.includes('STAY CONNECTED'));
}

console.log('firstEnrollmentTemplateConfig.test.js OK');
