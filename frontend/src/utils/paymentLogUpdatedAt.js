import { formatDateTimeManila, parseDateForDisplay, DISPLAY_DATE_OPTIONS } from './dateUtils';

const MANILA_TZ = 'Asia/Manila';

/** When the payment row was first encoded in the system (`paymenttbl.created_at`). */
export function getPaymentLogCreatedAtRaw(payment) {
  return payment?.created_at || null;
}

/** @deprecated Use getPaymentLogCreatedAtRaw */
export function getPaymentLogUpdatedAtRaw(payment) {
  return getPaymentLogCreatedAtRaw(payment);
}

/** @param {string|null|undefined} raw */
export function getPaymentLogCreatedAtDisplayParts(raw) {
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

/** @deprecated Use getPaymentLogCreatedAtDisplayParts */
export function getPaymentLogUpdatedAtDisplayParts(raw) {
  return getPaymentLogCreatedAtDisplayParts(raw);
}

/** Single-line label (Excel export, modals). */
export function formatPaymentLogCreatedAt(payment) {
  const raw = getPaymentLogCreatedAtRaw(payment);
  return raw ? formatDateTimeManila(raw) : '-';
}

/** @deprecated Use formatPaymentLogCreatedAt */
export function formatPaymentLogUpdatedAt(payment) {
  return formatPaymentLogCreatedAt(payment);
}

/** Two-line export label: "April 30, 2026,\n04:53:21" */
export function formatPaymentLogCreatedAtMultiline(payment) {
  const parts = getPaymentLogCreatedAtDisplayParts(getPaymentLogCreatedAtRaw(payment));
  if (!parts) return '-';
  return `${parts.dateLine}\n${parts.timeLine}`;
}

/** @deprecated Use formatPaymentLogCreatedAtMultiline */
export function formatPaymentLogUpdatedAtMultiline(payment) {
  return formatPaymentLogCreatedAtMultiline(payment);
}
