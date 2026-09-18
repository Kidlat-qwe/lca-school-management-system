/**
 * Lightweight rich-text editor (email-style toolbar).
 * No font family/size, no undo/redo — Bold/Italic/Underline/Strike, colors,
 * lists, align, link, image URL, table, clear formatting.
 */
import { useEffect, useRef, useState } from 'react';
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

/** Shared Tailwind classes for rendered lesson-plan HTML. */
export const LESSON_PLAN_RICH_TEXT_HTML_CLASS =
  'lesson-plan-rich-text min-h-[2.5rem] text-[15px] leading-relaxed text-[#111111] [&_a]:text-blue-600 [&_a]:underline [&_img]:max-w-full [&_ol]:list-decimal [&_ol]:pl-6 [&_table]:w-full [&_td]:border [&_td]:border-gray-300 [&_td]:p-1.5 [&_ul]:list-disc [&_ul]:pl-6';

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
}) {
  const editorRef = useRef(null);
  const lastValueRef = useRef(value);
  const [expanded, setExpanded] = useState(true);

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

  const showPlaceholder = isEmptyHtml(value);

  return (
    <div
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
          contentEditable={!disabled}
          suppressContentEditableWarning
          onInput={emitChange}
          onBlur={emitChange}
          className="lesson-plan-rich-text max-w-none px-3 py-2.5 text-base leading-relaxed text-[#111111] outline-none focus:outline-none [&_a]:text-blue-600 [&_a]:underline [&_img]:max-w-full [&_table]:w-full [&_td]:border [&_td]:border-gray-300 [&_td]:p-1.5 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6"
          style={{ minHeight }}
        />
      </div>
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

function escapePlain(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br />');
}
