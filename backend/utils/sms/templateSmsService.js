import {
  loadEffectiveTemplate,
  logTemplateRenderWarning,
  renderTemplateString,
} from '../templateRenderService.js';
import { collectPhilippineMobiles, isSemaphoreConfigured, sendSemaphoreSms } from './semaphoreSmsService.js';

const SMS_TEMPLATE_KEYS = new Set([
  'template_payment_confirmation',
  'template_payment_reminder',
  'template_monthly_invoice_notice',
]);

export function isSmsTemplateKey(templateKey) {
  return SMS_TEMPLATE_KEYS.has(templateKey);
}

function collapseSmsWhitespace(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Send SMS using Settings template (sms_body or email body fallback).
 * Does not throw — logs and returns summary for callers after email succeeds.
 */
export async function sendTemplateSms({ templateKey, branchId = null, variables = {}, phoneNumbers = [] }) {
  if (!isSmsTemplateKey(templateKey)) {
    return { skipped: true, reason: 'unsupported_template' };
  }

  if (!isSemaphoreConfigured()) {
    return { skipped: true, reason: 'semaphore_not_configured' };
  }

  const mobiles = collectPhilippineMobiles(phoneNumbers);
  if (mobiles.length === 0) {
    return { skipped: true, reason: 'no_phone_numbers' };
  }

  try {
    const tpl = await loadEffectiveTemplate(null, templateKey, branchId);
    if (!tpl.enabled) {
      return { skipped: true, reason: 'template_disabled' };
    }
    if (tpl.sms_enabled === false) {
      return { skipped: true, reason: 'sms_disabled_in_template' };
    }

    const source = tpl.sms_body?.trim() ? tpl.sms_body : tpl.body;
    const message = collapseSmsWhitespace(renderTemplateString(source, variables));
    if (!message) {
      return { skipped: true, reason: 'empty_message' };
    }

    return await sendSemaphoreSms({ numbers: mobiles, message });
  } catch (err) {
    await logTemplateRenderWarning(`sendTemplateSms ${templateKey}`, err);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Fire SMS after a successful email for the three guardian/student templates.
 */
export async function sendPairedTemplateSms({
  templateKey,
  branchId,
  variables,
  phoneNumbers,
  emailSkipped = false,
}) {
  if (emailSkipped) {
    return { skipped: true, reason: 'email_skipped' };
  }
  return sendTemplateSms({ templateKey, branchId, variables, phoneNumbers });
}
