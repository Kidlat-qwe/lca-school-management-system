/**
 * System Settings Service
 *
 * Provides typed, validated access to system settings stored in `system_settingstbl`,
 * supporting per-branch overrides with global defaults (branch_id NULL).
 */

export const SETTINGS_DEFINITIONS = Object.freeze({
  installment_penalty_rate: {
    key: 'installment_penalty_rate',
    type: 'number',
    category: 'billing',
    description: 'Installment late payment penalty rate (decimal; 0.10 = 10%).',
    defaultValue: 0.1,
    min: 0,
    max: 1,
  },
  installment_penalty_grace_days: {
    key: 'installment_penalty_grace_days',
    type: 'int',
    category: 'billing',
    description:
      'Number of grace days after due_date before applying installment late penalty.',
    defaultValue: 0,
    min: 0,
    max: 365,
  },
  installment_final_dropoff_days: {
    key: 'installment_final_dropoff_days',
    type: 'int',
    category: 'billing',
    description:
      'Number of days after due_date before auto-removing student for installment delinquency.',
    defaultValue: 30,
    min: 0,
    max: 365,
  },

  // --- Installment Invoice Schedule ---
  installment_invoice_issue_date: {
    key: 'installment_invoice_issue_date',
    type: 'string',
    category: 'installment_schedule',
    description: 'Default invoice issue date for installment enrollments (YYYY-MM-DD).',
    defaultValue: '',
  },
  installment_billing_month: {
    key: 'installment_billing_month',
    type: 'string',
    category: 'installment_schedule',
    description: 'Default billing month for installment invoices (YYYY-MM).',
    defaultValue: '',
  },
  installment_invoice_due_date: {
    key: 'installment_invoice_due_date',
    type: 'string',
    category: 'installment_schedule',
    description: 'Default invoice due date for installment enrollments (YYYY-MM-DD).',
    defaultValue: '',
  },
  installment_invoice_generation_date: {
    key: 'installment_invoice_generation_date',
    type: 'string',
    category: 'installment_schedule',
    description: 'Default invoice auto-generation date for installment invoices (YYYY-MM-DD).',
    defaultValue: '',
  },
  installment_frequency_months: {
    key: 'installment_frequency_months',
    type: 'int',
    category: 'installment_schedule',
    description: 'How often (in months) installment invoices are generated. Fixed at 1.',
    defaultValue: 1,
    min: 1,
    max: 12,
  },

  // --- Templates (notification / email / EOD / cash deposit / payment / reminder) ---
  // Stored as JSON with a consistent shape:
  //   { title, subject, body, enabled }
  // Variables referenced in the body (e.g. {studentName}) are placeholders for a
  // future rendering phase; this phase only manages the stored content.
  template_general_notification: {
    key: 'template_general_notification',
    type: 'json',
    category: 'templates',
    description:
      'Generic in-app notification template used for system-wide announcements.',
    defaultValue: {
      title: 'System Notification',
      subject: '',
      body: 'Hello {recipientName}, this is a notification from {schoolName} ({branchName}).',
      enabled: true,
    },
  },
  template_general_email: {
    key: 'template_general_email',
    type: 'json',
    category: 'templates',
    description: 'Generic email template used for ad-hoc school-to-parent emails.',
    defaultValue: {
      title: '',
      subject: 'Update from {schoolName}',
      body: 'Hello {recipientName},\n\nThis is an update from {schoolName} ({branchName}) on {date}.\n\nThank you,\n{schoolName}',
      enabled: true,
    },
  },
  template_eod_summary: {
    key: 'template_eod_summary',
    type: 'json',
    category: 'templates',
    description: 'End-of-day summary email/notification template.',
    defaultValue: {
      title: 'End of Day - {summaryDate}',
      subject: '[PSMS] End of Day - {branchName} - {summaryDate}',
      body: 'EOD summary for {branchName} on {summaryDate}.\n\nTotal: {totalAmount}\nPayments: {paymentCount}\nSubmitted by: {submittedBy}',
      enabled: true,
    },
  },
  template_cash_deposit: {
    key: 'template_cash_deposit',
    type: 'json',
    category: 'templates',
    description: 'Cash deposit submission notification template (for Finance/Superadmin).',
    defaultValue: {
      title: 'Cash Deposit Submitted - {branchName}',
      subject: '',
      body: 'A cash deposit was submitted for {branchName} on {depositDate}.\nCash total: {cashTotal}\nSubmitted by: {submittedBy}',
      enabled: true,
    },
  },
  template_payment_confirmation: {
    key: 'template_payment_confirmation',
    type: 'json',
    category: 'templates',
    description: 'Payment confirmation email sent to the student/guardian after a payment is recorded.',
    defaultValue: {
      title: 'Payment Received',
      subject: 'Payment Received - {invoiceNumber}',
      body: 'Hello {recipientName},\n\nWe have received your payment of {amountPaid} for {studentName} (Invoice {invoiceNumber}) on {paymentDate}.\n\nThank you,\n{schoolName}',
      enabled: true,
    },
  },
  template_payment_reminder: {
    key: 'template_payment_reminder',
    type: 'json',
    category: 'templates',
    description: 'Overdue payment reminder template sent to the student/guardian.',
    defaultValue: {
      title: 'Payment Reminder - {invoiceNumber}',
      subject: 'Payment Reminder - {invoiceNumber}',
      body: 'Hello {recipientName},\n\nThis is a reminder that invoice {invoiceNumber} for {studentName} is {daysOverdue} day(s) past due.\nAmount due: {amountDue}\nDue date: {dueDate}\n\nThank you,\n{schoolName}',
      enabled: true,
    },
  },
});

export const SETTINGS_KEYS = Object.freeze(Object.keys(SETTINGS_DEFINITIONS));

export function getSettingDefinition(settingKey) {
  return SETTINGS_DEFINITIONS[settingKey] || null;
}

function parseByType(rawValue, type, fallbackValue) {
  if (rawValue === null || rawValue === undefined) return fallbackValue;

  if (type === 'int') {
    const n = Number.parseInt(String(rawValue), 10);
    return Number.isFinite(n) ? n : fallbackValue;
  }

  if (type === 'number') {
    const n = Number.parseFloat(String(rawValue));
    return Number.isFinite(n) ? n : fallbackValue;
  }

  if (type === 'boolean') {
    const v = String(rawValue).toLowerCase().trim();
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
    return fallbackValue;
  }

  if (type === 'json') {
    if (rawValue && typeof rawValue === 'object') return rawValue;
    try {
      return JSON.parse(String(rawValue));
    } catch {
      return fallbackValue;
    }
  }

  return String(rawValue);
}

export function validateAndNormalizeSettingInput(settingKey, inputValue) {
  const def = getSettingDefinition(settingKey);
  if (!def) {
    return { ok: false, error: `Unknown setting key: ${settingKey}` };
  }

  const parsed = parseByType(inputValue, def.type, def.defaultValue);

  // For numeric types, ensure finite
  if ((def.type === 'int' || def.type === 'number') && !Number.isFinite(parsed)) {
    return { ok: false, error: `${settingKey} must be a valid ${def.type}` };
  }

  // For int, enforce integer
  if (def.type === 'int' && !Number.isInteger(parsed)) {
    return { ok: false, error: `${settingKey} must be an integer` };
  }

  // Range checks (applies to number/int)
  if ((def.type === 'int' || def.type === 'number') && def.min !== undefined) {
    if (parsed < def.min) {
      return { ok: false, error: `${settingKey} must be >= ${def.min}` };
    }
  }
  if ((def.type === 'int' || def.type === 'number') && def.max !== undefined) {
    if (parsed > def.max) {
      return { ok: false, error: `${settingKey} must be <= ${def.max}` };
    }
  }

  // Normalize to string for storage
  const storedValue =
    def.type === 'json' ? JSON.stringify(parsed) : def.type === 'boolean' ? (parsed ? 'true' : 'false') : String(parsed);

  return {
    ok: true,
    key: settingKey,
    value: parsed,
    storedValue,
    type: def.type,
    category: def.category || null,
    description: def.description || null,
  };
}

/**
 * Fetch effective settings for a branch:
 * - branch override (branch_id = X)
 * - else global default (branch_id IS NULL)
 * - else code default (SETTINGS_DEFINITIONS.defaultValue)
 *
 * @param {import('pg').PoolClient} client
 * @param {string[]} keys
 * @param {number|null|undefined} branchId
 */
export async function getEffectiveSettings(client, keys, branchId) {
  const safeKeys = (keys || []).filter((k) => typeof k === 'string' && k.length > 0);
  const result = {};

  if (safeKeys.length === 0) return result;

  const globalRowsRes = await client.query(
    `SELECT setting_key, setting_value, setting_type, category, description, branch_id
     FROM system_settingstbl
     WHERE branch_id IS NULL AND setting_key = ANY($1::text[])`,
    [safeKeys]
  );
  const globalByKey = new Map();
  for (const row of globalRowsRes.rows) {
    globalByKey.set(row.setting_key, row);
  }

  let branchByKey = new Map();
  if (branchId !== null && branchId !== undefined) {
    const branchRowsRes = await client.query(
      `SELECT setting_key, setting_value, setting_type, category, description, branch_id
       FROM system_settingstbl
       WHERE branch_id = $1 AND setting_key = ANY($2::text[])`,
      [branchId, safeKeys]
    );
    branchByKey = new Map(branchRowsRes.rows.map((r) => [r.setting_key, r]));
  }

  for (const key of safeKeys) {
    const def = getSettingDefinition(key);
    const fallbackType = def?.type || 'string';
    const fallbackValue = def?.defaultValue ?? null;

    const branchRow = branchByKey.get(key) || null;
    const globalRow = globalByKey.get(key) || null;

    const chosenRow = branchRow || globalRow;
    const scope = branchRow ? 'branch' : globalRow ? 'global' : 'default';
    const rawValue = chosenRow?.setting_value ?? null;
    const type = chosenRow?.setting_type || fallbackType;

    result[key] = {
      key,
      value: parseByType(rawValue, type, fallbackValue),
      scope,
      type,
      category: chosenRow?.category ?? def?.category ?? null,
      description: chosenRow?.description ?? def?.description ?? null,
    };
  }

  return result;
}

