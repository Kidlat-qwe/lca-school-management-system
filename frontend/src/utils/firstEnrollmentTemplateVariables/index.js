/**
 * Stay Connected template variable labels for Settings → Templates (branch overrides).
 * Mirrors backend branch group-chat resolution for editor hints only.
 */

export const STAY_CONNECTED_TEMPLATE_KEY = 'template_first_enrollment_stay_connected';

const GROUP_CHAT_VARIABLES = new Set(['{groupChatUrl}', '{groupChatLine}', '{groupChatLabel}']);

/** Keep in sync with backend/utils/firstEnrollmentWelcomeEmail/branchGroupChat.js */
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

export function branchDisplayLabel(branch = null) {
  if (!branch) return '';
  return (
    String(branch.branch_nickname || '').trim() ||
    String(branch.branch_name || '').trim() ||
    (branch.branch_id != null ? `Branch #${branch.branch_id}` : '')
  );
}

function normalizedBranchHaystack(branch = null) {
  return `${branch?.branch_nickname || ''} ${branch?.branch_name || ''}`.trim().toLowerCase();
}

/**
 * @returns {{ branchKey: string|null, url: string|null, displayLabel: string }}
 */
export function resolveBranchGroupChatPreview(branch = null) {
  const haystack = normalizedBranchHaystack(branch);
  const matched = BRANCH_MATCHERS.find((entry) => haystack.includes(entry.token)) || null;
  const branchKey = matched?.key ?? null;
  const url = branchKey ? DEFAULT_BRANCH_GROUP_CHAT_LINKS[branchKey] || null : null;
  const label = branchDisplayLabel(branch);
  const displayLabel = label ? `${label} Group Chat` : 'Group Chat';
  const groupChatLine = url
    ? `Group Chat: ${displayLabel} (${url})`
    : 'Please contact your branch for the official group chat link.';

  return {
    branchKey,
    url,
    displayLabel,
    groupChatLine,
  };
}

/** Variables shown when editing Stay Connected branch override (keeps UI simple). */
export const STAY_CONNECTED_BRANCH_PALETTE = ['{facebookUrl}', '{groupChatLine}'];

/**
 * Build palette items with branch-specific labels for Stay Connected overrides.
 * @returns {{ token: string, label: string|null, hint: string|null }[]}
 */
export function buildTemplateVariablePaletteItems({
  variables = [],
  templateKey,
  templateScope = 'global',
  branch = null,
}) {
  const tokens = Array.isArray(variables) ? variables : [];
  const isBranchStayConnected =
    templateKey === STAY_CONNECTED_TEMPLATE_KEY &&
    templateScope === 'branch' &&
    branch &&
    branchDisplayLabel(branch);

  if (!isBranchStayConnected) {
    return tokens.map((token) => ({ token, label: null, hint: null, subtitle: null }));
  }

  const branchLabel = branchDisplayLabel(branch);
  const chatPreview = resolveBranchGroupChatPreview(branch);

  return tokens
    .filter((token) => {
      if (!GROUP_CHAT_VARIABLES.has(token)) return true;
      return token === '{groupChatLine}';
    })
    .map((token) => {
    if (token === '{groupChatLine}') {
      return {
        token,
        label: branchLabel,
        hint: chatPreview.groupChatLine,
        subtitle: chatPreview.url
          ? chatPreview.groupChatLine
          : 'No Messenger link configured for this branch',
      };
    }
    if (!GROUP_CHAT_VARIABLES.has(token)) {
      return { token, label: null, hint: null, subtitle: null };
    }

    return { token, label: branchLabel, hint: null, subtitle: null };
  });
}
