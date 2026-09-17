/**
 * Template metadata for Settings → Templates.
 * Keys mirror backend SETTINGS_DEFINITIONS (category: templates).
 */

export const TEMPLATE_DEFS = [
  {
    key: 'template_eod_summary',
    label: 'End of Day Summary',
    description: 'Sent to stakeholders after a branch submits its EOD summary.',
    showSubject: true,
    variables: ['{summaryDate}', '{totalAmount}', '{paymentCount}', '{submittedBy}', '{branchName}'],
  },
  {
    key: 'template_cash_deposit',
    label: 'Cash Deposit Submission',
    description: 'In-app/email notification when a cash deposit is submitted.',
    showSubject: true,
    variables: ['{depositDate}', '{cashTotal}', '{branchName}', '{submittedBy}'],
  },
  {
    key: 'template_payment_confirmation',
    label: 'Payment Confirmation',
    description: 'Email and SMS sent to the student/guardian after a payment is recorded.',
    showSubject: true,
    supportsSms: true,
    variables: [
      '{recipientName}',
      '{studentName}',
      '{invoiceNumber}',
      '{amountPaid}',
      '{paymentDate}',
      '{schoolName}',
    ],
  },
  {
    key: 'template_payment_reminder',
    label: 'Payment Reminder',
    description: 'Overdue payment reminder email and SMS sent to the student/guardian.',
    showSubject: true,
    supportsSms: true,
    variables: [
      '{recipientName}',
      '{studentName}',
      '{invoiceNumber}',
      '{dueDate}',
      '{amountDue}',
      '{daysOverdue}',
      '{schoolName}',
    ],
  },
  {
    key: 'template_monthly_invoice_notice',
    label: 'Monthly Invoice Notice',
    description:
      'Email and SMS when a monthly installment invoice is auto-generated (issued on the 25th, due on the 5th of the next month).',
    showSubject: true,
    supportsSms: true,
    variables: [
      '{recipientName}',
      '{studentName}',
      '{invoiceNumber}',
      '{issueDate}',
      '{dueDate}',
      '{amountDue}',
      '{billingPeriod}',
      '{schoolName}',
      '{branchName}',
    ],
  },
  {
    key: 'template_first_enrollment_onboarding',
    label: 'New enrollee welcome (combined)',
    group: 'First enrollment onboarding',
    description:
      'Single email sent when a student is first enrolled: welcome, class schedule, things to prepare, important reminders, and stay connected. Optional AR PDF is attached by the system.',
    showSubject: true,
    branchScopedVariables: ['{groupChatUrl}', '{groupChatLine}', '{groupChatLabel}'],
    variables: [
      '{academicYear}',
      '{arAttachmentNote}',
      '{classStartDate}',
      '{classSchedule}',
      '{branchName}',
      '{facebookUrl}',
      '{groupChatLine}',
      '{groupChatLabel}',
      '{groupChatUrl}',
    ],
  },
];

export const TEMPLATE_KEYS = TEMPLATE_DEFS.map((t) => t.key);

export const emptyTemplate = () => ({
  title: '',
  subject: '',
  body: '',
  enabled: true,
  sms_enabled: false,
  sms_body: '',
});

export const normalizeTemplateValue = (raw) => {
  const base = emptyTemplate();
  if (!raw || typeof raw !== 'object') return base;
  return {
    title: typeof raw.title === 'string' ? raw.title : base.title,
    subject: typeof raw.subject === 'string' ? raw.subject : base.subject,
    body: typeof raw.body === 'string' ? raw.body : base.body,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : base.enabled,
    sms_enabled: typeof raw.sms_enabled === 'boolean' ? raw.sms_enabled : base.sms_enabled,
    sms_body: typeof raw.sms_body === 'string' ? raw.sms_body : base.sms_body,
  };
};

export const buildEmptyTemplatesState = () =>
  TEMPLATE_KEYS.reduce((acc, key) => {
    acc[key] = emptyTemplate();
    return acc;
  }, {});

export const getTemplateDefByKey = (key) =>
  TEMPLATE_DEFS.find((def) => def.key === key) || TEMPLATE_DEFS[0];

/** Unique group labels for Settings template picker (optgroups). */
export const TEMPLATE_GROUP_LABELS = [
  ...new Set(TEMPLATE_DEFS.map((def) => def.group).filter(Boolean)),
];

export const TEMPLATE_DEFS_WITHOUT_GROUP = TEMPLATE_DEFS.filter((def) => !def.group);

export const getTemplateDefsForGroup = (groupLabel) =>
  TEMPLATE_DEFS.filter((def) => def.group === groupLabel);
