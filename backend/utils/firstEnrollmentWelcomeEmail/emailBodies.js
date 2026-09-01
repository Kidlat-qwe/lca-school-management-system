/**
 * Plain-text + HTML bodies for first-enrollment onboarding email sequence.
 */
import { escapeHtml, plainTextToEmailHtml, wrapBrandedEmailHtml } from '../templateRenderService.js';
import { groupChatFallbackText } from './branchGroupChat.js';

export const DEFAULT_FACEBOOK_URL = 'https://www.facebook.com/littlechampionsacademy';

export const ONBOARDING_EMAIL = {
  id: 'onboarding',
  subject: 'Welcome to Little Champions Academy!',
  legacyLogType: 'first_enrollment_welcome_email',
};

export const FOLLOW_UP_EMAILS = [
  {
    id: 'class_schedule',
    subject: 'Your Class Schedule – Little Champions Academy',
  },
  {
    id: 'things_to_prepare',
    subject: 'Things to Prepare for Class – Little Champions Academy',
  },
  {
    id: 'important_reminders',
    subject: 'Important Reminders – Little Champions Academy',
  },
  {
    id: 'stay_connected',
    subject: 'Stay Connected – Little Champions Academy',
  },
];

export function academicYearLabel(fromEnv) {
  const raw = String(fromEnv || process.env.FIRST_ENROLLMENT_WELCOME_ACADEMIC_YEAR || '').trim();
  return raw || '2026–2027';
}

export function facebookPageUrl() {
  return (
    String(process.env.FIRST_ENROLLMENT_FACEBOOK_URL || '').trim() || DEFAULT_FACEBOOK_URL
  );
}

/**
 * Email 1 — Onboarding (official enrollment welcome).
 */
export function buildOnboardingPlainText({ academicYear, includeArAttachmentNote = false } = {}) {
  const year = academicYear || academicYearLabel();
  const lines = [
    'Congratulations!',
    '',
    `We are pleased to inform you that your child is officially enrolled at Little Champions Academy Inc. for Academic Year ${year}.`,
    '',
    'We are delighted to welcome you to the Little Champions family! We look forward to partnering with you in creating a meaningful and exciting learning journey filled with opportunities to play, learn, and succeed.',
    '',
    'Thank you for choosing Little Champions Academy. We are excited to have you with us!',
    '',
    'Welcome to Little Champions Academy!',
  ];

  if (includeArAttachmentNote) {
    lines.push(
      '',
      'Your acknowledgement receipt is attached to this email as a PDF for your records.'
    );
  }

  lines.push('', 'Best Regards,', 'Little Champions Academy Inc.', 'Play . Learn . Succeed');
  return lines.join('\n');
}

/**
 * Email 2 — Class schedule (dynamic from CMS class).
 */
export function buildClassSchedulePlainText({
  classStartDateDisplay = 'To be announced',
  classScheduleText = 'Please contact your branch for your class schedule.',
} = {}) {
  return [
    'FIRST DAY OF SCHOOL',
    '',
    `Date: ${classStartDateDisplay}`,
    '',
    `Class Schedule: ${classScheduleText}`,
    '',
    'Important: Please arrive at least 10 minutes before your scheduled class time to allow your child sufficient time to settle in and prepare for class.',
    '',
    'For dismissal, parents or authorized guardians are requested to arrive 10 minutes before the scheduled end of class to ensure a smooth and orderly pick-up.',
    '',
    'Best Regards,',
    'Little Champions Academy Inc.',
    'Play . Learn . Succeed',
  ].join('\n');
}

/**
 * Email 3 — Things to prepare.
 */
export function buildThingsToPreparePlainText() {
  return [
    'Please ensure that your child brings the following:',
    '',
    '1. Extra set of clothes',
    '',
    '2. Hygiene Kit (Wet wipes, alcohol, tissue, soap)',
    '',
    '3. Dry, healthy, and nutritious snack',
    '',
    '4. A refillable and sealed water bottle labeled with your child’s complete name',
    '',
    'Best Regards,',
    'Little Champions Academy Inc.',
    'Play . Learn . Succeed',
  ].join('\n');
}

/**
 * Email 4 — Important reminders.
 */
export function buildImportantRemindersPlainText() {
  return [
    'IMPORTANT REMINDERS',
    '',
    '• Please ensure that your child arrives at least 10 minutes before the scheduled class time.',
    '',
    '• Please prepare all necessary school items before leaving home to avoid delays.',
    '',
    '• Kindly label all personal belongings with your child’s complete name.',
    '',
    '• Please ensure that your child is well-rested and prepared to participate in class.',
    '',
    '• Please regularly check the official class group chat for announcements, reminders, and other important information.',
    '',
    '• Kindly complete the required onboarding requirements before your child’s first day of school.',
    '',
    'Best Regards,',
    'Little Champions Academy Inc.',
    'Play . Learn . Succeed',
  ].join('\n');
}

/**
 * Email 5 — Stay connected (Facebook page + branch group chat).
 */
export function buildStayConnectedPlainText({
  facebookUrl = facebookPageUrl(),
  groupChatUrl = null,
  groupChatLabel = 'Group Chat',
} = {}) {
  const groupChatLine = groupChatUrl
    ? `Group Chat: ${groupChatLabel} (${groupChatUrl})`
    : `Group Chat: ${groupChatFallbackText()}`;

  return [
    'STAY CONNECTED',
    '',
    'For the latest updates, you can also follow and message our official Facebook page and group chat:',
    '',
    `Facebook page link: Little Champions Academy Inc. (${facebookUrl})`,
    '',
    groupChatLine,
    '',
    'Once again, welcome to Little Champions Academy, Inc. We look forward to partnering with you throughout the academic year and supporting your child’s continued learning and development.',
    '',
    'Sincerely,',
    '',
    'Little Champions Academy, Inc.',
    '',
    'Play. Learn. Succeed.',
  ].join('\n');
}

export function buildStayConnectedHtml({
  facebookUrl = facebookPageUrl(),
  groupChatUrl = null,
  groupChatLabel = 'Group Chat',
} = {}) {
  const fbUrl = escapeHtml(facebookUrl);
  const groupChatHtml = groupChatUrl
    ? `<a href="${escapeHtml(groupChatUrl)}" style="color:#1a56db;text-decoration:underline;">${escapeHtml(groupChatLabel)}</a>`
    : escapeHtml(groupChatFallbackText());

  const inner = `
    <p style="margin:0 0 16px;color:#111827;line-height:1.6;font-weight:bold;">STAY CONNECTED</p>
    <p style="margin:0 0 16px;color:#111827;line-height:1.6;">
      For the latest updates, you can also follow and message our official Facebook page and group chat:
    </p>
    <p style="margin:0 0 16px;color:#111827;line-height:1.6;">
      Facebook page link:
      <a href="${fbUrl}" style="color:#1a56db;text-decoration:underline;">Little Champions Academy Inc.</a>
    </p>
    <p style="margin:0 0 16px;color:#111827;line-height:1.6;">
      Group Chat:<br/>
      ${groupChatHtml}
    </p>
    <p style="margin:0 0 16px;color:#111827;line-height:1.6;">
      Once again, welcome to Little Champions Academy, Inc. We look forward to partnering with you throughout the academic year and supporting your child’s continued learning and development.
    </p>
    <p style="margin:0 0 4px;color:#111827;line-height:1.6;">Sincerely,</p>
    <p style="margin:0 0 16px;color:#111827;line-height:1.6;">
      Little Champions Academy, Inc.<br/>Play. Learn. Succeed.
    </p>`;
  return wrapBrandedEmailHtml(inner);
}

/** @deprecated Use buildOnboardingPlainText */
export function buildFirstEnrollmentWelcomePlainText(options = {}) {
  return buildOnboardingPlainText(options);
}

/** @deprecated Use buildOnboardingHtml */
export function buildFirstEnrollmentWelcomeHtml(options = {}) {
  return plainTextToEmailHtml(buildOnboardingPlainText(options));
}

export function buildOnboardingHtml(options = {}) {
  return plainTextToEmailHtml(buildOnboardingPlainText(options));
}

export function buildClassScheduleHtml(context = {}) {
  return plainTextToEmailHtml(buildClassSchedulePlainText(context));
}

export function buildThingsToPrepareHtml() {
  return plainTextToEmailHtml(buildThingsToPreparePlainText());
}

export function buildImportantRemindersHtml() {
  return plainTextToEmailHtml(buildImportantRemindersPlainText());
}

export function buildSequenceEmail(emailId, context = {}) {
  switch (emailId) {
    case 'onboarding':
      return {
        subject: ONBOARDING_EMAIL.subject,
        html: buildOnboardingHtml({
          academicYear: context.academicYear,
          includeArAttachmentNote: context.includeArAttachmentNote,
        }),
        plainText: buildOnboardingPlainText({
          academicYear: context.academicYear,
          includeArAttachmentNote: context.includeArAttachmentNote,
        }),
      };
    case 'class_schedule':
      return {
        subject: FOLLOW_UP_EMAILS[0].subject,
        html: buildClassScheduleHtml(context),
        plainText: buildClassSchedulePlainText(context),
      };
    case 'things_to_prepare':
      return {
        subject: FOLLOW_UP_EMAILS[1].subject,
        html: buildThingsToPrepareHtml(),
        plainText: buildThingsToPreparePlainText(),
      };
    case 'important_reminders':
      return {
        subject: FOLLOW_UP_EMAILS[2].subject,
        html: buildImportantRemindersHtml(),
        plainText: buildImportantRemindersPlainText(),
      };
    case 'stay_connected':
      return {
        subject: FOLLOW_UP_EMAILS[3].subject,
        html: buildStayConnectedHtml({
          facebookUrl: context.facebookUrl,
          groupChatUrl: context.groupChatUrl,
          groupChatLabel: context.groupChatLabel,
        }),
        plainText: buildStayConnectedPlainText({
          facebookUrl: context.facebookUrl,
          groupChatUrl: context.groupChatUrl,
          groupChatLabel: context.groupChatLabel,
        }),
      };
    default:
      throw new Error(`Unknown onboarding email id: ${emailId}`);
  }
}

export const SEQUENCE_EMAIL_IDS = [
  ONBOARDING_EMAIL.id,
  ...FOLLOW_UP_EMAILS.map((e) => e.id),
];
