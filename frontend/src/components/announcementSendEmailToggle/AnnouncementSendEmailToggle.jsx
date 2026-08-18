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
}) {
  const emailWillSend = checked && status === 'Active' && !disabled;

  return (
    <div
      className={`rounded-lg border border-gray-200 bg-gray-50 ${
        compact ? 'px-3 py-2.5' : 'px-4 py-3'
      }`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900">Send email notification</p>
          <p className="mt-0.5 text-xs text-gray-500">
            {showEditHint
              ? 'Email is only sent when a new announcement is created with Active status.'
              : emailWillSend
                ? 'Recipients in the selected groups will receive an email.'
                : checked && status !== 'Active'
                  ? 'Email is sent only when status is Active.'
                  : 'Announcement will appear on the board only; no email will be sent.'}
          </p>
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
