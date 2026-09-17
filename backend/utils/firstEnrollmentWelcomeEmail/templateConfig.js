/**
 * Maps onboarding email to Settings → Templates keys and builds variables.
 */
import {
  logTemplateRenderWarning,
  loadEffectiveTemplate,
  renderMessagingTemplate,
} from '../templateRenderService.js';
import { groupChatFallbackText } from './branchGroupChat.js';
import {
  academicYearLabel,
  buildSequenceEmail,
  facebookPageUrl,
} from './emailBodies.js';
import {
  FIRST_ENROLLMENT_TEMPLATE_DEFAULTS,
  FIRST_ENROLLMENT_TEMPLATE_KEYS,
} from './defaultTemplates.js';

export const EMAIL_ID_TO_TEMPLATE_KEY = Object.freeze({
  onboarding: FIRST_ENROLLMENT_TEMPLATE_KEYS.onboarding,
  // Legacy IDs (no longer sent)
  class_schedule: FIRST_ENROLLMENT_TEMPLATE_KEYS.class_schedule,
  things_to_prepare: FIRST_ENROLLMENT_TEMPLATE_KEYS.things_to_prepare,
  important_reminders: FIRST_ENROLLMENT_TEMPLATE_KEYS.important_reminders,
  stay_connected: FIRST_ENROLLMENT_TEMPLATE_KEYS.stay_connected,
});

/**
 * True when a stored Settings body is still the old welcome-only template
 * (missing the combined sections).
 */
export function isStaleShortOnboardingBody(body) {
  const text = String(body || '');
  if (!text.trim()) return true;
  // Prefer placeholder check on unrendered template bodies.
  if (text.includes('{classStartDate}') || text.includes('{classSchedule}')) {
    if (text.includes('{facebookUrl}') || text.includes('{groupChatLine}')) {
      return false;
    }
  }
  // Rendered bodies: look for section headings.
  const hasSchedule = /FIRST DAY OF SCHOOL/i.test(text);
  const hasPrepare = /THINGS TO PREPARE/i.test(text) || /Extra set of clothes/i.test(text);
  const hasReminders = /IMPORTANT REMINDERS/i.test(text);
  const hasStay = /STAY CONNECTED/i.test(text);
  return !(hasSchedule && hasPrepare && hasReminders && hasStay);
}

export function buildFirstEnrollmentTemplateVariables(emailId, context = {}) {
  const year = context.academicYear || academicYearLabel();
  const facebookUrl = context.facebookUrl || facebookPageUrl();
  const groupChatUrl = context.groupChatUrl || null;
  const groupChatLabel = context.groupChatLabel || 'Group Chat';
  const groupChatLine = groupChatUrl
    ? `Group Chat: ${groupChatLabel} (${groupChatUrl})`
    : groupChatFallbackText();

  const combined = {
    academicYear: year,
    arAttachmentNote: context.includeArAttachmentNote
      ? '\n\nYour acknowledgement receipt is attached to this email as a PDF for your records.'
      : '',
    classStartDate: context.classStartDateDisplay || 'To be announced',
    classSchedule:
      context.classScheduleText ||
      'Please contact your branch for your class schedule.',
    branchName: context.branchName || '',
    facebookUrl,
    groupChatLine,
    groupChatLabel,
    groupChatUrl: groupChatUrl || '',
  };

  switch (emailId) {
    case 'onboarding':
      return combined;
    case 'class_schedule':
      return {
        classStartDate: combined.classStartDate,
        classSchedule: combined.classSchedule,
        branchName: combined.branchName,
      };
    case 'things_to_prepare':
      return {};
    case 'important_reminders':
      return {};
    case 'stay_connected':
      return {
        facebookUrl,
        groupChatLine,
        groupChatLabel,
        groupChatUrl: groupChatUrl || '',
      };
    default:
      return {};
  }
}

/**
 * Resolve subject + HTML from Settings template, falling back to hardcoded builders.
 * @returns {Promise<{ subject: string, html: string, plainText: string, enabled: boolean, source: string, skipped?: boolean }>}
 */
export async function resolveSequenceEmailContent({
  client = null,
  emailId,
  context = {},
  branchId = null,
}) {
  const templateKey = EMAIL_ID_TO_TEMPLATE_KEY[emailId];
  if (templateKey) {
    try {
      // Detect stale welcome-only Settings body before variable substitution.
      if (emailId === 'onboarding') {
        const tpl = await loadEffectiveTemplate(client, templateKey, branchId);
        if (!tpl.enabled) {
          return {
            skipped: true,
            enabled: false,
            subject: '',
            html: '',
            plainText: '',
            source: 'settings_disabled',
          };
        }
        if (isStaleShortOnboardingBody(tpl.body)) {
          const legacy = buildSequenceEmail('onboarding', context);
          return {
            enabled: true,
            subject: tpl.subject || legacy.subject,
            html: legacy.html,
            plainText: legacy.plainText,
            source: 'fallback_combined_upgrade',
          };
        }
      }

      const rendered = await renderMessagingTemplate({
        client,
        templateKey,
        branchId,
        variables: buildFirstEnrollmentTemplateVariables(emailId, context),
      });
      if (!rendered.enabled) {
        return {
          skipped: true,
          enabled: false,
          subject: '',
          html: '',
          plainText: '',
          source: 'settings_disabled',
        };
      }

      if (rendered.subject && rendered.body) {
        return {
          enabled: true,
          subject: rendered.subject,
          html: rendered.bodyHtml,
          plainText: rendered.body,
          source: 'settings',
        };
      }
    } catch (err) {
      await logTemplateRenderWarning(`first enrollment template ${emailId}`, err);
    }
  }

  const legacy = buildSequenceEmail(emailId, context);
  return {
    enabled: true,
    subject: legacy.subject,
    html: legacy.html,
    plainText: legacy.plainText,
    source: 'fallback',
  };
}

export { FIRST_ENROLLMENT_TEMPLATE_DEFAULTS, FIRST_ENROLLMENT_TEMPLATE_KEYS };
