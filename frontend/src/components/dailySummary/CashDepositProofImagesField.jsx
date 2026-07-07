import { MAX_CASH_DEPOSIT_ATTACHMENTS } from '../../utils/cashDepositAttachments';

/**
 * Up to two deposit proof images (upload / replace / remove / view).
 * @param {'stack'|'grid'} variant - grid: side-by-side cards (better for modals)
 */
export default function CashDepositProofImagesField({
  attachments = [],
  onChange,
  uploading = false,
  disabled = false,
  onView,
  onUploadFile,
  label = 'Deposit Proof',
  required = true,
  variant = 'stack',
  helperText,
}) {
  const urls = (Array.isArray(attachments) ? attachments : [])
    .map((url) => String(url || '').trim())
    .filter(Boolean)
    .slice(0, MAX_CASH_DEPOSIT_ATTACHMENTS);

  const busy = disabled || uploading;

  const updateUrls = (nextUrls) => {
    onChange?.(
      nextUrls
        .map((url) => String(url || '').trim())
        .filter(Boolean)
        .slice(0, MAX_CASH_DEPOSIT_ATTACHMENTS)
    );
  };

  const setSlot = (index, nextUrl) => {
    const next = [...urls];
    if (nextUrl) {
      next[index] = nextUrl;
      updateUrls(next);
      return;
    }
    next.splice(index, 1);
    updateUrls(next);
  };

  const handleUpload = async (index, file) => {
    if (!file || !onUploadFile) return;
    const url = await onUploadFile(file);
    if (url) setSlot(index, url);
  };

  const slots = Array.from({ length: MAX_CASH_DEPOSIT_ATTACHMENTS }, (_, index) => urls[index] || '');

  const renderSlotCard = (url, index) => {
    const isRequired = index === 0 && required;
    const slotLabel = `Image ${index + 1}`;
    const emptyHint = index === 0 ? 'Required — deposit slip or bank proof' : 'Optional second proof';

    return (
      <div
        key={`deposit-proof-slot-${index}`}
        className={`relative flex min-h-[9.5rem] flex-col rounded-xl border-2 border-dashed transition-colors ${
          url
            ? 'border-sky-200 bg-sky-50/40'
            : 'border-gray-200 bg-gray-50/80 hover:border-sky-300 hover:bg-sky-50/30'
        }`}
      >
        {url ? (
          <>
            <div className="relative flex-1 p-2">
              <img
                src={url}
                alt={`${slotLabel} preview`}
                className="h-28 w-full rounded-lg border border-white/80 object-cover shadow-sm sm:h-32"
              />
              <span className="absolute left-3 top-3 rounded-md bg-white/95 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-700 shadow-sm">
                {slotLabel}
                {isRequired ? ' *' : ''}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5 border-t border-sky-100 bg-white/80 px-2.5 py-2 rounded-b-[10px]">
              <label
                className={`cursor-pointer rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 ${busy ? 'pointer-events-none opacity-50' : ''}`}
              >
                {uploading ? 'Uploading…' : 'Replace'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={busy}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) await handleUpload(index, file);
                  }}
                />
              </label>
              <button
                type="button"
                onClick={() => onView?.(url)}
                className="rounded-md bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200"
              >
                View
              </button>
              <button
                type="button"
                onClick={() => setSlot(index, '')}
                disabled={busy}
                className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          </>
        ) : (
          <label
            className={`flex flex-1 cursor-pointer flex-col items-center justify-center gap-2 px-3 py-5 text-center ${busy ? 'pointer-events-none opacity-50' : ''}`}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-sky-600 shadow-sm ring-1 ring-sky-100">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </span>
            <span className="text-xs font-semibold text-gray-800">
              {slotLabel}
              {isRequired ? <span className="text-red-500"> *</span> : null}
            </span>
            <span className="text-[11px] text-gray-500">{emptyHint}</span>
            <span className="mt-1 rounded-md bg-sky-600 px-3 py-1 text-xs font-medium text-white">
              {uploading ? 'Uploading…' : 'Choose image'}
            </span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) await handleUpload(index, file);
              }}
            />
          </label>
        )}
      </div>
    );
  };

  if (variant === 'grid') {
    return (
      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">
            {label}
            {required ? <span className="text-red-500"> *</span> : null}
          </label>
          <span className="text-[11px] text-gray-500">Up to {MAX_CASH_DEPOSIT_ATTACHMENTS} images</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {slots.map((url, index) => renderSlotCard(url, index))}
        </div>
        {helperText ? <p className="mt-2 text-[11px] leading-relaxed text-gray-500">{helperText}</p> : null}
      </div>
    );
  }

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-600">
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
        <span className="ml-1 font-normal text-gray-500">(max {MAX_CASH_DEPOSIT_ATTACHMENTS})</span>
      </label>
      <div className="space-y-3">{slots.map((url, index) => renderSlotCard(url, index))}</div>
      {helperText ? <p className="mt-2 text-xs text-gray-500">{helperText}</p> : null}
    </div>
  );
}
