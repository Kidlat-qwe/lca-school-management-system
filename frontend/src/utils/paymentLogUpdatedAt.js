import { formatDateTimeManila, parseDateForDisplay, getManilaDateTimeParts } from './dateUtils';

const pad2 = (value) => String(value).padStart(2, '0');
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

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
  const p = getManilaDateTimeParts(d);
  return {
    dateLine: `${MONTH_NAMES[p.month - 1]} ${pad2(p.day)}, ${p.year},`,
    timeLine: `${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`,
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
