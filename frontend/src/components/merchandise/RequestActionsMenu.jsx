import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Ellipsis (⋮) actions menu for Merchandise → Requests rows.
 * Always includes "Track request item"; optional Cancel / Review / View Notes / View.
 */
export default function RequestActionsMenu({
  requestId,
  items = [],
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const buttonRef = useRef(null);

  useEffect(() => {
    if (disabled && open) setOpen(false);
  }, [disabled, open]);

  useEffect(() => {
    if (!open) return undefined;

    const onDown = (event) => {
      if (
        !event.target.closest(`[data-request-actions="${requestId}"]`) &&
        !event.target.closest(`[data-request-actions-menu="${requestId}"]`)
      ) {
        setOpen(false);
      }
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onScroll = () => setOpen(false);

    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, requestId]);

  const handleToggle = (event) => {
    event.stopPropagation();
    if (disabled) return;
    if (open) {
      setOpen(false);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = 200;
    const estimatedHeight = Math.max(44, items.length * 40 + 8);
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < estimatedHeight && rect.top > estimatedHeight;
    let left = rect.right - menuWidth;
    left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8));
    setMenuPos({
      top: openUp ? rect.top - estimatedHeight - 4 : rect.bottom + 4,
      left,
    });
    setOpen(true);
  };

  if (!items.length) return null;

  return (
    <div className="relative inline-flex justify-end" data-request-actions={requestId}>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        className="p-2 rounded-full hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Request actions"
      >
        <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
          />
        </svg>
      </button>

      {open &&
        menuPos &&
        createPortal(
          <div
            data-request-actions-menu={requestId}
            className="fixed z-[10001] min-w-[200px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
            style={{ top: `${menuPos.top}px`, left: `${menuPos.left}px` }}
            role="menu"
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect?.();
                }}
                className={`w-full text-left px-3 py-2 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  item.tone === 'danger'
                    ? 'text-red-600 hover:bg-red-50'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
