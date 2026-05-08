import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../config/api';

const TABS = [
  { id: 'billing', label: 'Billing & Penalties' },
  { id: 'schedule', label: 'Invoice Schedule' },
  { id: 'templates', label: 'Templates' },
];

// Template metadata for the Templates tab. The keys mirror the backend
// SETTINGS_DEFINITIONS for category 'templates'. Each value stored on the
// server has the shape { title, subject, body, enabled }.
const TEMPLATE_DEFS = [
  {
    key: 'template_general_notification',
    label: 'General Notification',
    description: 'In-app notification template for system-wide announcements.',
    showSubject: false,
    variables: ['{recipientName}', '{schoolName}', '{branchName}', '{date}'],
  },
  {
    key: 'template_general_email',
    label: 'General Email',
    description: 'Generic email template for ad-hoc school-to-parent emails.',
    showSubject: true,
    variables: ['{recipientName}', '{schoolName}', '{branchName}', '{date}'],
  },
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
    description: 'Email sent to the student/guardian after a payment is recorded.',
    showSubject: true,
    variables: ['{recipientName}', '{studentName}', '{invoiceNumber}', '{amountPaid}', '{paymentDate}', '{schoolName}'],
  },
  {
    key: 'template_payment_reminder',
    label: 'Payment Reminder',
    description: 'Overdue payment reminder sent to the student/guardian.',
    showSubject: true,
    variables: ['{recipientName}', '{studentName}', '{invoiceNumber}', '{dueDate}', '{amountDue}', '{daysOverdue}', '{schoolName}'],
  },
];

const TEMPLATE_KEYS = TEMPLATE_DEFS.map((t) => t.key);

const emptyTemplate = () => ({ title: '', subject: '', body: '', enabled: true });

const normalizeTemplateValue = (raw) => {
  const base = emptyTemplate();
  if (!raw || typeof raw !== 'object') return base;
  return {
    title: typeof raw.title === 'string' ? raw.title : base.title,
    subject: typeof raw.subject === 'string' ? raw.subject : base.subject,
    body: typeof raw.body === 'string' ? raw.body : base.body,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : base.enabled,
  };
};

const buildEmptyTemplatesState = () =>
  TEMPLATE_KEYS.reduce((acc, key) => {
    acc[key] = emptyTemplate();
    return acc;
  }, {});

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const currentMonthStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const generationDateDefault = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-25`;
};

const dueDateDefault = () => {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const AdminSettings = () => {
  const [activeTab, setActiveTab] = useState('billing');
  const [branchId, setBranchId] = useState(null);

  // ── Billing & Penalties tab ───────────────────────────────────────────────
  const [billingLoading, setBillingLoading] = useState(true);
  const [billingSaving, setBillingSaving] = useState(false);
  const [billingError, setBillingError] = useState('');
  const [billingSuccess, setBillingSuccess] = useState('');
  const [billingEffective, setBillingEffective] = useState(null);
  const [penaltyRatePercent, setPenaltyRatePercent] = useState('10');
  const [graceDays, setGraceDays] = useState('0');
  const [finalDropoffDays, setFinalDropoffDays] = useState('30');

  // ── Invoice Schedule tab ──────────────────────────────────────────────────
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleError, setScheduleError] = useState('');
  const [scheduleSuccess, setScheduleSuccess] = useState('');
  const [scheduleEffective, setScheduleEffective] = useState(null);
  const [invoiceIssueDate, setInvoiceIssueDate] = useState('');
  const [billingMonth, setBillingMonth] = useState('');
  const [invoiceDueDate, setInvoiceDueDate] = useState('');
  const [invoiceGenerationDate, setInvoiceGenerationDate] = useState('');

  // ── Templates tab ─────────────────────────────────────────────────────────
  const [templateLoading, setTemplateLoading] = useState(true);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateError, setTemplateError] = useState('');
  const [templateSuccess, setTemplateSuccess] = useState('');
  const [templateEffective, setTemplateEffective] = useState(null);
  const [templates, setTemplates] = useState(buildEmptyTemplatesState);

  // ── Fetch billing settings ────────────────────────────────────────────────
  const fetchBillingSettings = async () => {
    setBillingLoading(true);
    setBillingError('');
    setBillingSuccess('');
    try {
      const params = new URLSearchParams({ category: 'billing' });
      const res = await apiRequest(`/settings/effective?${params}`, { method: 'GET' });
      setBranchId(res?.data?.branch_id ?? null);
      const settings = res?.data?.settings || {};
      setBillingEffective(settings);

      const rateDecimal = Number(settings?.installment_penalty_rate?.value);
      setPenaltyRatePercent(Number.isFinite(rateDecimal) ? (rateDecimal * 100).toFixed(0) : '10');

      const g = Number(settings?.installment_penalty_grace_days?.value);
      setGraceDays(Number.isFinite(g) ? String(g) : '0');

      const d = Number(settings?.installment_final_dropoff_days?.value);
      setFinalDropoffDays(Number.isFinite(d) ? String(d) : '30');
    } catch (e) {
      setBillingError(e?.message || 'Failed to load billing settings');
    } finally {
      setBillingLoading(false);
    }
  };

  // ── Fetch schedule settings ───────────────────────────────────────────────
  const fetchScheduleSettings = async () => {
    setScheduleLoading(true);
    setScheduleError('');
    setScheduleSuccess('');
    try {
      const params = new URLSearchParams({ category: 'installment_schedule' });
      const res = await apiRequest(`/settings/effective?${params}`, { method: 'GET' });
      const settings = res?.data?.settings || {};
      setScheduleEffective(settings);

      const issueDate = settings?.installment_invoice_issue_date?.value;
      setInvoiceIssueDate(issueDate || todayStr());

      const bMonth = settings?.installment_billing_month?.value;
      setBillingMonth(bMonth || currentMonthStr());

      const dueDate = settings?.installment_invoice_due_date?.value;
      setInvoiceDueDate(dueDate || dueDateDefault());

      const genDate = settings?.installment_invoice_generation_date?.value;
      setInvoiceGenerationDate(genDate || generationDateDefault());
    } catch (e) {
      setScheduleError(e?.message || 'Failed to load schedule settings');
    } finally {
      setScheduleLoading(false);
    }
  };

  // ── Fetch template settings ───────────────────────────────────────────────
  const fetchTemplateSettings = async () => {
    setTemplateLoading(true);
    setTemplateError('');
    setTemplateSuccess('');
    try {
      const params = new URLSearchParams({ category: 'templates' });
      const res = await apiRequest(`/settings/effective?${params}`, { method: 'GET' });
      const settings = res?.data?.settings || {};
      setTemplateEffective(settings);

      const next = buildEmptyTemplatesState();
      for (const key of TEMPLATE_KEYS) {
        next[key] = normalizeTemplateValue(settings?.[key]?.value);
      }
      setTemplates(next);
    } catch (e) {
      setTemplateError(e?.message || 'Failed to load templates');
    } finally {
      setTemplateLoading(false);
    }
  };

  // ── Derived scope meta ────────────────────────────────────────────────────
  const billingScopeMeta = useMemo(() => {
    const meta = {};
    for (const [k, v] of Object.entries(billingEffective || {})) meta[k] = v?.scope || 'default';
    return meta;
  }, [billingEffective]);

  const scheduleScopeMeta = useMemo(() => {
    const meta = {};
    for (const [k, v] of Object.entries(scheduleEffective || {})) meta[k] = v?.scope || 'default';
    return meta;
  }, [scheduleEffective]);

  const templateScopeMeta = useMemo(() => {
    const meta = {};
    for (const [k, v] of Object.entries(templateEffective || {})) meta[k] = v?.scope || 'default';
    return meta;
  }, [templateEffective]);

  const updateTemplateField = (key, field, value) => {
    setTemplates((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || emptyTemplate()), [field]: value },
    }));
  };

  useEffect(() => {
    fetchBillingSettings();
    fetchScheduleSettings();
    fetchTemplateSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Save billing settings ─────────────────────────────────────────────────
  const onSaveBilling = async () => {
    setBillingSaving(true);
    setBillingError('');
    setBillingSuccess('');
    try {
      const ratePct = Number(penaltyRatePercent);
      if (!Number.isFinite(ratePct) || ratePct < 0 || ratePct > 100)
        throw new Error('Penalty rate (%) must be between 0 and 100');
      const rateDecimal = ratePct / 100;

      const grace = Number.parseInt(graceDays, 10);
      if (!Number.isFinite(grace) || grace < 0 || grace > 365)
        throw new Error('Grace period (days) must be between 0 and 365');

      const drop = Number.parseInt(finalDropoffDays, 10);
      if (!Number.isFinite(drop) || drop < 0 || drop > 365)
        throw new Error('Final drop-off (days) must be between 0 and 365');

      await apiRequest('/settings/batch', {
        method: 'PUT',
        body: {
          scope: 'branch',
          settings: {
            installment_penalty_rate: rateDecimal,
            installment_penalty_grace_days: grace,
            installment_final_dropoff_days: drop,
          },
        },
      });

      setBillingSuccess('Billing settings saved successfully.');
      await fetchBillingSettings();
    } catch (e) {
      setBillingError(e?.message || 'Failed to save billing settings');
    } finally {
      setBillingSaving(false);
    }
  };

  // ── Save schedule settings ────────────────────────────────────────────────
  const onSaveSchedule = async () => {
    setScheduleSaving(true);
    setScheduleError('');
    setScheduleSuccess('');
    try {
      if (!invoiceIssueDate) throw new Error('Invoice Issue Date is required');
      if (!billingMonth) throw new Error('Billing Month is required');
      if (!invoiceDueDate) throw new Error('Invoice Due Date is required');
      if (!invoiceGenerationDate) throw new Error('Invoice Generation Date is required');

      await apiRequest('/settings/batch', {
        method: 'PUT',
        body: {
          scope: 'branch',
          settings: {
            installment_invoice_issue_date: invoiceIssueDate,
            installment_billing_month: billingMonth,
            installment_invoice_due_date: invoiceDueDate,
            installment_invoice_generation_date: invoiceGenerationDate,
            installment_frequency_months: 1,
          },
        },
      });

      setScheduleSuccess('Invoice schedule settings saved successfully.');
      await fetchScheduleSettings();
    } catch (e) {
      setScheduleError(e?.message || 'Failed to save invoice schedule settings');
    } finally {
      setScheduleSaving(false);
    }
  };

  // ── Save template settings ────────────────────────────────────────────────
  const onSaveTemplates = async () => {
    setTemplateSaving(true);
    setTemplateError('');
    setTemplateSuccess('');
    try {
      const settingsPayload = {};
      for (const key of TEMPLATE_KEYS) {
        settingsPayload[key] = normalizeTemplateValue(templates[key]);
      }

      await apiRequest('/settings/batch', {
        method: 'PUT',
        body: {
          scope: 'branch',
          settings: settingsPayload,
        },
      });

      setTemplateSuccess('Templates saved successfully.');
      await fetchTemplateSettings();
    } catch (e) {
      setTemplateError(e?.message || 'Failed to save templates');
    } finally {
      setTemplateSaving(false);
    }
  };

  // ── Helper ────────────────────────────────────────────────────────────────
  const ScopeTag = ({ scopeVal }) => {
    const color =
      scopeVal === 'branch'
        ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
        : scopeVal === 'global'
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : 'bg-gray-50 text-gray-500 border-gray-200';
    return (
      <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${color}`}>
        {scopeVal || 'default'}
      </span>
    );
  };

  return (
    <div className="p-3 sm:p-4">
      <div className="space-y-4">

        {/* ── Header card ── */}
        <div className="rounded-2xl bg-white px-5 py-4 shadow-sm ring-1 ring-gray-100">
          <h1 className="text-xl font-semibold text-gray-900">Settings</h1>
          <p className="mt-1 text-sm text-gray-600">
            Branch settings{branchId ? ` (Branch ID: ${branchId})` : ''}. Configure billing
            penalties and installment invoice schedule.
          </p>
        </div>

        {/* ── Tab card ── */}
        <div className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 overflow-hidden">
          <div className="border-b border-gray-200 px-4 sm:px-5">
            <nav className="-mb-px flex gap-0" aria-label="Settings tabs">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors duration-150 focus:outline-none whitespace-nowrap ${
                    activeTab === tab.id
                      ? 'border-[#F7C844] text-gray-900'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          <div className="p-4 sm:p-5">

            {/* ── Tab 1: Billing & Penalties ── */}
            {activeTab === 'billing' && (
              <div>
                <div className="mb-4">
                  <h2 className="text-base font-semibold text-gray-900">Billing &amp; Penalties</h2>
                  <p className="mt-1 text-sm text-gray-500">
                    Control late penalties and auto-removals for installment invoices.
                  </p>
                </div>

                {billingError && (
                  <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    {billingError}
                  </div>
                )}
                {billingSuccess && (
                  <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
                    {billingSuccess}
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Penalty rate (%)
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="100"
                      step="1"
                      value={penaltyRatePercent}
                      onChange={(e) => setPenaltyRatePercent(e.target.value)}
                      disabled={billingLoading || billingSaving}
                      className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#F7C844] focus:outline-none focus:ring-2 focus:ring-[#F7C844]/30 disabled:cursor-not-allowed disabled:bg-gray-100"
                    />
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
                      Source: <ScopeTag scopeVal={billingScopeMeta.installment_penalty_rate} />
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Grace period (days)
                    </label>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max="365"
                      step="1"
                      value={graceDays}
                      onChange={(e) => setGraceDays(e.target.value)}
                      disabled={billingLoading || billingSaving}
                      className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#F7C844] focus:outline-none focus:ring-2 focus:ring-[#F7C844]/30 disabled:cursor-not-allowed disabled:bg-gray-100"
                    />
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
                      Source: <ScopeTag scopeVal={billingScopeMeta.installment_penalty_grace_days} />
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Final drop-off (days)
                    </label>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max="365"
                      step="1"
                      value={finalDropoffDays}
                      onChange={(e) => setFinalDropoffDays(e.target.value)}
                      disabled={billingLoading || billingSaving}
                      className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#F7C844] focus:outline-none focus:ring-2 focus:ring-[#F7C844]/30 disabled:cursor-not-allowed disabled:bg-gray-100"
                    />
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
                      Source: <ScopeTag scopeVal={billingScopeMeta.installment_final_dropoff_days} />
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-gray-500">
                    Note: Penalty rate is stored as a decimal in the system (e.g., 10% = 0.10).
                  </p>
                  <button
                    type="button"
                    onClick={onSaveBilling}
                    disabled={billingLoading || billingSaving}
                    className="inline-flex w-full items-center justify-center rounded-lg bg-[#F7C844] px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm transition-colors hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                  >
                    {billingSaving ? 'Saving…' : 'Save settings'}
                  </button>
                </div>
              </div>
            )}

            {/* ── Tab 2: Invoice Schedule ── */}
            {activeTab === 'schedule' && (
              <div>
                <div className="mb-4">
                  <h2 className="text-base font-semibold text-gray-900">Invoice Schedule</h2>
                  <p className="mt-1 text-sm text-gray-500">
                    Set the default invoice dates used across all installment enrollments. Update
                    these at the start of each billing cycle.
                  </p>
                </div>

                {scheduleError && (
                  <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    {scheduleError}
                  </div>
                )}
                {scheduleSuccess && (
                  <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
                    {scheduleSuccess}
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Invoice Issue Date <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      value={invoiceIssueDate}
                      onChange={(e) => setInvoiceIssueDate(e.target.value)}
                      disabled={scheduleLoading || scheduleSaving}
                      className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#F7C844] focus:outline-none focus:ring-2 focus:ring-[#F7C844]/30 disabled:cursor-not-allowed disabled:bg-gray-100"
                    />
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
                      Source: <ScopeTag scopeVal={scheduleScopeMeta.installment_invoice_issue_date} />
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Billing Month <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="month"
                      value={billingMonth}
                      onChange={(e) => setBillingMonth(e.target.value)}
                      disabled={scheduleLoading || scheduleSaving}
                      className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#F7C844] focus:outline-none focus:ring-2 focus:ring-[#F7C844]/30 disabled:cursor-not-allowed disabled:bg-gray-100"
                    />
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
                      Source: <ScopeTag scopeVal={scheduleScopeMeta.installment_billing_month} />
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Invoice Due Date <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      value={invoiceDueDate}
                      onChange={(e) => setInvoiceDueDate(e.target.value)}
                      disabled={scheduleLoading || scheduleSaving}
                      className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#F7C844] focus:outline-none focus:ring-2 focus:ring-[#F7C844]/30 disabled:cursor-not-allowed disabled:bg-gray-100"
                    />
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
                      Source: <ScopeTag scopeVal={scheduleScopeMeta.installment_invoice_due_date} />
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Invoice Generation Date <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      value={invoiceGenerationDate}
                      onChange={(e) => setInvoiceGenerationDate(e.target.value)}
                      disabled={scheduleLoading || scheduleSaving}
                      className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#F7C844] focus:outline-none focus:ring-2 focus:ring-[#F7C844]/30 disabled:cursor-not-allowed disabled:bg-gray-100"
                    />
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
                      Source:{' '}
                      <ScopeTag scopeVal={scheduleScopeMeta.installment_invoice_generation_date} />
                    </p>
                  </div>
                </div>

                <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-2.5">
                  <p className="text-sm text-blue-800">
                    Invoice will be generated every{' '}
                    <span className="font-semibold">1&nbsp;Month(s)</span>. Frequency is fixed
                    system-wide.
                  </p>
                </div>

                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-gray-500">
                    Update these dates at the start of each new billing cycle.
                  </p>
                  <button
                    type="button"
                    onClick={onSaveSchedule}
                    disabled={scheduleLoading || scheduleSaving}
                    className="inline-flex w-full items-center justify-center rounded-lg bg-[#F7C844] px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm transition-colors hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                  >
                    {scheduleSaving ? 'Saving…' : 'Save schedule'}
                  </button>
                </div>
              </div>
            )}

            {/* ── Tab 3: Templates ── */}
            {activeTab === 'templates' && (
              <div>
                <div className="mb-4">
                  <h2 className="text-base font-semibold text-gray-900">Templates</h2>
                  <p className="mt-1 text-sm text-gray-500">
                    Configure branch-level overrides for notification, email, EOD, cash deposit,
                    payment, and reminder templates. Variables in curly braces (e.g.{' '}
                    <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">{'{studentName}'}</code>)
                    will be replaced when these templates are wired to outgoing messages.
                  </p>
                </div>

                {templateError && (
                  <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    {templateError}
                  </div>
                )}
                {templateSuccess && (
                  <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
                    {templateSuccess}
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {TEMPLATE_DEFS.map((def) => {
                    const tpl = templates[def.key] || emptyTemplate();
                    const disabled = templateLoading || templateSaving;
                    return (
                      <div
                        key={def.key}
                        className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-semibold text-gray-900">{def.label}</h3>
                            <p className="mt-0.5 text-xs text-gray-500">{def.description}</p>
                          </div>
                          <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 text-xs text-gray-700">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-gray-300 text-[#F7C844] focus:ring-[#F7C844]/40"
                              checked={!!tpl.enabled}
                              onChange={(e) => updateTemplateField(def.key, 'enabled', e.target.checked)}
                              disabled={disabled}
                            />
                            Enabled
                          </label>
                        </div>

                        <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
                          Source: <ScopeTag scopeVal={templateScopeMeta[def.key]} />
                        </p>

                        <div className="mt-3 space-y-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-700">Title</label>
                            <input
                              type="text"
                              value={tpl.title}
                              onChange={(e) => updateTemplateField(def.key, 'title', e.target.value)}
                              disabled={disabled}
                              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#F7C844] focus:outline-none focus:ring-2 focus:ring-[#F7C844]/30 disabled:cursor-not-allowed disabled:bg-gray-100"
                            />
                          </div>

                          {def.showSubject && (
                            <div>
                              <label className="block text-xs font-medium text-gray-700">Subject</label>
                              <input
                                type="text"
                                value={tpl.subject}
                                onChange={(e) => updateTemplateField(def.key, 'subject', e.target.value)}
                                disabled={disabled}
                                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#F7C844] focus:outline-none focus:ring-2 focus:ring-[#F7C844]/30 disabled:cursor-not-allowed disabled:bg-gray-100"
                              />
                            </div>
                          )}

                          <div>
                            <label className="block text-xs font-medium text-gray-700">Body</label>
                            <textarea
                              rows={5}
                              value={tpl.body}
                              onChange={(e) => updateTemplateField(def.key, 'body', e.target.value)}
                              disabled={disabled}
                              className="mt-1 w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm leading-relaxed focus:border-[#F7C844] focus:outline-none focus:ring-2 focus:ring-[#F7C844]/30 disabled:cursor-not-allowed disabled:bg-gray-100"
                            />
                          </div>

                          {def.variables.length > 0 && (
                            <div>
                              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                                Available variables
                              </p>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {def.variables.map((v) => (
                                  <code
                                    key={v}
                                    className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-700"
                                  >
                                    {v}
                                  </code>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-gray-500">
                    Note: Templates are stored now and will be applied by outgoing messages in
                    a follow-up wiring step.
                  </p>
                  <button
                    type="button"
                    onClick={onSaveTemplates}
                    disabled={templateLoading || templateSaving}
                    className="inline-flex w-full items-center justify-center rounded-lg bg-[#F7C844] px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm transition-colors hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                  >
                    {templateSaving ? 'Saving…' : 'Save templates'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminSettings;
