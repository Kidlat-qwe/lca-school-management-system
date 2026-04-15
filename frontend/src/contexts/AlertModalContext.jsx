import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { registerAppAlert } from '../utils/appAlert';

const AlertModalContext = createContext(null);

export function AlertModalProvider({ children }) {
  const [state, setState] = useState({
    open: false,
    title: 'Notice',
    message: '',
    variant: 'info',
  });

  const hide = useCallback(() => {
    setState((s) => ({ ...s, open: false }));
  }, []);

  const showAlert = useCallback((message, options = {}) => {
    setState({
      open: true,
      title: options.title || 'Notice',
      message,
      variant: options.variant || 'info',
    });
  }, []);

  useEffect(() => {
    registerAppAlert(showAlert);
    return () => registerAppAlert(null);
  }, [showAlert]);

  useEffect(() => {
    if (!state.open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') hide();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.open, hide]);

  const value = useMemo(() => ({ showAlert, hide }), [showAlert, hide]);

  const variantStyles = {
    info: 'border-gray-200',
    success: 'border-emerald-200',
    error: 'border-red-200',
  };

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
              onClick={hide}
            />
            <div
              className={`relative w-full max-w-md rounded-xl shadow-xl border bg-white p-5 sm:p-6 ${variantStyles[state.variant] || variantStyles.info}`}
            >
              <h2
                id="global-alert-title"
                className="text-lg font-semibold text-gray-900 mb-2 pr-8"
              >
                {state.title}
              </h2>
              <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">
                {state.message}
              </p>
              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={hide}
                  className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
                >
                  OK
                </button>
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
