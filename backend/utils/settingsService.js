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
  // Variables in {curlyBraces} are substituted by templateRenderService.js at send time.
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
      sms_enabled: true,
      sms_body:
        'LCA: Payment received {amountPaid} for {studentName} ({invoiceNumber}) on {paymentDate}. Thank you!',
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
      sms_enabled: true,
      sms_body:
        'LCA: Reminder - {invoiceNumber} for {studentName} is {daysOverdue} day(s) overdue. Amount due: {amountDue}. Due: {dueDate}.',
      enabled: true,
    },
  },
  template_monthly_invoice_notice: {
    key: 'template_monthly_invoice_notice',
    type: 'json',
    category: 'templates',
    description:
      'Email sent when a monthly installment invoice is auto-generated (issued on the 25th, due on the 5th of the next month).',
    defaultValue: {
      title: 'Monthly Invoice - {invoiceNumber}',
      subject: 'Monthly Invoice {invoiceNumber} - Due {dueDate}',
      body:
        'Hello {recipientName},\n\n' +
        'Your monthly tuition invoice for {studentName} has been generated for {billingPeriod}.\n\n' +
        'Invoice: {invoiceNumber}\n' +
        'Issue date: {issueDate}\n' +
        'Due date: {dueDate}\n' +
        'Amount due: {amountDue}\n\n' +
        'Payment is due on {dueDate}. If you have already made a payment for this billing period, please disregard this message.\n\n' +
        'Thank you,\n{schoolName}',
      sms_enabled: true,
      sms_body:
        'LCA: Invoice {invoiceNumber} for {studentName} ({billingPeriod}). Amount due {amountDue}, due {dueDate}. Ignore if already paid.',
      enabled: true,
    },
  },

  // --- Operational Alerts ---
  // Threshold (in PHP) above which a Branch Admin is shown an urgent
  // login-time alert reminding them to deposit pending Cash collections.
  // Counts only payment_method = 'Cash' that has not yet been included in
  // a Submitted/Approved cash deposit summary. Set to 0 to disable.
  cash_holding_alert_threshold_php: {
    key: 'cash_holding_alert_threshold_php',
    type: 'number',
    category: 'alerts',
    description:
      'Threshold (PHP) of pending uncovered Cash collections at which the Branch Admin sees an urgent login-time alert. Set to 0 to disable.',
    defaultValue: 100000,
    min: 0,
    max: 100000000,
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

