import { useEffect } from 'react';

/**
 * Browsers change `<input type="number">` values on mouse wheel, including when the user
 * meant to scroll the page. We prevent that and apply the wheel delta to scrollable parents
 * (same path the browser would have used for scrolling).
 */
function applyWheelDeltaAsScroll(event) {
  const { deltaX, deltaY } = event;
  let node = event.target instanceof Element ? event.target : null;

  while (node && node !== document.body) {
    if (node instanceof HTMLElement) {
      const { overflowY, overflowX } = window.getComputedStyle(node);
      const canScrollY =
        /(auto|scroll|overlay)/.test(overflowY) && node.scrollHeight > node.clientHeight;
      const canScrollX =
        /(auto|scroll|overlay)/.test(overflowX) && node.scrollWidth > node.clientWidth;

      if (canScrollY && deltaY !== 0) {
        const prev = node.scrollTop;
        node.scrollTop += deltaY;
        if (node.scrollTop !== prev) return;
      }
      if (canScrollX && deltaX !== 0) {
        const prev = node.scrollLeft;
        node.scrollLeft += deltaX;
        if (node.scrollLeft !== prev) return;
      }
    }
    node = node.parentElement;
  }

  const root = document.scrollingElement;
  if (root) {
    root.scrollTop += deltaY;
    root.scrollLeft += deltaX;
  }
}

export function usePreventWheelChangingNumberInputs() {
  useEffect(() => {
    const onWheel = (event) => {
      const active = document.activeElement;
      if (!(active instanceof HTMLInputElement) || active.type !== 'number') return;

      event.preventDefault();
      applyWheelDeltaAsScroll(event);
    };

    window.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => window.removeEventListener('wheel', onWheel, { capture: true });
  }, []);
}
