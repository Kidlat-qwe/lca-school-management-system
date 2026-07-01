import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { appConfirm } from '../utils/appAlert';

const isSettingsPath = (pathname) =>
  pathname.startsWith('/superadmin/settings') || pathname.startsWith('/admin/settings');

const isInternalNavigationAnchor = (anchor) => {
  if (!anchor || anchor.tagName !== 'A') return false;
  const href = anchor.getAttribute('href');
  if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
    return false;
  }
  if (anchor.target === '_blank' || anchor.hasAttribute('download')) return false;
  if (anchor.getAttribute('role') === 'button') return false;

  try {
    const url = new URL(href, window.location.origin);
    return url.origin === window.location.origin;
  } catch {
    return false;
  }
};

/**
 * Prompts when template edits are unsaved. Works with BrowserRouter (no data router required).
 * - Tab / scope changes: use runGuardedAction from the Settings page
 * - Sidebar and in-app links: capture-phase click guard
 * - Refresh / close tab: beforeunload
 */
export function useTemplateUnsavedGuard({ isDirty, onSave, onDiscard, enabled = true }) {
  const location = useLocation();
  const navigate = useNavigate();
  const allowNavigationRef = useRef(false);
  const confirmingRef = useRef(false);

  const shouldGuard =
    enabled && isDirty && isSettingsPath(location.pathname);

  const confirmLeaveIfDirty = useCallback(async () => {
    if (!enabled || !isDirty || confirmingRef.current) return true;

    confirmingRef.current = true;
    try {
      const shouldSave = await appConfirm({
        title: 'Unsaved template changes',
        message:
          'You have unsaved template changes. Save them before leaving?\n\nChoose Save changes to keep your edits, or Don\'t save to discard them.',
        confirmLabel: 'Save changes',
        cancelLabel: "Don't save",
      });

      if (shouldSave) {
        const saved = await onSave();
        return Boolean(saved);
      }

      onDiscard?.();
      return true;
    } finally {
      confirmingRef.current = false;
    }
  }, [enabled, isDirty, onSave, onDiscard]);

  useEffect(() => {
    if (!shouldGuard) return undefined;

    const handleDocumentClick = async (event) => {
      if (allowNavigationRef.current || confirmingRef.current) return;

      const anchor = event.target?.closest?.('a');
      if (!isInternalNavigationAnchor(anchor)) return;

      const url = new URL(anchor.getAttribute('href'), window.location.origin);
      const nextPath = url.pathname;
      const nextUrl = `${nextPath}${url.search}${url.hash}`;

      if (nextPath === location.pathname && `${location.pathname}${location.search}${location.hash}` === nextUrl) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const canLeave = await confirmLeaveIfDirty();
      if (!canLeave) return;

      allowNavigationRef.current = true;
      navigate(nextUrl);
      window.setTimeout(() => {
        allowNavigationRef.current = false;
      }, 0);
    };

    document.addEventListener('click', handleDocumentClick, true);
    return () => document.removeEventListener('click', handleDocumentClick, true);
  }, [shouldGuard, location.pathname, location.search, location.hash, navigate, confirmLeaveIfDirty]);

  useEffect(() => {
    if (!shouldGuard) return undefined;

    const handleBeforeUnload = (event) => {
      if (allowNavigationRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [shouldGuard]);

  const runGuardedAction = useCallback(
    async (action) => {
      if (!(await confirmLeaveIfDirty())) return false;
      await action();
      return true;
    },
    [confirmLeaveIfDirty]
  );

  return { confirmLeaveIfDirty, runGuardedAction };
}
