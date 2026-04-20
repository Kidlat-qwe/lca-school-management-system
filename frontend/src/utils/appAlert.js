/**
 * Global app dialogs (replaces window.alert / window.confirm / window.prompt).
 * Register once via AlertModalProvider.
 * @param {string} message
 * @param {{ title?: string, variant?: 'info' | 'success' | 'error' }} [options]
 */
let showAlertImpl = null;

/**
 * @param {{
 *   title?: string,
 *   message?: string,
 *   placeholder?: string,
 *   confirmLabel?: string,
 *   cancelLabel?: string,
 *   required?: boolean,
 *   variant?: 'info' | 'success' | 'error',
 * }} [options]
 * @returns {Promise<string | null>} trimmed string, or null if cancelled
 */
let showPromptImpl = null;

/**
 * @param {{
 *   title?: string,
 *   message?: string,
 *   confirmLabel?: string,
 *   cancelLabel?: string,
 *   variant?: 'info' | 'success' | 'error',
 *   destructive?: boolean,
 * }} [options]
 * @returns {Promise<boolean>}
 */
let showConfirmImpl = null;

export function registerAppAlert(fn) {
  showAlertImpl = typeof fn === 'function' ? fn : null;
}

export function registerAppPrompt(fn) {
  showPromptImpl = typeof fn === 'function' ? fn : null;
}

export function registerAppConfirm(fn) {
  showConfirmImpl = typeof fn === 'function' ? fn : null;
}

export function appAlert(message, options = {}) {
  if (showAlertImpl) {
    showAlertImpl(String(message), options);
    return;
  }
  console.warn('[appAlert] Modal not ready:', message);
}

export function appPrompt(options = {}) {
  if (showPromptImpl) {
    return showPromptImpl(options);
  }
  console.warn('[appPrompt] Modal not ready');
  return Promise.resolve(null);
}

export function appConfirm(options = {}) {
  if (showConfirmImpl) {
    return showConfirmImpl(options);
  }
  console.warn('[appConfirm] Modal not ready');
  return Promise.resolve(false);
}
