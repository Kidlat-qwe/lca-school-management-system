import { useEffect, useRef } from 'react';
import {
  collectTokensInRange,
  findTokenAtIndex,
  findTokenEndingAt,
  findTokenStartingAt,
  insertTextAtSelection,
  isPrintableKey,
  removeTokenRanges,
} from '../../utils/templateVariables';

const baseClassName =
  'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#F7C844] focus:outline-none focus:ring-2 focus:ring-[#F7C844]/30 disabled:cursor-not-allowed disabled:bg-gray-100';

const setSelection = (element, start, end = start) => {
  if (!element) return;
  element.selectionStart = start;
  element.selectionEnd = end;
};

const TemplateVariableField = ({
  id,
  label,
  value,
  onChange,
  disabled = false,
  multiline = false,
  rows = 5,
  onFocus,
  onRegister,
  onUnregister,
  insertRequest = null,
  onInsertHandled,
}) => {
  const inputRef = useRef(null);

  useEffect(() => {
    onRegister?.(id, inputRef);
    return () => onUnregister?.(id);
  }, [id, onRegister, onUnregister]);

  useEffect(() => {
    if (!insertRequest || insertRequest.fieldId !== id) return;
    const element = inputRef.current;
    if (!element) return;

    const start = element.selectionStart ?? value.length;
    const end = element.selectionEnd ?? start;
    const { newValue, selectionStart, selectionEnd } = insertTextAtSelection(
      value,
      start,
      end,
      insertRequest.token
    );
    onChange(newValue);
    onInsertHandled?.();
    requestAnimationFrame(() => setSelection(element, selectionStart, selectionEnd));
  }, [id, insertRequest, onChange, onInsertHandled, value]);

  const applyValue = (nextValue, selectionStart, selectionEnd = selectionStart) => {
    onChange(nextValue);
    requestAnimationFrame(() => setSelection(inputRef.current, selectionStart, selectionEnd));
  };

  const handleKeyDown = (event) => {
    if (disabled) return;

    const element = event.currentTarget;
    const start = element.selectionStart ?? 0;
    const end = element.selectionEnd ?? start;
    const hasSelection = start !== end;

    if (hasSelection && (event.key === 'Backspace' || event.key === 'Delete')) {
      const tokens = collectTokensInRange(value, start, end);
      if (tokens.length > 0) {
        event.preventDefault();
        const newValue = removeTokenRanges(value, tokens);
        applyValue(newValue, Math.min(start, ...tokens.map((t) => t.start)));
      }
      return;
    }

    if (event.key === 'Backspace') {
      const tokenAtCursor = findTokenAtIndex(value, start);
      if (tokenAtCursor) {
        event.preventDefault();
        applyValue(
          value.slice(0, tokenAtCursor.start) + value.slice(tokenAtCursor.end),
          tokenAtCursor.start
        );
        return;
      }

      const tokenEndingAtCursor = findTokenEndingAt(value, start);
      if (tokenEndingAtCursor) {
        event.preventDefault();
        applyValue(
          value.slice(0, tokenEndingAtCursor.start) + value.slice(tokenEndingAtCursor.end),
          tokenEndingAtCursor.start
        );
      }
      return;
    }

    if (event.key === 'Delete') {
      const tokenAtCursor = findTokenAtIndex(value, start);
      if (tokenAtCursor) {
        event.preventDefault();
        applyValue(
          value.slice(0, tokenAtCursor.start) + value.slice(tokenAtCursor.end),
          tokenAtCursor.start
        );
        return;
      }

      const tokenStartingAtCursor = findTokenStartingAt(value, start);
      if (tokenStartingAtCursor) {
        event.preventDefault();
        applyValue(
          value.slice(0, tokenStartingAtCursor.start) + value.slice(tokenStartingAtCursor.end),
          tokenStartingAtCursor.start
        );
      }
      return;
    }

    if (isPrintableKey(event) && findTokenAtIndex(value, start)) {
      event.preventDefault();
    }
  };

  const handleDrop = (event) => {
    if (disabled) return;
    event.preventDefault();
    const token = event.dataTransfer.getData('text/plain');
    if (!token.startsWith('{') || !token.endsWith('}')) return;

    const element = event.currentTarget;
    const start = element.selectionStart ?? value.length;
    const end = element.selectionEnd ?? start;
    const { newValue, selectionStart, selectionEnd } = insertTextAtSelection(value, start, end, token);
    applyValue(newValue, selectionStart, selectionEnd);
  };

  const sharedProps = {
    id,
    ref: inputRef,
    value,
    disabled,
    onFocus,
    onKeyDown: handleKeyDown,
    onDragOver: (event) => {
      if (!disabled) event.preventDefault();
    },
    onDrop: handleDrop,
    onChange: (event) => onChange(event.target.value),
    className: `${baseClassName}${multiline ? ' resize-y leading-relaxed' : ''}`,
    spellCheck: false,
  };

  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-700">
        {label}
      </label>
      {multiline ? <textarea rows={rows} {...sharedProps} /> : <input type="text" {...sharedProps} />}
      <p className="mt-1 text-[11px] text-gray-500">
        Type or drag variables like {'{studentName}'}. Once inserted, variable tokens cannot be edited—only removed.
      </p>
    </div>
  );
};

export default TemplateVariableField;
