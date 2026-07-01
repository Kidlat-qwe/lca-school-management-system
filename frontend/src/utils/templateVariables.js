const TOKEN_PATTERN = /\{(\w+)\}/g;

export const extractTemplateVariables = (...texts) => {
  const found = new Set();
  for (const text of texts) {
    if (typeof text !== 'string' || !text) continue;
    TOKEN_PATTERN.lastIndex = 0;
    let match = TOKEN_PATTERN.exec(text);
    while (match) {
      found.add(`{${match[1]}}`);
      match = TOKEN_PATTERN.exec(text);
    }
  }
  return [...found].sort();
};

export const mergeTemplateVariables = (predefined = [], ...texts) => {
  const merged = new Set([...(predefined || []), ...extractTemplateVariables(...texts)]);
  return [...merged].sort();
};

export const findTokenAtIndex = (text, index) => {
  if (typeof text !== 'string' || text.length === 0) return null;
  TOKEN_PATTERN.lastIndex = 0;
  let match = TOKEN_PATTERN.exec(text);
  while (match) {
    const start = match.index;
    const end = start + match[0].length;
    if (index > start && index < end) {
      return { start, end, token: match[0] };
    }
    match = TOKEN_PATTERN.exec(text);
  }
  return null;
};

export const findTokenEndingAt = (text, index) => {
  if (typeof text !== 'string' || text.length === 0) return null;
  TOKEN_PATTERN.lastIndex = 0;
  let match = TOKEN_PATTERN.exec(text);
  while (match) {
    const start = match.index;
    const end = start + match[0].length;
    if (index === end) {
      return { start, end, token: match[0] };
    }
    match = TOKEN_PATTERN.exec(text);
  }
  return null;
};

export const findTokenStartingAt = (text, index) => {
  if (typeof text !== 'string' || text.length === 0) return null;
  TOKEN_PATTERN.lastIndex = 0;
  let match = TOKEN_PATTERN.exec(text);
  while (match) {
    const start = match.index;
    const end = start + match[0].length;
    if (index === start) {
      return { start, end, token: match[0] };
    }
    match = TOKEN_PATTERN.exec(text);
  }
  return null;
};

export const collectTokensInRange = (text, rangeStart, rangeEnd) => {
  if (typeof text !== 'string' || text.length === 0) return [];
  const start = Math.max(0, Math.min(rangeStart, rangeEnd));
  const end = Math.min(text.length, Math.max(rangeStart, rangeEnd));
  const tokens = [];
  TOKEN_PATTERN.lastIndex = 0;
  let match = TOKEN_PATTERN.exec(text);
  while (match) {
    const tokenStart = match.index;
    const tokenEnd = tokenStart + match[0].length;
    if (tokenEnd > start && tokenStart < end) {
      tokens.push({ start: tokenStart, end: tokenEnd, token: match[0] });
    }
    match = TOKEN_PATTERN.exec(text);
  }
  return tokens;
};

export const removeTokenRanges = (text, tokens) => {
  if (!tokens.length) return text;
  const sorted = [...tokens].sort((a, b) => b.start - a.start);
  let next = text;
  for (const token of sorted) {
    next = next.slice(0, token.start) + next.slice(token.end);
  }
  return next;
};

export const insertTextAtSelection = (text, selectionStart, selectionEnd, insertText) => {
  const start = selectionStart ?? text.length;
  const end = selectionEnd ?? start;
  const safeInsert = insertText ?? '';
  const newValue = text.slice(0, start) + safeInsert + text.slice(end);
  return {
    newValue,
    selectionStart: start + safeInsert.length,
    selectionEnd: start + safeInsert.length,
  };
};

export const isPrintableKey = (event) =>
  event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
