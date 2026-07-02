/** Little Champions Got Talent event acknowledgement receipt constants. */

export const LCGT_EVENT_AR_TYPE = 'Event';
export const LCGT_EVENT_NAME = 'Little Champions Got Talent event (June 2026)';
export const LCGT_EVENT_TICKET_PRICE = 100;
export const LCGT_EVENT_PARTICIPANT_NOTE_PREFIX = 'PARTICIPANT_TYPE:';

export const LCGT_EVENT_PARTICIPANT_TYPES = Object.freeze({
  STUDENT: 'student',
  OUTSIDER: 'outsider',
});

export const LCGT_EVENT_OUTSIDER_DISPLAY_NAME = 'Outsider (Event Participant)';

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

export function isLcgtEventAr(arType) {
  return String(arType || '').trim() === LCGT_EVENT_AR_TYPE;
}

export const LCGT_EVENT_BRANCH_NAME_TOKEN = 'malolos';

export function isLcgtEventBranch(branch) {
  const label = `${branch?.branch_nickname || branch?.branchNickname || ''} ${branch?.branch_name || branch?.branchName || ''}`
    .trim()
    .toLowerCase();
  return label.includes(LCGT_EVENT_BRANCH_NAME_TOKEN);
}

/** Superadmin always; branch Admin only when assigned to Malolos. */
export function canCreateLcgtEventAr({ userType, branchName, branchNickname, branchId = null }) {
  if (String(userType || '').trim() === 'Superadmin') return true;
  if (String(userType || '').trim() !== 'Admin') return false;
  if (branchName != null || branchNickname != null) {
    return isLcgtEventBranch({ branch_name: branchName, branch_nickname: branchNickname });
  }
  return branchId != null && isLcgtEventBranch({ branch_id: branchId });
}

export function assertLcgtEventArAccess({ userType, userBranchId, branchRow }) {
  if (String(userType || '').trim() === 'Superadmin') return null;
  if (String(userType || '').trim() !== 'Admin') {
    return 'Only Superadmin and Malolos branch admin can create Little Champions Got Talent event tickets';
  }
  if (!branchRow || !isLcgtEventBranch(branchRow)) {
    return 'Little Champions Got Talent event tickets can only be created for the Malolos branch';
  }
  if (userBranchId != null && Number(userBranchId) !== Number(branchRow.branch_id)) {
    return 'You can only create event tickets for your assigned branch';
  }
  return null;
}

export const LCGT_EVENT_PAYMENT_METHODS = ['Cash', 'Online Banking', 'E-wallets'];

export function isLcgtEventPaymentMethod(paymentMethod) {
  return LCGT_EVENT_PAYMENT_METHODS.includes(String(paymentMethod || '').trim());
}

/** Merchandise and Event ARs auto-create invoice + payment on issue. */
export function isAutoPaidInvoiceArType(arType) {
  const type = String(arType || '').trim();
  return type === 'Merchandise' || type === LCGT_EVENT_AR_TYPE;
}
