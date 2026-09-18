/**
 * Class Code picker for teacher lesson plans.
 * Menu always opens below the trigger and highlights the first option.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function LessonPlanClassCodeSelect({
  options = [],
  value = '',
  disabled = false,
  loading = false,
  emptyHint = 'No upcoming class codes for this grade',
  placeholder = 'Select class code',
  onChange,
  className = '',
}) {
  const listId = useId();
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [menuStyle, setMenuStyle] = useState(null);

  const selected = options.find((o) => o.value === value) || null;
  const displayLabel = selected
    ? `${selected.label}${selected.secondary_label ? ` (${selected.secondary_label})` : ''}`
    : loading
      ? 'Loading class codes…'
      : options.length
        ? placeholder
        : emptyHint;

  const placeMenuBelow = () => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setMenuStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      zIndex: 9999,
    });
  };

  useLayoutEffect(() => {
    if (!open) return undefined;
    setHighlightIndex(0);
    placeMenuBelow();
    const onReposition = () => placeMenuBelow();
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (rootRef.current?.contains(e.target)) return;
      if (listRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const item = listRef.current.querySelector('[data-highlight="true"]');
    item?.scrollIntoView({ block: 'nearest' });
  }, [open, highlightIndex]);

  const pick = (opt) => {
    if (!opt || disabled) return;
    onChange?.(opt);
    setOpen(false);
  };

  const openMenu = () => {
    setHighlightIndex(0);
    setOpen(true);
  };

  const onKeyDown = (e) => {
    if (disabled || !options.length) return;
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      pick(options[highlightIndex] || options[0]);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      setHighlightIndex((i) => Math.min(i + 1, options.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      setHighlightIndex((i) => Math.max(i - 1, 0));
    }
  };

  const menu =
    open && !disabled && menuStyle
      ? createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            style={menuStyle}
            className="max-h-60 overflow-y-auto overscroll-contain rounded-lg border border-[#d8d8d8] bg-white py-1 shadow-lg"
          >
            {!options.length ? (
              <li className="px-3 py-2 text-sm text-gray-500">{emptyHint}</li>
            ) : (
              options.map((opt, index) => {
                const isHighlighted = index === highlightIndex;
                const isSelected = opt.value === value;
                const text = `${opt.label}${opt.secondary_label ? ` (${opt.secondary_label})` : ''}`;
                return (
                  <li key={opt.value} role="option" aria-selected={isSelected}>
                    <button
                      type="button"
                      data-highlight={isHighlighted ? 'true' : undefined}
                      className={`block w-full truncate px-3 py-2 text-left text-sm ${
                        isHighlighted
                          ? 'bg-[#1e3a8a] text-white'
                          : isSelected
                            ? 'bg-[#eff6ff] text-[#1e3a8a]'
                            : 'text-[#111111] hover:bg-gray-50'
                      }`}
                      onMouseEnter={() => setHighlightIndex(index)}
                      onClick={() => pick(opt)}
                    >
                      {text}
                    </button>
                  </li>
                );
              })
            )}
          </ul>,
          document.body
        )
      : null;

  return (
    <div ref={rootRef} className={`relative min-w-0 flex-1 ${className}`}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          if (disabled) return;
          if (open) setOpen(false);
          else openMenu();
        }}
        onKeyDown={onKeyDown}
        className="flex w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-[#d8d8d8] bg-transparent px-3 py-2.5 text-left text-base font-normal text-[#111111] focus:border-[#ff9f40] focus:outline-none focus:shadow-[0_0_0_3px_rgba(255,159,64,0.15)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className={`min-w-0 truncate ${selected ? '' : 'text-gray-500'}`}>
          {displayLabel}
        </span>
        <span className="shrink-0 text-gray-400" aria-hidden>
          ▾
        </span>
      </button>
      {menu}
    </div>
  );
}
