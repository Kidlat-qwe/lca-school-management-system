import crypto from 'crypto';

const ATTEMPT_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** FIUU orderid max length is 40 alphanumeric. */
export function generateAttemptSuffix(length = 4) {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ATTEMPT_CHARS[crypto.randomInt(0, ATTEMPT_CHARS.length)];
  }
  return out;
}

function sanitizeIdPart(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function padPhase(phase) {
  const n = parseInt(String(phase), 10);
  if (!Number.isFinite(n) || n < 0) return '00';
  return String(n).padStart(2, '0');
}

export function buildInvoiceOrderId(invoiceId, attempt = generateAttemptSuffix()) {
  const id = sanitizeIdPart(invoiceId);
  return `PSMS-I-${id}-${attempt}`;
}

export function buildInstallmentOrderId(profileId, phase, attempt = generateAttemptSuffix()) {
  const id = sanitizeIdPart(profileId);
  return `PSMS-INS-${id}-P${padPhase(phase)}-${attempt}`;
}

export function buildAdvanceOrderId(profileId, phase, attempt = generateAttemptSuffix()) {
  const id = sanitizeIdPart(profileId);
  return `PSMS-ADV-${id}-P${padPhase(phase)}-${attempt}`;
}

export function buildRejoinOrderId(classId, studentId, phase, attempt = generateAttemptSuffix()) {
  const c = sanitizeIdPart(classId);
  const s = sanitizeIdPart(studentId);
  return `PSMS-REJ-${c}-S${s}-P${padPhase(phase)}-${attempt}`;
}

export function buildArOrderId(ackOrDraftId, attempt = generateAttemptSuffix()) {
  const id = sanitizeIdPart(ackOrDraftId);
  return `PSMS-AR-${id}-${attempt}`;
}

export function buildBalanceOrderId(invoiceId, attempt = generateAttemptSuffix()) {
  const id = sanitizeIdPart(invoiceId);
  return `PSMS-BAL-${id}-${attempt}`;
}

export function formatFiuuDescription({
  typeLabel,
  studentName,
  branchName,
  refLabel,
  amountPhp,
  initiatorName,
}) {
  const parts = [
    'PSMS CMS',
    typeLabel,
    studentName,
    branchName,
    refLabel,
    `PHP ${formatAmount(amountPhp)}`,
  ].filter(Boolean);
  let desc = parts.join(' | ');
  if (initiatorName) {
    desc += ` | Init: ${initiatorName}`;
  }
  return desc.slice(0, 500);
}

export function formatAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const ORDER_PATTERNS = {
  invoice: /^PSMS-I-(\d+)-([A-Z0-9]{4})$/,
  installment: /^PSMS-INS-(\d+)-P(\d{2})-([A-Z0-9]{4})$/,
  advance: /^PSMS-ADV-(\d+)-P(\d{2})-([A-Z0-9]{4})$/,
  rejoin: /^PSMS-REJ-(\d+)-S(\d+)-P(\d{2})-([A-Z0-9]{4})$/,
  ar: /^PSMS-AR-(\d+)-([A-Z0-9]{4})$/,
  balance: /^PSMS-BAL-(\d+)-([A-Z0-9]{4})$/,
};

export function parseOrderId(orderid) {
  const raw = String(orderid || '').trim();
  for (const [type, re] of Object.entries(ORDER_PATTERNS)) {
    const m = raw.match(re);
    if (!m) continue;
    if (type === 'invoice') return { type, invoiceId: parseInt(m[1], 10), attempt: m[2] };
    if (type === 'balance') return { type: 'invoice', invoiceId: parseInt(m[1], 10), attempt: m[2], isBalance: true };
    if (type === 'installment') {
      return {
        type,
        profileId: parseInt(m[1], 10),
        phase: parseInt(m[2], 10),
        attempt: m[3],
      };
    }
    if (type === 'advance') {
      return {
        type,
        profileId: parseInt(m[1], 10),
        phase: parseInt(m[2], 10),
        attempt: m[3],
      };
    }
    if (type === 'rejoin') {
      return {
        type,
        classId: parseInt(m[1], 10),
        studentId: parseInt(m[2], 10),
        phase: parseInt(m[3], 10),
        attempt: m[4],
      };
    }
    if (type === 'ar') return { type, ackId: parseInt(m[1], 10), attempt: m[2] };
  }
  return null;
}
