import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const TOOLTIP_ESTIMATED_WIDTH = 288;
const VIEWPORT_MARGIN = 12;
const GAP = 8;

/**
 * Compute fixed viewport position for the tooltip.
 * Default: below the icon, extending to the right (bottom-right).
 * Flips above when near the bottom; flips left when near the right edge.
 */
export const computeMatrixTooltipPosition = (triggerRect, tooltipWidth, tooltipHeight) => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const spaceBelow = vh - VIEWPORT_MARGIN - triggerRect.bottom;
  const spaceAbove = triggerRect.top - VIEWPORT_MARGIN;
  const minVertical = tooltipHeight + GAP;

  // Default below (bottom-right); flip above only when bottom cannot fit the tooltip.
  let showBelow = true;
  if (spaceBelow < minVertical) {
    showBelow = spaceAbove >= minVertical || spaceAbove > spaceBelow;
  }

  let top = showBelow ? triggerRect.bottom + GAP : triggerRect.top - tooltipHeight - GAP;

  // Default: left edge at icon (extends right). Flip to bottom-left / top-left when near right edge.
  const leftAligned = triggerRect.left;
  const rightAligned = triggerRect.right - tooltipWidth;
  const overflowRight = leftAligned + tooltipWidth > vw - VIEWPORT_MARGIN;
  let left = overflowRight ? rightAligned : leftAligned;

  left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - tooltipWidth - VIEWPORT_MARGIN));
  top = Math.max(VIEWPORT_MARGIN, Math.min(top, vh - tooltipHeight - VIEWPORT_MARGIN));

  return { top, left, showBelow, overflowRight };
};

/**
 * Info icon with viewport-aware tooltip (portal + fixed positioning).
 * Avoids clipping inside cards, sidebars, and page edges.
 */
const MatrixInfoTooltip = ({ label = 'How to read this matrix', children }) => {
  const tooltipId = useId();
  const triggerRef = useRef(null);
  const tooltipRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: -9999, left: -9999 });
  const [ready, setReady] = useState(false);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const tooltip = tooltipRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const tooltipW = tooltip?.offsetWidth || TOOLTIP_ESTIMATED_WIDTH;
    const tooltipH = tooltip?.offsetHeight || 96;
    const next = computeMatrixTooltipPosition(rect, tooltipW, tooltipH);
    setCoords({ top: next.top, left: next.left });
    setReady(true);
  }, []);

  const show = useCallback(() => {
    setReady(false);
    setOpen(true);
  }, []);

  const hide = useCallback(() => {
    setOpen(false);
    setReady(false);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const id = requestAnimationFrame(updatePosition);
    return () => cancelAnimationFrame(id);
  }, [open, children, updatePosition]);

  useEffect(() => {
    if (!open) return undefined;
    const onScrollOrResize = () => updatePosition();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, updatePosition]);

  return (
    <>
      <span className="relative z-20 ml-1.5 inline-flex align-middle">
        <span
          ref={triggerRef}
          role="button"
          tabIndex={0}
          aria-label={label}
          aria-describedby={open ? tooltipId : undefined}
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={show}
          onMouseLeave={hide}
          onFocus={show}
          onBlur={hide}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
            }
            if (e.key === 'Escape') {
              hide();
            }
          }}
          className="inline-flex h-5 w-5 shrink-0 cursor-help items-center justify-center rounded-full border border-gray-300 bg-white text-[11px] font-semibold leading-none text-gray-500 hover:border-[#F7C844] hover:bg-amber-50 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#F7C844]/50"
        >
          i
        </span>
      </span>
      {open &&
        createPortal(
          <span
            id={tooltipId}
            ref={tooltipRef}
            role="tooltip"
            style={{
              position: 'fixed',
              top: coords.top,
              left: coords.left,
              zIndex: 10000,
              visibility: ready ? 'visible' : 'hidden',
            }}
            className="pointer-events-none w-72 max-w-[min(18rem,calc(100vw-2rem))] whitespace-pre-line rounded-lg bg-gray-900 px-3 py-2.5 text-left text-[11px] font-normal leading-relaxed text-gray-100 shadow-lg"
          >
            {children}
          </span>,
          document.body
        )}
    </>
  );
};

export default MatrixInfoTooltip;
