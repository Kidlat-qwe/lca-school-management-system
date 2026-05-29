/**
 * Loads Settings → Templates and substitutes {variable} placeholders for
 * outgoing emails and in-app notifications.
 */
import { getClient, query as poolQuery } from '../config/database.js';
import { getEffectiveSettings, getSettingDefinition } from './settingsService.js';

export const DEFAULT_SCHOOL_NAME = 'Little Champions Academy, Inc.';
const MANILA_TZ = 'Asia/Manila';

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Replace {variableName} tokens. Unknown keys are left unchanged.
 */
export function renderTemplateString(template, variables = {}) {
  if (template == null) return '';
  return String(template).replace(/\{(\w+)\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(variables, key)) return match;
    const val = variables[key];
    if (val === undefined || val === null) return '';
    return String(val);
  });
}

export function formatPhp(amount) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(
    Number(amount) || 0
  );
}

export function formatDateDisplay(value) {
  if (!value) return 'N/A';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return [
    String(d.getUTCDate()).padStart(2, '0'),
    String(d.getUTCMonth() + 1).padStart(2, '0'),
    d.getUTCFullYear(),
  ].join('/');
}

export function formatDateYmd(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export function todayManilaYmd() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MANILA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function computeDaysOverdue(dueDate, referenceDate = new Date()) {
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return 0;
  const ref = new Date(referenceDate);
  const dueUtc = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const refUtc = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate());
  const diff = Math.floor((refUtc - dueUtc) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 0;
}

export function wrapBrandedEmailHtml(innerHtml, { includeFooter = true } = {}) {
  const footer = includeFooter
    ? `<div style="background-color:#f5f5f5;padding:20px;text-align:center;border-radius:0 0 5px 5px;font-size:12px;color:#666;">
         <p style="margin:0;">This is an automated email. Please do not reply to this message.</p>
         <p style="margin:8px 0 0;">© ${new Date().getFullYear()} ${escapeHtml(DEFAULT_SCHOOL_NAME)} All rights reserved.</p>
       </div>`
    : '';

  return `<!DOCTYPE html>
<html>
  <head><meta charset="UTF-8"></head>
  <body style="font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;">
    <div style="background-color:#F7C844;padding:20px;text-align:center;border-radius:5px 5px 0 0;">
      <h1 style="color:#000;margin:0;font-size:20px;">LITTLE CHAMPIONS ACADEMY INC.</h1>
    </div>
    <div style="background-color:#ffffff;padding:30px;border:1px solid #e0e0e0;border-top:none;">
      ${innerHtml}
    </div>
    ${footer}
  </body>
</html>`;
}

export function plainTextToEmailHtml(plainText) {
  const chunks = String(plainText || '').split(/\n\n+/);
  const inner = chunks
    .map(
      (chunk) =>
        `<p style="margin:0 0 16px;color:#111827;line-height:1.6;">${escapeHtml(chunk).replace(/\n/g, '<br/>')}</p>`
    )
    .join('');
  return wrapBrandedEmailHtml(inner);
}

function normalizeTemplateShape(raw) {
  const base = { title: '', subject: '', body: '', enabled: true, sms_enabled: false, sms_body: '' };
  if (!raw || typeof raw !== 'object') return base;
  return {
    title: typeof raw.title === 'string' ? raw.title : base.title,
    subject: typeof raw.subject === 'string' ? raw.subject : base.subject,
    body: typeof raw.body === 'string' ? raw.body : base.body,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : base.enabled,
    sms_enabled: typeof raw.sms_enabled === 'boolean' ? raw.sms_enabled : base.sms_enabled,
    sms_body: typeof raw.sms_body === 'string' ? raw.sms_body : base.sms_body,
  };
}

export async function loadEffectiveTemplate(client, templateKey, branchId = null) {
  const dbClient = client || (await getClient());
  const shouldRelease = !client;

  try {
    const settings = await getEffectiveSettings(dbClient, [templateKey], branchId ?? null);
    const entry = settings[templateKey];
    const def = getSettingDefinition(templateKey);
    const raw = entry?.value ?? def?.defaultValue ?? null;
    const normalized = normalizeTemplateShape(raw);
    const defNormalized = normalizeTemplateShape(def?.defaultValue);

    return {
      ...normalized,
      sms_enabled:
        typeof raw?.sms_enabled === 'boolean' ? raw.sms_enabled : defNormalized.sms_enabled,
      sms_body:
        typeof raw?.sms_body === 'string' && raw.sms_body.trim() !== ''
          ? raw.sms_body
          : defNormalized.sms_body,
      scope: entry?.scope || 'default',
    };
  } finally {
    if (shouldRelease) dbClient.release();
  }
}

/**
 * @returns {Promise<{ enabled: boolean, title: string, subject: string, body: string, bodyHtml: string, scope?: string }|null>}
 */
export async function renderMessagingTemplate({
  client = null,
  templateKey,
  branchId = null,
  variables = {},
}) {
  const tpl = await loadEffectiveTemplate(client, templateKey, branchId);
  if (!tpl.enabled) {
    return { enabled: false, title: '', subject: '', body: '', bodyHtml: '' };
  }

  const title = renderTemplateString(tpl.title, variables);
  const subject = renderTemplateString(tpl.subject, variables);
  const body = renderTemplateString(tpl.body, variables);

  return {
    enabled: true,
    title,
    subject,
    body,
    bodyHtml: plainTextToEmailHtml(body),
    scope: tpl.scope,
  };
}

export async function logTemplateRenderWarning(context, error) {
  console.warn(`[templateRenderService] ${context}:`, error?.message || error);
}

export { poolQuery };
