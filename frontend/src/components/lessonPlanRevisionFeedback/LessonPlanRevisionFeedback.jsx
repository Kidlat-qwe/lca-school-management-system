/**
 * Shared revision-feedback parsing and red banner UI for teacher view/edit.
 */

export function parseRevisionFeedbackClient(raw) {
  if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
    return {
      items: Array.isArray(raw.items) ? raw.items : [],
      general: raw.general || null,
      legacy: Boolean(raw.legacy),
    };
  }
  const text = raw == null ? '' : String(raw);
  if (!text.trim()) return { items: [], general: null, legacy: true };
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      if (Number(parsed.v) === 1 && Array.isArray(parsed.items)) {
        return {
          items: parsed.items,
          general: parsed.general || null,
          legacy: false,
        };
      }
      if (Array.isArray(parsed.items) || parsed.general) {
        return {
          items: Array.isArray(parsed.items) ? parsed.items : [],
          general: parsed.general || null,
          legacy: false,
        };
      }
    }
  } catch {
    /* legacy plain text */
  }
  return { items: [], general: text, legacy: true };
}

export function getPlanRevisionFeedback(plan) {
  const fromApi = plan?.revision_feedback;
  if (fromApi && typeof fromApi === 'object' && !Array.isArray(fromApi)) {
    const items = Array.isArray(fromApi.items) ? fromApi.items : [];
    if (items.length > 0 || fromApi.general || fromApi.legacy) {
      return {
        items,
        general: fromApi.general || null,
        legacy: Boolean(fromApi.legacy),
      };
    }
  }
  return parseRevisionFeedbackClient(plan?.revision_reason);
}

export function getRevisionItemsForField(plan, fieldKey) {
  const feedback = getPlanRevisionFeedback(plan);
  const items = Array.isArray(feedback?.items) ? feedback.items : [];
  const key = String(fieldKey || '').trim();
  return items.filter((item) => String(item?.field || '').trim() === key);
}

function RevisionBanner({ title = 'Revision feedback', highlight, note }) {
  if (!highlight && !note) {
    return (
      <div className="rounded-md border border-red-300 bg-red-100 px-2.5 py-2 text-[12px] text-red-900">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-red-700">{title}</p>
        <p className="mt-1 text-[13px] text-red-950">This field needs revision.</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-red-300 bg-red-100 px-2.5 py-2 text-[12px] text-red-900">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-red-700">{title}</p>
      {highlight ? (
        <blockquote className="mt-1 border-l-2 border-red-500 pl-2 text-[12px] italic text-red-950">
          “{highlight}”
        </blockquote>
      ) : null}
      {note ? (
        <p className="mt-1 whitespace-pre-wrap text-[13px] leading-snug text-red-950">{note}</p>
      ) : null}
    </div>
  );
}

/** Inline revision notes placed directly under the matching form field. */
export function FieldRevisionNotes({ plan, fieldKey }) {
  if (plan?.status !== 'revision_requested') return null;
  const items = getRevisionItemsForField(plan, fieldKey);
  if (!items.length) return null;

  return (
    <div className="mt-1.5 w-full space-y-1.5">
      {items.map((item, idx) => (
        <RevisionBanner
          key={`${fieldKey}-${idx}`}
          highlight={item.highlight}
          note={item.note}
        />
      ))}
    </div>
  );
}

/** General / legacy revision note (not tied to a specific field). */
export function GeneralRevisionNotes({ plan }) {
  if (plan?.status !== 'revision_requested') return null;
  const feedback = getPlanRevisionFeedback(plan);
  const general =
    typeof feedback?.general === 'string' && feedback.general.trim()
      ? feedback.general.trim()
      : '';
  if (!general) return null;

  return (
    <div className="mt-2.5 rounded-lg border border-red-300 bg-red-100 p-3 text-[13px] text-red-900">
      <p className="mb-1 font-semibold uppercase tracking-wide text-red-700">
        {feedback.legacy ? 'Revision feedback' : 'General revision feedback'}
      </p>
      <p className="whitespace-pre-wrap text-red-950">{general}</p>
    </div>
  );
}

/**
 * Full revision summary for the read-only view modal (visible before Edit).
 * Lists every flagged field + general note so feedback is never easy to miss.
 */
export function RevisionFeedbackSummary({ plan }) {
  if (plan?.status !== 'revision_requested') return null;
  const feedback = getPlanRevisionFeedback(plan);
  const items = Array.isArray(feedback?.items) ? feedback.items : [];
  const general =
    typeof feedback?.general === 'string' && feedback.general.trim()
      ? feedback.general.trim()
      : '';

  if (!items.length && !general) return null;

  return (
    <div className="mb-4 space-y-2 rounded-lg border border-red-300 bg-red-50 p-3 sm:p-4">
      <p className="text-sm font-bold uppercase tracking-wide text-red-800">
        Revision requested — please update the flagged fields
      </p>
      {items.map((item, idx) => (
        <RevisionBanner
          key={`summary-${item.field || 'item'}-${idx}`}
          title={item.label || item.field || 'Revision feedback'}
          highlight={item.highlight}
          note={item.note}
        />
      ))}
      {general ? (
        <RevisionBanner
          title={feedback.legacy ? 'Revision feedback' : 'General revision feedback'}
          note={general}
        />
      ) : null}
    </div>
  );
}
