/** Little Champions Got Talent event acknowledgement receipt constants. */

export const LCGT_EVENT_AR_TYPE = 'Event';
export const LCGT_EVENT_NAME = 'Little Champions Got Talent event (June 2026)';
export const LCGT_EVENT_TICKET_PRICE = 100;

export const LCGT_EVENT_PAYMENT_METHODS = ['Cash', 'Online Banking', 'E-wallets'];

export const LCGT_EVENT_PARTICIPANT_TYPES = Object.freeze({
  STUDENT: 'student',
  OUTSIDER: 'outsider',
});

export const LCGT_EVENT_PARTICIPANT_NOTE_PREFIX = 'PARTICIPANT_TYPE:';

export function buildLcgtParticipantNotes(participantType) {
  const type = String(participantType || '').trim().toLowerCase();
  if (type !== LCGT_EVENT_PARTICIPANT_TYPES.STUDENT && type !== LCGT_EVENT_PARTICIPANT_TYPES.OUTSIDER) {
    return null;
  }
  return `${LCGT_EVENT_PARTICIPANT_NOTE_PREFIX}${type}`;
}

export function parseLcgtParticipantType(notes) {
  const raw = String(notes || '').trim();
  const prefix = LCGT_EVENT_PARTICIPANT_NOTE_PREFIX.toLowerCase();
  if (!raw.toLowerCase().startsWith(prefix)) return null;
  const value = raw.slice(LCGT_EVENT_PARTICIPANT_NOTE_PREFIX.length).trim().toLowerCase();
  if (value === LCGT_EVENT_PARTICIPANT_TYPES.STUDENT || value === LCGT_EVENT_PARTICIPANT_TYPES.OUTSIDER) {
    return value;
  }
  return null;
}

export function formatLcgtParticipantTypeLabel(participantType) {
  if (participantType === LCGT_EVENT_PARTICIPANT_TYPES.STUDENT) return 'Student';
  if (participantType === LCGT_EVENT_PARTICIPANT_TYPES.OUTSIDER) return 'Outsider';
  return '—';
}

export const LCGT_EVENT_BRANCH_NAME_TOKEN = 'malolos';

export function isLcgtEventBranch(branch) {
  const label = `${branch?.branch_nickname || branch?.branchNickname || ''} ${branch?.branch_name || branch?.branchName || ''}`
    .trim()
    .toLowerCase();
  return label.includes(LCGT_EVENT_BRANCH_NAME_TOKEN);
}

/** Superadmin always; branch Admin only when assigned to Malolos. */
export function canCreateLcgtEventAr({ userType, branchName, branchNickname, branches = null, branchId = null }) {
  if (String(userType || '').trim() === 'Superadmin') return true;
  if (String(userType || '').trim() !== 'Admin') return false;

  if (branchName != null || branchNickname != null) {
    return isLcgtEventBranch({ branch_name: branchName, branch_nickname: branchNickname });
  }

  if (branchId != null && Array.isArray(branches) && branches.length > 0) {
    const branch = branches.find((b) => Number(b.branch_id) === Number(branchId));
    return branch ? isLcgtEventBranch(branch) : false;
  }

  return false;
}

export function isLcgtEventPaymentMethod(paymentMethod) {
  return LCGT_EVENT_PAYMENT_METHODS.includes(String(paymentMethod || '').trim());
}
