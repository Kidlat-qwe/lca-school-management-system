/**
 * Class Code picker for teacher lesson plans.
 * Menu always opens below the trigger and highlights the first option.
 * Shows Cancelled (visible, not selectable) and Makeup badges.
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

  const selectableOptions = options.filter((o) => o.selectable !== false);
  const selected = options.find((o) => o.value === value) || null;

  const formatOptionFullLabel = (opt) => {
    if (!opt) return '';
    const base = `${opt.label || ''}${opt.secondary_label ? ` (${opt.secondary_label})` : ''}`;
    const date = String(opt.scheduled_date || '').trim();
    if (date) return `${base} — ${date}`;
    return base;
  };

  const displayLabel = selected
    ? formatOptionFullLabel(selected)
    : loading
      ? 'Loading class codes…'
      : options.length
        ? placeholder
        : emptyHint;

  const selectedTooltip = selected ? formatOptionFullLabel(selected) : '';

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
    const firstSelectable = options.findIndex((o) => o.selectable !== false);
    setHighlightIndex(firstSelectable >= 0 ? firstSelectable : 0);
    placeMenuBelow();
    const onReposition = () => placeMenuBelow();
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open, options]);

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
    if (!opt || disabled || opt.selectable === false) return;
    onChange?.(opt);
    setOpen(false);
  };

  const openMenu = () => {
    const firstSelectable = options.findIndex((o) => o.selectable !== false);
    setHighlightIndex(firstSelectable >= 0 ? firstSelectable : 0);
    setOpen(true);
  };

  const moveHighlight = (delta) => {
    if (!options.length) return;
    let next = highlightIndex;
    for (let i = 0; i < options.length; i += 1) {
      next = (next + delta + options.length) % options.length;
      if (options[next]?.selectable !== false) {
        setHighlightIndex(next);
        return;
      }
    }
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
      const opt = options[highlightIndex];
      if (opt?.selectable !== false) pick(opt);
      else if (selectableOptions[0]) pick(selectableOptions[0]);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      moveHighlight(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      moveHighlight(-1);
    }
  };

  const statusBadge = (opt, isHighlighted) => {
    if (opt.is_cancelled) {
      return (
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            isHighlighted ? 'bg-white/20 text-white' : 'bg-red-100 text-red-800'
          }`}
        >
          Cancelled
        </span>
      );
    }
    if (opt.is_makeup) {
      return (
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            isHighlighted ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-900'
          }`}
        >
          Makeup
        </span>
      );
    }
    return null;
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
                const isDisabled = opt.selectable === false;
                const text = formatOptionFullLabel(opt);
                return (
                  <li
                    key={opt.value}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={isDisabled}
                    title={text}
                  >
                    <button
                      type="button"
                      data-highlight={isHighlighted ? 'true' : undefined}
                      disabled={isDisabled}
                      title={text}
                      className={`flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-sm ${
                        isDisabled
                          ? 'cursor-not-allowed text-gray-400 line-through opacity-80'
                          : isHighlighted
                            ? 'bg-[#1e3a8a] text-white'
                            : isSelected
                              ? 'bg-[#eff6ff] text-[#1e3a8a]'
                              : 'text-[#111111] hover:bg-gray-50'
                      }`}
                      onMouseEnter={() => {
                        if (!isDisabled) setHighlightIndex(index);
                      }}
                      onClick={() => pick(opt)}
                    >
                      <span className="min-w-0 flex-1 truncate" title={text}>
                        {text}
                      </span>
                      {statusBadge(opt, isHighlighted && !isDisabled)}
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
        title={selectedTooltip || undefined}
        onClick={() => {
          if (disabled) return;
          if (open) setOpen(false);
          else openMenu();
        }}
        onKeyDown={onKeyDown}
        className="flex w-full min-w-0 items-start justify-between gap-2 rounded-lg border border-[#d8d8d8] bg-transparent px-3 py-2.5 text-left text-base font-normal text-[#111111] focus:border-[#ff9f40] focus:outline-none focus:shadow-[0_0_0_3px_rgba(255,159,64,0.15)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span
          className={`min-w-0 flex-1 break-words whitespace-normal ${selected ? '' : 'text-gray-500'}`}
          title={selectedTooltip || undefined}
        >
          {displayLabel}
        </span>
        <span className="mt-0.5 shrink-0 text-gray-400" aria-hidden>
          ▾
        </span>
      </button>
      {menu}
    </div>
  );
}
