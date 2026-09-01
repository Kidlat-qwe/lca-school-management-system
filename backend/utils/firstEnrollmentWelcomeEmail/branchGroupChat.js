/**
 * Branch-specific Messenger group chat invite links for onboarding email #5.
 */

export const DEFAULT_BRANCH_GROUP_CHAT_LINKS = Object.freeze({
  malolos:
    'https://m.me/j/AbaD3xHSUoQSNrbb/?send_source=gc%3Acopy_invite_link_t',
  pampanga:
    'https://m.me/j/0KECHZn5UVxUlzn-/?send_source=gc%3Acopy_invite_link_t',
  guiguinto:
    'https://m.me/j/iati7am_Mi5CObBr/?send_source=gc%3Acopy_invite_link_t',
  cavite:
    'https://m.me/j/AbZ-YGiI00vtr7a0/?send_source=gc%3Acopy_invite_link_t',
});

const BRANCH_MATCHERS = [
  { token: 'malolos', key: 'malolos' },
  { token: 'pampanga', key: 'pampanga' },
  { token: 'guiguinto', key: 'guiguinto' },
  { token: 'cavite', key: 'cavite' },
];

function branchLabel({ branchName, branchNickname } = {}) {
  const nickname = String(branchNickname || '').trim();
  const name = String(branchName || '').trim();
  return nickname || name || '';
}

function normalizedBranchHaystack({ branchName, branchNickname } = {}) {
  return `${branchNickname || ''} ${branchName || ''}`.trim().toLowerCase();
}

function parseEnvBranchGroupChatMap() {
  const raw = String(process.env.FIRST_ENROLLMENT_BRANCH_GROUP_CHAT_URLS || '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function resolveFromEnv(branchId, branchKey) {
  const envMap = parseEnvBranchGroupChatMap();
  if (!envMap) return null;

  if (branchId != null && envMap[String(branchId)]) {
    return String(envMap[String(branchId)]).trim() || null;
  }
  if (branchKey && envMap[branchKey]) {
    return String(envMap[branchKey]).trim() || null;
  }
  return null;
}

/**
 * @returns {{ branchKey: string|null, url: string|null, displayLabel: string }}
 */
export function resolveBranchGroupChat({ branchId = null, branchName = null, branchNickname = null } = {}) {
  const haystack = normalizedBranchHaystack({ branchName, branchNickname });
  const matched = BRANCH_MATCHERS.find((entry) => haystack.includes(entry.token)) || null;
  const branchKey = matched?.key ?? null;

  const url =
    resolveFromEnv(branchId, branchKey) ||
    (branchKey ? DEFAULT_BRANCH_GROUP_CHAT_LINKS[branchKey] : null) ||
    null;

  const label = branchLabel({ branchName, branchNickname });
  const displayLabel = label ? `${label} Group Chat` : 'Group Chat';

  return {
    branchKey,
    url,
    displayLabel,
  };
}

export function groupChatFallbackText() {
  return 'Please contact your branch for the official group chat link.';
}
