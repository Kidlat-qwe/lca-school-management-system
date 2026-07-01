import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  registerAppAlert,
  registerAppConfirm,
  registerAppPrompt,
} from '../utils/appAlert';

const AlertModalContext = createContext(null);

export function AlertModalProvider({ children }) {
  const [state, setState] = useState({
    open: false,
    kind: 'alert',
    title: 'Notice',
    message: '',
    variant: 'info',
    placeholder: '',
    confirmLabel: 'OK',
    cancelLabel: 'Cancel',
    required: true,
    destructive: false,
  });
  const [promptInput, setPromptInput] = useState('');
  const [promptError, setPromptError] = useState('');

  const dialogKindRef = useRef('alert');
  const resolveRef = useRef(null);

  const dismiss = useCallback(() => {
    const kind = dialogKindRef.current;
    if ((kind === 'confirm' || kind === 'prompt') && resolveRef.current) {
      resolveRef.current(kind === 'confirm' ? false : null);
      resolveRef.current = null;
    }
    dialogKindRef.current = 'alert';
    setPromptInput('');
    setPromptError('');
    setState((s) => ({ ...s, open: false }));
  }, []);

  const showAlert = useCallback((message, options = {}) => {
    resolveRef.current = null;
    dialogKindRef.current = 'alert';
    setState({
      open: true,
      kind: 'alert',
      title: options.title || 'Notice',
      message,
      variant: options.variant || 'info',
      placeholder: '',
      confirmLabel: 'OK',
      cancelLabel: 'Cancel',
      required: true,
      destructive: false,
    });
  }, []);

  const showPrompt = useCallback((options = {}) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      dialogKindRef.current = 'prompt';
      setPromptInput('');
      setPromptError('');
      setState({
        open: true,
        kind: 'prompt',
        title: options.title || 'Notice',
        message: options.message || '',
        variant: options.variant || 'info',
        placeholder: options.placeholder || '',
        confirmLabel: options.confirmLabel || 'OK',
        cancelLabel: options.cancelLabel || 'Cancel',
        required: options.required !== false,
        destructive: Boolean(options.destructive),
      });
    });
  }, []);

  const showConfirm = useCallback((options = {}) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      dialogKindRef.current = 'confirm';
      setState({
        open: true,
        kind: 'confirm',
        title: options.title || 'Confirm',
        message: options.message || '',
        variant: options.variant || 'info',
        placeholder: '',
        confirmLabel: options.confirmLabel || 'OK',
        cancelLabel: options.cancelLabel || 'Cancel',
        required: true,
        destructive: Boolean(options.destructive),
      });
    });
  }, []);

  const confirmAccept = useCallback(() => {
    if (resolveRef.current) {
      resolveRef.current(true);
      resolveRef.current = null;
    }
    dialogKindRef.current = 'alert';
    setState((s) => ({ ...s, open: false }));
  }, []);

  const promptSubmit = useCallback(() => {
    const trimmed = promptInput.trim();
    if (state.required && !trimmed) {
      setPromptError('This field is required.');
      return;
    }
    setPromptError('');
    if (resolveRef.current) {
      resolveRef.current(trimmed);
      resolveRef.current = null;
    }
    dialogKindRef.current = 'alert';
    setPromptInput('');
    setState((s) => ({ ...s, open: false }));
  }, [promptInput, state.required]);

  useEffect(() => {
    registerAppAlert(showAlert);
    registerAppPrompt(showPrompt);
    registerAppConfirm(showConfirm);
    return () => {
      registerAppAlert(null);
      registerAppPrompt(null);
      registerAppConfirm(null);
    };
  }, [showAlert, showPrompt, showConfirm]);

  useEffect(() => {
    if (!state.open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.open, dismiss]);

  const value = useMemo(
    () => ({ showAlert, showPrompt, showConfirm, dismiss }),
    [showAlert, showPrompt, showConfirm, dismiss]
  );

  const variantStyles = {
    info: 'border-gray-200',
    success: 'border-emerald-200',
    error: 'border-red-200',
  };

  const primaryClass = state.destructive
    ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
    : 'bg-primary-600 hover:bg-primary-700 focus:ring-primary-500';

  return (
    <AlertModalContext.Provider value={value}>
      {children}
      {state.open &&
        createPortal(
          <div
            className="fixed inset-0 z-[10050] flex items-center justify-center p-4 sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="global-alert-title"
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/40"
              aria-label="Close dialog"
              onClick={dismiss}
            />
            <div
              className={`relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl shadow-xl border bg-white p-5 sm:p-6 ${variantStyles[state.variant] || variantStyles.info}`}
            >
              <h2
                id="global-alert-title"
                className="text-lg font-semibold text-gray-900 mb-2 pr-8"
              >
                {state.title}
              </h2>
              {state.message ? (
                <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">
                  {state.message}
                </p>
              ) : null}

              {state.kind === 'prompt' && (
                <div className="mt-4">
                  <label htmlFor="global-prompt-input" className="sr-only">
                    {state.placeholder || 'Response'}
                  </label>
                  <textarea
                    id="global-prompt-input"
                    rows={4}
                    value={promptInput}
                    onChange={(e) => {
                      setPromptInput(e.target.value);
                      if (promptError) setPromptError('');
                    }}
                    placeholder={state.placeholder || ''}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 min-h-[100px]"
                    autoFocus
                  />
                  {promptError ? (
                    <p className="mt-1 text-sm text-red-600">{promptError}</p>
                  ) : null}
                </div>
              )}

              <div className="mt-6 flex flex-wrap justify-end gap-2 sm:gap-3">
                {state.kind !== 'alert' && (
                  <button
                    type="button"
                    onClick={dismiss}
                    className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-800 text-sm font-medium hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
                  >
                    {state.cancelLabel}
                  </button>
                )}
                {state.kind === 'alert' && (
                  <button
                    type="button"
                    onClick={dismiss}
                    className={`px-4 py-2 rounded-lg text-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 ${primaryClass}`}
                  >
                    {state.confirmLabel}
                  </button>
                )}
                {state.kind === 'confirm' && (
                  <button
                    type="button"
                    onClick={confirmAccept}
                    className={`px-4 py-2 rounded-lg text-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 ${primaryClass}`}
                  >
                    {state.confirmLabel}
                  </button>
                )}
                {state.kind === 'prompt' && (
                  <button
                    type="button"
                    onClick={promptSubmit}
                    className={`px-4 py-2 rounded-lg text-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 ${primaryClass}`}
                  >
                    {state.confirmLabel}
                  </button>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </AlertModalContext.Provider>
  );
}

export function useAlertModal() {
  const ctx = useContext(AlertModalContext);
  if (!ctx) {
    throw new Error('useAlertModal must be used within AlertModalProvider');
  }
  return ctx;
}
