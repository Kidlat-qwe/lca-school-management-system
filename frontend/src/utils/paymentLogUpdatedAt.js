import { formatDateTimeManila, parseDateForDisplay, DISPLAY_DATE_OPTIONS } from './dateUtils';

const MANILA_TZ = 'Asia/Manila';

/** Raw timestamp when the payment row was last saved (falls back to created_at). */
export function getPaymentLogUpdatedAtRaw(payment) {
  return payment?.updated_at || payment?.created_at || null;
}

/** @param {string|null|undefined} raw */
export function getPaymentLogUpdatedAtDisplayParts(raw) {
  const d = parseDateForDisplay(raw);
  if (!d) return null;
  return {
    dateLine: `${d.toLocaleDateString('en-US', DISPLAY_DATE_OPTIONS)},`,
    timeLine: d.toLocaleTimeString('en-US', {
      timeZone: MANILA_TZ,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }),
  };
}

/** Single-line label (Excel export, modals). */
export function formatPaymentLogUpdatedAt(payment) {
  const raw = getPaymentLogUpdatedAtRaw(payment);
  return raw ? formatDateTimeManila(raw) : '-';
}

/** Two-line export label: "April 30, 2026,\n04:53:21" */
export function formatPaymentLogUpdatedAtMultiline(payment) {
  const parts = getPaymentLogUpdatedAtDisplayParts(getPaymentLogUpdatedAtRaw(payment));
  if (!parts) return '-';
  return `${parts.dateLine}\n${parts.timeLine}`;
}
