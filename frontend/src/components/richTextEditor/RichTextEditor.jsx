/**
 * Lightweight rich-text editor (email-style toolbar).
 * No font family/size, no undo/redo — Bold/Italic/Underline/Strike, colors,
 * lists, align, link, image URL, table, clear formatting.
 * Optional @-mention list (e.g. class students by email).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { appPrompt } from '../../utils/appAlert';

const TOOL_BTN =
  'inline-flex h-8 w-8 items-center justify-center rounded text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40';

function runCommand(command, value = null) {
  try {
    document.execCommand(command, false, value);
  } catch {
    /* ignore unsupported commands */
  }
}

function isEmptyHtml(html) {
  const plain = String(html || '')
    .replace(/<br\s*\/?>/gi, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .trim();
  return !plain;
}

function escapeAttr(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapePlain(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br />');
}

/** Text from start of container through the caret (for @ query detection). */
function getTextBeforeCaret(container) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return '';
  const caretRange = sel.getRangeAt(0);
  if (!container.contains(caretRange.endContainer)) return '';
  const pre = document.createRange();
  pre.selectNodeContents(container);
  pre.setEnd(caretRange.endContainer, caretRange.endOffset);
  return pre.toString();
}

/**
 * @param {string} textBeforeCaret
 * @returns {{ query: string, startIndex: number } | null}
 */
function detectMentionTrigger(textBeforeCaret) {
  const text = String(textBeforeCaret || '');
  const match = text.match(/(?:^|[\s\u00A0])@([^\s@]*)$/);
  if (!match) return null;
  const query = match[1] || '';
  const atIndex = text.lastIndexOf(`@${query}`);
  if (atIndex < 0) return null;
  return { query, startIndex: atIndex };
}

/** Shared Tailwind classes for rendered lesson-plan HTML. */
export const LESSON_PLAN_RICH_TEXT_HTML_CLASS =
  'lesson-plan-rich-text min-h-[2.5rem] text-[15px] leading-relaxed text-[#111111] [&_a]:text-blue-600 [&_a]:underline [&_img]:max-w-full [&_ol]:list-decimal [&_ol]:pl-6 [&_table]:w-full [&_td]:border [&_td]:border-gray-300 [&_td]:p-1.5 [&_ul]:list-disc [&_ul]:pl-6 [&_.lesson-plan-mention]:inline [&_.lesson-plan-mention]:rounded [&_.lesson-plan-mention]:bg-amber-100 [&_.lesson-plan-mention]:px-1 [&_.lesson-plan-mention]:font-medium [&_.lesson-plan-mention]:text-amber-900';

/** Content fields that use the email-style rich text editor. */
export const LESSON_PLAN_RICH_TEXT_FIELDS = [
  'early_learning_goals',
  'objective_1',
  'assessment_method',
  'assessment_criteria',
  'materials_needed',
  'preliminaries_activity',
  'lesson_proper_activity',
  'conclusion_activity',
  'class1_considerations',
  'class1_adjustments',
  'reflection_went_well',
  'reflection_amazing_moments',
  'reflection_challenges',
  'reflection_improvements',
  'head_teacher_overall_assessment',
  'head_teacher_specific_feedback',
  'head_teacher_next_steps',
];

export function isLessonPlanRichTextField(fieldKey) {
  return LESSON_PLAN_RICH_TEXT_FIELDS.includes(String(fieldKey || ''));
}

/**
 * @param {{
 *   id?: string,
 *   value?: string,
 *   onChange?: (html: string) => void,
 *   disabled?: boolean,
 *   placeholder?: string,
 *   minHeight?: string,
 *   className?: string,
 *   mentionItems?: Array<{ id?: string|number, email: string, label?: string }>,
 *   mentionHint?: string,
 * }} props
 */
export default function RichTextEditor({
  id,
  value = '',
  onChange,
  disabled = false,
  placeholder = 'Write your message here',
  minHeight = '160px',
  className = '',
  mentionItems = null,
  mentionHint = '',
}) {
  const editorRef = useRef(null);
  const wrapRef = useRef(null);
  const lastValueRef = useRef(value);
  const [expanded, setExpanded] = useState(true);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionPos, setMentionPos] = useState({ top: 0, left: 0 });
  const mentionActiveRef = useRef(null);

  const mentionsEnabled = Array.isArray(mentionItems) && mentionItems.length >= 0;

  const filteredMentions = useMemo(() => {
    if (!Array.isArray(mentionItems)) return [];
    const q = String(mentionQuery || '')
      .trim()
      .toLowerCase();
    const list = mentionItems.filter((item) => {
      const email = String(item?.email || '').trim();
      if (!email) return false;
      if (!q) return true;
      const label = String(item?.label || '').toLowerCase();
      return email.toLowerCase().includes(q) || label.includes(q);
    });
    return list.slice(0, 8);
  }, [mentionItems, mentionQuery]);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (document.activeElement === el) return;
    const next = value || '';
    if (el.innerHTML === next) {
      lastValueRef.current = next;
      return;
    }
    el.innerHTML = next;
    lastValueRef.current = next;
  }, [value]);

  useEffect(() => {
    if (!mentionOpen) return undefined;
    const onDocMouseDown = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      if (mentionActiveRef.current?.contains(e.target)) return;
      setMentionOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [mentionOpen]);

  const emitChange = () => {
    const el = editorRef.current;
    if (!el) return;
    const html = el.innerHTML;
    lastValueRef.current = html;
    onChange?.(html);
  };

  const focusEditor = () => {
    editorRef.current?.focus();
  };

  const withFocus = (fn) => {
    if (disabled) return;
    focusEditor();
    fn();
    emitChange();
  };

  const updateMentionMenu = () => {
    if (!mentionsEnabled || disabled) {
      setMentionOpen(false);
      return;
    }
    const el = editorRef.current;
    if (!el) return;
    const textBefore = getTextBeforeCaret(el);
    const detected = detectMentionTrigger(textBefore);
    if (!detected) {
      setMentionOpen(false);
      return;
    }
    setMentionQuery(detected.query);
    setMentionIndex(0);

    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const wrapRect = wrapRef.current?.getBoundingClientRect();
      if (rect && (rect.width || rect.height)) {
        setMentionPos({
          top: rect.bottom + 4,
          left: Math.max(8, rect.left),
        });
      } else if (wrapRect) {
        setMentionPos({
          top: wrapRect.bottom - 8,
          left: wrapRect.left + 12,
        });
      }
    }
    setMentionOpen(true);
  };

  const insertMention = (item) => {
    const email = String(item?.email || '').trim();
    if (!email || disabled) return;
    const el = editorRef.current;
    if (!el) return;
    focusEditor();

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);

    // Delete from @ through caret within the current text node when possible
    const textBefore = getTextBeforeCaret(el);
    const detected = detectMentionTrigger(textBefore);
    if (detected) {
      const deleteCount = 1 + String(detected.query || '').length; // '@' + query
      try {
        // Walk backward character-by-character via selection extend
        for (let i = 0; i < deleteCount; i += 1) {
          sel.modify('extend', 'backward', 'character');
        }
        const delRange = sel.getRangeAt(0);
        delRange.deleteContents();
      } catch {
        // Fallback: insert at caret without deleting trigger
        range.collapse(true);
      }
    }

    const label = String(item?.label || '').trim();
    const display = `@${email}`;
    const title = label ? `${label} <${email}>` : email;
    const html = `<span class="lesson-plan-mention" contenteditable="false" data-email="${escapeAttr(email)}" data-user-id="${escapeAttr(item?.id ?? '')}" title="${escapeAttr(title)}">${escapePlain(display)}</span>&nbsp;`;

    try {
      document.execCommand('insertHTML', false, html);
    } catch {
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const frag = document.createDocumentFragment();
      while (tmp.firstChild) frag.appendChild(tmp.firstChild);
      const insertRange = sel.getRangeAt(0);
      insertRange.insertNode(frag);
      insertRange.collapse(false);
      sel.removeAllRanges();
      sel.addRange(insertRange);
    }

    setMentionOpen(false);
    setMentionQuery('');
    emitChange();
  };

  const handleLink = async () => {
    if (disabled) return;
    focusEditor();
    const url = await appPrompt({
      title: 'Insert link',
      message: 'Enter the URL',
      placeholder: 'https://',
      confirmLabel: 'Insert',
      cancelLabel: 'Cancel',
    });
    if (!url) return;
    withFocus(() => runCommand('createLink', url.trim()));
  };

  const handleImage = async () => {
    if (disabled) return;
    focusEditor();
    const url = await appPrompt({
      title: 'Insert image',
      message: 'Enter the image URL',
      placeholder: 'https://',
      confirmLabel: 'Insert',
      cancelLabel: 'Cancel',
    });
    if (!url) return;
    withFocus(() => runCommand('insertImage', url.trim()));
  };

  const handleTable = () => {
    withFocus(() => {
      runCommand(
        'insertHTML',
        '<table style="border-collapse:collapse;width:100%"><tr><td style="border:1px solid #ccc;padding:6px">&nbsp;</td><td style="border:1px solid #ccc;padding:6px">&nbsp;</td></tr><tr><td style="border:1px solid #ccc;padding:6px">&nbsp;</td><td style="border:1px solid #ccc;padding:6px">&nbsp;</td></tr></table><p></p>'
      );
    });
  };

  const handleColor = (command) => {
    if (disabled) return;
    const input = document.createElement('input');
    input.type = 'color';
    input.value = command === 'foreColor' ? '#111111' : '#fff59d';
    input.onchange = () => {
      withFocus(() => runCommand(command, input.value));
    };
    input.click();
  };

  const handleEditorInput = () => {
    emitChange();
    updateMentionMenu();
  };

  const handleEditorKeyDown = (e) => {
    if (!mentionOpen || !filteredMentions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMentionIndex((i) => (i + 1) % filteredMentions.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMentionIndex((i) => (i - 1 + filteredMentions.length) % filteredMentions.length);
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      insertMention(filteredMentions[mentionIndex]);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setMentionOpen(false);
    }
  };

  const showPlaceholder = isEmptyHtml(value);

  return (
    <div
      ref={wrapRef}
      className={`overflow-hidden rounded-lg border border-[#d8d8d8] bg-white ${disabled ? 'opacity-60' : ''} ${className}`}
    >
      <div className="flex flex-wrap items-center gap-0.5 border-b border-gray-200 bg-gray-50 px-1.5 py-1">
        <button type="button" disabled={disabled} className={TOOL_BTN} title="Bold" onClick={() => withFocus(() => runCommand('bold'))}>
          <span className="font-bold">B</span>
        </button>
        <button type="button" disabled={disabled} className={TOOL_BTN} title="Italic" onClick={() => withFocus(() => runCommand('italic'))}>
          <span className="italic">I</span>
        </button>
        <button type="button" disabled={disabled} className={TOOL_BTN} title="Underline" onClick={() => withFocus(() => runCommand('underline'))}>
          <span className="underline">U</span>
        </button>
        <button type="button" disabled={disabled} className={TOOL_BTN} title="Strikethrough" onClick={() => withFocus(() => runCommand('strikeThrough'))}>
          <span className="line-through">S</span>
        </button>

        <span className="mx-1 h-5 w-px bg-gray-300" aria-hidden />

        <button type="button" disabled={disabled} className={TOOL_BTN} title="Insert image" onClick={handleImage}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <circle cx="8.5" cy="10" r="1.5" />
            <path d="M21 15l-5-5-4 4-2-2-5 5" />
          </svg>
        </button>
        <button type="button" disabled={disabled} className={TOOL_BTN} title="Insert link" onClick={handleLink}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10 13a5 5 0 0 0 7.07 0l1.41-1.41a5 5 0 0 0-7.07-7.07L10 5.93" />
            <path d="M14 11a5 5 0 0 0-7.07 0L5.52 12.4a5 5 0 0 0 7.07 7.07L14 18.07" />
          </svg>
        </button>

        <button
          type="button"
          disabled={disabled}
          className={`${TOOL_BTN} ml-auto`}
          title={expanded ? 'Collapse toolbar' : 'Expand toolbar'}
          onClick={() => setExpanded((v) => !v)}
        >
          <svg viewBox="0 0 24 24" className={`h-4 w-4 transition-transform ${expanded ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 15l6-6 6 6" />
          </svg>
        </button>
      </div>

      {expanded ? (
        <div className="flex flex-wrap items-center gap-0.5 border-b border-gray-200 bg-gray-50 px-1.5 py-1">
          <button type="button" disabled={disabled} className={TOOL_BTN} title="Text color" onClick={() => handleColor('foreColor')}>
            <span className="text-xs font-bold underline decoration-2 decoration-red-500">A</span>
          </button>
          <button type="button" disabled={disabled} className={TOOL_BTN} title="Highlight" onClick={() => handleColor('hiliteColor')}>
            <span className="rounded bg-yellow-200 px-1 text-xs font-bold">A</span>
          </button>

          <span className="mx-1 h-5 w-px bg-gray-300" aria-hidden />

          <button type="button" disabled={disabled} className={TOOL_BTN} title="Bulleted list" onClick={() => withFocus(() => runCommand('insertUnorderedList'))}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <circle cx="5" cy="7" r="1.5" />
              <circle cx="5" cy="12" r="1.5" />
              <circle cx="5" cy="17" r="1.5" />
              <rect x="9" y="6" width="11" height="2" rx="1" />
              <rect x="9" y="11" width="11" height="2" rx="1" />
              <rect x="9" y="16" width="11" height="2" rx="1" />
            </svg>
          </button>
          <button type="button" disabled={disabled} className={TOOL_BTN} title="Numbered list" onClick={() => withFocus(() => runCommand('insertOrderedList'))}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <text x="2" y="9" fontSize="7" fontFamily="sans-serif">1</text>
              <text x="2" y="14" fontSize="7" fontFamily="sans-serif">2</text>
              <text x="2" y="19" fontSize="7" fontFamily="sans-serif">3</text>
              <rect x="9" y="6" width="11" height="2" rx="1" />
              <rect x="9" y="11" width="11" height="2" rx="1" />
              <rect x="9" y="16" width="11" height="2" rx="1" />
            </svg>
          </button>

          <span className="mx-1 h-5 w-px bg-gray-300" aria-hidden />

          <button type="button" disabled={disabled} className={TOOL_BTN} title="Align left" onClick={() => withFocus(() => runCommand('justifyLeft'))}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <rect x="4" y="6" width="16" height="2" />
              <rect x="4" y="11" width="12" height="2" />
              <rect x="4" y="16" width="14" height="2" />
            </svg>
          </button>
          <button type="button" disabled={disabled} className={TOOL_BTN} title="Align center" onClick={() => withFocus(() => runCommand('justifyCenter'))}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <rect x="4" y="6" width="16" height="2" />
              <rect x="6" y="11" width="12" height="2" />
              <rect x="5" y="16" width="14" height="2" />
            </svg>
          </button>
          <button type="button" disabled={disabled} className={TOOL_BTN} title="Align right" onClick={() => withFocus(() => runCommand('justifyRight'))}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <rect x="4" y="6" width="16" height="2" />
              <rect x="8" y="11" width="12" height="2" />
              <rect x="6" y="16" width="14" height="2" />
            </svg>
          </button>

          <span className="mx-1 h-5 w-px bg-gray-300" aria-hidden />

          <button type="button" disabled={disabled} className={TOOL_BTN} title="Insert table" onClick={handleTable}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="16" rx="1" />
              <path d="M3 10h18M3 16h18M10 4v16M16 4v16" />
            </svg>
          </button>
          <button type="button" disabled={disabled} className={TOOL_BTN} title="Clear formatting" onClick={() => withFocus(() => runCommand('removeFormat'))}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 7h16M9 7v12M15 7v12M6 19h12" />
            </svg>
          </button>
        </div>
      ) : null}

      <div className="relative">
        {showPlaceholder && disabled === false ? (
          <div className="pointer-events-none absolute left-3 top-2.5 text-sm text-gray-400">
            {placeholder}
          </div>
        ) : null}
        <div
          id={id}
          ref={editorRef}
          role="textbox"
          aria-multiline="true"
          aria-autocomplete={mentionsEnabled ? 'list' : undefined}
          contentEditable={!disabled}
          suppressContentEditableWarning
          onInput={handleEditorInput}
          onKeyUp={updateMentionMenu}
          onClick={updateMentionMenu}
          onKeyDown={handleEditorKeyDown}
          onBlur={emitChange}
          className="lesson-plan-rich-text max-w-none px-3 py-2.5 text-base leading-relaxed text-[#111111] outline-none focus:outline-none [&_a]:text-blue-600 [&_a]:underline [&_img]:max-w-full [&_table]:w-full [&_td]:border [&_td]:border-gray-300 [&_td]:p-1.5 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_.lesson-plan-mention]:inline [&_.lesson-plan-mention]:rounded [&_.lesson-plan-mention]:bg-amber-100 [&_.lesson-plan-mention]:px-1 [&_.lesson-plan-mention]:font-medium [&_.lesson-plan-mention]:text-amber-900"
          style={{ minHeight }}
        />
      </div>

      {mentionHint && mentionsEnabled ? (
        <p className="border-t border-gray-100 bg-gray-50 px-3 py-1.5 text-[11px] text-gray-500">
          {mentionHint}
        </p>
      ) : null}

      {mentionOpen && mentionsEnabled
        ? createPortal(
            <div
              ref={mentionActiveRef}
              className="fixed z-[10050] max-h-56 w-[min(100vw-16px,320px)] overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
              style={{ top: mentionPos.top, left: mentionPos.left }}
              role="listbox"
              aria-label="Mention student"
            >
              {filteredMentions.length === 0 ? (
                <div className="px-3 py-2 text-sm text-gray-500">
                  {Array.isArray(mentionItems) && mentionItems.length === 0
                    ? 'No students with email in this class'
                    : 'No matching student'}
                </div>
              ) : (
                filteredMentions.map((item, idx) => (
                  <button
                    key={`${item.id || item.email}-${idx}`}
                    type="button"
                    role="option"
                    aria-selected={idx === mentionIndex}
                    className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-amber-50 ${
                      idx === mentionIndex ? 'bg-amber-50' : ''
                    }`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertMention(item);
                    }}
                  >
                    <span className="font-medium text-gray-900">
                      {item.label || item.email}
                    </span>
                    <span className="truncate text-xs text-gray-500">@{item.email}</span>
                  </button>
                ))
              )}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

/** True when HTML (or plain text) has no visible content. */
export function isRichTextEmpty(html) {
  return isEmptyHtml(html);
}

/** Merge legacy objective_1/2/3 into one HTML field for the editor. */
export function mergeLessonPlanObjectivesHtml(plan = {}) {
  const o1 = String(plan.objective_1 || '').trim();
  const o2 = String(plan.objective_2 || '').trim();
  const o3 = String(plan.objective_3 || '').trim();
  if (!o2 && !o3) return o1;
  const looksHtml = /<[a-z][\s\S]*>/i.test(o1);
  if (looksHtml && o1) {
    const extras = [o2, o3].filter(Boolean).map((t) => `<p>${escapePlain(t)}</p>`).join('');
    return `${o1}${extras}`;
  }
  return [o1, o2, o3]
    .filter(Boolean)
    .map((t) => (looksLikeHtml(t) ? t : `<p>${escapePlain(t)}</p>`))
    .join('');
}

function looksLikeHtml(value) {
  return /<[a-z][\s\S]*>/i.test(String(value || ''));
}
