/**
 * Optional email dispatch toggle for announcement create forms.
 * Email is only sent when status is Active and this toggle is on (create only).
 */
export default function AnnouncementSendEmailToggle({
  checked,
  onChange,
  disabled = false,
  status = 'Active',
  showEditHint = false,
  compact = false,
  variant = 'default',
}) {
  const emailWillSend = checked && status === 'Active' && !disabled;

  const hint = showEditHint
    ? 'Email is only sent when a new announcement is created with Active status.'
    : emailWillSend
      ? 'Recipients in the selected groups will receive an email.'
      : checked && status !== 'Active'
        ? 'Email is sent only when status is Active.'
        : 'Announcement will appear on the board only; no email will be sent.';

  if (variant === 'card') {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-3 shadow-sm">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-500 text-white">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900">Email notification</p>
          <p className="mt-0.5 text-xs text-gray-500">{hint}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label="Email notification"
          disabled={disabled || showEditHint}
          onClick={() => onChange(!checked)}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
            checked ? 'bg-primary-500' : 'bg-gray-300'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              checked ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border border-gray-200 bg-gray-50 ${
        compact ? 'px-3 py-2.5' : 'px-4 py-3'
      }`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900">Send email notification</p>
          <p className="mt-0.5 text-xs text-gray-500">{hint}</p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label="Send email notification"
          disabled={disabled || showEditHint}
          onClick={() => onChange(!checked)}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
            checked ? 'bg-primary-600' : 'bg-gray-300'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              checked ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
    </div>
  );
}
